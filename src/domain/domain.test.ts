/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from 'vitest'
import { combine, personResult, stageScore } from './scoring'
import { activeTargets, activeWriteAssignments, assignmentCell, cardFilter, writerCounts, writerFilter, writerRows, writeStageOf, cycleCounts, evaluatorTodo, inStage, isUnlocked, maxStageCount, statusOf, targetCells, targetSummary } from './progress'
import { createSeed } from './seed'
import { fixedStagesAndTiers } from './stagesV8'
import { applyParticipation, buildAssignments, participation, setSelfEval } from './cycle'
import { tierOf } from './org'
import { NEW_NAMES, reorganizeToFourTeams } from './reorg'
import { createCycle, cycleLabel, DEFAULT_TEMPLATE_BY_JOB, eligibleTargets } from './cycle'
import { LEGACY_UPWARD_ID } from './templates'
import { migrate as migrateAll } from '../data/migrate'
import { DEMO20_AT } from './demoV20'
/**
 * 이전 단계 변환 시험용: v20(D-117)·v21(D-121)의 시연 응답 조정만 빼고 본다 — 이 시험들은 각 단계가 기존 응답을 바꾸지 않는지를 확인한다.
 * v20 자체는 '시연 완료 비중 (D-117)' 시험에서 migrateAll로 확인
 */
const migrate = (x: any) => {
  const r = migrateAll(x)
  if (r) for (const [k, v] of Object.entries(r.state.responses)) if (v.demo && v.savedAt === DEMO20_AT) { if (x.responses?.[k]) r.state.responses[k] = x.responses[k]; else delete r.state.responses[k] } // 시연 임시저장을 제출로 바꾼 것도 원래대로
  // v21(D-121)이 되돌린 팀원→팀장평가 시연 제출도 원래대로
  if (r) for (const [k, v] of Object.entries((x.responses ?? {}) as Record<string, any>)) if (v.demo && !r.state.responses[k] && r.state.cycles.some((c) => c.assignments.some((a) => a.id === k && a.direction === 'up'))) r.state.responses[k] = v
  // 원래 키 순서 유지(JSON 비교)
  if (r && x.responses) { const o: Record<string, any> = {}; for (const k of Object.keys(x.responses)) if (k in r.state.responses) o[k] = r.state.responses[k]; for (const k of Object.keys(r.state.responses)) if (!(k in o)) o[k] = r.state.responses[k]; r.state.responses = o }
  return r
}
import { scoringV16 } from './scoringV16'
import type { AppState, Assignment, Cycle, Response, Template } from './types'
import { activeTeams, deleteEmployee, deleteTeam, isEvalTarget, nameConflicts, teamMembers, teamNameError } from './org'
import { canRegister, checkRoster, decodeText, parseCsv, readRosterFile, rosterEmployees, templateCsvText, templateXlsxBytes } from './roster'
import { readXlsx, templateXlsx } from './xlsx'
import { applies, ctxFor, parseQuestionCsv, validateQuestion, newQuestion, weightErrors, answeredCount } from './questions'
import { assignmentProblems, cloneCycle, setTargets } from './cycle'
import { combine as combine2 } from './scoring'
import { screenDone, visibleSections } from '../components/QuestionView'
import { ADMIN_ACCOUNTS, checkLogin, DEMO_PASSWORD, participantAccount, sessionFor } from '../data/auth'
import { applyBlend, blendErrors, deptKpi, indicatorErrors, indicatorResult } from './kpi'
import type { KpiIndicator } from './types'
import { can, canFinalAdjust } from './permissions'
import { ORIGINAL_TEMPLATES, makeDraftTemplate } from './templates'

/** 받는 단계만으로 만든 행(작성 업무 없음) — 단계 카드·이전 기준 테스트용 */
const rowOf = (cells: ReturnType<typeof targetCells>) => ({ cells, complete: targetSummary(cells).complete })


/** D-081 이후 새 데이터는 임원 4명 중 추가된 3명의 평가가 미응답 — 점수 테스트용으로 같은 단계의 제출된 응답을 복사해 나머지를 채운다 */
function fillRest(s: AppState, c: AppState['cycles'][number], tid?: string) {
  for (const a of c.assignments) {
    if (a.excluded || (tid && a.targetId !== tid) || s.responses[a.id]?.status === 'submitted') continue
    const src = c.assignments.find((x) => x.targetId === a.targetId && x.stageOrder === a.stageOrder && s.responses[x.id]?.status === 'submitted')
    if (src) s.responses[a.id] = { ...s.responses[src.id], assignmentId: a.id }
  }
}

describe('개발용 가정 계산 (회사 산식 아님)', () => {
  const st = (score: number) => ({ score, weight: 1, submitted: true })
  it('80·90·100, 동일 가중 → 기초 90, 부서 +2 개인 -1 → 91', () => {
    const r = combine({ stages: [st(80), st(90), st(100)], dept: 2, person: -1, ceoScore: null })
    expect(r.base).toBe(90)
    expect(r.afterAdjust).toBe(91)
    expect(r.final).toBe(91)
  })
  it('가중치 20·40·40이면 92 (출처별 과거값 검증용)', () => {
    const r = combine({ stages: [{ score: 80, weight: 20, submitted: true }, { score: 90, weight: 40, submitted: true }, { score: 100, weight: 40, submitted: true }], dept: null, person: null, ceoScore: null })
    expect(r.base).toBeCloseTo(92)
  })
  it('대표 지정값 0은 값 없음과 다르다', () => {
    const r = combine({ stages: [st(80)], dept: null, person: null, ceoScore: 0 })
    expect(r.final).toBe(0)
  })
  it('미제출 단계가 있으면 0점 처리·재분배하지 않고 미완료', () => {
    const r = combine({ stages: [st(80), { score: null, weight: 1, submitted: false }], dept: 5, person: null, ceoScore: null })
    expect(r.base).toBeNull()
    expect(r.final).toBeNull()
    expect(r.incomplete).toBe(true)
  })
  it('등급(A~D)처럼 점수값 없는 문항은 단계 점수에 들어가지 않는다', () => {
    const t = makeDraftTemplate()
    const answers: Record<string, string> = { 'd-e1': 'd-e1-o1' }
    expect(stageScore(t, { assignmentId: 'x', answers, status: 'submitted', savedAt: '', submittedAt: '', lang: 'ko' }, 'down')).toBeNull()
    answers['d-performance-q'] = 'd-performance-q-o1' // 5점
    answers['d-ability-q'] = 'd-ability-q-o3' // 3점
    expect(stageScore(t, { assignmentId: 'x', answers, status: 'submitted', savedAt: '', submittedAt: '', lang: 'ko' }, 'down')).toBe(80)
  })
})

describe('진행 단계 잠금 (검토용 가정: 대상자별)', () => {
  it('선행 단계 제출 전에는 다음 단계가 잠긴다', () => {
    const s = createSeed()
    s.responses = {}
    const c = s.cycles[0]
    const target = c.targets.find((t) => !t.isTeamLead)!
    const mine = c.assignments.filter((a) => a.targetId === target.employeeId).sort((a, b) => a.stageOrder - b.stageOrder)
    expect(isUnlocked(c, s.responses, mine[0])).toBe(true)
    expect(isUnlocked(c, s.responses, mine[1])).toBe(false)
    s.responses[mine[0].id] = { assignmentId: mine[0].id, answers: {}, status: 'draft', savedAt: '', submittedAt: null, lang: 'ko' }
    expect(isUnlocked(c, s.responses, mine[1])).toBe(false) // 임시저장은 제출이 아님
    s.responses[mine[0].id].status = 'submitted'
    expect(isUnlocked(c, s.responses, mine[1])).toBe(true)
    expect(isUnlocked(c, s.responses, mine[2])).toBe(false)
  })
  it('가상 시드 응답은 잠금 규칙과 모순되지 않는다', () => {
    const s = createSeed()
    const c = s.cycles[0]
    // 예외: 35명 정리(D-079)로 나중에 추가된 팀장평가(-v12-)보다 먼저 제출된 시연 임원평가
    const added = (a: { id: string }) => a.id.includes('-v12-')
    for (const a of c.assignments) if (s.responses[a.id] && !isUnlocked(c, s.responses, a)) {
      expect(c.assignments.filter((x) => !x.excluded && x.targetId === a.targetId && x.stageOrder < a.stageOrder && !s.responses[x.id]?.status.startsWith('sub')).every(added)).toBe(true)
    }
  })
})

describe('상향평가 제외 · 팀장의 두 역할', () => {
  it('D-114: 시드·새 회차의 팀원→팀장평가 = 참여 사원마다 소속 팀 팀장 한 건(1단계 분류), 팀장·임원은 평가자 아님', () => {
    const s = createSeed()
    const check = (c: Cycle) => {
      const ups = c.assignments.filter((a) => a.direction === 'up' && !a.excluded)
      const staff = c.targets.filter((t) => !t.isExecutive && !s.teams.some((x) => !x.archived && x.leadId === t.employeeId))
      expect(ups.length).toBe(staff.length)
      for (const a of ups) {
        const e = s.employees.find((x) => x.id === a.evaluatorId)!
        expect(s.teams.find((x) => x.id === e.teamId)!.leadId).toBe(a.targetId)
        expect(a.stageOrder).toBe(1)
        expect(c.templates[a.templateId].name).toBe('팀원→팀장 평가표')
      }
    }
    check(s.cycles.find((c) => c.status === '진행')!)
    const c = createCycle(s, { name: 't', period: '', dueDate: '', presetId: 'A', templateByJob: DEFAULT_TEMPLATE_BY_JOB, targetIds: eligibleTargets(s).map((e) => e.id) })
    check(c)
    // 마감·확정 회차에는 만들지 않음
    expect(s.cycles.filter((x) => x.status === '마감' || x.status === '확정').every((x) => !x.assignments.some((a) => a.direction === 'up'))).toBe(true)
  })
  it('모든 대상자에게 자기평가가 있고, 팀장은 자기평가와 팀원 평가를 함께 가진다', () => {
    const s = createSeed()
    const c = s.cycles[0]
    for (const t of c.targets) expect(c.assignments.some((a) => a.targetId === t.employeeId && a.direction === 'self')).toBe(true)
    // 현재 팀장(D-076: 응답 없는 팀장평가는 현재 팀장 기준으로 정리)
    for (const lead of c.targets.filter((t) => s.teams.some((x) => !x.archived && x.leadId === t.employeeId))) {
      expect(c.assignments.some((a) => a.targetId === lead.employeeId && a.evaluatorId === lead.employeeId && a.direction === 'self')).toBe(true)
      expect(c.assignments.some((a) => a.evaluatorId === lead.employeeId && a.direction === 'down' && a.targetId !== lead.employeeId)).toBe(true)
    }
  })
  it('평가자는 자기 자신을 후속 평가하지 않는다', () => {
    const s = createSeed()
    for (const a of s.cycles[0].assignments) if (a.direction !== 'self') expect(a.evaluatorId).not.toBe(a.targetId)
  })
  it('새 시드는 개인 링크를 만들지 않는다 (사번 로그인)', () => {
    expect(createSeed().tokens).toEqual([])
  })
})

describe('진행현황 집계 (대상자 단위)', () => {
  const sub = (s: AppState, id: string) => { s.responses[id] = { assignmentId: id, answers: {}, status: 'submitted', savedAt: '', submittedAt: '', lang: 'ko' } }

  it('카드 수치가 대상자별 단계 상태와 일치한다', () => {
    const s = createSeed()
    const c = s.cycles[0]
    const n = cycleCounts(c, s.responses, s.employees)
    const ts = activeTargets(c, s.employees)
    expect(n.targets).toBe(ts.length)
    const cells = ts.map((t) => targetCells(c, s.responses, t, 3))
    expect(n.completeTargets).toBe(cells.filter((x) => targetSummary(x).complete).length)
    for (const st of n.byStage) {
      const col = cells.map((x) => x[st.order - 1])
      expect(st.assigned).toBe(col.filter((x) => x.status !== 'na' && x.status !== 'unassigned').length)
      expect(st.submitted).toBe(col.filter((x) => x.status === 'submitted').length)
      expect(st.submitted).toBeLessThanOrEqual(st.assigned)
    }
  })
  it('팀장의 2단계는 "해당 없음"(분모·미완료 제외), 팀장 임원평가는 3단계 (D-068)', () => {
    const s = createSeed()
    s.responses = {}
    const c = s.cycles[0]
    const lead = c.targets.find((t) => t.isTeamLead)!
    expect([...new Set(c.assignments.filter((a) => a.targetId === lead.employeeId).map((a) => a.stageOrder))].sort()).toEqual([1, 3])
    c.assignments.filter((a) => a.targetId === lead.employeeId).forEach((a) => sub(s, a.id))
    const cells = targetCells(c, s.responses, lead, 3)
    expect(cells.map((x) => x.status)).toEqual(['submitted', 'na', 'submitted'])
    expect(targetSummary(cells).complete).toBe(true)
    const n = cycleCounts(c, s.responses, s.employees)
    expect(n.byStage[1].assigned).toBe(c.targets.filter((t) => !t.isTeamLead && !t.isExecutive).length)
    expect(n.completeTargets).toBe(1)
  })
  it('대표 확정 여부는 제출 완료 집계에 영향이 없다', () => {
    const s = createSeed()
    const c = s.cycles[0]
    const before = cycleCounts(c, s.responses, s.employees).completeTargets
    s.adjustments.push({ id: 'x', cycleId: c.id, kind: 'ceoGrade', targetKey: c.targets[0].employeeId, value: 'A', reason: '', by: '', at: '', before: null })
    expect(cycleCounts(c, s.responses, s.employees).completeTargets).toBe(before)
  })
  it('한 단계에 평가자가 둘이면 둘 다 제출해야 그 단계 완료', () => {
    const s = createSeed()
    s.responses = {}
    const c = s.cycles[0]
    const t = c.targets.find((x) => !x.isTeamLead)!
    const [a1, a2] = c.assignments.filter((a) => a.targetId === t.employeeId).sort((a, b) => a.stageOrder - b.stageOrder)
    c.assignments.push({ ...a2, id: 'extra', evaluatorId: 'e02' })
    sub(s, a1.id); sub(s, a2.id)
    expect(targetCells(c, s.responses, t, 3)[1].status).toBe('draft')
    sub(s, 'extra')
    expect(targetCells(c, s.responses, t, 3)[1].status).toBe('submitted')
  })
  it('평가자가 배정되지 않은 단계는 미완료이고 단계 분모에 남는다(숨기지 않음, D-068)', () => {
    const s = createSeed()
    s.responses = {}
    const c = s.cycles[0]
    const t = c.targets.find((x) => !x.isTeamLead)!
    const mine = c.assignments.filter((a) => a.targetId === t.employeeId)
    mine.forEach((a) => sub(s, a.id))
    c.assignments = c.assignments.filter((a) => !(a.targetId === t.employeeId && a.stageOrder === 3))
    const cells = targetCells(c, s.responses, t, 3)
    expect(cells[2].status).toBe('unassigned')
    expect(targetSummary(cells).complete).toBe(false)
    const n = cycleCounts(c, s.responses, s.employees)
    expect(n.byStage[2].assigned).toBe(c.targets.filter((x) => !x.isTeamLead && !x.isExecutive).length + c.targets.filter((x) => x.isTeamLead).length)
    expect(cardFilter(rowOf(cells), { kind: 'stage', order: 3 }, false)).toBe(true)
  })
  it('비활성·평가 제외된 사람은 집계에서 빠지고, 대상자가 없어도 0으로 나누지 않는다', () => {
    const s = createSeed()
    const c = s.cycles[0]
    const total = cycleCounts(c, s.responses, s.employees).targets
    s.employees.find((e) => e.id === c.targets[0].employeeId)!.active = false
    expect(cycleCounts(c, s.responses, s.employees).targets).toBe(total - 1)
    const empty = { ...c, targets: [], assignments: [] }
    const n = cycleCounts(empty, s.responses, s.employees)
    expect(n.targets).toBe(0)
    expect(n.completeTargets).toBe(0)
    expect(n.byStage.every((b) => b.assigned === 0 && b.submitted === 0)).toBe(true)
  })
})

describe('개인 상세의 미완료 평가 (평가자로서 작성할 배정)', () => {
  it('본인이 평가자인 미제출 배정만, 상태는 미시작·작성 중·선행 단계 대기', () => {
    const s = createSeed()
    const c = s.cycles[0]
    for (const id of new Set(c.assignments.map((a) => a.evaluatorId))) {
      for (const { a, status } of evaluatorTodo(c, s.responses, s.employees, id)) {
        expect(a.evaluatorId).toBe(id)
        expect(statusOf(s.responses, a.id)).not.toBe('submitted')
        expect(status).toBe(assignmentCell(c, s.responses, a))
        expect(['notStarted', 'draft', 'locked']).toContain(status)
      }
    }
  })
  it('팀장: 자기평가와 팀원 평가는 표시, 본인이 받는 임원평가는 표시하지 않음', () => {
    const s = createSeed()
    const c = s.cycles[0]
    delete s.responses[c.assignments.find((a) => a.targetId === 'e13' && a.direction === 'self')!.id] // 오정훈 자기평가를 미제출로(D-082 이후 이준호는 시연 완료 팀장)
    for (const a of c.assignments.filter((x) => x.targetId === 'e13' && x.stageOrder === 3)) delete s.responses[a.id]
    const todo = evaluatorTodo(c, s.responses, s.employees, 'e13')
    expect(todo.some((x) => x.a.direction === 'self' && x.a.targetId === 'e13')).toBe(true)
    expect(todo.some((x) => x.a.direction === 'down' && x.a.targetId !== 'e13')).toBe(true)
    const received = c.assignments.filter((a) => a.targetId === 'e13' && a.evaluatorId !== 'e13' && statusOf(s.responses, a.id) !== 'submitted')
    expect(received.length).toBeGreaterThan(0)
    for (const a of received) expect(todo.some((x) => x.a.id === a.id)).toBe(false)
    expect(todo[0].a.direction).toBe('self') // 자기평가가 맨 위
  })
  it('담당 대상자가 여럿이면 대상자별로 따로 나온다', () => {
    const s = createSeed()
    const c = s.cycles[0]
    const ex = evaluatorTodo(c, s.responses, s.employees, 'e03')
    expect(new Set(ex.map((x) => x.a.targetId)).size).toBe(ex.length)
    expect(ex.length).toBeGreaterThan(1)
  })
  it('선행 단계 대기도 포함, 모두 제출하면 0건', () => {
    const s = createSeed()
    const c = s.cycles[0]
    const all = [...new Set(c.assignments.map((a) => a.evaluatorId))].flatMap((id) => evaluatorTodo(c, s.responses, s.employees, id))
    expect(all.some((x) => x.status === 'locked')).toBe(true)
    for (const a of c.assignments.filter((x) => x.evaluatorId === 'e07')) s.responses[a.id] = { assignmentId: a.id, answers: {}, status: 'submitted', savedAt: '', submittedAt: '', lang: 'ko' }
    expect(evaluatorTodo(c, s.responses, s.employees, 'e07')).toEqual([])
  })
  it('일반 직원도 본인 자기평가가 남아 있으면 표시', () => {
    const s = createSeed()
    const c = s.cycles[0]
    const member = c.targets.find((t) => !t.isTeamLead && statusOf(s.responses, c.assignments.find((a) => a.targetId === t.employeeId && a.direction === 'self')!.id) !== 'submitted')!
    const todo = evaluatorTodo(c, s.responses, s.employees, member.employeeId)
    expect(todo.map((x) => x.a.direction)).toEqual(['self'])
  })
  it('내부 ID로만 연결: 같은 이름 직원이 있어도 섞이지 않고, 평가 대상에서 빠진 대상자의 배정은 제외', () => {
    const s = createSeed()
    const c = s.cycles[0]
    const before = evaluatorTodo(c, s.responses, s.employees, 'e13').map((x) => x.a.id)
    s.employees.find((e) => e.id === 'e08')!.name = '오정훈'
    expect(evaluatorTodo(c, s.responses, s.employees, 'e13').map((x) => x.a.id)).toEqual(before)
    const down = evaluatorTodo(c, s.responses, s.employees, 'e13').find((x) => x.a.direction === 'down')!
    s.employees.find((e) => e.id === down.a.targetId)!.evalExcluded = true
    expect(evaluatorTodo(c, s.responses, s.employees, 'e13').some((x) => x.a.id === down.a.id)).toBe(false)
  })
})

describe('이전 브라우저 저장 데이터 변환 (v1 → v2)', () => {
  function makeV1() {
    const s: any = createSeed({ until: 19 })
    s.schemaVersion = 1
    const c = s.cycles[0]
    // v1 저장 데이터에는 D-114 팀원→팀장평가가 없었음 — 지금 시드의 것을 빼고 이전 상향평가 한 건만 넣는다
    for (const a of c.assignments.filter((x: any) => x.direction === 'up')) delete s.responses[a.id]
    c.assignments = c.assignments.filter((x: any) => x.direction !== 'up')
    c.versions = c.versions.filter((v: any) => v.name !== '팀원→팀장 평가표')
    c.upwardEnabled = true
    c.upwardTemplateId = LEGACY_UPWARD_ID
    c.templates[LEGACY_UPWARD_ID] = { id: LEGACY_UPWARD_ID }
    s.templates.push({ id: LEGACY_UPWARD_ID, version: 1 })
    const lead = c.targets.find((t: any) => t.isTeamLead)
    c.assignments.push({ id: 'up1', targetId: lead.employeeId, evaluatorId: 'e05', direction: 'up', stageOrder: null, templateId: LEGACY_UPWARD_ID })
    s.responses.up1 = { assignmentId: 'up1', answers: {}, status: 'submitted', savedAt: '', submittedAt: '', lang: 'ko' }
    s.tokens.push({ token: 'uponly', cycleId: c.id, employeeId: 'e02', revoked: false })
    s.employees[5].name = '사용자가 바꾼 이름' // 사용자 편집
    return s
  }
  it('상향평가 배정·응답·전용 링크만 제거하고 편집 내용은 보존한다', () => {
    const v1 = makeV1()
    const selfCount = v1.cycles[0].assignments.filter((a: any) => a.direction !== 'up').length
    const m = migrate(v1)!
    const c = m.state.cycles[0] as any
    expect(m.state.schemaVersion).toBe(22)
    // 이전(v1) 상향평가 배정·응답은 지우고, 마감·확정 회차가 아니면 D-114의 새 팀원→팀장평가가 v18에서 따로 생김
    expect(c.assignments.some((a: any) => a.id === 'up1' || a.templateId === LEGACY_UPWARD_ID)).toBe(false)
    expect(c.assignments.filter((a: any) => a.direction !== 'up').length).toBe(selfCount)
    expect(c.assignments.filter((a: any) => a.direction === 'up').every((a: any) => c.templates[a.templateId].name === '팀원→팀장 평가표')).toBe(true)
    expect(c.upwardEnabled).toBeUndefined()
    expect(m.state.responses.up1).toBeUndefined()
    expect(m.state.tokens.some((t) => t.token === 'uponly')).toBe(false)
    expect(m.state.templates.some((t) => t.id === LEGACY_UPWARD_ID)).toBe(false)
    expect(m.state.employees[5].name).toBe('사용자가 바꾼 이름')
    expect(m.notes[0]).toContain('상향평가 배정 1건')
  })
  it('편집된 상향평가 템플릿은 지우지 않는다', () => {
    const v1 = makeV1()
    v1.templates.find((t: any) => t.id === LEGACY_UPWARD_ID).version = 3
    expect(migrate(v1)!.state.templates.some((t) => t.id === LEGACY_UPWARD_ID)).toBe(true)
  })
  it('이미 v2면 그대로, 모르는 구조면 null', () => {
    const s = createSeed()
    expect(migrate(s)!.notes).toEqual([])
    expect(migrate({ schemaVersion: 99 })).toBeNull()
  })
})

describe('회차', () => {
  it('회차는 평가표 복사본을 쓰므로 원본 편집이 기존 회차를 바꾸지 않는다', () => {
    const s = createSeed()
    const c = s.cycles[0]
    const before = c.templates['tpl-draft'].sections[0].questions[0].title
    s.templates.find((t) => t.id === 'tpl-draft')!.sections[0].questions[0].title = '변경됨'
    expect(c.templates['tpl-draft'].sections[0].questions[0].title).toBe(before)
  })
  it('표시용 회차 이름은 시연 설명 괄호만 뺀다', () => {
    expect(cycleLabel({ name: '2026 하반기 인사평가 (가상 회차)' })).toBe('2026 하반기 인사평가')
    expect(cycleLabel({ name: '2027 상반기 (재평가)' })).toBe('2027 상반기 (재평가)')
  })
  it('결과 계산은 KPI를 더하지 않는다', () => {
    const s = createSeed()
    const c = s.cycles[0]
    for (const t of c.targets) {
      const r = personResult(s, c, t.employeeId)!
      if (!r.combined.incomplete) expect(r.combined.afterAdjust).toBeCloseTo(r.combined.base! + (r.dept ?? 0) + (r.person ?? 0))
    }
  })
})

describe('원본 템플릿 보존', () => {
  it('2022 5종·2025 2종이 잠긴 상태로 있다', () => {
    expect(ORIGINAL_TEMPLATES.filter((t) => t.origin === '2022')).toHaveLength(5)
    expect(ORIGINAL_TEMPLATES.filter((t) => t.origin === '2025')).toHaveLength(2)
    expect(ORIGINAL_TEMPLATES.every((t) => t.locked)).toBe(true)
  })
  it('2022 팀원 양식 배점 합계는 100', () => {
    const t = ORIGINAL_TEMPLATES.find((x) => x.id === 't22-om')!
    const sum = t.sections.flatMap((s) => s.questions).reduce((a, q) => a + (q.maxPoints ?? 0), 0)
    expect(sum).toBe(100)
  })
  it('2022 팀장 양식 배점 합계도 100', () => {
    for (const id of ['t22-ol', 't22-pl', 't22-le', 't22-pm']) {
      const t = ORIGINAL_TEMPLATES.find((x) => x.id === id)!
      expect(t.sections.flatMap((s) => s.questions).reduce((a, q) => a + (q.maxPoints ?? 0), 0)).toBe(100)
    }
  })
  it('작업본의 마지막 문항은 건의사항이다', () => {
    const t = makeDraftTemplate()
    const last = t.sections[t.sections.length - 1].questions.at(-1)!
    expect(last.title).toContain('건의')
  })
})

describe('조직 관리 (회사 구분·언어 제거)', () => {
  const csv = (text: string) => parseCsv(text)
  it('회사·언어 열 없이 등록 가능, 사번 앞자리 0 보존, 이전 열 이름(사원번호) 호환', () => {
    const s = createSeed()
    const r = checkRoster(csv('사원번호,이름,팀,직급,직무\n0101,가상신입,설계팀,사원,관리직'), s.employees, s.teams, 'error')
    expect(r.error).toBeNull()
    expect(r.rows[0].errors).toEqual([])
    expect(r.rows[0].v.empNo).toBe('0101')
    expect(canRegister(r)).toBe(true)
    const add = rosterEmployees(r, () => 'new1')
    expect(add[0]).toMatchObject({ id: 'new1', empNo: '0101', teamId: 'tm-design', jobType: 'office', active: true, evalExcluded: false, isExecutive: false })
  })
  it('이전 양식의 회사·언어 열은 무시하고 정상 등록을 막지 않는다', () => {
    const s = createSeed()
    const r = checkRoster(csv('회사,사번,이름,팀,직급,직무,언어\n가상회사 B,0201,가상직원,관리팀,사원,관리직,ky'), s.employees, s.teams, 'error')
    expect(r.ignored).toEqual(['회사', '언어'])
    expect(r.rows[0].errors).toEqual([])
  })
  it('필수 열이 빠지면 행 검증 전에 알린다', () => {
    const s = createSeed()
    expect(checkRoster(csv('사번,이름\n1,a'), s.employees, s.teams, 'error').error).toContain('팀')
  })
  it('빈 값·파일 내 중복·기존 사번·없는 팀·잘못된 직무를 행·열·이유로 표시, 오류가 있으면 등록 안 함', () => {
    const s = createSeed()
    const r = checkRoster(csv('사번,이름,팀,직급,직무\n0101,가,설계팀,사원,관리직\n0101,나,설계팀,사원,관리직\n0012,다,설계팀,사원,관리직\n0103,,없는팀,사원,사무직'), s.employees, s.teams, 'error')
    const e = (line: number) => r.rows.find((x) => x.line === line)!.errors.map((x) => `${x.col}:${x.msg}`)
    expect(e(2)[0]).toContain('사번:파일 안에서 중복 (3행)')
    expect(e(3)[0]).toContain('사번:파일 안에서 중복 (2행)')
    expect(e(4)).toEqual(['사번:이미 등록된 사번 (한승민)'])
    expect(e(5)).toEqual(['이름:비어 있음', '팀:없는 팀', '직무:관리직·생산직 중 하나'])
    expect(r.errorRows).toBe(4)
    expect(canRegister(r)).toBe(false)
    expect(rosterEmployees(r, () => 'x')).toEqual([])
  })
  it('기존 사번은 건너뛰기를 고르면 그 행만 빼고 등록, 말없이 덮어쓰지 않음', () => {
    const s = createSeed()
    const t = csv('사번,이름,팀,직급,직무\n0012,바뀐이름,설계팀,사원,관리직\n0301,신규,설계팀,사원,관리직')
    expect(canRegister(checkRoster(t, s.employees, s.teams, 'error'))).toBe(false)
    const r = checkRoster(t, s.employees, s.teams, 'skip')
    expect([r.addable, r.skipped, r.errorRows]).toEqual([1, 1, 0])
    expect(rosterEmployees(r, (i) => `n${i}`).map((e) => e.empNo)).toEqual(['0301'])
    expect(s.employees.find((e) => e.empNo === '0012')!.name).toBe('한승민')
  })
  it('같은 이름의 팀이 둘이면 자동 연결하지 않고 오류로 알린다', () => {
    const s = createSeed()
    s.teams.push({ id: 'tm-dup', departmentId: 'd-b-prod', name: '설계팀', leadId: null })
    const r = checkRoster(csv('사번,이름,팀,직급,직무\n0301,가상,설계팀,사원,관리직'), s.employees, s.teams, 'error')
    expect(r.rows[0].errors.map((x) => x.msg).join()).toContain('2개')
    const c = nameConflicts(s)
    expect(c.teams.map((t) => t.name)).toEqual(['설계팀'])
    expect(s.teams.filter((t) => t.name === '설계팀')).toHaveLength(2) // 병합하지 않음
  })
  it('CSV: 따옴표 안 쉼표·줄바꿈·"", 빈 줄 무시, CRLF', () => {
    expect(parseCsv('a,"b,c","d\r\ne","f""g"\r\n\r\nh,,i')).toEqual([['a', 'b,c', 'd\r\ne', 'f"g'], [''], ['h', '', 'i']])
    const s = createSeed()
    const r = checkRoster(parseCsv('사번,이름,팀,직급,직무\r\n\r\n"0105","김, 가상",설계팀,"사원",관리직\r\n'), s.employees, s.teams, 'error')
    expect(r.rows).toHaveLength(1)
    expect(r.rows[0]).toMatchObject({ line: 3, errors: [] })
    expect(r.rows[0].v.name).toBe('김, 가상')
  })
  it('CSV 한글 인코딩: UTF-8(BOM 유무)·EUC-KR', async () => {
    const text = '사번,이름,팀,직급,직무\n0101,가상신입,설계팀,사원,관리직'
    const utf8 = new TextEncoder().encode(text)
    expect(decodeText(utf8)).toBe(text)
    expect(decodeText(new Uint8Array([0xef, 0xbb, 0xbf, ...utf8]))).toBe(text)
    // "사번" EUC-KR = BB E7 B9 F8
    expect(decodeText(new Uint8Array([0xbb, 0xe7, 0xb9, 0xf8]))).toBe('사번')
    const r = await readRosterFile('명단.csv', new Uint8Array([0xef, 0xbb, 0xbf, ...utf8]))
    expect(r.ok && r.sheets[0].rows[0][0]).toBe('사번')
  })
  it('지원하지 않는 형식은 거절 (.xls·.txt, 이름만 .xlsx인 CSV)', async () => {
    expect(await readRosterFile('a.xls', new Uint8Array([1]))).toEqual({ ok: false, error: expect.stringContaining('.xlsx') })
    expect(await readRosterFile('a.txt', new Uint8Array([1]))).toMatchObject({ ok: false })
    expect(await readRosterFile('a.xlsx', new TextEncoder().encode('사번,이름'))).toMatchObject({ ok: false, error: expect.stringContaining('엑셀') })
  })
  it('XLSX: 템플릿을 다시 읽으면 머리글·텍스트 사번(앞자리 0)이 그대로', async () => {
    const sheets = await readXlsx(templateXlsx('직원 명단', ['사번', '이름', '팀', '직급', '직무'], [['0007', '김 & <가상>', '설계팀', '사원', '관리직']]))
    expect(sheets[0].name).toBe('직원 명단')
    expect(sheets[0].rows).toEqual([['사번', '이름', '팀', '직급', '직무'], ['0007', '김 & <가상>', '설계팀', '사원', '관리직']])
    const t = await readXlsx(templateXlsxBytes())
    expect(t[0].rows).toEqual([['팀', '직급', '이름', '직무', '사번']]) // D-104: 직원 목록과 같은 순서
    expect(templateCsvText()).toBe('\uFEFF팀,직급,이름,직무,사번\r\n')
    expect(templateCsvText({ customFields: [{ id: 'cf1', name: '근무지, 본사', type: 'text', options: [] }] })).toBe('\uFEFF팀,직급,이름,직무,사번,"근무지, 본사"\r\n')
  })
  it('평가 대상 여부는 재직 여부와 별개', () => {
    const s = createSeed()
    const exec = s.employees.find((e) => e.isExecutive)!
    expect(exec.active).toBe(true)
    expect(s.employees.some((e) => e.isCeo)).toBe(false) // 대표자도 임원으로 통일 (D-068)
    expect(isEvalTarget(exec)).toBe(false)
    expect(isEvalTarget(s.employees.find((e) => e.id === 'e05')!)).toBe(true)
  })
  it('시드 직원에는 언어 지정이 없다 (직원이 응답 화면에서 직접 선택)', () => {
    const s = createSeed()
    expect(s.employees.some((e) => 'preferredLang' in e)).toBe(false)
  })
})

describe('엑셀(.xlsx) 읽기: 여러 시트·공유 문자열·숫자·수식', () => {
  const NS = 'http://schemas.openxmlformats.org'
  // 엑셀이 실제로 쓰는 구조(압축 없음)로 직접 만든 파일: 공유 문자열·숫자 사번·수식 셀·빈 행·두 번째 시트
  const build = async () => {
    const { zipStore } = await import('./xlsx')
    return zipStore([
      { name: 'xl/workbook.xml', data: `<workbook xmlns="${NS}/spreadsheetml/2006/main" xmlns:r="${NS}/officeDocument/2006/relationships"><sheets><sheet name="안내" sheetId="1" r:id="rId1"/><sheet name="명단" sheetId="2" r:id="rId2"/></sheets></workbook>` },
      { name: 'xl/_rels/workbook.xml.rels', data: `<Relationships xmlns="${NS}/package/2006/relationships"><Relationship Id="rId1" Type="${NS}/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${NS}/officeDocument/2006/relationships/worksheet" Target="/xl/worksheets/sheet2.xml"/><Relationship Id="rId3" Type="${NS}/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>` },
      { name: 'xl/sharedStrings.xml', data: `<sst xmlns="${NS}/spreadsheetml/2006/main"><si><t>사원번호</t></si><si><t>이름</t></si><si><t>팀</t></si><si><t>직급</t></si><si><t>직무</t></si><si><r><t>가상</t></r><r><t xml:space="preserve"> 직원</t></r></si><si><t>설계팀</t></si><si><t>사원</t></si><si><t>관리직</t></si><si><t>0012</t></si></sst>` },
      { name: 'xl/worksheets/sheet1.xml', data: `<worksheet xmlns="${NS}/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>안내 시트</t></is></c></row></sheetData></worksheet>` },
      { name: 'xl/worksheets/sheet2.xml', data: `<worksheet xmlns="${NS}/spreadsheetml/2006/main"><cols><col min="1" max="5" width="10"/></cols><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c><c r="D1" t="s"><v>3</v></c><c r="E1" t="s"><v>4</v></c></row><row r="3"><c r="A3"><v>101</v></c><c r="B3" t="s"><v>5</v></c><c r="C3" t="s"><v>6</v></c><c r="D3" t="s"><v>7</v></c><c r="E3" t="str"><f>"관리"&amp;"직"</f><v>관리직</v></c></row><row r="4"><c r="A4" t="s"><v>9</v></c><c r="B4" t="inlineStr"><is><t>다른 직원</t></is></c><c r="C4" t="s"><v>6</v></c><c r="E4" t="s"><v>8</v></c></row></sheetData></worksheet>` },
    ])
  }
  it('시트 목록과 행 번호(빈 행 포함), 공유·서식 문자열, 수식은 저장된 결과값만', async () => {
    const sheets = await readXlsx(await build())
    expect(sheets.map((x) => x.name)).toEqual(['안내', '명단'])
    const rows = sheets[1].rows
    expect(rows[1]).toEqual([])
    expect(rows[2]).toEqual(['101', '가상 직원', '설계팀', '사원', '관리직'])
    expect(rows[3]).toEqual(['0012', '다른 직원', '설계팀', '', '관리직'])
  })
  it('숫자로 저장돼 0이 사라진 사번은 되살리지 않고, 텍스트 사번은 0 보존, 빈 칸은 해당 행·열 오류', async () => {
    const s = createSeed()
    const r = checkRoster((await readXlsx(await build()))[1].rows, s.employees, s.teams, 'skip')
    expect(r.rows.map((x) => [x.line, x.v.empNo])).toEqual([[3, '101'], [4, '0012']])
    expect(r.rows[1].skip).toBe(true) // 기존 0012 → 건너뛰기
    expect(r.rows[1].errors).toEqual([{ col: '직급', msg: '비어 있음' }])
    expect(canRegister(r)).toBe(false)
  })
})


describe('평가 관리 통합 (v3)', () => {
  it('v2 → v3: 전체 공통 가중치를 회차별·경로별 비율(%)로 환산, 사용자 비율 보존', () => {
    const s: any = createSeed({ until: 19 })
    s.schemaVersion = 2
    delete s.cycles[0].stageWeights
    s.policy.stageWeights = { 1: 20, 2: 40, 3: 40 }
    const m = migrate(s)!
    expect(m.state.schemaVersion).toBe(22)
    expect(m.state.cycles[0].stageWeights.member).toEqual({ 1: 20, 2: 40, 3: 40 })
    expect(m.state.cycles[0].stageWeights.lead).toEqual({ 1: 33.3, 3: 66.7 }) // v8: 팀장 임원평가 = 3단계
    expect((m.state.policy as any).stageWeights).toBeUndefined()
    const eq: any = createSeed({ until: 19 }); eq.schemaVersion = 2; delete eq.cycles[0].stageWeights; eq.policy.stageWeights = { 1: 1, 2: 1, 3: 1 }
    // 동일 비중(1:1:1) → 33.3/33.3/33.4(v3) → 이전 개발용 기본값이라 v16에서 자문 초기값 20/40/40 (D-103)
    expect(migrate(eq)!.state.cycles[0].stageWeights.member).toEqual({ 1: 20, 2: 40, 3: 40 })
  })
  it('반영 비율 검증: 미입력·범위 오류를 보정하지 않고 알린다, 합계는 적용 단계 기준 100% 환산(D-103)', () => {
    const st = [{ order: 1, label: '자기' }, { order: 2, label: '팀장' }]
    expect(weightErrors(st, { 1: 50, 2: 50 })).toEqual([])
    expect(weightErrors(st, { 1: 50 })[0]).toContain('입력')
    expect(weightErrors(st, { 1: 20, 2: 40 })).toEqual([]) // 합계 60% — 계산 때 100%로 환산
    expect(weightErrors(st, { 1: 0, 2: 0 })[0]).toContain('모두 0%')
    expect(weightErrors(st, { 1: 150, 2: -50 }).length).toBe(2)
  })
  it('비율 미입력이면 계산하지 않고 0으로 처리하지 않는다', () => {
    const r = combine2({ stages: [{ score: 80, weight: null, submitted: true }], dept: null, person: null, ceoScore: null })
    expect(r.base).toBeNull()
    const s = createSeed()
    const c = s.cycles[0]
    c.stageWeights.member = { 1: 50, 2: 30, 3: null } // 3단계 미입력
    fillRest(s, c)
    const done = c.targets.find((t) => !t.isTeamLead && personResult(s, c, t.employeeId)!.stages.every((x) => x.submitted))!
    const pr = personResult(s, c, done.employeeId)!
    expect(pr.combined.base).toBeNull()
    expect(pr.combined.note).toContain('입력')
    // 합계 90%는 오류가 아니라 적용 단계 기준 100%로 환산 (D-103)
    c.stageWeights.member = { 1: 50, 2: 30, 3: 10 }
    const p2 = personResult(s, c, done.employeeId)!
    const exp = p2.stages.reduce((a, x) => a + x.score! * x.weight!, 0) / 90
    expect(p2.combined.base).toBeCloseTo(exp, 6)
  })
  it('평가 복제: 문항·경로·비율·대상자를 가져오고 응답·결과는 가져오지 않는다', () => {
    const s = createSeed()
    const src = s.cycles[0]
    const c = cloneCycle(s, src, '복제 평가')
    expect(c.id).not.toBe(src.id)
    expect(c.status).toBe('준비')
    expect(c.stageWeights).toEqual(src.stageWeights)
    expect(c.targets.length).toBe(src.targets.length)
    expect(c.assignments.some((a) => s.responses[a.id])).toBe(false)
    expect(c.assignments.some((a) => src.assignments.some((b) => b.id === a.id))).toBe(false)
    c.templates['tpl-draft'].sections[0].questions[0].title = '복제본만 수정'
    expect(src.templates['tpl-draft'].sections[0].questions[0].title).not.toBe('복제본만 수정')
  })
  it('대상자 변경: 응답 있는 사람은 빼지 않고, 추가한 사람은 배정이 생긴다', () => {
    const s = createSeed()
    const c = s.cycles[0]
    const withResp = c.targets.find((t) => c.assignments.some((a) => a.targetId === t.employeeId && s.responses[a.id]))!
    const noResp = c.targets.find((t) => !c.assignments.some((a) => a.targetId === t.employeeId && s.responses[a.id]))!
    const ids = c.targets.map((t) => t.employeeId).filter((id) => id !== withResp.employeeId && id !== noResp.employeeId)
    const blocked = setTargets(s, c, [...ids, 'e26'])
    expect(blocked).toEqual([withResp.name])
    expect(c.targets.some((t) => t.employeeId === noResp.employeeId)).toBe(false)
    expect(c.assignments.some((a) => a.targetId === noResp.employeeId)).toBe(false)
    expect(c.assignments.some((a) => a.targetId === 'e26' && a.direction === 'self')).toBe(true)
  })
  it('배정 점검: 본인 후속평가·중복·평가자 없음을 찾는다', () => {
    const s = createSeed()
    const c = s.cycles[0]
    expect(assignmentProblems(s, c)).toEqual([])
    const downs = c.assignments.filter((x) => x.direction === 'down')
    c.assignments.push({ ...downs[1], id: 'dup' })
    downs[0].evaluatorId = downs[0].targetId
    const p = assignmentProblems(s, c).join(' / ')
    expect(p).toContain('본인이 본인을')
    expect(p).toContain('중복')
  })
  it('문항 적용 범위: 평가 유형·직무·대상을 구분 (팀장 자기평가 ≠ 팀원이 받는 팀장평가)', () => {
    const q = newQuestion('long')
    q.title = 't'; q.rules = ['teamLead']; q.directions = ['down']; q.jobs = ['production']; q.targetRoles = ['member']
    expect(applies(q, { direction: 'down', rule: 'teamLead', jobType: 'production', isLead: false })).toBe(true)
    expect(applies(q, { direction: 'down', rule: 'executive', jobType: 'production', isLead: false })).toBe(false)
    expect(applies(q, { direction: 'self', rule: 'self', jobType: 'production', isLead: true })).toBe(false)
    expect(applies(q, { direction: 'down', rule: 'teamLead', jobType: 'office', isLead: false })).toBe(false)
    const s = createSeed()
    const c = s.cycles[0]
    const leadSelf = c.assignments.find((a) => a.direction === 'self' && c.targets.find((t) => t.employeeId === a.targetId)!.isTeamLead)!
    expect(ctxFor(c, leadSelf)).toMatchObject({ direction: 'self', rule: 'self', isLead: true })
    const byLead = c.assignments.find((a) => a.stageOrder === 2 && !c.targets.find((t) => t.employeeId === a.targetId)!.isTeamLead)!
    expect(ctxFor(c, byLead).rule).toBe('teamLead')
  })
  it('문항 검증: 빈 점수를 0점으로 두지 않고, 서술형은 점수 반영 불가', () => {
    const q = newQuestion('single'); q.title = 'x'; q.purpose = 'score'
    expect(validateQuestion(q).join()).toContain('모든 선택지에 점수')
    const t = newQuestion('long'); t.title = 'y'; t.purpose = 'score'
    expect(validateQuestion(t).join()).toContain('배점을 입력') // D-103: 배점 없는 서술형은 점수 반영 불가
    t.points = 10
    expect(validateQuestion(t)).toEqual([]) // 배점이 있으면 관리자 채점 문항
    const ok = newQuestion('scale5'); ok.title = 'z'
    expect(validateQuestion(ok)).toEqual([])
  })
  it('문항 CSV: 정상 행·오류 행·무시 열', () => {
    const r = parseQuestionCsv('영역,질문,유형,필수,선택지,선택지점수,적용평가,비고\n성과,질문1,5점 척도,Y,,,자기|팀장,메모\n성과,질문2,객관식,N,상|하,2|1,임원,\n성과,질문3,표,Y,,,자기,\n성과,질문4,단일선택,Y,a|b,1,자기,')
    expect(r.ignored).toEqual(['비고'])
    expect(r.rows[0].question?.rules).toEqual(['self', 'teamLead'])
    expect(r.rows[1].question?.options.map((o) => o.value)).toEqual([2, 1])
    expect(r.rows[1].question?.required).toBe(false)
    expect(r.rows[2].question?.type).toBe('long') // D-120: 모르는 유형은 막지 않고 긴 서술형으로(안내 표시)
    expect(r.rows[2].notes?.[0]).toContain("유형 '표'")
    expect(r.rows[3].errors[0]).toContain('선택지점수')
  })
  it('응답 수 계산은 회차 안에서만 센다', () => {
    const s = createSeed()
    const c = s.cycles[0]
    expect(answeredCount(s, c, 'd-s1')).toBeGreaterThan(0)
    const clone = cloneCycle(s, c, 'x')
    expect(answeredCount(s, clone, 'd-s1')).toBe(0)
  })
})


describe('응답 화면 개발용 문구', () => {
  it('기본 문항 도움말에 개발 설명이 없다', () => {
    const t = makeDraftTemplate()
    const helps = t.sections.flatMap((x) => x.questions).map((q) => q.help).join(' ')
    expect(helps).not.toMatch(/개발용|환산|미정|게시판|가이드라인/)
  })
  it('이전 데이터의 개발용 도움말은 정확히 같은 문구만 지우고 사용자 도움말은 보존', () => {
    const s: any = createSeed({ until: 19 })
    s.schemaVersion = 2
    delete s.cycles[0].stageWeights
    s.policy.stageWeights = { 1: 1, 2: 1, 3: 1 }
    const q0 = s.cycles[0].templates['tpl-draft'].sections[1].questions[0]
    q0.help = '평가영역 문구는 2025 가이드라인 기준. 1~5점 환산은 개발용 가정.'
    const q1 = s.cycles[0].templates['tpl-draft'].sections[2].questions[0]
    q1.help = '사용자가 쓴 도움말'
    const m = migrate(s)!
    const t = m.state.cycles[0].templates['tpl-draft']
    expect(t.sections[1].questions[0].help).toBe('')
    expect(t.sections[2].questions[0].help).toBe('사용자가 쓴 도움말')
  })
})

describe('목업 로그인·역할 (실제 보안 인증 아님) — 직원: 아이디 이름 · 비밀번호 사번 (D-059)', () => {
  const login = (s: AppState, id: string, pw: string) => { const a = checkLogin(s, id, pw); if (typeof a === 'string') throw new Error(a); return a }
  it('빈 입력·없는 계정·틀린 비밀번호는 오류, 운영담당자는 기존 방식', () => {
    const s = createSeed()
    expect(checkLogin(s, '', '')).toContain('입력하세요')
    expect(checkLogin(s, 'admin', '')).toContain('입력하세요')
    expect(checkLogin(s, 'nobody', DEMO_PASSWORD)).toContain('올바르지 않습니다')
    expect(checkLogin(s, 'admin', 'wrong')).toContain('올바르지 않습니다')
    expect(login(s, ' admin ', DEMO_PASSWORD).kind).toBe('admin')
    expect(login(s, 'admin-final', DEMO_PASSWORD).finalAdjust).toBe(true)
  })
  it('직원은 이름 + 사번(앞자리 0까지), 내부 ID로 연결, 데모 비밀번호로는 안 됨', () => {
    const s = createSeed()
    expect(login(s, '강태영', '0007').personaId).toBe('e07')
    expect(checkLogin(s, '강태영', '7')).toContain('올바르지 않습니다')
    expect(checkLogin(s, '강태영', DEMO_PASSWORD)).toContain('올바르지 않습니다')
    expect(checkLogin(s, '0007', '0007')).toContain('올바르지 않습니다')
    expect(checkLogin(s, '강태영', '0008')).toContain('올바르지 않습니다') // 다른 직원 사번
  })
  it('조직 관리에 새로 추가·업로드한 직원도 바로 로그인 (고정 목록 아님)', () => {
    const s = createSeed()
    s.employees.push({ ...s.employees.find((e) => e.id === 'e05')!, id: 'e-new', empNo: '0901', name: '신규직원' })
    expect(login(s, '신규직원', '0901').personaId).toBe('e-new')
    expect(sessionFor(s, participantAccount('e-new'))).toMatchObject({ role: 'member', personaId: 'e-new' })
  })
  it('이름·사번을 바꾸면 새 조합만, 기존 세션은 내부 ID로 유지', () => {
    const s = createSeed()
    const e = s.employees.find((x) => x.id === 'e05')!
    e.name = '최대리'; e.empNo = '1005'
    expect(checkLogin(s, '최유진', '0005')).toContain('올바르지 않습니다')
    expect(checkLogin(s, '최대리', '0005')).toContain('올바르지 않습니다')
    expect(checkLogin(s, '최유진', '1005')).toContain('올바르지 않습니다')
    expect(login(s, '최대리', '1005').personaId).toBe('e05')
    expect(sessionFor(s, participantAccount('e05'))?.personaId).toBe('e05')
  })
  it('동명이인은 사번으로 구분, 삭제(재직 해제·데이터 제거)하면 로그인·세션 모두 차단', () => {
    const s = createSeed()
    s.employees.push({ ...s.employees.find((e) => e.id === 'e08')!, id: 'e-twin', name: '강태영', empNo: '0907' })
    expect(login(s, '강태영', '0007').personaId).toBe('e07')
    expect(login(s, '강태영', '0907').personaId).toBe('e-twin')
    deleteEmployee(s, 'e07') // 기록 있음 → 재직 해제
    expect(checkLogin(s, '강태영', '0007')).toContain('올바르지 않습니다')
    expect(sessionFor(s, participantAccount('e07'))).toBeNull()
    deleteEmployee(s, 'e-twin') // 기록 없음 → 데이터에서 제거
    expect(checkLogin(s, '강태영', '0907')).toContain('올바르지 않습니다')
    expect(sessionFor(s, participantAccount('e-twin'))).toBeNull()
    expect(s.cycles[0].assignments.some((a) => a.evaluatorId === 'e07')).toBe(true) // 평가자료 연결 그대로
  })
  it('역할은 현재 조직 정보로: 팀장 지정·해제, 임원 지정 — 운영담당자 권한은 생기지 않음', () => {
    const s = createSeed()
    const role = () => sessionFor(s, participantAccount('e08'))!.role
    expect(role()).toBe('member')
    s.teams.find((t) => t.id === 'tm-sales')!.leadId = 'e08'
    expect(role()).toBe('lead')
    s.employees.find((e) => e.id === 'e08')!.isExecutive = true
    expect(role()).toBe('exec')
    for (const act of ['viewProgress', 'editPeople', 'manageCycles', 'viewResults', 'adjust', 'editKpi', 'reportPreview'] as const) expect(can(role(), act)).toBe(false)
  })
  it('팀만 바꿔도 과거 회차 대상자 스냅샷·배정·응답은 그대로', () => {
    const s = createSeed()
    const before = JSON.stringify([s.cycles, s.responses])
    s.employees.find((e) => e.id === 'e09')!.teamId = 'tm-design'
    expect(JSON.stringify([s.cycles, s.responses])).toBe(before)
    expect(sessionFor(s, participantAccount('e09'))?.personaId).toBe('e09')
  })
  it('대표자였던 직원은 임원으로 로그인(관리 권한 없음), 최종 조정은 최종 조정 표시 운영담당자만', () => {
    const s = createSeed()
    const ceo = checkLogin(s, '홍성훈', '0001')
    expect(typeof ceo === 'object' && sessionFor(s, ceo)!.role).toBe('exec')
    const [plain, final] = ADMIN_ACCOUNTS
    expect(canFinalAdjust(sessionFor(s, final)!)).toBe(true)
    expect(canFinalAdjust(sessionFor(s, plain)!)).toBe(false)
    expect(canFinalAdjust(sessionFor(s, participantAccount('e07'))!)).toBe(false)
  })
  it('평가 참여자에게 운영 권한 없음, 평가 작성 권한은 참여자만', () => {
    for (const r of ['member', 'lead', 'exec'] as const) {
      for (const act of ['viewProgress', 'editPeople', 'manageCycles', 'viewResults', 'adjust', 'editKpi', 'reportPreview'] as const) expect(can(r, act)).toBe(false)
      expect(can(r, 'evaluate')).toBe(true)
    }
    expect(can('admin', 'evaluate')).toBe(false)
  })
})


describe('부서 KPI (목업 제안 정책, 회사 승인 산식 아님)', () => {
  const ind = (p: Partial<KpiIndicator>): KpiIndicator => ({ id: Math.random().toString(36), cycleId: 'c', departmentId: 'd', name: 'x', unit: 'percent', direction: 'higher', target: 100, actual: 100, weight: 100, ...p })
  it('높을수록 좋음: 목표 85 실적 80 → 약 94.1', () => {
    const r = indicatorResult(ind({ target: 85, actual: 80 }))
    expect(r.score).toBeCloseTo(94.1176, 3)
  })
  it('낮을수록 좋음: 목표 8 실적 6 → 달성률 133.3%, 점수 100', () => {
    const r = indicatorResult(ind({ direction: 'lower', target: 8, actual: 6 }))
    expect(r.rate).toBeCloseTo(133.333, 2)
    expect(r.score).toBe(100)
  })
  it('낮을수록 좋음: 실적 0 → 목표 달성 100점, 무한대 없음', () => {
    const r = indicatorResult(ind({ direction: 'lower', target: 8, actual: 0 }))
    expect(r).toMatchObject({ score: 100, status: 'targetMet', rate: null })
  })
  it('높을수록 좋음: 목표 10 실적 0 → 0점', () => {
    expect(indicatorResult(ind({ target: 10, actual: 0 }))).toMatchObject({ rate: 0, score: 0 })
  })
  it('목표 0·음수는 저장 단계에서 막고, 미입력은 미완료(0점 아님)', () => {
    expect(indicatorErrors({ name: 'a', target: 0, actual: 5, weight: 50 }).join()).toContain('목표값이 0')
    expect(indicatorErrors({ name: 'a', target: -1, actual: 5, weight: 50 }).join()).toContain('0 이상')
    expect(indicatorErrors({ name: 'a', target: 5, actual: null, weight: 50 })).toEqual([])
    expect(indicatorResult(ind({ actual: null }))).toMatchObject({ score: null, status: 'incomplete' })
  })
  const st = (inds: KpiIndicator[], kpi: any[] = []) => ({ kpi, kpiIndicators: inds })
  it('여러 지표: 지표별 상한 후 가중합', () => {
    const d = deptKpi(st([ind({ target: 50, actual: 100, weight: 60 }), ind({ target: 100, actual: 50, weight: 40 })]), 'c', 'd')
    expect(d.score).toBeCloseTo(100 * 0.6 + 50 * 0.4) // 200% → 100으로 제한 후 가중
  })
  it('가중치 합계 오류·미입력·미입력 지표는 설정 미완료 (재정규화 없음)', () => {
    expect(deptKpi(st([ind({ weight: 60 }), ind({ weight: 30 })]), 'c', 'd')).toMatchObject({ score: null, status: 'incomplete' })
    expect(deptKpi(st([ind({ weight: 60 }), ind({ weight: null })]), 'c', 'd').status).toBe('incomplete')
    expect(deptKpi(st([ind({ weight: 50 }), ind({ weight: 50, actual: null })]), 'c', 'd').score).toBeNull()
    expect(deptKpi(st([]), 'c', 'd').status).toBe('empty')
  })
  it('직접 입력 점수와 지표 계산은 합산하지 않는다 (출처 하나만 사용)', () => {
    const inds = [ind({ target: 100, actual: 50, weight: 100 })]
    expect(deptKpi(st(inds, [{ cycleId: 'c', departmentId: 'd', score: 88, mode: 'manual' }]), 'c', 'd').score).toBe(88)
    expect(deptKpi(st(inds, [{ cycleId: 'c', departmentId: 'd', score: 88, mode: 'indicators' }]), 'c', 'd').score).toBe(50)
    expect(deptKpi(st(inds, [{ cycleId: 'c', departmentId: 'd', score: 0, mode: 'manual' }]), 'c', 'd').score).toBe(0) // 0은 실제 값
  })
  it('반영 비율: 개인 80·부서 90·80:20 → 82', () => {
    expect(applyBlend(80, { enabled: true, personal: 80, kpi: 20 }, 90).afterKpi).toBeCloseTo(82)
  })
  it('반영 끔 → 기초 점수 그대로, 이후 보정·최종 지정 기존대로', () => {
    expect(applyBlend(80, { enabled: false, personal: 80, kpi: 20 }, 90).afterKpi).toBe(80)
    const r = combine2({ stages: [{ score: 80, weight: 100, submitted: true }], dept: 2, person: -1, ceoScore: null, kpi: { blend: { enabled: true, personal: 80, kpi: 20 }, deptScore: 90 } })
    expect(r.base).toBe(80)
    expect(r.afterKpi).toBeCloseTo(82)
    expect(r.afterAdjust).toBeCloseTo(83) // KPI는 보정점으로 다시 더하지 않음
    expect(combine2({ stages: [{ score: 80, weight: 100, submitted: true }], dept: null, person: null, ceoScore: 0, kpi: { blend: { enabled: true, personal: 80, kpi: 20 }, deptScore: 90 } }).final).toBe(0)
  })
  it('KPI는 팀별 선택(D-074): 없으면 개인 점수 그대로(0점·개인 비율만 곱하기 없음), 비율 0·반영 끔도 개인 점수, 실제 0점은 반영', () => {
    const on = { enabled: true, personal: 80, kpi: 20 }
    expect(applyBlend(80, on, 90)).toMatchObject({ afterKpi: 82, applied: true })
    expect(applyBlend(80, on, null)).toMatchObject({ afterKpi: 80, applied: false }) // 64 아님
    expect(applyBlend(80, on, 0)).toMatchObject({ afterKpi: 64, applied: true }) // 유효한 KPI 0점은 실제 0점
    expect(applyBlend(80, { enabled: true, personal: 100, kpi: 0 }, 90)).toMatchObject({ afterKpi: 80, applied: false })
    expect(applyBlend(80, { enabled: false, personal: 80, kpi: 20 }, 90)).toMatchObject({ afterKpi: 80, applied: false })
    expect(applyBlend(null, on, 90)).toMatchObject({ afterKpi: null, applied: false }) // 개인평가 미완료
    // 보정·최종 지정은 이어서 적용
    const r = combine2({ stages: [{ score: 80, weight: 100, submitted: true }], dept: 2, person: -1, ceoScore: null, kpi: { blend: on, deptScore: null } })
    expect([r.afterKpi, r.afterAdjust, r.final, r.kpiApplied, r.incomplete]).toEqual([80, 81, 81, false, false])
    expect(combine2({ stages: [{ score: 80, weight: 100, submitted: true }], dept: null, person: null, ceoScore: 70, kpi: { blend: on, deptScore: null } }).final).toBe(70)
  })
  it('KPI 상태 구분: 없음 / 정상 / 설정 미완료 — 미완료 KPI는 결과에서 개인 점수로 계산, 반영 켜면 정상 KPI만 섞음', async () => {
    const { kpiState } = await import('./kpi')
    const s = createSeed(); const c = s.cycles[0]
    c.kpiBlend = { enabled: true, personal: 80, kpi: 20 }
    fillRest(s, c)
    const t = c.targets.find((x) => personResult(s, c, x.employeeId)!.combined.base !== null && x.departmentId !== 'tm-design')!
    const dept = t.departmentId
    expect(kpiState(deptKpi(s, c.id, dept))).toBe('none')
    let r = personResult(s, c, t.employeeId)!
    expect(r.combined.kpiApplied).toBe(false)
    expect(r.combined.afterKpi).toBe(r.combined.base) // KPI 없는 팀도 최종 점수 계산
    expect(r.combined.final).not.toBeNull()
    // 지표 등록했지만 가중치 합계 오류 → 설정 미완료(정상 KPI 아님) → 개인 점수
    s.kpiIndicators.push({ id: 'k1', cycleId: c.id, departmentId: dept, name: '가상 지표', unit: 'percent', direction: 'higher', target: 100, actual: 90, weight: 60 })
    expect(kpiState(deptKpi(s, c.id, dept))).toBe('invalid')
    r = personResult(s, c, t.employeeId)!
    expect([r.kpi, r.combined.kpiApplied, r.combined.afterKpi]).toEqual([null, false, r.combined.base])
    // 완성(가중치 100) → 정상 반영
    s.kpiIndicators[s.kpiIndicators.length - 1].weight = 100
    expect(kpiState(deptKpi(s, c.id, dept))).toBe('ok')
    r = personResult(s, c, t.employeeId)!
    expect(r.combined.kpiApplied).toBe(true)
    expect(r.combined.afterKpi).toBeCloseTo(r.combined.base! * 0.8 + 90 * 0.2)
  })
  it('비율 검증: 합계 100·각 0~100', () => {
    expect(blendErrors({ personal: 80, kpi: 20 })).toEqual([])
    expect(blendErrors({ personal: 80, kpi: 30 })[0]).toContain('110%')
    expect(blendErrors({ personal: 120, kpi: -20 }).length).toBe(2)
    expect(blendErrors({ personal: null, kpi: 20 })[0]).toContain('입력')
    expect(applyBlend(80, { enabled: true, personal: 70, kpi: 20 }, 90)).toMatchObject({ afterKpi: 80, applied: false }) // 비율 오류는 반영하지 않음(화면에서 저장도 막음)
  })
  it('부서는 회차 시작 시점 소속 기준: 팀을 옮겨도 과거 회차 KPI 그대로', () => {
    const s = createSeed()
    const c = s.cycles[0]
    c.kpiBlend = { enabled: true, personal: 80, kpi: 20 }
    const before = personResult(s, c, 'e11')! // 설계팀 (기술부 → 설계팀 1:1로 옮긴 KPI 92)
    expect(before.kpi).toBe(92)
    s.employees.find((e) => e.id === 'e11')!.teamId = 'tm-prod1' // 생산팀으로 이동
    expect(personResult(s, c, 'e11')!.kpi).toBe(92)
    expect(personResult(s, c, 'e11')!.combined.afterKpi).toBeCloseTo(before.combined.afterKpi!)
  })
  it('v3 → v4: 직접 입력 점수 보존·출처 표시, 기존 회차 반영 끔', () => {
    const s: any = createSeed({ until: 19 })
    s.schemaVersion = 3
    delete s.kpiIndicators
    s.kpi = [{ cycleId: s.cycles[0].id, departmentId: 'd-a-mgmt', score: 77, range: '0~100', unit: '점', source: '사용자', basisPeriod: 'x' }]
    delete s.cycles[0].kpiBlend
    const m = migrate(s)!
    expect(m.state.schemaVersion).toBe(22)
    expect(m.state.kpi[0]).toMatchObject({ score: 77, mode: 'manual', source: '사용자' })
    expect(m.state.kpiIndicators).toEqual([])
    expect(m.state.cycles[0].kpiBlend).toEqual({ enabled: false, personal: null, kpi: null })
  })
})

describe('직원 삭제 (D-053)', () => {
  it('평가 기록이 있는 팀장: 데이터 보존(재직 해제), 팀장 연결 해제, 배정·응답 그대로', () => {
    const s = createSeed()
    const before = JSON.stringify([s.cycles, s.responses, s.adjustments])
    const e07 = s.employees.find((e) => e.id === 'e07')!
    deleteEmployee(s, 'e07')
    const after = s.employees.find((e) => e.id === 'e07')!
    expect(after).toEqual({ ...e07, active: false })
    expect(s.teams.find((t) => t.id === 'tm-sales')!.leadId).toBeNull()
    expect(JSON.stringify([s.cycles, s.responses, s.adjustments])).toBe(before)
  })
  it('기록 없는 새 직원은 데이터에서도 제거, 다른 직원 값은 그대로', () => {
    const s = createSeed()
    s.employees.push({ ...s.employees.find((e) => e.id === 'e05')!, id: 'e-new', empNo: '9001', name: '새직원' })
    const others = JSON.stringify(s.employees.filter((e) => e.id !== 'e-new'))
    deleteEmployee(s, 'e-new')
    expect(s.employees.some((e) => e.id === 'e-new')).toBe(false)
    expect(JSON.stringify(s.employees)).toBe(others)
  })
})

describe('평가 상태 4가지 (D-054)', () => {
  it("v4 저장 데이터의 '보정검토' 회차 → '마감', 응답·보정·배정·다른 회차 그대로", () => {
    const s: any = createSeed({ until: 19 })
    s.schemaVersion = 4
    s.cycles[0].status = '보정검토'
    const other = { ...structuredClone(s.cycles[0]), id: 'c-other', status: '확정' }
    s.cycles.push(other)
    const before = JSON.stringify([s.responses, s.adjustments, s.kpi, s.cycles[0].assignments, s.cycles[0].targets, s.cycles[0].templates])
    const m = migrate(s)!
    expect(m.state.schemaVersion).toBe(22)
    expect(m.state.cycles.map((c) => c.status)).toEqual(['마감', '확정'])
    const c = m.state.cycles[0]
    expect(JSON.stringify([m.state.responses, m.state.adjustments, m.state.kpi, c.assignments, c.targets, c.templates])).toBe(before)
    expect(m.notes.join()).toContain('마감')
  })
  it('다른 상태의 회차는 바꾸지 않는다', () => {
    const s: any = createSeed({ until: 19 })
    s.schemaVersion = 4
    const m = migrate(s)!
    expect(m.state.cycles[0].status).toBe('진행')
    expect(m.notes.some((n) => n.includes('마감'))).toBe(false)
  })
})

describe('진행 현황 카드 = 평가받는 대상자 기준 (D-056·D-057)', () => {
  const setup = (fill = false) => {
    const s = createSeed()
    const c = s.cycles[0]
    if (fill) fillRest(s, c) // 완료된 대상자가 있도록(D-081 이후 임원 3명분 미응답)
    const max = maxStageCount(c)
    const rows = activeTargets(c, s.employees).map((t) => ({ t, cells: targetCells(c, s.responses, t, max) }))
    return { s, c, max, rows }
  }
  const sub = (s: AppState, id: string) => { s.responses[id] = { assignmentId: id, answers: {}, status: 'submitted', savedAt: '', submittedAt: '', lang: 'ko' } }
  it('직원·팀장은 1단계(자기평가) 대상, 임원은 대상자도 자기평가 배정도 없음', () => {
    const { s, c, rows } = setup()
    const execs = s.employees.filter((e) => e.isExecutive).map((e) => e.id)
    expect(c.assignments.some((a) => a.direction === 'self' && execs.includes(a.evaluatorId))).toBe(false)
    expect(rows.filter((r) => inStage(r.cells, 1)).map((r) => r.t.employeeId).sort()).toEqual(rows.map((r) => r.t.employeeId).sort())
    expect(rows.some((r) => r.t.isTeamLead && inStage(r.cells, 1))).toBe(true)
  })
  it('카드 분모 = 그 단계의 고유 대상자 수 = 단계 카드 명단(미완료만 해제) 인원, 3단계 분모는 임원 수가 아님', () => {
    const { s, c, rows } = setup()
    const n = cycleCounts(c, s.responses, s.employees)
    for (const b of n.byStage) {
      // 단계 카드 명단 = 그 단계 미완료자 (D-068). 분모 = 미완료 + 완료
      const list = rows.filter((r) => cardFilter(rowOf(r.cells), { kind: 'stage', order: b.order }, false))
      expect(list.length).toBe(b.assigned - b.submitted)
      expect(new Set(list.map((r) => r.t.employeeId)).size).toBe(list.length)
      expect(list.every((r) => r.cells[b.order - 1].status !== 'submitted' && r.cells[b.order - 1].status !== 'na')).toBe(true)
      const target = new Set(c.assignments.filter((a) => a.stageOrder === b.order).map((a) => a.targetId))
      expect(b.assigned).toBe([...target].filter((id) => rows.some((r) => r.t.employeeId === id)).length)
    }
    const execCount = new Set(c.assignments.filter((a) => a.stageOrder === 3).map((a) => a.evaluatorId)).size
    expect(n.byStage[2].assigned).toBeGreaterThan(execCount)
    expect(rows.filter((r) => cardFilter(rowOf(r.cells), { kind: 'complete' }, false)).length).toBe(n.completeTargets)
    expect(rows.filter((r) => cardFilter(rowOf(r.cells), null, false)).length).toBe(n.targets)
  })
  it('미완료만: 단계 선택 중이면 그 단계 미제출, 아니면 하나라도 미완료 (해당 없음은 미완료 아님)', () => {
    const { rows } = setup(true)
    for (const r of rows) {
      const c2 = r.cells[1]
      expect(cardFilter(rowOf(r.cells), { kind: 'stage', order: 2 }, true)).toBe(inStage(r.cells, 2) && c2.status !== 'submitted')
      expect(cardFilter(rowOf(r.cells), null, true)).toBe(!targetSummary(r.cells).complete)
    }
    const lead = rows.find((r) => r.t.isTeamLead && targetSummary(r.cells).complete)!
    expect(lead.cells[1].status).toBe('na') // 팀장 2단계 = 해당 없음 (D-068)
    expect(cardFilter(rowOf(lead.cells), null, true)).toBe(false)
  })
  it('한 단계에 평가자가 둘이면 대상자 한 행, 모두 제출해야 완료', () => {
    const { s, c, max } = setup()
    const t = c.targets.find((x) => !x.isTeamLead)!
    const st3 = c.assignments.filter((a) => a.targetId === t.employeeId && a.stageOrder <= 2)
    st3.forEach((a) => sub(s, a.id))
    // D-082: 담당 임원 한 명 — 평가자를 하나 더 붙이면(관리자 지정 등) 둘 다 제출해야 완료
    const a3s = c.assignments.filter((a) => a.targetId === t.employeeId && a.stageOrder === 3 && !a.excluded)
    expect(a3s).toHaveLength(1)
    const a3 = a3s[0]
    c.assignments.push({ ...a3, id: 'extra-exec', evaluatorId: 'x-extra' })
    a3s.forEach((a) => sub(s, a.id))
    const cells = () => targetCells(c, s.responses, t, max)
    expect(cells()[2].status).not.toBe('submitted')
    sub(s, 'extra-exec')
    expect(cells()[2].status).toBe('submitted')
    const n = cycleCounts(c, s.responses, s.employees)
    const rows = activeTargets(c, s.employees).filter((x) => inStage(targetCells(c, s.responses, x, max), 3))
    expect(rows.filter((x) => x.employeeId === t.employeeId)).toHaveLength(1)
    expect(n.byStage[2].assigned).toBe(rows.length)
  })
  it('임원이 대상자여도 새 배정에는 임원 자기평가를 만들지 않고, 1단계는 해당 없음', () => {
    const s = createSeed()
    s.employees.find((e) => e.id === 'e02')!.evalExcluded = false
    const c = createCycle(s, { name: 'x', period: '', dueDate: '', presetId: 'A', templateByJob: DEFAULT_TEMPLATE_BY_JOB, targetIds: ['e02', 'e05'] })
    expect(c.assignments.some((a) => a.targetId === 'e02' && a.direction === 'self')).toBe(false)
    expect(c.assignments.some((a) => a.targetId === 'e05' && a.direction === 'self')).toBe(true)
    const t = c.targets.find((x) => x.employeeId === 'e02')!
    expect(t.isExecutive).toBe(true)
    expect(targetCells(c, s.responses, t, maxStageCount(c))[0].status).toBe('na')
  })
  it('v5 데이터의 임원 자기평가: 지우지 않고 제외 표시, 응답 보존, 집계·작성 목록·선행 조건에서 빠짐', () => {
    const s: any = createSeed({ until: 19 })
    s.schemaVersion = 5
    const c = s.cycles[0]
    const t = { ...c.targets.find((x: any) => !x.isTeamLead), employeeId: 'e02', name: '김도현', isTeamLead: true }
    delete t.isExecutive
    c.targets.push(t)
    c.targets.forEach((x: any) => delete x.isExecutive)
    s.employees.find((e: any) => e.id === 'e02').evalExcluded = false
    c.assignments.push({ id: 'old-exec-self', targetId: 'e02', evaluatorId: 'e02', direction: 'self', stageOrder: 1, templateId: c.assignments[0].templateId })
    c.assignments.push({ id: 'old-exec-2', targetId: 'e02', evaluatorId: 'e03', direction: 'down', stageOrder: 2, templateId: c.assignments[0].templateId })
    s.responses['old-exec-self'] = { assignmentId: 'old-exec-self', answers: { x: '1' }, status: 'submitted', savedAt: '', submittedAt: '', lang: 'ko' }
    const respBefore = JSON.stringify(s.responses)
    const m = migrate(s)!
    expect(m.state.schemaVersion).toBe(22)
    const mc = m.state.cycles[0]
    expect(mc.assignments.find((a) => a.id === 'old-exec-self')!.excluded).toBe('execSelf')
    expect(mc.assignments.filter((a) => a.excluded === 'execSelf')).toHaveLength(1)
    expect(JSON.stringify(m.state.responses)).toBe(respBefore)
    expect(mc.targets.find((x) => x.employeeId === 'e02')!.isExecutive).toBe(true)
    expect(mc.targets.find((x) => x.employeeId === 'e05')!.isExecutive).toBe(false)
    const cells = targetCells(mc, m.state.responses, mc.targets.find((x) => x.employeeId === 'e02')!, maxStageCount(mc))
    expect(cells[0].status).toBe('na')
    expect(isUnlocked(mc, m.state.responses, mc.assignments.find((a) => a.id === 'old-exec-2')!)).toBe(true)
    expect(evaluatorTodo(mc, m.state.responses, m.state.employees, 'e02').some((x) => x.a.id === 'old-exec-self')).toBe(false)
    expect(m.notes.join()).toContain('임원 자기평가')
  })
})

describe('응답 화면 칸 진행 표시 (D-058)', () => {
  const setup = () => {
    const s = createSeed()
    const c = s.cycles[0]
    const a = c.assignments.find((x) => x.direction === 'self')!
    return { secs: visibleSections(c.templates[a.templateId], ctxFor(c, a)) }
  }
  it('칸 수 = 실제 화면 수, 필수 화면은 필수 답이 모두 있어야 완료(방문만으로는 아님), 지우면 다시 미완료', () => {
    const { secs } = setup()
    expect(secs.length).toBeGreaterThan(1)
    const passed = new Set(secs.map((x) => x.id)) // 모두 지나갔어도
    const reqSec = secs.findIndex((x) => x.questions.some((q) => q.required))
    expect(screenDone(secs, {}, passed)[reqSec]).toBe(false)
    const ans: Record<string, string | null> = {}
    for (const q of secs[reqSec].questions.filter((q) => q.required)) ans[q.id] = q.options[0]?.id ?? '입력'
    expect(screenDone(secs, ans, new Set())[reqSec]).toBe(true)
    const first = secs[reqSec].questions.find((q) => q.required)!
    expect(screenDone(secs, { ...ans, [first.id]: '  ' }, new Set())[reqSec]).toBe(false)
    expect(screenDone(secs, { ...ans, [first.id]: null }, new Set())[reqSec]).toBe(false)
  })
  it('필수 문항이 없는 화면은 넘긴 뒤에만 완료, 선택 문항 미응답이 필수 완료를 막지 않음', () => {
    const { secs } = setup()
    const opt = { id: 'opt', title: '선택', area: null, questions: secs[0].questions.map((q) => ({ ...q, required: false })) }
    const all = [...secs, opt]
    expect(screenDone(all, {}, new Set()).at(-1)).toBe(false)
    expect(screenDone(all, {}, new Set(['opt'])).at(-1)).toBe(true)
    const mixed = [{ ...secs[0], questions: [{ ...secs[0].questions[0], required: true }, { ...secs[0].questions[0], id: 'o2', required: false }] }]
    expect(screenDone(mixed, { [secs[0].questions[0].id]: 'x' }, new Set())).toEqual([true])
  })
})

describe('팀 관리 (D-064·D-065)', () => {
  it('인원 = 이 팀 소속 재직 직원, 팀장 먼저, 다른 팀 소속 팀장은 세지 않음', () => {
    const s = createSeed()
    expect(teamMembers(s, 'tm-prod2').map((e) => e.id).slice(0, 1)).toEqual(['e17']) // 권민혁(팀장) 먼저
    expect(teamMembers(s, 'tm-prod2')).toHaveLength(10) // D-079 9명 + D-110 임원 1명
    s.teams.find((t) => t.id === 'tm-prod2')!.leadId = 'e05' // 다른 팀 직원을 팀장으로
    expect(teamMembers(s, 'tm-prod2').map((e) => e.id)).not.toContain('e05')
    expect(s.employees.find((e) => e.id === 'e05')!.teamId).toBe('tm-plan') // 소속 자동 변경 없음
    s.employees.find((e) => e.id === 'e19')!.active = false
    expect(teamMembers(s, 'tm-prod2')).toHaveLength(9)
  })
  it('팀 이름: 빈 값·현재 팀과 중복 차단, 자기 자신은 허용', () => {
    const s = createSeed()
    expect(teamNameError(s, '  ')).toContain('입력')
    expect(teamNameError(s, ' 현장팀 ')).toContain('이미')
    expect(teamNameError(s, '현장팀', 'tm-prod2')).toBeNull()
    expect(teamNameError(s, '품질팀')).toBeNull()
  })
  it('빈 팀 삭제 → 데이터에서 제거', () => {
    const s = createSeed()
    s.teams.push({ id: 'tm-new', name: '품질팀', leadId: null })
    expect(deleteTeam(s, 'tm-new', null)).toBeNull()
    expect(s.teams.some((t) => t.id === 'tm-new')).toBe(false)
  })
  it('구성원 있는 팀: 옮길 팀 없으면 막고, 있으면 직원 이동·팀장 해제, 과거 회차·응답·KPI 그대로', () => {
    const s = createSeed()
    const before = JSON.stringify([s.cycles, s.responses, s.kpi, s.kpiIndicators, s.adjustments])
    const nEmp = s.employees.length
    expect(deleteTeam(s, 'tm-prod2', null)).toContain('옮길 팀')
    expect(s.teams.find((t) => t.id === 'tm-prod2')!.archived).toBeFalsy()
    expect(deleteTeam(s, 'tm-prod2', 'tm-prod2')).toContain('옮길 팀')
    expect(deleteTeam(s, 'tm-prod2', 'tm-design')).toBeNull()
    expect(['e17', 'e18', 'e19', 'e20'].map((id) => s.employees.find((e) => e.id === id)!.teamId)).toEqual(['tm-design', 'tm-design', 'tm-design', 'tm-design'])
    expect(s.employees).toHaveLength(nEmp)
    expect(s.teams.some((t) => t.leadId === 'e17')).toBe(false)
    expect(s.teams.find((t) => t.id === 'tm-design')!.leadId).toBe('e10')
    expect(activeTeams(s).some((t) => t.id === 'tm-prod2')).toBe(false)
    expect(JSON.stringify([s.cycles, s.responses, s.kpi, s.kpiIndicators, s.adjustments])).toBe(before)
  })
  it('퇴사 처리된 직원이 가리키는 팀은 숨김으로 남겨 참조가 끊기지 않음', () => {
    const s = createSeed()
    s.employees.find((e) => e.id === 'e19')!.active = false
    expect(deleteTeam(s, 'tm-prod2', 'tm-prod1')).toBeNull()
    const t = s.teams.find((x) => x.id === 'tm-prod2')!
    expect(t.archived).toBe(true)
    expect(t.leadId).toBeNull()
    expect(s.employees.find((e) => e.id === 'e19')!.teamId).toBe('tm-prod2')
    expect(teamNameError(s, '현장팀')).toBeNull() // 삭제한 팀 이름은 다시 쓸 수 있음
  })
})

describe('네 팀 구조·자연스러운 가상 성명 (D-065)', () => {
  /** 이전 버전(v6) 브라우저 데이터처럼: 이전 구조 + 대상자 스냅샷의 조직 = 옛 부서 */
  const v6 = (): AppState => {
    const s = createSeed({ legacy: true })
    for (const c of s.cycles) for (const t of c.targets) {
      const team = s.teams.find((x) => x.id === s.employees.find((e) => e.id === t.employeeId)!.teamId)!
      const d = s.departments.find((x) => x.id === team.departmentId)!
      t.departmentId = d.id; t.departmentName = d.name; t.companyName = s.companies.find((x) => x.id === d.companyId)!.name
    }
    return s
  }
  const team = (s: AppState, n: string) => s.teams.find((t) => !t.archived && t.name === n)!
  it('새 데이터: 같은 수준의 네 팀만 활성, 팀장·인원, 직책 없는 이름', () => {
    const s = createSeed()
    expect(activeTeams(s).map((t) => t.name).sort()).toEqual(['경영기획팀', '생산팀', '설계팀', '현장팀'].sort())
    const sz = (n: string) => teamMembers(s, team(s, n).id).length
    const ex = (n: string) => teamMembers(s, team(s, n).id).filter((e) => e.isExecutive).length
    expect([sz('경영기획팀') - ex('경영기획팀'), sz('설계팀') - ex('설계팀'), sz('생산팀') - ex('생산팀'), sz('현장팀') - ex('현장팀')]).toEqual([4, 7, 11, 9]) // D-079 (임원 제외)
    expect(['경영기획팀', '설계팀', '생산팀', '현장팀'].map((n) => s.employees.find((e) => e.id === team(s, n).leadId)?.name)).toEqual(['이준호', '장현우', '오정훈', '권민혁'])
    expect(s.employees).toHaveLength(35) // D-079
    expect(s.employees.every((e) => !/팀장|사원|임원|반장|작업|대표|가상/.test(e.name))).toBe(true)
    expect(new Set(s.employees.map((e) => e.name)).size).toBe(35)
    const c = s.cycles[0]
    expect(new Set(c.targets.map((t) => t.teamName))).toEqual(new Set(['경영기획팀', '설계팀', '생산팀', '현장팀']))
    expect(c.targets.every((t) => t.departmentId === team(s, t.teamName).id && t.departmentName === t.teamName && !t.companyName)).toBe(true)
  })
  it('v6 저장 데이터 변환: ID·사번·배정·응답·보정 이력 그대로, 이름·소속만 정리', () => {
    const old = v6()
    const m = migrate(structuredClone(old))!
    const s = m.state
    expect(s.schemaVersion).toBe(22)
    const base = s.employees.slice(0, old.employees.length) // D-079 가상 사원은 뒤에 추가
    expect(base.map((e) => [e.id, e.empNo])).toEqual(old.employees.map((e) => [e.id, e.empNo]))
    expect(base.map((e) => e.name)).toEqual(old.employees.map((e) => NEW_NAMES[e.id]))
    // 원래 응답은 그대로(D-082 시연 완료 구성으로 더한 응답은 demo 표시)
    expect(Object.keys(old.responses).every((k) => JSON.stringify(s.responses[k]) === JSON.stringify(old.responses[k]) || (old.responses[k].status === 'draft' && s.responses[k].demo))).toBe(true)
    expect(Object.keys(s.responses).filter((k) => !old.responses[k]).every((k) => s.responses[k].demo)).toBe(true)
    // 비율은 v16(D-103)에서 이전 개발용 기본값 → 20/40/40으로 바뀌므로 같은 변환을 한 이전 데이터와 비교
    const oldV16: any = structuredClone(old); scoringV16(oldV16)
    expect(JSON.stringify([s.cycles[0].stageWeights, s.cycles[0].path])).toBe(JSON.stringify([oldV16.cycles[0].stageWeights, old.cycles[0].path]))
    // 배정: 같은 ID·대상자·단계. 평가자는 응답 없는 배정만 바뀔 수 있음(D-076 현재 팀장 정리·임원 분배)
    // D-079로 추가된 배정(새 팀장평가·새 가상 사원)은 뒤에 붙고, 기존 배정은 지우지 않는다
    const oldIds = new Set(old.cycles[0].assignments.map((a) => a.id))
    expect(s.cycles[0].assignments.filter((a) => oldIds.has(a.id)).map((a) => [a.id, a.targetId, a.direction])).toEqual(old.cycles[0].assignments.map((a) => [a.id, a.targetId, a.direction]))
    for (const a of s.cycles[0].assignments) { const o = old.cycles[0].assignments.find((x) => x.id === a.id); if (o && o.evaluatorId !== a.evaluatorId) expect(old.responses[a.id]).toBeUndefined() }
    // 평가 경로: 현재 사원이 된 이전 팀장(강태영·송하은·배진우)만 사원 경로로(D-079), 나머지 그대로
    const nowStaff = new Set(['e07', 'e21', 'e24'])
    expect(s.cycles[0].targets.filter((t) => old.cycles[0].targets.some((o) => o.employeeId === t.employeeId)).map((t) => t.isTeamLead)).toEqual(old.cycles[0].targets.map((t) => t.isTeamLead && !nowStaff.has(t.employeeId)))
    expect(activeTeams(s).map((t) => t.name).sort()).toEqual(['경영기획팀', '생산팀', '설계팀', '현장팀'].sort())
    expect(s.teams.filter((t) => t.archived).map((t) => t.id).sort()).toEqual(['tm-b-adm', 'tm-b-prod', 'tm-sales'])
    // KPI: 기술부 → 설계팀만 1:1로 옮김. 나머지는 평균·합산하지 않고 원래 키로 보존
    expect(s.kpi.map((k) => [k.departmentId, k.score])).toEqual([['d-a-mgmt', 88], ['tm-design', 92], ['d-a-prod', 0]])
    expect(s.adjustments.find((a) => a.kind === 'dept')!.targetKey).toBe('d-a-prod')
    expect(m.notes.filter((n) => n.startsWith('[재설정 필요]')).length).toBe(2) // KPI 2건(경영지원부 88, 생산부 0)
    expect(m.notes.filter((n) => n.startsWith('[유지]')).length).toBe(1) // 생산부 팀 보정 +1
    expect(m.notes.filter((n) => n.startsWith('팀장 지정안')).length).toBe(3)
    // 새 데이터와 같은 결과
    const fresh = createSeed()
    expect(s.teams.map((t) => [t.id, t.name, t.leadId, !!t.archived])).toEqual(fresh.teams.map((t) => [t.id, t.name, t.leadId, !!t.archived]))
    expect(s.employees.map((e) => [e.id, e.name, e.teamId])).toEqual(fresh.employees.map((e) => [e.id, e.name, e.teamId]))
    // 배정(평가자)도 새 데이터와 같은 구조 — 새 시드에서도 임원 3명 모두 배정을 가진다
    // D-116: 새 데이터는 문태호를 임원 담당 나누기(v15) 전에 참여시키고, 변환은 v19에서(기존 담당을 다시 나누지 않음) 참여시킨다 —
    // 그래서 응답 없는 임원평가의 담당 임원은 다를 수 있음. 대상자·단계 구조와 '대상자당 임원 한 명'은 같게
    const shape = (st: AppState) => st.cycles[0].assignments.map((x) => [x.targetId, x.stageOrder === 3 ? '임원' : x.evaluatorId, x.stageOrder]).sort().join()
    expect(shape(s)).toBe(shape(fresh))
    const execIds = new Set(s.employees.filter((e) => e.isExecutive).map((e) => e.id))
    for (const t of s.cycles[0].targets) expect(s.cycles[0].assignments.filter((x) => x.targetId === t.employeeId && x.stageOrder === 3 && !x.excluded).every((x) => execIds.has(x.evaluatorId))).toBe(true)
    expect(['e02', 'e03', 'e23'].every((id) => fresh.cycles[0].assignments.some((x) => x.evaluatorId === id))).toBe(true)
  })
  it('정리 전후 최종 점수·원점수·보정·KPI 값 그대로 (재계산으로 바뀌지 않음)', () => {
    const old = v6()
    const s = migrate(structuredClone(old))!.state
    // D-079로 경로·팀·팀장평가가 바뀐 사람(이동·이전 팀장·이전 팀장에게 평가받은 사람)은 이 비교에서 뺀다 — 별도 테스트
    const d079 = new Set(['e07', 'e08', 'e09', 'e21', 'e22', 'e24', 'e25'])
    for (const k of Object.keys(s.responses)) if (s.responses[k].demo) delete s.responses[k] // D-082 시연 완료 구성으로 더한 응답은 이 비교(네 팀 정리)와 무관
    const oldV16: any = structuredClone(old); scoringV16(oldV16) // v16(D-103) 배점·비율 변화는 이 비교(네 팀 정리)와 무관 — 같은 변환을 한 이전 데이터와 비교
    for (const t of old.cycles[0].targets.filter((x) => !d079.has(x.employeeId))) {
      const a = personResult(oldV16, oldV16.cycles[0], t.employeeId)!, b = personResult(s, s.cycles[0], t.employeeId)!
      expect([b.combined.final, b.combined.base, b.dept, b.person, b.ceoScore, b.stages.map((x) => x.score)]).toEqual([a.combined.final, a.combined.base, a.dept, a.person, a.ceoScore, a.stages.map((x) => x.score)])
    }
    // 새 팀에 팀 보정을 새로 넣으면 그 팀 기준이 우선
    s.adjustments.push({ id: 'n1', cycleId: s.cycles[0].id, kind: 'dept', targetKey: 'tm-prod2', value: 3, reason: '', by: 'x', at: '', before: null })
    expect(personResult(s, s.cycles[0], 'e18')!.dept).toBe(3)
    expect(personResult(s, s.cycles[0], 'e15')!.dept).toBe(1) // 생산팀(옛 생산부) 사람은 여전히 옛 보정
  })
  it('다시 실행해도 바뀌지 않음 (중복·재이동·재이름 없음)', () => {
    const s = migrate(v6())!.state
    const snap = JSON.stringify(s)
    const notes = reorganizeToFourTeams(s)
    expect(JSON.stringify(s)).toBe(snap)
    expect(notes.some((n) => /이름을|직원 \d+명 →|팀 이름:/.test(n))).toBe(false)
  })
  it('사용자 편집은 보존하고 충돌로 보고', () => {
    const old = v6()
    old.employees.find((e) => e.id === 'e05')!.name = '사용자가바꾼이름'
    old.employees.find((e) => e.id === 'e08')!.teamId = 'tm-design' // 사용자가 옮김
    old.employees.push({ ...old.employees.find((e) => e.id === 'e09')!, id: 'e-user', empNo: '9100', name: '직접추가' }) // 영업팀에 직접 추가
    old.teams.find((t) => t.id === 'tm-prod2')!.name = '조립팀' // 사용자가 팀 이름 변경
    const m = migrate(old)!
    const s = m.state
    expect(s.employees.find((e) => e.id === 'e05')!.name).toBe('사용자가바꾼이름')
    expect(s.employees.find((e) => e.id === 'e08')!.teamId).toBe('tm-design')
    expect(s.employees.find((e) => e.id === 'e-user')!.teamId).toBe('tm-sales')
    expect(s.teams.find((t) => t.id === 'tm-sales')!.archived).toBeFalsy() // 사용자 직원이 있어 남김
    expect(s.teams.find((t) => t.id === 'tm-prod2')!.name).toBe('조립팀')
    expect(m.notes.filter((n) => n.startsWith('[충돌]') || n.startsWith('[보존]')).length).toBeGreaterThanOrEqual(3)
  })
  it('확정된 회차의 소속·이름 스냅샷과 KPI·보정은 그대로', () => {
    const old = v6()
    old.cycles[0].status = '확정'
    const before = JSON.stringify([old.cycles[0].targets, old.kpi, old.adjustments])
    const s = migrate(old)!.state
    expect(JSON.stringify([s.cycles[0].targets, s.kpi, s.adjustments])).toBe(before)
  })
  it('이름 변경 후 새 이름 + 기존 사번으로 로그인, 이전 이름은 차단, 세션은 ID 연결', () => {
    const s = migrate(v6())!.state
    const a = checkLogin(s, '이준호', '0004')
    expect(typeof a === 'object' && a.personaId).toBe('e04')
    expect(checkLogin(s, '이팀장', '0004')).toContain('올바르지 않습니다')
    expect(sessionFor(s, participantAccount('e04'))?.role).toBe('lead')
    expect(sessionFor(s, participantAccount('e07'))?.role).toBe('member') // 합쳐진 팀의 팀장 → 팀원
  })
})

describe('고정 단계 번호·팀장/임원 자기평가·세 직급 (D-068)', () => {
  const sub = (s: AppState, id: string) => { s.responses[id] = { assignmentId: id, answers: {}, status: 'submitted', savedAt: '', submittedAt: '', lang: 'ko' } }
  /** v7 저장 데이터처럼: 팀장 임원평가 = 2단계, 세부 직급 문자열, 대표자 */
  const v7 = (): any => {
    const s: any = createSeed({ until: 19 })
    s.schemaVersion = 7
    const c = s.cycles[0]
    c.path.lead = [{ order: 1, label: '자기평가', direction: 'self', rule: 'self' }, { order: 2, label: '임원평가', direction: 'down', rule: 'executive' }]
    delete c.path.exec; delete c.selfEval; c.stageWeights = { member: { 1: 33.3, 2: 33.3, 3: 33.4 }, lead: { 1: 50, 2: 50 } }
    for (const a of c.assignments) if (c.targets.find((t: any) => t.employeeId === a.targetId)?.isTeamLead && a.stageOrder === 3) a.stageOrder = 2
    const e01 = s.employees.find((e: any) => e.id === 'e01'); e01.isCeo = true; e01.isExecutive = false; e01.position = '대표이사'
    s.employees.find((e: any) => e.id === 'e04').position = '차장'; s.employees.find((e: any) => e.id === 'e05').position = '대리'
    return s
  }
  it('새 데이터: 사원 1·2·3 / 팀장 1·3(2 없음) / 임원은 받는 평가 없음(기본 자기평가 끔), 임원 4명·세 직급', () => {
    const s = createSeed(); const c = s.cycles[0]
    for (const t of c.targets) {
      const orders = c.assignments.filter((a) => a.targetId === t.employeeId && !a.excluded).map((a) => a.stageOrder).sort()
      expect([...new Set(orders)]).toEqual(t.isTeamLead ? [1, 3] : [1, 2, 3])
      expect(orders.filter((o) => o === 3)).toHaveLength(1) // 담당 임원 한 명 (D-082)
    }
    expect(s.employees.filter((e) => e.isExecutive).map((e) => e.name).sort()).toEqual(['김도현', '박재원', '전상철', '홍성훈'].sort())
    expect(new Set(s.employees.map((e) => e.position))).toEqual(new Set(['임원', '팀장', '사원']))
    expect(s.employees.every((e) => e.position === tierOf(s, e))).toBe(true)
    expect(c.targets.some((t) => t.isExecutive)).toBe(false)
  })
  it('v7 → v8: 팀장 임원평가 2 → 3, 같은 배정 ID·응답 그대로, 비율도 같은 유형으로, 자기평가 설정 기록, 반복 실행 안전', () => {
    const old = v7()
    const leadA = old.cycles[0].assignments.find((a: any) => a.stageOrder === 2 && old.cycles[0].targets.find((t: any) => t.employeeId === a.targetId).isTeamLead)
    const resp = JSON.stringify(old.responses)
    const m = migrate(structuredClone(old))!
    const c = m.state.cycles[0]
    expect(m.state.schemaVersion).toBe(22)
    expect(c.assignments.find((a) => a.id === leadA.id)!.stageOrder).toBe(3)
    expect(JSON.stringify(m.state.responses)).toBe(resp)
    expect(c.stageWeights.lead).toEqual({ 1: 20, 3: 40 }) // v8 50/50(같은 유형) → v16 자문 초기값 20/40 (D-103)
    expect(c.path.lead.map((x) => x.order)).toEqual([1, 3])
    expect(c.targets.filter((t) => t.isTeamLead).every((t) => c.selfEval![t.employeeId] === true)).toBe(true)
    expect(m.state.employees.find((e) => e.id === 'e01')).toMatchObject({ isExecutive: true, isCeo: false, position: '임원' })
    expect(m.state.employees.find((e) => e.id === 'e04')!.position).toBe('팀장')
    expect(m.state.employees.find((e) => e.id === 'e05')!.position).toBe('사원')
    expect(m.notes.join()).toContain('2 → 3')
    const snap = JSON.stringify(m.state)
    fixedStagesAndTiers(m.state)
    expect(JSON.stringify(m.state)).toBe(snap)
    // 점수·최종 결과 그대로
    const fresh = createSeed()
    // 시연 완료 구성으로 더한 응답(답은 배정 ID에 따라 다름)이 없는 대상자만 비교
    const demoT = (st: AppState) => new Set(st.cycles[0].assignments.filter((a) => st.responses[a.id]?.demo).map((a) => a.targetId))
    const skip = new Set([...demoT(m.state), ...demoT(fresh)])
    for (const t of c.targets.filter((x) => !skip.has(x.employeeId))) expect(personResult(m.state, c, t.employeeId)!.combined.final).toEqual(personResult(fresh, fresh.cycles[0], t.employeeId)!.combined.final)
  })
  it('확정 회차는 단계 번호를 바꾸지 않음', () => {
    const old = v7(); old.cycles[0].status = '확정'
    const before = JSON.stringify(old.cycles[0].assignments)
    expect(JSON.stringify(migrate(old)!.state.cycles[0].assignments)).toBe(before)
  })
  it('순차 잠금: 사원 1 → 2 → 3, 자기평가 켠 팀장 1 → 3(없는 2단계를 기다리지 않음), 끈 팀장은 3단계 바로', () => {
    const s = createSeed(); s.responses = {}; const c = s.cycles[0]
    const m = c.targets.find((t) => !t.isTeamLead)!, l = c.targets.find((t) => t.isTeamLead)!
    const a = (id: string, o: number) => c.assignments.find((x) => x.targetId === id && x.stageOrder === o && x.direction !== 'up')! // 팀원→팀장평가(1단계 분류, D-114)는 경로 단계가 아님
    expect([isUnlocked(c, s.responses, a(m.employeeId, 2)), isUnlocked(c, s.responses, a(m.employeeId, 3))]).toEqual([false, false])
    sub(s, a(m.employeeId, 1).id)
    expect([isUnlocked(c, s.responses, a(m.employeeId, 2)), isUnlocked(c, s.responses, a(m.employeeId, 3))]).toEqual([true, false])
    expect(isUnlocked(c, s.responses, a(l.employeeId, 3))).toBe(false)
    sub(s, a(l.employeeId, 1).id)
    expect(isUnlocked(c, s.responses, a(l.employeeId, 3))).toBe(true)
    // 다른 팀장: 자기평가 끔 → 3단계 바로
    const l2 = c.targets.filter((t) => t.isTeamLead)[1]
    expect(setSelfEval(s, c.id, l2.employeeId, false)).toBeNull()
    expect(c.assignments.some((x) => x.targetId === l2.employeeId && x.stageOrder === 1 && x.direction === 'self')).toBe(false)
    expect(c.assignments.some((x) => x.targetId === l2.employeeId && x.direction === 'up')).toBe(true) // 팀원→팀장평가는 자기평가 설정과 무관
    expect(isUnlocked(c, s.responses, a(l2.employeeId, 3))).toBe(true)
    expect(targetCells(c, s.responses, l2, 3)[0].status).toBe('na')
  })
  it('임원 자기평가 켜기: 대상자로 들어가 1단계만, 임원의 평가자 역할(3단계 작성)은 본인 자기평가와 무관', () => {
    const s = createSeed(); const c = s.cycles[0]
    const before = cycleCounts(c, s.responses, s.employees)
    const execA = c.assignments.find((a) => a.evaluatorId === 'e02' && a.stageOrder === 3)!
    const unlockedBefore = isUnlocked(c, s.responses, execA)
    setSelfEval(s, c.id, 'e02', true)
    const t = c.targets.find((x) => x.employeeId === 'e02')!
    expect(t.isExecutive).toBe(true)
    expect(targetCells(c, s.responses, t, 3).map((x) => x.status)).toEqual(['notStarted', 'na', 'na'])
    const after = cycleCounts(c, s.responses, s.employees)
    expect([after.targets, after.byStage[0].assigned, after.byStage[2].assigned]).toEqual([before.targets + 1, before.byStage[0].assigned + 1, before.byStage[2].assigned])
    expect(isUnlocked(c, s.responses, execA)).toBe(unlockedBefore)
    // 끄기: 응답 없으면 배정·대상자 정리, 응답 있으면 보존(제외 표시)
    setSelfEval(s, c.id, 'e02', false)
    expect(c.targets.some((x) => x.employeeId === 'e02')).toBe(false)
    setSelfEval(s, c.id, 'e02', true)
    const selfA = c.assignments.find((a) => a.targetId === 'e02' && a.direction === 'self')!
    sub(s, selfA.id)
    setSelfEval(s, c.id, 'e02', false)
    expect(c.assignments.find((a) => a.id === selfA.id)!.excluded).toBe('selfOff')
    expect(s.responses[selfA.id].status).toBe('submitted')
    expect(cycleCounts(c, s.responses, s.employees).targets).toBe(before.targets) // 받는 평가 없는 임원은 대상자 아님
    setSelfEval(s, c.id, 'e02', true)
    expect(c.assignments.find((a) => a.id === selfA.id)!.excluded).toBeUndefined() // 되살림(응답 그대로)
  })
  it('카드: 분모 = 적용 단계 대상자(평가자 수 아님), 단계 카드 = 그 단계 미완료자만(다른 단계와 무관, 대기 포함)', () => {
    const s = createSeed(); s.responses = {}; const c = s.cycles[0]
    const max = maxStageCount(c)
    const rows = activeTargets(c, s.employees).map((t) => ({ t, cells: targetCells(c, s.responses, t, max) }))
    const n = cycleCounts(c, s.responses, s.employees)
    const members = c.targets.filter((t) => !t.isTeamLead).length, leads = c.targets.filter((t) => t.isTeamLead).length
    expect(n.byStage.map((b) => b.assigned)).toEqual([members + leads, members, members + leads])
    expect(rows.filter((r) => cardFilter(rowOf(r.cells), { kind: 'stage', order: 3 }, false)).length).toBe(members + leads) // 3단계 대기(잠김)도 포함
    // 1단계만 제출한 사원은 1단계 목록에서 빠지고 2단계 목록에는 남음
    const m = rows.find((r) => !r.t.isTeamLead)!
    sub(s, c.assignments.find((a) => a.targetId === m.t.employeeId && a.stageOrder === 1)!.id)
    const cells = targetCells(c, s.responses, m.t, max)
    expect([cardFilter(rowOf(cells), { kind: 'stage', order: 1 }, false), cardFilter(rowOf(cells), { kind: 'stage', order: 2 }, false), cardFilter(rowOf(cells), { kind: 'stage', order: 3 }, false)]).toEqual([false, true, true])
  })
  it('자기평가를 끈 팀장의 기초 점수는 적용 단계(3단계)만으로 계산', () => {
    const s = createSeed(); const c = s.cycles[0]
    fillRest(s, c)
    const done = c.targets.find((t) => t.isTeamLead && personResult(s, c, t.employeeId)!.combined.base !== null)!
    const r0 = personResult(s, c, done.employeeId)!
    const st3 = r0.stages.find((x) => x.order === 3)!.score
    s.responses[c.assignments.find((a) => a.targetId === done.employeeId && a.direction === 'self')!.id].status = 'submitted'
    setSelfEval(s, c.id, done.employeeId, false)
    const r1 = personResult(s, c, done.employeeId)!
    expect(r1.stages.map((x) => x.order)).toEqual([3])
    expect(r1.combined.base).toBeCloseTo(st3!)
  })
})

describe('직급 세 가지: 직원 저장·팀장 연결·명단 업로드 (D-068)', () => {
  it('팀장 지정 → 팀 연결·기존 팀장은 사원, 사원으로 바꾸면 연결 해제, 임원은 팀장 연결 없음', async () => {
    const { applyTier, otherLead } = await import('./org')
    const s = createSeed()
    expect(otherLead(s, 'tm-design', 'e11')!.name).toBe('장현우')
    applyTier(s, 'e11', '팀장')
    expect(s.teams.find((t) => t.id === 'tm-design')!.leadId).toBe('e11')
    expect(s.employees.find((e) => e.id === 'e10')!.position).toBe('사원')
    expect(s.employees.find((e) => e.id === 'e11')!.position).toBe('팀장')
    applyTier(s, 'e11', '임원')
    expect(s.teams.find((t) => t.id === 'tm-design')!.leadId).toBeNull()
    expect(s.employees.find((e) => e.id === 'e11')).toMatchObject({ isExecutive: true, position: '임원', evalExcluded: true })
    applyTier(s, 'e11', '사원')
    expect(s.employees.find((e) => e.id === 'e11')).toMatchObject({ isExecutive: false, position: '사원', evalExcluded: false })
  })
  it('업로드: 직급은 세 가지만, 팀장은 빈 팀에 한 명만', async () => {
    const { rosterEmployees, rosterLeads } = await import('./roster')
    const s = createSeed()
    s.teams.find((t) => t.id === 'tm-design')!.leadId = null
    const csv = '사번,이름,팀,직급,직무\n0201,가상A,설계팀,팀장,관리직\n0202,가상B,생산팀,팀장,생산직\n0203,가상C,설계팀,과장,관리직\n0204,가상D,현장팀,임원,생산직'
    const r = checkRoster(parseCsv(csv), s.employees, s.teams.filter((t) => !t.archived), 'error')
    expect(r.rows[0].errors).toEqual([])
    expect(r.rows[1].errors[0].msg).toContain('이미 팀장(오정훈)')
    expect(r.rows[2].errors[0].msg).toContain('임원·팀장·사원')
    const ok = checkRoster(parseCsv('사번,이름,팀,직급,직무\n0201,가상A,설계팀,팀장,관리직\n0204,가상D,현장팀,임원,생산직'), s.employees, s.teams.filter((t) => !t.archived), 'error')
    const add = rosterEmployees(ok, (i) => `n${i}`)
    expect(add[1]).toMatchObject({ isExecutive: true, evalExcluded: true })
    rosterLeads(s, add)
    expect(s.teams.find((t) => t.id === 'tm-design')!.leadId).toBe('n0')
    const dup = checkRoster(parseCsv('사번,이름,팀,직급,직무\n0201,가상A,설계팀,팀장,관리직\n0202,가상B,설계팀,팀장,관리직'), s.employees, s.teams.filter((t) => !t.archived), 'error')
    expect(dup.rows[0].errors[0].msg).toContain('여러 명')
  })
})

describe('진행 현황 = 작성자 기준 (D-071)', () => {
  const sub = (s: AppState, id: string) => { s.responses[id] = { assignmentId: id, answers: {}, status: 'submitted', savedAt: '', submittedAt: '', lang: 'ko' } }
  const act = (s: AppState) => activeWriteAssignments(s.cycles[0], s.employees)
  const row = (s: AppState, id: string) => writerRows(s, s.cycles[0]).find((r) => r.t.employeeId === id)
  it('명단 = 활성 작성 배정이 있는 직원(ID 중복 없음), 평가받기만 하는 것은 작성 업무가 아님', () => {
    const s = createSeed(); const c = s.cycles[0]
    const rows = writerRows(s, c)
    expect(new Set(rows.map((r) => r.t.employeeId)).size).toBe(rows.length)
    expect(new Set(rows.map((r) => r.t.employeeId))).toEqual(new Set(act(s).map((a) => a.evaluatorId)))
    for (const r of rows) {
      const mine = act(s).filter((a) => a.evaluatorId === r.t.employeeId)
      expect(r.total.total).toBe(mine.length) // 자기평가 포함, 배정 하나는 한 번
      expect(r.stages.reduce((n, x) => n + x.total, 0)).toBe(mine.length)
      expect(r.total.open).toBe(evaluatorTodo(c, s.responses, s.employees, r.t.employeeId).length)
    }
  })
  it('사원: 1단계 = 자기평가만, 2·3단계 없음', () => {
    const s = createSeed(); const r = row(s, 'e05')!
    expect(r.stages.map((x) => x.total)).toEqual([1, 0, 0])
  })
  it('팀장: 1단계 자기평가 + 2단계 사원 평가, 본인이 받는 임원평가는 3단계에 넣지 않음 / 자기평가 끈 팀장은 1단계 —', () => {
    const s = createSeed(); const c = s.cycles[0]
    const r = row(s, 'e04')!
    expect(r.stages[0].total).toBe(1)
    expect(r.stages[1].total).toBe(c.assignments.filter((a) => a.evaluatorId === 'e04' && a.direction !== 'self' && !a.excluded).length)
    expect(r.stages[2].total).toBe(0)
    setSelfEval(s, c.id, 'e04', false)
    expect(row(s, 'e04')!.stages[0].total).toBe(0)
    expect(row(s, 'e04')!.stages[1].total).toBe(r.stages[1].total)
  })
  it('자기평가 없는 임원: 3단계에 배정 건수, 1·2단계 —, 대상자가 아니어도 명단에 / 자기평가 켜면 1단계 추가(중복 없음)', () => {
    const s = createSeed(); const c = s.cycles[0]
    const r = row(s, 'e02')!
    expect(c.targets.some((t) => t.employeeId === 'e02')).toBe(false)
    expect(r.stages[0].total).toBe(0); expect(r.stages[1].total).toBe(0)
    expect(r.stages[2].total).toBe(c.assignments.filter((a) => a.evaluatorId === 'e02' && !a.excluded).length)
    expect(r.stages[2].total).toBeGreaterThan(1)
    setSelfEval(s, c.id, 'e02', true)
    const r2 = row(s, 'e02')!
    expect(r2.stages.map((x) => x.total)).toEqual([1, 0, r.stages[2].total])
    expect(writerRows(s, c).filter((x) => x.t.employeeId === 'e02').length).toBe(1)
  })
  it('일부 제출·모두 제출·선행 대기(미완료로 세되 잠금 유지), 임시저장은 완료 아님', () => {
    const s = createSeed(); const c = s.cycles[0]
    const r = row(s, 'e03')!
    const mine = act(s).filter((a) => a.evaluatorId === 'e03')
    const locked = mine.filter((a) => !isUnlocked(c, s.responses, a) && s.responses[a.id]?.status !== 'submitted') // 제출된 배정은 잠금으로 세지 않음
    expect(r.stages[2].locked).toBe(locked.length)
    expect(locked.length).toBeGreaterThan(0)
    expect(r.stages[2].open).toBeGreaterThanOrEqual(locked.length)
    const open1 = mine.find((a) => s.responses[a.id]?.status !== 'submitted' && isUnlocked(c, s.responses, a))!
    s.responses[open1.id] = { assignmentId: open1.id, answers: {}, status: 'draft', savedAt: '', submittedAt: '', lang: 'ko' }
    expect(row(s, 'e03')!.stages[2].done).toBe(r.stages[2].done) // 임시저장은 완료 아님
    for (const a of mine) sub(s, a.id)
    expect(row(s, 'e03')!.complete).toBe(true)
    expect(row(s, 'e03')!.stages[2]).toMatchObject({ open: 0, done: mine.length })
  })
  it('카드 = 사람 수: 3단계 분모 = 3단계 작성 배정이 있는 임원 수(평가 건수 아님), 일부 임원만 완료', () => {
    const s = createSeed(); const c = s.cycles[0]
    const execs = [...new Set(act(s).filter((a) => writeStageOf(c, a) === 3).map((a) => a.evaluatorId))]
    let n = writerCounts(writerRows(s, c))
    expect(n.byStage[2].writers).toBe(execs.length)
    expect(n.participants).toBe(writerRows(s, c).length)
    for (const a of act(s).filter((x) => x.evaluatorId === execs[0] && writeStageOf(c, x) === 3)) sub(s, a.id)
    n = writerCounts(writerRows(s, c))
    expect(n.byStage[2].done).toBe(1 + execs.slice(1).filter((id) => act(s).filter((a) => a.evaluatorId === id && writeStageOf(c, a) === 3).every((a) => s.responses[a.id]?.status === 'submitted')).length)
    expect(n.byStage[2].writers).toBe(execs.length)
    // 1단계 = 자기평가 작성 대상자 수 / 2단계 = 사원 평가 배정이 있는 팀장 수
    expect(n.byStage[0].writers).toBe(new Set(act(s).filter((a) => a.direction === 'self').map((a) => a.evaluatorId)).size)
    expect(n.byStage[1].writers).toBe(new Set(act(s).filter((a) => writeStageOf(c, a) === 2).map((a) => a.evaluatorId)).size)
  })
  it('단계 카드 = 그 단계 작성 업무가 남은 작성자만, 업무 완료 카드 = 모든 업무 제출, 미완료만 기준', () => {
    const s = createSeed(); const c = s.cycles[0]
    const rows = writerRows(s, c)
    for (const o of [1, 2, 3]) {
      const list = rows.filter((r) => writerFilter(r, { kind: 'stage', order: o }, false))
      expect(list.every((r) => r.stages[o - 1].open > 0)).toBe(true)
      expect(list.length).toBe(rows.filter((r) => r.stages[o - 1].total > 0).length - writerCounts(rows).byStage[o - 1].done)
    }
    expect(rows.filter((r) => writerFilter(r, { kind: 'complete' }, false)).every((r) => r.total.open === 0 && r.total.total > 0)).toBe(true)
    expect(rows.filter((r) => writerFilter(r, null, true)).length).toBe(rows.length - writerCounts(rows).complete)
  })
  it('취소된 배정(제외 표시·퇴사 대상자)·퇴사 평가자는 집계 안 함, 평가자 변경 반영', () => {
    const s = createSeed(); const c = s.cycles[0]
    const lead = row(s, 'e04')!
    const t = c.assignments.find((a) => a.evaluatorId === 'e04' && a.direction !== 'self')!.targetId
    s.employees.find((e) => e.id === t)!.active = false
    expect(row(s, 'e04')!.stages[1].total).toBe(lead.stages[1].total - c.assignments.filter((a) => a.evaluatorId === 'e04' && a.targetId === t).length)
    const a3 = c.assignments.find((a) => a.evaluatorId === 'e03' && !s.responses[a.id])!
    a3.evaluatorId = 'e01'
    expect(row(s, 'e01')!.stages[2].total).toBe(c.assignments.filter((a) => a.evaluatorId === 'e01' && !a.excluded && s.employees.find((e) => e.id === a.targetId)!.active).length)
    s.employees.find((e) => e.id === 'e01')!.active = false
    expect(row(s, 'e01')).toBeUndefined()
  })
  it('직급과 배정 유형이 다르면 표시(업무는 숨기지 않음)', () => {
    const s = createSeed(); const c = s.cycles[0]
    // 시연 회차: 네 팀 정리 전 팀장이던 강태영·송하은·배진우는 지금 사원인데 회차에서 사원 평가(2단계)를 맡고 있음 (D-072 원인)
    const flagged = writerRows(s, c).filter((r) => r.mismatch)
    expect(flagged.every((r) => r.tier === '사원' && r.stages[1].total > 0)).toBe(true)
    expect(flagged.map((r) => r.t.name).every((n) => ['강태영', '송하은', '배진우'].includes(n))).toBe(true)
    const a = c.assignments.find((x) => x.evaluatorId === 'e03' && !s.responses[x.id])!
    a.evaluatorId = 'e05' // 사원에게 임원평가 배정
    const r = row(s, 'e05')!
    expect(r.mismatch).toBe(true)
    expect(r.stages[2].total).toBe(1)
  })
})

describe('평가 참여자·자기평가 통합 설정 (D-072)', () => {
  const ids = (s: AppState) => [...participation(s, s.cycles[0])].sort()
  it('참여 = 사원·팀장은 대상자, 임원은 execOff에 없음 — 기본은 재직 임원 모두 참여', () => {
    const s = createSeed(); const c = s.cycles[0]
    const p = participation(s, c)
    expect(s.employees.filter((e) => e.isExecutive).every((e) => p.has(e.id))).toBe(true)
    expect(c.targets.every((t) => p.has(t.employeeId))).toBe(true)
  })
  it('참여와 자기평가는 독립: 임원 자기평가 끔 + 참여 유지 → 다른 사람 평가 배정 그대로', () => {
    const s = createSeed(); const c = s.cycles[0]
    const before = c.assignments.filter((a) => a.evaluatorId === 'e02').map((a) => a.id).sort()
    applyParticipation(s, c.id, ids(s), { e02: true })
    expect(c.assignments.some((a) => a.targetId === 'e02' && a.direction === 'self')).toBe(true)
    applyParticipation(s, c.id, ids(s), { e02: false })
    expect(c.assignments.some((a) => a.targetId === 'e02' && !a.excluded)).toBe(false)
    expect(c.assignments.filter((a) => a.evaluatorId === 'e02' && a.targetId !== 'e02').map((a) => a.id).sort()).toEqual(before)
    expect(participation(s, c).has('e02')).toBe(true)
  })
  it('평가 배정·응답이 있는 사람은 참여 해제하지 않음(배정·응답 삭제·이동 없음)', () => {
    const s = createSeed(); const c = s.cycles[0]
    const snap = JSON.stringify([c.assignments, s.responses])
    const blocked = applyParticipation(s, c.id, [], {})
    expect(blocked.length).toBeGreaterThan(0)
    expect(blocked).toContain('김도현') // 다른 사람 평가 배정
    expect(blocked).toContain('이준호')
    expect(JSON.stringify(c.assignments.filter((a) => s.responses[a.id]))).toBe(JSON.stringify(JSON.parse(snap)[0].filter((a: { id: string }) => s.responses[a.id])))
  })
  it('배정 없는 임원 참여 해제 → execOff, 자기평가 값은 초기화하지 않고 배정만 정리, 새 배정의 평가자에서 제외', () => {
    const s = createSeed(); const c = s.cycles[0]
    for (const a of c.assignments.filter((x) => x.evaluatorId === 'e01')) a.evaluatorId = 'e02' // 작성 배정이 없는 임원으로 만든 뒤 확인
    applyParticipation(s, c.id, ids(s), { e01: true })
    expect(c.assignments.some((a) => a.targetId === 'e01' && a.direction === 'self')).toBe(true)
    applyParticipation(s, c.id, ids(s).filter((x) => x !== 'e01'), { e01: true })
    expect(c.execOff).toEqual(['e01'])
    expect(c.selfEval?.e01).toBe(true) // 값 보존
    expect(c.assignments.some((a) => a.targetId === 'e01' && !a.excluded)).toBe(false)
    expect(c.targets.some((t) => t.employeeId === 'e01')).toBe(false)
    // 참여하지 않는 임원은 새로 만드는 배정의 평가자로 고르지 않음
    c.execOff = s.employees.filter((e) => e.isExecutive && e.id !== 'e03').map((e) => e.id)
    expect(buildAssignments(s, c).filter((a) => a.stageOrder === 3).every((a) => a.evaluatorId === 'e03')).toBe(true)
  })
  it('새로 참여하는 팀장은 저장한 자기평가 값으로 배정 생성, 참여하지 않는 팀장의 값은 보존', () => {
    const s = createSeed(); const c = s.cycles[0]
    s.responses = {}
    c.assignments = c.assignments.filter((a) => !(a.evaluatorId === 'e10' && a.targetId !== 'e10')) // 사원 평가 배정이 없는 팀장으로
    applyParticipation(s, c.id, ids(s).filter((x) => x !== 'e10'), { e10: false })
    expect(c.targets.some((t) => t.employeeId === 'e10')).toBe(false)
    expect(c.selfEval?.e10).toBe(false)
    applyParticipation(s, c.id, [...ids(s), 'e10'], { e10: false })
    expect(c.assignments.filter((a) => a.targetId === 'e10').map((a) => a.stageOrder)).toEqual([3]) // 담당 임원 한 명 (D-082)
  })
  it('확정 회차는 바꾸지 않음', () => {
    const s = createSeed(); const c = s.cycles[0]; c.status = '확정'
    const snap = JSON.stringify(c)
    applyParticipation(s, c.id, [], { e02: true })
    expect(JSON.stringify(c)).toBe(snap)
  })
})

describe('한국어·러시아어: 저장된 번역문 표시 (D-075)', async () => {
  const i18n = await import('../i18n')
  const content = await import('../i18n/content')
  const { cloneQuestion } = await import('./questions')
  const draft = (s: AppState) => s.cycles[0].templates['tpl-draft']
  const qOf = (s: AppState, id: string) => draft(s).sections.flatMap((x) => x.questions).find((q) => q.id === id)!
  it('새 데이터: 기본 문항·선택지·평가영역에 러시아어 초안, 선택지는 ID로 연결, 점수·필수·순서 그대로', () => {
    const s = createSeed()
    const q = qOf(s, 'd-performance-q')
    expect(i18n.qTitle(q, 'ru')).toContain('Результаты работы')
    expect(q.options.map((o) => i18n.optLabel(q, o, 'ru'))).toEqual(['5 — отлично', '4 — хорошо', '3 — удовлетворительно', '2 — недостаточно', '1 — крайне недостаточно'])
    expect(q.options.map((o) => o.value)).toEqual([5, 4, 3, 2, 1])
    expect(i18n.secTitle(draft(s).sections.find((x) => x.id === 'd-ev')!, 'ru')).toBe('Итоговое заключение оценщика')
    expect(i18n.qHelp(qOf(s, 'd-s1'), 'ru')).toContain('Опишите подробно')
    // 한국어 선택 시 원문 그대로
    expect(i18n.qTitle(q, 'ko')).toBe(q.title)
    // 모든 활성 기본 문항·영역에 번역이 있음
    for (const sec of draft(s).sections) {
      expect(sec.i18n?.ru?.title).toBeTruthy()
      for (const x of sec.questions) { expect(x.i18n?.ru?.title).toBeTruthy(); for (const o of x.options) expect(x.i18n?.ru?.options?.[o.id]).toBeTruthy() }
    }
  })
  it('번역이 비면 한국어 원문, 선택지 순서를 바꿔도 같은 선택지의 번역·점수', () => {
    const s = createSeed(); const q = structuredClone(qOf(s, 'd-ability-q'))
    q.i18n!.ru!.title = '  '
    expect(i18n.qTitle(q, 'ru')).toBe(q.title)
    const before = Object.fromEntries(q.options.map((o) => [o.id, [i18n.optLabel(q, o, 'ru'), o.value]]))
    q.options.reverse()
    expect(Object.fromEntries(q.options.map((o) => [o.id, [i18n.optLabel(q, o, 'ru'), o.value]]))).toEqual(before)
    delete q.i18n!.ru!.options![q.options[0].id]
    expect(i18n.optLabel(q, q.options[0], 'ru')).toBe(q.options[0].label)
  })
  it('문항 복제: 번역도 복제, 선택지 번역은 새 선택지 ID로, 재확인 대상 아님', () => {
    const s = createSeed(); const q = qOf(s, 'd-culture-q')
    const c = cloneQuestion(q)
    expect(c.options.map((o) => i18n.optLabel(c, o, 'ru'))).toEqual(q.options.map((o) => i18n.optLabel(q, o, 'ru')))
    expect(Object.keys(c.i18n!.ru!.options!)).toEqual(c.options.map((o) => o.id))
    expect(i18n.qTitle(c, 'ru')).toBe(i18n.qTitle(q, 'ru'))
    expect(i18n.needsReview(c)).toBe(false)
    expect(q.i18n!.ru!.options![q.options[0].id]).toBeTruthy() // 원본 그대로
  })
  it('한국어 원문을 고치면 번역은 지우지 않고 "재확인" 표시, 기준 갱신 시 해제', () => {
    const s = createSeed(); const q = structuredClone(qOf(s, 'd-s2'))
    expect(i18n.needsReview(q)).toBe(false)
    q.title = '내년 목표와 계획을 적어주세요'
    expect(i18n.needsReview(q)).toBe(true)
    expect(i18n.qTitle(q, 'ru')).toBe('Укажите ваши цели на следующий год') // 덮어쓰거나 지우지 않음
    q.i18n!.ru!.basis!.title = q.title
    expect(i18n.needsReview(q)).toBe(false)
    const opt = structuredClone(qOf(s, 'd-e1')); opt.options[0].label = 'A 매우 탁월'
    expect(i18n.needsReview(opt)).toBe(true)
  })
  it('v8 → v9: 기본 그대로인 문항에만 번역 연결, 고친 문항·사용자 번역은 그대로, 응답·ID 보존, 반복 안전', () => {
    const s: any = createSeed({ until: 19 }); s.schemaVersion = 8
    const strip = (t: any) => t.sections.forEach((sec: any) => { delete sec.i18n; sec.questions.forEach((q: any) => delete q.i18n) })
    s.templates.forEach(strip); Object.values(s.cycles[0].templates).forEach(strip)
    const d = s.cycles[0].templates['tpl-draft']
    d.sections[0].questions[0].title = '올해 가장 큰 성과는?' // 사용자 수정 문항
    d.sections[0].questions[1].i18n = { ru: { title: 'Мой перевод', options: {} } } // 사용자 작성 번역
    const resp = JSON.stringify(s.responses); const ids = JSON.stringify(d.sections.map((x: any) => x.questions.map((q: any) => [q.id, q.options.map((o: any) => o.id)])))
    const m = migrate(s)!
    const md = m.state.cycles[0].templates['tpl-draft']
    expect(m.state.schemaVersion).toBe(22)
    expect(md.sections[0].questions[0].i18n).toBeUndefined()
    expect(md.sections[0].questions[1].i18n!.ru!.title).toBe('Мой перевод')
    expect(md.sections.find((x) => x.id === 'd-performance')!.questions[0].i18n!.ru!.title).toContain('Результаты')
    expect(m.notes.join()).toContain('러시아어 번역 초안')
    expect(JSON.stringify(m.state.responses)).toBe(resp)
    expect(JSON.stringify(md.sections.map((x) => x.questions.map((q) => [q.id, q.options.map((o) => o.id)])))).toBe(ids)
    const snap = JSON.stringify(m.state)
    expect(content.attachDefaultTranslations(m.state)).toBe(0)
    expect(JSON.stringify(m.state)).toBe(snap)
  })
  it('고정 문구 사전: 자리표시자 채움, 직급·로그인 오류 변환(모든 키의 러시아어는 타입으로 강제)', () => {
    const sample: [Parameters<typeof i18n.t>[0], Record<string, number | string>][] = [['form.screen', { i: 2, n: 8 }], ['form.reqDone', { d: 3, t: 7 }], ['ev.title', { name: '최유진' }], ['exec.cardDone', { d: 1, t: 4 }]]
    for (const [k, v] of sample) { const r = i18n.t(k, 'ru', v); expect(r).not.toMatch(/[가-힣]/.test(String(Object.values(v)[0])) ? /\{/ : /[가-힣{]/) }
    expect(i18n.t('form.screen', 'ru', { i: 2, n: 8 })).toBe('Экран 2 из 8')
    expect(i18n.tierText('팀장', 'ru')).toBe('Руководитель группы')
    expect(i18n.tierText('경영기획팀', 'ru')).toBe('경영기획팀') // 고유명사는 그대로
    expect(i18n.loginError('아이디 또는 비밀번호가 올바르지 않습니다.', 'ru')).toBe('Неверный логин или пароль.')
  })
})

describe('진행 현황: 받는 평가 + 작성 업무, 임원 4명·배정 정리 (D-076)', async () => {
  const { progressRows, progressCounts, progressFilter } = await import('./progress')
  const { execsAndAssignments } = await import('./execsV10')
  const sub = (s: AppState, id: string) => { s.responses[id] = { assignmentId: id, answers: {}, status: 'submitted', savedAt: '', submittedAt: '', lang: 'ko' } }
  const row = (s: AppState, id: string) => progressRows(s, s.cycles[0]).find((r) => r.t.employeeId === id)!
  it('새 데이터: 임원 4명(추가 없음), 응답 없는 팀장평가는 현재 팀장으로, 응답 있는 것은 그대로, 같은 배정 ID', () => {
    const s = createSeed(); const c = s.cycles[0]
    expect(s.employees.filter((e) => e.isExecutive && e.active).map((e) => e.name).sort()).toEqual(['김도현', '박재원', '전상철', '홍성훈'].sort())
    const leadOf = (id: string) => s.teams.find((t) => t.id === s.employees.find((e) => e.id === id)!.teamId)!.leadId
    for (const a of c.assignments.filter((x) => x.stageOrder === 2 && x.direction === 'down')) {
      if (!s.responses[a.id]) expect(a.evaluatorId).toBe(leadOf(a.targetId))
    }
    const kept = c.assignments.filter((a) => a.stageOrder === 2 && s.responses[a.id] && a.evaluatorId !== leadOf(a.targetId)).map((a) => s.employees.find((e) => e.id === a.evaluatorId)!.name).sort()
    expect(kept).toEqual(['강태영', '배진우']) // 이전 팀장이 응답한 평가는 작성자 유지(충돌 보고)
  })
  it('임원평가: 대상자당 담당 임원 한 명, 네 임원이 고르게 나눠 맡음 (D-082 — D-081 전원 평가 대체)', () => {
    const s = createSeed(); const c = s.cycles[0]
    const mine = c.assignments.filter((a) => a.evaluatorId === 'e01')
    expect(mine.length).toBeGreaterThan(1)
    for (const t of c.targets.filter((x) => !x.isExecutive && !s.employees.find((e) => e.id === x.employeeId)!.evalExcluded)) expect(c.assignments.filter((a) => a.targetId === t.employeeId && a.stageOrder === 3 && !a.excluded)).toHaveLength(1)
    expect(s.employees.filter((e) => e.isExecutive).every((e) => c.assignments.some((a) => a.evaluatorId === e.id))).toBe(true)
    expect(c.selfEval?.e01 ?? false).toBe(false) // 새로 담당이 생겨도 자기평가는 꺼진 상태
  })
  it('임원이 2명뿐인 저장 데이터 → 가상 임원 2명 추가(고유 ID·사번 0027·0028, 직급 임원), 반복 실행 시 추가 없음, 기존 직원 승격 없음', () => {
    const s = createSeed()
    s.employees.find((e) => e.id === 'e01')!.isExecutive = false; s.employees.find((e) => e.id === 'e23')!.active = false
    const before = s.employees.map((e) => [e.id, e.name, e.empNo, e.isExecutive])
    const notes = execsAndAssignments(s)
    const added = s.employees.filter((e) => !before.some((b) => b[0] === e.id))
    expect(added.map((e) => [e.id, e.name, e.empNo, e.position, e.isExecutive, e.evalExcluded])).toEqual([['e27', '백승우', '0027', '임원', true, true], ['e28', '한도윤', '0028', '임원', true, true]])
    expect(new Set(s.employees.map((e) => e.empNo)).size).toBe(s.employees.length)
    expect(new Set(s.employees.map((e) => e.name)).size).toBe(s.employees.length)
    expect(s.employees.filter((e) => before.some((b) => b[0] === e.id)).map((e) => [e.id, e.name, e.empNo, e.isExecutive])).toEqual(before)
    expect(notes.join()).toContain('가상 임원 추가')
    const snap = JSON.stringify(s.employees)
    execsAndAssignments(s)
    expect(JSON.stringify(s.employees)).toBe(snap)
  })
  it('확정 회차는 배정을 바꾸지 않음', () => {
    const s = createSeed(); const c = s.cycles[0]
    c.status = '확정'; for (const a of c.assignments.filter((x) => x.evaluatorId === 'e01')) a.evaluatorId = 'e02'
    const snap = JSON.stringify(c.assignments)
    execsAndAssignments(s)
    expect(JSON.stringify(c.assignments)).toBe(snap)
  })
  it('표 칸: 사원 = 받는 상태 3칸, 팀장 = 자기평가·팀장평가(작성 건수)·임원평가(받는 상태), 임원 = 자기평가·—·임원평가(작성 건수)', () => {
    const s = createSeed(); const c = s.cycles[0]
    const m = row(s, 'e05')
    expect(m.tier).toBe('사원'); expect(m.cells.map((x) => x.kind)).toEqual(['recv', 'recv', 'recv'])
    const l = row(s, 'e04')
    expect(l.cells.map((x) => x.kind)).toEqual(['recv', 'write', 'recv'])
    const lw = l.cells[1] as { kind: 'write'; w: { total: number } }
    expect(lw.w.total).toBe(c.assignments.filter((a) => a.evaluatorId === 'e04' && a.stageOrder === 2 && !a.excluded).length) // 자기평가 미포함
    const x = row(s, 'e02')
    expect(x.cells.map((y) => y.kind)).toEqual(['na', 'na', 'write'])
    // 강태영: 현재 사원 — D-079 정리 후 사원 경로(자기·팀장·임원평가를 받음), 이전 팀장 작성 업무는 집계 제외 → 배정 확인 없음
    const k = row(s, 'e07')
    expect(k.tier).toBe('사원'); expect(k.cells.map((y) => y.kind)).toEqual(['recv', 'recv', 'recv']); expect(k.mismatch).toBe(false)
  })
  it('받는 평가: 선행 대기·평가자 미지정도 미완료, 업무 완료 = 받는 평가 + 작성 업무 모두', () => {
    const s = createSeed(); const c = s.cycles[0]
    const m = c.targets.find((t) => !t.isTeamLead && row(s, t.employeeId).recv[2].status === 'locked')!
    expect((row(s, m.employeeId).cells[2] as { status: string }).status).toBe('locked')
    expect(row(s, m.employeeId).complete).toBe(false)
    c.assignments = c.assignments.filter((a) => !(a.targetId === m.employeeId && a.stageOrder === 2)) // 배정 누락
    expect(row(s, m.employeeId).recv[1].status).toBe('unassigned')
    expect(row(s, m.employeeId).complete).toBe(false)
    // 임원: 받는 평가 없음 → 작성 업무를 모두 제출해야 완료
    const ex = row(s, 'e01'); expect(ex.complete).toBe(false)
    for (const a of c.assignments.filter((x) => x.evaluatorId === 'e01')) sub(s, a.id)
    expect(row(s, 'e01').complete).toBe(true)
  })
  it('카드(사람 수): 자기평가 = 자기평가 대상자, 팀장평가 = 사원 평가 배정이 있는 현재 팀장, 임원평가 = 배정이 있는 임원(4명), 단계 카드 클릭 = 그 기준 미완료자만', () => {
    const s = createSeed(); const c = s.cycles[0]
    const rows = progressRows(s, c), n = progressCounts(rows)
    expect(n.byStage[2].writers).toBe(4)
    const leads = s.teams.filter((t) => !t.archived && t.leadId).map((t) => t.leadId!)
    expect(n.byStage[1].writers).toBe(leads.filter((id) => c.assignments.some((a) => a.evaluatorId === id && a.stageOrder === 2)).length)
    expect(n.byStage[0].writers).toBe(rows.filter((r) => r.recv[0].status !== 'na').length)
    for (const o of [1, 2, 3]) expect(rows.filter((r) => progressFilter(r, { kind: 'stage', order: o }, false)).length).toBe(n.byStage[o - 1].writers - n.byStage[o - 1].done)
    expect(rows.filter((r) => progressFilter(r, null, true)).length).toBe(n.participants - n.complete)
    // D-109 카드: 완료자 + 미완료자 = 전체 대상자, 미완료자 = 하나라도 미제출
    expect(rows.filter((r) => progressFilter(r, { kind: 'complete' }, false)).length).toBe(n.complete)
    expect(rows.filter((r) => progressFilter(r, { kind: 'open' }, false)).every((r) => !r.complete)).toBe(true)
    expect(rows.filter((r) => progressFilter(r, { kind: 'open' }, false)).length).toBe(n.participants - n.complete)
    expect(new Set(rows.map((r) => r.t.employeeId)).size).toBe(rows.length)
  })
})

describe('자기평가 스위치는 현재 직급 기준, 현재 사원은 자기평가 필수 (D-077)', async () => {
  const { selfForStaff } = await import('./cycle')
  const { appliedStages, selfApplies } = await import('./progress')
  const { applyTier } = await import('./org')
  it('이전 팀장 경로로 자기평가가 꺼진 현재 사원 → 켬(응답 있던 배정은 그대로 되살림), 다시 실행해도 같음', () => {
    const s = createSeed(); const c = s.cycles[0]
    const selfA = c.assignments.find((a) => a.targetId === 'e07' && a.direction === 'self')! // 강태영(임시저장)
    const resp = JSON.stringify(s.responses[selfA.id])
    setSelfEval(s, c.id, 'e07', false)
    expect(c.assignments.find((a) => a.id === selfA.id)!.excluded).toBe('selfOff')
    expect(selfForStaff(s, c.id)).toEqual(['강태영'])
    expect(c.assignments.find((a) => a.id === selfA.id)!.excluded).toBeUndefined()
    expect(JSON.stringify(s.responses[selfA.id])).toBe(resp)
    expect(selfForStaff(s, c.id)).toEqual([])
  })
  it('현재 팀장이 회차 시작 때 사원이었어도 자기평가 끄기가 적용(배정·적용 단계·점수 기준 일치)', () => {
    const s = createSeed(); const c = s.cycles[0]; s.responses = {}
    applyTier(s, 'e11', '팀장') // 임지혜를 설계팀 팀장으로(회차 스냅샷은 사원)
    expect(c.targets.find((t) => t.employeeId === 'e11')!.isTeamLead).toBe(false)
    setSelfEval(s, c.id, 'e11', false)
    const t = c.targets.find((x) => x.employeeId === 'e11')!
    expect(appliedStages(c, t).map((x) => x.order)).toEqual([2, 3])
    expect(c.assignments.some((a) => a.targetId === 'e11' && a.direction === 'self')).toBe(false)
    setSelfEval(s, c.id, 'e11', true)
    expect(appliedStages(c, t).map((x) => x.order)).toEqual([1, 2, 3])
  })
  it('설정 저장: 사원은 스위치 값 없이도 자기평가 적용, 팀장·임원 값은 그대로 저장', () => {
    const s = createSeed(); const c = s.cycles[0]
    setSelfEval(s, c.id, 'e07', false) // 이전 팀장 경로의 현재 사원
    const join = [...participation(s, c)]
    applyParticipation(s, c.id, join, { e04: false, e02: false })
    expect(selfApplies(c, c.targets.find((t) => t.employeeId === 'e07')!)).toBe(true)
    expect(c.selfEval?.e04).toBe(false)
  })
  it('v10 → v11: 현재 사원 자기평가 켬, 확정 회차는 그대로', () => {
    const s: any = createSeed({ until: 19 }); s.schemaVersion = 10
    setSelfEval(s, s.cycles[0].id, 'e21', false) // 송하은(현재 사원)
    const m = migrate(structuredClone(s))!
    expect(m.state.schemaVersion).toBe(22)
    expect(selfApplies(m.state.cycles[0], m.state.cycles[0].targets.find((t) => t.employeeId === 'e21')!)).toBe(true)
    expect(m.notes.join()).toContain('송하은')
    s.cycles[0].status = '확정'
    const m2 = migrate(structuredClone(s))!
    expect(m2.state.cycles[0].selfEval?.e21).toBe(false)
  })
})

describe('조직 관리: 분류 기준(사용자 정의 열)·관리자 메모 (D-078)', async () => {
  const org = await import('./org')
  const field = (over: Partial<import('./types').CustomField> = {}) => ({ id: 'cf-1', name: '자격증', type: 'select' as const, options: [{ id: 'o1', label: '있음' }, { id: 'o2', label: '없음' }], ...over })
  it('검증: 빈 이름·기본 항목 이름·중복 이름, 선택형 선택지 없음·빈 값·중복', () => {
    const s = createSeed()
    expect(org.customFieldErrors(s, field({ name: ' ' }))).toContain('항목 이름을 입력하세요.')
    expect(org.customFieldErrors(s, field({ name: '직급' }))[0]).toContain('기본 항목')
    org.saveCustomField(s, field())
    expect(org.customFieldErrors(s, field({ id: 'cf-2' }))[0]).toContain('이미 있습니다')
    expect(org.customFieldErrors(s, field({ id: 'cf-2', name: '차량', options: [] }))).toContain('선택지를 하나 이상 추가하세요.')
    expect(org.customFieldErrors(s, field({ id: 'cf-2', name: '차량', options: [{ id: 'a', label: '' }] }))).toContain('비어 있는 선택지가 있습니다.')
    expect(org.customFieldErrors(s, field({ id: 'cf-2', name: '차량', options: [{ id: 'a', label: 'A' }, { id: 'b', label: 'A' }] }))).toContain('같은 선택지가 두 번 있습니다.')
    expect(org.customFieldErrors(s, field({ id: 'cf-2', name: '비고', type: 'text', options: [] }))).toEqual([])
  })
  it('직원별 값: 기존 직원은 빈 값, 이름 변경 후에도 ID로 유지, 지운 선택지 값만 비움, 항목 삭제 시 값도 삭제', () => {
    const s = createSeed()
    org.saveCustomField(s, field())
    expect(s.employees.every((e) => !e.custom?.['cf-1'])).toBe(true)
    s.employees[4].custom = { 'cf-1': 'o1' }; s.employees[5].custom = { 'cf-1': 'o2' }
    org.saveCustomField(s, field({ name: '자격 보유' }))
    expect(org.customValueText(s.customFields![0], s.employees[4].custom!['cf-1'])).toBe('있음')
    expect(org.customFieldUsage(s, 'cf-1')).toBe(2)
    expect(org.customFieldUsage(s, 'cf-1', 'o2')).toBe(1)
    org.saveCustomField(s, field({ name: '자격 보유', options: [{ id: 'o1', label: '보유' }] }))
    expect(s.employees[4].custom!['cf-1']).toBe('o1')
    expect(s.employees[5].custom!['cf-1']).toBeUndefined()
    org.deleteCustomField(s, 'cf-1')
    expect(s.customFields).toEqual([])
    expect(s.employees.every((e) => !e.custom?.['cf-1'])).toBe(true)
  })
  it('분류 기준·메모는 로그인·평가 점수에 영향 없음, 메모는 직원 ID에 연결', () => {
    const s = createSeed(); const c = s.cycles[0]
    const before = c.targets.map((t) => personResult(s, c, t.employeeId)!.combined.final)
    org.saveCustomField(s, field()); s.employees.forEach((e) => { e.custom = { 'cf-1': 'o1' } })
    s.memos = { e05: '면담 예정' }
    expect(c.targets.map((t) => personResult(s, c, t.employeeId)!.combined.final)).toEqual(before)
    expect(checkLogin(s, '최유진', '0005')).not.toBeTypeOf('string')
    s.employees.find((e) => e.id === 'e05')!.name = '최유나'
    expect(s.memos.e05).toBe('면담 예정')
  })
  it('직원을 데이터에서 지우면 메모도 정리, 기록이 있어 재직 해제만 하면 메모 유지', () => {
    const s = createSeed()
    s.employees.push({ id: 'n1', empNo: '0999', name: '가상신입', teamId: 'tm-design', position: '사원', jobType: 'office', isExecutive: false, isCeo: false, active: true, evalExcluded: false })
    s.memos = { n1: '메모', e05: '메모2' }
    org.deleteEmployee(s, 'n1'); expect(s.memos.n1).toBeUndefined()
    org.deleteEmployee(s, 'e05'); expect(s.memos.e05).toBe('메모2')
  })
})

describe('35명 구성·현재 조직 기준 평가 경로 (D-079)', async () => {
  const { rosterAndPaths } = await import('./rosterV12')
  const { execsAndAssignments } = await import('./execsV10')
  const { attachDefaultTranslations } = await import('../i18n/content')
  const { selfForStaff } = await import('./cycle')
  const { progressRows } = await import('./progress')
  /** v11과 같은 상태(새 시드에서 D-079만 뺀 것) + 사용자 브라우저처럼 경영기획팀 팀장을 다른 팀 고나연(e25)으로 바꾼 상태 */
  const v11 = (crossLead = false) => {
    const s = createSeed({ legacy: true })
    reorganizeToFourTeams(s); fixedStagesAndTiers(s); attachDefaultTranslations(s); execsAndAssignments(s)
    s.cycles.forEach((c) => selfForStaff(s, c.id))
    s.schemaVersion = 11
    if (crossLead) { s.teams.find((t) => t.id === 'tm-plan')!.leadId = 'e25'; s.employees.find((e) => e.id === 'e04')!.position = '사원'; s.employees.find((e) => e.id === 'e25')!.position = '팀장' }
    return s
  }
  const sizes = (s: AppState) => ['tm-plan', 'tm-design', 'tm-prod1', 'tm-prod2'].map((id) => s.employees.filter((e) => e.active && e.teamId === id && tierOf(s, e) !== '임원').length)
  const badges = (s: AppState) => progressRows(s, s.cycles[0]).filter((r) => r.mismatch).map((r) => r.t.name)
  const snapMismatch = (s: AppState) => s.cycles[0].targets.filter((t) => { const e = s.employees.find((x) => x.id === t.employeeId)!; return t.isTeamLead !== (tierOf(s, e) === '팀장') }).map((t) => t.name)

  it('변환 전(v11)에는 배정 확인이 남아 있고, 변환 후 팀별 4·7·11·9 + 임원 4 = 35명, 배지·스냅샷 불일치 없음', () => {
    const before = v11(true)
    expect(badges(before).length).toBeGreaterThan(0)
    const m = migrate(structuredClone(before))!
    const s = m.state
    expect(s.schemaVersion).toBe(22)
    expect(sizes(s)).toEqual([4, 7, 11, 9])
    expect(s.employees.filter((e) => e.active && tierOf(s, e) === '임원')).toHaveLength(4)
    expect(s.employees.filter((e) => e.active)).toHaveLength(35)
    expect(s.teams.find((t) => t.id === 'tm-plan')!.leadId).toBe('e04')
    expect(badges(s)).toEqual([])
    expect(snapMismatch(s)).toEqual([])
    // 직원 ID·사번 보존, 중복 사번 없음
    for (const e of before.employees) expect(s.employees.find((x) => x.id === e.id)!.empNo).toBe(e.empNo)
    expect(new Set(s.employees.map((e) => e.empNo)).size).toBe(35)
  })
  it('사원 = 자기·팀장·임원평가, 팀장 = 팀장평가 없음, 응답은 하나도 지우거나 작성자를 바꾸지 않음', () => {
    const before = v11(true)
    const s = migrate(structuredClone(before))!.state
    const c = s.cycles[0]
    // 원래 응답은 하나도 바뀌지 않음(시연 완료 구성으로 더한 응답은 demo 표시, 기본 시연 임시저장만 제출로 바뀔 수 있음)
    expect(Object.keys(before.responses).every((k) => JSON.stringify(s.responses[k]) === JSON.stringify(before.responses[k]) || (before.responses[k].status === 'draft' && s.responses[k].demo))).toBe(true)
    for (const a of before.cycles[0].assignments) if (before.responses[a.id]) {
      const now = c.assignments.find((x) => x.id === a.id)!
      expect(now.evaluatorId).toBe(a.evaluatorId) // 응답 있는 배정의 작성자 그대로
    }
    for (const t of c.targets) {
      const e = s.employees.find((x) => x.id === t.employeeId)!
      if (t.isExecutive) continue
      const live = (o: number) => c.assignments.filter((a) => a.targetId === e.id && a.stageOrder === o && !a.excluded)
      if (tierOf(s, e) === '사원') {
        const lead = s.teams.find((x) => x.id === e.teamId)!.leadId
        expect(live(2).map((a) => a.evaluatorId)).toEqual([lead])
        expect(live(3)).toHaveLength(1) // 담당 임원 한 명 (D-082)
        expect(live(1)).toHaveLength(1)
      } else expect(live(2)).toHaveLength(0)
    }
    // 이전 팀장이 쓴 시연 응답(조은비←강태영, 고나연←배진우)은 보존·집계 제외, 현재 팀장 새 배정
    const old = (tid: string, ev: string) => c.assignments.find((a) => a.targetId === tid && a.evaluatorId === ev && a.stageOrder === 2)!
    expect(old('e08', 'e07').excluded).toBe('leadChanged'); expect(s.responses[old('e08', 'e07').id].status).toBe('submitted')
    expect(old('e25', 'e24').excluded).toBe('leadChanged')
    expect(c.assignments.some((a) => a.targetId === 'e25' && a.evaluatorId === 'e13' && a.stageOrder === 2 && !a.excluded)).toBe(true)
    // 이준호는 다시 팀장 — 이미 제출한 최유진·정민수 팀장평가가 그대로 유효
    expect(c.assignments.filter((a) => a.evaluatorId === 'e04' && a.stageOrder === 2 && !a.excluded).map((a) => a.targetId).sort()).toEqual(['e05', 'e06', 'e08'])
  })
  it('사용자 기록(시연 응답과 다른 응답)은 작성자를 바꾸지 않고 충돌로 보고, 배지 유지', () => {
    const before = v11(false)
    const a = before.cycles[0].assignments.find((x) => x.targetId === 'e08' && x.evaluatorId === 'e07' && x.stageOrder === 2)!
    before.responses[a.id] = { ...before.responses[a.id], savedAt: '2026-10-28T01:00:00.000Z' } // 사용자가 다시 저장
    const m = migrate(structuredClone(before))!
    const ma = m.state.cycles[0].assignments.find((x) => x.id === a.id)!
    expect(ma.excluded).toBeUndefined(); expect(ma.evaluatorId).toBe('e07')
    expect(m.notes.some((n) => n.includes('충돌(유지)') && n.includes('조은비'))).toBe(true)
    expect(badges(m.state)).toEqual(['강태영'])
  })
  it('새 가상 사원 9명은 진행 중 회차에 참여(응답 없음), 확정 회차·반복 실행은 그대로', () => {
    const before = v11(true)
    const done = structuredClone(before.cycles[0]); done.id = 'c-done'; done.status = '확정'; before.cycles.push(done)
    const s = migrate(structuredClone(before))!.state
    const c = s.cycles[0]
    const added = ['e29', 'e30', 'e31', 'e32', 'e33', 'e34', 'e35', 'e36', 'e37']
    expect(added.every((id) => c.targets.some((t) => t.employeeId === id))).toBe(true)
    expect(c.assignments.filter((a) => added.includes(a.targetId)).every((a) => !s.responses[a.id])).toBe(true)
    expect(JSON.stringify(s.cycles[1])).toBe(JSON.stringify(done)) // 확정 회차 변경 없음
    const again = structuredClone(s)
    expect(rosterAndPaths(again, () => true)).toEqual([])
    expect(JSON.stringify(again)).toBe(JSON.stringify(s))
  })
  it('새 데이터도 같은 결과(팀 인원·팀장·배지 없음)', () => {
    const s = createSeed()
    expect(sizes(s)).toEqual([4, 7, 11, 9]); expect(badges(s)).toEqual([]); expect(snapMismatch(s)).toEqual([])
  })
})

describe('조직 설정: 직무·직급 목록 (D-080)', async () => {
  const cat = await import('./catalog')
  const org = await import('./org')
  const { sessionFor: ses, participantAccount: pa } = await import('../data/auth')
  const { selfApplies } = await import('./progress')
  const csv = (text: string) => parseCsv(text)
  it('새 데이터: 기본 직무 2·직급 3만, 모든 직원이 ID로 연결되고 평가 구분 = 실제 상태(임원 표시·팀장 연결), 35명 그대로', () => {
    const s = createSeed()
    expect(s.jobs!.map((j) => j.name)).toEqual(['관리직', '생산직'])
    expect(s.positions!.map((p) => [p.name, p.evalClass])).toEqual([['임원', '임원'], ['팀장', '팀장'], ['사원', '사원']])
    expect(s.employees).toHaveLength(35)
    for (const e of s.employees) {
      const p = cat.positionById(s, e.positionId)!
      expect(p.evalClass).toBe(tierOf(s, e)); expect(e.position).toBe(p.name)
      expect(s.jobs!.some((j) => j.id === e.jobType)).toBe(true)
    }
  })
  it('v12 → v13: 목록 생성·직원 연결, 직원·응답·회차 그대로, 목록에 없던 직급 이름(퇴사자)도 빠짐없이, 반복 실행 안전', () => {
    const base = createSeed({ until: 19 })
    const old: any = structuredClone(base)
    delete old.jobs; delete old.positions; old.schemaVersion = 12
    old.employees.forEach((e: any) => delete e.positionId)
    // 퇴사자의 이전 직급 글자 — 회차에 없는 퇴사자 한 명(D-116 이후 재직 사원은 모두 참여자라 기존 직원을 퇴사 처리하면 배정이 바뀜)
    old.employees.push({ id: 'e-gone', empNo: '0099', name: '가상퇴사', teamId: 'tm-prod1', position: '반장', jobType: 'production', isExecutive: false, isCeo: false, active: false, evalExcluded: false })
    const m = migrate(structuredClone(old))!
    const s = m.state
    expect(s.schemaVersion).toBe(22)
    expect(JSON.stringify([s.responses, s.cycles])).toBe(JSON.stringify([old.responses, old.cycles]))
    expect(s.employees.map((e) => [e.id, e.empNo, e.name, e.teamId, e.jobType])).toEqual(old.employees.map((e: any) => [e.id, e.empNo, e.name, e.teamId, e.jobType]))
    const g = s.employees.find((e) => e.id === 'e-gone')!
    expect(cat.positionById(s, g.positionId)).toMatchObject({ name: '반장', evalClass: '사원' }) // 이름 글자로 팀장 추측 안 함
    expect(m.notes.some((n) => n.includes('반장'))).toBe(true)
    const again = structuredClone(s)
    expect(cat.ensureCatalog(again, (e) => tierOf(again, e))).toEqual([])
    expect(JSON.stringify(again)).toBe(JSON.stringify(s))
  })
  it('직무: 추가·이름 변경(연결 유지)·검증·사용 중 삭제는 대체 직무로 옮긴 뒤(배정·회차 그대로), 마지막 하나는 삭제 불가', () => {
    const s = createSeed()
    const before = JSON.stringify([s.cycles, s.responses])
    expect(cat.saveJob(s, null, '  ')).toBe('이름을 입력하세요.')
    expect(cat.saveJob(s, null, ' 관리직 ')).toContain('이미 있습니다')
    expect(cat.saveJob(s, null, '품질직')).toBeNull()
    const q = s.jobs!.find((j) => j.name === '품질직')!
    expect(cat.saveJob(s, 'office', '사무직')).toBeNull()
    expect(cat.jobName(s, s.employees.find((e) => e.id === 'e05')!.jobType)).toBe('사무직') // 같은 ID
    const users = cat.jobUsage(s, 'office').map((e) => e.id)
    expect(cat.deleteJob(s, 'office', null)).toBe('옮길 직무를 선택하세요.')
    expect(cat.deleteJob(s, 'office', q.id)).toBeNull()
    expect(users.every((id) => s.employees.find((e) => e.id === id)!.jobType === q.id)).toBe(true)
    expect(cat.activeJobs(s).map((j) => j.name)).toEqual(['생산직', '품질직'])
    expect(cat.jobName(s, 'office')).toBe('사무직') // 이전 회차 기록의 이름 참조
    expect(JSON.stringify([s.cycles, s.responses])).toBe(before)
    expect(cat.templateFor(s.cycles[0], q.id)).toBe(s.cycles[0].templateByJob.office) // 새 직무 문항 = 관리직 문항
    cat.deleteJob(s, 'production', q.id)
    expect(cat.deleteJob(s, q.id, null)).toBe('직무는 하나 이상 있어야 합니다.')
  })
  it('직급: 이름+평가 구분, 대리(사원) 지정해도 평가 동작은 사원, 이름 변경·기본 직급 보호·사용 중 평가 구분 변경 막기·같은 구분으로만 대체 삭제', () => {
    const s = createSeed()
    const c = s.cycles[0]
    expect(cat.savePosition(s, null, '대리', '사원')).toBeNull()
    expect(cat.savePosition(s, null, '대리', '팀장')).toContain('이미 있습니다')
    const dr = s.positions!.find((p) => p.name === '대리')!
    // 직원 저장 흐름(People.EmployeeModal): 직급 ID 지정 → 평가 구분으로 applyTier
    const t0 = c.targets.find((t) => t.employeeId === 'e05')!
    const self0 = selfApplies(c, t0)
    s.employees.find((e) => e.id === 'e05')!.positionId = dr.id; org.applyTier(s, 'e05', dr.evalClass)
    const e05 = s.employees.find((e) => e.id === 'e05')!
    expect([e05.position, tierOf(s, e05), selfApplies(c, t0)]).toEqual(['대리', '사원', self0])
    // 이름 변경: 연결·평가 동작 유지
    expect(cat.savePosition(s, dr.id, '주임', '사원')).toBeNull()
    expect([e05.positionId, e05.position, tierOf(s, e05)]).toEqual([dr.id, '주임', '사원'])
    // 사용 중 평가 구분 변경·기본 직급 평가 구분 변경·기본 직급 삭제 막기 (자동 팀장 임명 없음)
    expect(cat.savePosition(s, dr.id, '주임', '팀장')).toContain('평가 구분을 바꿀 수 없습니다')
    expect(cat.savePosition(s, 'pos-staff', '사원', '팀장')).toContain('기본 직급')
    expect(cat.savePosition(s, 'pos-staff', '직원', '사원')).toBeNull() // 이름은 변경 가능
    expect(cat.deletePosition(s, 'pos-staff', null)).toContain('삭제할 수 없습니다')
    expect(s.teams.some((t) => t.leadId === 'e05')).toBe(false)
    // 삭제: 같은 평가 구분으로만
    expect(cat.deletePosition(s, dr.id, 'pos-lead')).toBe('같은 평가 구분의 직급으로만 옮길 수 있습니다.')
    expect(cat.deletePosition(s, dr.id, 'pos-staff')).toBeNull()
    expect([e05.positionId, e05.position, tierOf(s, e05)]).toEqual(['pos-staff', '직원', '사원'])
    // 관리자 권한 없음: 임원 구분 새 직급이어도 화면 역할은 평가 참여자
    cat.savePosition(s, null, '전무', '임원')
    const ex = s.positions!.find((p) => p.name === '전무')!
    s.employees.find((e) => e.id === 'e02')!.positionId = ex.id; org.applyTier(s, 'e02', '임원')
    expect(ses(s, pa('e02'))!.role).toBe('exec')
    expect(s.employees.find((e) => e.id === 'e02')!.position).toBe('전무')
  })
  it('팀장 연결이 바뀌면 직급이 평가 구분에 맞게(대리 → 기본 팀장 직급), 평가 구분이 같으면 사용자 직급 유지', () => {
    const s = createSeed()
    cat.savePosition(s, null, '대리', '사원')
    const dr = s.positions!.find((p) => p.name === '대리')!
    const e06 = s.employees.find((e) => e.id === 'e06')!
    e06.positionId = dr.id; org.syncTiers(s)
    expect(e06.position).toBe('대리')
    s.teams.find((t) => t.id === 'tm-plan')!.leadId = 'e06'; org.syncTiers(s)
    expect([tierOf(s, e06), e06.positionId, e06.position]).toEqual(['팀장', 'pos-lead', '팀장'])
  })
  it('업로드: 조직 설정의 직급·직무 이름으로 검증·연결(평가 구분으로 임원·팀장 처리)', () => {
    const s = createSeed()
    cat.savePosition(s, null, '대리', '사원'); cat.saveJob(s, null, '품질직')
    const r = checkRoster(csv('사번,이름,팀,직급,직무\n0501,가,설계팀,대리,품질직\n0502,나,설계팀,부장,관리직'), s.employees, s.teams, 'error', s)
    expect(r.rows[0].errors).toEqual([])
    expect(r.rows[1].errors.map((x) => x.col)).toEqual(['직급'])
    const ok = checkRoster(csv('사번,이름,팀,직급,직무\n0501,가,설계팀,대리,품질직'), s.employees, s.teams, 'error', s)
    const [n] = rosterEmployees(ok, () => 'n1')
    expect([n.positionId, n.position, n.jobType, n.isExecutive]).toEqual([s.positions!.find((p) => p.name === '대리')!.id, '대리', s.jobs!.find((j) => j.name === '품질직')!.id, false])
  })
})

describe('임원 담당 나누기·시연 완료 구성·배정 맞추기 (D-082, D-081 대체)', async () => {
  const sync = await import('./cycleSync')
  const { progressRows, progressCounts } = await import('./progress')
  const { applyTier } = await import('./org')
  const org = await import('./org')
  const nonExecTargets = (s: AppState) => s.cycles[0].targets.filter((t) => !t.isExecutive && s.employees.find((e) => e.id === t.employeeId)!.active && !s.employees.find((e) => e.id === t.employeeId)!.evalExcluded)
  const exec3 = (s: AppState) => s.cycles[0].assignments.filter((a) => a.stageOrder === 3 && !a.excluded && a.direction === 'down')
  const cards = (s: AppState) => progressCounts(progressRows(s, s.cycles[0])).byStage
  it('대상자당 담당 임원 한 명, 네 임원이 나눠 맡음(한 임원 몫 ≤ 올림(대상자 ÷ 임원)), 임원끼리 평가 없음, 반복해도 그대로', () => {
    const s = createSeed()
    const n = nonExecTargets(s).length
    const execs = sync.cycleExecs(s, s.cycles[0])
    const a3 = exec3(s)
    expect(a3).toHaveLength(n)
    for (const t of nonExecTargets(s)) expect(a3.filter((a) => a.targetId === t.employeeId)).toHaveLength(1)
    const loads = execs.map((x) => a3.filter((a) => a.evaluatorId === x.id).length)
    expect(loads.every((l) => l > 0 && l <= Math.ceil(n / execs.length))).toBe(true)
    expect(a3.every((a) => !execs.some((x) => x.id === a.targetId))).toBe(true)
    const before = JSON.stringify(s.cycles)
    expect(sync.syncOpenCycles(s).filter((x) => !x.includes('회차 정보'))).toEqual([])
    expect(JSON.stringify(s.cycles)).toBe(before)
  })
  it('시연 완료 구성: 2단계 완료 = 담당 평가를 모두 낸 팀장 2명, 3단계 완료 = 임원 1명 — 실제 응답·선행 단계 포함, 이후 제출하면 숫자가 따라 변함', () => {
    const s = createSeed(); const c = s.cycles[0]
    const b = cards(s)
    expect([b[1].done, b[1].writers, b[2].done, b[2].writers]).toEqual([2, 4, 1, 4])
    const rows = progressRows(s, c)
    const exDone = rows.find((r) => r.tier === '임원' && r.writes && r.writes.stages[2].total > 0 && r.writes.stages[2].open === 0)!
    for (const a of c.assignments.filter((x) => x.evaluatorId === exDone.t.employeeId && x.stageOrder === 3 && !x.excluded)) {
      expect(s.responses[a.id].status).toBe('submitted')
      // 선행(자기·팀장평가) 모두 제출
      expect(c.assignments.filter((x) => x.targetId === a.targetId && x.stageOrder < 3 && !x.excluded && x.direction !== 'up').every((x) => s.responses[x.id]?.status === 'submitted')).toBe(true)
    }
    const open = rows.filter((r) => r.tier === '팀장' && r.writes && r.writes.stages[1].open > 0)
    expect(open).toHaveLength(2)
    // 남은 팀장 한 명의 담당 평가를 모두 제출 → 3명
    for (const a of c.assignments.filter((x) => x.evaluatorId === open[0].t.employeeId && x.stageOrder === 2 && !x.excluded)) s.responses[a.id] = { assignmentId: a.id, answers: {}, status: 'submitted', savedAt: '', submittedAt: '', lang: 'ko' }
    expect(cards(s)[1].done).toBe(3)
  })
  it('담당 임원 한 명: 그 임원 제출로 임원평가 완료, 단계 점수 = 그 응답 점수(네 명 평균 아님)', () => {
    const s = createSeed(); const c = s.cycles[0]
    const t = nonExecTargets(s).find((x) => !x.isTeamLead && c.assignments.filter((a) => a.targetId === x.employeeId).every((a) => s.responses[a.id]?.status === 'submitted'))!
    const a3 = c.assignments.find((a) => a.targetId === t.employeeId && a.stageOrder === 3 && !a.excluded)!
    const r = personResult(s, c, t.employeeId)!
    expect(r.stages.find((x) => x.order === 3)!.score).toBeCloseTo(stageScore(c.templates[a3.templateId], s.responses[a3.id], ctxFor(c, a3))!, 9)
    expect(targetCells(c, s.responses, t, 3)[2].status).toBe('submitted')
  })
  it('v14 → v15: 전원 평가로 생긴 응답 없는 중복 정리(대상자당 한 명), 응답 있는 담당·작성자 그대로, 원래 응답 보존, 반복 실행 안전', () => {
    const base = createSeed()
    const c0 = base.cycles[0]
    for (const k of Object.keys(base.responses)) if (base.responses[k].demo) delete base.responses[k] // v15 이전 상태로
    const execs = sync.cycleExecs(base, c0)
    for (const t of nonExecTargets(base)) {
      const a = c0.assignments.find((x) => x.targetId === t.employeeId && x.stageOrder === 3)!
      for (const x of execs) if (x.id !== a.evaluatorId) c0.assignments.push({ ...a, id: `${c0.id}-x-${t.employeeId}-${x.id}`, evaluatorId: x.id })
    }
    delete c0.versions
    const old: any = structuredClone(base); old.schemaVersion = 14
    const m = migrate(structuredClone(old))!
    const c = m.state.cycles[0]
    for (const t of nonExecTargets(m.state)) expect(c.assignments.filter((a) => a.targetId === t.employeeId && a.stageOrder === 3 && !a.excluded)).toHaveLength(1)
    for (const k of Object.keys(old.responses)) expect(JSON.stringify(m.state.responses[k]) === JSON.stringify(old.responses[k]) || (old.responses[k].status === 'draft' && m.state.responses[k].demo)).toBe(true)
    for (const a of old.cycles[0].assignments) if (old.responses[a.id]) expect(c.assignments.find((x) => x.id === a.id)!.evaluatorId).toBe(a.evaluatorId)
    expect(c.versions?.map((v) => v.name)).toEqual(['공통 평가표', '팀장 자기평가표', '팀원→팀장 평가표']) // v16(D-103) 팀장 자기평가표, v18(D-114) 팀원→팀장 평가표 추가
    const b = cards(m.state)
    expect([b[1].done, b[2].done]).toEqual([2, 1])
    const again = migrate(structuredClone(m.state))
    expect(again === null || JSON.stringify(again.state) === JSON.stringify(m.state)).toBe(true)
    // 같은 대상자에 응답 있는 임원평가가 둘(사용자 기록) → 지우지 않고 충돌 보고
    const two: any = structuredClone(old)
    const t0 = nonExecTargets(two)[0].employeeId
    const pair = two.cycles[0].assignments.filter((a: any) => a.targetId === t0 && a.stageOrder === 3).slice(0, 2)
    pair.forEach((a: any) => { two.responses[a.id] = { assignmentId: a.id, answers: {}, status: 'draft', savedAt: '2026-10-29T01:00:00Z', submittedAt: null, lang: 'ko' } })
    const m2 = migrate(two)!
    expect(pair.every((a: any) => m2.state.cycles[0].assignments.some((x) => x.id === a.id))).toBe(true)
    expect(m2.notes.some((n) => n.includes('충돌(유지)') && n.includes('임원평가 응답이 2건'))).toBe(true)
  })
  it('이준호 사례(D-081): 임원이 아닌 평가자의 응답 없는 임원평가는 정리, 응답 있으면 유지·충돌 보고', () => {
    const s = createSeed(); const c = s.cycles[0]
    const a = c.assignments.find((x) => x.stageOrder === 3 && !x.excluded && !s.responses[x.id] && c.targets.find((t) => t.employeeId === x.targetId)!.departmentId !== 'tm-plan')!
    const tid = a.targetId
    const was = a.evaluatorId
    a.evaluatorId = 'e04'
    expect(progressRows(s, c).find((r) => r.t.employeeId === 'e04')!.mismatch).toBe(true)
    sync.syncCycle(s, c)
    expect(c.assignments.some((x) => x.targetId === tid && x.evaluatorId === 'e04' && x.stageOrder === 3)).toBe(false)
    expect(c.assignments.filter((x) => x.targetId === tid && x.stageOrder === 3 && !x.excluded)).toHaveLength(1)
    expect(progressRows(s, c).find((r) => r.t.employeeId === 'e04')!.mismatch).toBe(false)
    void was
  })
  it('재발 방지: 새 직원 등록만으로 참여 안 함 → 참여 저장 시 자기·현재 팀장·담당 임원 한 명, 반복해도 중복 없음', () => {
    const s = createSeed(); const c = s.cycles[0]
    s.employees.push({ id: 'n1', empNo: '0901', name: '새직원', teamId: 'tm-design', position: '사원', positionId: 'pos-staff', jobType: 'office', isExecutive: false, isCeo: false, active: true, evalExcluded: false })
    sync.syncOpenCycles(s)
    expect(c.targets.some((t) => t.employeeId === 'n1')).toBe(false)
    applyParticipation(s, c.id, [...participation(s, c), 'n1'], {}); sync.syncCycle(s, c)
    const mine = () => c.assignments.filter((a) => a.targetId === 'n1' && !a.excluded)
    expect(mine().map((a) => a.stageOrder).sort()).toEqual([1, 2, 3])
    expect(mine().find((a) => a.stageOrder === 2)!.evaluatorId).toBe('e10')
    expect(sync.cycleExecs(s, c).some((x) => x.id === mine().find((a) => a.stageOrder === 3)!.evaluatorId)).toBe(true)
    applyParticipation(s, c.id, [...participation(s, c)], {}); sync.syncCycle(s, c); sync.syncOpenCycles(s)
    expect(mine()).toHaveLength(3)
  })
  it('재발 방지: 팀장 변경 → 응답 없는 팀장평가만 새 팀장, 응답 있는 건 유지 / 팀장 없는 팀은 임의 담당자 없이 "평가자 없음" / 관리자가 바꾼 담당 임원은 유지', () => {
    const s = createSeed({ until: 19 }); const c = s.cycles[0]
    const answeredBefore = c.assignments.filter((a) => a.evaluatorId === 'e10' && a.stageOrder === 2 && s.responses[a.id]).map((a) => a.id)
    s.employees.find((e) => e.id === 'e11')!.positionId = 'pos-lead'; applyTier(s, 'e11', '팀장'); sync.syncOpenCycles(s)
    const design = c.targets.filter((t) => s.employees.find((e) => e.id === t.employeeId)!.teamId === 'tm-design' && t.employeeId !== 'e11')
    for (const t of design) expect(c.assignments.filter((a) => a.targetId === t.employeeId && a.stageOrder === 2 && !a.excluded).every((a) => a.evaluatorId === 'e11' || answeredBefore.includes(a.id))).toBe(true)
    expect(answeredBefore.every((id) => c.assignments.find((a) => a.id === id)!.evaluatorId === 'e10')).toBe(true)
    s.teams.find((t) => t.id === 'tm-prod2')!.leadId = null; org.syncTiers(s)
    c.assignments = c.assignments.filter((a) => !(a.targetId === 'e33' && a.stageOrder === 2))
    sync.syncOpenCycles(s)
    expect(c.assignments.some((a) => a.targetId === 'e33' && a.stageOrder === 2 && !a.excluded)).toBe(false)
    expect(assignmentProblems(s, c).some((p) => p.includes('노승현') && p.includes('평가자 없음'))).toBe(true)
    // 관리자가 담당 임원을 바꾸면(평가자 배정 화면) 다시 맞출 때도 그대로
    const a3 = c.assignments.find((a) => a.targetId === 'e33' && a.stageOrder === 3 && !a.excluded && !s.responses[a.id])!
    const other = sync.cycleExecs(s, c).find((x) => x.id !== a3.evaluatorId)!.id
    a3.evaluatorId = other; sync.syncOpenCycles(s)
    expect(c.assignments.find((a) => a.id === a3.id)!.evaluatorId).toBe(other)
  })
  it('확정 회차는 바꾸지 않음', () => {
    const s = createSeed()
    const done = structuredClone(s.cycles[0]); done.id = 'c-done'; done.status = '확정'
    s.cycles.push(done)
    const snap = JSON.stringify(done)
    sync.syncOpenCycles(s)
    expect(JSON.stringify(s.cycles.find((c) => c.id === 'c-done'))).toBe(snap)
  })
})

describe('평가표 버전 (D-082)', async () => {
  const V = await import('./versions')
  const { visibleSections } = await import('../components/QuestionView')
  const at = (s: AppState, tid: string, order: number) => s.cycles[0].assignments.find((a) => a.targetId === tid && a.stageOrder === order && !a.excluded)!
  const qids = (s: AppState, a: Assignment) => visibleSections(s.cycles[0].templates[a.templateId], ctxFor(s.cycles[0], a)).flatMap((x) => x.questions.map((q) => q.id))
  it('지금 문항 = "공통 평가표"(모두에게 동일 적용), 문제 없음', () => {
    const s = createSeed(); const c = s.cycles[0]
    expect(c.versions![0]).toEqual({ templateId: 'tpl-draft', name: '공통 평가표', scope: V.ALL_SCOPE() })
    // D-103: 팀장 자기평가표(자기평가 · 팀장 직급)
    expect(c.versions![1]).toMatchObject({ name: '팀장 자기평가표', scope: { mode: 'custom', rules: ['self'], teams: 'all', positions: ['pos-lead'] } })
    expect(V.applyVersions(s, c)).toEqual([])
  })
  it('복제: 새 ID·번역·점수 함께, 원본과 독립 / 직접 선택(생산팀·사원·임원평가) → 그 평가에만 적용, 응답 있는 배정은 그대로', () => {
    const s = createSeed(); const c = s.cycles[0]
    const orig = c.templates['tpl-draft']
    const cl = V.cloneTemplate(orig, '생산팀용')
    const oq = orig.sections.flatMap((x) => x.questions), cq = cl.sections.flatMap((x) => x.questions)
    expect(cq.length).toBe(oq.length)
    expect(cq.every((q) => !oq.some((o) => o.id === q.id))).toBe(true)
    expect(cq.flatMap((q) => q.options.map((o) => o.id)).some((id) => oq.some((o) => o.options.some((x) => x.id === id)))).toBe(false)
    expect(cq.map((q) => [q.title, q.i18n?.ru?.title, q.options.map((o) => o.value)])).toEqual(oq.map((q) => [q.title, q.i18n?.ru?.title, q.options.map((o) => o.value)]))
    V.addVersion(c, cl, '생산팀용', { mode: 'custom', rules: ['executive'], teams: ['tm-prod1'], positions: ['pos-staff'] }, false)
    orig.sections[0].questions[0].title = '원본만 고침'
    expect(cl.sections[0].questions[0].title).not.toBe('원본만 고침')
    expect(V.applyVersions(s, c)).toEqual([])
    const prodStaff = c.targets.filter((t) => t.departmentId === 'tm-prod1' && !t.isTeamLead)
    for (const t of prodStaff) {
      const a = at(s, t.employeeId, 3)
      expect(a.templateId).toBe(s.responses[a.id] ? 'tpl-draft' : cl.id)
      expect(at(s, t.employeeId, 2).templateId).toBe('tpl-draft') // 다른 평가 유형은 공통
    }
    const lead = c.targets.find((t) => t.departmentId === 'tm-prod1' && t.isTeamLead)!
    expect(at(s, lead.employeeId, 3).templateId).toBe('tpl-draft') // 팀장은 범위 밖
    const fresh = prodStaff.map((t) => at(s, t.employeeId, 3)).find((a) => !s.responses[a.id])!
    expect(qids(s, fresh).every((id) => cq.some((q) => q.id === id))).toBe(true) // 문항을 합치지 않음
  })
  it('겹치면 임의 적용 없이 충돌 → 관리자가 고르면 그 버전 / 공통 기본은 평가 유형별 하나 / 빈 평가표는 문제로 표시', () => {
    const s = createSeed(); const c = s.cycles[0]
    const a = V.cloneTemplate(c.templates['tpl-draft'], 'A'), b = V.cloneTemplate(c.templates['tpl-draft'], 'B')
    V.addVersion(c, a, 'A', { mode: 'custom', rules: ['executive'], teams: ['tm-prod1'], positions: 'all' }, false)
    V.addVersion(c, b, 'B', { mode: 'custom', rules: ['executive'], teams: 'all', positions: ['pos-staff'] }, false)
    const before = c.assignments.map((x) => x.templateId)
    const p = V.applyVersions(s, c).filter((x) => x.kind === 'conflict')
    expect(p.length).toBeGreaterThan(0)
    for (const x of p) { expect(x.candidates.sort()).toEqual([a.id, b.id].sort()); expect(x.a.templateId).toBe(before[c.assignments.indexOf(x.a)]) }
    c.versionPicks = { [V.pickKey([a.id, b.id])]: b.id }
    expect(V.applyVersions(s, c).filter((x) => x.kind === 'conflict')).toEqual([])
    expect(p.every((x) => s.responses[x.a.id] || x.a.templateId === b.id)).toBe(true)
    expect(V.scopeErrors(c, 'new', V.ALL_SCOPE()).length).toBeGreaterThan(0)
    const blank = V.blankTemplate('빈 평가표')
    V.addVersion(c, blank, '빈 평가표', { mode: 'custom', rules: ['teamLead'], teams: ['tm-prod2'], positions: 'all' }, false)
    expect(V.applyVersions(s, c).some((x) => x.kind === 'empty' && c.targets.find((t) => t.employeeId === x.a.targetId)!.departmentId === 'tm-prod2')).toBe(true)
  })
  it('삭제: 사용 이력 없으면 지움(배정은 공통으로), 응답이 있으면 목록에서만 숨기고 문항 보존', () => {
    const s = createSeed(); const c = s.cycles[0]
    c.versions = c.versions!.filter((v) => v.name !== '팀장 자기평가표'); V.applyVersions(s, c) // 이 검사는 공통 + 새 버전만으로(D-103 팀장 버전과 겹침 제외)
    const a = V.cloneTemplate(c.templates['tpl-draft'], 'A')
    V.addVersion(c, a, 'A', { mode: 'custom', rules: ['self'], teams: 'all', positions: 'all' }, false)
    V.applyVersions(s, c)
    expect(V.deleteVersion(s, c, a.id)).toBe('deleted')
    expect(c.templates[a.id]).toBeUndefined()
    expect(c.assignments.every((x) => x.templateId !== a.id)).toBe(true)
    const b = V.cloneTemplate(c.templates['tpl-draft'], 'B')
    V.addVersion(c, b, 'B', { mode: 'custom', rules: ['self'], teams: 'all', positions: 'all' }, false)
    V.applyVersions(s, c)
    const used = c.assignments.find((x) => x.templateId === b.id)!
    s.responses[used.id] = { assignmentId: used.id, answers: {}, status: 'draft', savedAt: '', submittedAt: null, lang: 'ko' }
    expect(V.deleteVersion(s, c, b.id)).toBe('archived')
    expect(c.templates[b.id]).toBeDefined()
    expect(used.templateId).toBe(b.id) // 작성 중인 평가의 평가표는 그대로
    expect(V.activeVersions(c).map((v) => v.name)).toEqual(['공통 평가표', '팀원→팀장 평가표']) // 팀원→팀장 평가표(D-114)는 그대로
  })
  it('문항별 추가 제한(팀·직급)은 버전 범위와 함께 — 둘 다 만족할 때만 보임', () => {
    const s = createSeed(); const c = s.cycles[0]
    const q = c.templates['tpl-draft'].sections.flatMap((x) => x.questions).find((x) => x.directions.includes('self'))!
    q.teams = ['tm-plan']
    const self = (tid: string) => at(s, tid, 1)
    expect(qids(s, self('e05')).includes(q.id)).toBe(true) // 경영기획팀
    expect(qids(s, self('e14')).includes(q.id)).toBe(false) // 생산팀
  })
})

describe('평가표 초안 (D-085)', async () => {
  const V = await import('./versions')
  it('새 버전·복제본은 초안: 적용 조건이 비어도 저장, 실제 평가표 선택·배정에 안 쓰임', () => {
    const s = createSeed(); const c = s.cycles[0]
    const t = V.cloneTemplate(c.templates['tpl-draft'], '생산팀용')
    V.addVersion(c, t, '생산팀용', { mode: 'custom', rules: [], teams: 'all', positions: 'all' })
    expect(c.versions!.find((v) => v.templateId === t.id)!.draft).toBe(true)
    V.saveVersionDraft(c, t.id, '생산팀용(작성 중)', { mode: 'custom', rules: ['executive'], teams: ['tm-prod1'], positions: 'all' })
    const v = c.versions!.find((x) => x.templateId === t.id)!
    expect([v.name, v.scope.rules, v.draft]).toEqual(['생산팀용(작성 중)', ['executive'], true])
    const before = JSON.stringify(c.assignments)
    expect(V.applyVersions(s, c)).toEqual([])
    expect(JSON.stringify(c.assignments)).toBe(before) // 초안은 조건이 있어도 적용 안 됨
    expect(V.liveVersions(c).some((x) => x.templateId === t.id)).toBe(false)
  })
  it('적용: 조건 검증 — 적용 평가 없으면 실패(초안 그대로), 조건을 고르면 적용되고 초안 해제', () => {
    const s = createSeed(); const c = s.cycles[0]
    const t = V.cloneTemplate(c.templates['tpl-draft'], 'A')
    V.addVersion(c, t, 'A', { mode: 'custom', rules: [], teams: 'all', positions: 'all' })
    const bad = V.applyVersion(s, c, t.id, 'A', { mode: 'custom', rules: [], teams: 'all', positions: 'all' }, {})
    expect(bad.errors).toContain('적용 평가를 하나 이상 고르세요.')
    expect(c.versions!.find((x) => x.templateId === t.id)!.draft).toBe(true)
    const ok = V.applyVersion(s, c, t.id, 'A', { mode: 'custom', rules: ['executive'], teams: ['tm-prod1'], positions: ['pos-staff'] }, {})
    expect(ok.errors).toEqual([])
    expect(c.versions!.find((x) => x.templateId === t.id)!.draft).toBeUndefined()
    expect(c.assignments.some((a) => a.templateId === t.id)).toBe(true)
  })
  it('적용 중인 버전의 수정 초안(pending)은 적용 전까지 기존 설정 유지, 겹치면 적용 실패', () => {
    const s = createSeed(); const c = s.cycles[0]
    const before = JSON.stringify(c.assignments)
    V.saveVersionDraft(c, 'tpl-draft', '공통 평가표 v2', { mode: 'all', rules: ['self'], teams: 'all', positions: 'all' })
    const v = c.versions![0]
    expect([v.name, v.scope.rules.length, v.pending?.name]).toEqual(['공통 평가표', 3, '공통 평가표 v2'])
    expect(V.applyVersions(s, c)).toEqual([])
    expect(JSON.stringify(c.assignments)).toBe(before)
    // 같은 평가에 겹치는 지정 버전 두 개 → 적용 시 충돌 오류, 저장소는 그대로
    const a = V.cloneTemplate(c.templates['tpl-draft'], 'A'), b = V.cloneTemplate(c.templates['tpl-draft'], 'B')
    V.addVersion(c, a, 'A', { mode: 'custom', rules: ['executive'], teams: ['tm-prod1'], positions: 'all' }, false)
    V.addVersion(c, b, 'B', { mode: 'custom', rules: [], teams: 'all', positions: 'all' })
    const r = V.applyVersion(s, c, b.id, 'B', { mode: 'custom', rules: ['executive'], teams: 'all', positions: ['pos-staff'] }, {})
    expect(r.errors.some((e) => e.includes('겹치는'))).toBe(true)
    expect(r.conflicts.length).toBeGreaterThan(0)
    expect(c.versions!.find((x) => x.templateId === b.id)!.draft).toBe(true)
  })
  it('이전 데이터 호환: 적용 평가가 빈 버전(이전에 만든 복제본)은 실제 선택에서 제외', () => {
    const s = createSeed(); const c = s.cycles[0]
    const t = V.cloneTemplate(c.templates['tpl-draft'], 'old')
    c.templates[t.id] = t
    c.versions!.push({ templateId: t.id, name: 'old', scope: { mode: 'all', rules: [], teams: 'all', positions: 'all' } })
    expect(V.liveVersions(c).map((v) => v.name)).toEqual(['공통 평가표', '팀장 자기평가표', '팀원→팀장 평가표'])
    expect(V.applyVersions(s, c)).toEqual([])
  })
})

describe('임원 평가 배정 체크·적용 범위 직접 선택 (D-087)', async () => {
  const V = await import('./versions')
  const X = await import('./execPlan')
  const sync = await import('./cycleSync')
  const { targetCells } = await import('./progress')
  const exec3 = (s: AppState, tid: string) => s.cycles[0].assignments.filter((a) => a.targetId === tid && a.stageOrder === 3 && !a.excluded && a.direction === 'down')
  const freeTarget = (s: AppState) => s.cycles[0].targets.find((t) => !t.isExecutive && exec3(s, t.employeeId).length === 1 && !s.responses[exec3(s, t.employeeId)[0].id])!
  it('체크 해제 = 미지정: 배정이 없어지고 동기화해도 자동으로 채우지 않음, 미완료(미지정)로 보임 — 다시 체크하면 그 임원 담당', () => {
    const s = createSeed(); const c = s.cycles[0]
    const t = freeTarget(s)
    X.applyExecDraft(s, c, { [t.employeeId]: '' })
    expect(exec3(s, t.employeeId)).toHaveLength(0)
    expect(c.execUnassigned).toEqual([t.employeeId])
    sync.syncOpenCycles(s)
    expect(exec3(s, t.employeeId)).toHaveLength(0)
    expect(targetCells(c, s.responses, t, 3)[2].status).toBe('unassigned')
    const ex = sync.cycleExecs(s, c)[1].id
    X.applyExecDraft(s, c, { [t.employeeId]: ex })
    expect(exec3(s, t.employeeId).map((a) => a.evaluatorId)).toEqual([ex])
    expect(c.execUnassigned).toBeUndefined()
  })
  it('다른 임원으로 옮김: 응답 없으면 담당만 바뀜(한 건), 작성 중이면 이전 기록 보존(reassigned) 뒤 새 배정, 제출은 바뀌지 않음', () => {
    const s = createSeed(); const c = s.cycles[0]
    const execs = sync.cycleExecs(s, c).map((e) => e.id)
    const t = freeTarget(s)
    const a = exec3(s, t.employeeId)[0]
    const to = execs.find((x) => x !== a.evaluatorId)!
    X.applyExecDraft(s, c, { [t.employeeId]: to })
    expect(exec3(s, t.employeeId).map((x) => [x.id, x.evaluatorId])).toEqual([[a.id, to]])
    s.responses[a.id] = { assignmentId: a.id, status: 'draft', answers: {}, updatedAt: '2026-01-01' } as never
    const to2 = execs.find((x) => x !== to)!
    X.applyExecDraft(s, c, { [t.employeeId]: to2 })
    expect(c.assignments.find((x) => x.id === a.id)!.excluded).toBe('reassigned')
    expect(exec3(s, t.employeeId).map((x) => x.evaluatorId)).toEqual([to2])
    const sub = c.assignments.find((x) => x.stageOrder === 3 && !x.excluded && s.responses[x.id]?.status === 'submitted')!
    X.applyExecDraft(s, c, { [sub.targetId]: execs.find((x) => x !== sub.evaluatorId)! })
    X.applyExecDraft(s, c, { [sub.targetId]: '' })
    expect(exec3(s, sub.targetId).map((x) => x.evaluatorId)).toEqual([sub.evaluatorId])
  })
  it('적용 범위 직접 선택: 직원 ID로 저장, 직급 조건도 함께 충족, 선택하지 않은 같은 팀 직원·새 직원은 제외, 이름·팀이 바뀌어도 유지', () => {
    const s = createSeed({ until: 19 }); const c = s.cycles[0]
    const [p1, p2] = c.targets.filter((t) => t.departmentId === 'tm-prod1' && !t.isTeamLead)
    const t = V.cloneTemplate(c.templates['tpl-draft'], '선택')
    V.addVersion(c, t, '선택', { mode: 'custom', rules: [], teams: 'all', positions: 'all', employees: [] })
    // 초안 저장은 선택이 없어도 오류 없이
    V.saveVersionDraft(c, t.id, '선택', { mode: 'custom', rules: ['executive'], teams: 'all', positions: 'all', employees: [] })
    const empty = V.applyVersion(s, c, t.id, '선택', { mode: 'custom', rules: ['executive'], teams: 'all', positions: 'all', employees: [] }, {})
    expect(empty.errors).toContain('적용할 사람을 한 명 이상 고르세요(또는 전체 팀).')
    const sc = { mode: 'custom' as const, rules: ['executive' as const], teams: 'all' as const, positions: 'all' as const, employees: [p1.employeeId] }
    expect(V.scopeTargets(c, sc).map((x) => x.employeeId)).toEqual([p1.employeeId])
    expect(V.applyVersion(s, c, t.id, '선택', sc, {}).errors).toEqual([])
    const tplOf = (tid: string) => c.assignments.find((a) => a.targetId === tid && a.stageOrder === 3 && !a.excluded)!.templateId
    expect(tplOf(p1.employeeId)).toBe(t.id)
    expect(tplOf(p2.employeeId)).not.toBe(t.id)
    // 이름·팀이 바뀌어도 같은 사람
    s.employees.find((e) => e.id === p1.employeeId)!.name = '바뀐이름'
    p1.departmentId = 'tm-plan'
    expect(V.resolveVersion(c, V.assignmentCtx(c, c.assignments.find((a) => a.targetId === p1.employeeId && a.stageOrder === 3 && !a.excluded)!)).templateId).toBe(t.id)
    // 직급 조건 불일치 → 대상 0명이면 적용 실패(초안 보관)
    const r = V.applyVersion(s, c, t.id, '선택', { ...sc, positions: ['pos-none'] }, {})
    expect(r.errors).toContain('조건에 맞는 이번 회차 대상자가 없습니다.')
  })
  it('이전 팀 단위 범위는 그대로 같은 사람에게(확대·축소 없음), 문항 0개 평가표는 적용 실패', () => {
    const s = createSeed(); const c = s.cycles[0]
    const legacy = { mode: 'custom' as const, rules: ['executive' as const], teams: ['tm-prod1'], positions: 'all' as const }
    expect(V.scopeTargets(c, legacy).map((x) => x.employeeId).sort()).toEqual(c.targets.filter((t) => t.departmentId === 'tm-prod1').map((t) => t.employeeId).sort())
    const b = V.blankTemplate('빈 평가표')
    V.addVersion(c, b, '빈 평가표', legacy)
    expect(V.applyVersion(s, c, b.id, '빈 평가표', legacy, {}).errors).toContain('문항이 없습니다. 문항을 추가한 뒤 적용하세요.')
    expect(c.versions!.find((x) => x.templateId === b.id)!.draft).toBe(true)
  })
})

describe('마감 회차 (D-093)', async () => {
  const { cycleClosed, targetCells } = await import('./progress')
  it('저장된 회차 상태만으로 판단(마감·확정 = 작성 종료), 응답 상태·진행 현황 셀은 바꾸지 않음', () => {
    const s = createSeed(); const c = s.cycles[0]
    expect(['준비', '진행', '마감', '확정'].map((x) => cycleClosed({ status: x as never }))).toEqual([false, false, true, true])
    expect(cycleClosed(undefined)).toBe(false)
    const before = JSON.stringify(s.responses)
    const cells = c.targets.map((t) => targetCells(c, s.responses, t, 3).map((x) => x.status).join())
    c.status = '마감'
    expect(cycleClosed(c)).toBe(true)
    expect(JSON.stringify(s.responses)).toBe(before)
    expect(c.targets.map((t) => targetCells(c, s.responses, t, 3).map((x) => x.status).join())).toEqual(cells) // 미완료를 완료로 바꾸지 않음
  })
})

describe('평가표 배점·점수 산식 (D-103)', async () => {
  const P = await import('./points')
  const { makeLeadSelfTemplate, MEMBER_POINTS } = await import('./templates')
  const ctx = { direction: 'down' as const, rule: 'teamLead' as const }
  // 5개 영역, 영역마다 A~E 등급 문항(값 없음 → 등급 환산 사용)
  const gradeOpts = (id: string) => ['A', 'B', 'C', 'D', 'E'].map((l) => ({ id: `${id}-${l}`, label: `${l} 등급`, value: null }))
  const tpl = (): Template => ({
    id: 't', name: 't', origin: 'draft', jobType: 'common', targetRole: 'any', locked: false, version: 1, sourceNote: '',
    sections: Object.entries(MEMBER_POINTS).map(([k, [name, pts]]) => ({ id: k, title: name, area: k as never, points: pts,
      questions: [{ id: `${k}-q`, type: 'grade', title: name, help: '', required: true, purpose: 'score', maxPoints: null, options: gradeOpts(`${k}-q`), directions: ['self', 'down'], active: true }] })),
  } as Template)
  const resp = (t: Template, pick: (k: string) => string): Response => ({ assignmentId: 'a', status: 'submitted', savedAt: '', submittedAt: '', lang: 'ko', answers: Object.fromEntries(t.sections.flatMap((s) => s.questions.map((q) => [q.id, `${q.id}-${pick(s.id)}`]))) })
  it('자문 예시: 총 100점에서 모두 A = 100, 모두 B = 80, 모두 D = 40 (A=5…E=1, 획득 ÷ 최고 × 배점)', () => {
    const t = tpl()
    expect(P.pointsStageScore(t, resp(t, () => 'A'), ctx).score).toBeCloseTo(100, 6)
    expect(P.pointsStageScore(t, resp(t, () => 'B'), ctx).score).toBeCloseTo(80, 6)
    expect(P.pointsStageScore(t, resp(t, () => 'D'), ctx).score).toBeCloseTo(40, 6)
    // 영역별 반영 점수 합: 업무성과(35) A + 나머지 C → 35 + 65 × 3/5 = 74
    expect(P.pointsStageScore(t, resp(t, (k) => (k === 'performance' ? 'A' : 'C')), ctx).score).toBeCloseTo(74, 6)
    expect(P.pointsErrors(t)).toEqual([])
  })
  it('등급 환산 수정 가능(평가표별), 영역 배점 합계 100 검증', () => {
    const t = tpl(); t.gradeScale = { A: 10, B: 8, C: 6, D: 4, E: 0 }
    expect(P.pointsStageScore(t, resp(t, () => 'B'), ctx).score).toBeCloseTo(80, 6)
    expect(P.pointsStageScore(t, resp(t, () => 'E'), ctx).score).toBeCloseTo(0, 6)
    t.sections[0].points = 30
    expect(P.pointsErrors(t).join()).toContain('합계 95점')
  })
  it('영역에 점수 문항이 여러 개: 문항 배점으로 영역 달성 비율 → 영역 배점 적용(중복 합산 없음)', () => {
    const t = tpl(); const sec = t.sections[0] // 업무성과 35
    sec.questions[0].points = 3
    sec.questions.push({ ...structuredClone(sec.questions[0]), id: 'p2', points: 1, options: gradeOpts('p2') })
    const r = resp(t, () => 'A'); r.answers['p2'] = 'p2-E' // 문항1 A(1.0, 비중3) · 문항2 E(0.2, 비중1) → 달성 0.8 → 28점
    expect(P.pointsStageScore(t, r, ctx).score).toBeCloseTo(28 + 65, 6)
  })
  it('배점 있는 서술형: 관리자 채점값으로 반영, 미채점은 점수 없음(0점 아님)', () => {
    const t = tpl(); const sec = t.sections[0]
    sec.questions = [{ id: 'txt', type: 'long', title: '성과 서술', help: '', required: true, purpose: 'score', maxPoints: null, points: 10, options: [], directions: ['self', 'down'], active: true }]
    const r = resp(t, () => 'A'); r.answers['txt'] = '서술'
    const u = P.pointsStageScore(t, r, ctx)
    expect(u.score).toBeNull(); expect(u.ungraded).toEqual(['txt'])
    expect(P.pointsStageScore(t, r, ctx, { txt: 5 }).score).toBeCloseTo(35 * 0.5 + 65, 6)
    expect(P.pointsStageScore(t, r, ctx, { txt: 0 }).score).toBeCloseTo(65, 6) // 채점값 0은 실제 0점
  })
  it('단계 반영: 20/40/40 × 100·80·40 = 68, 꺼진·적용 안 되는 단계는 빼고 남은 비율을 100%로 환산, 미제출은 미완료', () => {
    const r = combine2({ stages: [{ score: 100, weight: 20, submitted: true }, { score: 80, weight: 40, submitted: true }, { score: 40, weight: 40, submitted: true }], dept: null, person: null, ceoScore: null })
    expect(r.base).toBeCloseTo(68, 6)
    const lead = combine2({ stages: [{ score: 100, weight: 20, submitted: true }, { score: 40, weight: 40, submitted: true }], dept: null, person: null, ceoScore: null })
    expect(lead.base).toBeCloseTo((100 * 20 + 40 * 40) / 60, 6) // 팀장 경로 20·40 → 33.3%·66.7%
    const open = combine2({ stages: [{ score: 100, weight: 20, submitted: true }, { score: null, weight: 40, submitted: false }], dept: null, person: null, ceoScore: null })
    expect(open.base).toBeNull(); expect(open.incomplete).toBe(true)
  })
  it('새 데이터: 사원 평가표 35·20·20·10·15, 팀장 자기평가표 30·25·20·15·10(팀장 자기평가에 연결), 비율 20/40/40·20/40, 최종 반영 예시 보관(미적용)', () => {
    const s = createSeed(); const c = s.cycles[0]
    const common = c.templates['tpl-draft']
    expect(common.sections.filter((x) => typeof x.points === 'number').map((x) => [x.title, x.points])).toEqual([['업무성과', 35], ['능력', 20], ['근무태도', 20], ['규정준수', 10], ['조직문화', 15]])
    const lv = c.versions!.find((v) => v.name === '팀장 자기평가표')!
    expect(c.templates[lv.templateId].sections.filter((x) => typeof x.points === 'number').map((x) => x.points)).toEqual([30, 25, 20, 15, 10])
    expect(P.pointsErrors(common)).toEqual([]); expect(P.pointsErrors(c.templates[lv.templateId])).toEqual([])
    expect(c.stageWeights.member).toEqual({ 1: 20, 2: 40, 3: 40 }); expect(c.stageWeights.lead).toEqual({ 1: 20, 3: 40 })
    // 응답 없는 팀장 자기평가 = 팀장 자기평가표, 응답 있는 배정은 기존 평가표 그대로
    const leadSelf = c.assignments.filter((a) => a.direction === 'self' && !a.excluded && c.targets.find((t) => t.employeeId === a.targetId)!.isTeamLead)
    expect(leadSelf.filter((a) => !s.responses[a.id]).every((a) => a.templateId === lv.templateId)).toBe(true)
    expect(leadSelf.filter((a) => s.responses[a.id]).every((a) => a.templateId === 'tpl-draft')).toBe(true)
    // 사원 자기평가·팀장평가는 공통(사원) 평가표
    expect(c.assignments.filter((a) => !a.excluded && !c.targets.find((t) => t.employeeId === a.targetId)!.isTeamLead && !c.targets.find((t) => t.employeeId === a.targetId)!.isExecutive).every((a) => a.templateId === 'tpl-draft')).toBe(true)
    expect(c.finalBlendPlan!.lead.map((x) => [x.key, x.pct])).toEqual([['self', 20], ['kpi', 30], ['upward', 40]])
    expect(c.finalBlendPlan!.lead.find((x) => x.key === 'upward')!.on).toBe(false) // 상향평가 미구현 → 꺼짐
    void makeLeadSelfTemplate
  })
  it('v15 → v16 변환: 응답·배정 ID·문항 ID·번역 보존, 확정 회차 그대로, 사용자가 바꾼 비율은 유지, 반복 실행 안전', () => {
    const s: any = createSeed()
    const c = s.cycles[0]
    // v15 상태로 되돌린 데이터: 배점·팀장 버전·예시 없음, 비율 = 이전 개발용 기본값
    for (const t of Object.values(c.templates) as Template[]) { t.sections.forEach((x) => { delete x.points; delete x.desc }); delete t.gradeScale }
    const lid = c.versions.find((v: any) => v.name === '팀장 자기평가표').templateId
    c.versions = c.versions.filter((v: any) => v.templateId !== lid); delete c.templates[lid]; delete c.finalBlendPlan
    c.assignments.forEach((a: any) => { if (a.templateId === lid) a.templateId = 'tpl-draft' })
    c.stageWeights = { member: { 1: 33.3, 2: 33.3, 3: 33.4 }, lead: { 1: 60, 3: 40 }, exec: { 1: 100 } } // 팀장 경로는 사용자가 바꾼 값
    const done = structuredClone(c); done.id = 'c-done'; done.status = '확정'; s.cycles.push(done)
    s.schemaVersion = 15
    const before = structuredClone(s)
    const m = migrate(s)!
    const n = m.state.cycles[0]
    expect(m.state.schemaVersion).toBe(22)
    expect(JSON.stringify(m.state.responses)).toBe(JSON.stringify(before.responses))
    expect(n.assignments.map((a) => a.id)).toEqual(before.cycles[0].assignments.map((a: any) => a.id))
    expect(n.templates['tpl-draft'].sections.flatMap((x) => x.questions.map((q) => [q.id, q.i18n?.ru?.title]))).toEqual(before.cycles[0].templates['tpl-draft'].sections.flatMap((x: any) => x.questions.map((q: any) => [q.id, q.i18n?.ru?.title])))
    expect(n.stageWeights.member).toEqual({ 1: 20, 2: 40, 3: 40 }); expect(n.stageWeights.lead).toEqual({ 1: 60, 3: 40 })
    expect(JSON.stringify(m.state.cycles.find((x) => x.id === 'c-done'))).toBe(JSON.stringify(done))
    const again = structuredClone(m.state)
    expect(scoringV16(again)).toEqual([])
    expect(JSON.stringify(again)).toBe(JSON.stringify(m.state))
  })
})

describe('명단 업로드 양식·추가 열 (D-104)', () => {
  const csv = (t: string) => parseCsv(t)
  const cats = (s: ReturnType<typeof createSeed>) => ({ ...s, customFields: [
    { id: 'cf-loc', name: '근무지', type: 'text' as const, options: [] },
    { id: 'cf-shift', name: '근무 형태', type: 'select' as const, options: [{ id: 'o-day', label: '주간' }, { id: 'o-night', label: '야간' }] },
  ] })
  it('양식 순서(팀·직급·이름·직무·사번) 그대로 올리면 등록, 열 순서가 달라도 머리글 이름으로 읽음', () => {
    const s = createSeed()
    const a = checkRoster(csv('팀,직급,이름,직무,사번\n설계팀,사원,가상하나,관리직,0901'), s.employees, s.teams, 'error', s)
    const b = checkRoster(csv('사번,직무,이름,직급,팀\n0901,관리직,가상하나,사원,설계팀'), s.employees, s.teams, 'error', s)
    for (const r of [a, b]) { expect(r.error).toBeNull(); expect(canRegister(r)).toBe(true) }
    expect(rosterEmployees(a, () => 'x')[0]).toMatchObject({ empNo: '0901', name: '가상하나', position: '사원' })
    expect(rosterEmployees(b, () => 'x')[0]).toEqual(rosterEmployees(a, () => 'x')[0])
  })
  it('새 열: 분류 기준 이름과 같으면 함께 등록(선택형은 선택지 이름), 다르면 쓰지 않는 열로 표시만', () => {
    const s = cats(createSeed())
    const r = checkRoster(csv('팀,직급,이름,직무,사번,근무지,근무 형태,비고\n설계팀,사원,가상하나,관리직,0901,본사 3층,야간,메모\n설계팀,사원,가상둘,관리직,0902,,,'), s.employees, s.teams, 'error', s)
    expect(r.error).toBeNull()
    expect(r.extra.map((f) => f.id)).toEqual(['cf-loc', 'cf-shift'])
    expect(r.ignored).toEqual(['비고'])
    const add = rosterEmployees(r, (i) => `n${i}`)
    expect(add[0].custom).toEqual({ 'cf-loc': '본사 3층', 'cf-shift': 'o-night' })
    expect(add[1].custom).toBeUndefined() // 빈 칸 = 값 없음(오류 아님)
  })
  it('선택형 분류 기준에 없는 값은 그 행 오류 → 아무것도 등록하지 않음', () => {
    const s = cats(createSeed())
    const r = checkRoster(csv('팀,직급,이름,직무,사번,근무 형태\n설계팀,사원,가상하나,관리직,0901,교대'), s.employees, s.teams, 'error', s)
    expect(r.rows[0].errors).toEqual([{ col: '근무 형태', msg: '주간·야간 중 하나' }])
    expect(canRegister(r)).toBe(false)
  })
  it('필수 열이 빠지거나 같은 열이 두 번이면 파일 오류', () => {
    const s = cats(createSeed())
    expect(checkRoster(csv('팀,직급,이름,사번\n설계팀,사원,가,0901'), s.employees, s.teams, 'error', s).error).toBe('필수 열이 없습니다: 직무')
    expect(checkRoster(csv('팀,직급,이름,직무,사번,근무지,근무지\n설계팀,사원,가,관리직,0901,a,b'), s.employees, s.teams, 'error', s).error).toContain("'근무지' 열이 두 번")
  })
})

describe('임원 팀마다 한 명 (D-110)', async () => {
  const { execPerTeam } = await import('./execTeamsV17')
  const execTeams = (s: ReturnType<typeof createSeed>) => s.employees.filter((e) => e.active && (e.isExecutive || e.isCeo)).map((e) => s.teams.find((t) => t.id === e.teamId)!.name).sort()
  it('새 시드: 총 35명 그대로, 네 팀에 임원 한 명씩', () => {
    const s = createSeed()
    expect(s.employees.filter((e) => e.active)).toHaveLength(35)
    expect(execTeams(s)).toEqual(['경영기획팀', '생산팀', '설계팀', '현장팀'])
    expect(s.employees.find((e) => e.id === 'e01')!.teamId).toBe('tm-plan') // 사번이 빠른 임원은 제자리
  })
  it('v16 → v17: 임원 소속만 옮김 — 배정·응답·담당·이름·사번 그대로, 반복 실행 안전', () => {
    const s0 = createSeed({ until: 19 })
    const old = structuredClone(s0) as any
    old.schemaVersion = 16
    old.employees.find((e: any) => e.id === 'e02').teamId = 'tm-plan'
    old.employees.find((e: any) => e.id === 'e23').teamId = 'tm-plan'
    const m = migrate(structuredClone(old))!
    expect(m.state.schemaVersion).toBe(22)
    expect(execTeams(m.state)).toEqual(['경영기획팀', '생산팀', '설계팀', '현장팀'])
    expect(m.notes.filter((n) => n.startsWith('임원 '))).toHaveLength(2)
    const strip = (x: any) => x.employees.map((e: any) => ({ ...e, teamId: e.isExecutive ? '' : e.teamId }))
    expect(strip(m.state)).toEqual(strip(old))
    expect(m.state.responses).toEqual(old.responses)
    expect(m.state.cycles.map((c) => c.assignments)).toEqual(old.cycles.map((c: any) => c.assignments))
    const again = structuredClone(m.state)
    expect(execPerTeam(again)).toEqual([])
    expect(again).toEqual(m.state)
  })
  it('임원 수와 팀 수가 다르면 바꾸지 않음', () => {
    const s = createSeed()
    s.employees.find((e) => e.id === 'e23')!.active = false
    s.employees.find((e) => e.id === 'e02')!.teamId = 'tm-plan'
    const before = structuredClone(s.employees)
    expect(execPerTeam(s)[0]).toContain('수가 달라')
    expect(s.employees).toEqual(before)
  })
})

describe('새 직원은 진행 중인 평가 참여자로 시작 (D-112)', async () => {
  const { joinOpenCycles, participation } = await import('./cycle')
  const { syncOpenCycles } = await import('./cycleSync')
  it('사원 추가 → 준비·진행 회차 대상자 + 자기평가·팀장평가·임원평가 배정, 마감·확정 회차는 그대로', () => {
    const s = createSeed()
    const closed = structuredClone(s.cycles.filter((c) => c.status !== '진행' && c.status !== '준비'))
    s.employees.push({ id: 'e-new', empNo: '0901', name: '가상신입', teamId: 'tm-design', position: '사원', positionId: 'pos-staff', jobType: 'office', isExecutive: false, isCeo: false, active: true, evalExcluded: false })
    joinOpenCycles(s, ['e-new']); syncOpenCycles(s)
    for (const c of s.cycles.filter((x) => x.status === '진행' || x.status === '준비')) {
      expect(participation(s, c).has('e-new')).toBe(true)
      const as = c.assignments.filter((a) => a.targetId === 'e-new')
      expect(as.map((a) => a.stageOrder).sort()).toEqual([1, 2, 3])
      expect(as.find((a) => a.stageOrder === 2)!.evaluatorId).toBe(s.teams.find((t) => t.id === 'tm-design')!.leadId)
    }
    expect(s.cycles.filter((c) => c.status !== '진행' && c.status !== '준비')).toEqual(closed)
    // 반복 실행해도 중복 없음
    const once = structuredClone(s.cycles)
    joinOpenCycles(s, ['e-new']); syncOpenCycles(s)
    expect(s.cycles).toEqual(once)
  })
  it('임원·평가 제외 직원은 대상자로 넣지 않음(임원은 execOff에 없어 평가자로 참여)', () => {
    const s = createSeed()
    s.employees.push({ id: 'e-x', empNo: '0902', name: '가상임원', teamId: 'tm-design', position: '임원', positionId: 'pos-exec', jobType: 'office', isExecutive: true, isCeo: false, active: true, evalExcluded: true })
    joinOpenCycles(s, ['e-x'])
    const c = s.cycles.find((x) => x.status === '진행')!
    expect(c.targets.some((t) => t.employeeId === 'e-x')).toBe(false)
    expect(participation(s, c).has('e-x')).toBe(true)
  })
})

describe('팀원→팀장평가 (D-114)', async () => {
  const U = await import('./upward')
  const { progressRows, upwardAssignments } = await import('./progress')
  const { syncOpenCycles } = await import('./cycleSync')
  const live = (s: AppState) => s.cycles.find((c) => c.status === '진행')!
  it('시연 응답: 절반 정도 제출, 일부 임시저장 — 점수(개인 평가)에는 영향 없음', () => {
    const s = createSeed({ until: 19 }); const c = live(s)
    const ups = upwardAssignments(c, s.employees)
    const sub = ups.filter((a) => s.responses[a.id]?.status === 'submitted').length
    expect(ups.length).toBeGreaterThan(10)
    expect(Math.abs(sub - ups.length / 2)).toBeLessThanOrEqual(1)
    expect(ups.some((a) => s.responses[a.id]?.status === 'draft')).toBe(true)
    // 팀원→팀장평가 응답을 모두 지워도 팀장 점수는 같다
    const lead = c.targets.find((t) => t.isTeamLead)!
    const before = personResult(s, c, lead.employeeId)!.combined
    for (const a of ups) delete s.responses[a.id]
    expect(personResult(s, c, lead.employeeId)!.combined).toEqual(before)
  })
  it('진행 현황: 사원 = 작성할 1건, 팀장 = 받는 건수, 완료자는 팀원→팀장평가까지 제출해야', () => {
    const s = createSeed(); const c = live(s)
    const rows = progressRows(s, c)
    const lead = rows.find((r) => r.tier === '팀장')!
    const n = upwardAssignments(c, s.employees).filter((a) => a.targetId === lead.t.employeeId).length
    expect(lead.up).toMatchObject({ kind: 'write', w: { total: n } })
    const member = rows.find((r) => r.tier === '사원' && r.up.kind === 'write' && r.up.w.open === 1)!
    expect(member.complete).toBe(false)
    // 그 사원의 나머지가 모두 제출이면 팀원→팀장평가 제출로 완료자가 됨
    const doneMember = rows.find((r) => r.tier === '사원' && r.up.kind === 'write' && r.up.w.open === 1 && r.recv.every((x) => x.status === 'na' || x.status === 'submitted'))
    if (doneMember) {
      const a = upwardAssignments(c, s.employees).find((x) => x.evaluatorId === doneMember.t.employeeId)!
      s.responses[a.id] = { assignmentId: a.id, answers: {}, status: 'submitted', savedAt: '', submittedAt: '', lang: 'ko' }
      expect(progressRows(s, c).find((r) => r.t.employeeId === doneMember.t.employeeId)!.complete).toBe(true)
    }
    expect(rows.find((r) => r.tier === '임원')!.up.kind).toBe('na')
  })
  it('팀장이 바뀌면: 응답 없는 배정은 새 팀장으로, 응답 있는 배정은 보존(집계 제외)', () => {
    const s = createSeed({ until: 19 }); const c = live(s)
    const team = s.teams.find((t) => t.id === 'tm-design')!
    const members = c.assignments.filter((a) => a.direction === 'up' && a.targetId === team.leadId && !a.excluded)
    const answered = members.find((a) => s.responses[a.id])!, fresh = members.find((a) => !s.responses[a.id])!
    const newLead = s.employees.find((e) => e.teamId === team.id && e.id !== team.leadId && e.id !== answered.evaluatorId && e.id !== fresh.evaluatorId && c.targets.some((t) => t.employeeId === e.id))!
    team.leadId = newLead.id
    syncOpenCycles(s)
    expect(c.assignments.find((a) => a.id === answered.id)!.excluded).toBe('leadChanged')
    expect(c.assignments.some((a) => a.direction === 'up' && a.evaluatorId === fresh.evaluatorId && a.targetId === fresh.targetId)).toBe(false) // 응답 없던 이전 팀장 배정은 지움(같은 ID는 새 팀장 배정에 다시 쓰일 수 있음)
    expect(c.assignments.some((a) => a.direction === 'up' && !a.excluded && a.evaluatorId === fresh.evaluatorId && a.targetId === newLead.id)).toBe(true)
    expect(c.assignments.some((a) => a.direction === 'up' && !a.excluded && a.evaluatorId === newLead.id)).toBe(false) // 새 팀장은 평가자가 아님
  })
  it('v17 → v18: 기존 배정·응답 그대로 + 팀원→팀장평가 추가, 마감·확정 회차 그대로, 반복 실행 안전', () => {
    const s0 = createSeed({ until: 19 })
    const old = structuredClone(s0) as any
    old.schemaVersion = 17
    for (const c of old.cycles) {
      for (const a of c.assignments.filter((x: any) => x.direction === 'up')) delete old.responses[a.id]
      c.assignments = c.assignments.filter((x: any) => x.direction !== 'up')
      if (c.versions) c.versions = c.versions.filter((v: any) => v.name !== '팀원→팀장 평가표')
      delete c.templates[`${c.id}-tpl-upward`]
    }
    const m = migrate(structuredClone(old))!
    expect(m.state.schemaVersion).toBe(22)
    for (const [i, c] of m.state.cycles.entries()) {
      expect(c.assignments.filter((a) => a.direction !== 'up')).toEqual(old.cycles[i].assignments)
      if (c.status === '진행' || c.status === '준비') expect(c.assignments.some((a) => a.direction === 'up')).toBe(true)
      else expect(c).toEqual(old.cycles[i])
    }
    for (const [id, r] of Object.entries(old.responses)) expect(m.state.responses[id]).toEqual(r)
    expect(m.state.cycles).toEqual(s0.cycles) // 새 시드와 같은 결과
    const again = structuredClone(m.state)
    expect(U.upwardV18(again).filter((n) => !n.includes('배정'))).toEqual([])
    expect(again.cycles).toEqual(m.state.cycles)
  })
})

describe('재직 사원·팀장 모두 평가 참여 (D-116)', async () => {
  const { joinAllStaff } = await import('./joinAllV19')
  it('새 시드: 재직 사원·팀장 모두 진행 회차 참여(문태호 포함), 팀원→팀장평가도 자기 팀 팀장', () => {
    const s = createSeed(); const c = s.cycles.find((x) => x.status === '진행')!
    const staff = s.employees.filter((e) => e.active && !e.isExecutive && !e.isCeo)
    expect(staff.every((e) => !e.evalExcluded && c.targets.some((t) => t.employeeId === e.id))).toBe(true)
    expect(c.assignments.some((a) => a.evaluatorId === 'e26' && a.direction === 'self')).toBe(true)
    for (const a of c.assignments.filter((x) => x.direction === 'up' && !x.excluded)) {
      const m = s.employees.find((e) => e.id === a.evaluatorId)!
      expect(s.teams.find((t) => t.id === m.teamId)!.leadId).toBe(a.targetId)
    }
  })
  it('v18 → v19: 참여하지 않던 사원(이전에 올린 직원·평가 제외)을 참여자로, 기존 배정·응답·마감 회차 그대로, 반복 안전', () => {
    const s0 = createSeed({ until: 19 })
    const old: any = structuredClone(s0); old.schemaVersion = 18
    const c = old.cycles.find((x: any) => x.status === '진행')
    // 이전에 업로드한 직원(참여 안 함)과 평가 제외 직원
    old.employees.push({ id: 'e-up', empNo: '0901', name: '가상업로드', teamId: 'tm-design', position: '사원', positionId: 'pos-staff', jobType: 'office', isExecutive: false, isCeo: false, active: true, evalExcluded: false })
    const ex = old.employees.find((e: any) => e.id === 'e22'); ex.evalExcluded = true
    const m = migrate(structuredClone(old))!
    const cc = m.state.cycles.find((x) => x.id === c.id)!
    expect(cc.targets.some((t) => t.employeeId === 'e-up')).toBe(true)
    expect(cc.assignments.filter((a) => a.targetId === 'e-up').map((a) => a.stageOrder).sort()).toEqual([1, 2, 3])
    expect(cc.assignments.some((a) => a.evaluatorId === 'e-up' && a.direction === 'up')).toBe(true)
    expect(m.state.employees.find((e) => e.id === 'e22')!.evalExcluded).toBe(false)
    expect(m.notes.some((n) => n.includes('가상업로드'))).toBe(true)
    for (const [k, r] of Object.entries(old.responses)) expect(m.state.responses[k]).toEqual(r)
    for (const a of c.assignments) expect(cc.assignments.find((x) => x.id === a.id)?.evaluatorId === a.evaluatorId || !old.responses[a.id]).toBe(true) // 응답 있는 배정의 작성자 그대로
    expect(m.state.cycles.filter((x) => x.status === '마감' || x.status === '확정')).toEqual(old.cycles.filter((x: any) => x.status === '마감' || x.status === '확정'))
    const again = structuredClone(m.state)
    expect(joinAllStaff(again)).toEqual([])
    expect(again).toEqual(m.state)
  })
})

describe('시연 완료 비중 (D-117)', async () => {
  const { moreDemo } = await import('./demoV20')
  const { progressRows, progressCounts, isUnlocked, upwardAssignments, activeWriteAssignments } = await import('./progress')
  const live = (s: AppState) => s.cycles.find((c) => c.status === '진행')!
  it('새 시드: 제출 비중 높음, 순차 잠금 지킴, 시연 완료 구성(팀장 2·임원 1) 그대로, 미완료자도 남음', () => {
    const s = createSeed(); const c = live(s)
    const all = [...activeWriteAssignments(c, s.employees), ...upwardAssignments(c, s.employees)]
    const sub = all.filter((a) => s.responses[a.id]?.status === 'submitted')
    expect(sub.length / all.length).toBeGreaterThan(0.75)
    for (const a of sub) if (a.direction !== 'up') expect(isUnlocked(c, s.responses, a)).toBe(true)
    const n = progressCounts(progressRows(s, c))
    expect([n.byStage[1].done, n.byStage[1].writers, n.byStage[2].done, n.byStage[2].writers]).toEqual([2, 4, 1, 4])
    expect(n.participants - n.complete).toBeGreaterThan(0)
  })
  it('v19 → v20: 응답 없는(또는 시연 임시저장) 배정만 채움, 사용자 응답 그대로, 새 시드와 같은 결과, 반복 안전', () => {
    const old: any = createSeed({ until: 19 })
    const c = live(old)
    const mineA = c.assignments.find((a: any) => a.direction === 'self' && !old.responses[a.id])!
    old.responses[mineA.id] = { assignmentId: mineA.id, answers: {}, status: 'draft', savedAt: '2026-11-01T00:00:00.000Z', submittedAt: null, lang: 'ko' } // 사용자 임시저장
    const m = migrateAll(structuredClone(old))!
    expect(m.state.schemaVersion).toBe(22)
    expect(m.state.responses[mineA.id]).toEqual(old.responses[mineA.id])
    const e10up = new Set(c.assignments.filter((a: any) => a.direction === 'up' && a.targetId === 'e10').map((a: any) => a.id)) // v21(D-121)이 한 건 되돌림
    for (const [k, r] of Object.entries(old.responses as Record<string, any>)) if (!(r.demo && r.status === 'draft') && !e10up.has(k)) expect(m.state.responses[k]).toEqual(r)
    expect(m.notes.some((x) => x.includes('시연 제출'))).toBe(true)
    // 손대지 않은 v19 데이터를 변환하면 새 시드와 같은 응답
    const plain = migrateAll(createSeed({ until: 19 }))!.state
    const strip = (r: Record<string, any>) => Object.values(r).map((x) => [x.status, x.demo ?? false]).sort().join() // 시연 답 내용은 배정 ID(회차 생성 시각)에 따라 다름
    expect(strip(plain.responses)).toBe(strip(createSeed().responses))
    // 반복 안전: v20만 적용한 데이터에 다시 돌려도 그대로(v21이 되돌린 한 건은 v20 이후 단계)
    const v20 = createSeed({ until: 19 }); moreDemo(v20)
    const again = structuredClone(v20)
    expect(moreDemo(again)).toEqual([])
    expect(again).toEqual(v20)
  })
})

describe('문항 일괄 업로드 = 명단 업로드와 같은 흐름 (D-118)', async () => {
  const Q = await import('./questions')
  const X = await import('./xlsx')
  const R = await import('./roster')
  const HEAD = ['영역', '질문', '유형', '필수', '선택지', '선택지점수', '적용평가', '배점', '도움말']
  const ROWS = [
    ['업무성과', '올해 가장 중요한 성과', '긴 서술형', 'Y', '', '', '자기', '', '구체적으로'],
    ['업무성과', '목표 달성 정도', '5점 척도', 'Y', '', '', '자기|팀장|임원', '2', ''],
    ['근무태도', '안전수칙 준수', 'O/X', 'N', '예|아니오', '', '팀장', '', ''],
    ['업무능력', '업무 숙련도', '단일선택', 'Y', '상|중|하', '3|2|1', '팀장|임원', '', ''],
    ['리더십', '팀 목표를 명확히 제시', '5점 척도', 'Y', '', '', '팀원→팀장', '', ''],
    ['종합', '종합 등급', '등급', 'Y', '', '', '임원', '', ''],
  ]
  it('엑셀(.xlsx) 파일 → 모든 행이 문항으로(유형·필수·선택지·점수·적용평가·배점·도움말)', async () => {
    const r = await R.readRosterFile('문항.xlsx', X.templateXlsx('문항', HEAD, ROWS))
    expect(r.ok).toBe(true)
    const res = Q.parseQuestionTable((r as any).sheets[0].rows)
    expect(Q.canImportQuestions(res)).toBe(true)
    const qs = res.rows.map((x) => x.question!)
    expect(qs.map((q) => q.type)).toEqual(['long', 'scale5', 'ox', 'single', 'scale5', 'grade'])
    expect(qs[0]).toMatchObject({ title: '올해 가장 중요한 성과', required: true, help: '구체적으로', rules: ['self'] })
    expect(qs[1]).toMatchObject({ points: 2, rules: ['self', 'teamLead', 'executive'], purpose: 'score' })
    expect(qs[2]).toMatchObject({ required: false }); expect(qs[2].options.map((o) => o.label)).toEqual(['예', '아니오'])
    expect(qs[3].options.map((o) => [o.label, o.value])).toEqual([['상', 3], ['중', 2], ['하', 1]])
    expect(qs[4]).toMatchObject({ rules: ['upward'], directions: ['up'] })
    expect(qs[5]).toMatchObject({ type: 'grade', purpose: 'score' })
    const t: any = { sections: [] }
    Q.appendImported(t, res.rows)
    expect(t.sections.map((x: any) => [x.title, x.questions.length])).toEqual([['업무성과', 2], ['근무태도', 1], ['업무능력', 1], ['리더십', 1], ['종합', 1]])
  })
  it('CSV도 같은 결과, 열 순서 무관, 위쪽 빈 행·쓰지 않는 열 허용', async () => {
    const order = [2, 0, 1, 6, 3, 4, 5, 7, 8]
    const csv = '﻿\r\n' + [[...order.map((i) => HEAD[i]), '비고'], ...ROWS.map((r) => [...order.map((i) => r[i]), '메모'])].map((r) => r.map((v) => (/[,"]/.test(v) ? `"${v}"` : v)).join(',')).join('\r\n')
    const r = await R.readRosterFile('문항.csv', new TextEncoder().encode(csv))
    const res = Q.parseQuestionTable((r as any).sheets[0].rows)
    expect(res.ignored).toEqual(['비고'])
    expect(Q.canImportQuestions(res)).toBe(true)
    expect(res.rows.map((x) => x.question!.title)).toEqual(ROWS.map((x) => x[1]))
  })
  it('한 행이라도 오류면 아무것도 넣지 않음 · 필수 열 없음·중복 열은 파일 오류 · 팀원→팀장 평가표는 빈 적용평가 = 팀원→팀장평가', () => {
    const bad = Q.parseQuestionTable([HEAD, ROWS[0], ['업무성과', '', '모름', 'Y', '', '', '자기', 'x', '']])
    expect(Q.canImportQuestions(bad)).toBe(false)
    expect(bad.rows[1].errors.join()).toMatch(/질문: 비어 있음.*배점/)
    expect(Q.parseQuestionTable([['영역', '유형'], ['a', '서술형']]).headerError).toContain('질문')
    expect(Q.parseQuestionTable([['영역', '질문', '유형', '유형'], ['a', 'b', '서술형', '서술형']]).headerError).toContain('두 번')
    const up = Q.parseQuestionTable([['영역', '질문', '유형'], ['소통', '의견을 경청한다', '5점 척도']], ['upward'])
    expect(up.rows[0].question).toMatchObject({ rules: ['upward'], directions: ['up'] })
  })
})

describe('문항 업로드: 질문만 있어도 (D-120)', async () => {
  const Q = await import('./questions')
  it('질문 열 하나만 → 영역 미분류·유형 긴 서술형으로 모두 등록(안내 표시), 별칭 머리글(문항·평가항목·문항유형)도 인식', () => {
    const only = Q.parseQuestionTable([['질문'], ['올해 성과'], ['내년 목표']])
    expect(Q.canImportQuestions(only)).toBe(true)
    expect(only.rows.map((r) => [r.section, r.question!.type, r.question!.title])).toEqual([['미분류', 'long', '올해 성과'], ['미분류', 'long', '내년 목표']])
    expect(only.rows[0].notes).toEqual(["영역 없음 → '미분류'", '유형 없음 → 긴 서술형'])
    const alias = Q.parseQuestionTable([['평가항목', '문항', '문항유형', '보기'], ['성과', '목표 달성', '', '상|중|하'], ['', '협업', '5점 척도', '']])
    expect(alias.rows.map((r) => [r.section, r.question!.title, r.question!.type])).toEqual([['성과', '목표 달성', 'single'], ['미분류', '협업', 'scale5']])
    const t: any = { sections: [] }
    Q.appendImported(t, only.rows)
    expect(t.sections.map((x: any) => [x.title, x.questions.length])).toEqual([['미분류', 2]])
  })
})

describe('장현우 팀원→팀장평가 5/6 (D-121)', async () => {
  const { leadUpwardOpen } = await import('./demoV20')
  const { progressRows } = await import('./progress')
  it('새 시드: 장현우가 받는 팀원→팀장평가 5/6, 사용자 응답이면 되돌리지 않음, 반복 안전', () => {
    const s = createSeed(); const c = s.cycles.find((x) => x.status === '진행')!
    const r = progressRows(s, c).find((x) => x.t.employeeId === 'e10')!
    expect(r.up).toMatchObject({ kind: 'write', w: { done: 5, total: 6 } })
    expect(r.complete).toBe(false)
    expect(leadUpwardOpen(s)).toEqual([])
    const u: any = createSeed({ until: 19 })
    const cu = u.cycles.find((x: any) => x.status === '진행')
    for (const a of cu.assignments.filter((x: any) => x.direction === 'up' && x.targetId === 'e10')) u.responses[a.id] = { assignmentId: a.id, answers: {}, status: 'submitted', savedAt: '', submittedAt: '', lang: 'ko' } // 사용자 기록
    expect(leadUpwardOpen(u)).toEqual([])
  })
})

describe('구분·배점·평가내용 표(영역 표)·한 시트 여러 표 (D-123)', async () => {
  const Q = await import('./questions')
  const P = await import('./points')
  const X = await import('./xlsx')
  const R = await import('./roster')
  const SHEET = [
    ['', '', ''], ['팀장 본인평가 예시', '', ''], ['', '', ''],
    ['구분', '배점', '평가내용'],
    ['업무성과', '30', '부서 목표 달성도, 업무 추진실적, 성과 창출 및 개선실적'],
    ['리더십 및\n조직관리', '25', '업무분장, 구성원 지도·육성, 갈등 조정, 조직 운영능력'],
    ['직무역량 및\n의사결정', '20', '직무 전문성, 문제해결 능력, 상황 판단 및 의사결정의 적절성'],
    ['책임감 및\n규정준수', '15', '관리자로서의 책임 이행, 회사규정 준수, 리스크 예방 및 대응'],
    ['협업 및 조\n직기여', '10', '타 부서 협력, 경영방침 이행, 조직 전체의 목표 달성 기여'],
    ['합계', '100', ''], ['', '', ''],
    ['임원 및 팀장 상향평가 예시', '', ''], ['', '', ''],
    ['구분', '배점', '평가내용'],
    ['업무지시 및\n관리능력', '25', '업무지시의 명확성, 업무분장의 적정성, 업무 진행상황 관리'],
    ['리더십 및\n의사결정', '25', '문제해결 능력, 합리적인 의사결정, 책임 있는 업무처리'],
    ['소통 및 피\n드백', '20', '구성원 의견 경청, 원활한 의사소통, 적절한 업무지도 및 피드백'],
    ['공정성 및\n신뢰성', '20', '구성원에 대한 공정한 대우, 객관적인 업무평가, 일관된 원칙 적용'],
    ['조직문화 및\n협업', '10', '상호존중, 갈등관리, 협력적인 근무환경 조성'],
    ['합계', '100', ''],
  ]
  it('엑셀 한 시트의 두 표 → 표 제목으로 나눔, 한 줄 = 영역(배점 = 영역 배점, 평가내용 = 5점 척도 문항·설명), 합계 줄 제외·확인', async () => {
    const r = await R.readRosterFile('평가표.xlsx', X.templateXlsx('평가표', SHEET[0], SHEET.slice(1)))
    const blocks = Q.questionBlocks((r as any).sheets[0].rows)
    expect(blocks.map((b) => b.title)).toEqual(['팀장 본인평가 예시', '임원 및 팀장 상향평가 예시'])
    const self = Q.parseQuestionTable(blocks[0].table, ['self'])
    expect(Q.canImportQuestions(self)).toBe(true)
    expect(self.rows.map((x) => [x.section, x.sectionPoints, x.question!.type, x.question!.purpose])).toEqual([
      ['업무성과', 30, 'scale5', 'score'], ['리더십 및 조직관리', 25, 'scale5', 'score'], ['직무역량 및 의사결정', 20, 'scale5', 'score'], ['책임감 및 규정준수', 15, 'scale5', 'score'], ['협업 및 조 직기여', 10, 'scale5', 'score'],
    ])
    expect(self.rows[0].question!.title).toBe('부서 목표 달성도, 업무 추진실적, 성과 창출 및 개선실적')
    expect(self.rows[0].question!.points).toBeUndefined() // 문항 배점 아님
    expect(self.notes!.join()).toContain('합계 줄 100점 = 배점 합 100점')
    const t: any = { sections: [] }
    Q.appendImported(t, self.rows)
    expect(t.sections.map((x: any) => [x.title, x.points, x.desc, x.questions.length])).toEqual(self.rows.map((x) => [x.section, x.sectionPoints, x.question!.title, 1]))
    expect(P.usesPoints(t)).toBe(true)
    expect(P.pointsErrors(t)).toEqual([])
    const up = Q.parseQuestionTable(blocks[1].table, ['upward'])
    expect(up.rows.map((x) => x.sectionPoints)).toEqual([25, 25, 20, 20, 10])
    expect(up.rows.every((x) => x.question!.rules!.join() === 'upward')).toBe(true)
  })
  it('합계가 배점 합과 다르면 안내(막지는 않음)', () => {
    const res = Q.parseQuestionTable([['구분', '배점', '평가내용'], ['A', '60', 'a'], ['B', '30', 'b'], ['합계', '100', '']])
    expect(Q.canImportQuestions(res)).toBe(true)
    expect(res.notes!.join()).toContain('다릅니다')
  })
})

describe('팀원→팀장 평가표 = 회사 상향평가 예시 (D-124)', async () => {
  const U = await import('./upward')
  const T = await import('./templates')
  const P = await import('./points')
  const old = (id: string): any[] => T.UPWARD_V1_KEYS.map((k) => ({ id: `${id}-${k}`, title: k, area: null, questions: [{ id: `${id}-${k}-q`, type: k === 'free' ? 'long' : 'scale5', title: k, help: '', required: k !== 'free', purpose: 'score', maxPoints: null, options: [], directions: ['up'], rules: ['upward'], active: true }] }))
  it('새 시드: 영역 5개(배점 25·25·20·20·10 = 100)·영역마다 5점 척도 + 의견, 러시아어 번역', () => {
    const s = createSeed(); const c = s.cycles.find((x) => x.status === '진행')!
    const t = c.templates[U.upwardTemplateOf(c)!]
    expect(t.sections.map((x) => [x.title, x.points ?? null])).toEqual([['업무지시 및 관리능력', 25], ['리더십 및 의사결정', 25], ['소통 및 피드백', 20], ['공정성 및 신뢰성', 20], ['조직문화 및 협업', 10], ['의견', null]])
    expect(P.pointsErrors(t)).toEqual([])
    expect(t.sections[0].questions[0]).toMatchObject({ type: 'scale5', rules: ['upward'] })
    expect(t.sections[0].i18n?.ru?.title).toBe('Постановка задач и управление')
  })
  it('v21 → v22: 첫 초기값·시연 응답만이면 새 내용으로(시연 답 다시 만들고 상태 그대로), 사용자 응답·고친 평가표는 그대로, 반복 안전', () => {
    const s = createSeed(); const c = s.cycles.find((x) => x.status === '진행')!
    const id = U.upwardTemplateOf(c)!
    c.templates[id].sections = old(id)
    const ups = c.assignments.filter((a) => a.templateId === id)
    const st = Object.fromEntries(ups.map((a) => [a.id, s.responses[a.id]?.status]))
    expect(U.upwardFormV22(s)[0]).toContain('상향평가 예시')
    expect(c.templates[id].sections.length).toBe(6)
    for (const a of ups) expect(s.responses[a.id]?.status).toBe(st[a.id])
    const sub = ups.find((a) => s.responses[a.id]?.status === 'submitted')!
    expect(Object.keys(s.responses[sub.id].answers)).toContain(`${id}-order-q`)
    expect(U.upwardFormV22(s)).toEqual([])
    // 사용자 응답이 있으면 그대로
    const s2 = createSeed(); const c2 = s2.cycles.find((x) => x.status === '진행')!
    const id2 = U.upwardTemplateOf(c2)!; c2.templates[id2].sections = old(id2)
    const a2 = c2.assignments.find((a) => a.templateId === id2)!
    s2.responses[a2.id] = { assignmentId: a2.id, answers: {}, status: 'submitted', savedAt: '', submittedAt: '', lang: 'ko' }
    expect(U.upwardFormV22(s2)[0]).toContain('사용 중지로 보존')
    const t2 = c2.templates[id2]
    expect(t2.sections.map((x) => x.title).slice(0, 6)).toEqual(['업무지시 및 관리능력', '리더십 및 의사결정', '소통 및 피드백', '공정성 및 신뢰성', '조직문화 및 협업', '의견'])
    expect(t2.sections.slice(6).every((x) => x.questions.every((q) => !q.active))).toBe(true) // 이전 문항 = 사용 중지(응답 보존)
    expect(s2.responses[a2.id]).toMatchObject({ status: 'submitted', answers: {} })
    expect(P.pointsErrors(t2)).toEqual([])
    expect(U.upwardFormV22(s2)).toEqual([])
  })
})
