// 팀원 → 팀장평가 (D-114). 사원(평가자)이 소속 팀의 현재 팀장(대상자)을 평가한다.
// - 배정: direction 'up', 1단계로 분류(stageOrder 1). 경로(path) 단계가 아니어서 점수·단계 반영 비율·순차 잠금·임원평가 담당에는 영향 없음
//   (isActiveAssignment가 'up'을 빼므로 기존 집계는 그대로, 진행 현황·내 평가·상세는 isUpward로 따로 보여 준다)
// - 대상: 준비·진행 회차의 참여 사원(평가 제외·임원·팀장 아님) × 그 사원 팀의 현재 팀장(회차 참여자). 팀장이 없거나 참여하지 않으면 배정 없음
// - 조직이 바뀌면 응답 없는 배정은 정리·새로 만들고, 응답 있는 배정은 지우지 않고 'leadChanged'로 보존(작성자·응답 그대로)
// - 평가표: 평가표 버전 '팀원→팀장 평가표'(공통 기본, 적용 평가 = 팀원→팀장평가). 이 평가표가 있는 회차에서만 배정을 만든다
//   (저장 데이터 v18 변환·새 평가 만들기·복제에서 만든다 — 그 이전 변환 단계의 배정 맞추기에서는 만들지 않음)
import type { AppState, Assignment, Cycle } from './types'
import { makeUpwardTemplate, UPWARD_NAME } from './templates'
import { liveVersions, resolveVersion } from './versions'
import { demoAnswers } from './demoV15'

const open = (c: Pick<Cycle, 'status'>) => c.status === '준비' || c.status === '진행'

/** 이 회차의 팀원→팀장평가 평가표 ID — 없으면 평가표·버전을 만든다 */
export function ensureUpwardTemplate(c: Cycle): string {
  const id = `${c.id}-tpl-upward`
  const v = liveVersions(c).find((x) => x.scope.mode === 'all' && x.scope.rules.includes('upward'))
  if (v) return v.templateId
  if (!c.templates[id]) c.templates[id] = makeUpwardTemplate(id)
  if (c.versions) c.versions = [...c.versions, { templateId: id, name: UPWARD_NAME, scope: { mode: 'all', rules: ['upward'], teams: 'all', positions: 'all' } }]
  return id
}

/** 이 회차의 팀원→팀장평가 평가표(없으면 null = 이 회차는 팀원→팀장평가 없음) */
export function upwardTemplateOf(c: Cycle): string | null {
  const v = liveVersions(c).find((x) => x.scope.mode === 'all' && x.scope.rules.includes('upward'))
  return v?.templateId ?? (c.templates[`${c.id}-tpl-upward`] ? `${c.id}-tpl-upward` : null)
}

/** 있어야 할 (사원 → 팀장) 쌍 */
export function upwardPairs(s: Pick<AppState, 'employees' | 'teams'>, c: Cycle): { member: string; lead: string }[] {
  const out: { member: string; lead: string }[] = []
  const emp = (id: string) => s.employees.find((e) => e.id === id)
  const inCycle = new Set(c.targets.map((t) => t.employeeId))
  for (const t of c.targets) {
    const e = emp(t.employeeId)
    if (!e || !e.active || e.evalExcluded || e.isExecutive || e.isCeo || t.isExecutive) continue
    if (s.teams.some((x) => !x.archived && x.leadId === e.id)) continue // 현재 팀장은 평가자가 아님
    const lead = s.teams.find((x) => x.id === e.teamId && !x.archived)?.leadId
    const le = lead ? emp(lead) : undefined
    if (!lead || lead === e.id || !le?.active || !inCycle.has(lead)) continue
    out.push({ member: e.id, lead })
  }
  return out
}

/** 준비·진행 회차의 팀원→팀장평가 배정을 현재 조직·참여자에 맞춘다. 다시 실행해도 바뀌는 것이 없다 */
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
    if (s.responses[a.id]) { a.excluded = 'leadChanged'; notes.push(`${c.name}: 팀원→팀장평가 ${name(a.evaluatorId)} → ${name(a.targetId)} 응답 보존·집계 제외(팀장·참여 변경)`) }
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
    const base = `${c.id}-u-${p.member}`
    const id = c.assignments.some((a) => a.id === base) ? `${base}-${p.lead}` : base
    const t = c.targets.find((x) => x.employeeId === p.lead)
    const r = resolveVersion(c, { rule: 'upward', teamId: t?.departmentId || undefined, positionId: t?.positionId, employeeId: p.lead })
    c.assignments.push({ id, targetId: p.lead, evaluatorId: p.member, direction: 'up', stageOrder: 1, templateId: r.templateId ?? tpl })
  }
  return notes
}

/**
 * 시연 응답(목업): 응답이 없는 팀원→팀장평가의 절반 정도를 제출, 일부는 임시저장 — 사원 사번 순으로 번갈아.
 * 이미 응답(사용자 기록 포함)이 있는 배정은 건드리지 않는다
 */
export function upwardDemo(s: AppState, c: Cycle): number {
  if (!open(c)) return 0
  const at = '2026-10-28T00:00:00.000Z'
  const no = (id: string) => s.employees.find((e) => e.id === id)?.empNo ?? id
  const list = c.assignments.filter((a) => a.direction === 'up' && !a.excluded).sort((a, b) => no(a.evaluatorId).localeCompare(no(b.evaluatorId), 'ko', { numeric: true }))
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
