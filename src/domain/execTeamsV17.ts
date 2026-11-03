// v16 → v17 (D-110): 임원을 팀마다 한 명씩. 저장 데이터 변환과 새 시드가 같은 함수를 쓴다.
// - 총 인원·직원 ID·사번·이름·직급·배정·응답·임원평가 담당은 그대로, 임원의 소속 팀(teamId)만 옮긴다
// - 이미 혼자인 팀의 임원은 그대로, 한 팀에 여럿이면 사번이 빠른 한 명만 남기고 나머지를 임원이 없는 팀(팀 목록 순서)으로
// - 재직 임원 수와 팀 수가 다르면 임의로 고르지 않고 바꾸지 않는다(안내만)
import type { AppState } from './types'
import { activeTeams, tierOf } from './org'
import { syncOpenCycles } from './cycleSync'

export function execPerTeam(s: AppState): string[] {
  const teams = activeTeams(s)
  const execs = s.employees.filter((e) => e.active && tierOf(s, e) === '임원').sort((a, b) => a.empNo.localeCompare(b.empNo, 'ko', { numeric: true }))
  if (!execs.length) return []
  if (execs.length !== teams.length) return [`임원 ${execs.length}명 · 팀 ${teams.length}개 — 수가 달라 임원 소속 팀은 그대로 둠`]
  const keep = new Set<string>()
  for (const t of teams) { const first = execs.find((e) => e.teamId === t.id); if (first) keep.add(first.id) }
  const empty = teams.filter((t) => !execs.some((e) => keep.has(e.id) && e.teamId === t.id))
  const notes: string[] = []
  const name = (id: string) => s.teams.find((t) => t.id === id)?.name ?? id
  for (const e of execs) {
    if (keep.has(e.id)) continue
    const to = empty.shift()!
    notes.push(`임원 ${e.name}: ${name(e.teamId)} → ${to.name}`)
    e.teamId = to.id
  }
  if (notes.length) syncOpenCycles(s)
  return notes
}
