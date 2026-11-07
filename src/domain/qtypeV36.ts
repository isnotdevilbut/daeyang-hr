// v35 → v36 (D-230): 문항 종류 '짧은 주관식'(short)과 '긴 서술형'(long)을 '주관식' 하나(long — 여러 줄 입력)로.
// 평가표 목록·준비·진행 회차 평가표의 short 문항을 long으로 바꾼다(문항 ID·답 그대로 — 글은 그대로 읽힘). 마감·확정 회차는 그대로(화면에는 같은 '주관식'으로 보임). 반복 안전
import type { AppState, Template } from './types'

export function unifyTextV36(s: AppState): string[] {
  let n = 0
  const fix = (t: Template) => { for (const sec of t.sections) for (const q of sec.questions) if (q.type === 'short') { q.type = 'long'; n++ } }
  for (const t of s.templates ?? []) if (!t.locked) fix(t)
  for (const c of s.cycles) if (c.status === '준비' || c.status === '진행') Object.values(c.templates).forEach(fix)
  return n ? [`문항 종류 '짧은 주관식' ${n}개 → '주관식'(긴 서술형과 하나로)`] : []
}
