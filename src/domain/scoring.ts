// ⚠ 개발용 가정 계산. 회사의 현재 산식이 아니다. (docs/scoring.md)
import type { Adjustment, AppState, Cycle, Direction, Response, Template } from './types'
import { appliedStages, pathFor, resultPeople, resultPerson, stageAssignments, upwardAssignments } from './progress'
import { applies, ctxFor, weightErrors, type QCtx } from './questions'
import { applyBlend, deptKpi, type DeptKpi } from './kpi'
import type { KpiBlend } from './types'
import { pointsStageScore, usesPoints } from './points'

/**
 * 단계 점수. 영역 배점이 있는 평가표는 배점 방식(D-103, points.ts), 없으면 이전 방식:
 * 점수 문항(숫자 값이 있는 선택지)의 응답 합 ÷ 최고점 합 × 100
 */
export function stageScore(t: Template, r: Response | undefined, ctxOrDir: QCtx | Direction, manual?: Record<string, number>): number | null {
  if (!r) return null
  const ctx: QCtx = typeof ctxOrDir === 'string' ? { direction: ctxOrDir } : ctxOrDir
  if (usesPoints(t)) return pointsStageScore(t, r, ctx, manual).score
  let got = 0
  let max = 0
  for (const s of t.sections)
    for (const q of s.questions) {
      if (q.purpose !== 'score' || !applies(q, ctx)) continue
      const values = q.options.map((o) => o.value).filter((v): v is number => v !== null)
      if (values.length === 0) continue // 등급(A~D)처럼 점수 환산이 정해지지 않은 문항은 제외
      const picked = q.options.find((o) => o.id === r.answers[q.id])
      if (!picked || picked.value === null) continue
      got += picked.value
      max += Math.max(...values)
    }
  return max === 0 ? null : (got / max) * 100
}

/** 점수 환산이 없는 등급 문항(A~D)의 선택 라벨 */
export function gradeAnswer(t: Template, r: Response | undefined): string | null {
  if (!r) return null
  for (const s of t.sections)
    for (const q of s.questions)
      if (q.active && q.type === 'grade' && q.options.every((o) => o.value === null)) {
        const o = q.options.find((x) => x.id === r.answers[q.id])
        if (o) return o.label
      }
  return null
}

export interface CombineInput {
  stages: { score: number | null; weight: number | null; submitted: boolean }[]
  weightError?: string | null
  dept: number | null
  person: number | null
  ceoScore: number | null
  /** 부서 KPI 반영 (없거나 꺼져 있으면 기초 점수 그대로) */
  kpi?: { blend: KpiBlend; deptScore: number | null }
}
export interface CombineResult {
  base: number | null // 개인평가 기초 점수
  afterKpi: number | null // KPI 반영 후 (반영 안 하면 base와 같음)
  kpiApplied: boolean
  kpiNote: string
  afterAdjust: number | null
  final: number | null
  incomplete: boolean
  note: string
}

/** 순수 함수 — 자동 테스트 대상 */
export function combine(i: CombineInput): CombineResult {
  const scored = i.stages.filter((s) => (s.weight ?? 0) > 0)
  const missing = scored.some((s) => !s.submitted || s.score === null)
  let base: number | null = null
  let note = ''
  if (i.weightError || i.stages.some((s) => s.weight === null)) note = i.weightError || '단계 반영 비율이 입력되지 않아 계산하지 않음'
  else if (scored.length === 0) note = '점수 단계 없음'
  else if (missing) note = i.stages.some((s) => s.submitted && s.score === null) ? '미채점·점수 없는 단계가 있어 계산하지 않음 (0점 처리 안 함)' : '미제출 단계가 있어 계산하지 않음 (0점 처리·가중치 재분배 안 함)'
  else {
    const wsum = scored.reduce((a, s) => a + s.weight!, 0)
    base = scored.reduce((a, s) => a + s.score! * s.weight!, 0) / wsum
  }
  // 1·2·3. 개인 기초 점수 → (켜져 있으면) 부서 KPI 반영. KPI는 보정점과 별개라 여기서 한 번만 섞는다
  const b = applyBlend(base, i.kpi?.blend, i.kpi?.deptScore ?? null)
  // 4. 부서 보정·개인 보정 (가산)
  const afterAdjust = b.afterKpi === null ? null : b.afterKpi + (i.dept ?? 0) + (i.person ?? 0)
  // 5. 최종 지정값이 있으면 그 값 (0은 유효한 값, null만 "없음")
  const final = i.ceoScore !== null ? i.ceoScore : afterAdjust
  return { base, afterKpi: b.afterKpi, kpiApplied: b.applied, kpiNote: b.note, afterAdjust, final, incomplete: base === null || b.afterKpi === null, note: note || b.note }
}

export function latestAdjustment(adjs: Adjustment[], cycleId: string, kind: Adjustment['kind'], key: string) {
  const list = adjs.filter((a) => a.cycleId === cycleId && a.kind === kind && a.targetKey === key)
  return list.length ? list[list.length - 1] : null
}
const num = (a: Adjustment | null) => (a && typeof a.value === 'number' ? a.value : null)

export interface PersonResult {
  stages: { order: number; label: string; evaluators: string[]; score: number | null; grade: string | null; submitted: boolean; weight: number | null; ungraded?: boolean }[]
  kpi: number | null // 부서 KPI 점수 (출처에 따라 직접 입력 또는 지표 계산, 미완료면 null)
  kpiDetail: DeptKpi
  kpiBlend: KpiBlend
  dept: number | null
  person: number | null
  ceoScore: number | null
  /** 최종 등급(D-197): 최종 점수 순위 × 등급 인원 비율로 자동(관리자가 직접 고르지 않음). 최종 점수가 없으면 null */
  grade: string | null
  combined: CombineResult
}

export function personResult(state: AppState, cycle: Cycle, targetId: string): PersonResult | null {
  const r = baseResult(state, cycle, targetId)
  return r && { ...r, grade: cycleGrades(state, cycle).get(targetId) ?? null }
}

/**
 * 최종 등급 자동 계산(D-197): 이 회차에서 최종 점수가 있는 사람을 점수 높은 순으로 세워 등급 인원 비율(A~E, 모든 회차 공통)대로 자른다.
 * n명 중 A = 앞에서 round(n × A%)명, B = 그다음 round(n × (A+B)%)까지 …(누적 비율로 반올림). 같은 점수는 같은 등급(앞 사람의 등급).
 * 최종 점수가 없는 사람(미완료·1·2·3단계 없는 임원)은 등급 없음 — 완료자가 늘면 등급이 달라질 수 있음
 */
export function cycleGrades(state: AppState, cycle: Cycle): Map<string, string> {
  const ratios = state.policy?.gradeRatios ?? { A: 0, B: 0, C: 0, D: 0, E: 0 }
  const G = ['A', 'B', 'C', 'D', 'E'] as const
  const list = resultPeople(state, cycle)
    .map((t) => ({ id: t.employeeId, v: baseResult(state, cycle, t.employeeId)?.combined.final ?? null }))
    .filter((x): x is { id: string; v: number } => x.v !== null)
    .sort((a, b) => b.v - a.v)
  const n = list.length
  const cuts: number[] = []
  let cum = 0
  for (const g of G) { cum += ratios[g] ?? 0; cuts.push(Math.round((n * cum) / 100)) }
  const out = new Map<string, string>()
  list.forEach((x, i) => {
    const prev = list[i - 1]
    if (prev && prev.v === x.v) { out.set(x.id, out.get(prev.id)!); return }
    const k = cuts.findIndex((c) => i < c)
    out.set(x.id, G[k < 0 ? G.length - 1 : k])
  })
  return out
}

function baseResult(state: AppState, cycle: Cycle, targetId: string): Omit<PersonResult, 'grade'> | null {
  const target = resultPerson(state, cycle, targetId) // 대상자 + 참여 임원(D-192)
  if (!target) return null
  const nameOf = (id: string) => state.employees.find((e) => e.id === id)?.name ?? '(알 수 없음)'
  // 이 대상자에게 적용되는 단계만 (끈 자기평가 제외, D-068). 기초 점수는 적용 단계의 반영 비율 합으로 나눈다
  const stages = appliedStages(cycle, target).map((st) => {
    const as = stageAssignments(cycle, targetId, st.order)
    const scores: number[] = []
    let grade: string | null = null
    let submitted = as.length > 0
    let ungraded = false // 배점 있는 서술형 미채점(D-103) — 단계 점수 없음(미완료), 0점 아님
    for (const a of as) {
      const r = state.responses[a.id]
      if (!r || r.status !== 'submitted') { submitted = false; continue }
      const t = cycle.templates[a.templateId]
      const manual = state.manualScores?.[a.id]
      if (usesPoints(t) && pointsStageScore(t, r, ctxFor(cycle, a), manual).ungraded.length) ungraded = true
      const sc = stageScore(t, r, ctxFor(cycle, a), manual)
      if (sc !== null) scores.push(sc)
      grade = gradeAnswer(t, r) ?? grade
    }
    return {
      order: st.order,
      label: st.label,
      evaluators: as.map((a) => nameOf(a.evaluatorId)),
      // 같은 단계 평가자가 여럿(임원 4명 등, D-081)이면 평가자별 단계 점수를 같은 비중으로 평균. 모두 제출 전에는 점수 없음(부분 평균을 완료처럼 보이지 않게)
      score: submitted && !ungraded && scores.length ? scores.reduce((x, y) => x + y, 0) / scores.length : null,
      ungraded,
      grade,
      submitted,
      weight: weightsFor(cycle, target)[st.order] ?? null,
    }
  })
  // 조직 단위는 회차 시작 시점 소속(스냅샷) 기준 — 나중에 팀을 옮겨도 과거 회차 KPI는 그대로
  const kpiDetail = deptKpi(state, cycle.id, target.departmentId, target.jobType) // 그 사람 직무에 적용되는 지표만(D-150)
  const kpi = kpiDetail.score
  // D-215: 최종 점수 = (보정 점수가 있으면 그 값, 없으면 기초 점수) × (100 − 팀 KPI%) + 팀 KPI 점수 × 팀 KPI%.
  // 팀 KPI% = KPI 반영 > 직급별 비율의 그 직급 '팀 KPI'(켜진 경우, 사원 20·팀장 40·임원 60). 유효한 팀 KPI가 없으면 기초(보정) 점수 그대로.
  // 기초 점수: 사원·팀장 = 1·2·3단계(20/40/40) 합산, 임원 = 받은 상향평가 평균(모두 제출됐을 때). 팀 보정·최종 지정 점수는 쓰지 않음(D-197)
  const tier = target.isExecutive ? 'exec' : target.isTeamLead ? 'lead' : 'member'
  const kpiItem = cycle.finalBlendPlan?.[tier]?.find((x) => x.key === 'kpi' && x.on)
  const kpiPct = kpiItem && typeof kpiItem.pct === 'number' && kpiItem.pct > 0 && kpiItem.pct <= 100 ? kpiItem.pct : 0
  const kpiBlend = { enabled: kpiPct > 0, personal: 100 - kpiPct, kpi: kpiPct }
  const dept = null
  const person = num(latestAdjustment(state.adjustments, cycle.id, 'person', targetId)) // 보정 점수(기초 점수를 바꾸는 값, D-215)
  const ceoScore = null
  const c0 = combine({ stages, dept: null, person: null, ceoScore: null, weightError: weightErrors(pathFor(cycle, target), weightsFor(cycle, target))[0] ?? null })
  const base = tier === 'exec' && !stages.length ? execUpwardAverage(state, cycle, targetId) : c0.base
  const used = person ?? base
  const b = applyBlend(used, kpiBlend, kpi)
  const combined: CombineResult = { ...c0, base, afterKpi: b.afterKpi, kpiApplied: b.applied, kpiNote: b.note, afterAdjust: b.afterKpi, final: b.afterKpi, incomplete: used === null || b.afterKpi === null }
  return { stages, kpi, kpiDetail, kpiBlend, dept, person, ceoScore, combined }
}

export const fmt = (n: number | null, digits = 1) => (n === null ? '—' : n.toFixed(digits))
export const fmtSigned = (n: number | null) => (n === null ? '—' : (n > 0 ? '+' : '') + n.toFixed(1))

/** 회차의 경로별 단계 반영 비율(%). 이전 데이터에 없으면 빈 값(미입력). 임원 경로는 자기평가 하나라 기본 100% */
export function weightsFor(cycle: Cycle, target: { isTeamLead: boolean; isExecutive?: boolean }): Record<number, number | null> {
  if (target.isExecutive) return cycle.stageWeights?.exec ?? { 1: 100 }
  return (target.isTeamLead ? cycle.stageWeights?.lead : cycle.stageWeights?.member) ?? {}
}

/** 임원 기초 점수(D-215): 사원·팀장이 매긴 상향평가 점수 평균 — 받은 상향평가가 모두 제출됐을 때만(일부만이면 미완료) */
export function execUpwardAverage(state: AppState, cycle: Cycle, targetId: string): number | null {
  const ups = upwardAssignments(cycle, state.employees).filter((a) => a.targetId === targetId)
  if (!ups.length) return null
  const scores: number[] = []
  for (const a of ups) {
    const r = state.responses[a.id]
    if (!r || r.status !== 'submitted') return null
    const sc = stageScore(cycle.templates[a.templateId], r, ctxFor(cycle, a), state.manualScores?.[a.id])
    if (sc === null) return null
    scores.push(sc)
  }
  return scores.reduce((x, y) => x + y, 0) / scores.length
}
