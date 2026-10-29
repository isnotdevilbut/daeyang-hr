import type { AnswerValue, Direction, Lang, Question, Template } from '../domain/types'
import { optLabel, qHelp, qTitle, t } from '../i18n'
import { applies, type QCtx } from '../domain/questions'

/**
 * 한 문항 입력. 직원 모바일·평가자·편집기 미리보기에서 공통 사용. 점수 값은 화면에 노출하지 않는다.
 * lang: 저장된 번역을 보여 줄 언어(없는 번역은 한국어 원문). 답은 선택지 ID·입력 원문 그대로 — 언어와 무관 (D-075)
 */
export function QuestionView({ q, value, onChange, disabled, idx, lang = 'ko' }: {
  q: Question
  value: AnswerValue
  onChange: (v: AnswerValue) => void
  disabled?: boolean
  idx?: number
  lang?: Lang
}) {
  const help = qHelp(q, lang)
  const hid = `qh-${q.id}`
  return (
    <div className="m-q">
      <div className="qt" id={`qt-${q.id}`}>
        {idx !== undefined && `${idx}. `}{qTitle(q, lang)}
        {q.required && <span className="req">* {t('form.required', lang)}</span>}
      </div>
      {help && <div className="qh" id={hid}>{help}</div>}
      {q.options.length > 0 ? (
        <div role="radiogroup" aria-labelledby={`qt-${q.id}`}>
          {q.options.map((o) => (
            <button
              key={o.id}
              type="button"
              role="radio"
              aria-checked={value === o.id}
              className={`m-opt ${value === o.id ? 'on' : ''}`}
              disabled={disabled}
              onClick={() => onChange(value === o.id ? null : o.id)}
            >
              <span className="dot" aria-hidden /> <span className="opt-text">{optLabel(q, o, lang)}</span>
            </button>
          ))}
        </div>
      ) : q.type === 'short' ? (
        <input type="text" aria-labelledby={`qt-${q.id}`} value={value ?? ''} disabled={disabled} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <textarea aria-labelledby={`qt-${q.id}`} value={value ?? ''} disabled={disabled} onChange={(e) => onChange(e.target.value)} />
      )}
    </div>
  )
}

/** 응답 상황(평가 방향·평가 유형·직무·대상)에 맞는 문항만 남긴 섹션 */
export function visibleSections(t: Template, ctxOrDir: QCtx | Direction) {
  const ctx: QCtx = typeof ctxOrDir === 'string' ? { direction: ctxOrDir } : ctxOrDir
  return t.sections
    .map((s) => ({ ...s, questions: s.questions.filter((q) => applies(q, ctx)) }))
    .filter((s) => s.questions.length > 0)
}

export function isAnswered(v: AnswerValue | undefined) {
  return v !== null && v !== undefined && String(v).trim() !== ''
}

/**
 * 응답 화면(영역)별 작성 상태. 필수 문항이 있는 화면은 그 필수 문항에 모두 답했을 때만 완료
 * (방문·이동만으로는 완료 아님, 답을 지우면 다시 미완료). 필수 문항이 없는 화면은 "다음"으로 넘어간 적이 있으면 완료.
 */
export function screenDone(sections: ReturnType<typeof visibleSections>, answers: Record<string, AnswerValue>, passed: ReadonlySet<string>): boolean[] {
  return sections.map((s) => {
    const req = s.questions.filter((q) => q.required)
    return req.length > 0 ? req.every((q) => isAnswered(answers[q.id])) : passed.has(s.id)
  })
}

export function requiredProgress(t: Template, ctx: QCtx | Direction, answers: Record<string, AnswerValue>) {
  const req = visibleSections(t, ctx).flatMap((s) => s.questions.filter((q) => q.required))
  const done = req.filter((q) => isAnswered(answers[q.id]))
  return { done: done.length, total: req.length, missing: req.filter((q) => !isAnswered(answers[q.id])) }
}
