import { useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { update, useAppState } from '../../data/store'
import { useSelectedCycle } from '../../data/hooks'
import { can } from '../../domain/permissions'
import { cycleLabel, rejectRecord } from '../../domain/cycle'
import { fmt, personResult, weightsFor } from '../../domain/scoring'
import { activeWriteAssignments, appliedStages, assignmentCell, isActiveAssignment, personSnap, resultPerson, stageAssignments, STAGE_OF_RULE, statusOf, upwardAssignments, type CellStatus } from '../../domain/progress'
import { UPWARD_KIND_TEXT, upwardKind } from '../../domain/upward'
import { displayAnswer } from '../../domain/seed'
import { type AdjustKind, type Assignment, type Cycle, type Lang, type Response, type Stage, type Template } from '../../domain/types'
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
  const t = cycle && targetId ? resultPerson(s, cycle, targetId) : undefined // 대상자 + 참여 임원(D-192)
  // 받는 평가가 없는 평가자 전용 참여자(자기평가를 끈 임원 등, D-069): 작성할 평가만 보여 준다 (점수·리포트 없음)
  // 상향평가만 받는 임원(D-187)도 같은 화면 — 받는 상향평가 + 담당 평가 현황
  const writer = cycle && !t ? s.employees.find((e) => e.id === targetId && e.active && (cycle.assignments.some((a) => a.evaluatorId === e.id && isActiveAssignment(a)) || upwardAssignments(cycle, s.employees).some((a) => a.targetId === e.id))) : undefined
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
        {/* 자기평가를 끈 임원 등 받는 평가가 없는 평가자: 담당 평가 현황만 (D-089) — 임원이 받는 상향평가(D-187)도 여기에(D-190) */}
        <WriteList cycle={cycle} evaluatorId={writer.id} hideEmpty />
      </div>
    )
  }
  if (!cycle || !t) return <div className="page"><Link to={back.to}>← {back.label}</Link><p>대상자를 찾을 수 없습니다.</p></div>
  const r = personResult(s, cycle, t.employeeId)!
  // D-209: 집계에서 빠진 이전 배정 기록은 응답 결과 맨 아래 '이전 배정 · 집계 제외'로 따로(x/y 완료에서도 뺌)
  const staged = cycle.assignments.filter((a) => a.targetId === t.employeeId && !a.excluded).sort((a, b) => a.stageOrder - b.stageOrder)
  const oldRecs = cycle.assignments.filter((a) => a.targetId === t.employeeId && a.excluded && s.responses[a.id])
  const name = (id: string) => s.employees.find((e) => e.id === id)?.name ?? '?'
  const weights = weightsFor(cycle, t)
  const anyUnsubmitted = r.stages.some((x) => !x.submitted)
  const anyUngraded = r.stages.some((x) => x.ungraded) // 배점 있는 서술형 미채점(D-103) — 0점이 아닌 미완료
  const noStages = r.stages.length === 0 // 자기평가를 끈 임원(D-192): 1·2·3단계 없음 — 기초 점수 = 상향평가 평균(D-215)
  const baseText = r.combined.base !== null ? fmt(r.combined.base) : noStages ? '미완료' : anyUnsubmitted || anyUngraded ? '미완료' : '계산 안 됨'

  return (
    <div className="page detail-page">
      <div className="detail-top no-print">
        <Link to={back.to} className="back-link">← {back.label}</Link>
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
      {/* D-129·D-130: 진행 현황에서 연 상세 = 평가 현황만, 결과·리포트에서 연 상세 = 점수 요약·최종 점수 보정·단계별 응답·변경 내역(평가 현황 없음) */}
      {from === 'progress' && <>
        {/* D-131: 받는 평가 = '단계별 현황', 이 사람이 해야 할 평가 = '담당 평가 현황'(사원·팀장·임원 모두, 없으면 표시 안 함) */}
        <RecvList cycle={cycle} targetId={t.employeeId} />
        <WriteList cycle={cycle} evaluatorId={t.employeeId} hideEmpty />
      </>}
      {from === 'results' && <>
      {/* 제목은 상자 밖, 내용은 상자 안 — 평가 현황과 같은 구조 (D-087) */}
      <div className="detail-grid">
        <div className="detail-col">
        <h2 id="score-title" className="section-title">점수 요약</h2>
        <section className="panel pad" aria-labelledby="score-title">
          {!noStages && <table className="tbl score-stages">
            <thead><tr><th>단계</th><th>평가</th><th className="num">원점수</th><th className="num">반영 비율</th></tr></thead>
            <tbody>
              {r.stages.map((st) => {
                const w = weights[st.order]
                return (
                  <tr key={st.order}>
                    <td><b className="stage-no">{st.order}단계</b></td>
                    <td>{st.label}</td>
                    <td className="num">{st.submitted ? (st.score === null ? '—' : fmt(st.score)) : <span className="chip stage todo">미제출</span>}</td>
                    <td className="num">{typeof w === 'number' ? `${w}%` : '미입력'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>}
          <dl className="score-sum">
            <div><dt>{noStages ? '상향평가 평균(기초 점수)' : '개인평가 기초 점수'}</dt><dd>{baseText}</dd>{/* D-201: 안내 문구 없음 */}</div>
            {/* D-215: 팀 KPI는 직급별 비율의 팀 KPI %로 반영, 보정 점수는 기초 점수를 바꾸는 값 */}
            <div><dt>팀 KPI 점수{r.kpiBlend.enabled && <small className="muted"> (반영 {r.kpiBlend.kpi}%)</small>}</dt><dd>{r.kpi === null ? '—' : fmt(r.kpi)}</dd></div>
            <div><dt>보정 점수</dt><dd>{r.person === null ? '—' : fmt(r.person)}</dd></div>
            <div className="total"><dt>최종 점수</dt><dd>{r.combined.final === null ? '—' : fmt(r.combined.final)}</dd></div>
            <div className="total"><dt>최종 등급</dt><dd>{r.grade ?? '—'}</dd></div>
          </dl>
        </section>
        </div>
        <Adjusters cycle={cycle} targetId={t.employeeId} current={r} />
      </div>

      <h2 className="section-title">응답 결과</h2>
      {/* D-132: 평가 유형별 토글(1단계 자기평가 · 상향평가(단계 표시 없음, D-188) · 2단계 팀장평가 · 3단계 임원평가). 작성자가 여럿이면 작성자마다 토글 — 처음엔 접힘 */}
      {(['self', 'teamLead', 'executive', 'upward'] as const).map((rule) => { // D-193: 1·2·3단계 다음에 상향평가
        const list = staged.filter((a) => ctxFor(cycle, a).rule === rule)
        if (!list.length) return null
        const order = list[0].stageOrder
        const stage = rule === 'upward' ? undefined : r.stages.find((x) => x.order === order) // 팀원→팀장평가는 점수 단계가 아님(D-114)
        const sub = list.filter((a) => statusOf(s.responses, a.id) === 'submitted').length
        const chip = (a: Assignment) => { const st = statusOf(s.responses, a.id); return <span className={`chip ${st === 'submitted' ? 'stage done' : 'stage todo'}`}>{st === 'submitted' ? '✓ 제출' : st === 'draft' ? '작성 중' : '미제출'}</span> }
        const body = (a: Assignment) => statusOf(s.responses, a.id) === 'submitted'
          ? <><AnswerList t={cycle.templates[a.templateId]} r={s.responses[a.id]} a={a} cycle={cycle} /><ManualScores cycle={cycle} aid={a.id} /></>
          : <p className="muted stage-empty">아직 제출되지 않았습니다.</p>
        return (
          <details className="panel stage-card stage-group" key={rule}>
            <summary className="stage-head">
              <h3>{rule !== 'upward' && <><span className="stage-no">{order}단계</span> · </>}{RULE_TEXT[rule]}{rule === 'upward' && <> <span className="stage-no">({[...new Set(list.map((a) => UPWARD_KIND_TEXT[upwardKind(s, a)]))].join('·')})</span></>}</h3>
              {list.length === 1 ? <span className="muted">작성자 <b>{name(list[0].evaluatorId)}</b></span> : <span className="muted"><b>{sub}/{list.length}</b> 완료</span>}
              <span className="spacer" />
              {stage && sub > 0 && (stage.score !== null || stage.grade) && (
                <span className="stage-score">{stage.score !== null && <>점수 <b>{fmt(stage.score)}</b></>}{stage.grade && <> · 등급 <b>{stage.grade.slice(0, 1)}</b></>}</span>
              )}
              {stage?.ungraded && <span className="chip draft">미채점</span>}
              {list.length === 1 && chip(list[0])}
              <span className="toggle-ic" aria-hidden><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg></span>
            </summary>
            {list.length === 1 ? body(list[0]) : (
              <div className="stage-authors">
                {list.map((a) => (
                  <details key={a.id} className="author-item">
                    <summary><b>{name(a.evaluatorId)}</b><span className="spacer" />{chip(a)}<span className="toggle-ic" aria-hidden><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg></span></summary>
                    {body(a)}
                  </details>
                ))}
              </div>
            )}
          </details>
        )
      })}

      {oldRecs.length > 0 && <OldRecords cycle={cycle} list={oldRecs} />}

      {/* D-215: 변경 내역은 화면에 보이지 않음(기록은 데이터에 그대로) */}
      </>}
    </div>
  )
}

/** 본인이 받는 평가(D-076): 평가 유형·담당 평가자·상태. 적용 단계에 배정이 없으면 "평가자 미지정"(배정 누락) */
function RecvList({ cycle, targetId }: { cycle: Cycle; targetId: string }) {
  const s = useAppState()
  const t = cycle.targets.find((x) => x.employeeId === targetId)
  const name = (id: string) => s.employees.find((e) => e.id === id)?.name ?? '?'
  type Row = { key: string; stage: Stage; who: string; status: CellStatus }
  const rows: Row[] = (t ? appliedStages(cycle, t) : []).flatMap((st) => {
    const as = stageAssignments(cycle, targetId, st.order)
    return as.length === 0
      ? [{ key: `${st.order}-none`, stage: st, who: '—', status: 'unassigned' as CellStatus }]
      : as.map((a) => ({ key: a.id, stage: st, who: name(a.evaluatorId), status: assignmentCell(cycle, s.responses, a) }))
  })
  // 받는 상향평가는 1·2·3단계와 별개라 여기 넣지 않고 담당 평가 현황에(D-190)
  if (!rows.length) return null
  return (
    <>
    <h2 className="section-title">단계별 현황</h2>{/* 1·2·3단계가 없는 사람(자기평가를 끈 임원)은 제목도 없음 */}
    <section className="panel recv-panel" aria-label="받는 평가">
      <div className="table-wrap">
        <table className="tbl recv-tbl">
          <thead><tr><th>평가 유형</th><th>담당 평가자</th><th>상태</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <td>{RULE_TEXT[r.stage.rule]} <span className="stage-no">({r.stage.order}단계)</span></td>
                <td>{r.who}</td>
                {/* D-192: 상태는 완료/미완료만(담당 평가 현황과 같게, 미시작·작성 중·선행 단계 대기·평가자 미지정 = 미완료) */}
                <td><span className={`chip stage ${r.status === 'submitted' ? 'done' : 'todo'}`}>{r.status === 'submitted' ? '완료' : '미완료'}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
    </>
  )
}


/**
 * 담당 평가 현황(D-089): 이 평가자가 작성할 대상자 평가(자기평가 제외). 진행 현황 표의 작성 건수와 같은 배정(activeWriteAssignments)을 쓴다.
 * 완료 = 제출, 미완료 = 미시작·작성 중·선행 단계 대기 — 상태 칸은 완료/미완료만(세부 상태 문구 없음, D-111). 보기만(대신 작성·제출 없음)
 */
function WriteList({ cycle, evaluatorId, hideEmpty = false }: { cycle: Cycle; evaluatorId: string; hideEmpty?: boolean }) {
  const s = useAppState()
  const ups = upwardAssignments(cycle, s.employees)
  const mine = activeWriteAssignments(cycle, s.employees)
    .concat(ups) // 사원·팀장이 쓰는 상향평가(D-114·D-187)
    .filter((a) => a.evaluatorId === evaluatorId && a.direction !== 'self')
    .map((a) => ({ a, t: personSnap(s, cycle, a.targetId)!, st: assignmentCell(cycle, s.responses, a) }))
    .filter((r) => !!r.t)
    // 미완료 먼저, 완료는 아래(D-093) — 같은 그룹 안에서는 팀·팀장 먼저·이름 순
    .sort((x, y) => Number(x.st === 'submitted') - Number(y.st === 'submitted') || x.t.teamName.localeCompare(y.t.teamName, 'ko') || Number(y.t.isTeamLead) - Number(x.t.isTeamLead) || x.t.name.localeCompare(y.t.name, 'ko'))
  // D-190: 이 사람이 받는 상향평가(팀원→팀장·팀원→임원·팀장→임원)도 여기에 — 단계별 현황에는 1·2·3단계만. 쓰는 평가 다음에, 미완료 먼저·평가자 이름 순
  const nameOf = (id: string) => s.employees.find((e) => e.id === id)?.name ?? '?'
  const got = ups.filter((a) => a.targetId === evaluatorId)
    .map((a) => ({ a, t: personSnap(s, cycle, a.targetId)!, st: assignmentCell(cycle, s.responses, a) }))
    .filter((r) => !!r.t)
    .sort((x, y) => Number(x.st === 'submitted') - Number(y.st === 'submitted') || nameOf(x.a.evaluatorId).localeCompare(nameOf(y.a.evaluatorId), 'ko'))
  const rows = [...mine, ...got]
  const shown = rows // D-126: 전체·미완료·완료 개수 버튼 없이 모두 표시(미완료 먼저)
  if (hideEmpty && rows.length === 0) return null
  return (
    <>
      <h2 id="write-title" className="section-title">담당 평가 현황</h2>
      <section className="panel recv-panel write-panel" aria-labelledby="write-title">
        {rows.length === 0 ? <p className="write-empty">배정된 평가 없음</p> : <>
          <div className="table-wrap">
            <table className="tbl write-tbl">
              <thead><tr><th>평가 유형</th><th>팀</th><th>직급</th><th>평가자</th><th>평가 대상자</th><th>상태</th></tr></thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.a.id}>
                    <td><RuleText cycle={cycle} a={r.a} /></td>
                    <td>{r.t.teamName}</td>
                    <td>{targetPosition(s, cycle, r.t)}</td>
                    <td>{nameOf(r.a.evaluatorId)}</td>
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
  const by = '운영담당자'
  const [person, setPerson] = useState(current.person === null ? '' : String(current.person))
  // D-199: 보정 사유는 이 칸에만 기록(선택, 비워도 됨) — 변경 내역에 넣지 않고, 칸에 그대로 남음. 칸을 벗어나거나 적용하면 저장
  const noteKey = `${cycle.id}|${targetId}`
  const savedReason = s.adjustNotes?.[noteKey] ?? ''
  const [reason, setReason] = useState(savedReason)
  const saveReason = () => {
    const v = reason.trim()
    if (v === savedReason) return
    update((d) => { const m = { ...(d.adjustNotes ?? {}) }; if (v) m[noteKey] = v; else delete m[noteKey]; d.adjustNotes = m })
  }
  const [msg, setMsg] = useState<Record<string, Msg>>({})
  const canAdjust = can(role, 'adjust')
  if (!canAdjust) return null // 권한이 없으면 편집 영역 자체를 보이지 않음

  const apply = (key: string, kind: AdjustKind, value: number | string | null, prev: number | string | null) => {
    saveReason()
    if (value === prev) return setMsg({ ...msg, [key]: { ok: true, text: '변경 사항이 없습니다.' } })
    addAdjustment(cycle.id, kind, targetId, value, '', by) // 변경자·시각·전후 값은 자동 기록(사유는 넣지 않음, D-199)
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
      {/* D-197·D-215: 보정 칸 하나 — 기초 점수를 이 값으로 바꿈(비우고 적용하면 해제), 최종 점수·등급은 자동 */}
      {canAdjust && (
        <div className="adj-row">
          <label className="field">보정 점수 <span className="muted small">(기초 점수 대신, 0~100)</span>
            <input type="text" inputMode="decimal" value={person} placeholder="없음" onChange={(e) => setPerson(e.target.value)} />
          </label>
          <button className="btn" onClick={() => applyNum('person', 'person', person, 0, 100, current.person)}>적용</button>
          <Feedback k="person" />
        </div>
      )}
      <label className="field adj-reason"><span>보정 사유 <span className="muted">(선택)</span></span>
        <input type="text" maxLength={200} value={reason} placeholder="필요하면 적어 두세요" onChange={(e) => setReason(e.target.value)} onBlur={saveReason} />
      </label>
    </section>
    </div>
  )
}

/** 평가 유형 글자: 1·2·3단계는 '팀장평가 (2단계)', 상향평가는 '상향평가 (팀원→팀장)' — 괄호는 남색(D-188·D-190) */
function RuleText({ cycle, a }: { cycle: Cycle; a: Assignment }) {
  const s = useAppState()
  const rule = ctxFor(cycle, a).rule
  if (!rule) return null
  return <>{RULE_TEXT[rule]} <span className="stage-no">({rule === 'upward' ? UPWARD_KIND_TEXT[upwardKind(s, a)] : `${STAGE_OF_RULE[rule]}단계`})</span></>
}

/** 집계에서 빠진 이유(D-209) */
const EXCLUDED_TEXT: Record<NonNullable<Assignment['excluded']>, string> = {
  leadChanged: '팀장·임원·참여가 바뀌기 전에 쓴 평가',
  reassigned: '담당 임원이 바뀌기 전에 쓴 평가',
  selfOff: '자기평가를 끄기 전에 쓴 평가',
  execSelf: '이전 임원 자기평가',
}
/**
 * 이전 배정 · 집계 제외(D-209): 조직·배정이 바뀌어 점수·완료에 들어가지 않는 남은 기록. 내용 보기 + 반려(기록 지우기, 확인 후·되돌릴 수 없음).
 * 확정된 평가는 반려하지 않음
 */
function OldRecords({ cycle, list }: { cycle: Cycle; list: Assignment[] }) {
  const s = useAppState()
  const name = (id: string) => s.employees.find((e) => e.id === id)?.name ?? '?'
  const label = (a: Assignment) => { const rule = ctxFor(cycle, a).rule; return rule ? `${RULE_TEXT[rule]}${rule === 'upward' ? ` (${UPWARD_KIND_TEXT[upwardKind(s, a)]})` : ''}` : '' }
  const reject = (a: Assignment) => {
    if (!confirm(`${name(a.evaluatorId)}이(가) 쓴 '${label(a)}' 기록을 반려할까요?\n반려하면 이 기록이 지워지고 되돌릴 수 없어요.`)) return
    update((d) => { rejectRecord(d, cycle.id, a.id) })
  }
  return (
    <details className="panel stage-card stage-group old-records">
      <summary className="stage-head">
        <h3>이전 배정 · 집계 제외</h3>
        <span className="muted"><b>{list.length}</b>건</span>
        <span className="spacer" />
        <span className="toggle-ic" aria-hidden><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg></span>
      </summary>
      <div className="stage-authors">
        {list.map((a) => {
          const st = statusOf(s.responses, a.id)
          return (
            <details key={a.id} className="author-item">
              <summary><b>{name(a.evaluatorId)}</b><span className="muted small">{label(a)} · {EXCLUDED_TEXT[a.excluded!]}</span><span className="spacer" /><span className={`chip ${st === 'submitted' ? 'stage done' : 'stage todo'}`}>{st === 'submitted' ? '✓ 제출' : '작성 중'}</span><span className="toggle-ic" aria-hidden><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg></span></summary>
              {cycle.status !== '확정' && <div className="row old-rec-act"><span className="muted small">점수·완료에 들어가지 않는 기록이에요.</span><span className="spacer" /><button type="button" className="btn small danger" onClick={() => reject(a)}>반려(기록 지우기)</button></div>}
              {st === 'submitted' ? <AnswerList t={cycle.templates[a.templateId]} r={s.responses[a.id]} a={a} cycle={cycle} /> : <p className="muted stage-empty">제출 전(작성 중) 기록입니다.</p>}
            </details>
          )
        })}
      </div>
    </details>
  )
}
