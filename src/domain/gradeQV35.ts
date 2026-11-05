// v34 → v35 (D-223): 임원평가에서 '종합 등급' 문항 빼기(사용자 요청) — 팀장평가에는 그대로.
// 준비·진행 회차 평가표의 '종합 등급'(등급 선택형) 문항 중 임원평가에 보이는 것의 적용 평가에서 임원평가만 뺀다.
// 영역 배점은 영역에 걸려 있어 합계(100)는 그대로 — 그 영역의 다른 문항으로 점수를 매김. 써 둔 응답은 지우지 않음(임원평가 화면·점수에서만 빠짐). 반복 안전
import type { AppState, Question } from './types'
import { directionsFromRules, rulesOf } from './questions'

const isGradeQ = (q: Question) => q.type === 'grade' && /종합\s*등급/.test(q.title)

export function gradeQNoExecV35(s: AppState): string[] {
  const notes: string[] = []
  for (const c of s.cycles) {
    if (c.status !== '준비' && c.status !== '진행') continue
    let n = 0
    for (const t of Object.values(c.templates)) for (const sec of t.sections) for (const q of sec.questions) {
      if (!isGradeQ(q)) continue
      const rules = rulesOf(q)
      if (!rules.includes('executive')) continue
      q.rules = rules.filter((r) => r !== 'executive')
      q.directions = directionsFromRules(q.rules)
      n++
    }
    if (n) notes.push(`${c.name}: 임원평가에서 '종합 등급' 문항 ${n}개 뺌(팀장평가에는 그대로)`)
  }
  return notes
}
