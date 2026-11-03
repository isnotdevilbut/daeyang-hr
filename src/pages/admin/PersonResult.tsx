import { useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { update, useAppState } from '../../data/store'
import { useSelectedCycle } from '../../data/hooks'
import { can, canFinalAdjust } from '../../domain/permissions'
import { cycleLabel } from '../../domain/cycle'
import { fmt, fmtSigned, personResult, weightsFor } from '../../domain/scoring'
import { activeWriteAssignments, appliedStages, assignmentCell, isActiveAssignment, stageAssignments, statusOf, type CellStatus } from '../../domain/progress'
import { displayAnswer } from '../../domain/seed'
import { type AdjustKind, type Assignment, type Cycle, type Lang, type Response, type Template } from '../../domain/types'
import { optLabel, qTitle, t as tr } from '../../i18n'
import { Forbidden } from '../../components/ui'
import { addAdjustment } from './Results'
import { applies, ctxFor, RULE_TEXT, type QCtx } from '../../domain/questions'
import { manualQuestions } from '../../domain/points'
import { jobName, positionName, targetPosition } from '../../domain/catalog'

export function answerText(t: Template, qid: string, v: string | null | undefined) {
  if (v === null || v === undefined || v === '') return '—'
  for (const s of t.sections) for (const q of s.questions) if (q.id === qid) return q.options.find((o) => o.id === v)?.label ?? displayAnswer(v)
  return displayAnswer(v)
}

/** 문항별 질문·응답. 원문은 바꾸지 않고, 시드가 붙인 "(가상 응답)" 꼬리말만 표시에서 뗀다 */
/** lang: 평가 참여자 화면(임원이 보는 대상자 자기평가 참고, 팀장 화면에는 없음 — D-079)에서는 그 언어의 저장된 번역으로. 관리자 화면은 한국어. 답한 서술 원문은 그대로 */
export function AnswerList({ t, r, a, cycle, lang = 'ko' }: { t: Template; r: Response | undefined; a: Assignment; cycle?: Cycle; lang?: Lang }) {
  const ctx: QCtx = cycle ? ctxFor(cycle, a) : { direction: a.direction }
  if (!r) return <p className="muted">{tr('ev.noAnswer', lang)}</p>
  const qs = t.sections.flatMap((s) => s.questions.filter((q) => applies(q, ctx)))
  return (
    <dl className="qa-list">
      {qs.map((q) => {
        const v = r.answers[q.id]
        const empty = v === null || v === undefined || String(v).trim() === ''
        return (
          <div className="qa" key={q.id}>
            <dt>{qTitle(q, lang)}</dt>
            <dd className={empty ? 'none' : ''}>{empty ? tr('ev.unanswered', lang) : (() => { const o = q.options.find((x) => x.id === v); return o ? optLabel(q, o, lang) : answerText(t, q.id, v) })()}</dd>
          </div>
        )
      })}
    </dl>
  )
}

const BACK = {
  progress: { to: '/admin/progress', label: '진행 현황으로 돌아가기' },
  results: { to: '/admin/results', label: '결과 목록으로 돌아가기' },
}

export default function PersonResultPage() {
  const { targetId } = useParams()
  const [params] = useSearchParams()
  const s = useAppState()
  const [cycle] = useSelectedCycle()
  const role = s.session.role
  // 진입 경로: 주소의 ?from= 값(새로고침해도 유지). 직접 주소로 들어오면 진행 현황
  const from = params.get('from') === 'results' ? 'results' : 'progress'
  const back = BACK[from]
  if (!can(role, 'viewResults')) return <Forbidden />
  const t = cycle?.targets.find((x) => x.employeeId === targetId)
  // 받는 평가가 없는 평가자 전용 참여자(자기평가를 끈 임원 등, D-069): 작성할 평가만 보여 준다 (점수·리포트 없음)
  const writer = cycle && !t ? s.employees.find((e) => e.id === targetId && e.active && cycle.assignments.some((a) => a.evaluatorId === e.id && isActiveAssignment(a))) : undefined
  if (cycle && writer) {
    const team = s.teams.find((x) => x.id === writer.teamId)?.name ?? ''
    return (
      <div className="page detail-page">
        <div className="detail-top no-print"><Link to={back.to} className="back-link">← {back.label}</Link></div>
        <header className="person-head">
          <h1>{writer.name}</h1>
          <div className="person-meta"><span>{team}</span><span>{positionName(s, writer)}</span><span>{jobName(s, writer.jobType)}</span><span className="cycle-name">{cycleLabel(cycle)}</span></div>
        </header>
        <div className="detail-divider" aria-hidden />
        {/* 자기평가를 끈 임원 등 받는 평가가 없는 평가자: 담당 평가 현황만 (D-089) */}
        <WriteList cycle={cycle} evaluatorId={writer.id} />
      </div>
    )
  }
  if (!cycle || !t) return <div className="page"><Link to={back.to}>← {back.label}</Link><p>대상자를 찾을 수 없습니다.</p></div>
  const r = personResult(s, cycle, t.employeeId)!
  const staged = cycle.assignments.filter((a) => a.targetId === t.employeeId).sort((a, b) => a.stageOrder - b.stageOrder)
  const name = (id: string) => s.employees.find((e) => e.id === id)?.name ?? '?'
  const history = s.adjustments.filter((a) => a.cycleId === cycle.id && (a.targetKey === t.employeeId || a.targetKey === t.departmentId || (!!t.legacyUnitId && a.targetKey === t.legacyUnitId)))
  const weights = weightsFor(cycle, t)
  const anyUnsubmitted = r.stages.some((x) => !x.submitted)
  const anyUngraded = r.stages.some((x) => x.ungraded) // 배점 있는 서술형 미채점(D-103) — 0점이 아닌 미완료
  const baseText = r.combined.base !== null ? fmt(r.combined.base) : anyUnsubmitted || anyUngraded ? '미완료' : '계산 안 됨'
  const baseHint = r.combined.base !== null ? '' : anyUnsubmitted ? '제출 전 단계 있음' : anyUngraded ? '서술형 채점 필요' : '반영 비율 확인 필요'

  return (
    <div className="page detail-page">
      <div className="detail-top no-print">
        <Link to={back.to} className="back-link">← {back.label}</Link>
        {can(role, 'reportPreview') && <Link className="btn primary" to={`/admin/report/${t.employeeId}?from=${from}`}>개인 리포트 미리보기</Link>}
      </div>
      <header className="person-head">
        <h1>{t.name}{t.isTeamLead && <span className="chip info tag">팀장</span>}</h1>
        <div className="person-meta">
          <span>{t.teamName}</span>{t.departmentName && t.departmentName !== t.teamName && <span>{t.departmentName}</span>}<span>{targetPosition(s, cycle, t)}</span><span>{jobName(s, t.jobType)}</span>
          <span className="cycle-name">{cycleLabel(cycle)}</span>
        </div>
      </header>
      {/* 기본 정보와 아래 평가 정보 구분 (D-084) — 상세 화면 안에만 */}
      <div className="detail-divider" aria-hidden />


      {/* 이 직원이 다른 사람에게 평가받는 내용 — 위의 작성할 업무(미완료 평가)와 따로 (D-071) */}
      <h2 className="section-title">평가 현황</h2>
      <RecvList cycle={cycle} targetId={t.employeeId} />
      {/* 자기평가를 켠 임원: 본인 자기평가(위 평가 현황)와 담당 대상자 평가를 따로 (D-089) */}
      {(() => { const e = s.employees.find((x) => x.id === t.employeeId); return e && (e.isExecutive || e.isCeo) ? <WriteList cycle={cycle} evaluatorId={t.employeeId} /> : null })()}
      {/* 제목은 상자 밖, 내용은 상자 안 — 평가 현황과 같은 구조 (D-087) */}
      <div className="detail-grid">
        <div className="detail-col">
        <h2 id="score-title" className="section-title">점수 요약</h2>
        <section className="panel pad" aria-labelledby="score-title">
          <table className="tbl score-stages">
            <thead><tr><th>단계</th><th>평가</th><th className="num">원점수</th><th className="num">반영 비율</th></tr></thead>
            <tbody>
              {r.stages.map((st) => {
                const w = weights[st.order]
                return (
                  <tr key={st.order}>
                    <td><b>{st.order}단계</b></td>
                    <td>{st.label}</td>
                    <td className="num">{st.submitted ? (st.score === null ? '—' : fmt(st.score)) : <span className="chip stage todo">미제출</span>}</td>
                    <td className="num">{typeof w === 'number' ? `${w}%` : '미입력'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <dl className="score-sum">
            <div><dt>개인평가 기초 점수</dt><dd>{baseText}{baseHint && <small>{baseHint}</small>}</dd></div>
            <div><dt>팀 KPI 점수</dt><dd>{r.kpi === null ? '—' : fmt(r.kpi)}{r.kpi !== null && <span className="chip na tag">{r.kpiBlend.enabled && (r.kpiBlend.kpi ?? 0) > 0 ? `반영 ${r.kpiBlend.kpi}%` : '미반영'}</span>}</dd></div>
            {r.kpiBlend.enabled && <div><dt>KPI 반영 후 점수</dt><dd>{r.combined.kpiApplied && r.combined.afterKpi !== null ? fmt(r.combined.afterKpi) : '—'}</dd></div>}
            <div><dt>팀 보정</dt><dd>{fmtSigned(r.dept)}</dd></div>
            <div><dt>개인 보정</dt><dd>{fmtSigned(r.person)}</dd></div>
            <div><dt>보정 후 점수</dt><dd>{r.combined.afterAdjust === null ? '—' : fmt(r.combined.afterAdjust)}</dd></div>
            <div><dt>최종 지정 점수</dt><dd>{r.ceoScore === null ? '—' : fmt(r.ceoScore)}</dd></div>
            <div className="total"><dt>최종 점수</dt><dd>{r.combined.final === null ? '—' : fmt(r.combined.final)}</dd></div>
            {r.ceoGrade && <div className="total"><dt>최종 등급</dt><dd>{r.ceoGrade}</dd></div>}
          </dl>
        </section>
        </div>
        <Adjusters cycle={cycle} targetId={t.employeeId} current={r} />
      </div>

      <h2 className="section-title">단계별 응답</h2>
      {staged.map((a) => {
        const st = statusOf(s.responses, a.id)
        const stage = r.stages.find((x) => x.order === a.stageOrder)
        const rule = ctxFor(cycle, a).rule
        return (
          <section className="panel stage-card" key={a.id}>
            <div className="stage-head">
              <h3>{a.stageOrder}단계 · {rule ? RULE_TEXT[rule] : stage?.label}</h3>
              <span className="muted">작성자 <b>{name(a.evaluatorId)}</b></span>
              <span className="spacer" />
              {st === 'submitted' && stage && (stage.score !== null || stage.grade) && (
                <span className="stage-score">{stage.score !== null && <>점수 <b>{fmt(stage.score)}</b></>}{stage.grade && <> · 등급 <b>{stage.grade.slice(0, 1)}</b></>}</span>
              )}
              {st === 'submitted' && stage?.ungraded && <span className="chip draft">미채점</span>}
              <span className={`chip ${st === 'submitted' ? 'stage done' : 'stage todo'}`}>{st === 'submitted' ? '✓ 제출' : st === 'draft' ? '작성 중' : '미제출'}</span>
            </div>
            {st === 'submitted'
              ? <AnswerList t={cycle.templates[a.templateId]} r={s.responses[a.id]} a={a} cycle={cycle} />
              : <p className="muted stage-empty">아직 제출되지 않았습니다.</p>}
            {st === 'submitted' && <ManualScores cycle={cycle} aid={a.id} />}
          </section>
        )
      })}

      {history.length > 0 && (
        <details className="history">
          <summary>변경 내역 <span className="muted">{history.length}건</span></summary>
          <div className="table-wrap">
            <table className="tbl">
              <thead><tr><th>시각</th><th>변경자</th><th>항목</th><th>변경 전 → 후</th></tr></thead>
              <tbody>
                {[...history].reverse().map((h) => (
                  <tr key={h.id}>
                    <td>{h.at ? new Date(h.at).toLocaleString('ko-KR') : '—'}</td>
                    <td>{h.by || '—'}</td>
                    <td>{KIND_TEXT[h.kind]}{h.reason && <div className="muted">사유: {h.reason}</div>}</td>
                    <td>{show(h.before)} → {show(h.value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </div>
  )
}

/** 본인이 받는 평가(D-076): 평가 유형·담당 평가자·상태. 적용 단계에 배정이 없으면 "평가자 미지정"(배정 누락) */
const RECV_LABEL: Record<CellStatus, string> = { submitted: '제출', draft: '작성 중', notStarted: '미시작', locked: '선행 단계 대기', unassigned: '평가자 미지정', na: '해당 없음' }
function RecvList({ cycle, targetId }: { cycle: Cycle; targetId: string }) {
  const s = useAppState()
  const t = cycle.targets.find((x) => x.employeeId === targetId)
  if (!t) return null
  const name = (id: string) => s.employees.find((e) => e.id === id)?.name ?? '?'
  const rows = appliedStages(cycle, t).flatMap((st) => {
    const as = stageAssignments(cycle, targetId, st.order)
    return as.length === 0
      ? [{ key: `${st.order}-none`, stage: st, who: '—', status: 'unassigned' as CellStatus }]
      : as.map((a) => ({ key: a.id, stage: st, who: name(a.evaluatorId), status: assignmentCell(cycle, s.responses, a) }))
  })
  return (
    <section className="panel recv-panel" aria-label="받는 평가">
      <div className="table-wrap">
        <table className="tbl recv-tbl">
          <thead><tr><th>평가 유형</th><th>담당 평가자</th><th>상태</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <td>{RULE_TEXT[r.stage.rule]} <span className="muted">({r.stage.order}단계)</span></td>
                <td>{r.who}</td>
                <td><span className={`chip ${r.status === 'submitted' ? 'stage done' : r.status === 'unassigned' ? 'danger' : r.status}`}>{RECV_LABEL[r.status]}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}


/**
 * 담당 평가 현황(D-089): 이 평가자가 작성할 대상자 평가(자기평가 제외). 진행 현황 표의 작성 건수와 같은 배정(activeWriteAssignments)을 쓴다.
 * 완료 = 제출, 미완료 = 미시작·작성 중·선행 단계 대기 — 상태 칸은 완료/미완료만(세부 상태 문구 없음, D-111). 보기만(대신 작성·제출 없음)
 */
function WriteList({ cycle, evaluatorId }: { cycle: Cycle; evaluatorId: string }) {
  const s = useAppState()
  const [view, setView] = useState<'all' | 'open' | 'done'>('all')
  const rows = activeWriteAssignments(cycle, s.employees)
    .filter((a) => a.evaluatorId === evaluatorId && a.direction !== 'self')
    .map((a) => ({ a, t: cycle.targets.find((x) => x.employeeId === a.targetId)!, st: assignmentCell(cycle, s.responses, a) }))
    .filter((r) => !!r.t)
    // 미완료 먼저, 완료는 아래(D-093) — 같은 그룹 안에서는 팀·팀장 먼저·이름 순
    .sort((x, y) => Number(x.st === 'submitted') - Number(y.st === 'submitted') || x.t.teamName.localeCompare(y.t.teamName, 'ko') || Number(y.t.isTeamLead) - Number(x.t.isTeamLead) || x.t.name.localeCompare(y.t.name, 'ko'))
  const done = rows.filter((r) => r.st === 'submitted').length
  const shown = rows.filter((r) => view === 'all' || (view === 'done') === (r.st === 'submitted'))
  const tabs = [['all', '전체', rows.length], ['open', '미완료', rows.length - done], ['done', '완료', done]] as const
  return (
    <>
      <h2 id="write-title" className="section-title">담당 평가 현황</h2>
      <section className="panel recv-panel write-panel" aria-labelledby="write-title">
        {rows.length === 0 ? <p className="write-empty">배정된 평가 없음</p> : <>
          <div className="write-tabs" role="group" aria-label="담당 평가 보기">
            {tabs.map(([k, label, n]) => (
              <button key={k} type="button" className={`write-tab ${view === k ? 'on' : ''}`} aria-pressed={view === k} onClick={() => setView(k)}>{label} <b>{n}</b></button>
            ))}
          </div>
          <div className="table-wrap">
            <table className="tbl write-tbl">
              <thead><tr><th>팀</th><th>직급</th><th>평가 대상자</th><th>상태</th></tr></thead>
              <tbody>
                {shown.length === 0 ? <tr><td colSpan={4} className="empty-row">{view === 'done' ? '완료한 평가 없음' : '남은 평가 없음'}</td></tr> : shown.map((r) => (
                  <tr key={r.a.id}>
                    <td>{r.t.teamName}</td>
                    <td>{targetPosition(s, cycle, r.t)}</td>
                    <td><b>{r.t.name}</b></td>
                    <td>
                      <span className="write-st">
                        {/* 배지는 상태 열 중앙축(가운데 칸) — D-093 */}
                        <span className="ws-badge">{r.st === 'submitted' ? <span className="chip stage done">완료</span> : <span className="chip stage todo">미완료</span>}</span>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>}
      </section>
    </>
  )
}

/**
 * 서술형 점수 문항 채점(D-103): 배점이 있는 서술형만, 관리자가 0~배점 입력. 비우면 미채점(단계 점수 없음 — 0점 아님).
 * 응답 원문은 바꾸지 않고 따로 저장(manualScores). 확정 회차는 바꾸지 않음
 */
function ManualScores({ cycle, aid }: { cycle: Cycle; aid: string }) {
  const s = useAppState()
  const a = cycle.assignments.find((x) => x.id === aid)!
  const items = manualQuestions(cycle.templates[a.templateId], ctxFor(cycle, a))
  const cur = s.manualScores?.[aid] ?? {}
  const [d, setD] = useState<Record<string, string>>(() => Object.fromEntries(items.map(({ q }) => [q.id, typeof cur[q.id] === 'number' ? String(cur[q.id]) : ''])))
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  if (!items.length) return null
  const editable = can(s.session.role, 'adjust') && cycle.status !== '확정'
  const save = () => {
    for (const { q } of items) {
      const v = d[q.id].trim()
      if (v !== '' && !(Number(v) >= 0 && Number(v) <= q.points!)) return setMsg({ ok: false, text: `'${q.title}' 채점은 0~${q.points}점으로 입력하세요.` })
    }
    update((x) => {
      const m = { ...(x.manualScores?.[aid] ?? {}) }
      for (const { q } of items) { const v = d[q.id].trim(); if (v === '') delete m[q.id]; else m[q.id] = Number(v) }
      x.manualScores = { ...(x.manualScores ?? {}), [aid]: m }
    })
    setMsg({ ok: true, text: '채점을 저장했습니다.' })
  }
  return (
    <div className="manual-score">
      {items.map(({ q }) => (
        <label key={q.id}>채점 · {q.title} <input type="text" inputMode="decimal" aria-label={`${q.title} 채점값`} disabled={!editable} value={d[q.id]} placeholder="미채점" onChange={(e) => { setD({ ...d, [q.id]: e.target.value }); setMsg(null) }} /> / {q.points}점</label>
      ))}
      {editable && <button className="btn small primary" onClick={save}>채점 저장</button>}
      {msg && <span className={`feedback ${msg.ok ? 'ok' : 'fail'}`} role={msg.ok ? 'status' : 'alert'}>{msg.ok ? '✓' : '✕'} {msg.text}</span>}
    </div>
  )
}

export const KIND_TEXT: Record<AdjustKind, string> = { dept: '팀 보정', person: '개인 보정', ceoScore: '최종 지정 점수', ceoGrade: '최종 등급' }
const show = (v: number | string | null) => (v === null || v === undefined || v === '' ? '없음' : String(v))

type Msg = { ok: boolean; text: string } | null

/** 숫자 입력 검증. 빈 칸 = 지정 해제(null). 0은 실제 값 */
function parseScore(raw: string, min: number, max: number): { value: number | null; error?: string } {
  if (raw.trim() === '') return { value: null }
  const n = Number(raw)
  if (!Number.isFinite(n)) return { value: null, error: '숫자를 입력하세요.' }
  if (n < min || n > max) return { value: null, error: `${min}~${max} 사이로 입력하세요.` }
  return { value: Math.round(n * 10) / 10 }
}

function Adjusters({ cycle, targetId, current }: { cycle: Cycle; targetId: string; current: NonNullable<ReturnType<typeof personResult>> }) {
  const s = useAppState()
  const role = s.session.role
  const by = s.session.finalAdjust ? '운영담당자(최종 조정)' : '운영담당자'
  const [person, setPerson] = useState(current.person === null ? '' : String(current.person))
  const [ceo, setCeo] = useState(current.ceoScore === null ? '' : String(current.ceoScore))
  const [grade, setGrade] = useState(current.ceoGrade ?? '')
  const [reason, setReason] = useState('') // 선택 입력 — 비워도 저장 (D-068)
  const [msg, setMsg] = useState<Record<string, Msg>>({})
  const canAdjust = can(role, 'adjust')
  const canFinal = canFinalAdjust(s.session)
  if (!canAdjust && !canFinal) return null // 권한이 없으면 편집 영역 자체를 보이지 않음

  const apply = (key: string, kind: AdjustKind, value: number | string | null, prev: number | string | null) => {
    if (value === prev) return setMsg({ ...msg, [key]: { ok: true, text: '변경 사항이 없습니다.' } })
    addAdjustment(cycle.id, kind, targetId, value, reason.trim(), by) // 변경자·시각·전후 값은 자동 기록, 사유는 선택
    setReason('')
    setMsg({ ...msg, [key]: { ok: true, text: value === null ? '지정을 해제했습니다.' : '적용했습니다.' } })
  }
  const applyNum = (key: string, kind: AdjustKind, raw: string, min: number, max: number, prev: number | null) => {
    const r = parseScore(raw, min, max)
    if (r.error) return setMsg({ ...msg, [key]: { ok: false, text: r.error } })
    apply(key, kind, r.value, prev)
  }
  const Feedback = ({ k }: { k: string }) => (msg[k] ? <span className={`feedback ${msg[k]!.ok ? 'ok' : 'fail'}`} role={msg[k]!.ok ? 'status' : 'alert'}>{msg[k]!.ok ? '✓' : '✕'} {msg[k]!.text}</span> : null)

  return (
    <div className="detail-col">
    <h2 id="adjust-title" className="section-title">최종 점수 보정</h2>
    <section className="panel pad adjust" aria-labelledby="adjust-title">
      {canAdjust && (
        <div className="adj-row">
          <label className="field">개인 보정(점)
            <input type="text" inputMode="decimal" value={person} placeholder="없음" onChange={(e) => setPerson(e.target.value)} />
          </label>
          <button className="btn" onClick={() => applyNum('person', 'person', person, -100, 100, current.person)}>적용</button>
          <Feedback k="person" />
        </div>
      )}
      {canFinal && (
        <>
          <div className="adj-row">
            <label className="field">최종 지정 점수
              <input type="text" inputMode="decimal" value={ceo} placeholder="없음" onChange={(e) => setCeo(e.target.value)} />
            </label>
            <button className="btn" onClick={() => applyNum('ceo', 'ceoScore', ceo, 0, 100, current.ceoScore)}>적용</button>
            <Feedback k="ceo" />
          </div>
          <div className="adj-row">
            <label className="field">최종 등급
              <select value={grade} onChange={(e) => setGrade(e.target.value)}>
                <option value="">없음</option>{['A', 'B', 'C', 'D'].map((g) => <option key={g}>{g}</option>)}
              </select>
            </label>
            <button className="btn" onClick={() => apply('grade', 'ceoGrade', grade || null, current.ceoGrade)}>적용</button>
            <Feedback k="grade" />
          </div>
        </>
      )}
      <label className="field adj-reason"><span>보정 사유 <span className="muted">(선택)</span></span>
        <input type="text" maxLength={200} value={reason} placeholder="적용할 때 변경 기록에 함께 남습니다" onChange={(e) => setReason(e.target.value)} />
      </label>
    </section>
    </div>
  )
}
