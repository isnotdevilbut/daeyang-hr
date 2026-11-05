import { useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { useAppState } from '../../data/store'
import { secTitle, t, useLang } from '../../i18n'
import type { Cycle } from '../../domain/types'
import { QuestionView, requiredProgress, visibleSections } from '../../components/QuestionView'
import { ResponsePager } from '../../components/ResponsePager'
import { Forbidden } from '../../components/ui'
import { useResponseEditor } from '../../components/useResponseEditor'
import { ctxFor } from '../../domain/questions'
import { MobileHead } from './mobile'

/** 자기평가 응답 화면 (로그인한 본인 전용). 직원 응답 화면 언어는 한국어·러시아어 중 선택 */
export default function SelfForm() {
  const { aid = '' } = useParams()
  const s = useAppState()
  const cycle = s.cycles.find((c) => c.assignments.some((a) => a.id === aid))
  const a = cycle?.assignments.find((x) => x.id === aid)
  // 로그인한 본인에게 배정된 자기평가만 열 수 있다
  if (!cycle || !a || a.evaluatorId !== s.session.personaId || a.direction !== 'self' || a.excluded) return <Navigate to="/eval" replace />
  return <Flow cycle={cycle} aid={aid} />
}

function Flow({ cycle, aid }: { cycle: Cycle; aid: string }) {
  // 언어는 같은 브라우저에 기억(다음 접속에도). 바꿔도 화면 위치·입력한 답·임시저장 상태는 그대로 (D-075)
  const [lang, changeLang] = useLang()
  const a = cycle.assignments.find((x) => x.id === aid)!
  const tpl = cycle.templates[a.templateId]
  const qctx = ctxFor(cycle, a)
  const sections = visibleSections(tpl, qctx)
  const ed = useResponseEditor(aid, lang)
  const [viewSubmitted, setViewSubmitted] = useState(false)
  const prog = requiredProgress(tpl, qctx, ed.answers)

  // D-222: 나가기 경고 대신 자동 저장(입력이 멈추면·화면을 나갈 때) — useResponseEditor
  const save = async () => { await ed.saveDraft() }
  const submit = async () => {
    if (prog.missing.length) return
    if (!confirm(t('form.confirmSubmit', lang))) return
    await ed.submit() // 성공하면 ed.submitted → 완료 화면
  }

  const title = t('form.selfTitle', lang)

  if (ed.submitted && !viewSubmitted && !ed.closed)
    return (
      <div className="m-wrap">
        <MobileHead title={title} />
        <div className="m-body">
          <h1>✔ {t('done.title', lang)}</h1>
          <p>{t('done.body', lang)}</p>
          <p className="muted">{t('done.at', lang)}: {ed.existing?.submittedAt ? new Date(ed.existing.submittedAt).toLocaleString(lang === 'ru' ? 'ru-RU' : 'ko-KR') : ''}</p>
          <button className="m-btn" onClick={() => setViewSubmitted(true)}>{t('done.view', lang)}</button>
          <Link className="m-btn primary" style={{ display: 'grid', placeItems: 'center', textDecoration: 'none', marginTop: 10 }} to="/eval">{t('done.toList', lang)}</Link>
        </div>
      </div>
    )

  // 제출 내용 보기 또는 마감 회차(D-093): 읽기 전용 — 저장된 답(임시저장 포함)만 보여 주고 저장·제출 없음
  if (ed.submitted || ed.closed)
    return (
      <div className="m-wrap">
        <MobileHead title={`${title} · ${ed.submitted ? t('form.submittedSuffix', lang) : t('status.closed', lang)}`} />
        <div className="m-body">
          {ed.closed && <p className="ev-closed"><span className="chip locked">{t('status.closed', lang)}</span> {t('ev.closed', lang)}</p>}
          {sections.map((sec) => (
            <div key={sec.id}><h2>{secTitle(sec, lang)}</h2>{sec.questions.map((q) => <QuestionView key={q.id} q={q} lang={lang} value={ed.answers[q.id] ?? null} onChange={() => {}} disabled />)}</div>
          ))}
          <Link className="m-btn" style={{ display: 'grid', placeItems: 'center', textDecoration: 'none' }} to="/eval">{t('done.list', lang)}</Link>
        </div>
      </div>
    )

  const saveMsg = {
    idle: '',
    dirty: t('form.dirty', lang),
    saving: t('form.saving', lang),
    saved: `✔ ${t('form.saved', lang)} (${t('form.savedNote', lang)})`,
    error: `✕ ${t('form.saveFail', lang)}`,
  }[ed.saveState]

  // 적용 평가표의 표시 문항이 0개면 빈 평가를 제출하지 않게 막는다 (D-082 — 관리자 설정에서 확인)
  if (!ed.submitted && sections.every((x) => x.questions.length === 0)) return <Forbidden lang={lang} reason={t('ev.noQuestions', lang)} />
  return (
    <ResponsePager
      title={title}
      sections={sections}
      answers={ed.answers}
      setAnswer={ed.setAnswer}
      lang={lang}
      onLang={changeLang}
      topLeft={<Link to="/eval">{t('form.backList', lang)}</Link>}
      status={<p className="save-state" style={{ color: ed.saveState === 'error' ? 'var(--danger)' : ed.saveState === 'saved' ? 'var(--ok)' : 'var(--warn)' }}>{saveMsg}</p>}
      busy={ed.saveState === 'saving'}
      onSave={save}
      beforeNext={async () => { if (ed.saveState === 'dirty') await ed.saveDraft() }}
      onSubmit={submit}
      passedKey={`daeyang-hr-passed-${aid}`}
    />
  )
}
