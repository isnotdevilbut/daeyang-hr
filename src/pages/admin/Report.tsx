import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { update, useAppState } from '../../data/store'
import { useSelectedCycle } from '../../data/hooks'
import { can } from '../../domain/permissions'
import { fmt, personResult } from '../../domain/scoring'
import { jobName, targetPosition } from '../../domain/catalog'
import { ctxFor } from '../../domain/questions'
import { isActiveAssignment, pathFor, resultPerson } from '../../domain/progress'
import type { AppState, Assignment, Cycle, Question, TargetSnapshot } from '../../domain/types'
import { visibleSections } from '../../components/QuestionView'
import { Forbidden, Modal } from '../../components/ui'
import { templateXlsx } from '../../domain/xlsx'
import { cycleLabel } from '../../domain/cycle'
import { answerText } from './PersonResult'
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
  const t = cycle && targetId ? resultPerson(s, cycle, targetId) : undefined // 참여 임원도(D-192)
  if (!cycle || !t) return <div className="page">대상자를 찾을 수 없습니다.</div>
  return <ReportBody key={`${cycle.id}|${t.employeeId}`} s={s} cycle={cycle} t={t} from={from} />
}

/** 평가 유형별 배정과 그 배정에 적용되는 문항 */
export function evalParts(s: AppState, cycle: Cycle, t: TargetSnapshot) {
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
  const parts = useMemo(() => evalParts(s, cycle, t), [s, cycle, t])
  const stageList = personResult(s, cycle, t.employeeId)?.stages ?? []
  const qItems = (prefix: string, qs: Question[]): Item[] => qs.map((q) => ({ key: `${prefix}:q:${q.id}`, label: q.title }))
  // 포함 항목 = 평가 답변(자기·팀장·임원평가)만 고름(D-128). 기본 정보·평가 회차·점수는 항상, 추가 기록은 저장한 경우 항상 리포트에 들어감
  const groups: Group[] = [
    ...(parts.self.length ? [{ key: 'self', label: '자기평가 답변', items: qItems('self', parts.selfQ) }] : []),
    ...(parts.lead.length ? [{ key: 'lead', label: '팀장평가 답변·의견', items: qItems('lead', parts.leadQ) }] : []),
    ...(parts.exec.length ? [{
      key: 'exec', label: '임원평가 답변·의견', items: [],
      sub: [
        { label: '임원', items: parts.exec.map((a) => ({ key: `exec:e:${a.evaluatorId}`, label: parts.name(a.evaluatorId) })) },
        { label: '문항', items: qItems('exec', parts.execQ) },
      ],
    }] : []),
    // D-225: 단계별 점수도 단계마다 골라서(평가자가 준 점수를 본인에게 보이지 않게 뺄 수 있게)
    ...(stageList.length ? [{ key: 'stage', label: '단계별 점수', items: stageList.map((st) => ({ key: `stage:${st.order}`, label: `${st.order}단계 ${st.label}` })) }] : []),
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
  const [preview, setPreview] = useState(false)
  const [noteMsg, setNoteMsg] = useState('')
  const dirty = draft !== saved
  const editable = s.session.role === 'admin'
  const saveNote = () => {
    update((d) => { const m = { ...(d.reportNotes ?? {}) }; if (draft.trim()) m[key] = draft; else delete m[key]; d.reportNotes = m })
    setNoteMsg(draft.trim() ? '저장했습니다.' : '추가 기록을 비웠습니다.')
  }
  useEffect(() => { if (!noteMsg) return; const x = setTimeout(() => setNoteMsg(''), 3000); return () => clearTimeout(x) }, [noteMsg])
  const m = sheetModel(s, cycle, t, parts, on)
  const empty = m.empty
  const fileBase = `${t.name}_${cycleLabel(cycle)}_개인리포트`.replace(/[\\/:*?"<>|]/g, '_')
  const download = (kind: 'xlsx' | 'csv') => {
    const a4 = document.querySelector<HTMLElement>('.report-shell .a4')
    if (!a4) return
    const rows = reportRows(a4)
    if (kind === 'xlsx') return saveFile(`${fileBase}.xlsx`, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', templateXlsx('개인 리포트', REPORT_HEAD, rows))
    saveFile(`${fileBase}.csv`, 'text/csv;charset=utf-8', '\ufeff' + [REPORT_HEAD, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n')
  }

  return (
    <div>
      <div className="page no-print" style={{ paddingBottom: 10 }}>
        <div className="row">
          <Link to={`/admin/results/${t.employeeId}?from=${from}`}>← 개인 상세로 돌아가기</Link>
          <span className="spacer" />
          {/* D-134: 파일 저장 — 화면에서 고른 포함 항목 그대로. 브라우저 안에서 만들어 내려받기(외부 전송 없음). PDF는 인쇄 창의 'PDF로 저장' */}
          <button className="btn" disabled={empty} title={empty ? '포함한 항목이 없습니다' : '인쇄하거나 인쇄 창에서 PDF로 저장'} onClick={() => window.print()}>인쇄·PDF 저장</button>
          {/* D-176: 화면에서 리포트 본문 보기(인쇄 전 확인) — 포함 항목 선택 그대로 */}
          <button className="btn" disabled={empty} onClick={() => setPreview(true)}>미리보기</button>
          <button className="btn" disabled={empty} onClick={() => download('xlsx')}>엑셀(.xlsx)</button>
          <button className="btn" disabled={empty} onClick={() => download('csv')}>CSV</button>
        </div>

        <details className="panel report-opts" open>
          {/* D-133: 모두 선택·모두 해제는 제목 줄 맨 오른쪽(아래 선택 칸과 간격) — 눌러도 접히지 않게 */}
          <summary className="report-opts-head">
            <b>포함 항목</b> <span className="muted">{allKeys.filter(on).length}/{allKeys.length}</span>
            <span className="spacer" />
            <span className="row report-opts-actions">
              <button className="btn small" onClick={(e) => { e.preventDefault(); setOff(new Set()) }}>모두 선택</button>
              <button className="btn small" onClick={(e) => { e.preventDefault(); setOff(new Set(allKeys)) }}>모두 해제</button>
            </span>
          </summary>
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
      {/* 리포트 본문은 화면에서 숨기고 인쇄(브라우저 인쇄 미리보기·PDF로 저장)에서만 나옴(D-128) */}
      {preview && (
        <Modal title="미리보기" onClose={() => setPreview(false)} wide>
          <div className="report-preview"><ReportSheet s={s} cycle={cycle} t={t} parts={parts} m={m} /></div>
        </Modal>
      )}
      <div className="report-shell print-only">
        <ReportSheet s={s} cycle={cycle} t={t} parts={parts} m={m} />
      </div>
    </div>
  )
}

/** 리포트 본문에 들어갈 내용(포함 항목 on 반영) — 개인 리포트·선택 항목 다운로드(D-167) 공통 */
export function sheetModel(s: AppState, cycle: Cycle, t: TargetSnapshot, parts: ReturnType<typeof evalParts>, on: (k: string) => boolean) {
  const r = personResult(s, cycle, t.employeeId)!
  const emp = s.employees.find((e) => e.id === t.employeeId)
  const saved = s.reportNotes?.[noteKey(cycle.id, t.employeeId)] ?? ''
  const noteText = saved.trim() ? saved : '' // 출력은 저장된 내용 기준
  const info = [
    on('info.name') && ['이름', <b key="n">{t.name}</b>],
    on('info.empNo') && ['사번', emp?.empNo ?? t.empNo],
    on('info.team') && ['팀', t.teamName],
    on('info.position') && ['직급', targetPosition(s, cycle, t)],
    on('info.job') && ['직무', jobName(s, t.jobType)],
  ].filter(Boolean) as [string, ReactNode][]
  // D-226: 평가 회차·기간은 인적 사항 표 위 캡션으로
  const caption = [on('cycle.name') && ['평가 회차', cycleLabel(cycle)], on('cycle.period') && ['평가 기간', cycle.period || '—']].filter(Boolean) as [string, string][]
  const qShown = (prefix: string, qs: Question[]) => qs.filter((q) => on(`${prefix}:q:${q.id}`))
  const selfQ = qShown('self', parts.selfQ), leadQ = qShown('lead', parts.leadQ), execQ = qShown('exec', parts.execQ)
  const execShown = parts.exec.filter((a) => on(`exec:e:${a.evaluatorId}`))
  const history = s.adjustments.filter((a) => a.cycleId === cycle.id && (a.targetKey === t.employeeId || a.targetKey === t.departmentId || (!!t.legacyUnitId && a.targetKey === t.legacyUnitId)))
  const scoreRows = on('scores.base') || on('scores.kpi') || on('scores.final')
  const showNote = on('note') && !!noteText
  const stagesShown = r.stages.filter((st) => on(`stage:${st.order}`)) // D-225: 단계마다 포함 여부
  const empty = !info.length && !caption.length && !selfQ.length && !leadQ.length && !(execShown.length && execQ.length) && !stagesShown.length && !scoreRows && !showNote
  const complete = !r.combined.incomplete && r.grade !== null
  return { r, info, caption, selfQ, leadQ, execQ, execShown, history, scoreRows, showNote, noteText, empty, complete, on, stagesShown }
}

/** 리포트 본문(A4 한 장 분량 — 길면 다음 쪽으로) */
export function ReportSheet({ s, cycle, parts, m }: { s: AppState; cycle: Cycle; t: TargetSnapshot; parts: ReturnType<typeof evalParts>; m: ReturnType<typeof sheetModel> }) {
  const { r, info, selfQ, leadQ, execQ, execShown, scoreRows, showNote, noteText, complete, on } = m
  return (
    <div className="a4">
      <div className="watermark">{complete ? '검토용 초안' : '미완료 초안'}</div>
      {/* D-226: 머리 부분을 한 줄로 — 로고 · 제목 · 비공개 표시 */}
      <div className="rp-head">
        <img src={logoKo} alt="ROLLENT 대양롤랜트(주)" />
        <h1>개인 인사평가 리포트</h1>
        <span className="muted">내부 보관 자료 · 직원 비공개</span>
      </div>
      {m.empty && <p className="report-empty">포함한 항목이 없습니다.</p>}
      {/* 평가 회차·기간 = 인적 사항 표 위 캡션, 인적 사항 = 가로 한 줄(머리글 + 값) */}
      {m.caption.length > 0 && <div className="rp-caption">{m.caption.map(([k, v]) => <span key={k} className="rp-cap-item" data-k={k} data-v={v}><b>{k}</b> {v}</span>)}</div>}
      {info.length > 0 && (
        <table className="rp-info rp-info-row">
          <thead><tr>{info.map(([k]) => <th key={k}>{k}</th>)}</tr></thead>
          <tbody><tr>{info.map(([k, v]) => <td key={k}>{v}</td>)}</tr></tbody>
        </table>
      )}
      {selfQ.length > 0 && <Answers title="자기평가" as={parts.self} qs={selfQ} s={s} cycle={cycle} />}
      {leadQ.length > 0 && <Answers title="팀장평가" as={parts.lead} qs={leadQ} s={s} cycle={cycle} showWho name={parts.name} />}
      {execShown.length > 0 && execQ.length > 0 && <Answers title="임원평가" as={execShown} qs={execQ} s={s} cycle={cycle} showWho name={parts.name} />}
      {m.stagesShown.length > 0 && (
        <div className="rp-block">
          <h3>단계별 점수 <span className="rp-assume">※ 개발용 가정 계산 · 회사 산식 아님</span></h3>
          <table>
            <thead><tr><th style={{ width: '24%' }}>단계</th><th>평가자</th><th style={{ width: '14%' }}>점수</th><th style={{ width: '10%' }}>등급</th></tr></thead>
            <tbody>
              {m.stagesShown.map((st) => (
                <tr key={st.order}><td><span className="stage-no">{st.order}단계</span> {st.label}{st.evaluators.length > 1 && <div className="muted">{st.evaluators.length}명 평균</div>}</td><td>{st.evaluators.join(', ')}</td><td>{st.submitted ? fmt(st.score) : '미제출'}</td><td>{st.submitted ? st.grade?.slice(0, 1) ?? '—' : '—'}</td></tr>
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
            {on('scores.kpi') && <tr><th>팀 KPI</th><td>{r.kpi === null ? '—' : fmt(r.kpi)}</td></tr>}
            {on('scores.final') && <>
              <tr><th>보정 점수</th><td>{r.person === null ? '—' : fmt(r.person)}</td></tr>
              <tr><th>최종 점수</th><td><b>{fmt(r.combined.final)}</b></td></tr>
              <tr><th>최종 등급</th><td><b>{r.grade ?? '미확정'}</b></td></tr>
            </>}
          </tbody></table>
        </div>
      )}
      {showNote && (
        <div className="rp-block">
          <h3>추가 기록</h3>
          <div className="rp-note ans">{noteText}</div>
        </div>
      )}
      <p className="muted rp-foot">출력 시각 {new Date().toLocaleString('ko-KR')}</p>
    </div>
  )
}

/** 기본 정보를 한 줄에 두 칸씩 — 해제한 칸은 비우지 않고 당겨서 채움 */

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

// ── 리포트 파일 저장 (D-134) ─────────────────────────
// 화면에 그린 리포트 본문(.a4 — 포함 항목 선택 반영)을 그대로 읽어 표(구분·항목·내용·비고)로 만든다 — 워드 저장은 제거(D-177)
const clean = (x: string) => x.replace(/\s+/g, ' ').trim()
/** 열: 구분(리포트 소제목) · 항목 · 내용 · 값 · 비고 — 점수 표(단계·평가자·점수·등급)도 잘리지 않게 다섯 칸 */
export const REPORT_HEAD = ['구분', '항목', '내용', '값', '비고']
export function reportRows(a4: HTMLElement): string[][] {
  const out: string[][] = []
  let section = '기본 정보'
  a4.querySelectorAll('h3, table tr, .rp-note, .rp-cap-item').forEach((el) => {
    if (el.tagName === 'H3') { section = clean(el.childNodes[0]?.textContent ?? el.textContent ?? ''); return }
    if (el.classList.contains('rp-cap-item')) { out.push([section, (el as HTMLElement).dataset.k ?? '', (el as HTMLElement).dataset.v ?? '', '', '']); return }
    // 인적 사항 가로 표(D-226): 머리글 칸 = 항목, 값 칸 = 내용
    if (el.closest('table')?.classList.contains('rp-info-row')) {
      if (el.closest('thead')) return
      const heads = [...(el.closest('table')!.querySelectorAll('thead th'))].map((h) => clean(h.textContent ?? ''))
      ;[...el.children].forEach((c, i) => out.push([section, heads[i] ?? '', clean(c.textContent ?? ''), '', '']))
      return
    }
    if (el.classList.contains('rp-note')) { out.push([section, '추가 기록', clean(el.textContent ?? ''), '', '']); return }
    const cells = [...el.children].filter((c) => !c.classList.contains('rp-blank')).map((c) => clean(c.textContent ?? ''))
    if (el.closest('thead') || !cells.some(Boolean)) return
    if (el.closest('table')?.classList.contains('rp-info')) { for (let i = 0; i < cells.length; i += 2) out.push([section, cells[i], cells[i + 1] ?? '', '', '']); return }
    out.push([section, ...cells, '', '', '', ''].slice(0, 5))
  })
  return out
}
export const csvCell = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)
export function saveFile(name: string, type: string, data: string | Uint8Array) {
  const url = URL.createObjectURL(new Blob([data], { type }))
  const a = document.createElement('a')
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
