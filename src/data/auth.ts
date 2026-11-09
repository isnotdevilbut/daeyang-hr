// 프로토타입 로그인 — Supabase 인증(서버). 비밀번호는 서버에 암호화되어 보관되고, 로그인 상태는 서버가 발급한 세션.
//  - 관리자: 아이디 admin. 처음 로그인할 때 넣은 비밀번호로 관리자 계정이 만들어진다(한 명).
//  - 직원: 아이디 = 이름, 첫 비밀번호 = 사번. 첫 로그인 때 서버가 이름·사번을 확인해 계정을 만들고, 이후 '비밀번호 변경'으로 바꿀 수 있다.
//  - 권한(누가 무엇을 읽고 쓰나)은 데이터베이스 함수가 검사한다(supabase/schema.sql).
import { useSyncExternalStore } from 'react'
import { type AppState, type DemoRole, type DemoSession, type Employee } from '../domain/types'
import { positionName } from '../domain/catalog'
import { ADMIN_EMAIL, authPassword, rpc, supabase } from './remote'
import { clearLocal, loadRemote } from './store'

/**
 * 로그인 계정 (D-059).
 *  - 운영담당자: 고정 아이디(admin) + 공용 목업 비밀번호(최종 점수·등급 지정 포함 — D-184에서 admin-final을 admin에 합침). 직원 등록·임원 지정으로는 생기지 않는다.
 *  - 평가 참여자: 조직 관리의 현재 직원 데이터와 직접 연결 — 아이디 = 이름, 비밀번호 = 사번.
 *    로그인 상태는 직원 내부 ID(p:<id>)로 기억하므로 이름·사번을 바꿔도 응답·배정 연결은 그대로이고,
 *    직원을 삭제(재직 해제)하면 그 즉시 세션이 무효가 된다.
 */
export interface DemoAccount {
  key: string // 로그인 상태 저장용 내부 키
  kind: 'admin' | 'participant'
  adminId?: string // 운영담당자 로그인 아이디
  personaId: string | null // 참여자 계정의 직원 내부 ID
  finalAdjust?: boolean // 최종 점수·등급 지정 가능 (목업 검토용 가정)
}

export const ADMIN_ACCOUNTS: DemoAccount[] = [
  { key: 'admin', kind: 'admin', adminId: 'admin', personaId: null, finalAdjust: true }, // D-184: admin-final 없앰(이전 로그인은 로그인 화면으로)
]

export const participantAccount = (employeeId: string): DemoAccount => ({ key: `p:${employeeId}`, kind: 'participant', personaId: employeeId })

function accountFromKey(key: string | null): DemoAccount | null {
  if (!key) return null
  if (key.startsWith('p:') && key.length > 2) return participantAccount(key.slice(2))
  return ADMIN_ACCOUNTS.find((a) => a.key === key) ?? null // 이전 방식의 키(lead-sales 등)는 계정이 아님
}

/** 평가 참여용으로 로그인할 수 있는 직원: 현재 조직 데이터에 있고 재직 중(삭제되지 않음). 대표자는 평가 참여자가 아님(D-035) */
export const canSignIn = (e: Employee | undefined): e is Employee => !!e && e.active && !e.isCeo

/** 참여자 역할: 조직 데이터에서 정한다 (임원 > 팀장 > 직원). 운영담당자 권한은 여기서 생기지 않는다 */
export function participantRole(s: AppState, e: Employee): DemoRole {
  if (e.isExecutive) return 'exec'
  if (s.teams.some((t) => t.leadId === e.id)) return 'lead'
  return 'member'
}

export function accountText(s: AppState, e: Employee): string {
  const team = s.teams.find((t) => t.id === e.teamId)?.name
  // 표시 = 직급 이름 (D-080). 화면 역할(participantRole)은 임원 표시·팀장 연결로 따로 정해진다
  return `${positionName(s, e)}${team ? ` · ${team}` : ''}`
}

const KEY = 'daeyang-hr-auth'
let current: string | null = read()
const listeners = new Set<() => void>()
function read(): string | null {
  try { return sessionStorage.getItem(KEY) } catch { return null }
}
function emit() { listeners.forEach((l) => l()) }

export function currentAccount(): DemoAccount | null {
  return accountFromKey(current)
}

export function useAccount(): DemoAccount | null {
  useSyncExternalStore((cb) => { listeners.add(cb); return () => listeners.delete(cb) }, () => current)
  return currentAccount()
}

/** 계정 → 화면 세션. 매번 현재 조직 데이터로 다시 확인 — 참여자 직원이 삭제되면 null (로그인 화면으로) */
export function sessionFor(s: AppState, a: DemoAccount): DemoSession | null {
  if (a.kind === 'admin') return { role: 'admin', personaId: null, finalAdjust: !!a.finalAdjust, accountId: a.key }
  const e = s.employees.find((x) => x.id === a.personaId)
  if (!canSignIn(e)) return null
  return { role: participantRole(s, e), personaId: e.id, finalAdjust: false, accountId: a.key }
}

export function homeFor(role: DemoRole): string {
  return role === 'admin' ? '/admin/progress' : '/eval'
}

const WRONG = '아이디 또는 비밀번호가 올바르지 않습니다.'

/**
 * 로그인(서버). 성공하면 계정, 실패하면 오류 문구.
 *  - admin: 계정이 있으면 비밀번호 확인, 아직 관리자가 없으면 지금 넣은 비밀번호로 관리자 계정을 만든다
 *  - 직원: 이름으로 계정 후보(동명이인이면 여러 명)를 찾아 비밀번호 확인. 아직 계정이 없으면 비밀번호가 사번일 때 계정을 만든다(서버가 사번 확인)
 */
export async function remoteLogin(id: string, pw: string): Promise<DemoAccount | string> {
  const v = id.trim()
  if (!v || !pw.trim()) return '아이디와 비밀번호를 입력하세요.'
  if (!supabase) return '서버 연결 설정이 없습니다.'
  const signIn = async (email: string) => !(await supabase!.auth.signInWithPassword({ email, password: authPassword(pw) })).error
  try {
    if (v === 'admin') {
      if (await signIn(ADMIN_EMAIL)) return ADMIN_ACCOUNTS[0]
      if (await rpc<boolean>('dy_admin_exists')) return WRONG
      if (pw.length < 4) return '처음 관리자 비밀번호는 4자 이상으로 정해 주세요.'
      const r = await supabase.auth.signUp({ email: ADMIN_EMAIL, password: authPassword(pw) })
      if (r.error) return `관리자 계정을 만들지 못했습니다: ${r.error.message}`
      if (!r.data.session && !(await signIn(ADMIN_EMAIL))) return 'Supabase 설정에서 이메일 확인(Confirm email)을 꺼 주세요.'
      return ADMIN_ACCOUNTS[0]
    }
    const cands = await rpc<{ email: string; hasAccount: boolean }[]>('dy_login_candidates', { p_name: v })
    for (const c of cands.filter((x) => x.hasAccount)) if (await signIn(c.email)) return participantAccount(c.email.split('@')[0])
    for (const c of cands.filter((x) => !x.hasAccount)) {
      // 첫 로그인: 비밀번호 = 사번이면 서버가 계정을 만든다(사번이 다르면 서버가 거절)
      const r = await supabase.auth.signUp({ email: c.email, password: authPassword(pw), options: { data: { empNo: pw.trim() } } })
      if (r.error) continue
      if (r.data.session || (await signIn(c.email))) return participantAccount(c.email.split('@')[0])
    }
    return WRONG
  } catch (e) {
    return `서버에 연결하지 못했습니다: ${(e as Error).message}`
  }
}

/** 비밀번호 변경(로그인한 본인). 4자 이상 */
export async function changePassword(next: string): Promise<string | null> {
  if (!supabase) return '서버 연결 설정이 없습니다.'
  if (next.trim().length < 4) return '새 비밀번호는 4자 이상으로 정해 주세요.'
  const { error } = await supabase.auth.updateUser({ password: authPassword(next) })
  return error ? `바꾸지 못했습니다: ${error.message}` : null
}

/** 새로고침·재방문: 서버 세션이 남아 있으면 데이터를 불러오고 로그인 상태를 되살린다 */
export async function restoreLogin(): Promise<void> {
  if (!supabase) return
  const { data } = await supabase.auth.getSession()
  if (!data.session) { setLoggedIn(null, false); return }
  try {
    const r = await loadRemote()
    setLoggedIn(r.isAdmin ? 'admin' : r.employeeId ? `p:${r.employeeId}` : null, false)
  } catch {
    await supabase.auth.signOut()
    setLoggedIn(null, false)
  }
}

export function setLoggedIn(key: string | null, signOut = true) {
  if (!key && signOut && current) { void supabase?.auth.signOut(); clearLocal() } // 로그아웃: 서버 세션 끝내고 화면 데이터 지움
  current = key
  try {
    if (key) sessionStorage.setItem(KEY, key)
    else sessionStorage.removeItem(KEY)
    sessionStorage.removeItem('daeyang-hr-progress-filters') // 로그인·로그아웃마다 진행 현황 카드·검색 선택 초기화(첫 화면은 '평가 참여자' 선택, D-096)
  } catch { /* 저장 불가 시 메모리에서만 유지 */ }
  emit()
}
