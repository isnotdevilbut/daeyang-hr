// 저장 데이터 v11 → v12 (D-079): 목업 인원 35명 구성 + 확정 전 회차의 직급·평가 경로를 현재 조직 기준으로 정리.
// 새 데이터와 이전 브라우저 데이터가 같은 함수를 거친다. 다시 실행해도 바뀌는 것이 없다.
//  1) 경영기획팀 팀장 연결이 팀 밖의 직원으로 되어 있으면 기본 팀장 이준호(e04)로 되돌린다(사용자 결정).
//  2) 경영기획팀(팀장 1 + 사원 3)이 4명보다 많으면 기본 직원 강태영·송하은·윤서준·류성민 순으로 설계팀으로 옮긴다(같은 관리직).
//  3) 생산팀 11명·현장팀 9명보다 적으면 고정 ID 가상 사원을 모자란 수만큼 추가(이미 있으면 추가 없음, 기존 직원 삭제·복제 없음).
//  4) 확정 전 회차: 대상자 스냅샷의 팀·팀장 여부를 현재 조직으로 맞추고, 팀장평가(2단계)를 현재 팀장으로 정리,
//     빠진 팀장평가·임원평가 배정을 만든다. 응답 없는 배정은 평가자만 바꾸고, 기본 시연 응답이 있는 이전 팀장 배정은
//     지우지 않고 "leadChanged"로 집계에서 뺀 뒤 현재 팀장에게 새 배정을 만든다. 사용자 응답은 작성자를 바꾸지 않고 충돌로 보고.
//  5) 진행 중 회차에 새 가상 사원을 참여자로 추가(응답 없음, 사용자 결정).
import type { AppState, Assignment, Cycle, Employee } from './types'
import { buildAssignments, resolveEvaluator, selfForStaff, snapshotTarget } from './cycle'
import { pathFor } from './progress'
import { templateFor } from './catalog'
import { syncTiers, tierOf } from './org'

/** 기본 시연 응답인가(사용자 기록과 구분). 구분할 수 없으면 false — 사용자 기록으로 보고 건드리지 않는다 */
export type IsDemoResponse = (a: Assignment) => boolean

export const TEAM_SIZE: Record<string, number> = { 'tm-plan': 4, 'tm-design': 7, 'tm-prod1': 11, 'tm-prod2': 9 } // 임원 제외
const MOVE_TO_DESIGN: [string, string][] = [['e07', '강태영'], ['e21', '송하은'], ['e09', '윤서준'], ['e22', '류성민']]
export const NEW_STAFF: { id: string; name: string; teamId: string }[] = [
  { id: 'e29', name: '유하준', teamId: 'tm-prod1' },
  { id: 'e30', name: '차은서', teamId: 'tm-prod1' },
  { id: 'e31', name: '남기훈', teamId: 'tm-prod1' },
  { id: 'e32', name: '아이베크 토로베코프', teamId: 'tm-prod1' },
  { id: 'e33', name: '노승현', teamId: 'tm-prod2' },
  { id: 'e34', name: '염지수', teamId: 'tm-prod2' },
  { id: 'e35', name: '탁민재', teamId: 'tm-prod2' },
  { id: 'e36', name: '진서윤', teamId: 'tm-prod2' },
  { id: 'e37', name: '다니야르 사리예프', teamId: 'tm-prod2' },
]

export function rosterAndPaths(s: AppState, isDemo: IsDemoResponse): string[] {
  const notes: string[] = []
  const emp = (id: string | null | undefined) => s.employees.find((e) => e.id === id)
  const teamOk = (id: string) => s.teams.some((t) => t.id === id && !t.archived)
  const size = (teamId: string) => s.employees.filter((e) => e.active && e.teamId === teamId && tierOf(s, e) !== '임원').length

  // 1) 경영기획팀 팀장 연결 복원
  const plan = s.teams.find((t) => t.id === 'tm-plan' && !t.archived)
  const lee = emp('e04')
  if (plan && lee?.active && lee.teamId === 'tm-plan' && !lee.isExecutive && !lee.isCeo && plan.leadId !== 'e04') {
    const cur = emp(plan.leadId)
    if (!cur || cur.teamId !== 'tm-plan') {
      notes.push(`경영기획팀 팀장 복원: ${cur ? `${cur.name}(다른 팀 소속)` : '없음'} → ${lee.name}`)
      plan.leadId = 'e04'
    } else notes.push(`충돌(유지): 경영기획팀 팀장 ${cur.name}은(는) 팀 소속 — 이준호로 바꾸지 않음`)
  }

  // 2) 경영기획팀 → 설계팀
  if (plan && teamOk('tm-design')) for (const [id, nm] of MOVE_TO_DESIGN) {
    if (size('tm-plan') <= TEAM_SIZE['tm-plan']) break
    const e = emp(id)
    if (!e || !e.active || e.teamId !== 'tm-plan' || e.name !== nm || tierOf(s, e) !== '사원') { notes.push(`이동 건너뜀: ${nm}(기본값과 다름)`); continue }
    e.teamId = 'tm-design'
    notes.push(`팀 이동: ${e.name} 경영기획팀 → 설계팀`)
  }

  // 3) 가상 사원 추가
  for (const x of NEW_STAFF) {
    if (!teamOk(x.teamId) || size(x.teamId) >= TEAM_SIZE[x.teamId]) continue
    if (emp(x.id)) continue // 이미 있음(중복 생성 없음)
    if (s.employees.some((e) => e.name === x.name)) { notes.push(`가상 사원 '${x.name}' 이름이 이미 있어 추가하지 않음`); continue }
    let no = 29
    while (s.employees.some((e) => e.empNo === String(no).padStart(4, '0'))) no++
    const empNo = String(no).padStart(4, '0')
    s.employees.push({ id: x.id, empNo, name: x.name, teamId: x.teamId, position: '사원', jobType: 'production', isExecutive: false, isCeo: false, active: true, evalExcluded: false } as Employee)
    notes.push(`가상 사원 추가: ${x.name} (${s.teams.find((t) => t.id === x.teamId)?.name}, 사번 ${empNo})`)
  }
  syncTiers(s)

  for (const c of s.cycles) {
    if (c.status === '확정') continue
    // 5) 진행 중 회차에 새 가상 사원 참여 (스냅샷 정리 전에 넣어 같은 규칙으로 배정)
    if (c.status === '진행') {
      const add = NEW_STAFF.map((x) => emp(x.id)).filter((e): e is Employee => !!e && e.active && !c.targets.some((t) => t.employeeId === e.id))
      if (add.length) {
        const targets = add.map((e) => snapshotTarget(s, e))
        c.targets.push(...targets)
        c.assignments.push(...buildAssignments(s, { ...c, targets }))
        notes.push(`${c.name}: 새 가상 사원 ${add.length}명 참여(응답 없음)`)
      }
    }
    alignCycle(s, c, isDemo, notes)
  }
  return notes
}

/** 확정 전 회차 하나를 현재 조직 기준으로 맞춘다 */
function alignCycle(s: AppState, c: Cycle, isDemo: IsDemoResponse, notes: string[]) {
  const emp = (id: string) => s.employees.find((e) => e.id === id)
  const name = (id: string) => emp(id)?.name ?? id
  const answered = (a: Assignment) => !!s.responses[a.id]
  const pre = `${c.name}: `

  // 4-1) 스냅샷의 팀·팀장 여부를 현재 조직으로 (임원 여부가 달라진 경우는 경로가 크게 바뀌어 보고만)
  for (const t of c.targets) {
    const e = emp(t.employeeId)
    if (!e || !e.active) continue
    if (!!(e.isExecutive || e.isCeo) !== !!t.isExecutive) { notes.push(`${pre}충돌(유지): ${t.name} 임원 여부가 회차 시작 때와 다름`); continue }
    const now = snapshotTarget(s, e)
    if (now.isTeamLead === t.isTeamLead && now.departmentId === t.departmentId) continue
    const was = t.isTeamLead ? '팀장' : '사원'
    Object.assign(t, { departmentId: now.departmentId, departmentName: now.departmentName, teamName: now.teamName, isTeamLead: now.isTeamLead, position: now.position })
    notes.push(`${pre}${t.name} 회차 정보 → ${now.teamName} ${now.isTeamLead ? '팀장' : '사원'}${was !== (now.isTeamLead ? '팀장' : '사원') ? `(이전 ${was})` : ''}`)
  }
  // 현재 사원은 자기평가 필수 (D-077)
  selfForStaff(s, c.id)

  // 4-2) 팀장평가·임원평가 배정
  for (const t of c.targets) {
    const e = emp(t.employeeId)
    if (!e || !e.active || t.isExecutive) continue
    const path = pathFor(c, t)
    const tpl = c.assignments.find((a) => a.targetId === t.employeeId)?.templateId ?? templateFor(c, t.jobType)
    const live2 = () => c.assignments.filter((a) => a.targetId === t.employeeId && a.stageOrder === 2 && a.direction === 'down' && !a.excluded)
    if (path.some((st) => st.order === 2 && st.rule === 'teamLead')) {
      const lead = resolveEvaluator(s, e, 'teamLead', c)
      if (!lead) { if (!live2().length) notes.push(`${pre}${t.name} 팀장평가: 팀장 없음(평가자 미지정)`); continue }
      for (const a of live2()) {
        if (a.evaluatorId === lead) continue
        if (!answered(a)) { notes.push(`${pre}팀장평가 재배정: ${t.name} — ${name(a.evaluatorId)} → ${name(lead)}`); a.evaluatorId = lead }
        else if (isDemo(a)) { a.excluded = 'leadChanged'; notes.push(`${pre}${t.name} 팀장평가: 이전 팀장 ${name(a.evaluatorId)}의 시연 응답은 보존·집계 제외, ${name(lead)}에게 새 배정`) }
        else notes.push(`${pre}충돌(유지): ${t.name}의 팀장평가는 ${name(a.evaluatorId)}이(가) 응답함(사용자 기록) — 현재 팀장 ${name(lead)}`)
      }
      if (!live2().length) {
        c.assignments.push({ id: `${c.id}-v12-${t.employeeId}-2`, targetId: t.employeeId, evaluatorId: lead, direction: 'down', stageOrder: 2, templateId: tpl })
        notes.push(`${pre}팀장평가 추가: ${t.name} ← ${name(lead)}`)
      }
    } else {
      // 팀장평가가 없는 경로(현재 팀장): 남은 팀장평가 배정 정리
      for (const a of live2()) {
        if (!answered(a)) { c.assignments = c.assignments.filter((x) => x !== a); notes.push(`${pre}${t.name}(팀장)의 응답 없는 팀장평가 배정 삭제`) }
        else if (isDemo(a)) { a.excluded = 'leadChanged'; notes.push(`${pre}${t.name}(팀장)의 팀장평가 시연 응답 보존·집계 제외`) }
        else notes.push(`${pre}충돌(유지): ${t.name}(팀장)이 받은 팀장평가 응답(사용자 기록)`)
      }
    }
    if (path.some((st) => st.order === 3 && st.rule === 'executive') && !c.assignments.some((a) => a.targetId === t.employeeId && a.stageOrder === 3 && !a.excluded)) {
      const ex = resolveEvaluator(s, e, 'executive', c)
      if (ex) { c.assignments.push({ id: `${c.id}-v12-${t.employeeId}-3`, targetId: t.employeeId, evaluatorId: ex, direction: 'down', stageOrder: 3, templateId: tpl }); notes.push(`${pre}임원평가 추가: ${t.name} ← ${name(ex)}`) }
    }
  }
}
