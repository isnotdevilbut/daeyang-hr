// ⚠ 팀 KPI 계산 (조직 단위 = 팀, D-065) — 이번 목업의 제안 정책(D-040·D-041). 회사가 승인한 산식이 아니다. (docs/scoring.md)
//
// 지표: 목표가 양수일 때
//   높을수록 좋음  달성률 = 실적 ÷ 목표 × 100
//   낮을수록 좋음  달성률 = 목표 ÷ 실적 × 100 (실적 0 = 목표 달성, 점수 100)
//   지표 환산점수 = 달성률을 0~100으로 제한
// 팀 KPI 점수 = Σ(지표 환산점수 × 지표 가중치 ÷ 100) — 지표별 상한 적용 후 가중합, 가중치 합 100% 필수
// 미입력·목표 0·음수·가중치 오류가 있으면 "설정 미완료" (누락 지표를 빼고 재정규화하지 않음)
import type { AppState, Cycle, JobType, KpiBlend, KpiEntry, KpiIndicator, KpiUnit } from './types'

export const UNIT_TEXT: Record<KpiUnit, string> = { percent: '%', count: '건', point: '점', amount: '원', other: '' }
export const UNIT_LABEL: Record<KpiUnit, string> = { percent: '%', count: '건', point: '점', amount: '금액(원)', other: '기타' }

export function withUnit(v: number | null, unit: KpiUnit, unitText?: string): string {
  if (v === null) return '미입력'
  const n = Number.isInteger(v) ? v.toLocaleString('ko-KR') : v.toLocaleString('ko-KR', { maximumFractionDigits: 2 })
  if (unit === 'other') return unitText?.trim() ? `${n}${unitText.trim()}` : n // D-240: 기타 = 직접 쓴 단위
  return unit === 'amount' ? `${n}원` : `${n}${UNIT_TEXT[unit]}`
}

export interface IndicatorResult {
  rate: number | null // 달성률(%) — 100 초과 가능
  score: number | null // 0~100
  status: 'ok' | 'targetMet' | 'incomplete' | 'invalid'
  message: string
}

/** 지표 입력값 검증 (저장 전). 목표 0·음수는 저장을 막는다 */
export function indicatorErrors(i: Pick<KpiIndicator, 'name' | 'target' | 'actual' | 'weight'>): string[] {
  const e: string[] = []
  if (!i.name.trim()) e.push('지표 이름을 입력하세요.')
  for (const [label, v] of [['목표값', i.target], ['실적값', i.actual]] as const) {
    if (v !== null && !Number.isFinite(v)) e.push(`${label}은 숫자로 입력하세요.`)
    else if (v !== null && v < 0) e.push(`${label}은 0 이상이어야 합니다. (음수는 이 계산 방식에서 지원하지 않습니다)`)
  }
  if (i.target === 0) e.push('목표값이 0이면 달성률을 계산할 수 없습니다. 0보다 큰 목표를 입력하세요.')
  if (i.weight !== null && (!Number.isFinite(i.weight) || i.weight < 0 || i.weight > 100)) e.push('가중치는 0~100 사이로 입력하세요.')
  return e
}

export function indicatorResult(i: KpiIndicator): IndicatorResult {
  if (i.target === null || i.actual === null) return { rate: null, score: null, status: 'incomplete', message: '목표·실적 입력 필요' }
  if (i.target < 0 || i.actual < 0) return { rate: null, score: null, status: 'invalid', message: '음수는 계산할 수 없음' }
  if (i.target === 0) return { rate: null, score: null, status: 'invalid', message: '목표 0은 계산할 수 없음' }
  if (i.direction === 'lower' && i.actual === 0) return { rate: null, score: 100, status: 'targetMet', message: '목표 달성' }
  const rate = i.direction === 'higher' ? (i.actual / i.target) * 100 : (i.target / i.actual) * 100
  return { rate, score: Math.min(100, Math.max(0, rate)), status: 'ok', message: '' }
}

export type KpiMode = 'manual' | 'indicators'
export interface DeptKpi {
  mode: KpiMode
  score: number | null // 사용할 부서 KPI 점수 (0~100). 미완료면 null
  status: 'ok' | 'incomplete' | 'empty'
  reason: string
  indicators: { ind: KpiIndicator; r: IndicatorResult }[]
  weightSum: number | null
  manualScore: number | null // 직접 입력 점수 (보관값)
  /** 직무별로 나뉜 팀(D-150): 직무마다 점수. 팀 화면(직무 미지정)에서만 채움 — 이때 score는 null */
  byJob?: { jobType: JobType; k: DeptKpi }[]
}

/** 이 직무에 적용되는 지표인가(직무 미지정 = 전체) */
export const indicatorFor = (ind: KpiIndicator, jobType?: JobType) => !jobType || !ind.jobs?.length || ind.jobs.includes(jobType)
/** 팀 지표 중 직무를 지정한 지표가 있으면 그 팀은 직무별 점수 */
export const splitByJob = (inds: KpiIndicator[]) => inds.some((x) => x.jobs?.length)

export function kpiEntry(s: Pick<AppState, 'kpi'>, cycleId: string, deptId: string): KpiEntry | undefined {
  return s.kpi.find((k) => k.cycleId === cycleId && k.departmentId === deptId)
}

/** 점수 출처: 저장된 mode, 없으면 직접 입력 점수가 있을 때 직접 입력 */
export function kpiMode(e: KpiEntry | undefined): KpiMode {
  return e?.mode ?? (e && e.score !== null ? 'manual' : 'indicators')
}

/**
 * 팀 KPI 점수. jobType을 주면 그 직무에 적용되는 지표(직무 미지정 + 그 직무)만으로 계산 — 개인 점수(D-150).
 * jobType 없이(팀 화면) 직무를 지정한 지표가 있으면 jobTypes의 직무마다 계산해 byJob에 담는다
 */
export function deptKpi(s: Pick<AppState, 'kpi' | 'kpiIndicators'>, cycleId: string, deptId: string, jobType?: JobType, jobTypes: JobType[] = []): DeptKpi {
  const e = kpiEntry(s, cycleId, deptId)
  const mode = kpiMode(e)
  const manualScore = e?.score ?? null
  const all = s.kpiIndicators.filter((x) => x.cycleId === cycleId && x.departmentId === deptId)
  if (!jobType && mode !== 'manual' && splitByJob(all)) {
    const indicators = all.map((ind) => ({ ind, r: indicatorResult(ind) }))
    const byJob = jobTypes.map((j) => ({ jobType: j, k: deptKpi(s, cycleId, deptId, j) })).filter((x) => x.k.indicators.length > 0)
    return { mode, manualScore, indicators, weightSum: null, score: null, status: 'ok', reason: '직무별 점수', byJob }
  }
  const inds = all.filter((x) => indicatorFor(x, jobType))
  const indicators = inds.map((ind) => ({ ind, r: indicatorResult(ind) }))
  const weights = inds.map((x) => x.weight)
  const weightSum = weights.some((w) => w === null) ? null : +weights.reduce<number>((a, w) => a + (w as number), 0).toFixed(4)
  if (mode === 'manual') {
    return { mode, manualScore, indicators, weightSum, score: manualScore, status: manualScore === null ? 'incomplete' : 'ok', reason: manualScore === null ? '점수 미입력' : '' }
  }
  const base = { mode, manualScore, indicators, weightSum }
  if (inds.length === 0) return { ...base, score: null, status: 'empty', reason: '지표 없음' }
  if (indicators.some((x) => x.r.status === 'incomplete')) return { ...base, score: null, status: 'incomplete', reason: '목표·실적 미입력 지표 있음' }
  if (indicators.some((x) => x.r.status === 'invalid')) return { ...base, score: null, status: 'incomplete', reason: '계산할 수 없는 지표 있음' }
  if (weightSum === null) return { ...base, score: null, status: 'incomplete', reason: '가중치 미입력 지표 있음' }
  if (Math.abs(weightSum - 100) > 0.001) return { ...base, score: null, status: 'incomplete', reason: `가중치 합계 ${+weightSum.toFixed(2)}% (100% 필요)` }
  const score = indicators.reduce((a, x) => a + (x.r.score as number) * (x.ind.weight as number) / 100, 0)
  return { ...base, score, status: 'ok', reason: '' }
}

// ── 개인평가 반영 ─────────────────────────────────────
export const BLEND_START = { personal: 80, kpi: 20 } // 최초 활성화 시 편집 가능한 시작값 (회사 확정 비율 아님)

export function blendErrors(b: Pick<KpiBlend, 'personal' | 'kpi'>): string[] {
  const e: string[] = []
  for (const [label, v] of [['개인평가 비율', b.personal], ['팀 KPI 비율', b.kpi]] as const) {
    if (v === null || !Number.isFinite(v)) e.push(`${label}을 입력하세요.`)
    else if (v < 0 || v > 100) e.push(`${label}은 0~100 사이여야 합니다.`)
  }
  if (e.length === 0 && Math.abs((b.personal as number) + (b.kpi as number) - 100) > 0.001) e.push(`두 비율의 합이 ${+((b.personal as number) + (b.kpi as number)).toFixed(2)}%입니다. 100%가 되어야 합니다.`)
  return e
}

export interface BlendResult { afterKpi: number | null; applied: boolean; note: string }

/** 개인 기초 점수에 부서 KPI를 섞는다. 꺼져 있으면 기초 점수 그대로 */
/**
 * 팀 KPI 반영 (D-074 — KPI는 팀별 선택 항목. D-041의 "반영 중 KPI가 없으면 계산하지 않음"을 대체).
 * 유효한 팀 KPI가 있고, 반영이 켜져 있고, KPI 비율이 0보다 클 때만 섞는다. 그 밖(KPI 없음·설정 미완료·반영 끔·비율 0·비율 오류)은
 * 개인평가 기초 점수를 그대로 다음 단계(보정·최종 지정)로 넘긴다 — 없는 KPI를 0점으로 넣거나 개인 비율만 곱하지 않는다.
 * 유효한 KPI 0점은 "없음"이 아니라 실제 0점으로 반영한다.
 */
export function applyBlend(base: number | null, blend: KpiBlend | undefined, deptScore: number | null): BlendResult {
  const usable = !!blend?.enabled && blendErrors(blend).length === 0 && (blend.kpi as number) > 0 && deptScore !== null
  if (!usable) return { afterKpi: base, applied: false, note: '' }
  if (base === null) return { afterKpi: null, applied: false, note: '' } // 개인평가 미완료 → 반영 후 점수도 없음
  const p = blend!.personal as number, k = blend!.kpi as number
  return { afterKpi: (base * p) / 100 + ((deptScore as number) * k) / 100, applied: true, note: '' }
}

/** 팀 KPI 상태: 없음(미사용·미등록) / 정상(계산·직접 입력) / 설정 미완료(지표는 있으나 목표·실적·가중치 문제) */
export type KpiState = 'none' | 'ok' | 'invalid'
export function kpiState(k: DeptKpi): KpiState {
  if (k.score !== null) return 'ok'
  if (k.mode === 'indicators' && k.status === 'incomplete') return 'invalid'
  return 'none'
}

/** 확정된 평가는 KPI를 바꿔도 결과가 몰래 바뀌지 않도록 편집을 막는다 */
export const kpiLocked = (c: Cycle) => c.status === '확정'

/**
 * 회차의 KPI·팀 보정 단위 (D-065): 그 회차 대상자 스냅샷의 조직(새 기준은 팀). 대상자가 없으면 현재 팀.
 * 확정된 이전 회차는 그때의 단위가 그대로 나온다.
 */
export function orgUnits(s: AppState, cycle: Cycle): { id: string; name: string }[] {
  const m = new Map<string, string>()
  cycle.targets.forEach((t) => { if (t.departmentId) m.set(t.departmentId, t.departmentName) })
  if (m.size === 0) s.teams.filter((t) => !t.archived).forEach((t) => m.set(t.id, t.name))
  return [...m.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, 'ko'))
}
