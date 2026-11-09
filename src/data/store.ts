// ⚠ 목업 전용 가상 저장소 — 이 브라우저의 localStorage에만 저장된다. 서버 저장이 아니다.
// 실서비스 단계에서는 이 파일의 함수들을 서버 API 호출로 교체하고, 화면·타입·계산 로직은 재사용한다.
import { useSyncExternalStore } from 'react'
import type { AppState } from '../domain/types'
import { SCHEMA_VERSION } from '../domain/schemaVersion'
import { createEmptyState } from '../domain/emptyState'

const KEY = 'daeyang-hr-mockup-v1' // 저장 위치 이름(고정). 데이터 구조 버전은 state.schemaVersion
/** 이번 페이지 로드에서 이전 저장 데이터를 변환했다면 그 내용 (목업 안내에 표시) */
export const migrationNotes: string[] = []
let lastRaw: string | null = null // 이 탭이 마지막으로 읽거나 쓴 저장 내용
let state: AppState = load()
const listeners = new Set<() => void>()

function load(): AppState {
  try {
    const raw = localStorage.getItem(KEY)
    lastRaw = raw
    if (raw) {
      const parsed = JSON.parse(raw)
      if (parsed.schemaVersion === SCHEMA_VERSION) return parsed as AppState
      // 빈 상태로 시작하는 버전(empty-start)은 이전 저장 구조가 없다 — 다른 구조는 지우지 않고 백업으로 옮긴 뒤 빈 상태로
      // 읽을 수 없는 구조: 지우지 않고 백업으로 옮긴 뒤 시드로 시작
      localStorage.setItem(`${KEY}-unreadable-backup`, raw)
      migrationNotes.push('이전 저장 데이터를 읽을 수 없어 백업으로 옮기고 처음 상태로 시작했습니다.')
    }
  } catch {
    /* 저장소 사용 불가(사생활 보호 모드 등) → 시드로 시작 */
  }
  return createEmptyState()
}

function persist() {
  try {
    lastRaw = JSON.stringify(state)
    localStorage.setItem(KEY, lastRaw)
  } catch {
    /* 저장 실패해도 화면은 메모리 상태로 동작 */
  }
}

export function getState() {
  return state
}

/**
 * 다른 탭에서 저장한 내용이 있으면 이 탭 상태를 그것으로 바꾼다 (D-059).
 * 직원 삭제·정보 수정이 다른 탭의 로그인 상태에 바로 반영되고, 오래된 화면 상태로 덮어쓰지 않게 한다.
 */
function syncFromStorage(): boolean {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw || raw === lastRaw) return false
    const parsed = JSON.parse(raw)
    const next = parsed.schemaVersion === SCHEMA_VERSION ? (parsed as AppState) : null
    if (!next) return false
    lastRaw = raw
    state = { ...next, session: state.session } // 화면 역할(session)은 탭마다 다르다 — 다른 탭의 로그인으로 바꾸지 않음
    return true
  } catch {
    return false
  }
}
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === KEY && syncFromStorage()) listeners.forEach((l) => l())
  })
}

/** 상태 변경. draft를 직접 수정하는 함수를 넘긴다. 항상 최신 저장 내용 위에서 고친다 */
export function update(mutator: (draft: AppState) => void) {
  const synced = syncFromStorage()
  const draft = structuredClone(state)
  try {
    mutator(draft)
  } catch (e) {
    if (synced) listeners.forEach((l) => l()) // 저장은 막혀도 새로 읽은 내용(예: 직원 삭제)은 화면에 반영
    throw e
  }
  state = draft
  persist()
  listeners.forEach((l) => l())
}

export function resetDemo() {
  lastRaw = null
  state = createEmptyState()
  persist()
  listeners.forEach((l) => l())
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

/** 저장 지연을 흉내 내는 가상 저장. 실서비스에서는 서버 응답 성공 시에만 "저장됨"을 표시한다. */
export function simulatedSave(mutator: (draft: AppState) => void, failRate = 0): Promise<void> {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      if (Math.random() < failRate) return reject(new Error('가상 저장 실패'))
      try {
        update(mutator)
        resolve()
      } catch (e) {
        reject(e) // 저장 직전 확인에서 막힘 (예: 로그인한 직원이 삭제됨) — 아무것도 바꾸지 않음
      }
    }, 450)
  })
}
