import { Link, Navigate, useParams } from 'react-router-dom'
import { useAppState } from '../../data/store'
import { can } from '../../domain/permissions'
import { cycleClosed, isUnlocked, statusOf } from '../../domain/progress'
import type { Cycle } from '../../domain/types'
import { secTitle, t as tr, tierText, useLang } from '../../i18n'
import { LangSelect } from '../employee/mobile'
import { QuestionView, requiredProgress, visibleSections } from '../../components/QuestionView'
import { useResponseEditor } from '../../components/useResponseEditor'
import { ctxFor } from '../../domain/questions'
import { Forbidden, Notice } from '../../components/ui'
import { targetPosition } from '../../domain/catalog'

export default function EvaluateForm() {
  const { aid } = useParams()
  const s = useAppState()
  const cycle = s.cycles.find((c) => c.assignments.some((a) => a.id === aid))
  const a = cycle?.assignments.find((x) => x.id === aid)
  const [lang] = useLang()
  if (!can(s.session.role, 'evaluate') || !a || a.evaluatorId !== s.session.personaId || a.excluded) return <Forbidden lang={lang} reason={tr('ev.onlyMine', lang)} />
  if (a.direction === 'self') return <Navigate to={`/eval/self/${a.id}`} replace />
  // 이미 제출한 평가는 앞 단계가 나중에 추가됐어도(D-079) 제출 내용 확인 가능
  // 마감 회차는 잠금과 관계없이 읽기 전용으로(새 작성·제출 없음)
  if (!cycleClosed(cycle) && !isUnlocked(cycle!, s.responses, a) && statusOf(s.responses, a.id) !== 'submitted') return <Forbidden lang={lang} reason={tr('ev.locked', lang)} />
  return <Form cycle={cycle!} aid={a.id} />
}

function Form({ cycle, aid }: { cycle: Cycle; aid: string }) {
  const s = useAppState()
  const a = cycle.assignments.find((x) => x.id === aid)!
  const t = cycle.targets.find((x) => x.employeeId === a.targetId)!
  const tpl = cycle.templates[a.templateId]
  const [lang, setLang] = useLang()
  const ed = useResponseEditor(aid, lang)
  const qctx = ctxFor(cycle, a)
  const prog = requiredProgress(tpl, qctx, ed.answers)
  const rule = ctxFor(cycle, a).rule // 임원 화면에는 단계 번호 대신 평가 유형만 (D-062)
  // 평가자 화면(팀장 D-079·임원 D-083)에는 대상자 자기평가·등급 배정 참고 패널을 만들지 않는다 — 대상자 자기평가 응답을 조회하지 않음.
  // 선행 단계는 제출 여부(isUnlocked)로만 막는다
  let n = 0
  // 적용 평가표의 표시 문항이 0개면 빈 평가를 제출하지 않게 막는다 (D-082)
  const ro = ed.submitted || ed.closed // 제출됨 또는 마감 회차 = 읽기 전용
  if (!ro && visibleSections(tpl, qctx).every((x) => x.questions.length === 0)) return <Forbidden lang={lang} reason={tr('ev.noQuestions', lang)} />

  return (
    <div className="page" style={{ maxWidth: 860 }}>
      <div className="row ev-top"><Link to="/eval">{tr('form.backMy', lang)}</Link><span className="spacer" /><LangSelect lang={lang} onChange={setLang} /></div>
      {/* 이름·팀 이름은 번역하지 않음. 직급·평가 유형만 선택 언어로 */}
      <h1 style={{ marginTop: 10 }}>{tr('ev.title', lang, { name: t.name })} <span className="muted" style={{ fontSize: 17 }}>{t.teamName} · {tierText(targetPosition(s, cycle, t), lang)} · {s.session.role === 'exec' ? tr(`rule.${rule ?? 'executive'}`, lang) : `${tr('stage.n', lang, { n: a.stageOrder })} · ${tr(`rule.${rule ?? 'teamLead'}`, lang)}`}</span></h1>
      <div>
        <div className="card" style={{ fontSize: 18 }}>
          {ed.closed && <p className="ev-closed"><span className="chip locked">{tr('status.closed', lang)}</span> {tr('ev.closed', lang)}</p>}
          {ed.submitted && <Notice kind="info" title={tr('ev.submittedTitle', lang)}>{tr('ev.submittedBody', lang)}</Notice>}
          {visibleSections(tpl, qctx).map((sec) => (
            <div key={sec.id}>
              <h2>{secTitle(sec, lang)}</h2>
              {sec.questions.map((q) => <QuestionView key={q.id} q={q} lang={lang} idx={++n} value={ed.answers[q.id] ?? null} disabled={ro} onChange={(v) => ed.setAnswer(q.id, v)} />)}
            </div>
          ))}
          {!ro && (
            <div className="row">
              <button className="btn" onClick={() => ed.saveDraft()}>{ed.saveState === 'saving' ? tr('form.saving', lang) : tr('ev.saveVirtual', lang)}</button>
              <button className="btn primary" disabled={prog.missing.length > 0 || ed.saveState === 'saving'} onClick={() => { if (confirm(tr('ev.confirm', lang))) ed.submit() }}>{tr('ev.submitVirtual', lang)}</button>
              <span className="muted">{tr('ev.req', lang, { d: prog.done, t: prog.total })}</span>
              {ed.saveState === 'saved' && <span className="chip submitted">{tr('ev.saved', lang)}</span>}
              {ed.saveState === 'error' && <span className="chip danger">{tr('ev.saveFail', lang)}</span>}
              {ed.saveState === 'dirty' && <span className="chip draft">{tr('ev.dirty', lang)}</span>}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
