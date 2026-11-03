import { useState } from 'react'
import { update, useAppState } from '../../data/store'
import { useSelectedCycle } from '../../data/hooks'
import { can } from '../../domain/permissions'
import { cycleLabel } from '../../domain/cycle'
import {
  blendErrors, BLEND_START, deptKpi, indicatorErrors, indicatorResult, kpiEntry, kpiLocked, orgUnits, UNIT_LABEL, withUnit, type DeptKpi,
} from '../../domain/kpi'
import type { Cycle, FinalBlendItem, FinalBlendPlan, FinalPart, KpiIndicator, KpiUnit } from '../../domain/types'
import { FINAL_BLEND_EXAMPLE } from '../../domain/scoringV16'
import { Forbidden, Modal } from '../../components/ui'

const f1 = (n: number) => (Math.round(n * 10) / 10).toFixed(1)
/** 숫자 칸: 빈 칸 = 미입력(null), 숫자 아님 = NaN(검증에서 오류) */
const num = (v: string): number | null => (v.trim() === '' ? null : Number(v.replace(/,/g, '')))
const str = (v: number | null | undefined) => (v === null || v === undefined ? '' : String(v))

export default function Kpi() {
  const s = useAppState()
  const [cycle, selectCycle, cycles] = useSelectedCycle()
  if (!can(s.session.role, 'viewKpi')) return <Forbidden />
  return (
    <div className="page">
      <div className="page-head">
        <h1>팀 KPI 관리</h1>
        {cycle && (
          <div className="cycle-pick">
            <label>
              <span className="pick-label">평가 회차</span>
              <select value={cycle.id} onChange={(e) => selectCycle(e.target.value)}>
                {cycles.map((c) => <option key={c.id} value={c.id}>{cycleLabel(c)}</option>)}
              </select>
            </label>
            <span className="due">기준 기간 <b>{cycle.period || '미정'}</b></span>
          </div>
        )}
      </div>
      {!cycle ? <div className="panel pad empty-start"><p>평가 회차가 없습니다.</p></div> : <Body key={cycle.id} cycle={cycle} />}
    </div>
  )
}

function Body({ cycle }: { cycle: Cycle }) {
  const s = useAppState()
  const locked = kpiLocked(cycle)
  const editable = can(s.session.role, 'editKpi') && !locked
  const units = orgUnits(s, cycle) // 이 회차의 팀 (확정된 이전 회차는 그때의 단위)
  const [deptId, setDeptId] = useState(units[0]?.id ?? '')
  const dept = units.find((d) => d.id === deptId)
  return (
    <>
      {locked && <p className="save-note">확정된 평가라 KPI를 수정할 수 없습니다. 평가 관리에서 상태를 바꾼 뒤 수정하세요.</p>}
      {/* 개인평가 반영 = 회차 공통 설정 한 줄, 제목 아래·팀 목록/상세 위 (D-093) */}
      <BlendPanel cycle={cycle} editable={editable} />
      <div className="kpi-grid">
        <section className="panel" aria-labelledby="dept-list-title">
          <div className="panel-head"><h2 id="dept-list-title">팀별 KPI 점수</h2></div>
          <ul className="dept-list">
            {units.map((d) => {
              const k = deptKpi(s, cycle.id, d.id)
              return (
                <li key={d.id}>
                  <button className={`dept-row ${d.id === deptId ? 'on' : ''}`} aria-pressed={d.id === deptId} onClick={() => setDeptId(d.id)}>
                    <span className="dept-name">{d.name}{(k.mode === 'manual' || k.indicators.length > 0) && <small>{k.mode === 'manual' ? '직접 입력' : `지표 ${k.indicators.length}개`}</small>}</span>
                    <ScoreTag k={k} />
                  </button>
                </li>
              )
            })}
          </ul>
        </section>
        {dept && <DeptEditor key={dept.id} cycle={cycle} deptId={dept.id} deptName={dept.name} editable={editable} />}
      </div>
      <FinalPlan cycle={cycle} editable={editable} />
    </>
  )
}

function ScoreTag({ k }: { k: DeptKpi }) {
  if (k.score !== null) return <span className="dept-score">{f1(k.score)}<small>점</small></span>
  return <span className="chip stage todo">{k.status === 'empty' ? '지표 없음' : k.mode === 'manual' ? '미입력' : '설정 미완료'}</span>
}

/**
 * 팀 KPI 편집 (D-070). 점수 출처는 팀마다 하나만 적용된다(지표 계산 또는 팀 점수 직접 입력 — 합산하지 않음, D-042).
 * "+ 지표 추가" 하나에서 방식을 고르고, 다른 방식으로 저장하면 확인 후 적용 방식이 바뀐다. 바뀐 쪽 자료는 지우지 않고 "보관"으로 남긴다.
 */
function DeptEditor({ cycle, deptId, deptName, editable }: { cycle: Cycle; deptId: string; deptName: string; editable: boolean }) {
  const s = useAppState()
  const k = deptKpi(s, cycle.id, deptId)
  const [dialog, setDialog] = useState<Dialog | null>(null)
  const [msg, setMsg] = useState('')
  const blank: KpiIndicator = { id: '', cycleId: cycle.id, departmentId: deptId, name: '', unit: 'percent', direction: 'higher', target: null, actual: null, weight: null }
  const manualOn = k.mode === 'manual'
  const hasManual = k.manualScore !== null
  const hasInds = k.indicators.length > 0
  const use = (mode: 'manual' | 'indicators') => {
    const text = mode === 'manual'
      ? `직접 입력한 팀 점수(${k.manualScore}점)를 적용할까요? 등록한 지표는 지우지 않고 보관합니다.`
      : `지표 계산 점수를 적용할까요? 직접 입력한 팀 점수(${k.manualScore}점)는 지우지 않고 보관합니다.`
    if (!confirm(text)) return
    setKpiEntry(cycle.id, deptId, { mode })
    setMsg(mode === 'manual' ? '직접 입력 점수를 적용합니다.' : '지표 계산 점수를 적용합니다.')
  }
  const removeManual = () => {
    if (!confirm(`직접 입력한 팀 점수(${k.manualScore}점)를 삭제할까요?${manualOn ? (hasInds ? ' 등록된 지표 계산 점수가 적용됩니다.' : '') : ''}`)) return
    setKpiEntry(cycle.id, deptId, { score: null, mode: 'indicators' })
    setMsg('직접 입력 점수를 삭제했습니다.')
  }

  return (
    <section className="panel" aria-labelledby="dept-edit-title">
      {/* 상단 한 줄 = 같은 너비 세 칸: 팀 이름(+지표 개수) / 팀 KPI 점수 / 지표 추가 (D-092) */}
      <div className="kpi-head kpi-head3">
        <div className="kh-cell kh-name">
          <h2 id="dept-edit-title">{deptName}</h2>
          {(manualOn || k.indicators.length > 0) && <span className="muted kh-sub">{manualOn ? '팀 점수 직접 입력 적용' : `지표 ${k.indicators.length}개`}</span>}
        </div>
        <div className="kh-cell kpi-total">
          <span className="l">팀 KPI 점수</span>
          {k.score !== null ? <span className="n">{f1(k.score)}<small>점</small></span> : <span className="chip stage todo">{k.status === 'empty' ? '지표 없음' : manualOn ? '미입력' : '설정 미완료'}</span>}
          {k.score === null && k.reason && k.status !== 'empty' && !manualOn && <small className="reason">{k.reason}</small>}
        </div>
        <div className="kh-cell kh-act">
          {editable && <button className="btn primary" onClick={() => { setMsg(''); setDialog({ kind: 'add' }) }}>+ 지표 추가</button>}
        </div>
      </div>
      {msg && <p className="kpi-msg"><span className="feedback ok" role="status">✓ {msg}</span></p>}

      {(hasManual || manualOn) && (
        <div className={`kpi-manual-row ${manualOn ? 'on' : 'kept'}`}>
          <span className="tag-l">팀 점수 직접 입력</span>
          <b className="v">{hasManual ? `${f1(k.manualScore!)}점` : '미입력'}</b>
          <span className={`chip ${manualOn ? 'info' : 'na'} tag`}>{manualOn ? '적용 중' : '보관 · 미반영'}</span>
          <span className="spacer" />
          {editable && !manualOn && hasManual && <button className="btn small" onClick={() => use('manual')}>이 점수 적용</button>}
          {editable && <button className="btn small" onClick={() => { setMsg(''); setDialog({ kind: 'manual' }) }}>수정</button>}
          {editable && hasManual && <button className="btn small danger" onClick={removeManual}>삭제</button>}
        </div>
      )}

      {!hasInds ? (
        !hasManual && !manualOn && <div className="empty-start"><p>등록된 지표가 없습니다.</p></div>
      ) : (
        <>
          {manualOn && (
            <div className="kpi-kept-head">
              <span className="chip na tag">보관 · 미반영</span><span className="muted">아래 지표는 현재 팀 KPI 점수에 반영되지 않습니다.</span>
              <span className="spacer" />
              {editable && <button className="btn small" onClick={() => use('indicators')}>지표 계산 적용</button>}
            </div>
          )}
          {/* D-146: 지표 = 카드형(이름·수정/삭제 / 목표·실적·달성률·가중치 네 칸 / 평가 방향·환산점수) — 차장님이 좋다고 하신 방식. 계산·기능은 그대로 */}
          <div className={`kpi-inds ${manualOn ? 'kpi-kept' : ''}`}>
            {k.indicators.map(({ ind, r }) => (
              <article className="kpi-ind" key={ind.id} aria-label={ind.name}>
                <div className="ki-head">
                  <h3>{ind.name}</h3>
                  <span className="spacer" />
                  {editable && <>
                    <button className="btn small ki-btn" onClick={() => { setMsg(''); setDialog({ kind: 'indicator', ind }) }}><EditIc /> 수정</button>
                    <button className="btn small ki-btn" onClick={() => { if (confirm(`'${ind.name}' 지표를 삭제할까요?`)) update((d) => { d.kpiIndicators = d.kpiIndicators.filter((x) => x.id !== ind.id) }) }}><DelIc /> 삭제</button>
                  </>}
                </div>
                <div className="ki-stats">
                  <div className="ki-tile"><span className="l">목표</span><b>{withUnit(ind.target, ind.unit)}</b></div>
                  <div className="ki-tile"><span className="l">실적</span><b>{withUnit(ind.actual, ind.unit)}</b></div>
                  <div className="ki-tile rate"><span className="l">달성률</span><b>{r.status === 'targetMet' ? '목표 달성' : r.rate !== null ? `${f1(r.rate)}%` : <span className="bad">{r.message}</span>}</b></div>
                  <div className="ki-tile"><span className="l">가중치</span><b>{ind.weight === null ? <span className="bad">미입력</span> : `${ind.weight}%`}</b></div>
                </div>
                <p className="ki-cap">{ind.direction === 'higher' ? '높을수록 좋음 (실적 ÷ 목표)' : '낮을수록 좋음 (목표 ÷ 실적)'}<span className="ki-score">환산점수 <b>{r.score !== null ? f1(r.score) : '—'}</b></span></p>
              </article>
            ))}
            <p className="ki-sum">가중치 합계 <b className={k.weightSum !== null && Math.abs(k.weightSum - 100) < 0.001 ? 'good' : 'bad'}>{k.weightSum === null ? '미입력 있음' : `${+k.weightSum.toFixed(2)}%`}</b></p>
          </div>
        </>
      )}
      {dialog && <KpiModal dialog={dialog} cycle={cycle} deptId={deptId} blank={blank} k={k} onClose={() => setDialog(null)} onSaved={setMsg} />}
    </section>
  )
}

/** 팀 KPI 기록 갱신(없으면 만듦). 점수·적용 방식만 바꾸고 지표는 건드리지 않는다 */
function setKpiEntry(cycleId: string, deptId: string, patch: { mode?: 'manual' | 'indicators'; score?: number | null }) {
  update((d) => {
    const e = kpiEntry(d, cycleId, deptId)
    if (e) Object.assign(e, patch)
    else d.kpi.push({ cycleId, departmentId: deptId, score: null, ...patch })
  })
}

type Dialog = { kind: 'add' } | { kind: 'manual' } | { kind: 'indicator'; ind: KpiIndicator }
type Method = 'indicator' | 'manual'

/** "+ 지표 추가"(방식 선택) / 지표 수정 / 직접 입력 점수 수정 */
function KpiModal({ dialog, cycle, deptId, blank, k, onClose, onSaved }: { dialog: Dialog; cycle: Cycle; deptId: string; blank: KpiIndicator; k: DeptKpi; onClose: () => void; onSaved: (t: string) => void }) {
  const initial = dialog.kind === 'indicator' ? dialog.ind : blank
  const [method, setMethod] = useState<Method>(dialog.kind === 'manual' ? 'manual' : 'indicator')
  const [f, setF] = useState({ ...initial, targetS: str(initial.target), actualS: str(initial.actual), weightS: str(initial.weight) })
  const [manual, setManual] = useState(str(k.manualScore))
  const [errors, setErrors] = useState<string[]>([])
  const cur: KpiIndicator = { ...f, target: num(f.targetS), actual: num(f.actualS), weight: num(f.weightS) }
  const r = indicatorResult(cur)
  const adding = dialog.kind === 'add'
  const hasManual = k.manualScore !== null

  const saveIndicator = () => {
    const e = indicatorErrors(cur)
    setErrors(e)
    if (e.length) return
    // 새 지표를 추가하면 이 팀은 지표 계산을 적용. 직접 입력 점수가 적용 중이면 확인 후 보관(삭제하지 않음)
    const switching = adding && k.mode === 'manual'
    if (switching && hasManual && !confirm(`현재 직접 입력한 팀 점수(${k.manualScore}점)가 적용 중입니다.\n지표를 추가하면 지표 계산 점수를 적용하고, 직접 입력 점수는 지우지 않고 보관합니다. 계속할까요?`)) return
    update((d) => {
      const clean: KpiIndicator = { id: cur.id || `kpi-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, cycleId: cur.cycleId, departmentId: cur.departmentId, name: cur.name.trim(), unit: cur.unit, direction: cur.direction, target: cur.target, actual: cur.actual, weight: cur.weight }
      const i = d.kpiIndicators.findIndex((x) => x.id === clean.id)
      if (i >= 0) d.kpiIndicators[i] = clean
      else d.kpiIndicators.push(clean)
    })
    if (switching) setKpiEntry(cycle.id, deptId, { mode: 'indicators' })
    onSaved(adding ? (switching && hasManual ? '지표를 추가하고 지표 계산 점수를 적용합니다.' : '지표를 추가했습니다.') : '지표를 저장했습니다.')
    onClose()
  }
  const saveManual = () => {
    const v = num(manual)
    if (v === null) return setErrors(['팀 KPI 점수를 입력하세요.'])
    if (!Number.isFinite(v) || v < 0 || v > 100) return setErrors(['0~100 사이 숫자로 입력하세요.'])
    // 직접 입력 점수는 팀마다 하나 — 이미 있으면 그 값을 고친다(새로 쌓지 않음). 지표 계산이 적용 중이면 확인 후 지표는 보관
    if (k.mode === 'indicators' && k.indicators.length > 0 && !confirm(`등록된 지표 ${k.indicators.length}개의 계산 점수 대신 직접 입력 점수(${v}점)를 적용할까요?\n지표는 지우지 않고 보관합니다.`)) return
    setKpiEntry(cycle.id, deptId, { score: v, mode: 'manual' })
    onSaved(hasManual ? '직접 입력 점수를 수정했습니다.' : '직접 입력 점수를 적용합니다.')
    onClose()
  }
  const title = dialog.kind === 'indicator' ? '지표 수정' : dialog.kind === 'manual' ? '팀 점수 직접 입력' : '지표 추가'

  return (
    <Modal title={title} onClose={onClose}>
      {adding && (
        <fieldset className="field kpi-method">
          <legend>입력 방식</legend>
          <div className="row">
            <label className="check"><input type="radio" name="kpi-method" checked={method === 'indicator'} onChange={() => { setMethod('indicator'); setErrors([]) }} /> 목표·실적 입력</label>
            <label className="check"><input type="radio" name="kpi-method" checked={method === 'manual'} onChange={() => { setMethod('manual'); setErrors([]) }} /> 팀 점수 직접 입력{hasManual && <span className="muted"> (기존 {k.manualScore}점 수정)</span>}</label>
          </div>
        </fieldset>
      )}
      {method === 'manual' ? (
        <div className="grid form-grid">
          <label className="field">팀 KPI 점수 (0~100)
            <input type="text" inputMode="decimal" value={manual} autoFocus placeholder="예: 85" onChange={(e) => { setManual(e.target.value); setErrors([]) }} onKeyDown={(e) => e.key === 'Enter' && saveManual()} />
          </label>
        </div>
      ) : (
        <div className="grid form-grid">
          <label className="field">단위
            <select value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value as KpiUnit })}>
              {(Object.keys(UNIT_LABEL) as KpiUnit[]).map((u) => <option key={u} value={u}>{UNIT_LABEL[u]}</option>)}
            </select>
          </label>
          <label className="field" style={{ gridColumn: '1 / -1' }}>지표 이름<input type="text" value={f.name} autoFocus={!adding} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
          <fieldset className="field" style={{ gridColumn: '1 / -1' }}>
            <legend>평가 방향</legend>
            <div className="row">
              <label className="check"><input type="radio" name="dir" checked={f.direction === 'higher'} onChange={() => setF({ ...f, direction: 'higher' })} /> 높을수록 좋음</label>
              <label className="check"><input type="radio" name="dir" checked={f.direction === 'lower'} onChange={() => setF({ ...f, direction: 'lower' })} /> 낮을수록 좋음</label>
            </div>
          </fieldset>
          <label className="field">목표값<input type="text" inputMode="decimal" value={f.targetS} placeholder="미입력" onChange={(e) => setF({ ...f, targetS: e.target.value })} /></label>
          <label className="field">실적값<input type="text" inputMode="decimal" value={f.actualS} placeholder="미입력" onChange={(e) => setF({ ...f, actualS: e.target.value })} /></label>
          <label className="field">가중치 (%)<input type="text" inputMode="decimal" value={f.weightS} placeholder="미입력" onChange={(e) => setF({ ...f, weightS: e.target.value })} /></label>
          <div className="field kpi-preview" aria-live="polite">
            <span>달성률 <b>{r.status === 'targetMet' ? '목표 달성' : r.rate !== null ? `${f1(r.rate)}%` : '—'}</b></span>
            <span>환산점수 <b>{r.score !== null ? f1(r.score) : '—'}</b></span>
          </div>
        </div>
      )}
      {errors.length > 0 && <div className="feedback fail" role="alert">{errors.map((x) => <div key={x}>✕ {x}</div>)}</div>}
      <div className="row" style={{ marginTop: 14 }}>
        <span className="spacer" />
        <button className="btn primary" onClick={method === 'manual' ? saveManual : saveIndicator}>{dialog.kind === 'add' && method === 'indicator' ? '추가' : '저장'}</button>
      </div>
    </Modal>
  )
}

function BlendPanel({ cycle, editable }: { cycle: Cycle; editable: boolean }) {
  const saved = cycle.kpiBlend ?? { enabled: false, personal: null, kpi: null }
  const [on, setOn] = useState(saved.enabled)
  const [p, setP] = useState(str(saved.personal))
  const [k, setK] = useState(str(saved.kpi))
  const [errs, setErrs] = useState<string[]>([])
  const [ok, setOk] = useState('')
  const dirty = on !== saved.enabled || (on && (p !== str(saved.personal) || k !== str(saved.kpi)))
  const toggle = (v: boolean) => {
    setOn(v); setOk(''); setErrs([])
    if (v && p === '' && k === '') { setP(String(BLEND_START.personal)); setK(String(BLEND_START.kpi)) } // 최초 활성화 시작값(편집 가능)
  }
  const apply = () => {
    const b = { enabled: on, personal: num(p), kpi: num(k) }
    if (on) {
      const e = blendErrors(b)
      setErrs(e)
      if (e.length) return
    }
    update((d) => { d.cycles.find((c) => c.id === cycle.id)!.kpiBlend = on ? b : { ...saved, enabled: false } })
    setOk(on ? '적용했습니다. 결과 화면 점수에 반영됩니다.' : '반영을 껐습니다.')
  }
  const pv = num(p), kv = num(k)

  return (
    // 한 줄 설정(D-093): 제목 · 반영 체크 · 개인평가 비율 · + · 팀 KPI 비율 · 적용 — 카드 없이 본문 위, 계산식은 바로 아래
    <section className="blend blend-plain blend-row" aria-labelledby="blend-title">
      {/* 기능 묶음 셋: 제목·체크 / 비율 두 칸(+) / 적용·결과 — 묶음 사이 간격 > 라벨·입력 간격, 모두 입력란 높이 기준 세로 가운데 (D-094) */}
      <div className="blend-line">
        <div className="bl-g bl-title">
          <h2 id="blend-title">개인평가 반영</h2>
          <label className="check big"><input type="checkbox" checked={on} disabled={!editable} onChange={(e) => toggle(e.target.checked)} /> 팀 KPI를 개인평가에 반영</label>
        </div>
        {on && <div className="bl-g blend-inputs">
          <label className="field blend-f"><span className="bl-l">개인평가 비율 (%)</span><input type="text" inputMode="decimal" value={p} disabled={!editable} onChange={(e) => { setP(e.target.value); setOk('') }} /></label>
          <span className="plus" aria-hidden>+</span>
          <label className="field blend-f"><span className="bl-l">팀 KPI 비율 (%)</span><input type="text" inputMode="decimal" value={k} disabled={!editable} onChange={(e) => { setK(e.target.value); setOk('') }} /></label>
        </div>}
        <div className="bl-g bl-apply">
          <button className="btn primary blend-btn" disabled={!editable || !dirty} onClick={apply}>적용</button>
        </div>
        {/* 계산식: 적용 오른쪽 남는 공간(D-095) — 좁으면 다음 줄, 길면 이 칸 안에서 줄바꿈 */}
        {on && pv !== null && kv !== null && Number.isFinite(pv) && Number.isFinite(kv) && (
          <p className="bl-g formula">KPI 반영 후 점수 = 개인평가 기초 점수 × {pv}% + 팀 KPI 점수 × {kv}%</p>
        )}
      </div>
      {/* 적용 결과는 설정 줄 아래 짧게 — 계산식·입력 위치를 밀지 않음 */}
      {ok && <p className="bl-ok"><span className="feedback ok" role="status">✓ {ok}</span></p>}
      {errs.length > 0 && <div className="feedback fail" role="alert">{errs.map((x) => <div key={x}>✕ {x}</div>)}</div>}
    </section>
  )
}

/**
 * 직급별 최종 반영 비율(D-103, 자문 예시) — 요소별 켜기·비율 입력·활성 합계 100% 검증·저장만 한다.
 * 점수에는 아직 적용하지 않음: 사원 '자기평가 80%'의 의미 미정(기존 계산 유지). 상향평가 — 팀장: 팀원→팀장평가는 있으나(D-114) 점수 반영 방식 미정, 임원: 팀장→임원 상향평가는 아직 없음(D-149)
 */
const PART_TEXT: Record<FinalPart, string> = { personal: '자기평가(의미 미정)', self: '자기평가', kpi: '팀 KPI', upward: '상향평가' }
/** 상향평가 표시(D-149): 팀장 = 팀원→팀장평가(있음, 반영 방식 미정), 임원 = 팀장→임원 상향평가(아직 없음 — 켤 수 없음) */
const partLabel = (tier: keyof FinalBlendPlan, key: FinalPart) => key !== 'upward' ? PART_TEXT[key] : tier === 'lead' ? '팀원→팀장평가(반영 방식 미정)' : '팀장→임원 상향평가(아직 없음)'
const TIER_TEXT = { member: '사원', lead: '팀장', exec: '임원' } as const
function FinalPlan({ cycle, editable }: { cycle: Cycle; editable: boolean }) {
  const saved = cycle.finalBlendPlan ?? FINAL_BLEND_EXAMPLE()
  const [d, setD] = useState<FinalBlendPlan>(() => structuredClone(saved))
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const dirty = JSON.stringify(d) !== JSON.stringify(saved)
  const sumOf = (items: FinalBlendItem[]) => +items.filter((x) => x.on).reduce((a, x) => a + (x.pct ?? 0), 0).toFixed(2)
  const tierErr = (items: FinalBlendItem[]) => items.some((x) => x.on && (x.pct === null || !(x.pct >= 0 && x.pct <= 100))) ? '비율은 0~100으로 입력하세요' : !items.some((x) => x.on) ? '켜진 요소 없음' : Math.abs(sumOf(items) - 100) > 0.001 ? `활성 합계 ${sumOf(items)}% — 100%가 되어야 적용 가능` : ''
  const setItem = (tier: keyof FinalBlendPlan, i: number, patch: Partial<FinalBlendItem>) => { setD((x) => ({ ...x, [tier]: x[tier].map((it, k) => (k === i ? { ...it, ...patch } : it)) })); setMsg(null) }
  const save = () => {
    if ((['member', 'lead', 'exec'] as const).some((t) => d[t].some((x) => x.pct !== null && !(x.pct >= 0 && x.pct <= 100)))) return setMsg({ ok: false, text: '비율은 0~100으로 입력하세요.' })
    update((x) => { x.cycles.find((c) => c.id === cycle.id)!.finalBlendPlan = structuredClone(d) })
    setMsg({ ok: true, text: '저장했습니다(점수에는 아직 적용하지 않음).' })
  }
  return (
    <section className="final-plan open" aria-labelledby="fp-title">
      {/* D-149: 접기 없이 제목과 항목을 바로 표시 */}
      <h3 id="fp-title" className="fp-title">직급별 최종 반영 비율 <span className="muted">자문 예시 · 적용 보류</span></h3>
      <table className="tbl final-plan-tbl">
        <thead><tr><th>직급</th><th>반영 요소</th><th>활성 합계</th></tr></thead>
        <tbody>
          {(['member', 'lead', 'exec'] as const).map((tier) => {
            const err = tierErr(d[tier])
            return (
              <tr key={tier}>
                <td><b>{TIER_TEXT[tier]}</b></td>
                <td>
                  <div className="fp-items">
                    {d[tier].map((it, i) => (
                      <label key={it.key} className="fp-item">
                        <input type="checkbox" checked={it.on} disabled={!editable || (it.key === 'upward' && tier === 'exec')} onChange={(e) => setItem(tier, i, { on: e.target.checked })} />
                        {partLabel(tier, it.key)}
                        <input type="text" inputMode="decimal" aria-label={`${TIER_TEXT[tier]} ${PART_TEXT[it.key]} 비율`} disabled={!editable} value={it.pct ?? ''} onChange={(e) => setItem(tier, i, { pct: e.target.value === '' ? null : Number(e.target.value) })} />%
                      </label>
                    ))}
                  </div>
                </td>
                <td><span className={err ? 'bad' : 'good'}>{sumOf(d[tier])}%</span>{err && <div className="muted small">{err}</div>}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <div className="fp-foot">
        <span className="muted small">사원 ‘자기평가’의 의미와 상향평가 반영 방식이 정해지기 전까지, 점수 계산은 위 ‘개인평가 반영’(기존 방식)을 사용합니다.</span>
        <span className="spacer" />
        {msg && <span className={`feedback ${msg.ok ? 'ok' : 'fail'}`} role={msg.ok ? 'status' : 'alert'}>{msg.ok ? '✓' : '✕'} {msg.text}</span>}
        <button className="btn small primary" disabled={!editable || !dirty} onClick={save}>저장</button>
      </div>
    </section>
  )
}

const EditIc = () => (
  <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden focusable="false"><path d="M10.9 2.2a1.6 1.6 0 0 1 2.3 0l.6.6a1.6 1.6 0 0 1 0 2.3l-7.6 7.6-3.3.8.8-3.3 7.2-8z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" /><path d="M9.6 3.6l2.8 2.8" stroke="currentColor" strokeWidth="1.5" /></svg>
)
const DelIc = () => (
  <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden focusable="false"><path d="M4 4l8 8M12 4l-8 8" stroke="#d8343b" strokeWidth="1.8" strokeLinecap="round" /></svg>
)
