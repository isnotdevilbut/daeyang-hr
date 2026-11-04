// ⚠ 목업 로그인 — 실제 보안 인증이 아니다.
// 브라우저에 저장된 조직 데이터와 대조하고, 로그인 상태(계정 키만)를 이 브라우저 탭의 sessionStorage에 둔다.
// 실서비스에서는 서버 인증(비밀번호 발급·초기화·해시 보관·세션 쿠키·권한 검사)으로 바꾸며, 이 파일의 방식을 발전시켜 쓰지 않는다.
import { useSyncExternalStore } from 'react'
import { type AppState, type DemoRole, type DemoSession, type Employee } from '../domain/types'
import { positionName } from '../domain/catalog'

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

/** 운영담당자 시연 계정의 공용 비밀번호 (가상 값, 실제 계정·비밀번호 아님) */
export const DEMO_PASSWORD = 'demo1234'

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

/**
 * 로그인 대조. 성공하면 계정, 실패하면 오류 문구.
 *  - 운영담당자: 아이디 admin + 공용 목업 비밀번호
 *  - 평가 참여자: 아이디 = 현재 이름, 비밀번호 = 현재 사번(글자 그대로 — 앞자리 0까지 같아야 함).
 *    동명이인은 사번으로 구분되고, 사번은 직원마다 하나라서 같은 이름·사번 조합은 둘이 될 수 없다.
 */
export function checkLogin(s: AppState, id: string, pw: string): DemoAccount | string {
  const v = id.trim()
  const p = pw.trim()
  if (!v || !p) return '아이디와 비밀번호를 입력하세요.'
  const admin = ADMIN_ACCOUNTS.find((a) => a.adminId === v)
  if (admin) return pw === DEMO_PASSWORD ? admin : '아이디 또는 비밀번호가 올바르지 않습니다.'
  const e = s.employees.find((x) => canSignIn(x) && x.name.trim() === v && x.empNo === p)
  return e ? participantAccount(e.id) : '아이디 또는 비밀번호가 올바르지 않습니다.'
}

export function setLoggedIn(key: string | null) {
  current = key
  try {
    if (key) sessionStorage.setItem(KEY, key)
    else sessionStorage.removeItem(KEY)
    sessionStorage.removeItem('daeyang-hr-progress-filters') // 로그인·로그아웃마다 진행 현황 카드·검색 선택 초기화(첫 화면은 '평가 참여자' 선택, D-096)
  } catch { /* 저장 불가 시 메모리에서만 유지 */ }
  emit()
}
