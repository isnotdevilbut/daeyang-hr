// 시험 전용: 목업 시절의 로그인 대조 규칙(아이디 = 이름, 첫 비밀번호 = 사번 — 프로토타입 서버의 첫 로그인 규칙과 같은 기준).
// 화면에서는 쓰지 않는다(프로토타입 로그인은 auth.ts의 remoteLogin, 서버 검사는 supabase/schema.sql).
import type { AppState } from '../domain/types'
import { ADMIN_ACCOUNTS, canSignIn, participantAccount, type DemoAccount } from './auth'

export const DEMO_PASSWORD = 'test-admin-pw'

export function checkLogin(s: AppState, id: string, pw: string): DemoAccount | string {
  const v = id.trim()
  const p = pw.trim()
  if (!v || !p) return '아이디와 비밀번호를 입력하세요.'
  const admin = ADMIN_ACCOUNTS.find((a) => a.adminId === v)
  if (admin) return pw === DEMO_PASSWORD ? admin : '아이디 또는 비밀번호가 올바르지 않습니다.'
  const e = s.employees.find((x) => canSignIn(x) && x.name.trim() === v && x.empNo === p)
  return e ? participantAccount(e.id) : '아이디 또는 비밀번호가 올바르지 않습니다.'
}
