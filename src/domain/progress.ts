// 진행 단계 잠금·상태 집계. 잠금 정책은 회사 확정 전 "검토용 가정"(docs/open-questions.md Q-01, Q-02).
//
// 집계 단위 (docs/requirements.md PRG-03):
//  - 모든 카드·표는 "대상자" 단위로 센다. 한 대상자의 한 단계에 배정이 여러 건이면 모두 제출되어야 그 단계 완료.
//  - 대상자 = 선택 회차에 포함되고, 현재 재직(활성)이며 평가 제외가 아닌 사람.
//  - "해당 없음"(그 대상자의 경로에 없는 단계)은 분모·미완료 어디에도 넣지 않는다.
//  - 대표자 최종 확정은 제출 진행과 별개 업무라서 집계에 넣지 않는다.
import type { AppState, Assignment, Cycle, Employee, EvaluatorRule, Response, Stage, TargetSnapshot } from './types'

export type CellStatus = 'na' | 'unassigned' | 'locked' | 'notStarted' | 'draft' | 'submitted'
export const CELL_LABEL: Record<CellStatus, string> = {
  na: '해당 없음',
  unassigned: '평가자 미지정',
  locked: '대기',
  notStarted: '미시작',
  draft: '작성 중',
  submitted: '완료',
}
export const CELL_ICON: Record<CellStatus, string> = { na: '—', unassigned: '⚠', locked: '…', notStarted: '○', draft: '✎', submitted: '✓' }
export const CELL_HELP: Record<CellStatus, string> = {
  na: '이 대상자의 평가 경로에 없는 단계입니다',
  unassigned: '이 단계를 평가할 사람이 배정되지 않았습니다. 회차·배정 메뉴에서 확인하세요',
  locked: '앞 단계가 제출되면 작성할 수 있습니다',
  notStarted: '작성할 수 있지만 아직 시작하지 않았습니다',
  draft: '임시저장만 되어 있고 제출되지 않았습니다',
  submitted: '제출 완료',
}

type Responses = Record<string, Response>

/** 집계·작성에 쓰는 배정: 상향평가(과거)와 제외 표시된 배정(임원 자기평가 등)은 뺀다 */
export const isActiveAssignment = (a: Assignment) => a.direction !== 'up' && !a.excluded

export function statusOf(responses: Responses, assignmentId: string): 'notStarted' | 'draft' | 'submitted' {
  const r = responses[assignmentId]
  return r ? r.status : 'notStarted'
}

// ── 고정 단계 번호 (D-068) ─────────────────────────────
// 단계 번호는 평가 유형을 뜻한다: 1 = 본인 자기평가, 2 = 팀장이 사원 평가, 3 = 임원이 팀장·사원 평가.
// 사람마다 압축해서 다시 매기지 않는다(팀장의 임원평가도 3단계).
export const STAGE_OF_RULE: Record<EvaluatorRule, number> = { self: 1, teamLead: 2, executive: 3 }
export const EXEC_PATH: Stage[] = [{ order: 1, label: '자기평가', direction: 'self', rule: 'self' }]

type PathTarget = Pick<TargetSnapshot, 'isTeamLead' | 'isExecutive'>
/** 대상자 유형별 경로: 임원 → 자기평가만 / 팀장 → 자기평가·임원평가 / 사원 → 자기·팀장·임원평가 */
export function pathFor(cycle: Cycle, target: PathTarget): Stage[] {
  if (target.isExecutive) return cycle.path.exec ?? EXEC_PATH
  return target.isTeamLead ? cycle.path.lead : cycle.path.member
}

/** 자기평가(1단계) 적용 여부: 사원은 항상, 팀장·임원은 회차별 설정(없으면 팀장 켬·임원 끔) */
export function selfApplies(cycle: Cycle, target: PathTarget & Pick<TargetSnapshot, 'employeeId'>): boolean {
  // 회차 설정값이 있으면 그 값(D-077: 현재 팀장이 회차 시작 때 사원이었어도 설정이 적용되게). 없으면 사원·팀장 켬, 임원 끔.
  // 현재 사원은 설정 화면에 스위치가 없고 저장 시 항상 켬으로 맞춘다(applyParticipation·selfForStaff)
  return cycle.selfEval?.[target.employeeId] ?? !target.isExecutive
}

/** 이 대상자에게 실제로 적용되는 단계 (경로의 단계 중 끈 자기평가 제외) */
export function appliedStages(cycle: Cycle, target: TargetSnapshot): Stage[] {
  return pathFor(cycle, target).filter((st) => st.rule !== 'self' || selfApplies(cycle, target))
}

export function stageAssignments(cycle: Cycle, targetId: string, order: number): Assignment[] {
  return cycle.assignments.filter((a) => a.targetId === targetId && a.stageOrder === order && isActiveAssignment(a))
}

/** 선행 단계가 모두 제출되었는가 */
export function isUnlocked(cycle: Cycle, responses: Responses, a: Assignment): boolean {
  const earlier = cycle.assignments.filter(
    (x) => isActiveAssignment(x) && x.stageOrder < a.stageOrder && (cycle.path.gating === 'allTargets' || x.targetId === a.targetId),
  )
  return earlier.every((x) => statusOf(responses, x.id) === 'submitted')
}

export function assignmentCell(cycle: Cycle, responses: Responses, a: Assignment): CellStatus {
  const s = statusOf(responses, a.id)
  if (s !== 'notStarted') return s
  return isUnlocked(cycle, responses, a) ? 'notStarted' : 'locked'
}

export interface StageCell { order: number; label: string; status: CellStatus }

export function targetCells(cycle: Cycle, responses: Responses, target: TargetSnapshot, maxStages: number): StageCell[] {
  const path = pathFor(cycle, target)
  const cells: StageCell[] = []
  for (let order = 1; order <= maxStages; order++) {
    const stage = path.find((s) => s.order === order)
    // 경로에 없는 단계(팀장 2단계, 임원 2·3단계), 끈 자기평가 → 해당 없음
    if (!stage || (stage.rule === 'self' && !selfApplies(cycle, target))) { cells.push({ order, label: '', status: 'na' }); continue }
    const as = stageAssignments(cycle, target.employeeId, order)
    if (as.length === 0) { cells.push({ order, label: stage.label, status: 'unassigned' }); continue }
    const sts = as.map((a) => assignmentCell(cycle, responses, a))
    const status: CellStatus = sts.every((s) => s === 'submitted')
      ? 'submitted'
      : sts.some((s) => s === 'draft' || s === 'submitted')
        ? 'draft'
        : sts.every((s) => s === 'locked') ? 'locked' : 'notStarted'
    cells.push({ order, label: stage.label, status })
  }
  return cells
}

/** 해당 없음을 뺀 필요한 단계가 모두 제출되었는가. 평가자 미지정 단계가 있으면 미완료. */
export function targetSummary(cells: StageCell[]): { done: number; total: number; complete: boolean } {
  const needed = cells.filter((c) => c.status !== 'na')
  const done = needed.filter((c) => c.status === 'submitted').length
  return { done, total: needed.length, complete: needed.length > 0 && done === needed.length }
}

export function maxStageCount(cycle: Cycle): number {
  return Math.max(0, ...cycle.path.member.map((s) => s.order), ...cycle.path.lead.map((s) => s.order), ...(cycle.path.exec ?? EXEC_PATH).map((s) => s.order))
}

/**
 * 집계 대상 = 회차에 포함 + 재직(활성) + 평가 제외 아님 + 본인이 받는 평가가 하나 이상 (D-068).
 * 임원은 기본이 "평가 제외"라도 자기평가를 켜서 회차에 넣었으면 대상. 받는 평가가 없는 평가자 전용 임원은 대상이 아니다.
 */
export function activeTargets(cycle: Cycle, employees: Employee[]): TargetSnapshot[] {
  return cycle.targets.filter((t) => {
    const e = employees.find((x) => x.id === t.employeeId)
    return !!e && e.active && (!e.evalExcluded || !!t.isExecutive) && appliedStages(cycle, t).length > 0
  })
}

// ── 진행 현황 = 작성자 기준 (D-071, D-069의 "평가받는 사람 ∪ 평가자"를 대체) ─────────
// 한 행 = 선택 회차에서 활성 작성 배정이 하나라도 있는 직원(평가자 ID 기준, 중복 없음).
// 단계 칸 = 그 직원이 "작성할" 업무: 1 = 본인 자기평가, 2 = 팀장으로서 사원 평가, 3 = 임원으로서 사원·팀장 평가.
// 그 직원이 다른 사람에게 평가받는 상태는 여기에 넣지 않는다(상세의 "평가받는 현황"으로만). 이 기준을 대상자 기준으로 되돌리지 않는다.
// 배정의 평가 유형(경로 규칙)과 평가자 ID로만 센다 — 직급 글자로 평가를 만들거나 숨기지 않는다.

export interface WriteSummary { total: number; done: number; open: number; locked: number }
export interface WriterRow {
  t: TargetSnapshot // 표시 정보: 회차 스냅샷(대상자이기도 하면) 또는 현재 조직 기준
  stages: WriteSummary[] // [1단계, 2단계, 3단계] 작성 업무
  total: WriteSummary // 전체 작성 업무(자기평가 포함, 배정 하나는 한 번만)
  complete: boolean // 배정된 모든 작성 업무 제출(업무 0건은 참여자가 아님)
  mismatch: boolean // 현재 직급과 실제 배정 유형이 다름(2단계 작성인데 팀장 아님, 3단계 작성인데 임원 아님) — 업무는 그대로 표시
  tier: '임원' | '팀장' | '사원' // 현재 조직 관리 기준 직급(D-072). 회차 스냅샷의 팀장 여부와 다를 수 있다
}

/** 활성 작성 배정: 상향·제외 표시 배정, 집계 대상이 아닌(퇴사·평가 제외·적용 안 되는 단계의) 대상자 배정은 뺀다 = 취소된 배정 */
export function activeWriteAssignments(cycle: Cycle, employees: Employee[]): Assignment[] {
  const ids = new Set(activeTargets(cycle, employees).map((t) => t.employeeId))
  return cycle.assignments.filter((a) => isActiveAssignment(a) && ids.has(a.targetId))
}

/** 배정의 작성 단계(평가 유형 기준): 자기평가 1, 팀장평가 2, 임원평가 3 */
export function writeStageOf(cycle: Cycle, a: Assignment): number {
  if (a.direction === 'self') return 1
  const t = cycle.targets.find((x) => x.employeeId === a.targetId)
  const rule = t ? pathFor(cycle, t).find((st) => st.order === a.stageOrder)?.rule : undefined
  return rule ? STAGE_OF_RULE[rule] : a.stageOrder
}

const summarize = (cycle: Cycle, responses: Responses, as: Assignment[]): WriteSummary => {
  const done = as.filter((a) => statusOf(responses, a.id) === 'submitted').length
  return { total: as.length, done, open: as.length - done, locked: as.filter((a) => assignmentCell(cycle, responses, a) === 'locked').length }
}

export function writerRows(s: Pick<AppState, 'employees' | 'teams' | 'responses'>, cycle: Cycle): WriterRow[] {
  const all = activeWriteAssignments(cycle, s.employees)
  const ids = [...new Set(all.map((a) => a.evaluatorId))]
  const rows: WriterRow[] = []
  for (const id of ids) {
    const e = s.employees.find((x) => x.id === id)
    if (!e || !e.active) continue // 퇴사(삭제) 처리된 평가자는 명단에 넣지 않음
    const mine = all.filter((a) => a.evaluatorId === id)
    const snap = cycle.targets.find((x) => x.employeeId === id) ?? {
      employeeId: e.id, name: e.name, empNo: e.empNo, companyName: '', departmentId: e.teamId,
      departmentName: s.teams.find((x) => x.id === e.teamId)?.name ?? '', teamName: s.teams.find((x) => x.id === e.teamId)?.name ?? '',
      position: e.position, jobType: e.jobType, isTeamLead: s.teams.some((x) => !x.archived && x.leadId === e.id), isExecutive: e.isExecutive || e.isCeo,
    }
    const stages = [1, 2, 3].map((o) => summarize(cycle, s.responses, mine.filter((a) => writeStageOf(cycle, a) === o)))
    const total = summarize(cycle, s.responses, mine)
    const tier = e.isExecutive || e.isCeo ? '임원' : s.teams.some((x) => !x.archived && x.leadId === e.id) ? '팀장' : '사원'
    const mismatch = (stages[1].total > 0 && tier !== '팀장') || (stages[2].total > 0 && tier !== '임원')
    rows.push({ t: snap, stages, total, complete: total.total > 0 && total.open === 0, mismatch, tier })
  }
  return rows
}

// ── 진행 현황 표 = 받는 평가 + 작성 업무 (D-076, D-071 "모든 행 작성자 기준"을 대체) ─────────
// 열: 자기평가(1)·팀장평가(2)·임원평가(3) — 내부 단계 번호·순차 규칙은 그대로, 화면 열 이름만.
//  - 사원: 세 칸 모두 본인이 "받는" 평가 상태(완료/미완료, 적용 안 됨 —). 선행 대기·평가자 미지정도 미완료.
//  - 팀장: 자기평가 = 받는 상태(켰을 때), 팀장평가 = 본인이 "작성할" 사원 평가 건수, 임원평가 = 받는 상태.
//  - 임원: 자기평가 = 받는 상태(켰을 때), 팀장평가 —, 임원평가 = 본인이 "작성할" 평가 건수.
// 직급은 현재 조직 기준(D-072). 직급과 맞지 않는 남은 작성 업무(예: 이전 팀장)는 표에 끼워 넣지 않고
// 업무 완료·미완료만·상세에 반영하고 "배정 확인"으로 표시한다.
export type ProgressCell = { kind: 'recv'; status: CellStatus } | { kind: 'write'; w: WriteSummary } | { kind: 'na' }
export interface ProgressRow {
  t: TargetSnapshot
  tier: '임원' | '팀장' | '사원'
  cells: ProgressCell[] // [자기평가, 팀장평가, 임원평가]
  recv: StageCell[] // 본인이 받는 단계(대상자가 아니면 모두 해당 없음)
  writes: WriterRow | null // 본인이 작성할 업무(없으면 null)
  complete: boolean // 받는 평가(적용 단계, 평가자 미지정은 미완료) + 작성 업무 모두 제출
  mismatch: boolean
}

export function progressRows(s: Pick<AppState, 'employees' | 'teams' | 'responses'>, cycle: Cycle): ProgressRow[] {
  const targets = activeTargets(cycle, s.employees)
  const writers = new Map(writerRows(s, cycle).map((r) => [r.t.employeeId, r]))
  const ids = [...new Set([...targets.map((t) => t.employeeId), ...writers.keys()])]
  const rows: ProgressRow[] = []
  for (const id of ids) {
    const e = s.employees.find((x) => x.id === id)
    if (!e || !e.active) continue
    const t = targets.find((x) => x.employeeId === id)
    const w = writers.get(id) ?? null
    const snap = t ?? w!.t
    const tier: ProgressRow['tier'] = e.isExecutive || e.isCeo ? '임원' : s.teams.some((x) => !x.archived && x.leadId === e.id) ? '팀장' : '사원'
    const recv = t ? targetCells(cycle, s.responses, t, 3) : [1, 2, 3].map((order) => ({ order, label: '', status: 'na' as CellStatus }))
    const r = (i: number): ProgressCell => (recv[i].status === 'na' ? { kind: 'na' } : { kind: 'recv', status: recv[i].status })
    const wc = (i: number): ProgressCell => (w && w.stages[i].total > 0 ? { kind: 'write', w: w.stages[i] } : { kind: 'na' })
    const cells: ProgressCell[] = tier === '임원' ? [r(0), { kind: 'na' }, wc(2)] : tier === '팀장' ? [r(0), wc(1), r(2)] : [r(0), r(1), r(2)]
    const recvOk = recv.every((c) => c.status === 'na' || c.status === 'submitted')
    const writeOk = !w || w.total.open === 0
    const has = recv.some((c) => c.status !== 'na') || !!w
    // 직급과 맞지 않는 작성 업무가 남아 있음(표에는 넣지 않음) — 2단계 작성인데 팀장 아님, 3단계 작성인데 임원 아님
    const mismatch = !!w && ((w.stages[1].total > 0 && tier !== '팀장') || (w.stages[2].total > 0 && tier !== '임원'))
    rows.push({ t: snap, tier, cells, recv, writes: w, complete: has && recvOk && writeOk, mismatch })
  }
  return rows
}

/** 카드(모두 사람 수, 회차 전체 기준): 참여자 / 업무 완료 / 자기평가 제출 / 팀장평가를 모두 쓴 팀장 / 임원평가를 모두 쓴 임원 */
export function progressCounts(rows: ProgressRow[]) {
  const selfDue = rows.filter((r) => r.recv[0].status !== 'na')
  // 팀장평가 = 현재 팀장 중 사원 평가 배정이 있는 사람, 임원평가 = 현재 임원 중 임원평가 배정이 있는 사람(표의 작성 칸과 같은 사람)
  const by = (i: number) => { const w = rows.filter((r) => r.tier === (i === 1 ? '팀장' : '임원') && r.writes && r.writes.stages[i].total > 0); return { writers: w.length, done: w.filter((r) => r.writes!.stages[i].open === 0).length } }
  return {
    participants: rows.length,
    complete: rows.filter((r) => r.complete).length,
    byStage: [
      { order: 1, writers: selfDue.length, done: selfDue.filter((r) => r.recv[0].status === 'submitted').length },
      { order: 2, ...by(1) },
      { order: 3, ...by(2) },
    ],
  }
}

/**
 * 표 필터: 1단계 카드 = 자기평가를 아직 제출하지 않은 사람, 2·3단계 카드 = 그 단계 담당 평가가 한 건이라도 남은 사람
 * (다른 단계 완료 여부는 보지 않음). 업무 완료 카드 = complete. 미완료만 = 단계 선택 중이면 그 단계, 아니면 !complete
 */
export function progressFilter(r: ProgressRow, pick: CardPick, onlyOpen: boolean): boolean {
  if (pick?.kind === 'stage') return pick.order === 1 ? r.recv[0].status !== 'na' && r.recv[0].status !== 'submitted' : r.tier === (pick.order === 2 ? '팀장' : '임원') && !!r.writes && r.writes.stages[pick.order - 1].open > 0
  if (pick?.kind === 'complete' && !r.complete) return false
  return !onlyOpen || !r.complete
}

/** 카드(모두 사람 수): 참여자 / 업무 완료 / n단계 = 그 단계 작성 업무를 모두 제출한 사람 / 그 단계 작성 업무가 있는 사람 */
export function writerCounts(rows: WriterRow[]) {
  return {
    participants: rows.length,
    complete: rows.filter((r) => r.complete).length,
    byStage: [0, 1, 2].map((i) => ({ order: i + 1, writers: rows.filter((r) => r.stages[i].total > 0).length, done: rows.filter((r) => r.stages[i].total > 0 && r.stages[i].open === 0).length })),
  }
}

/**
 * 작성자 행 필터.
 *  - n단계 카드: 그 단계 작성 업무 중 하나라도 미제출(선행 대기 포함)
 *  - 평가 업무 완료 카드: 배정된 작성 업무를 모두 제출
 *  - 미완료만: 단계 카드 선택 중이면 그 단계 기준(카드가 이미 적용), 아니면 작성 업무가 하나라도 미제출
 */
export function writerFilter(r: WriterRow, pick: CardPick, onlyOpen: boolean): boolean {
  if (pick?.kind === 'stage') return r.stages[pick.order - 1]?.open > 0
  if (pick?.kind === 'complete' && !r.complete) return false
  return !onlyOpen || !r.complete
}

export interface CycleCounts {
  targets: number
  completeTargets: number
  byStage: { order: number; assigned: number; submitted: number }[] // 대상자 단위
  assignments: number // 회차 목록 화면용 (배정 건수)
  submittedAssignments: number
}

export function cycleCounts(cycle: Cycle, responses: Responses, employees: Employee[]): CycleCounts {
  const max = maxStageCount(cycle)
  const ts = activeTargets(cycle, employees)
  const cells = ts.map((t) => targetCells(cycle, responses, t, max))
  const byStage = Array.from({ length: max }, (_, i) => {
    const col = cells.map((c) => c[i])
    const assigned = col.filter((c) => c.status !== 'na') // 평가자 미지정도 분모에 넣는다(미완료) — 숨기지 않고 배정에서 해결 (D-068)
    return { order: i + 1, assigned: assigned.length, submitted: assigned.filter((c) => c.status === 'submitted').length }
  })
  const ids = new Set(ts.map((t) => t.employeeId))
  const as = cycle.assignments.filter((a) => ids.has(a.targetId) && isActiveAssignment(a))
  return {
    targets: ts.length,
    completeTargets: cells.filter((c) => targetSummary(c).complete).length,
    byStage,
    assignments: as.length,
    submittedAssignments: as.filter((a) => statusOf(responses, a.id) === 'submitted').length,
  }
}

export type TodoStatus = 'notStarted' | 'draft' | 'locked'
export const TODO_LABEL: Record<TodoStatus, string> = { notStarted: '미시작', draft: '작성 중', locked: '선행 단계 대기' }

/**
 * 한 직원이 "평가자로서" 아직 제출하지 않은 평가 (관리자 상세의 "미완료 평가", D-050).
 * 그 직원이 평가받는 단계 상태와는 별개 — evaluatorId(내부 ID)로만 찾는다.
 * 제외: 제출 완료, 상향평가(과거 데이터), 집계 대상에서 빠진 대상자(퇴사·평가 제외)의 배정.
 * 취소 상태 필드는 따로 없으므로 "대상에서 빠진 배정"을 취소된 배정으로 본다.
 */
export function evaluatorTodo(cycle: Cycle, responses: Responses, employees: Employee[], evaluatorId: string): { a: Assignment; status: TodoStatus }[] {
  const ids = new Set(activeTargets(cycle, employees).map((t) => t.employeeId))
  return cycle.assignments
    .filter((a) => a.evaluatorId === evaluatorId && isActiveAssignment(a) && ids.has(a.targetId) && statusOf(responses, a.id) !== 'submitted')
    .map((a) => ({ a, status: assignmentCell(cycle, responses, a) as TodoStatus }))
    .sort((x, y) => Number(y.a.direction === 'self') - Number(x.a.direction === 'self') || x.a.stageOrder - y.a.stageOrder ||
      (cycle.targets.find((t) => t.employeeId === x.a.targetId)?.name ?? '').localeCompare(cycle.targets.find((t) => t.employeeId === y.a.targetId)?.name ?? '', 'ko'))
}

// ── 진행 현황 카드 필터 (D-057 → D-068) ─────────────────
/** 카드 선택: 평가 대상자 / 모든 단계 완료 / n단계(미완료) / 없음 */
export type CardPick = { kind: 'stage'; order: number } | { kind: 'complete' } | { kind: 'all' } | null

/** 그 단계가 적용되는 대상자인가 (카드 분모와 같은 기준: 해당 없음만 제외, 평가자 미지정은 포함) */
export const inStage = (cells: StageCell[], order: number) => {
  const c = cells.find((x) => x.order === order)
  return !!c && c.status !== 'na'
}

/**
 * 평가받는 대상자 기준 행 필터(받는 단계 셀). 진행 현황 화면은 작성자 기준 writerFilter를 쓴다(D-071).
 *  - n단계 카드: 그 단계가 적용되는데 아직 완료되지 않은 대상자(다른 단계·작성 업무는 보지 않음, 선행 대기도 포함)
 *  - 평가 업무 완료 카드: 받는 단계와 작성할 평가가 모두 완료된 참여자
 *  - "미완료만": 단계 카드 선택 중이면 그 단계 기준(카드가 이미 적용), 아니면 받는 단계 또는 작성할 평가 중 하나라도 미완료
 */
export function cardFilter(row: { cells: StageCell[]; complete: boolean }, pick: CardPick, onlyOpen: boolean): boolean {
  const { cells } = row
  if (pick?.kind === 'stage') return inStage(cells, pick.order) && cells.find((x) => x.order === pick.order)!.status !== 'submitted'
  if (pick?.kind === 'complete' && !row.complete) return false
  return !onlyOpen || !row.complete
}

/** 마감·확정 회차 = 작성 종료(D-093). 관리자가 저장한 회차 상태(같은 회차 ID)만 본다 — 이름·연도·날짜로 추측하지 않음. 응답 상태는 바꾸지 않는다 */
export const cycleClosed = (c: Pick<Cycle, 'status'> | undefined | null) => !!c && (c.status === '마감' || c.status === '확정')
