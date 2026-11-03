// 조직 관리: 평가 대상 표시, 이름 충돌 확인. (직원 명단 업로드 검증은 roster.ts)
// 회사는 화면에서 구분하지 않는다(D-017). 같은 이름의 팀·직원이 있어도 자동 병합하지 않고 알려만 준다.
import type { AppState, CustomField, Employee } from './types'
import { classDefault, positionById } from './catalog'

/** 새 회차를 만들 때 기본으로 평가 대상에 포함되는가 (회차별 실제 대상은 회차 스냅샷이 기준) */
export const isEvalTarget = (e: Employee) => !e.evalExcluded && !e.isCeo

/** 화면에 쓰는 직급은 세 가지 (D-068). 운영담당자 권한과는 별개 — 임원이라고 관리 권한이 생기지 않는다 */
export const TIERS = ['임원', '팀장', '사원'] as const
export type Tier = (typeof TIERS)[number]

/** 직급: 임원(대표자 포함) → 임원, 실제 팀장 연결 → 팀장, 나머지 → 사원. 직급 글자(반장·과장 등)로 판단하지 않는다 */
export function tierOf(s: Pick<AppState, 'teams'>, e: Employee): Tier {
  if (e.isExecutive || e.isCeo) return '임원'
  if (s.teams.some((t) => !t.archived && t.leadId === e.id)) return '팀장'
  return '사원'
}

/**
 * 직원의 직급을 실제 상태(임원 여부·팀장 연결)와 맞춘다. 팀장 연결이 바뀐 뒤 호출.
 * 직급의 평가 구분이 실제 상태와 같으면 그 직급(예: 대리)을 그대로 두고, 다르면 그 평가 구분의 기본 직급으로 (D-080)
 */
export function syncTiers(d: AppState) {
  d.employees.forEach((e) => {
    if (!e.active) return
    const tier = tierOf(d, e)
    let p = positionById(d, e.positionId)
    if (!p || p.evalClass !== tier) { p = classDefault(d, tier); e.positionId = p.id }
    e.position = p.name
  })
}

/** 이 팀의 현재 팀장(다른 사람) — 직급을 팀장으로 바꿀 때 교체 확인용 */
export function otherLead(s: AppState, teamId: string, empId: string): Employee | null {
  const t = s.teams.find((x) => x.id === teamId && !x.archived)
  if (!t?.leadId || t.leadId === empId) return null
  return s.employees.find((e) => e.id === t.leadId && e.active) ?? null
}

/**
 * 직원 저장 시 직급·팀장 연결을 함께 맞춘다 (D-068).
 *  - 임원: 임원 표시, 모든 팀장 연결 해제(임원은 팀장이 아님). 운영 권한과는 무관.
 *  - 팀장: 소속 팀의 팀장으로 지정. 기존 팀장이 있으면 화면에서 확인을 받은 뒤 교체하고, 기존 팀장은 사원이 된다.
 *  - 사원: 팀장 연결 해제.
 *  - 팀장이 다른 팀으로 옮기면 이전 팀의 팀장 연결은 해제된다.
 * 대표자 표시(isCeo)는 임원 이외 직급이면 해제한다(직급은 임원·팀장·사원 세 가지).
 */
export function applyTier(d: AppState, empId: string, tier: Tier) {
  const e = d.employees.find((x) => x.id === empId)
  if (!e) return
  const wasExec = e.isExecutive || e.isCeo
  d.teams.forEach((t) => { if (!t.archived && t.leadId === empId && (tier !== '팀장' || t.id !== e.teamId)) t.leadId = null })
  if (tier === '임원') {
    e.isExecutive = true
    if (!wasExec) e.evalExcluded = true // 임원은 받는 평가가 없음(자기평가는 회차별 설정)
  } else {
    e.isExecutive = false; e.isCeo = false
    if (wasExec) e.evalExcluded = false
    if (tier === '팀장') { const t = d.teams.find((x) => x.id === e.teamId); if (t) t.leadId = empId }
  }
  syncTiers(d)
}

/** 이전 호환 이름 — 직급과 같은 값 */
export const roleLabel = (s: AppState, e: Employee): string => tierOf(s, e)

export interface NameConflict { name: string; detail: string[] }

/** 같은 이름의 팀·재직 직원 목록 (자동 병합하지 않음) */
export function nameConflicts(s: AppState): { teams: NameConflict[]; employees: NameConflict[] } {
  const group = <T,>(items: T[], key: (x: T) => string) => {
    const m = new Map<string, T[]>()
    items.forEach((x) => m.set(key(x), [...(m.get(key(x)) ?? []), x]))
    return [...m.entries()].filter(([, v]) => v.length > 1)
  }
  const teamName = (id: string) => s.teams.find((t) => t.id === id)?.name ?? ''
  return {
    teams: group(activeTeams(s), (t) => t.name.trim()).map(([name, v]) => ({ name, detail: v.map((t) => `${s.employees.filter((e) => e.active && e.teamId === t.id).length}명`) })),
    employees: group(s.employees.filter((e) => e.active), (e) => e.name.trim()).map(([name, v]) => ({ name, detail: v.map((e) => `${teamName(e.teamId)} · 사번 ${e.empNo}`) })),
  }
}

/** 평가 회차(대상자·배정)나 보정 기록에 쓰인 직원인가 */
export function hasEvalRecords(s: AppState, id: string): boolean {
  return s.cycles.some((c) => c.targets.some((t) => t.employeeId === id) || c.assignments.some((a) => a.evaluatorId === id || a.targetId === id)) ||
    s.adjustments.some((a) => a.targetKey === id)
}

/**
 * 직원 삭제 (D-053). 조직 목록에서 빠진다.
 *  - 현재 조직의 팀장 연결은 해제(공석) — 없는 직원을 팀장으로 가리키지 않게
 *  - 평가 기록이 있으면 직원 데이터를 지우지 않고 재직 해제로 보존 → 회차의 대상자·배정·응답·보정이 그대로 이어짐
 *  - 기록이 없으면 데이터에서도 지운다
 */
export function deleteEmployee(d: AppState, id: string) {
  d.teams.forEach((t) => { if (t.leadId === id) t.leadId = null })
  if (hasEvalRecords(d, id)) d.employees = d.employees.map((e) => (e.id === id ? { ...e, active: false } : e))
  else { d.employees = d.employees.filter((e) => e.id !== id); if (d.memos) delete d.memos[id] } // 데이터에서 지울 때만 메모도 정리
}

// ── 팀 관리 (D-064) ─────────────────────────────────────
/** 현재 조직의 팀 (삭제한 팀 제외) */
export const activeTeams = (s: Pick<AppState, 'teams'>) => s.teams.filter((t) => !t.archived)

/** 팀 구성원 = 이 팀 소속 재직 직원. 팀장(이 팀 소속일 때만) 먼저, 나머지는 이름순. 다른 팀 소속 팀장은 세지 않는다 */
/** 팀 소속 재직 직원 — 직급 순서(임원 → 팀장 → 사원, D-139) → 이름순. 같은 직급이면 이 팀 팀장이 먼저 */
export function teamMembers(s: AppState, teamId: string): Employee[] {
  const lead = s.teams.find((t) => t.id === teamId)?.leadId
  return s.employees
    .filter((e) => e.active && e.teamId === teamId)
    .sort((a, b) => TIERS.indexOf(tierOf(s, a)) - TIERS.indexOf(tierOf(s, b)) || Number(b.id === lead) - Number(a.id === lead) || a.name.localeCompare(b.name, 'ko'))
}

/** 새 팀·이름 변경 검증: 빈 이름, 현재 조직의 다른 팀과 같은 이름(업로드·화면에서 팀을 이름으로 찾으므로 전체에서 하나) */
export function teamNameError(s: AppState, name: string, selfId?: string): string | null {
  const n = name.trim()
  if (!n) return '팀 이름을 입력하세요.'
  if (activeTeams(s).some((t) => t.id !== selfId && t.name.trim() === n)) return `'${n}' 팀이 이미 있습니다.`
  return null
}

/**
 * 팀 삭제. 소속 재직 직원은 moveTo 팀으로 옮긴다(직원은 지우지 않음). 팀장 연결은 해제.
 * 퇴사 처리된 직원이 아직 이 팀을 가리키면 팀을 숨김(archived)으로 남기고, 아무도 가리키지 않으면 데이터에서 지운다.
 * 과거 회차(대상자 스냅샷의 팀 이름)·응답·점수·리포트·팀 KPI 기록은 건드리지 않는다.
 */
export function deleteTeam(d: AppState, teamId: string, moveTo: string | null): string | null {
  const team = d.teams.find((t) => t.id === teamId && !t.archived)
  if (!team) return '팀을 찾을 수 없습니다.'
  const members = d.employees.filter((e) => e.active && e.teamId === teamId)
  if (members.length) {
    const target = d.teams.find((t) => t.id === moveTo && !t.archived && t.id !== teamId)
    if (!target) return '직원을 옮길 팀을 선택하세요.'
    members.forEach((e) => { e.teamId = target.id })
  }
  team.leadId = null
  if (d.employees.some((e) => e.teamId === teamId)) team.archived = true
  else d.teams = d.teams.filter((t) => t.id !== teamId)
  return null
}

// ── 직원 분류 기준(사용자 정의 열)·관리자 메모 (D-078) ─────────────
// 직원 정보 관리용 — 평가 권한·배정·점수·로그인에 쓰지 않는다.
export const CORE_FIELD_NAMES = ['팀', '이름', '직급', '직무', '사번', '수정', '메모', '평가 대상']

/** 분류 기준 검증. 오류 문구 목록 */
export function customFieldErrors(s: Pick<AppState, 'customFields'>, f: Pick<CustomField, 'id' | 'name' | 'type' | 'options'>): string[] {
  const e: string[] = []
  const name = f.name.trim()
  if (!name) e.push('항목 이름을 입력하세요.')
  else if (CORE_FIELD_NAMES.includes(name)) e.push(`'${name}'은(는) 기본 항목 이름입니다.`)
  else if ((s.customFields ?? []).some((x) => x.id !== f.id && x.name.trim() === name)) e.push(`'${name}' 항목이 이미 있습니다.`)
  if (f.type === 'select') {
    const labels = f.options.map((o) => o.label.trim())
    if (labels.length === 0) e.push('선택지를 하나 이상 추가하세요.')
    if (labels.some((l) => !l)) e.push('비어 있는 선택지가 있습니다.')
    if (new Set(labels.filter(Boolean)).size !== labels.filter(Boolean).length) e.push('같은 선택지가 두 번 있습니다.')
  }
  return e
}

/** 이 항목에 값이 있는 직원 수 (선택지 ID를 주면 그 선택지를 쓰는 직원 수) */
export function customFieldUsage(s: Pick<AppState, 'employees'>, fieldId: string, optionId?: string): number {
  return s.employees.filter((e) => { const v = e.custom?.[fieldId]; return v !== undefined && v !== '' && (optionId === undefined || v === optionId) }).length
}

/** 분류 기준 저장(추가·수정). 지운 선택지를 쓰던 값은 비운다(화면에서 확인 후) */
export function saveCustomField(d: AppState, f: CustomField) {
  const clean: CustomField = { id: f.id, name: f.name.trim(), type: f.type, options: f.type === 'select' ? f.options.map((o) => ({ id: o.id, label: o.label.trim() })) : [] }
  const list = d.customFields ?? (d.customFields = [])
  const i = list.findIndex((x) => x.id === f.id)
  if (i >= 0) list[i] = clean
  else list.push(clean)
  if (clean.type === 'select') {
    const ok = new Set(clean.options.map((o) => o.id))
    d.employees.forEach((e) => { const v = e.custom?.[clean.id]; if (v && !ok.has(v)) delete e.custom![clean.id] })
  }
}

/** 분류 기준 삭제 — 직원별 값도 함께 지운다(화면에서 확인 후) */
export function deleteCustomField(d: AppState, fieldId: string) {
  d.customFields = (d.customFields ?? []).filter((x) => x.id !== fieldId)
  d.employees.forEach((e) => { if (e.custom) delete e.custom[fieldId] })
}

/** 목록·창에 보이는 값 (선택형은 선택지 이름) */
export function customValueText(f: CustomField, v: string | undefined): string {
  if (!v) return ''
  return f.type === 'select' ? f.options.find((o) => o.id === v)?.label ?? '' : v
}
