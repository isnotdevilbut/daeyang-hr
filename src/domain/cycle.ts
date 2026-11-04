// 회차 생성·대상자 스냅샷·평가 배정. 진행 경로 프리셋은 모두 "검토용 가정".
import type { AppState, Assignment, Cycle, Employee, PathPolicy, Stage, TargetSnapshot, Template } from './types'
import { DRAFT_ID } from './templates'
import { templateFor } from './catalog'
import { ensureExecUpward, ensureUpwardTemplate, syncUpward } from './upward'
import { applyVersions, ensureVersions } from './versions'
import { cycleExecs, distributeExecs } from './execPlan'

export { cycleExecs }
import { appliedStages, EXEC_PATH, isActiveAssignment, selfApplies } from './progress'

// 단계 번호 = 평가 유형 (D-068): 1 자기평가 · 2 팀장평가 · 3 임원평가. 경로에 없는 번호는 "해당 없음"으로 비워 둔다
export const PATH_PRESETS: { id: string; label: string; desc: string; member: Stage[]; lead: Stage[] }[] = [
  {
    id: 'A',
    label: '가정 A: 자기 → 팀장 → 임원 (팀장 대상: 자기 → 임원)',
    desc: '10/14 메모의 과거 3단계(사원→팀장→임원)를 참고한 검토용 가정',
    member: [
      { order: 1, label: '자기평가', direction: 'self', rule: 'self' },
      { order: 2, label: '팀장평가', direction: 'down', rule: 'teamLead' },
      { order: 3, label: '임원평가', direction: 'down', rule: 'executive' },
    ],
    lead: [
      { order: 1, label: '자기평가', direction: 'self', rule: 'self' },
      { order: 3, label: '임원평가', direction: 'down', rule: 'executive' },
    ],
  },
  {
    id: 'B',
    label: '가정 B: 자기 → 임원 (2025 관리직 양식 칸 구성 참고)',
    desc: '2025 관리직 양식에 팀장평가 칸이 없는 점을 참고한 검토용 가정',
    member: [
      { order: 1, label: '자기평가', direction: 'self', rule: 'self' },
      { order: 3, label: '임원평가', direction: 'down', rule: 'executive' },
    ],
    lead: [
      { order: 1, label: '자기평가', direction: 'self', rule: 'self' },
      { order: 3, label: '임원평가', direction: 'down', rule: 'executive' },
    ],
  },
  {
    id: 'C',
    label: '가정 C: 자기 → 팀장 (임원평가 없음)',
    desc: "10/14 '임원평가는 없다' 발언을 참고한 검토용 가정",
    member: [
      { order: 1, label: '자기평가', direction: 'self', rule: 'self' },
      { order: 2, label: '팀장평가', direction: 'down', rule: 'teamLead' },
    ],
    lead: [{ order: 1, label: '자기평가', direction: 'self', rule: 'self' }],
  },
]

export function makePath(presetId: string): PathPolicy {
  const p = PATH_PRESETS.find((x) => x.id === presetId) ?? PATH_PRESETS[0]
  return { member: structuredClone(p.member), lead: structuredClone(p.lead), exec: structuredClone(EXEC_PATH), gating: 'perTarget', isAssumption: true }
}

export const isTeamLead = (s: AppState, empId: string) => s.teams.some((t) => t.leadId === empId)

/** 이전 구조의 내부 회사 ID (팀 → 옛 부서 → 회사). 새 팀에는 없음 */
function companyOf(s: AppState, e: Employee): string | undefined {
  const dept = s.departments.find((d) => d.id === s.teams.find((t) => t.id === e.teamId)?.departmentId)
  return dept?.companyId
}

export function orgOf(s: AppState, e: Employee) {
  return { team: s.teams.find((t) => t.id === e.teamId) }
}

export function snapshotTarget(s: AppState, e: Employee): TargetSnapshot {
  const { team } = orgOf(s, e)
  return {
    employeeId: e.id,
    name: e.name,
    empNo: e.empNo,
    companyName: '',
    departmentId: team?.id ?? '', // 조직 단위 = 팀 (D-065)
    departmentName: team?.name ?? '',
    teamName: team?.name ?? '',
    position: e.position,
    jobType: e.jobType,
    isTeamLead: isTeamLead(s, e.id),
    isExecutive: e.isExecutive,
    positionId: e.positionId,
  }
}

/** 평가자 규칙 → 실제 평가자. 본인을 후속 평가자로 지정하지 않는다. */
export function resolveEvaluator(s: AppState, e: Employee, rule: Stage['rule'], cycle?: Pick<Cycle, 'execOff'>): string | null {
  if (rule === 'self') return e.id
  const { team } = orgOf(s, e)
  if (rule === 'teamLead') return team?.leadId && team.leadId !== e.id ? team.leadId : null
  // 같은 직무의 임원, 없으면 첫 임원. 화면에는 회사 구분이 없고(D-017·D-065), 이전 데이터의 팀에 남은 내부 회사 정보가
  // 양쪽 모두 있을 때만 같은 회사 임원으로 좁힌다 — 이전 구조로 만든 배정과 같은 결과를 내기 위한 호환
  const company = companyOf(s, e)
  const off = new Set(cycle?.execOff ?? []) // 이 회차에 참여하지 않는 임원은 고르지 않음 (D-072)
  const execs = s.employees.filter((x) => x.active && x.isExecutive && !off.has(x.id) && x.id !== e.id && (!company || !companyOf(s, x) || companyOf(s, x) === company))
  return (execs.find((x) => x.jobType === e.jobType) ?? execs[0])?.id ?? null
}

export function eligibleTargets(s: AppState): Employee[] {
  return s.employees.filter((e) => e.active && !e.evalExcluded && !e.isCeo)
}

let seq = 0
const aid = (cycleId: string) => `${cycleId}-a${++seq}-${Math.random().toString(36).slice(2, 6)}`

/** oneExec: 원래 시연 데이터 생성용(임원평가를 같은 직무 임원 한 명에게) — 시연 응답 지문(D-079)이 그대로 재현되도록. 그 밖에는 임원 전원 (D-081) */
export function buildAssignments(s: AppState, cycle: Cycle, oneExec = false): Assignment[] {
  const out: Assignment[] = []
  for (const t of cycle.targets) {
    const e = s.employees.find((x) => x.id === t.employeeId)
    if (!e) continue
    const templateId = templateFor(cycle, t.jobType)
    for (const st of appliedStages(cycle, t)) { // 끈 자기평가는 만들지 않는다 (D-068)
      if (st.rule === 'executive' && !oneExec) continue // 임원평가 담당은 회차 전체를 보고 나눈다(distributeExecs, D-082)
      const ev = resolveEvaluator(s, e, st.rule, cycle)
      if (!ev) continue // 평가자 부재 → 배정 화면에서 경고 표시
      out.push({ id: aid(cycle.id), targetId: t.employeeId, evaluatorId: ev, direction: st.direction, stageOrder: st.order, templateId })
    }
  }
  return out
}

export function createCycle(
  s: AppState,
  input: { name: string; period: string; dueDate: string; presetId: string; templateByJob: Cycle['templateByJob']; targetIds: string[] },
  oneExec = false,
  upward = true, // 팀원→팀장평가(D-114). 새 시드는 기존 시연 응답을 그대로 만든 뒤 끝에서 저장 데이터 변환과 같은 함수로 추가
): Cycle {
  const id = `c-${Date.now().toString(36)}`
  const snap = (tid: string): [string, Template] => {
    const t = s.templates.find((x) => x.id === tid)!
    return [tid, structuredClone(t)]
  }
  const tplIds = new Set(Object.values(input.templateByJob))
  const cycle: Cycle = {
    id,
    name: input.name,
    period: input.period,
    dueDate: input.dueDate,
    status: '준비',
    templateByJob: input.templateByJob,
    path: makePath(input.presetId),
    stageWeights: { member: {}, lead: {}, exec: { 1: 100 } }, // 새 평가는 반영 비율 미입력에서 시작 (임원은 자기평가 하나라 100%)
    kpiBlend: { enabled: false, personal: null, kpi: null },
    templates: Object.fromEntries([...tplIds].filter((x) => s.templates.some((t) => t.id === x)).map(snap)),
    targets: s.employees.filter((e) => input.targetIds.includes(e.id)).map((e) => snapshotTarget(s, e)),
    assignments: [],
    createdAt: new Date().toISOString(),
  }
  cycle.assignments = buildAssignments(s, cycle, oneExec)
  if (!oneExec) distributeExecs(s, cycle)
  ensureVersions(cycle) // 평가표 버전: 지금 문항을 "공통 평가표"로 (D-082)
  if (upward) { cycle.upwardToExec = true; ensureUpwardTemplate(cycle); ensureExecUpward(s, cycle); syncUpward(s, cycle) } // 팀원→팀장평가 평가표·배정 (D-114)
  return cycle
}

/** 화면 표시용 회차 이름. 저장된 이름·식별자는 바꾸지 않고, 시연 설명 괄호만 뺀다. */
export function cycleLabel(c: Pick<Cycle, 'name'>): string {
  return c.name.replace(/\s*\((가상|시연)[^)]*\)\s*$/, '').trim() || c.name
}

export const DEFAULT_TEMPLATE_BY_JOB = { office: DRAFT_ID, production: DRAFT_ID }

/**
 * 평가 복제: 문항(이 회차 전용 복사본)·평가 경로·반영 비율·대상자 구성을 가져오고,
 * 응답·제출 상태·보정·최종 결과·KPI는 가져오지 않는다. 배정은 현재 조직 기준으로 새로 만든다.
 */
export function cloneCycle(s: AppState, src: Cycle, name: string): Cycle {
  const id = `c-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 4)}`
  const targetIds = src.targets.map((t) => t.employeeId).filter((eid) => s.employees.some((e) => e.id === eid && e.active))
  const c: Cycle = {
    id,
    name,
    period: src.period,
    dueDate: src.dueDate,
    status: '준비',
    templateByJob: { ...src.templateByJob },
    path: structuredClone(src.path),
    stageWeights: structuredClone(src.stageWeights),
    kpiBlend: structuredClone(src.kpiBlend ?? { enabled: false, personal: null, kpi: null }), // 설정만 가져오고 KPI 지표·실적은 기간이 달라 가져오지 않음
    templates: structuredClone(src.templates),
    ...(src.versions ? { versions: structuredClone(src.versions).filter((v) => !v.archived) } : {}), // 평가표 버전·선택도 함께 (D-082)
    ...(src.versionPicks ? { versionPicks: structuredClone(src.versionPicks) } : {}),
    ...(src.upwardToExec ? { upwardToExec: true } : {}),
    targets: s.employees.filter((e) => targetIds.includes(e.id)).map((e) => snapshotTarget(s, e)),
    assignments: [],
    createdAt: new Date().toISOString(),
  }
  c.assignments = buildAssignments(s, c)
  distributeExecs(s, c)
  syncUpward(s, c) // 원본에 팀원→팀장 평가표가 있으면 함께 (D-114)
  applyVersions(s, c)
  return c
}

/**
 * 대상자 변경. 추가한 사람은 현재 소속으로 스냅샷·배정을 만들고, 빠지는 사람은 응답이 없을 때만 뺀다.
 * 반환: 응답이 있어 빼지 못한 사람 이름
 */
export function setTargets(s: AppState, c: Cycle, ids: string[]): string[] {
  const blocked: string[] = []
  const keep = c.targets.filter((t) => {
    if (ids.includes(t.employeeId)) return true
    const has = c.assignments.some((a) => a.targetId === t.employeeId && s.responses[a.id])
    if (has) blocked.push(t.name)
    return has
  })
  const added = s.employees.filter((e) => ids.includes(e.id) && !keep.some((t) => t.employeeId === e.id)).map((e) => snapshotTarget(s, e))
  const keptIds = new Set(keep.map((t) => t.employeeId))
  // 임원이 받는 상향평가(D-187)는 임원이 대상자 명단에 없어도 남긴다(평가자 변화는 syncUpward가 정리)
  const isExecUp = (a: Assignment) => a.direction === 'up' && !!s.employees.find((e) => e.id === a.targetId)?.isExecutive
  c.assignments = c.assignments.filter((a) => keptIds.has(a.targetId) || isExecUp(a))
  c.targets = [...keep, ...added]
  if (added.length) {
    const tmp: Cycle = { ...c, targets: added }
    c.assignments.push(...buildAssignments(s, tmp))
    distributeExecs(s, c) // 새 참여자의 담당 임원 — 회차 전체 담당 수를 보고 (D-082)
  }
  return blocked
}

/** 같은 대상자·단계·평가자 중복 배정, 자기 자신을 후속 평가하는 배정, 평가자 없는 단계 */
export function assignmentProblems(s: AppState, c: Cycle): string[] {
  const out: string[] = []
  const name = (id: string) => s.employees.find((e) => e.id === id)?.name ?? '?'
  const seen = new Set<string>()
  for (const a of c.assignments) {
    if (a.excluded) continue
    const k = `${a.targetId}|${a.stageOrder}|${a.evaluatorId}`
    if (seen.has(k)) out.push(`${name(a.targetId)} ${a.stageOrder}단계: ${name(a.evaluatorId)} 중복 배정`)
    seen.add(k)
    if (a.direction !== 'self' && a.evaluatorId === a.targetId) out.push(`${name(a.targetId)} ${a.stageOrder}단계: 본인이 본인을 평가하도록 배정됨`)
  }
  for (const t of c.targets) {
    for (const st of appliedStages(c, t))
      if (!c.assignments.some((a) => a.targetId === t.employeeId && a.stageOrder === st.order && !a.excluded)) out.push(`${t.name} ${st.order}단계(${st.label}): 평가자 없음`)
  }
  return out
}

/**
 * 팀장·임원의 자기평가 켜기/끄기 (회차별·직원별, D-068).
 *  - 켬: 임원이 회차 대상자가 아니면 대상자로 넣고, 꺼 둔 기존 자기평가 배정이 있으면 되살리고(응답 그대로), 없으면 새로 만든다.
 *  - 끔: 응답이 없는 자기평가 배정은 지우고, 응답이 있으면 지우지 않고 "제외" 표시(진행·집계·작성 목록에서만 빠짐).
 *    받는 평가가 하나도 남지 않은 임원 대상자는 응답이 없을 때만 회차 대상자에서 뺀다.
 * 확정 회차는 바꾸지 않는다. 화면에서 영향이 있는 경우(응답 있음·이미 진행된 후속 평가) 미리 확인한다.
 */
export function setSelfEval(d: AppState, cycleId: string, empId: string, on: boolean): string | null {
  const c = d.cycles.find((x) => x.id === cycleId)
  const e = d.employees.find((x) => x.id === empId)
  if (!c || !e) return '대상을 찾을 수 없습니다.'
  if (c.status === '확정') return '확정된 평가는 바꿀 수 없습니다.'
  c.selfEval = { ...(c.selfEval ?? {}), [empId]: on }
  let t = c.targets.find((x) => x.employeeId === empId)
  if (on && !t) { t = snapshotTarget(d, e); c.targets.push(t) }
  if (!t) return null
  const selfs = c.assignments.filter((a) => a.targetId === empId && a.direction === 'self')
  if (on) {
    if (!selfApplies(c, t)) return null
    const kept = selfs.find((a) => a.excluded)
    if (kept) delete kept.excluded
    else if (!selfs.some((a) => !a.excluded)) c.assignments.push({ id: aid(c.id), targetId: empId, evaluatorId: empId, direction: 'self', stageOrder: 1, templateId: templateFor(c, t.jobType) })
  } else {
    const answered = new Set(Object.keys(d.responses))
    c.assignments = c.assignments.filter((a) => !(selfs.includes(a) && !answered.has(a.id)))
    c.assignments.forEach((a) => { if (selfs.includes(a) && answered.has(a.id)) a.excluded = 'selfOff' })
    const anyLeft = c.assignments.some((a) => a.targetId === empId && a.direction !== 'up') // 임원이 받는 상향평가(D-187)는 대상자 여부와 무관
    if (t.isExecutive && !anyLeft) c.targets = c.targets.filter((x) => x.employeeId !== empId)
  }
  return null
}

// ── 평가 참여자·자기평가 설정 (D-072) ───────────────────
/** 참여 여부를 정하는 직원 = 재직 임원 + 회차 대상자. 사원·팀장 참여 = 대상자, 임원 참여 = execOff에 없음(대상자 여부는 자기평가로 결정) */
export function participation(s: Pick<AppState, 'employees'>, c: Cycle): Set<string> {
  const isExec = (id: string) => !!s.employees.find((e) => e.id === id)?.isExecutive
  const off = new Set(c.execOff ?? [])
  return new Set([
    ...c.targets.map((t) => t.employeeId),
    ...s.employees.filter((e) => e.active && e.isExecutive && !off.has(e.id)).map((e) => e.id),
  ].filter((id) => !isExec(id) || !off.has(id)))
}

/**
 * 평가 설정 저장 — 참여 체크와 팀장·임원 자기평가를 한 번에 반영 (D-072).
 *  - 참여 해제는 그 직원이 다른 사람을 평가하는 활성 배정이 있거나, 받는 평가에 응답이 있으면 하지 않는다(배정·응답을 지우거나 옮기지 않음) → 이름 반환
 *  - 사원·팀장: 참여 = 대상자(setTargets: 새로 참여하면 현재 조직 기준 배정 생성)
 *  - 임원: 참여 = execOff에 없음. 대상자는 참여 + 자기평가 켬일 때만
 *  - 자기평가 값은 참여하지 않는 사람도 그대로 저장(초기화하지 않음), 배정에는 참여 중인 사람만 반영
 * 확정 회차는 바꾸지 않는다.
 */
export function applyParticipation(d: AppState, cycleId: string, join: string[], selfEval: Record<string, boolean>): string[] {
  const c = d.cycles.find((x) => x.id === cycleId)
  if (!c || c.status === '확정') return []
  const emp = (id: string) => d.employees.find((e) => e.id === id)
  const isExec = (id: string) => !!emp(id)?.isExecutive
  const writes = (id: string) => c.assignments.some((a) => a.evaluatorId === id && a.targetId !== id && isActiveAssignment(a))
  const answered = (id: string) => c.assignments.some((a) => a.targetId === id && d.responses[a.id])
  const before = participation(d, c)
  const want = new Set(join)
  const blocked: string[] = []
  for (const id of before) if (!want.has(id) && (writes(id) || answered(id))) { want.add(id); blocked.push(emp(id)?.name ?? id) }
  // 임원 참여 기록
  const execIds = [...new Set([...d.employees.filter((e) => e.isExecutive && e.active).map((e) => e.id), ...c.targets.filter((t) => isExec(t.employeeId)).map((t) => t.employeeId)])]
  const off = execIds.filter((id) => !want.has(id)).sort()
  if (off.length) c.execOff = off
  else delete c.execOff
  // 자기평가 값: 지금 대상자가 아닌 사람은 값만 기록(새로 참여하는 팀장은 이 값으로 배정이 만들어진다)
  const isTarget = (id: string) => c.targets.some((t) => t.employeeId === id)
  for (const [id, on] of Object.entries(selfEval)) if (!isTarget(id)) c.selfEval = { ...(c.selfEval ?? {}), [id]: on }
  // 사원·팀장 참여 = 대상자 (임원 대상자는 그대로 두고 아래에서 자기평가로 정리)
  const keepExecTargets = c.targets.filter((t) => isExec(t.employeeId)).map((t) => t.employeeId)
  setTargets(d, c, [...[...want].filter((id) => !isExec(id)), ...keepExecTargets])
  // 참여하지 않는 임원: 자기평가 배정만 정리하고 설정값은 보존
  for (const id of keepExecTargets) if (!want.has(id)) {
    const keep = selfEval[id] ?? c.selfEval?.[id]
    setSelfEval(d, c.id, id, false)
    if (keep !== undefined) c.selfEval = { ...(c.selfEval ?? {}), [id]: keep }
  }
  // 참여 중인 팀장·임원의 자기평가 반영 (참여하지 않는 사람은 값만 보존)
  for (const [id, on] of Object.entries(selfEval)) {
    if (!want.has(id)) { if (id in selfEval && !c.targets.some((t) => t.employeeId === id)) c.selfEval = { ...(c.selfEval ?? {}), [id]: on }; continue }
    const t = c.targets.find((x) => x.employeeId === id)
    const cur = t ? selfApplies(c, t) : false
    if (tierNow(d, id) === '사원') continue // 현재 사원은 아래에서 항상 켬
    if (cur !== on) setSelfEval(d, c.id, id, on)
    else c.selfEval = { ...(c.selfEval ?? {}), [id]: on }
  }
  // 참여 중인 현재 사원은 자기평가 필수 (D-077): 이전 팀장 경로라 꺼져 있었어도 켬(응답이 있던 배정은 그대로 되살림)
  selfForStaff(d, c.id)
  return blocked
}

/**
 * 새로 등록한 직원(직원 추가·명단 업로드)을 준비·진행 중인 회차의 평가 참여자로 (D-112) — 평가 설정의 '참여'가 체크된 상태로 시작.
 *  - 사원·팀장: 회차 대상자로 넣고 현재 조직 기준 배정 생성(setTargets). 평가 제외 직원은 넣지 않음
 *  - 임원: 참여 = execOff에 없음 → 새 임원은 따로 할 일 없이 참여(자기평가는 기본 끔)
 *  - 마감·확정 회차는 바꾸지 않음. 관리자가 평가 설정에서 참여를 해제할 수 있음
 */
export function joinOpenCycles(d: AppState, empIds: string[]) {
  const news = d.employees.filter((e) => empIds.includes(e.id) && e.active && !e.evalExcluded && !e.isExecutive && !e.isCeo)
  if (!news.length) return
  for (const c of d.cycles) {
    if (c.status !== '준비' && c.status !== '진행') continue
    const add = news.filter((e) => !c.targets.some((t) => t.employeeId === e.id))
    if (add.length) setTargets(d, c, [...c.targets.map((t) => t.employeeId), ...add.map((e) => e.id)])
  }
}

const tierNow = (d: AppState, id: string): '임원' | '팀장' | '사원' => {
  const e = d.employees.find((x) => x.id === id)
  return !e ? '사원' : e.isExecutive || e.isCeo ? '임원' : d.teams.some((t) => !t.archived && t.leadId === id) ? '팀장' : '사원'
}

/** 확정 전 회차의 대상자 중 현재 직급이 사원인데 자기평가가 꺼져 있으면 켠다. 바꾼 사람 이름 반환. 응답·다른 배정은 건드리지 않음 */
export function selfForStaff(d: AppState, cycleId: string): string[] {
  const c = d.cycles.find((x) => x.id === cycleId)
  if (!c || c.status === '확정') return []
  const out: string[] = []
  for (const t of [...c.targets]) {
    if (tierNow(d, t.employeeId) !== '사원' || selfApplies(c, t)) continue
    setSelfEval(d, c.id, t.employeeId, true)
    out.push(t.name)
  }
  return out
}

/**
 * 평가 삭제(D-192): 회차와 그 회차의 배정·응답·채점·KPI·보정·리포트 기록을 함께 지운다. 확정 회차는 지우지 않음.
 * 직원·조직·다른 회차는 그대로. 되돌릴 수 없음(화면에서 확인 후 실행)
 */
export function deleteCycle(d: AppState, cycleId: string): boolean {
  const c = d.cycles.find((x) => x.id === cycleId)
  if (!c || c.status === '확정') return false
  const aids = new Set(c.assignments.map((a) => a.id))
  for (const id of aids) { delete d.responses[id]; if (d.manualScores) delete d.manualScores[id] }
  d.cycles = d.cycles.filter((x) => x.id !== cycleId)
  d.kpi = d.kpi.filter((k) => k.cycleId !== cycleId)
  d.kpiIndicators = (d.kpiIndicators ?? []).filter((k) => k.cycleId !== cycleId)
  d.adjustments = d.adjustments.filter((a) => a.cycleId !== cycleId)
  d.tokens = (d.tokens ?? []).filter((t) => t.cycleId !== cycleId)
  if (d.reportNotes) for (const k of Object.keys(d.reportNotes)) if (k.startsWith(`${cycleId}|`)) delete d.reportNotes[k]
  return true
}
