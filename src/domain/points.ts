// 평가표 배점 방식 (D-103, 자문 기준 — 값은 모두 수정 가능한 초기값)
// - 영역 배점(Section.points)이 하나라도 있으면 배점 방식, 없으면 이전 방식(점수 합 ÷ 최고점 합 × 100) 그대로
// - 문항 반영 점수 = 획득 점수 ÷ 최고 점수 × 배점. 영역에 점수 문항이 여러 개면 문항 배점(Question.points, 없으면 같은 비중)으로
//   영역 달성 비율을 구한 뒤 영역 배점을 곱한다 — 영역 배점과 문항 배점을 중복 합산하지 않음
// - 평가 점수 = 각 영역 반영 점수 합(배점 합계 100 기준). 적용되는 영역의 배점 합이 100이 아니면 100점 만점으로 환산
// - 등급 문항: 평가표의 등급 환산(gradeScale, 기본 A=5…E=1) ÷ 최고값. 5점 척도·선택형은 선택지 점수 ÷ 최고 점수
// - 서술형은 배점이 있고 '점수 반영'일 때만 관리자 채점값으로 반영. 미채점이면 단계 점수 없음(0점 처리 안 함)
import type { Question, Response, Section, Template } from './types'
import { applies, isChoice, type QCtx } from './questions'

export const DEFAULT_GRADE_SCALE: Record<string, number> = { A: 5, B: 4, C: 3, D: 2, E: 1 }
export const GRADE_LETTERS = ['A', 'B', 'C', 'D', 'E'] as const
export const gradeScaleOf = (t: Pick<Template, 'gradeScale'>) => t.gradeScale ?? DEFAULT_GRADE_SCALE
/** 배점 방식 평가표인가(영역 배점이 하나라도 입력됨) */
export const usesPoints = (t: Pick<Template, 'sections'>) => t.sections.some((s) => typeof s.points === 'number')
/** 서술형 점수 문항 = 관리자 채점 대상 */
export const isManualScore = (q: Question) => !isChoice(q.type) && q.purpose === 'score' && typeof q.points === 'number' && q.points > 0

const letterOf = (label: string) => label.trim().charAt(0).toUpperCase()

/** 한 문항의 달성 비율(0~1). 'skip' = 점수에 넣지 않음(무응답 선택 문항·점수 없는 문항), 'ungraded' = 서술형 미채점 */
export function questionRatio(t: Template, q: Question, r: Response, manual?: Record<string, number>): number | 'skip' | 'ungraded' {
  if (q.purpose !== 'score') return 'skip'
  if (isManualScore(q)) {
    const v = manual?.[q.id]
    return typeof v === 'number' ? Math.max(0, Math.min(1, v / q.points!)) : 'ungraded'
  }
  if (!isChoice(q.type)) return 'skip'
  const picked = q.options.find((o) => o.id === r.answers[q.id])
  if (q.type === 'grade' && q.options.every((o) => o.value === null)) {
    const scale = gradeScaleOf(t)
    const max = Math.max(...Object.values(scale))
    if (!picked || !(letterOf(picked.label) in scale) || !(max > 0)) return 'skip'
    return scale[letterOf(picked.label)] / max
  }
  const values = q.options.map((o) => o.value).filter((v): v is number => v !== null)
  const max = values.length ? Math.max(...values) : 0
  if (!picked || picked.value === null || !(max > 0)) return 'skip'
  return picked.value / max
}

export interface PointsScore { score: number | null; ungraded: string[] }

/** 배점 방식 단계 점수(0~100). 적용되는 점수 문항이 없는 영역은 제외, 미채점 서술형이 있으면 점수 없음 */
export function pointsStageScore(t: Template, r: Response, ctx: QCtx, manual?: Record<string, number>): PointsScore {
  const ungraded: string[] = []
  let got = 0, tot = 0
  for (const sec of t.sections) {
    const sp = sec.points
    if (typeof sp !== 'number' || !(sp > 0)) continue
    let wsum = 0, acc = 0, any = false
    for (const q of sec.questions) {
      if (!applies(q, ctx)) continue
      const ratio = questionRatio(t, q, r, manual)
      if (ratio === 'skip') continue
      if (ratio === 'ungraded') { ungraded.push(q.id); any = true; continue }
      const w = typeof q.points === 'number' && q.points > 0 ? q.points : 1
      acc += ratio * w; wsum += w; any = true
    }
    if (!any) continue
    tot += sp
    if (wsum > 0) got += (acc / wsum) * sp
  }
  if (ungraded.length) return { score: null, ungraded }
  return { score: tot > 0 ? (got / tot) * 100 : null, ungraded }
}

/** 평가표 배점 검증 — 짧은 오류 문구 */
export function pointsErrors(t: Template): string[] {
  if (!usesPoints(t)) return []
  const e: string[] = []
  const secs = t.sections.filter((s) => typeof s.points === 'number')
  if (secs.some((s) => !(s.points! >= 0) || !Number.isFinite(s.points!))) e.push('영역 배점은 0 이상 숫자로 입력하세요.')
  const sum = secs.reduce((a, s) => a + (s.points ?? 0), 0)
  if (Math.abs(sum - 100) > 0.001) e.push(`영역 배점 합계 ${+sum.toFixed(2)}점 — 100점이 되어야 합니다.`)
  for (const s of t.sections) for (const q of s.questions) {
    if (!q.active) continue
    if (q.points !== undefined && q.points !== null && !(q.points >= 0)) e.push(`'${q.title}' 문항 배점은 0 이상이어야 합니다.`)
    if (!isChoice(q.type) && q.purpose === 'score' && !(typeof q.points === 'number' && q.points > 0)) e.push(`'${q.title}' 주관식 점수 문항에는 배점을 입력하세요.`)
  }
  const g = gradeScaleOf(t)
  if (Object.values(g).some((v) => !Number.isFinite(v) || v < 0)) e.push('등급 환산 점수는 0 이상 숫자로 입력하세요.')
  return e
}

/** 이 단계에서 채점이 필요한 서술형 문항(배점 방식 영역 안) */
export function manualQuestions(t: Template, ctx: QCtx): { sec: Section; q: Question }[] {
  return t.sections.filter((s) => typeof s.points === 'number' && s.points > 0).flatMap((sec) => sec.questions.filter((q) => isManualScore(q) && applies(q, ctx)).map((q) => ({ sec, q })))
}
