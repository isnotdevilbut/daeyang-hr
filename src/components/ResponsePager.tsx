// 직원 응답 화면의 페이지 흐름 (D-061): 영역 = 한 화면, 이전·다음, 칸 진행 표시, 필수 응답 수, 제출 전 확인, 하단 버튼.
// 실제 자기평가 화면과 평가 관리의 문항 미리보기가 같은 컴포넌트를 쓴다. 저장·제출은 부모가 넘긴 함수로만 한다.
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { optLabel, qTitle, secTitle, t } from '../i18n'
import type { AnswerValue, Lang } from '../domain/types'
import { QuestionView, isAnswered, screenDone, visibleSections } from './QuestionView'
import { LangSelect, MobileHead } from '../pages/employee/mobile'

type Sections = ReturnType<typeof visibleSections>

export interface PagerProps {
  title: string
  sections: Sections
  answers: Record<string, AnswerValue>
  setAnswer: (qid: string, v: AnswerValue) => void
  lang: Lang
  onLang: (l: Lang) => void
  /** 맨 위 왼쪽 (실제: 목록으로 링크 / 미리보기: 표시) */
  topLeft: ReactNode
  /** 진행 표시 아래 상태 줄 (저장 상태 등) */
  status?: ReactNode
  busy?: boolean // 저장 중: 이동·저장·제출 버튼 잠금
  /** 없으면 임시저장 버튼을 숨김(미리보기, D-261) */
  onSave?: () => void
  /** "다음" 직전 (실제: 바뀐 내용 임시저장) */
  beforeNext?: () => Promise<void>
  /** 최종 제출. true면 부모가 완료 화면으로 바꾼다 */
  onSubmit: () => void
  /** 필수 문항 없는 화면을 넘긴 기록을 이 키로 탭 세션에 보관 (없으면 메모리만) */
  passedKey?: string
  /** 이 요소 안에서 스크롤 (없으면 창 전체). 미리보기 틀 안에서 화면을 바꿀 때 맨 위로 */
  scrollRef?: React.RefObject<HTMLElement>
  /** 하단 버튼을 화면 바닥이 아니라 감싼 틀 바닥에 붙임 (미리보기) */
  contained?: boolean
  children?: ReactNode
}

export function ResponsePager(p: PagerProps) {
  const { sections, answers, lang } = p
  const [step, setStep] = useState(0) // 0..n-1 화면, n = 제출 전 확인
  const reviewStep = sections.length
  const req = sections.flatMap((s) => s.questions.filter((q) => q.required))
  const missing = req.filter((q) => !isAnswered(answers[q.id]))
  const prog = { done: req.length - missing.length, total: req.length, missing }
  const [passed, setPassed] = useState<Set<string>>(() => {
    if (!p.passedKey) return new Set()
    try { return new Set(JSON.parse(sessionStorage.getItem(p.passedKey) ?? '[]')) } catch { return new Set() }
  })
  const markPassed = (id: string) => {
    if (passed.has(id)) return
    const nx = new Set(passed).add(id)
    setPassed(nx)
    if (p.passedKey) try { sessionStorage.setItem(p.passedKey, JSON.stringify([...nx])) } catch { /* 무시 */ }
  }
  const done = screenDone(sections, answers, passed)
  const first = useRef(true)
  useEffect(() => {
    if (first.current && p.scrollRef) { first.current = false; return } // 미리보기는 처음 열 때 틀만 맨 위
    first.current = false
    if (p.scrollRef?.current) p.scrollRef.current.scrollTop = 0
    else window.scrollTo(0, 0)
  }, [step]) // eslint-disable-line react-hooks/exhaustive-deps

  const next = async () => {
    if (p.beforeNext) await p.beforeNext()
    if (step < reviewStep) markPassed(sections[step].id)
    setStep(step + 1)
  }
  const submit = () => { if (!prog.missing.length) p.onSubmit() }

  return (
    <div className={`m-wrap ${p.contained ? 'contained' : ''}`}>
      <MobileHead title={p.title} />
      <div className="m-body">
        <div className="row m-top">{p.topLeft}<span className="spacer" /><LangSelect lang={lang} onChange={p.onLang} /></div>
        <div aria-live="polite">
          <div className="row" style={{ justifyContent: 'space-between', fontWeight: 800 }}>
            <span>{step < reviewStep ? t('form.screen', lang, { i: step + 1, n: sections.length }) : t('form.review', lang)}</span>
            <span className="req-count">{t('form.reqDone', lang, { d: prog.done, t: prog.total })}</span>
          </div>
          {/* 화면 수만큼 나눈 칸: 작성 완료 = 채움, 현재 화면 = 테두리, 미작성 = 옅은 회색 (위치·상태 표시용, 클릭 이동 없음) */}
          <ol className="seg-progress" aria-label={t('form.segLabel', lang)}>
            {sections.map((sec, i) => (
              <li key={sec.id} className={`${done[i] ? 'done' : ''} ${i === step ? 'current' : ''}`}>
                <span className="sr-only">{t('form.screen', lang, { i: i + 1, n: sections.length })} {secTitle(sec, lang)}: {done[i] ? t('form.segDone', lang) : t('form.segTodo', lang)}{i === step ? `, ${t('form.segCurrent', lang)}` : ''}</span>
              </li>
            ))}
          </ol>
          {p.status}
        </div>

        {step < reviewStep && (
          <>
            <h1 style={{ marginTop: 14 }}>{secTitle(sections[step], lang)}</h1>
            {sections[step].questions.map((q) => (
              <QuestionView key={q.id} q={q} lang={lang} value={answers[q.id] ?? null} onChange={(v) => p.setAnswer(q.id, v)} />
            ))}
          </>
        )}

        {step === reviewStep && (
          <>
            <h1 style={{ marginTop: 14 }}>{t('form.review', lang)}</h1>
            {prog.missing.length > 0 ? (
              <div className="notice danger" role="alert">
                <b>{t('form.missing', lang)} ({t('form.missingCount', lang, { n: prog.missing.length })})</b>
                {prog.missing.map((q) => {
                  const si = sections.findIndex((x) => x.questions.some((y) => y.id === q.id))
                  return <div key={q.id} className="missing-row">· {qTitle(q, lang)} <button className="btn small" onClick={() => setStep(si)}>{t('form.goAnswer', lang)}</button></div>
                })}
              </div>
            ) : <div className="notice info"><b>{t('form.allAnswered', lang)}</b>{t('form.noEdit', lang)}</div>}
            {sections.map((sec, si) => (
              <div key={sec.id} className="card">
                <div className="row"><b>{secTitle(sec, lang)}</b><span className="spacer" /><button className="btn small" onClick={() => setStep(si)}>{t('form.fix', lang)}</button></div>
                {sec.questions.map((q) => {
                  const v = answers[q.id]
                  const o = q.options.find((x) => x.id === v)
                  const label = o ? optLabel(q, o, lang) : v // 서술형 답은 입력한 원문 그대로
                  return <div key={q.id} className="review-q"><span className="muted">{qTitle(q, lang)}</span><br /><b>{label || t('form.empty', lang)}</b></div>
                })}
              </div>
            ))}
            <button className="m-btn primary" disabled={prog.missing.length > 0 || p.busy} onClick={submit}>
              {p.busy ? t('form.saving', lang) : t('form.submit', lang)}
            </button>
          </>
        )}
        {p.children}
      </div>

      <div className="m-foot">
        <div className={`m-foot-inner ${p.onSave ? '' : 'two'}`}>
          <button className="m-btn" disabled={step === 0} onClick={() => setStep(step - 1)}>{t('form.prev', lang)}</button>
          {p.onSave && <button className="m-btn" disabled={p.busy} onClick={p.onSave}>{t('form.save', lang)}</button>}
          {step < reviewStep
            ? <button className="m-btn primary" disabled={p.busy} onClick={next}>{step === reviewStep - 1 ? t('form.review', lang) : t('form.next', lang)}</button>
            : <button className="m-btn primary" disabled={prog.missing.length > 0 || p.busy} onClick={submit}>{t('form.submit', lang)}</button>}
        </div>
      </div>
    </div>
  )
}
