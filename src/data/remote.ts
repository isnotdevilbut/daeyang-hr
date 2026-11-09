// Supabase 연결(프로토타입). 주소·공개 키는 빌드 환경변수(VITE_SUPABASE_URL·VITE_SUPABASE_KEY)로 받는다.
// 공개(publishable/anon) 키는 원래 브라우저에 들어가는 값이다. 비밀(service_role/secret) 키는 절대 여기에 넣지 않는다.
// 권한은 데이터베이스 함수가 검사한다(supabase/schema.sql) — 화면에서 가리는 것과 별개로 서버가 막는다.
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const URL = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim()
const KEY = (import.meta.env.VITE_SUPABASE_KEY as string | undefined)?.trim()

export const supabase: SupabaseClient | null = URL && KEY
  ? createClient(URL, KEY, { auth: { persistSession: true, autoRefreshToken: true, storageKey: 'daeyang-hr-proto-auth' } })
  : null

export const remoteConfigured = !!supabase

/** 계정 이메일(로그인 화면에는 보이지 않음): 관리자 1명, 직원 = 직원 ID */
export const ADMIN_EMAIL = 'admin@admin.daeyang-hr.app'
export const staffEmail = (employeeId: string) => `${employeeId.toLowerCase()}@staff.daeyang-hr.app`

/**
 * Supabase는 비밀번호를 6자 이상으로 받는다. 사번(예: 0005)도 그대로 쓸 수 있게
 * 화면에서 넣은 비밀번호 앞에 고정 글자를 붙여 보낸다(사용자는 신경 쓰지 않아도 됨).
 */
export const authPassword = (pw: string) => `dyhr::${pw}`

/** 데이터베이스 함수 호출. 실패하면 오류 문구로 예외 */
export async function rpc<T = unknown>(fn: string, args?: Record<string, unknown>): Promise<T> {
  if (!supabase) throw new Error('not configured')
  const { data, error } = await supabase.rpc(fn, args ?? {})
  if (error) throw new Error(error.message)
  return data as T
}

/** 시연용 관리자 비밀번호 — 로그인 화면 '시연 계정 보기'에 표시(사용자 결정). 서버의 관리자 비밀번호도 이 값. 관리자 화면에서는 비밀번호를 바꾸지 않음(잠김 방지) */
export const DEMO_ADMIN_PW = 'admin1234!'
