// 회차 배정 맞추기 (D-081). 준비·진행 중인 회차를 현재 조직(팀·팀장 연결·임원 표시·참여 설정) 기준으로 맞춘다.
// 저장 데이터 변환(v13 → v14)과, 직원 추가·수정·팀장 변경·직급 변경·참여 저장 뒤에 같은 함수를 쓴다. 다시 실행해도 바뀌는 것이 없다.
//  - 회차 대상자 = 참여 설정 그대로(직원 등록만으로 참여시키지 않음). 퇴사·평가 제외 직원은 건드리지 않음
//  - 대상자 스냅샷의 팀·팀장 여부를 현재 조직으로. 임원 여부가 바뀐 경우는 경로가 크게 달라져 보고만
//  - 사원: 자기평가(필수) + 소속 팀 팀장의 팀장평가 + 담당 임원 한 명의 임원평가 / 팀장: 자기평가(설정) + 담당 임원 한 명의 임원평가
//  - 임원평가(D-082, D-081의 전원 평가를 대체 — 사용자가 고른 목업 구성): 참여 사원·팀장을 참여 임원에게 나눠 대상자당 담당 임원 한 명.
//    팀 단위를 먼저 맞추고 필요하면 팀 안에서 나눔(가능한 한 고르게). 응답 있는 담당은 그대로, 관리자가 바꾼 담당도 그대로(rebalance일 때만 다시 나눔)
//  - 응답 없는 배정만 평가자를 바꾸거나 지운다. 응답 있는 배정은 작성자를 바꾸지 않고, 기본 시연 응답만 "leadChanged"로 집계에서 뺀다
//    (isDemo가 false면 사용자 기록 → 그대로 두고 충돌로 보고). 실제 담당자가 없으면 만들지 않고 "평가자 없음"으로 남김
import type { AppState, Assignment, Cycle, Employee } from './types'
import { resolveEvaluator, selfForStaff, snapshotTarget } from './cycle'
import { cycleExecs, distributeExecs } from './execPlan'
import { pathFor } from './progress'
import { templateFor } from './catalog'
import { applyVersions } from './versions'

export type IsDemo = (a: Assignment) => boolean
/** 현재 조직에 맞춰 배정을 고치는 회차: 준비·진행. 마감·확정 회차는 바꾸지 않음 */
export const syncable = (c: Pick<Cycle, 'status'>) => c.status === '준비' || c.status === '진행'

export { cycleExecs, distributeExecs }

export function syncCycle(s: AppState, c: Cycle, isDemo: IsDemo = () => false, rebalance = false): string[] {
  const notes: string[] = []
  if (!syncable(c)) return notes
  const emp = (id: string) => s.employees.find((e) => e.id === id)
  const name = (id: string) => emp(id)?.name ?? id
  const answered = (a: Assignment) => !!s.responses[a.id]
  const pre = `${c.name}: `
  const live = (e: Employee, t: Cycle['targets'][number]) => !!e && e.active && (!e.evalExcluded || !!t.isExecutive)

  // 1) 스냅샷 팀·팀장 여부
  for (const t of c.targets) {
    const e = emp(t.employeeId)
    if (!e || !live(e, t)) continue
    if (!!(e.isExecutive || e.isCeo) !== !!t.isExecutive) { notes.push(`${pre}충돌(유지): ${t.name} 임원 여부가 회차 시작 때와 다름`); continue }
    const now = snapshotTarget(s, e)
    if (now.isTeamLead === t.isTeamLead && now.departmentId === t.departmentId && now.position === t.position && now.positionId === t.positionId) continue
    const major = now.isTeamLead !== t.isTeamLead || now.departmentId !== t.departmentId
    Object.assign(t, { departmentId: now.departmentId, departmentName: now.departmentName, teamName: now.teamName, isTeamLead: now.isTeamLead, position: now.position, positionId: now.positionId })
    if (major) notes.push(`${pre}${t.name} 회차 정보 → ${now.teamName} ${now.isTeamLead ? '팀장' : '사원'}`)
  }
  selfForStaff(s, c.id) // 현재 사원은 자기평가 필수 (D-077)

  const execs = cycleExecs(s, c)
  const execIds = new Set(execs.map((x) => x.id))
  for (const t of c.targets) {
    const e = emp(t.employeeId)
    if (!e || !live(e, t) || t.isExecutive) continue
    const path = pathFor(c, t)
    const tpl = c.assignments.find((a) => a.targetId === t.employeeId)?.templateId ?? templateFor(c, t.jobType)
    const stageOf = (o: number) => c.assignments.filter((a) => a.targetId === t.employeeId && a.stageOrder === o && a.direction === 'down' && !a.excluded)
    const drop = (a: Assignment, why: string) => { c.assignments = c.assignments.filter((x) => x !== a); notes.push(`${pre}${t.name} ${why}`) }

    // 2) 팀장평가: 소속 팀의 현재 팀장 한 명
    const leadStage = path.find((st) => st.rule === 'teamLead')
    if (leadStage) {
      const lead = resolveEvaluator(s, e, 'teamLead', c)
      for (const a of stageOf(leadStage.order)) {
        if (!lead || a.evaluatorId === lead) continue
        if (!answered(a)) { notes.push(`${pre}팀장평가 재배정: ${t.name} — ${name(a.evaluatorId)} → ${name(lead)}`); a.evaluatorId = lead }
        else if (isDemo(a)) { a.excluded = 'leadChanged'; notes.push(`${pre}${t.name} 팀장평가: 이전 팀장 ${name(a.evaluatorId)}의 시연 응답 보존·집계 제외`) }
        else notes.push(`${pre}충돌(유지): ${t.name}의 팀장평가는 ${name(a.evaluatorId)}이(가) 응답함 — 현재 팀장 ${name(lead)}`)
      }
      // 같은 평가자 중복(응답 없는 쪽만 정리)
      const seen = new Set<string>()
      for (const a of stageOf(leadStage.order)) { if (seen.has(a.evaluatorId) && !answered(a)) drop(a, '팀장평가 중복 배정 정리'); seen.add(a.evaluatorId) }
      if (lead && !stageOf(leadStage.order).length) {
        c.assignments.push({ id: `${c.id}-s-${t.employeeId}-${leadStage.order}`, targetId: t.employeeId, evaluatorId: lead, direction: 'down', stageOrder: leadStage.order, templateId: tpl })
        notes.push(`${pre}팀장평가 추가: ${t.name} ← ${name(lead)}`)
      }
    } else {
      // 팀장평가가 없는 경로(현재 팀장)에 남은 팀장평가 배정
      for (const a of c.assignments.filter((x) => x.targetId === t.employeeId && x.direction === 'down' && !x.excluded && path.every((st) => st.order !== x.stageOrder))) {
        if (!answered(a)) drop(a, `(팀장): 경로에 없는 ${a.stageOrder}단계 배정 삭제(응답 없음)`)
        else if (isDemo(a)) { a.excluded = 'leadChanged'; notes.push(`${pre}${t.name}(팀장)의 이전 팀장평가 시연 응답 보존·집계 제외`) }
        else notes.push(`${pre}충돌(유지): ${t.name}(팀장)이 받은 ${a.stageOrder}단계 응답(사용자 기록)`)
      }
    }

    // 3) 임원평가: 임원이 아니거나 참여하지 않는 평가자의 응답 없는 배정 정리 (담당 나누기는 아래에서 한꺼번에)
    const execStage = path.find((st) => st.rule === 'executive')
    if (!execStage) continue
    for (const a of stageOf(execStage.order)) {
      if (execIds.has(a.evaluatorId)) continue
      if (!answered(a)) drop(a, `임원평가: 임원이 아닌/참여하지 않는 평가자 ${name(a.evaluatorId)} 배정 삭제(응답 없음)`)
      else notes.push(`${pre}충돌(유지): ${t.name}의 임원평가를 ${name(a.evaluatorId)}이(가) 응답함(임원 아님 또는 참여 해제)`)
    }
  }
  notes.push(...distributeExecs(s, c, isDemo, rebalance))
  applyVersions(s, c) // 새로 만들거나 담당이 바뀐 미작성 배정에 알맞은 평가표 버전 연결 (D-082)
  return notes
}

/** 준비·진행 중인 모든 회차를 맞춘다 (화면에서 조직·직원을 바꾼 뒤 — 사용자 응답은 모두 사용자 기록으로 취급) */
export function syncOpenCycles(s: AppState): string[] {
  return s.cycles.flatMap((c) => syncCycle(s, c))
}

