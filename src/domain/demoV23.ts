// v22 → v23 (D-151): 경영기획팀 가상 KPI 지표(목표·실적 입력된 시연용). 저장 데이터 변환과 새 시드가 같은 함수를 쓴다.
// - 준비·진행 회차만. 경영기획팀(tm-plan)에 지표가 하나도 없고 팀 점수 직접 입력도 없을 때만 넣는다(사용자 기록 보호)
// - 가중치 합 100 → 팀 KPI 점수가 바로 계산됨. 다시 실행해도 바뀌는 것이 없다
import type { AppState, KpiIndicator } from './types'

const TEAM = 'tm-plan'

export function demoKpiV23(s: AppState): string[] {
  const notes: string[] = []
  if (!s.teams.some((t) => t.id === TEAM && !t.archived)) return notes
  for (const c of s.cycles) {
    if (c.status !== '준비' && c.status !== '진행') continue
    if (!c.targets.some((t) => t.departmentId === TEAM)) continue
    if (s.kpiIndicators.some((x) => x.cycleId === c.id && x.departmentId === TEAM)) continue
    if (s.kpi.some((k) => k.cycleId === c.id && k.departmentId === TEAM && k.score !== null)) continue
    const mk = (id: string, name: string, p: Omit<KpiIndicator, 'id' | 'cycleId' | 'departmentId' | 'name'>): KpiIndicator => ({ id: `${c.id}-kpi-plan-${id}`, cycleId: c.id, departmentId: TEAM, name, ...p })
    s.kpiIndicators.push(
      mk('task', '과제 달성률 (가상)', { unit: 'percent', direction: 'higher', target: 85, actual: 80, weight: 60 }),
      mk('cs', '고객 만족도 (가상)', { unit: 'point', direction: 'higher', target: 4.5, actual: 4.7, weight: 40 }),
    )
    notes.push(`${c.name}: 경영기획팀 가상 KPI 지표 2개(과제 달성률·고객 만족도) 추가`)
  }
  return notes
}
