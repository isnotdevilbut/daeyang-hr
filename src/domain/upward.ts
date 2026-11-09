// 상향평가 (D-114 팀원 → 팀장평가, D-187 팀원·팀장 → 임원). 사원(평가자)이 소속 팀의 현재 팀장(대상자)을, 사원·팀장이 소속 팀 임원을 평가한다.
// - 배정: direction 'up', 1단계로 분류(stageOrder 1). 경로(path) 단계가 아니어서 점수·단계 반영 비율·순차 잠금·임원평가 담당에는 영향 없음
//   (isActiveAssignment가 'up'을 빼므로 기존 집계는 그대로, 진행 현황·내 평가·상세는 isUpward로 따로 보여 준다)
// - 대상: 준비·진행 회차의 참여 사원(평가 제외·임원·팀장 아님) × 그 사원 팀의 현재 팀장(회차 참여자). 팀장이 없거나 참여하지 않으면 배정 없음
// - 조직이 바뀌면 응답 없는 배정은 정리·새로 만들고, 응답 있는 배정은 지우지 않고 'leadChanged'로 보존(작성자·응답 그대로)
// - 평가표: 평가표 버전 '팀원→팀장 평가표'(공통 기본, 적용 평가 = 팀원→팀장평가). 이 평가표가 있는 회차에서만 배정을 만든다
//   (저장 데이터 v18 변환·새 평가 만들기·복제에서 만든다 — 그 이전 변환 단계의 배정 맞추기에서는 만들지 않음)
import type { AppState, Assignment, Cycle } from './types'
import { EXEC_UPWARD_NAME, makeExecUpwardTemplate, makeUpwardTemplate, UPWARD_NAME, UPWARD_V1_KEYS } from './templates'
import { liveVersions, resolveVersion, slotMode, slotOwner, wideScope } from './versions'
import { demoAnswers } from './demoV15'
import { execAssignment } from './execPlan'

const open = (c: Pick<Cycle, 'status'>) => c.status === '준비' || c.status === '진행'

/** 이 회차의 팀원→팀장평가 평가표 ID — 없으면 평가표·버전을 만든다 */
export function ensureUpwardTemplate(c: Cycle): string {
  const id = `${c.id}-tpl-upward`
  const v = slotMode(c) ? slotOwner(c, 'up-lead') : liveVersions(c).find((x) => wideScope(x.scope) && x.scope.rules.includes('upward')) // 상향평가 전체 체크(이전 '모두에게 동일 적용', D-210) · 화살표 '사원 → 팀장'(D-211)
  if (v) return v.templateId
  if (!c.templates[id]) c.templates[id] = makeUpwardTemplate(id)
  if (c.versions) c.versions = [...c.versions, { templateId: id, name: UPWARD_NAME, scope: { mode: 'all', rules: ['upward'], teams: 'all', positions: 'all' } }]
  return id
}

/** 이 회차의 팀원→팀장평가 평가표(없으면 null = 이 회차는 팀원→팀장평가 없음) */
export function upwardTemplateOf(c: Cycle): string | null {
  const v = slotMode(c) ? slotOwner(c, 'up-lead') : liveVersions(c).find((x) => wideScope(x.scope) && x.scope.rules.includes('upward'))
  return v?.templateId ?? (c.templates[`${c.id}-tpl-upward`] ? `${c.id}-tpl-upward` : null)
}

/** 이 회차에 참여하는 임원(재직·임원 표시·참여 해제 아님) — 팀원→임원·팀장→임원 상향평가의 대상자(D-187) */
export function upwardExecs(s: Pick<AppState, 'employees'>, c: Pick<Cycle, 'execOff'>): AppState['employees'] {
  const off = new Set(c.execOff ?? [])
  return s.employees.filter((e) => e.active && e.isExecutive && !e.isCeo && !off.has(e.id))
}

/** 이 사람이 상향평가할 임원(D-191) = 그 사람을 임원평가하는 담당 임원(쌍방, D-212 — 따로 배정 없음) */
export function upwardExecOf(c: Cycle, t: Cycle['targets'][number]): string | undefined {
  return execAssignment(c, t)?.evaluatorId
}

/**
 * v30 → v31 (D-212): 임원 상향평가 따로 배정(D-207) 없앰 — 준비·진행 회차의 따로 배정 표시를 지우고 임원평가 담당 기준으로 맞춘다
 * (짝이 바뀌는 배정: 응답 없으면 새 짝, 응답 있으면 보존·집계 제외). 반복 안전
 */
export function upwardPairedV31(s: AppState): string[] {
  const notes: string[] = []
  for (const c of s.cycles) {
    if (!open(c) || (!c.upwardExecSeparate && !c.upwardExecPick)) continue
    delete c.upwardExecSeparate; delete c.upwardExecPick
    notes.push(`${c.name}: 임원 상향평가를 임원 평가 배정과 같은 짝으로(따로 배정 없앰)`, ...syncUpward(s, c))
  }
  return notes
}

/** 상향평가 종류(D-187): 대상자가 임원이면 팀원→임원·팀장→임원(평가자의 현재 직급), 아니면 팀원→팀장 */
export type UpwardKind = 'memberToLead' | 'memberToExec' | 'leadToExec'
export const UPWARD_KIND_TEXT: Record<UpwardKind, string> = { memberToLead: '팀원→팀장', memberToExec: '팀원→임원', leadToExec: '팀장→임원' }
export function upwardKind(s: Pick<AppState, 'employees' | 'teams'>, a: Pick<Assignment, 'evaluatorId' | 'targetId'>): UpwardKind {
  const to = s.employees.find((e) => e.id === a.targetId)
  if (!to?.isExecutive) return 'memberToLead'
  return s.teams.some((x) => !x.archived && x.leadId === a.evaluatorId) ? 'leadToExec' : 'memberToExec'
}

/**
 * 있어야 할 (평가자 → 대상자) 쌍: 참여 사원 → 소속 팀 현재 팀장(D-114).
 * upwardToExec 회차(D-187)는 참여 사원·팀장 → 그 사람을 임원평가하는 담당 임원(평가자 배정의 임원 평가 배정, D-191 — 이 회차 참여 임원)도.
 * 담당 임원이 미지정이면 임원 상향평가 없음
 */
export function upwardPairs(s: Pick<AppState, 'employees' | 'teams'>, c: Cycle): { member: string; lead: string }[] {
  const out: { member: string; lead: string }[] = []
  const emp = (id: string) => s.employees.find((e) => e.id === id)
  const inCycle = new Set(c.targets.map((t) => t.employeeId))
  const execs = c.upwardToExec ? upwardExecs(s, c) : []
  for (const t of c.targets) {
    const e = emp(t.employeeId)
    if (!e || !e.active || e.evalExcluded || e.isExecutive || e.isCeo || t.isExecutive) continue
    const isLead = s.teams.some((x) => !x.archived && x.leadId === e.id)
    if (!isLead) { // 현재 팀장은 팀원→팀장평가의 평가자가 아님
      const lead = s.teams.find((x) => x.id === e.teamId && !x.archived)?.leadId
      const le = lead ? emp(lead) : undefined
      if (lead && lead !== e.id && le?.active && inCycle.has(lead)) out.push({ member: e.id, lead })
    }
    if (execs.length) {
      const ex = upwardExecOf(c, t)
      if (ex && ex !== e.id && execs.some((x) => x.id === ex)) out.push({ member: e.id, lead: ex })
    }
  }
  return out
}

/** 준비·진행 회차의 상향평가 배정을 현재 조직·참여자에 맞춘다. 다시 실행해도 바뀌는 것이 없다 */
export function syncUpward(s: AppState, c: Cycle): string[] {
  const notes: string[] = []
  if (!open(c)) return notes
  const pairs = upwardPairs(s, c)
  const ups = () => c.assignments.filter((a) => a.direction === 'up')
  const name = (id: string) => s.employees.find((e) => e.id === id)?.name ?? id
  // 1) 맞지 않게 된 배정: 응답 없으면 지움, 있으면 보존(집계 제외)
  for (const a of ups()) {
    if (a.excluded) continue
    if (pairs.some((p) => p.member === a.evaluatorId && p.lead === a.targetId)) continue
    if (s.responses[a.id]) { a.excluded = 'leadChanged'; notes.push(`${c.name}: 상향평가 ${name(a.evaluatorId)} → ${name(a.targetId)} 응답 보존·집계 제외(팀장·임원·참여 변경)`) }
    else c.assignments = c.assignments.filter((x) => x !== a)
  }
  const tpl = upwardTemplateOf(c)
  if (!pairs.length || !tpl) return notes
  // 2) 없는 배정 만들기(같은 쌍의 보존 배정이 있으면 되살림)
  for (const p of pairs) {
    const same = ups().filter((a) => a.evaluatorId === p.member && a.targetId === p.lead)
    if (same.some((a) => !a.excluded)) continue
    const kept = same.find((a) => a.excluded === 'leadChanged')
    if (kept) { delete kept.excluded; continue }
    const toExec = !!s.employees.find((e) => e.id === p.lead)?.isExecutive
    const base = toExec ? `${c.id}-ux-${p.member}-${p.lead}` : `${c.id}-u-${p.member}`
    const id = c.assignments.some((a) => a.id === base) ? `${base}-${p.lead}` : base
    const t = c.targets.find((x) => x.employeeId === p.lead)
    const le = s.employees.find((e) => e.id === p.lead)
    const r = resolveVersion(c, { rule: 'upward', teamId: (t?.departmentId ?? le?.teamId) || undefined, positionId: t?.positionId ?? le?.positionId, employeeId: p.lead, tier: toExec ? '임원' : '팀장' })
    c.assignments.push({ id, targetId: p.lead, evaluatorId: p.member, direction: 'up', stageOrder: 1, templateId: r.templateId ?? tpl })
  }
  return notes
}

/**
 * 시연 응답(목업): 응답이 없는 팀원→팀장평가의 절반 정도를 제출, 일부는 임시저장 — 사원 사번 순으로 번갈아.
 * 이미 응답(사용자 기록 포함)이 있는 배정은 건드리지 않는다
 */
export function upwardDemo(s: AppState, c: Cycle, only: (a: Assignment) => boolean = () => true): number {
  if (!open(c)) return 0
  const at = '2026-10-28T00:00:00.000Z'
  const no = (id: string) => s.employees.find((e) => e.id === id)?.empNo ?? id
  const list = c.assignments.filter((a) => a.direction === 'up' && !a.excluded && only(a)).sort((a, b) => no(a.evaluatorId).localeCompare(no(b.evaluatorId), 'ko', { numeric: true }))
  let n = 0
  list.forEach((a: Assignment, i) => {
    if (s.responses[a.id]) return
    if (i % 2 === 0) { s.responses[a.id] = { assignmentId: a.id, answers: demoAnswers(c, a), status: 'submitted', savedAt: at, submittedAt: at, lang: 'ko', demo: true }; n++ }
    else if (i % 6 === 1) s.responses[a.id] = { assignmentId: a.id, answers: {}, status: 'draft', savedAt: at, submittedAt: null, lang: 'ko', demo: true }
  })
  return n
}

/** v17 → v18 (D-114)과 새 시드 공통: 준비·진행 회차에 팀원→팀장평가 평가표·배정·시연 응답(절반 제출). 마감·확정 회차는 그대로 */
export function upwardV18(s: AppState): string[] {
  const notes: string[] = []
  for (const c of s.cycles) {
    if (!open(c)) continue
    const tpl = ensureUpwardTemplate(c)
    // 평가표 탭 순서를 새 데이터·변환 데이터 모두 같게: 팀원→팀장 평가표는 맨 뒤
    if (c.versions) c.versions = [...c.versions.filter((v) => v.templateId !== tpl), ...c.versions.filter((v) => v.templateId === tpl)]
    notes.push(...syncUpward(s, c))
    const ups = c.assignments.filter((a) => a.direction === 'up' && !a.excluded).length
    if (!ups) continue
    const n = upwardDemo(s, c)
    notes.push(`${c.name}: 팀원→팀장평가 ${ups}건 배정(시연 제출 ${n}건)`)
  }
  return notes
}

/**
 * v21 → v22 (D-124): 팀원→팀장 평가표 내용을 회사 상향평가 예시(영역 5개·배점 25·25·20·20·10·5점 척도 + 의견)로.
 * 준비·진행 회차에서 평가표가 D-114 첫 초기값 그대로(영역 구성)일 때 — 시연 제출은 새 문항으로 시연 답을 다시 만들고(제출·임시저장 상태 그대로).
 * 사용자 응답이 있으면 지우지 않는다: 이전 문항은 사용 중지(숨김)로 남겨 그 응답과 함께 보존하고 새 영역을 뒤에 붙인다. 평가표를 고쳐 썼으면 그대로
 */
export function upwardFormV22(s: AppState): string[] {
  const notes: string[] = []
  for (const c of s.cycles) {
    if (!open(c)) continue
    const id = upwardTemplateOf(c)
    const t = id ? c.templates[id] : undefined
    if (!id || !t) continue
    const fresh = makeUpwardTemplate(id)
    if (t.sections.some((x) => x.id === `${id}-order` || x.id === `${id}-order-v2`)) continue // 이미 새 내용
    if (t.sections.map((x) => x.id.slice(id.length + 1)).join() !== UPWARD_V1_KEYS.join()) { notes.push(`${c.name}: ${UPWARD_NAME}을(를) 고쳐 써서 내용을 바꾸지 않음`); continue }
    const as = c.assignments.filter((a) => a.templateId === id)
    const userAnswered = as.some((a) => s.responses[a.id] && !s.responses[a.id].demo)
    if (userAnswered) {
      // 이전 문항·영역 ID는 그대로(사용 중지) — 사용자 응답 보존. 영역 배점이 없는 이전 영역은 점수 계산·배점 합계에 들어가지 않음
      for (const sec of t.sections) for (const q of sec.questions) q.active = false
      t.sections = [...fresh.sections.map((x) => ({ ...x, id: `${x.id}-v2`, questions: x.questions.map((q) => ({ ...q, id: `${q.id}-v2`, options: q.options.map((o) => ({ ...o, id: o.id.replace(q.id, `${q.id}-v2`) })), ...(q.i18n?.ru ? { i18n: { ru: { ...q.i18n.ru, options: Object.fromEntries(Object.entries(q.i18n.ru.options ?? {}).map(([k, v]) => [k.replace(q.id, `${q.id}-v2`), v])), ...(q.i18n.ru.basis ? { basis: { ...q.i18n.ru.basis, options: Object.fromEntries(Object.entries(q.i18n.ru.basis.options).map(([k, v]) => [k.replace(q.id, `${q.id}-v2`), v])) } } : {}) } } } : {}) })) })), ...t.sections]
    } else t.sections = fresh.sections
    t.gradeScale = fresh.gradeScale; t.sourceNote = fresh.sourceNote; t.version += 1
    let n = 0
    for (const a of as) {
      const r = s.responses[a.id]
      if (!r || !r.demo) continue
      r.answers = r.status === 'submitted' ? demoAnswers(c, a) : {}
      n++
    }
    notes.push(`${c.name}: ${UPWARD_NAME}을(를) 상향평가 예시(영역 5개·배점 100)로 — 시연 응답 ${n}건 새 문항에 맞춤${userAnswered ? ', 사용자 응답이 있던 이전 문항은 사용 중지로 보존' : ''}`)
  }
  return notes
}

/**
 * v25 → v26 (D-187): 상향평가 = 팀원→팀장 + 팀원→임원 + 팀장→임원(사원·팀장 모두 소속 팀 임원을 평가, 임원 상향평가 점수 = 평균).
 * 준비·진행 회차에 upwardToExec를 켜고 새 배정(팀원·팀장 → 소속 팀 임원)을 만든다. 시연 응답은 새로 만든 배정에만(절반 제출 — 기존 배정·응답 그대로).
 * 임원 최종 반영 비율이 이전 예시(팀 KPI 60 + 상향평가 40 꺼짐) 그대로면 상향평가를 켜서 합계 100%. 마감·확정 회차는 그대로
 */
export function upwardExecV26(s: AppState): string[] {
  const notes: string[] = []
  for (const c of s.cycles) {
    if (!open(c)) continue
    const before = new Set(c.assignments.map((a) => a.id))
    if (!c.upwardToExec) { c.upwardToExec = true; notes.push(...syncUpward(s, c)) }
    const fresh = (a: Assignment) => !before.has(a.id)
    const made = c.assignments.filter((a) => a.direction === 'up' && fresh(a)).length
    const n = made ? upwardDemo(s, c, fresh) : 0
    if (made) notes.push(`${c.name}: 상향평가 팀원·팀장 → 임원 ${made}건 배정(시연 제출 ${n}건)`)
    const ex = c.finalBlendPlan?.exec
    if (ex && JSON.stringify(ex) === JSON.stringify(EXEC_BLEND_OLD())) { c.finalBlendPlan!.exec = [{ key: 'kpi', on: true, pct: 60 }, { key: 'upward', on: true, pct: 40 }]; notes.push(`${c.name}: 임원 최종 반영 비율 팀 KPI 60 / 상향평가 40(합계 100%)`) }
  }
  return notes
}
/** D-187 이전 임원 예시(팀 KPI 60·상향평가 40 꺼짐) */
export const EXEC_BLEND_OLD = (): NonNullable<Cycle['finalBlendPlan']>['exec'] => [{ key: 'kpi', on: true, pct: 60 }, { key: 'upward', on: false, pct: 40 }]

/**
 * 임원 상향평가표(D-189): 이 회차 참여 임원을 평가받는 사람으로 직접 선택한 평가표 버전(적용 평가 = 상향평가).
 * 임원은 대상자 명단에 없을 수 있어 직급이 아니라 사람으로 고른다. 이미 있으면(이름·평가표 ID) 그대로. 버전 목록에서는 팀원→팀장 평가표 바로 뒤
 */
export function ensureExecUpward(s: Pick<AppState, 'employees'>, c: Cycle): string | null {
  const id = `${c.id}-tpl-upward-exec`
  if (!c.versions) return null
  const has = c.versions.find((v) => v.templateId === id || (!v.archived && v.name === EXEC_UPWARD_NAME))
  if (has) return has.templateId
  if (!c.templates[id]) c.templates[id] = makeExecUpwardTemplate(id)
  const execs = upwardExecs(s, c).map((e) => e.id)
  const v = { templateId: id, name: EXEC_UPWARD_NAME, scope: { mode: 'custom' as const, rules: ['upward' as const], teams: 'all' as const, positions: 'all' as const, employees: execs } }
  const up = upwardTemplateOf(c)
  const at = c.versions.findIndex((x) => x.templateId === up)
  c.versions = at < 0 ? [...c.versions, v] : [...c.versions.slice(0, at + 1), v, ...c.versions.slice(at + 1)]
  return id
}

/**
 * v26 → v27 (D-189): 준비·진행 회차(임원 상향평가 있음)에 '임원 상향평가표' 버전을 만들고, 임원이 받는 상향평가를 이 평가표로.
 * 응답 없는 배정·시연 응답 배정만 바꾸고 시연 답은 새 문항으로 다시 만든다(제출·임시저장 상태 그대로). 사용자 응답 배정은 이전 평가표 그대로. 반복 실행 안전
 */
export function execUpwardFormV27(s: AppState): string[] {
  const notes: string[] = []
  for (const c of s.cycles) {
    if (!open(c) || !c.upwardToExec) continue
    const had = !!c.versions?.some((v) => v.templateId === `${c.id}-tpl-upward-exec` || v.name === EXEC_UPWARD_NAME)
    const id = ensureExecUpward(s, c)
    if (!id || had) continue
    const execs = new Set(upwardExecs(s, c).map((e) => e.id))
    let n = 0, kept = 0
    for (const a of c.assignments) {
      if (a.direction !== 'up' || !execs.has(a.targetId) || a.templateId === id) continue
      const r = s.responses[a.id]
      if (r && !r.demo) { kept++; continue }
      a.templateId = id
      if (r) { r.answers = r.status === 'submitted' ? demoAnswers(c, a) : {}; n++ }
    }
    notes.push(`${c.name}: ${EXEC_UPWARD_NAME} 추가(임원 ${execs.size}명 선택) — 임원 상향평가 연결, 시연 응답 ${n}건 새 문항에 맞춤${kept ? `, 사용자 응답 ${kept}건은 이전 평가표 그대로` : ''}`)
  }
  return notes
}

/**
 * v27 → v28 (D-191): 임원 상향평가 대상 = 소속 팀 임원 → 나를 임원평가하는 담당 임원(평가자 배정 기준).
 * 준비·진행 회차에서 짝이 바뀐 배정: 응답 없음·시연 응답만 있는 배정은 지우고(시연 응답도) 새 짝으로 만든 뒤 새 배정에만 시연 응답(절반 제출).
 * 사용자 응답이 있는 배정은 지우지 않고 보존·집계 제외(leadChanged). 팀원→팀장·마감·확정 회차 그대로, 반복 실행 안전
 */
export function execUpwardPairsV28(s: AppState): string[] {
  const notes: string[] = []
  for (const c of s.cycles) {
    if (!open(c) || !c.upwardToExec) continue
    const want = new Set(upwardPairs(s, c).map((p) => `${p.member}|${p.lead}`))
    const execs = new Set(upwardExecs(s, c).map((e) => e.id))
    let dropped = 0
    for (const a of c.assignments.filter((x) => x.direction === 'up' && !x.excluded && execs.has(x.targetId))) {
      if (want.has(`${a.evaluatorId}|${a.targetId}`)) continue
      const r = s.responses[a.id]
      if (r && !r.demo) continue // 사용자 응답은 syncUpward가 보존·집계 제외
      if (r) delete s.responses[a.id]
      c.assignments = c.assignments.filter((x) => x !== a); dropped++
    }
    const before = new Set(c.assignments.map((a) => a.id))
    notes.push(...syncUpward(s, c))
    const fresh = (a: Assignment) => !before.has(a.id)
    const made = c.assignments.filter((a) => a.direction === 'up' && fresh(a)).length
    const n = made ? upwardDemo(s, c, fresh) : 0
    if (dropped || made) notes.push(`${c.name}: 임원 상향평가를 담당 임원 기준으로 — 이전 짝 ${dropped}건 정리, 새 짝 ${made}건(시연 제출 ${n}건)`)
  }
  return notes
}

/**
 * v28 → v29 (D-208): 시연 화면(진행 현황 상향평가 칸)이 'x/y 완료' 글자로 가득하지 않게 — 진행 중 평가의 응답 없는 상향평가에 시연 제출을 넣는다.
 * 그대로 두는 것: 시연 '작성 중'(임시저장), 사용자 응답, 시연 팀장(e10)이 받는 팀원→팀장평가의 미제출 한 건(D-121 시연 구성), 준비·마감·확정 회차. 반복 실행 안전
 */
export function upwardDemoMoreV29(s: AppState): string[] {
  const notes: string[] = []
  const at = '2026-10-28T00:00:00.000Z'
  const no = (id: string) => s.employees.find((e) => e.id === id)?.empNo ?? ''
  for (const c of s.cycles) {
    if (c.status !== '진행') continue
    const ups = c.assignments.filter((a) => a.direction === 'up' && !a.excluded)
    const toE10 = ups.filter((a) => a.targetId === 'e10').sort((a, b) => no(b.evaluatorId).localeCompare(no(a.evaluatorId), 'ko', { numeric: true }))
    const keep = toE10.find((a) => !s.responses[a.id])?.id // D-121: 5/6처럼 한 건은 미제출로
    let n = 0
    for (const a of ups) {
      if (s.responses[a.id] || a.id === keep) continue
      s.responses[a.id] = { assignmentId: a.id, answers: demoAnswers(c, a), status: 'submitted', savedAt: at, submittedAt: at, lang: 'ko', demo: true }
      n++
    }
    if (n) notes.push(`${c.name}: 응답 없는 상향평가 ${n}건 시연 제출(시연 화면 정리)`)
  }
  return notes
}
