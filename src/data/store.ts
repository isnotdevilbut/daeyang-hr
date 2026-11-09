// 프로토타입 저장소: Supabase 데이터베이스(서버)에 저장하고 여러 사람·기기가 같은 데이터를 본다.
// 화면 코드는 그대로 쓴다 — update(바꾸는 함수)는 화면에 바로 반영한 뒤, 바뀐 부분만 서버로 보낸다.
//  - 설정(조직·평가·문항·KPI 등) → 관리자만 저장(dy_save_state). 다른 관리자가 먼저 저장했으면 최신 내용 위에 다시 적용
//  - 평가 응답 → 한 건씩 저장(dy_save_response) — 직원은 자기 응답만(서버가 검사)
//  - 몇 초마다 서버의 새 내용을 가져와 다른 사람이 바꾼 것을 반영
import { useSyncExternalStore } from 'react'
import type { AppState, Response } from '../domain/types'
import { createEmptyState } from '../domain/emptyState'
import { createSeed } from '../domain/seed'
import { authPassword, DEMO_ADMIN_PW, rpc, supabase } from './remote'

/** 관리자만 읽는 항목(서버의 admin_only) — 직원 화면에는 내려가지 않음 */
const ADMIN_KEYS = ['tokens', 'kpi', 'kpiIndicators', 'adjustments', 'manualScores', 'memos', 'reportNotes', 'adjustNotes'] as const
const POLL_MS = 8000

export const migrationNotes: string[] = [] // 이전 화면 코드 호환(프로토타입은 변환 없음)

let state: AppState = createEmptyState()
let version = 0
let isAdmin = false
let employeeId: string | null = null
/** 마지막으로 서버와 맞춘 내용(바뀐 부분 찾기용) */
let synced = snapshot(state)
/** 아직 서버에 보내지 않은(또는 보내는 중인) 변경 — 충돌 때 최신 내용 위에 다시 적용 */
let pending: ((d: AppState) => void)[] = []
let pushing: Promise<void> | null = null
let pollTimer: number | null = null
const listeners = new Set<() => void>()

export type SyncStatus = { phase: 'idle' | 'loading' | 'ready' | 'error'; saving: boolean; error: string | null }
let status: SyncStatus = { phase: 'idle', saving: false, error: null }
const statusListeners = new Set<() => void>()
function setStatus(p: Partial<SyncStatus>) { status = { ...status, ...p }; statusListeners.forEach((l) => l()) }
export function useSyncStatus(): SyncStatus {
  return useSyncExternalStore((cb) => { statusListeners.add(cb); return () => statusListeners.delete(cb) }, () => status)
}

function emit() { listeners.forEach((l) => l()) }

function split(s: AppState) {
  const { responses, session: _session, ...rest } = s
  const shared: Record<string, unknown> = { ...rest }
  const admin: Record<string, unknown> = {}
  for (const k of ADMIN_KEYS) if (k in shared) { admin[k] = shared[k]; delete shared[k] }
  return { shared, admin, responses }
}
function snapshot(s: AppState) {
  const { shared, admin, responses } = split(s)
  return { shared: JSON.stringify(shared), admin: JSON.stringify(admin), responses: Object.fromEntries(Object.entries(responses).map(([k, v]) => [k, JSON.stringify(v)])) as Record<string, string> }
}

export function getState() { return state }
export function remoteRole(): { isAdmin: boolean; employeeId: string | null } { return { isAdmin, employeeId } }

/** 서버에서 전부 읽어 오기(로그인 직후·새로고침·주기적 확인). 처음 쓰는 빈 데이터베이스면 관리자가 빈 상태로 시작 */
export async function loadRemote(): Promise<{ isAdmin: boolean; employeeId: string | null }> {
  if (status.phase !== 'ready') setStatus({ phase: 'loading' })
  try {
    const [st, rs] = await Promise.all([
      rpc<{ state: Partial<AppState>; version: number; role: string; employeeId?: string }>('dy_get_state'),
      rpc<Record<string, Response>>('dy_get_responses'),
    ])
    isAdmin = st.role === 'admin'
    employeeId = st.employeeId ?? null
    const blank = !st.state || !('schemaVersion' in st.state)
    const base = createEmptyState()
    const next: AppState = { ...base, ...(blank ? {} : st.state), responses: rs ?? {}, session: state.session } as AppState
    // 직원 화면에는 다른 직원의 사번이 내려오지 않음 — 화면 타입을 맞추려고 빈 글자
    next.employees = next.employees.map((e) => ({ ...e, empNo: e.empNo ?? '' }))
    state = next
    version = st.version
    synced = snapshot(state)
    if (blank && isAdmin) { synced = { shared: '', admin: '', responses: synced.responses }; await push() } // 빈 데이터베이스 → 빈 상태 틀 저장
    setStatus({ phase: 'ready', error: null })
    emit()
    startPolling()
    return { isAdmin, employeeId }
  } catch (e) {
    setStatus({ phase: 'error', error: (e as Error).message })
    throw e
  }
}

/** 로그아웃: 화면의 데이터를 지움(서버 데이터는 그대로) */
export function clearLocal() {
  stopPolling()
  state = { ...createEmptyState(), session: { role: 'admin', personaId: null } }
  version = 0; isAdmin = false; employeeId = null; pending = []
  synced = snapshot(state)
  setStatus({ phase: 'idle', error: null, saving: false })
  emit()
}

/** 상태 변경: 화면에 바로 반영하고 바뀐 부분을 서버로 보낸다. mutator가 예외를 던지면 아무것도 바꾸지 않음 */
export function update(mutator: (draft: AppState) => void) {
  const draft = structuredClone(state)
  mutator(draft) // 예외는 그대로 위로(저장 직전 확인으로 막힌 경우)
  state = draft
  pending.push(mutator)
  emit()
  void push().catch(() => resync())
}

/** 서버가 저장을 거절했을 때: 보내지 못한 변경은 버리고 서버 내용으로 다시 맞춤(오류 문구는 남겨 화면에 알림) */
let resyncing = false
async function resync() {
  if (resyncing) return
  resyncing = true
  const err = status.error
  pending = []
  try { await loadRemote() } catch { /* 연결 문제 — 다음 확인 때 다시 */ }
  setStatus({ error: err })
  resyncing = false
}

/** 서버로 보내기(한 번에 하나씩). 실패하면 예외 */
function push(): Promise<void> {
  if (pushing) return pushing.catch(() => {}).then(() => push())
  pushing = (async () => {
    setStatus({ saving: true })
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        const sentPending = pending.length
        const cur = snapshot(state)
        const { shared, admin } = split(state)
        const tasks: Promise<unknown>[] = []
        // 응답: 바뀐 것만 한 건씩, 사라진 것은 지움
        const changed = Object.keys(cur.responses).filter((k) => cur.responses[k] !== synced.responses[k])
        const removed = Object.keys(synced.responses).filter((k) => !(k in cur.responses))
        for (const k of changed) tasks.push(rpc('dy_save_response', { p_aid: k, p_data: JSON.parse(cur.responses[k]) }))
        if (removed.length) tasks.push(rpc('dy_delete_responses', { p_aids: removed }))
        await Promise.all(tasks)
        synced = { ...synced, responses: cur.responses }
        // 설정: 관리자만. 직원 화면에서 설정이 바뀌는 일은 없음(바뀌어도 서버로 보내지 않음)
        if (isAdmin && (cur.shared !== synced.shared || cur.admin !== synced.admin)) {
          try {
            version = await rpc<number>('dy_save_state', { p_shared: shared, p_admin: admin, p_version: version })
            synced = { ...synced, shared: cur.shared, admin: cur.admin }
          } catch (e) {
            if (!/conflict/.test((e as Error).message)) throw e
            // 다른 곳에서 먼저 저장함 → 최신 내용을 받아 아직 안 보낸 변경을 그 위에 다시 적용하고 다시 보냄
            const keep = pending.slice()
            const st = await rpc<{ state: AppState; version: number }>('dy_get_state')
            let base: AppState = { ...createEmptyState(), ...st.state, responses: state.responses, session: state.session }
            synced = { ...snapshot(base), responses: synced.responses }
            version = st.version
            for (const m of keep) { const d = structuredClone(base); try { m(d); base = d } catch { /* 이제는 적용할 수 없는 변경은 건너뜀 */ } }
            state = base
            emit()
            continue
          }
        }
        pending = pending.slice(sentPending)
        if (!pending.length) break
      }
      setStatus({ saving: false, error: null })
    } catch (e) {
      setStatus({ saving: false, error: (e as Error).message })
      throw e
    } finally {
      pushing = null
    }
  })()
  return pushing
}

/** 지금까지의 변경이 서버에 저장될 때까지 기다림(실패하면 예외) */
export async function flush() {
  while (pushing) await pushing.catch(() => {})
  if (pending.length) await push()
}

/** 다른 사람이 바꾼 내용 가져오기: 내가 보내는 중이 아닐 때만 */
async function poll() {
  if (pushing || pending.length || document.visibilityState !== 'visible' || status.phase !== 'ready') return
  try {
    const [v, rs] = await Promise.all([rpc<number>('dy_state_version'), rpc<Record<string, Response>>('dy_get_responses')])
    if (pushing || pending.length) return
    if (v !== version) { await loadRemote(); return }
    if (JSON.stringify(rs) !== JSON.stringify(state.responses)) {
      state = { ...state, responses: rs }
      synced = { ...synced, responses: snapshot(state).responses }
      emit()
    }
  } catch { /* 다음 확인 때 다시 */ }
}
function onFocus() { void poll() }
function startPolling() {
  if (pollTimer || typeof window === 'undefined') return
  pollTimer = window.setInterval(() => { void poll() }, POLL_MS)
  window.addEventListener('focus', onFocus)
}
function stopPolling() {
  if (pollTimer) window.clearInterval(pollTimer)
  pollTimer = null
  if (typeof window !== 'undefined') window.removeEventListener('focus', onFocus)
}

/**
 * 관리자: 시연 데이터 넣기 — 원본 시연 사이트와 같은 가상 직원 35명·평가·응답·KPI를 서버에 넣는다(지금 데이터·직원 계정은 지워짐).
 * 표시 demo = true → 로그인 화면에 시연 계정 목록, 평가 삭제 = 전부 초기화
 */
export async function loadDemo(onProgress?: (done: number, total: number) => void) {
  await rpc('dy_reset_all')
  await loadRemote() // 빈 상태 틀 저장
  const seed: AppState = { ...createSeed(), demo: true, session: state.session }
  const { shared, admin, responses } = split(seed)
  version = await rpc<number>('dy_save_state', { p_shared: shared, p_admin: admin, p_version: version })
  const list = Object.entries(responses)
  let done = 0
  for (let i = 0; i < list.length; i += 8) {
    await Promise.all(list.slice(i, i + 8).map(([aid, r]) => rpc('dy_save_response', { p_aid: aid, p_data: r })))
    done = Math.min(list.length, i + 8)
    onProgress?.(done, list.length)
  }
  // 시연 중 관리자 로그인 = 로그인 화면에 보이는 admin · admin1234! 로 맞춤
  await rpc('dy_set_admin_login', { p_id: 'admin' })
  await supabase?.auth.updateUser({ password: authPassword(DEMO_ADMIN_PW) })
  await loadRemote()
}

/** 관리자: 모든 데이터를 지우고 빈 상태로(서버) */
export async function resetDemo() {
  await rpc('dy_reset_all')
  await loadRemote()
}

export function useAppState(): AppState {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => state,
  )
}

/** 저장(응답 작성 화면): 화면에 반영하고 서버 저장이 끝날 때까지 기다림. 서버가 거절하면 화면도 되돌리고 예외 */
export async function simulatedSave(mutator: (draft: AppState) => void, _failRate = 0): Promise<void> {
  const before = state.responses
  update(mutator)
  try {
    await flush()
  } catch (e) {
    // 서버가 거절한 응답 변경은 되돌림(서버 내용은 그대로이므로 synced는 바꾸지 않음)
    state = { ...state, responses: before }
    pending = []
    emit()
    throw e
  }
}
