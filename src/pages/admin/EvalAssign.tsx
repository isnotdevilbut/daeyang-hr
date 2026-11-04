import { useMemo, useState } from 'react'
import { update, useAppState } from '../../data/store'
import { useDirty } from '../../data/dirty'
import { buildAssignments, cycleExecs } from '../../domain/cycle'
import { applyVersions } from '../../domain/versions'
import { applyExecDraft, distributeExecs, execAssignment, execOrder } from '../../domain/execPlan'
import { pathFor, STAGE_OF_RULE, statusOf } from '../../domain/progress'
import { cycleHasResponses, weightErrors, weightSum } from '../../domain/questions'
import { type Cycle, type EvaluatorRule } from '../../domain/types'
import { targetPosition } from '../../domain/catalog'

type PathKey = 'member' | 'lead'
const UP_DEFAULT = { label: '팀원→팀장평가', weight: 0 as number | null }
const PATH_TITLE: Record<PathKey, string> = { member: '사원이 받는 평가', lead: '팀장이 받는 평가' }
/** 유형별로 둘 수 있는 단계 — 팀장에게는 2단계(팀장평가)가 없다 */
const PATH_RULES: Record<PathKey, EvaluatorRule[]> = { member: ['self', 'teamLead', 'executive'], lead: ['self', 'executive'] }

/** D-164: part = 'weights'(사원·팀장이 받는 평가·등급 인원 비율 — 가중치·기간 설정 탭) / 'exec'(임원 평가 배정 — 평가자 배정 탭) */
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
      if (rebuild) { c.assignments = buildAssignments(d, c); distributeExecs(d, c); applyVersions(d, c) }
    })
    setMsgFor(k, { ok: true, text: rebuild ? '저장하고 배정을 다시 만들었습니다.' : '저장했습니다.' })
  }
  /** 임원 평가 배정만 저장 */
  const saveExec = () => {
    update((d) => applyExecDraft(d, d.cycles.find((x) => x.id === cycle.id)!, execDraft))
    setExecDraft({})
    setMsgFor('exec', { ok: true, text: '저장했습니다.' })
  }
  const saveBtn = (k: PathKey) => (
    <div className="sec-save">
      {msgs[k] && <span className={`feedback ${msgs[k]!.ok ? 'ok' : 'fail'}`} role={msgs[k]!.ok ? 'status' : 'alert'}>{msgs[k]!.ok ? '✓' : '✕'} {msgs[k]!.text}</span>}
      <button className="btn primary small" disabled={!secDirty(k)} onClick={() => saveSec(k)}>저장</button>
    </div>
  )

  if (part === 'exec') return <Assignments cycle={live} locked={rulesChanged('member') || rulesChanged('lead')} execDraft={execDraft} setExecDraft={(x) => { setExecDraft(x); setMsgFor('exec', null) }} onSave={saveExec} msg={msgs.exec} />
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
  const s = useAppState()
  const [q, setQ] = useState('')
  const [team, setTeam] = useState('')
  const [note, setNote] = useState('') // 팀 전체 선택이 제출된 평가 때문에 일부만 반영됐을 때 짧은 안내
  const [open, setOpen] = useState<Record<string, boolean>>({}) // `${임원}|${팀}` → 펼침 (선택과 무관)
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
  const fixed = (r: Row) => r.st === 'submitted'
  /** 여러 대상자를 한 번에 바꾸기 — 다른 임원 담당·작성 중 평가는 한 번 확인. 제출된 평가는 건너뜀 */
  const setMany = (list: Row[], ex: string, ask = true) => {
    const ch = list.filter((r) => !fixed(r) && r.cur !== ex)
    if (!ch.length) return true
    if (ask) {
      const moving = ch.filter((r) => r.cur && ex)
      const drafts = ch.filter((r) => r.st === 'draft' && r.a && r.a.evaluatorId !== ex)
      const lines: string[] = []
      if (moving.length) lines.push(moving.length === 1 ? `${moving[0].t.name}은(는) ${name(moving[0].cur)} 담당입니다. ${name(ex)}에게 옮길까요?` : `${moving.length}명은 다른 임원 담당입니다(${moving.map((r) => r.t.name).join(', ')}). ${name(ex)}에게 옮길까요?`)
      if (drafts.length) lines.push(`작성 중인 평가 ${drafts.length}건(${drafts.map((r) => r.t.name).join(', ')})은 이전 임원의 기록으로 남기고${ex ? ', 새 담당 임원은 처음부터 작성합니다' : ''}.`)
      if (lines.length && !confirm(lines.join('\n'))) return false
    }
    const next = { ...execDraft }
    for (const r of ch) { if (ex === r.orig) delete next[r.t.employeeId]; else next[r.t.employeeId] = ex }
    setExecDraft(next)
    return true
  }
  return (
    <section className="panel exec-assign" aria-labelledby="exec-assign-title">
      <div className="panel-head row">
        <h2 id="exec-assign-title" style={{ margin: 0 }}>임원 평가 배정 <span className="muted">{rows.length}명</span></h2>
        <span className="spacer" />
        {unassigned.length > 0 && <span className="exec-load warn">미지정 {unassigned.length}명</span>}
        <div className="sec-save">
          {msg && <span className={`feedback ${msg.ok ? 'ok' : 'fail'}`} role={msg.ok ? 'status' : 'alert'}>{msg.ok ? '✓' : '✕'} {msg.text}</span>}
          <button className="btn primary small" disabled={locked || Object.keys(execDraft).length === 0} onClick={onSave}>저장</button>
        </div>
      </div>
      <div className="filters">
        <input type="search" placeholder="이름·팀 검색" aria-label="임원 평가 배정 대상자 검색" value={q} onChange={(e) => setQ(e.target.value)} />
        <select aria-label="임원 평가 배정 팀" value={team} onChange={(e) => setTeam(e.target.value)}>
          <option value="">전체 팀</option>
          {teams.map((x) => <option key={x}>{x}</option>)}
        </select>
        {/* D-166: '미지정만' 거르기 제거 */}
      </div>
      {unassigned.length > 0 && <p className="exec-free-note">미지정: {unassigned.map((r) => r.t.name).join(', ')} <span className="muted">— 담당 임원을 체크하기 전까지 임원평가 미완료</span></p>}
      {note && <p className="exec-free-note exec-note" role="status">{note}</p>}
      <div className="exec-cols">
        {execs.map((ex) => {
          const mine = rows.filter((r) => r.cur === ex.id)
          return (
            <section key={ex.id} className="exec-col" aria-label={`${ex.name} 임원 평가 배정`}>
              <header className="exec-col-head"><b>{ex.name}</b><span className="exec-n">{mine.length}명</span></header>
              {teams.map((tm) => {
                const all = rows.filter((r) => r.t.teamName === tm)
                const shown = all.filter(visible)
                if (!shown.length) return null
                const key = `${ex.id}|${tm}`
                const isOpen = !!open[key] || !!qq
                const sel = all.filter((r) => r.cur === ex.id).length
                const pick = shown.filter((r) => !fixed(r) || r.cur === ex.id) // 팀 전체 선택 대상: 보이는 사람만, 다른 임원에게 제출된 평가 제외
                // 팀 체크(D-087): 보이는 팀원이 모두 이 임원 담당일 때만 체크, 일부·없음은 빈 칸(부분 표시 없음 — 인원은 'n/m명'으로)
                const onAll = shown.length > 0 && shown.every((r) => r.cur === ex.id)
                return (
                  <div key={tm} className={`exec-team ${isOpen ? 'open' : ''}`}>
                    <div className="exec-team-head">
                      <input type="checkbox" aria-label={`${ex.name} ${tm} 전체 선택`} disabled={locked || !pick.some((r) => !fixed(r))} checked={onAll}
                        onChange={() => {
                          const to = onAll ? '' : ex.id
                          const skipped = shown.filter((r) => fixed(r) && r.cur !== to && (to || r.cur === ex.id))
                          if (setMany(pick, to) && skipped.length) setNote(`${tm}: ${skipped.map((r) => r.t.name).join(', ')}은(는) 바꿀 수 없어 그대로 두었습니다.`)
                          else setNote('')
                        }} />
                      <button type="button" className="exec-team-toggle" aria-expanded={isOpen} onClick={() => setOpen((o) => ({ ...o, [key]: !o[key] }))}>
                        <span>{tm}</span><span className="exec-team-n">{sel}/{all.length}명</span><span className="caret" aria-hidden>▾</span>
                      </button>
                    </div>
                    {isOpen && (
                      <ul className="exec-people">
                        {shown.map((r) => {
                          const on = r.cur === ex.id
                          const other = r.cur && !on ? name(r.cur) : ''
                          const lock = locked || fixed(r)
                          return (
                            <li key={r.t.employeeId} className={`${execDraft[r.t.employeeId] !== undefined ? 'changed' : ''} ${fixed(r) ? 'fixed' : ''}`}>
                              <label>
                                {fixed(r) && on
                                  // 이 임원이 제출한 평가: 체크 고정(회색 비활성 대신 진한 체크), 해제·이동 불가
                                  ? <input type="checkbox" className="locked-on" checked readOnly aria-disabled="true" aria-label={`${ex.name} 담당 ${r.t.name} (변경 불가)`} onClick={(e) => e.preventDefault()} />
                                  : <input type="checkbox" checked={on} disabled={lock} aria-label={`${ex.name} 담당 ${r.t.name}`} onChange={(e) => { setNote(''); setMany([r], e.target.checked ? ex.id : '') }} />}
                                <b>{r.t.name}</b><span className="muted">{targetPosition(s, cycle, r.t)}</span>
                              </label>
                              {/* D-163: '제출' 표시는 하지 않음(제출된 평가는 그대로 변경 불가 — 체크 고정) */}
                              {other && <span className="muted small">{other} 담당</span>}
                              {!fixed(r) && !r.cur && <span className="chip unassigned tag">미지정</span>}
                              {r.st === 'draft' && on && execDraft[r.t.employeeId] === undefined && <span className="muted small">작성 중</span>}
                              {r.noLead && <span className="chip draft tag">팀장 설정 필요</span>}
                            </li>
                          )
                        })}
                      </ul>
                    )}
                  </div>
                )
              })}
            </section>
          )
        })}
      </div>
    </section>
  )
}

/** 등급 인원 비율 — 평가자 화면 "내 등급 배정 현황"의 기준값(경고만). 모든 회차 공통 저장값을 그대로 편집 */
function GradeRatios() {
  const s = useAppState()
  const saved = s.policy.gradeRatios
  const G = ['A', 'B', 'C', 'D', 'E'] as const // E 등급(D-160)
  const [d, setD] = useState<Record<string, string>>(() => Object.fromEntries(G.map((g) => [g, String(saved[g] ?? 0)])))
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const vals = G.map((g) => Number(d[g]))
  const sum = vals.reduce((a, v) => a + (Number.isFinite(v) ? v : 0), 0)
  const dirty = G.some((g) => d[g] !== String(saved[g] ?? 0))
  const save = () => {
    if (G.some((g) => d[g].trim() === '' || !Number.isFinite(Number(d[g])) || Number(d[g]) < 0 || Number(d[g]) > 100)) return setMsg({ ok: false, text: '각 비율은 0~100 사이 숫자로 입력하세요.' })
    if (Math.abs(sum - 100) > 0.001) return setMsg({ ok: false, text: `합계가 ${+sum.toFixed(2)}%입니다. 100%가 되어야 합니다.` })
    update((x) => { G.forEach((g, i) => { x.policy.gradeRatios[g] = vals[i] }) })
    setMsg({ ok: true, text: '저장했습니다.' })
  }
  return (
    <section className="panel pad grade-ratio-panel">
      {/* 영역 제목 오른쪽에 이 영역만 저장(D-094) — 모든 회차 공통 값 */}
      <div className="sec-head">
        <h2>등급 인원 비율 <span className="muted">모든 회차 공통 · 평가자 화면의 등급 배정 현황에 사용</span></h2>
        <div className="sec-save">
          {msg && <span className={`feedback ${msg.ok ? 'ok' : 'fail'}`} role={msg.ok ? 'status' : 'alert'}>{msg.ok ? '✓' : '✕'} {msg.text}</span>}
          <button className="btn primary small" disabled={!dirty} onClick={save}>저장</button>
        </div>
      </div>
      <div className="row grade-ratio">
        {G.map((g) => (
          <label key={g} className="field">{g} (%)
            <input type="text" inputMode="decimal" className="no-spin" value={d[g]} onChange={(e) => { setD({ ...d, [g]: e.target.value }); setMsg(null) }} />
          </label>
        ))}
        <b className={Math.abs(sum - 100) < 0.001 ? 'good' : 'bad'}>합계 {+sum.toFixed(2)}%</b>
      </div>
    </section>
  )
}
