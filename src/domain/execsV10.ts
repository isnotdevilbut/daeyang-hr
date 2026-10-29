// 저장 데이터 v9 → v10 (D-076): 임원 4명 보장·현재 팀장 기준 2단계 정리·시연 회차 임원평가 분배.
// 새 데이터와 이전 브라우저 데이터가 같은 함수를 거친다. 다시 실행해도 바뀌는 것이 없다.
//  1) 재직 임원이 4명보다 적을 때만 고정 ID의 가상 임원을 모자란 수만큼 추가(이미 4명이면 추가 없음, 기존 직원 승격 없음).
//  2) 확정 전 회차: 응답이 전혀 없는 2단계(팀장평가) 배정의 평가자가 대상자 현재 팀의 팀장이 아니면 현재 팀장으로 바꾼다
//     (같은 배정 ID). 응답(임시저장·제출)이 있는 배정은 작성자를 바꾸지 않고 충돌로 보고한다.
//  3) 확정 전 회차: 참여 중인데 작성 배정이 하나도 없는 임원에게, 다른 임원의 응답 없는 3단계(임원평가) 배정을
//     팀 단위로 넘긴다(같은 직무 팀 우선, 넘겨주는 임원의 소속 팀은 제외). 제출·임시저장된 평가와 다른 배정은 그대로.
import type { AppState, Employee } from './types'

const EXTRA_EXECS: { id: string; name: string; teamId: string; jobType: Employee['jobType'] }[] = [
  { id: 'e27', name: '백승우', teamId: 'tm-design', jobType: 'office' }, // 설계팀
  { id: 'e28', name: '한도윤', teamId: 'tm-prod2', jobType: 'production' }, // 현장팀
]

export function execsAndAssignments(s: AppState): string[] {
  const notes: string[] = []
  const name = (id: string) => s.employees.find((e) => e.id === id)?.name ?? id

  // 1) 임원 4명 보장
  const active = () => s.employees.filter((e) => e.active && e.isExecutive)
  for (const x of EXTRA_EXECS) {
    if (active().length >= 4) break
    if (s.employees.some((e) => e.id === x.id)) continue // 이미 있음(중복 생성 없음)
    const nameTaken = s.employees.some((e) => e.name === x.name)
    const teamId = s.teams.some((t) => t.id === x.teamId && !t.archived) ? x.teamId : (s.teams.find((t) => !t.archived)?.id ?? x.teamId)
    let no = 27
    while (s.employees.some((e) => e.empNo === String(no).padStart(4, '0'))) no++
    if (nameTaken) { notes.push(`가상 임원 '${x.name}' 이름이 이미 있어 추가하지 않음`); continue }
    s.employees.push({ id: x.id, empNo: String(no).padStart(4, '0'), name: x.name, teamId, position: '임원', jobType: x.jobType, isExecutive: true, isCeo: false, active: true, evalExcluded: true })
    notes.push(`가상 임원 추가: ${x.name} (사번 ${String(no).padStart(4, '0')})`)
  }

  for (const c of s.cycles) {
    if (c.status === '확정') continue
    const answered = (id: string) => !!s.responses[id]
    const emp = (id: string) => s.employees.find((e) => e.id === id)

    // 2) 2단계: 현재 팀장 기준 정리
    for (const a of c.assignments) {
      if (a.stageOrder !== 2 || a.direction !== 'down' || a.excluded) continue
      const target = emp(a.targetId)
      const lead = target ? s.teams.find((t) => t.id === target.teamId && !t.archived)?.leadId : null
      if (!lead || lead === a.evaluatorId || lead === a.targetId || !emp(lead)?.active) continue
      if (answered(a.id)) { notes.push(`충돌(유지): ${name(a.targetId)}의 팀장평가는 이전 팀장 ${name(a.evaluatorId)}이(가) 응답함 — 현재 팀장 ${name(lead)}`); continue }
      notes.push(`팀장평가 재배정: ${name(a.targetId)} — ${name(a.evaluatorId)} → ${name(lead)}`)
      a.evaluatorId = lead
    }

    // 3) 작성 배정이 없는 참여 임원에게 응답 없는 임원평가를 팀 단위로
    const off = new Set(c.execOff ?? [])
    const execs = s.employees.filter((e) => e.active && e.isExecutive && !off.has(e.id))
    const load = (id: string) => c.assignments.filter((a) => a.evaluatorId === id && a.targetId !== id && !a.excluded).length
    for (const ex of execs) {
      if (load(ex.id) > 0) continue
      type Group = { from: string; team: string; ids: string[]; jobMatch: boolean }
      const groups: Group[] = []
      for (const src of execs) {
        if (src.id === ex.id) continue
        const free = c.assignments.filter((a) => a.evaluatorId === src.id && a.stageOrder === 3 && !a.excluded && !answered(a.id) && a.targetId !== ex.id)
        const byTeam = new Map<string, string[]>()
        for (const a of free) { const t = emp(a.targetId)?.teamId ?? ''; if (t === src.teamId) continue; byTeam.set(t, [...(byTeam.get(t) ?? []), a.id]) }
        for (const [team, ids] of byTeam) groups.push({ from: src.id, team, ids, jobMatch: ids.every((id) => emp(c.assignments.find((a) => a.id === id)!.targetId)?.jobType === ex.jobType) })
      }
      groups.sort((x, y) => Number(y.jobMatch) - Number(x.jobMatch) || load(y.from) - load(x.from) || y.ids.length - x.ids.length)
      const g = groups[0]
      if (!g) { notes.push(`임원 ${ex.name}: 넘길 수 있는 응답 없는 임원평가가 없어 평가자 선택만 가능한 상태로 둠`); continue }
      for (const id of g.ids) c.assignments.find((a) => a.id === id)!.evaluatorId = ex.id
      notes.push(`임원평가 분배: ${s.teams.find((t) => t.id === g.team)?.name ?? g.team} ${g.ids.length}건 ${name(g.from)} → ${ex.name}`)
    }
  }
  return notes
}
