import { useMemo, useState } from 'react'
import { update, useAppState } from '../../data/store'
import { useDirty } from '../../data/dirty'
import { buildAssignments, cycleExecs } from '../../domain/cycle'
import { applyVersions } from '../../domain/versions'
import { applyExecDraft, distributeExecs, execAssignment, execOrder } from '../../domain/execPlan'
import { syncUpward } from '../../domain/upward'
import { GRADE_CUTS_DEFAULT } from '../../domain/scoring'
import { pathFor, STAGE_OF_RULE, statusOf } from '../../domain/progress'
import { cycleHasResponses, weightErrors, weightSum } from '../../domain/questions'
import { type Cycle, type EvaluatorRule } from '../../domain/types'
import { Modal, SecToggle } from '../../components/ui'
import { targetPosition } from '../../domain/catalog'

type PathKey = 'member' | 'lead'
const UP_DEFAULT = { label: '팀원→팀장평가', weight: 0 as number | null }
const PATH_TITLE: Record<PathKey, string> = { member: '사원이 받는 평가', lead: '팀장이 받는 평가' }
/** 유형별로 둘 수 있는 단계 — 팀장에게는 2단계(팀장평가)가 없다 */
const PATH_RULES: Record<PathKey, EvaluatorRule[]> = { member: ['self', 'teamLead', 'executive'], lead: ['self', 'executive'] }

/** D-164: part = 'weights'(사원·팀장이 받는 평가·등급 인원 비율 — 가중치·등급 탭, D-198) / 'exec'(임원 평가 배정 — 평가자 배정 탭) */
export default function EvalAssign({ cycle, part }: { cycle: Cycle; part: 'weights' | 'exec' }) {
  const s = useAppState()
  const live = s.cycles.find((c) => c.id === cycle.id)!
  const hasResp = cycleHasResponses(s, live)
  const initial = useMemo(() => ({ path: structuredClone(live.path), weights: structuredClone(live.stageWeights ?? { member: {}, lead: {} }), up: structuredClone(live.upwardStage ?? UP_DEFAULT) }), [live.path, live.stageWeights, live.upwardStage])
  const [draft, setDraft] = useState(initial)
  // 임원 담당 변경(D-086): 대상자 ID → 임원 ID. 저장 전에는 이 화면에만, 저장·되돌리기는 위 공통 버튼으로
  const [execDraft, setExecDraft] = useState<Record<string, string>>({})
  // 영역별 저장(D-094): 사원·팀장이 받는 평가·임원 평가 배정이 각자 저장 버튼·결과 표시. 한 영역 저장이 다른 영역 편집값을 건드리지 않음
  type Msg = { ok: boolean; text: string } | null
  const [msgs, setMsgs] = useState<Record<'member' | 'lead' | 'exec', Msg>>({ member: null, lead: null, exec: null })
  const setMsgFor = (k: 'member' | 'lead' | 'exec', m: Msg) => setMsgs((x) => ({ ...x, [k]: m }))
  const secDirty = (k: PathKey) => JSON.stringify(draft.path[k]) !== JSON.stringify(initial.path[k]) || JSON.stringify(draft.weights[k] ?? {}) !== JSON.stringify(initial.weights[k] ?? {}) || (k === 'lead' && JSON.stringify(draft.up) !== JSON.stringify(initial.up))
  const execDirty = Object.keys(execDraft).length > 0
  useDirty(secDirty('member') || secDirty('lead') || execDirty) // 저장하지 않은 변경이 있으면 회차·화면 이동 시 확인(기존 보호)
  const rulesChanged = (k: PathKey) => draft.path[k].map((x) => x.rule).join() !== initial.path[k].map((x) => x.rule).join()

  const upErr = () => (draft.up.weight === null || Number.isNaN(draft.up.weight) ? '상향평가 비율을 입력하세요.' : draft.up.weight < 0 || draft.up.weight > 100 ? '상향평가 비율은 0~100 사이여야 합니다.' : '')
  const errs = (k: PathKey) => [...weightErrors(draft.path[k], draft.weights[k]), ...(k === 'lead' && upErr() ? [upErr()] : [])]
  const setLabel = (k: PathKey, r: EvaluatorRule, v: string) => {
    const next = structuredClone(draft)
    next.path[k].find((x) => x.rule === r)!.label = v
    setDraft(next)
  }
  const setWeight = (k: PathKey, order: number, v: string) => {
    const next = structuredClone(draft)
    next.weights[k][order] = v === '' ? null : Number(v)
    setDraft(next); setMsgFor(k, null)
  }
  /** 한 경로(사원·팀장이 받는 평가)만 저장 — 합계 100% 등 검증 후 그 경로의 단계 이름·반영 비율만 반영 */
  const saveSec = (k: PathKey) => {
    const e = errs(k).slice()
    if (draft.path[k].length === 0) e.push('단계가 하나 이상 있어야 합니다.')
    if (e.length) return setMsgFor(k, { ok: false, text: e.join(' / ') })
    const rebuild = rulesChanged(k) // 단계 구성이 바뀐 경우에만(현재 화면에서는 바꿀 수 없음) 배정을 다시 만든다
    if (rebuild && !confirm('평가 단계가 바뀌어 평가자 배정을 다시 만듭니다. 계속할까요?')) return
    update((d) => {
      const c = d.cycles.find((x) => x.id === cycle.id)!
      c.path = { ...c.path, [k]: draft.path[k] }
      c.stageWeights = { ...(c.stageWeights ?? { member: {}, lead: {} }), [k]: draft.weights[k] }
      if (k === 'lead') c.upwardStage = structuredClone(draft.up)
      if (rebuild) { const ups = c.assignments.filter((a) => a.direction === 'up'); c.assignments = [...buildAssignments(d, c), ...ups]; distributeExecs(d, c); syncUpward(d, c); applyVersions(d, c) } // 상향평가 배정은 그대로 두고 새 짝에 맞춤(D-191)
    })
    setMsgFor(k, { ok: true, text: rebuild ? '저장하고 배정을 다시 만들었습니다.' : '저장했습니다.' })
  }
  /** 임원 평가 배정만 저장 */
  const saveExec = () => {
    update((d) => { const c = d.cycles.find((x) => x.id === cycle.id)!; applyExecDraft(d, c, execDraft); syncUpward(d, c) }) // 담당 임원이 바뀌면 임원 상향평가 대상도(D-191)
    setExecDraft({})
    setMsgFor('exec', { ok: true, text: '저장했습니다.' })
  }
  const saveBtn = (k: PathKey) => (
    <div className="sec-save">
      {msgs[k] && <span className={`feedback ${msgs[k]!.ok ? 'ok' : 'fail'}`} role={msgs[k]!.ok ? 'status' : 'alert'}>{msgs[k]!.ok ? '✓' : '✕'} {msgs[k]!.text}</span>}
      <button className="btn primary small" disabled={!secDirty(k)} onClick={() => saveSec(k)}>저장</button>
    </div>
  )

  const locked = rulesChanged('member') || rulesChanged('lead')
  // D-212: 임원평가와 임원 상향평가는 항상 같은 짝(쌍방) — '상향평가도 같은 임원으로' 체크·임원 상향평가 따로 배정(D-207) 없앰
  if (part === 'exec') return <Assignments cycle={live} locked={locked} execDraft={execDraft} setExecDraft={(x) => { setExecDraft(x); setMsgFor('exec', null) }} onSave={saveExec} msg={msgs.exec} />
  return (
    <>
      <div className="grid path-grid">
        {(['member', 'lead'] as PathKey[]).map((k) => {
          const path = draft.path[k]
          const sum = weightSum(path, draft.weights[k])
          const e = errs(k)
          return (
            <section className="panel" key={k}>
              <div className="panel-head sec-head"><h2>{PATH_TITLE[k]}</h2>{saveBtn(k)}</div>
              <table className="tbl path-tbl">
                <thead><tr><th>단계</th><th>평가자</th><th>이름</th><th className="num">반영 비율(%)</th></tr></thead>
                <tbody>
                  {PATH_RULES[k].flatMap((r) => (k === 'lead' && r === 'self' ? [r, 'upward' as const] : [r])).map((r) => {
                    // 팀장이 받는 팀원→팀장평가(D-114): 1단계로 분류. D-162 — 다른 단계처럼 이름·반영 비율 입력(기본 0). 비율은 저장만, 합계·점수에는 아직 넣지 않음(반영 방식 보류)
                    if (r === 'upward') return (
                      <tr key={r}>
                        <td><span className="muted" title="상향평가는 1·2·3단계와 별개">—</span></td>
                        <td><span className="path-who">소속 팀원 (상향평가)</span></td>
                        <td><input type="text" aria-label={`${PATH_TITLE[k]} 상향평가 이름`} disabled={hasResp} value={draft.up.label} onChange={(ev) => { setDraft({ ...draft, up: { ...draft.up, label: ev.target.value } }); setMsgFor(k, null) }} /></td>
                        <td className="num">
                          <input type="number" inputMode="decimal" className="weight no-spin" min={0} max={100} step={0.1} onWheel={(ev) => ev.currentTarget.blur()} aria-label={`${PATH_TITLE[k]} 상향평가 반영 비율`}
                            value={draft.up.weight ?? ''} placeholder="입력" onChange={(ev) => { setDraft({ ...draft, up: { ...draft.up, weight: ev.target.value === '' ? null : Number(ev.target.value) } }); setMsgFor(k, null) }} />
                        </td>
                      </tr>
                    )
                    const st = path.find((x) => x.rule === r)
                    const order = STAGE_OF_RULE[r]
                    return (
                      <tr key={r} className={st ? '' : 'stage-off'}>
                        <td><b className="stage-no">{order}단계</b></td>
                        <td>
                          {/* 평가자는 고정 정보 — 체크박스 없이 글자만 (D-087). 단계 사용 여부·배정은 그대로 */}
                          <span className="path-who">{r === 'self' ? '본인 (자기평가)' : r === 'teamLead' ? '소속 팀장' : '담당 임원'}</span>
                        </td>
                        <td>{st ? <input type="text" aria-label={`${PATH_TITLE[k]} ${order}단계 이름`} disabled={hasResp} value={st.label} onChange={(ev) => setLabel(k, r, ev.target.value)} /> : <span className="muted">사용 안 함</span>}</td>
                        <td className="num">
                          {st ? <input type="number" inputMode="decimal" className="weight no-spin" min={0} max={100} step={0.1} onWheel={(ev) => ev.currentTarget.blur()} aria-label={`${PATH_TITLE[k]} ${order}단계 반영 비율`}
                            value={draft.weights[k][order] ?? ''} placeholder="입력" onChange={(ev) => setWeight(k, order, ev.target.value)} /> : <span className="na-dash" aria-label="해당 없음">—</span>}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={3} />{/* D-162: 안내 문구 제거 */}
                    <td className="num"><b className={e.length ? 'bad' : 'good'}>합계 {sum === null ? '—' : `${sum}%`}</b>{/* D-165: '적용 단계 기준 100%로 환산' 안내 제거(계산 방식은 그대로) */}</td>
                  </tr>
                </tfoot>
              </table>
              {e.length > 0 && <div className="feedback fail path-err">{e.map((x) => <div key={x}>✕ {x}</div>)}</div>}
            </section>
          )
        })}
      </div>
      {/* 등급 인원 비율은 단계 설정 아래 (D-087). 임원 평가 배정은 평가자 배정 탭으로(D-164) */}
      <GradeRatios />
    </>
  )
}

/**
 * 임원 평가 배정(D-087): 임원별 영역 안에서 팀을 펼쳐 담당 대상자를 체크. 대상자 한 명 = 담당 임원 한 명(다른 임원에게 체크하면 확인 뒤 옮김).
 * 팀 머리글의 펼치기와 팀 전체 선택은 따로. 체크 해제 = 미지정(자동으로 채우지 않음, 완료로 세지 않음). 제출된 평가는 체크 고정·'제출' 표시.
 * 자기평가·팀장평가는 자동 연결이라 여기 나오지 않음. 저장·되돌리기는 화면 아래 공통 저장 바
 */
function Assignments({ cycle, locked, execDraft, setExecDraft, onSave, msg }: { cycle: Cycle; locked: boolean; execDraft: Record<string, string>; setExecDraft: (x: Record<string, string>) => void; onSave: () => void; msg: { ok: boolean; text: string } | null }) {
  const mode = 'exec'
  const title = '임원 평가 배정'
  const s = useAppState()
  const [secOpen, setSecOpen] = useState(false) // D-202: 처음엔 접힘
  const [q, setQ] = useState('')
  const [team, setTeam] = useState('')
  const [adding, setAdding] = useState<string | null>(null) // D-231: '+ 추가'를 누른 임원
  const execs = cycleExecs(s, cycle)
  const name = (id: string) => s.employees.find((e) => e.id === id)?.name ?? '?'
  const rows = cycle.targets
    .filter((t) => { const e = s.employees.find((x) => x.id === t.employeeId); return !!e && e.active && !e.evalExcluded && !t.isExecutive && execOrder(cycle, t) !== undefined })
    .map((t) => {
      const a = execAssignment(cycle, t)
      const st = a ? statusOf(s.responses, a.id) : 'notStarted'
      const leadStage = pathFor(cycle, t).find((x) => x.rule === 'teamLead')
      const noLead = !!leadStage && !cycle.assignments.some((x) => x.targetId === t.employeeId && x.stageOrder === leadStage.order && !x.excluded)
      const orig = a?.evaluatorId ?? ''
      return { t, a, st, orig, cur: execDraft[t.employeeId] ?? orig, noLead }
    })
    .sort((x, y) => x.t.teamName.localeCompare(y.t.teamName, 'ko') || Number(y.t.isTeamLead) - Number(x.t.isTeamLead) || x.t.name.localeCompare(y.t.name, 'ko'))
  type Row = (typeof rows)[number]
  const teams = [...new Set(rows.map((r) => r.t.teamName))]
  const qq = q.trim()
  const visible = (r: Row) => (!team || r.t.teamName === team) && (!qq || r.t.name.includes(qq) || r.t.teamName.includes(qq))
  const unassigned = rows.filter((r) => !r.cur)
  /** 여러 대상자를 한 번에 바꾸기 — 다른 임원 담당·작성 중 평가는 한 번 확인. 제출된 평가는 건너뜀 */
  // D-233: 모두 고를 수 있음 — 다른 임원 배정과 겹치면 팝업으로 확인(제출·작성 중 평가도 옮길 수 있고, 이전 평가는 '이전 배정' 기록으로 남음)
  const setMany = (list: Row[], ex: string, ask = true) => {
    const ch = list.filter((r) => r.cur !== ex)
    if (!ch.length) return true
    if (ask) {
      const moving = ch.filter((r) => r.cur && ex)
      const written = ch.filter((r) => (r.st === 'draft' || r.st === 'submitted') && r.a && r.a.evaluatorId !== ex)
      const lines: string[] = []
      if (moving.length) lines.push(moving.length === 1 ? `${moving[0].t.name}은(는) 지금 ${name(moving[0].cur)} 배정이에요. ${name(ex)} 배정으로 바꾸겠습니까?` : `${moving.map((r) => `${r.t.name}(${name(r.cur)})`).join(', ')}은(는) 지금 다른 임원 배정이에요. ${name(ex)} 배정으로 바꾸겠습니까?`)
      else if (!ex && written.length) lines.push(`${written.map((r) => r.t.name).join(', ')}의 배정을 뺄까요?`)
      if (written.length) lines.push(`(이미 쓴 평가 ${written.length}건은 이전 기록으로 남아요)`)
      if (lines.length && !confirm(lines.join('\n'))) return false
    }
    const next = { ...execDraft }
    for (const r of ch) { if (ex === r.orig) delete next[r.t.employeeId]; else next[r.t.employeeId] = ex }
    setExecDraft(next)
    return true
  }
  return (
    <section className="panel exec-assign" aria-labelledby={`${mode}-assign-title`}>
      <div className="panel-head row">
        <h2 id={`${mode}-assign-title`} style={{ margin: 0 }}><button type="button" className="sec-title-btn" onClick={() => setSecOpen(!secOpen)}>{title} <span className="muted">{rows.length}명</span></button></h2>
        <span className="spacer" />
        {unassigned.length > 0 && <span className="exec-load warn">미지정 {unassigned.length}명</span>}
        <div className="sec-save">
          {msg && <span className={`feedback ${msg.ok ? 'ok' : 'fail'}`} role={msg.ok ? 'status' : 'alert'}>{msg.ok ? '✓' : '✕'} {msg.text}</span>}
          <button className="btn primary small" disabled={locked || Object.keys(execDraft).length === 0} onClick={onSave}>저장</button>
        </div>
        <SecToggle open={secOpen} onClick={() => setSecOpen(!secOpen)} label={title} />
      </div>
      {secOpen && <>
      <div className="filters">
        <input type="search" placeholder="이름·팀 검색" aria-label={`${title} 대상자 검색`} value={q} onChange={(e) => setQ(e.target.value)} />
        <select aria-label={`${title} 팀`} value={team} onChange={(e) => setTeam(e.target.value)}>
          <option value="">전체 팀</option>
          {teams.map((x) => <option key={x}>{x}</option>)}
        </select>
        {/* D-166: '미지정만' 거르기 제거 */}
      </div>
      {/* D-233: 안내 문구 없음 */}
      {/* D-231: 임원 카드 = 그 임원이 맡은 사람만(팀별), ✕로 빼기 · '+ 추가'로 팀별 토글 → 직원 목록에서 골라 추가(체크박스 펼침 없앰) */}
      <div className="exec-cols">
        {execs.map((ex) => {
          const mine = rows.filter((r) => r.cur === ex.id)
          const shownMine = mine.filter(visible)
          return (
            <section key={ex.id} className="exec-col" aria-label={`${ex.name} ${title}`}>
              <header className="exec-col-head"><b>{ex.name}</b><span className="exec-n">{mine.length}명</span><button type="button" className="btn small exec-add" disabled={locked} onClick={() => setAdding(ex.id)}>+ 추가</button></header>
              {shownMine.length === 0 ? <p className="muted small exec-empty">{mine.length ? '검색 조건에 맞는 사람 없음' : '맡은 사람 없음'}</p> : (
                <div className="exec-mine">
                  {teams.map((tm) => {
                    const list = shownMine.filter((r) => r.t.teamName === tm)
                    if (!list.length) return null
                    return (
                      <div key={tm} className="exec-mine-team">
                        <div className="exec-mine-tm">{tm} <span className="exec-team-n on">{list.length}명</span></div>
                        <ul>
                          {list.map((r) => (
                            <li key={r.t.employeeId} className={execDraft[r.t.employeeId] !== undefined ? 'changed' : ''}>
                              <b>{r.t.name}</b><span className="muted">{targetPosition(s, cycle, r.t)}</span>
                              {r.st === 'draft' && execDraft[r.t.employeeId] === undefined && <span className="muted small">작성 중</span>}
                              {r.noLead && <span className="chip draft tag">팀장 설정 필요</span>}
                              <span className="spacer" />
                              {/* D-233: 제출된 평가도 뺄 수 있음(팝업 확인) */}
                              <button type="button" className="exec-x" disabled={locked} aria-label={`${ex.name} 담당에서 ${r.t.name} 빼기`} title="빼기(미지정으로)" onClick={() => setMany([r], '')}><span aria-hidden>−</span></button>{/* D-235: 빼기 = 빨간 테두리 동그라미 안 − */}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )
                  })}
                </div>
              )}
            </section>
          )
        })}
      </div>
      {adding && (() => {
        const ex = execs.find((x) => x.id === adding)!
        return <ExecAddModal exName={ex.name} rows={rows.filter((r) => r.cur !== ex.id)} teams={teams} posOf={(r) => targetPosition(s, cycle, r.t)}
          onClose={() => setAdding(null)} onAdd={(list) => { if (setMany(list, ex.id)) setAdding(null) }} />
      })()}
      </>}
    </section>
  )
}

/** 등급 인원 비율 — 평가자 화면 "내 등급 배정 현황"의 기준값(경고만). 모든 회차 공통 저장값을 그대로 편집 */
function GradeRatios() {
  // D-217: 최종 등급 방식 두 가지 — 절대평가(기본, 최종 점수가 기준 점수 이상이면 그 등급) / 등급 비율(순위 × 인원 비율, D-197). 동그라미로 고름
  const s = useAppState()
  const saved = s.policy.gradeRatios
  const savedMode = s.policy.gradeMode ?? 'absolute'
  const savedCuts = { ...GRADE_CUTS_DEFAULT, ...(s.policy.gradeCuts ?? {}) }
  const G = ['A', 'B', 'C', 'D', 'E'] as const // E 등급(D-160)
  const C = ['A', 'B', 'C', 'D'] as const
  const [mode, setMode] = useState<'absolute' | 'ratio'>(savedMode)
  const [d, setD] = useState<Record<string, string>>(() => Object.fromEntries(G.map((g) => [g, String(saved[g] ?? 0)])))
  const [cuts, setCuts] = useState<Record<string, string>>(() => Object.fromEntries(C.map((g) => [g, String(savedCuts[g])])))
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const vals = G.map((g) => Number(d[g]))
  const sum = vals.reduce((a, v) => a + (Number.isFinite(v) ? v : 0), 0)
  const cutVals = C.map((g) => Number(cuts[g]))
  const dirty = mode !== savedMode || G.some((g) => d[g] !== String(saved[g] ?? 0)) || C.some((g) => cuts[g] !== String(savedCuts[g]))
  const save = () => {
    if (mode === 'ratio') {
      if (G.some((g) => d[g].trim() === '' || !Number.isFinite(Number(d[g])) || Number(d[g]) < 0 || Number(d[g]) > 100)) return setMsg({ ok: false, text: '각 비율은 0~100 사이 숫자로 입력하세요.' })
      if (Math.abs(sum - 100) > 0.001) return setMsg({ ok: false, text: `합계가 ${+sum.toFixed(2)}%입니다. 100%가 되어야 합니다.` })
    } else {
      if (C.some((g) => cuts[g].trim() === '' || !Number.isFinite(Number(cuts[g])) || Number(cuts[g]) < 0 || Number(cuts[g]) > 100)) return setMsg({ ok: false, text: '기준 점수는 0~100 사이 숫자로 입력하세요.' })
      if (cutVals.some((v, i) => i > 0 && v >= cutVals[i - 1])) return setMsg({ ok: false, text: 'A > B > C > D 순서로 기준 점수가 낮아져야 합니다.' })
    }
    update((x) => {
      x.policy.gradeMode = mode
      if (mode === 'ratio') G.forEach((g, i) => { x.policy.gradeRatios[g] = vals[i] })
      else x.policy.gradeCuts = { A: cutVals[0], B: cutVals[1], C: cutVals[2], D: cutVals[3] }
    })
    setMsg({ ok: true, text: '저장했습니다.' })
  }
  const pick = (m: 'absolute' | 'ratio') => { setMode(m); setMsg(null) }
  return (
    <section className="panel pad grade-ratio-panel">
      {/* 영역 제목 오른쪽에 이 영역만 저장(D-094) — 모든 회차 공통 값 */}
      <div className="sec-head">
        <h2>등급</h2>
        <div className="sec-save">
          {msg && <span className={`feedback ${msg.ok ? 'ok' : 'fail'}`} role={msg.ok ? 'status' : 'alert'}>{msg.ok ? '✓' : '✕'} {msg.text}</span>}
          <button className="btn primary small" disabled={!dirty} onClick={save}>저장</button>
        </div>
      </div>
      <div className="row grade-mode" role="radiogroup" aria-label="등급 방식">
        <label className="check"><input type="radio" name="grade-mode" checked={mode === 'absolute'} onChange={() => pick('absolute')} /> 절대평가 <span className="muted small">(점수 기준)</span></label>
        <label className="check"><input type="radio" name="grade-mode" checked={mode === 'ratio'} onChange={() => pick('ratio')} /> 등급 비율 <span className="muted small">(인원 비율)</span></label>
      </div>
      {mode === 'absolute' ? (
        <div className="row grade-ratio grade-cuts">
          {C.map((g) => (
            <label key={g} className="field">{g} (점 이상)
              <input type="text" inputMode="decimal" className="no-spin" value={cuts[g]} onChange={(e) => { setCuts({ ...cuts, [g]: e.target.value }); setMsg(null) }} />
            </label>
          ))}
          <span className="grade-e">E <span className="muted">{Number.isFinite(cutVals[3]) ? `${cutVals[3]}점 미만` : ''}</span></span>
        </div>
      ) : (
        <div className="row grade-ratio">
          {G.map((g) => (
            <label key={g} className="field">{g} (%)
              <input type="text" inputMode="decimal" className="no-spin" value={d[g]} onChange={(e) => { setD({ ...d, [g]: e.target.value }); setMsg(null) }} />
            </label>
          ))}
          <b className={Math.abs(sum - 100) < 0.001 ? 'good' : 'bad'}>합계 {+sum.toFixed(2)}%</b>
        </div>
      )}
    </section>
  )
}

/**
 * 임원에게 사람 추가(D-231): 팀별 토글(처음엔 접힘) → 펼치면 그 팀 직원 목록에서 체크해 추가.
 * 지금 다른 임원 담당이면 '(지금: OO 담당)' 표시 — 추가하면 이 임원으로 옮김(한 사람 = 담당 임원 한 명). 제출된 평가는 옮길 수 없음
 */
type ExecRow = { t: Cycle['targets'][number]; cur: string; st: string }
function ExecAddModal<R extends ExecRow>({ exName, rows, teams, posOf, onClose, onAdd }: { exName: string; rows: R[]; teams: string[]; posOf: (r: R) => string; onClose: () => void; onAdd: (list: R[]) => void }) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const [pick, setPick] = useState<Set<string>>(new Set())
  const qq = q.trim()
  const shown = rows.filter((r) => !qq || r.t.name.includes(qq) || r.t.teamName.includes(qq))
  const toggle = (id: string, on: boolean) => { const n = new Set(pick); if (on) n.add(id); else n.delete(id); setPick(n) }
  return (
    <Modal title={`${exName}에게 추가`} onClose={onClose}>
      <div className="exec-add">
        <input type="search" placeholder="이름·팀 검색" aria-label="추가할 사람 검색" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="exec-add-teams">
          {teams.map((tm) => {
            const list = shown.filter((r) => r.t.teamName === tm)
            if (!list.length) return null
            const isOpen = !!open[tm] || !!qq
            const n = list.filter((r) => pick.has(r.t.employeeId)).length
            return (
              <div key={tm} className={`exec-team ${isOpen ? 'open' : ''}`}>
                <button type="button" className="exec-team-toggle" aria-expanded={isOpen} onClick={() => setOpen((o) => ({ ...o, [tm]: !o[tm] }))}>
                  <span>{tm}</span>{n > 0 && <span className="exec-team-n on">{n}명 선택</span>}<span className="muted small">{list.length}명</span><span className="caret" aria-hidden>▾</span>
                </button>
                {isOpen && (
                  <ul className="exec-people">
                    {list.map((r) => (
                      <li key={r.t.employeeId}>
                        <label>
                          <input type="checkbox" checked={pick.has(r.t.employeeId)} aria-label={`${r.t.name} 추가`} onChange={(e) => toggle(r.t.employeeId, e.target.checked)} />
                          <b>{r.t.name}</b><span className="muted">{posOf(r)}</span>
                        </label>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )
          })}
        </div>
        <div className="row" style={{ marginTop: 12 }}><span className="spacer" /><button className="btn" onClick={onClose}>취소</button><button className="btn primary" disabled={!pick.size} onClick={() => onAdd(rows.filter((r) => pick.has(r.t.employeeId)))}>추가</button></div>
      </div>
    </Modal>
  )
}
