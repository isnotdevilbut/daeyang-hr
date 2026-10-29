import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { update, useAppState } from '../../data/store'
import { useSelectedCycle } from '../../data/hooks'
import { can } from '../../domain/permissions'
import { fmt, fmtSigned, personResult } from '../../domain/scoring'
import { jobName, targetPosition } from '../../domain/catalog'
import { ctxFor } from '../../domain/questions'
import { isActiveAssignment, pathFor } from '../../domain/progress'
import type { AppState, Assignment, Cycle, Question, TargetSnapshot } from '../../domain/types'
import { visibleSections } from '../../components/QuestionView'
import { Forbidden, Notice, NotBuilt } from '../../components/ui'
import { answerText, KIND_TEXT } from './PersonResult'
import logoKo from '../../assets/logo-ko.png'

/**
 * 개인 리포트 미리보기 (D-081): 포함 항목 선택 + 추가 기록.
 * - 포함 항목은 이 화면의 선택일 뿐 저장 데이터·점수를 바꾸지 않는다. 체크하면 미리보기와 브라우저 인쇄(PDF로 저장)에 같이 반영
 * - 긴 답변은 자르지 않고 다음 페이지로 넘긴다(줄바꿈 유지)
 * - 추가 기록은 회차 + 직원 ID에 연결(`reportNotes`), 관리자만 작성. 출력 제외해도 기록은 지우지 않음
 */
type Item = { key: string; label: string }
type Group = { key: string; label: string; items: Item[]; sub?: { label: string; items: Item[] }[] }

const noteKey = (cycleId: string, empId: string) => `${cycleId}|${empId}`

export default function Report() {
  const { targetId } = useParams()
  const [params] = useSearchParams()
  const from = params.get('from') === 'results' ? 'results' : 'progress'
  const s = useAppState()
  const [cycle] = useSelectedCycle()
  if (!can(s.session.role, 'reportPreview')) return <Forbidden />
  const t = cycle?.targets.find((x) => x.employeeId === targetId)
  if (!cycle || !t) return <div className="page">대상자를 찾을 수 없습니다.</div>
  return <ReportBody key={`${cycle.id}|${t.employeeId}`} s={s} cycle={cycle} t={t} from={from} />
}

/** 평가 유형별 배정과 그 배정에 적용되는 문항 */
function evalParts(s: AppState, cycle: Cycle, t: TargetSnapshot) {
  const path = pathFor(cycle, t)
  const mine = cycle.assignments.filter((a) => a.targetId === t.employeeId && isActiveAssignment(a))
  const of = (rule: 'self' | 'teamLead' | 'executive') => {
    const order = path.find((st) => st.rule === rule)?.order
    return order === undefined ? [] : mine.filter((a) => a.stageOrder === order && (rule === 'self') === (a.direction === 'self'))
  }
  const qs = (as: Assignment[]) => {
    const seen = new Map<string, Question>()
    for (const a of as) for (const sec of visibleSections(cycle.templates[a.templateId], ctxFor(cycle, a))) for (const q of sec.questions) if (!seen.has(q.id)) seen.set(q.id, q)
    return [...seen.values()]
  }
  const name = (id: string) => s.employees.find((e) => e.id === id)?.name ?? '?'
  const self = of('self'), lead = of('teamLead'), exec = of('executive').sort((a, b) => name(a.evaluatorId).localeCompare(name(b.evaluatorId), 'ko'))
  return { self, lead, exec, selfQ: qs(self), leadQ: qs(lead), execQ: qs(exec), name }
}

function ReportBody({ s, cycle, t, from }: { s: AppState; cycle: Cycle; t: TargetSnapshot; from: string }) {
  const r = personResult(s, cycle, t.employeeId)!
  const parts = useMemo(() => evalParts(s, cycle, t), [s, cycle, t])
  const emp = s.employees.find((e) => e.id === t.employeeId)
  const qItems = (prefix: string, qs: Question[]): Item[] => qs.map((q) => ({ key: `${prefix}:q:${q.id}`, label: q.title }))
  const groups: Group[] = [
    { key: 'info', label: '기본 정보', items: [{ key: 'info.name', label: '이름' }, { key: 'info.empNo', label: '사번' }, { key: 'info.team', label: '팀' }, { key: 'info.position', label: '직급' }, { key: 'info.job', label: '직무' }] },
    { key: 'cycle', label: '평가 회차·기간', items: [{ key: 'cycle.name', label: '평가 회차' }, { key: 'cycle.period', label: '평가 기간' }] },
    ...(parts.self.length ? [{ key: 'self', label: '자기평가 답변', items: qItems('self', parts.selfQ) }] : []),
    ...(parts.lead.length ? [{ key: 'lead', label: '팀장평가 답변·의견', items: qItems('lead', parts.leadQ) }] : []),
    ...(parts.exec.length ? [{
      key: 'exec', label: '임원평가 답변·의견', items: [],
      sub: [
        { label: '임원', items: parts.exec.map((a) => ({ key: `exec:e:${a.evaluatorId}`, label: parts.name(a.evaluatorId) })) },
        { label: '문항', items: qItems('exec', parts.execQ) },
      ],
    }] : []),
    { key: 'scores', label: '점수', items: [{ key: 'scores.stage', label: '단계별 점수' }, { key: 'scores.base', label: '개인 평가 점수' }, { key: 'scores.kpi', label: '팀 KPI·KPI 반영 후 점수' }, { key: 'scores.final', label: '최종 점수·보정 내역·사유' }] },
    { key: 'note', label: '추가 기록', items: [{ key: 'note', label: '추가 기록' }] },
  ]
  const itemsOf = (g: Group) => [...g.items, ...(g.sub ?? []).flatMap((x) => x.items)]
  const allKeys = groups.flatMap(itemsOf).map((i) => i.key)
  const [off, setOff] = useState<Set<string>>(new Set())
  const on = (k: string) => !off.has(k)
  const set = (keys: string[], v: boolean) => { const n = new Set(off); keys.forEach((k) => (v ? n.delete(k) : n.add(k))); setOff(n) }

  // 추가 기록 (관리자만 작성) — 저장 전 입력은 이 화면에만
  const key = noteKey(cycle.id, t.employeeId)
  const saved = s.reportNotes?.[key] ?? ''
  const [draft, setDraft] = useState(saved)
  const [noteMsg, setNoteMsg] = useState('')
  const dirty = draft !== saved
  const editable = s.session.role === 'admin'
  const saveNote = () => {
    update((d) => { const m = { ...(d.reportNotes ?? {}) }; if (draft.trim()) m[key] = draft; else delete m[key]; d.reportNotes = m })
    setNoteMsg(draft.trim() ? '저장했습니다.' : '추가 기록을 비웠습니다.')
  }
  useEffect(() => { if (!noteMsg) return; const x = setTimeout(() => setNoteMsg(''), 3000); return () => clearTimeout(x) }, [noteMsg])
  const noteText = saved.trim() ? saved : '' // 출력은 저장된 내용 기준

  const info = [
    on('info.name') && ['이름', <b key="n">{t.name}</b>],
    on('info.empNo') && ['사번', emp?.empNo ?? t.empNo],
    on('info.team') && ['팀', t.teamName],
    on('info.position') && ['직급', targetPosition(s, cycle, t)],
    on('info.job') && ['직무', jobName(s, t.jobType)],
    on('cycle.name') && ['평가 회차', cycle.name],
    on('cycle.period') && ['평가 기간', cycle.period || '—'],
  ].filter(Boolean) as [string, ReactNode][]
  const qShown = (prefix: string, qs: Question[]) => qs.filter((q) => on(`${prefix}:q:${q.id}`))
  const selfQ = qShown('self', parts.selfQ), leadQ = qShown('lead', parts.leadQ), execQ = qShown('exec', parts.execQ)
  const execShown = parts.exec.filter((a) => on(`exec:e:${a.evaluatorId}`))
  const history = s.adjustments.filter((a) => a.cycleId === cycle.id && (a.targetKey === t.employeeId || a.targetKey === t.departmentId || (!!t.legacyUnitId && a.targetKey === t.legacyUnitId)))
  const scoreRows = on('scores.base') || on('scores.kpi') || on('scores.final')
  const showNote = on('note') && !!noteText
  const empty = !info.length && !selfQ.length && !leadQ.length && !(execShown.length && execQ.length) && !on('scores.stage') && !scoreRows && !showNote
  const complete = !r.combined.incomplete && r.ceoGrade !== null

  return (
    <div>
      <div className="page no-print" style={{ paddingBottom: 10 }}>
        <div className="row">
          <Link to={`/admin/results/${t.employeeId}?from=${from}`}>← 개인 상세로 돌아가기</Link>
          <span className="spacer" />
          <button className="btn" disabled={empty} title={empty ? '포함한 항목이 없습니다' : undefined} onClick={() => window.print()}>브라우저 인쇄 미리보기</button>
          <button className="btn" disabled title="실서비스 단계에서 서버가 권한 확인 후 생성">엑셀 다운로드</button>
          <button className="btn" disabled title="실서비스 단계에서 서버가 권한 확인 후 생성">PDF 다운로드</button>
          <NotBuilt>파일 다운로드</NotBuilt>
        </div>
        <Notice kind="demo" title="리포트 미리보기(시연)">화면 미리보기와 브라우저 인쇄(PDF로 저장)만 됩니다. 엑셀·PDF 파일 생성은 실서비스 단계에서 구현합니다.</Notice>

        <details className="panel report-opts" open>
          <summary><b>포함 항목</b> <span className="muted">{allKeys.filter(on).length}/{allKeys.length}</span></summary>
          <div className="row report-opts-actions">
            <button className="btn small" onClick={() => setOff(new Set())}>모두 선택</button>
            <button className="btn small" onClick={() => setOff(new Set(allKeys))}>모두 해제</button>
          </div>
          <div className="report-opts-grid">
            {groups.map((g) => {
              const keys = itemsOf(g).map((i) => i.key)
              const n = keys.filter(on).length
              return (
                <fieldset key={g.key} className="opt-group">
                  <legend>
                    <label className="check"><input type="checkbox" aria-label={`${g.label} 전체`} checked={n === keys.length} ref={(el) => { if (el) el.indeterminate = n > 0 && n < keys.length }} onChange={(e) => set(keys, e.target.checked)} /> <b>{g.label}</b></label>
                  </legend>
                  {g.key !== 'note' && g.items.length > 0 && <div className="opt-items">{g.items.map((i) => <label key={i.key} className="check"><input type="checkbox" checked={on(i.key)} onChange={(e) => set([i.key], e.target.checked)} /> {i.label}</label>)}</div>}
                  {g.sub?.map((sb) => (
                    <div key={sb.label} className="opt-sub"><span className="muted">{sb.label}</span>
                      <div className="opt-items">{sb.items.map((i) => <label key={i.key} className="check"><input type="checkbox" checked={on(i.key)} onChange={(e) => set([i.key], e.target.checked)} /> {i.label}</label>)}</div>
                    </div>
                  ))}
                </fieldset>
              )
            })}
          </div>
        </details>

        <section className="panel pad report-note" aria-label="추가 기록 입력">
          <div className="row"><h2 style={{ margin: 0, fontSize: 17 }}>추가 기록</h2><span className="muted">선택 · 이 직원의 이 회차 리포트에만</span><span className="spacer" />{noteMsg && <span className="feedback ok" role="status">✓ {noteMsg}</span>}</div>
          <textarea aria-label="추가 기록" rows={4} value={draft} readOnly={!editable} onChange={(e) => setDraft(e.target.value)} placeholder={editable ? '면담 내용, 보고 시 참고 사항 등' : ''} />
          {editable && (
            <div className="row" style={{ gap: 8 }}>
              <span className="spacer" />
              <button className="btn" disabled={!dirty} onClick={() => { setDraft(saved); setNoteMsg('') }}>취소</button>
              <button className="btn primary" disabled={!dirty} onClick={saveNote}>저장</button>
            </div>
          )}
        </section>
      </div>
      <div className="report-shell">
        <div className="a4">
          <div className="watermark">{complete ? '검토용 초안 · 가상 데이터' : '미완료 초안 · 가상 데이터'}</div>
          <div className="row" style={{ marginBottom: 6 }}>
            <img src={logoKo} alt="ROLLENT 대양롤랜트(주)" style={{ height: 34 }} />
          </div>
          <h1>개인 인사평가 리포트</h1>
          <div className="muted">내부 보관 자료 · 직원 비공개</div>
          {empty && <p className="report-empty">포함한 항목이 없습니다.</p>}
          {info.length > 0 && (
            <table className="rp-info"><tbody>
              {pairs(info).map((row, i) => (
                <tr key={i}>{row.map(([k, v]) => [<th key={`${k}h`}>{k}</th>, <td key={`${k}d`}>{v}</td>])}{row.length === 1 && <td className="rp-blank" colSpan={2} />}</tr>
              ))}
            </tbody></table>
          )}
          {selfQ.length > 0 && <Answers title="자기평가" as={parts.self} qs={selfQ} s={s} cycle={cycle} />}
          {leadQ.length > 0 && <Answers title="팀장평가" as={parts.lead} qs={leadQ} s={s} cycle={cycle} showWho name={parts.name} />}
          {execShown.length > 0 && execQ.length > 0 && <Answers title="임원평가" as={execShown} qs={execQ} s={s} cycle={cycle} showWho name={parts.name} />}
          {on('scores.stage') && (
            <div className="rp-block">
              <h3>단계별 점수 <span className="rp-assume">※ 개발용 가정 계산 · 회사 산식 아님</span></h3>
              <table>
                <thead><tr><th style={{ width: '24%' }}>단계</th><th>평가자</th><th style={{ width: '14%' }}>점수</th><th style={{ width: '10%' }}>등급</th></tr></thead>
                <tbody>
                  {r.stages.map((st) => (
                    <tr key={st.order}><td>{st.order}단계 {st.label}{st.evaluators.length > 1 && <div className="muted">{st.evaluators.length}명 평균</div>}</td><td>{st.evaluators.join(', ')}</td><td>{st.submitted ? fmt(st.score) : '미제출'}</td><td>{st.submitted ? st.grade?.slice(0, 1) ?? '—' : '—'}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {scoreRows && (
            <div className="rp-block">
              <h3>점수 구성</h3>
              <table><tbody>
                {on('scores.base') && <tr><th>개인 평가 점수</th><td>{r.combined.base === null ? '미완료' : fmt(r.combined.base)}</td></tr>}
                {on('scores.kpi') && <tr><th>팀 KPI</th><td>{r.kpi === null ? '—' : `${fmt(r.kpi)} (${r.combined.kpiApplied ? `반영 ${r.kpiBlend.kpi}%` : '미반영'})`}</td></tr>}
                {on('scores.kpi') && r.kpiBlend.enabled && <tr><th>KPI 반영 후 점수</th><td>{r.combined.kpiApplied && r.combined.afterKpi !== null ? fmt(r.combined.afterKpi) : '—'}</td></tr>}
                {on('scores.final') && <>
                  <tr><th>팀 보정</th><td>{fmtSigned(r.dept)}</td></tr>
                  <tr><th>개인 보정</th><td>{fmtSigned(r.person)}</td></tr>
                  <tr><th>최종 지정</th><td>{fmt(r.ceoScore)}</td></tr>
                  <tr><th>최종 점수</th><td><b>{fmt(r.combined.final)}</b></td></tr>
                  <tr><th>최종 등급</th><td><b>{r.ceoGrade ?? '미확정'}</b></td></tr>
                </>}
              </tbody></table>
              {on('scores.final') && history.length > 0 && (
                <table className="rp-hist">
                  <thead><tr><th style={{ width: '24%' }}>보정 항목</th><th style={{ width: '18%' }}>값</th><th>사유</th></tr></thead>
                  <tbody>{history.map((h) => <tr key={h.id}><td>{KIND_TEXT[h.kind]}</td><td>{h.value === null || h.value === '' ? '없음' : String(h.value)}</td><td className="ans">{h.reason || '—'}</td></tr>)}</tbody>
                </table>
              )}
            </div>
          )}
          {showNote && (
            <div className="rp-block">
              <h3>추가 기록</h3>
              <div className="rp-note ans">{noteText}</div>
            </div>
          )}
          <p className="muted rp-foot">출력 시각 {new Date().toLocaleString('ko-KR')} · 계산 정책 {s.policy.name} · 이 문서는 가상 데이터로 만든 시연용입니다.</p>
        </div>
      </div>
    </div>
  )
}

/** 기본 정보를 한 줄에 두 칸씩 — 해제한 칸은 비우지 않고 당겨서 채움 */
function pairs<T>(xs: T[]): T[][] { const out: T[][] = []; for (let i = 0; i < xs.length; i += 2) out.push(xs.slice(i, i + 2)); return out }

function Answers({ title, as, qs, s, cycle, showWho, name }: { title: string; as: Assignment[]; qs: Question[]; s: AppState; cycle: Cycle; showWho?: boolean; name?: (id: string) => string }) {
  return (
    <div className="rp-block">
      <h3>{title}</h3>
      {as.map((a) => {
        const resp = s.responses[a.id]
        const tpl = cycle.templates[a.templateId]
        const applicable = new Set(visibleSections(tpl, ctxFor(cycle, a)).flatMap((x) => x.questions.map((q) => q.id)))
        const rows = qs.filter((q) => applicable.has(q.id))
        if (!rows.length) return null
        return (
          <div key={a.id} className="rp-eval">
            {showWho && name && <div className="rp-who">{name(a.evaluatorId)}{resp?.status !== 'submitted' && <span className="muted"> · 미제출</span>}</div>}
            <table><tbody>
              {resp?.status !== 'submitted'
                ? <tr><td className="muted" colSpan={2}>(미제출)</td></tr>
                : rows.map((q) => <tr key={q.id}><th>{q.title}</th><td className="ans">{answerText(tpl, q.id, resp.answers[q.id])}</td></tr>)}
            </tbody></table>
          </div>
        )
      })}
    </div>
  )
}
