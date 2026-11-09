import { describe, expect, it } from 'vitest'
import { createEmptyState, emptyForms } from './emptyState'
import { createCycle, DEFAULT_TEMPLATE_BY_JOB } from './cycle'
import { liveVersions } from './versions'

describe('빈 상태로 시작(empty-start)', () => {
  it('직원·팀·평가·응답·KPI·문항 없음, 직급·직무 목록만', () => {
    const s = createEmptyState()
    expect([s.employees.length, s.teams.length, s.cycles.length, Object.keys(s.responses).length, s.kpi.length]).toEqual([0, 0, 0, 0, 0])
    expect(s.positions!.map((p) => p.name)).toEqual(['임원', '팀장', '사원'])
    expect(s.templates.every((t) => t.sections.length === 0)).toBe(true)
  })
  it('새 평가 = 원본과 같은 6개 평가표 틀(문항 없음), 화살표 8개 모두 맡음', () => {
    const s = createEmptyState()
    const c = createCycle(s, { name: '새', period: '', dueDate: '', presetId: 'A', templateByJob: DEFAULT_TEMPLATE_BY_JOB, targetIds: [] })
    expect(liveVersions(c).map((v) => v.name)).toEqual(['자기평가(사원)', '팀장평가표', '임원평가표', '팀장 자기평가표', '팀원→팀장 평가표', '임원 상향평가표'])
    expect(liveVersions(c).flatMap((v) => v.scope.slots).length).toBe(8)
    expect(liveVersions(c).every((v) => c.templates[v.templateId].sections.length === 0)).toBe(true)
    emptyForms(s, c) // 반복 안전
    expect(liveVersions(c).length).toBe(6)
  })
})
