import { describe, expect, it } from 'vitest'
import { createSeed } from './seed'
import { migrate } from '../data/migrate'
import { personResult } from './scoring'
import { applies, ctxFor, rulesOf } from './questions'
import { applyVersions, liveVersions, SLOTS } from './versions'
import { splitByRuleV37 } from './splitV37'
import { createCycle } from './cycle'

describe('D-255 평가별 평가표로 나누기 (v36 → v37)', () => {
  const old: any = createSeed({ until: 36 })
  const c0 = old.cycles.find((c: any) => c.status === '진행')
  const done = structuredClone(c0); done.id = 'c-done'; done.status = '확정'; old.cycles.push(done)
  const m = migrate(structuredClone(old))!
  const c = m.state.cycles.find((x) => x.id === c0.id)!
  it('공통평가표 → 자기·팀장·임원평가표, 화살표 그대로 나눠 맡음', () => {
    expect(m.state.schemaVersion).toBe(37)
    const names = liveVersions(c).map((v) => v.name)
    expect(names).toEqual(expect.arrayContaining(['자기평가(사원)', '팀장평가표', '임원평가표']))
    expect(names).not.toContain('공통 평가표')
    const owned = liveVersions(c).flatMap((v) => v.scope.slots ?? [])
    const before = liveVersions(c0).flatMap((v: any) => v.scope.slots ?? [])
    expect([...owned].sort()).toEqual([...before].sort())
    expect(new Set(owned).size).toBe(owned.length)
  })
  it('평가표 안 문항은 모두 그 평가표의 평가에 보임(문항별 적용 평가 차이 없음)', () => {
    for (const v of liveVersions(c)) {
      const rules = [...new Set(SLOTS.filter((x) => v.scope.slots!.includes(x.key)).map((x) => x.rule))]
      for (const sec of c.templates[v.templateId].sections) for (const q of sec.questions) expect(rulesOf(q).sort()).toEqual([...rules].sort())
    }
  })
  it('배정마다 보이는 문항 ID·점수·응답 그대로', () => {
    const vis = (cy: any, a: any) => cy.templates[a.templateId].sections.flatMap((sec: any) => sec.questions.filter((q: any) => applies(q, ctxFor(cy, a))).map((q: any) => q.id)).sort().join()
    for (const a of c.assignments) expect(vis(c, a)).toBe(vis(c0, c0.assignments.find((x: any) => x.id === a.id)))
    for (const t of c.targets) expect(JSON.stringify(personResult(m.state, c, t.employeeId))).toBe(JSON.stringify(personResult(old, c0, t.employeeId)))
    expect(m.state.responses).toEqual(old.responses)
    expect(applyVersions(m.state, structuredClone(c))).toEqual([])
  })
  it('확정 회차 그대로, 반복 안전, 새 평가도 나뉜 평가표로', () => {
    expect(m.state.cycles.find((x) => x.id === 'c-done')).toEqual(done)
    const again = structuredClone(m.state)
    expect(splitByRuleV37(again)).toEqual([])
    expect(again).toEqual(m.state)
    const s = createSeed()
    const nc = createCycle(s, { name: '새', period: '', dueDate: '', presetId: 'A', templateByJob: s.cycles[0].templateByJob, targetIds: s.employees.filter((e) => e.active && !e.isExecutive).map((e) => e.id) })
    const nn = liveVersions(nc).map((v) => v.name)
    expect(nn.some((x) => x.startsWith('자기평가('))).toBe(true); expect(nn).not.toContain('공통 평가표')
  })
})

describe('D-256 평가표 적용 팀', async () => {
  const V = await import('./versions')
  const { activeTeams } = await import('./org')
  it('같은 화살표를 팀으로 나눠 맡음 — 고른 팀은 그 평가표, 나머지는 전체 팀 평가표, 적용 대상 수도 팀만큼', () => {
    const s = createSeed(); const c = s.cycles.find((x) => x.status === '진행')!
    const lead = V.liveVersions(c).find((v) => v.name === '팀장평가표')!
    const team = activeTeams(s).find((t) => c.targets.some((x) => x.departmentId === t.id && !x.isTeamLead))!
    const t2 = V.cloneTemplate(c.templates[lead.templateId], '설계팀 팀장평가표')
    V.addVersion(c, t2, t2.name, V.slotScope([]))
    const sc = V.slotScope(['lead-member'], [team.id])
    expect(V.scopeErrors(c, t2.id, sc)).toEqual([])
    const r = V.applyVersion(s, c, t2.id, t2.name, sc, {})
    expect(r.errors).toEqual([])
    expect(V.liveVersions(c).find((v) => v.templateId === lead.templateId)!.scope.slots).toContain('lead-member') // 전체 팀 평가표에서 빠지지 않음
    const lm = c.assignments.filter((a) => !a.excluded && V.assignmentCtx(c, a).rule === 'teamLead')
    for (const a of lm) if (!s.responses[a.id]) expect(a.templateId).toBe(V.assignmentCtx(c, a).teamId === team.id ? t2.id : lead.templateId) // 응답 있는 배정은 평가표를 바꾸지 않음
    for (const a of lm) expect(V.resolveVersion(c, V.assignmentCtx(c, a)).templateId).toBe(V.assignmentCtx(c, a).teamId === team.id ? t2.id : lead.templateId)
    const n = V.scopeTargets(c, sc).length
    expect(n).toBe(new Set(lm.filter((a) => V.assignmentCtx(c, a).teamId === team.id).map((a) => a.targetId)).size)
    expect(n).toBeGreaterThan(0)
  })
})
