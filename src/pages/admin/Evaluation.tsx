import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { update, useAppState } from '../../data/store'
import { useSelectedCycle } from '../../data/hooks'
import { confirmLeave } from '../../data/dirty'
import { can } from '../../domain/permissions'
import { createCycle, cycleLabel, DEFAULT_TEMPLATE_BY_JOB } from '../../domain/cycle'
import { isEvalTarget } from '../../domain/org'
import { Forbidden, Modal } from '../../components/ui'
import EvalSettings from './EvalSettings'
import EvalQuestions from './EvalQuestions'
import EvalAssign from './EvalAssign'

export type EvalTab = 'settings' | 'questions' | 'assign' | 'setup'
// 탭(D-164 → D-198): 문항 관리 → 평가 설정 → 평가자 배정(평가 참여자 + 임원 평가 배정) → 가중치·등급(사원·팀장이 받는 평가 + 등급 인원 비율). 처음 들어오면 문항 관리
// D-198: 문항 관리 → 평가 설정(평가 복제·삭제·새 평가 + 기본 정보) → 평가자 배정 → 가중치·등급(단계 반영 비율 + 등급 인원 비율)
const TABS: [EvalTab, string][] = [['questions', '문항 관리'], ['setup', '평가 설정'], ['assign', '평가자 배정'], ['settings', '가중치·등급']]

export default function Evaluation() {
  const s = useAppState()
  const [params, setParams] = useSearchParams()
  const [cycle, selectCycle, cycles] = useSelectedCycle()
  const [creating, setCreating] = useState(false)
  if (!can(s.session.role, 'manageCycles')) return <Forbidden />
  const tab = (TABS.some(([k]) => k === params.get('tab')) ? params.get('tab') : 'questions') as EvalTab
  const goTab = (k: EvalTab) => { if (k !== tab && confirmLeave()) setParams({ tab: k }) }
  const pick = (id: string) => { if (confirmLeave()) selectCycle(id) }

  return (
    <div className={`page eval-page eval-${tab}`}>
      <div className="page-head">
        <h1>평가 관리</h1>
        {cycle && (
          <div className="cycle-pick">
            <label>
              <span className="pick-label">평가 회차</span>
              <select value={cycle.id} onChange={(e) => pick(e.target.value)}>
                {cycles.map((c) => <option key={c.id} value={c.id}>{cycleLabel(c)}</option>)}
              </select>
            </label>
            <span className="due">마감 <b>{cycle.dueDate || '미정'}</b></span>
          </div>
        )}
      </div>
      {!cycle ? (
        <div className="panel pad empty-start">
          <p>아직 만든 평가가 없습니다.</p>
          <button className="btn primary" onClick={() => setCreating(true)}>+ 평가 만들기</button>
        </div>
      ) : (
        <>
          <div className="tabs" role="tablist" aria-label="평가 관리">
            {TABS.map(([k, label]) => (
              <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => goTab(k)}>{label}</button>
            ))}
          </div>
          {tab === 'setup' && <EvalSettings key={cycle.id} cycle={cycle} onCreate={() => setCreating(true)} onSelect={selectCycle} part="info" />}
          {tab === 'settings' && <EvalAssign key={`w-${cycle.id}`} cycle={cycle} part="weights" />}
          {tab === 'questions' && <EvalQuestions key={cycle.id} cycle={cycle} />}
          {tab === 'assign' && <>
            <EvalSettings key={cycle.id} cycle={cycle} onCreate={() => setCreating(true)} onSelect={selectCycle} part="people" />
            <EvalAssign key={`e-${cycle.id}`} cycle={cycle} part="exec" />
          </>}
        </>
      )}
      {creating && <NewEvaluation onClose={() => setCreating(false)} onCreated={(id) => { setCreating(false); selectCycle(id); setParams({ tab: 'setup' }) }} />}
    </div>
  )
}

/** 새 평가: 기본 문항으로 시작, 대상자는 평가 대상 직원 전체(설정 탭에서 조정), 반영 비율은 미입력 */
function NewEvaluation({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const s = useAppState()
  const [name, setName] = useState('')
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [due, setDue] = useState('')
  const [err, setErr] = useState('')
  const create = () => {
    if (!name.trim()) return setErr('평가 이름을 입력하세요.')
    if (start && end && start > end) return setErr('평가 대상 기간의 시작일이 종료일보다 늦습니다.')
    let id = ''
    update((d) => {
      const tpl = d.templates.some((t) => t.id === DEFAULT_TEMPLATE_BY_JOB.office) ? DEFAULT_TEMPLATE_BY_JOB : (() => {
        const first = d.templates.find((t) => !t.locked) ?? d.templates[0]
        return { office: first.id, production: first.id }
      })()
      const c = createCycle(d, {
        name: name.trim(), period: start || end ? `${start} ~ ${end}` : '', dueDate: due, presetId: 'A',
        templateByJob: tpl, targetIds: d.employees.filter((e) => e.active && isEvalTarget(e)).map((e) => e.id),
      })
      d.cycles.push(c)
      id = c.id
    })
    onCreated(id)
  }
  return (
    <Modal title="새 평가 만들기" onClose={onClose}>
      <div className="grid form-grid">
        <label className="field" style={{ gridColumn: '1 / -1' }}>평가 이름<input type="text" value={name} placeholder="예: 2027 상반기 인사평가" onChange={(e) => setName(e.target.value)} /></label>
        <label className="field">평가 대상 기간 시작<input type="date" value={start} onChange={(e) => setStart(e.target.value)} /></label>
        <label className="field">평가 대상 기간 종료<input type="date" value={end} onChange={(e) => setEnd(e.target.value)} /></label>
        <label className="field">응답 제출 마감일<input type="date" value={due} onChange={(e) => setDue(e.target.value)} /></label>
      </div>
      <p className="muted" style={{ marginTop: 10 }}>대상자 {s.employees.filter((e) => e.active && isEvalTarget(e)).length}명으로 시작합니다. 만든 뒤 대상자·문항·평가자를 바꿀 수 있습니다.</p>
      {err && <p className="feedback fail" role="alert">✕ {err}</p>}
      <div className="row" style={{ marginTop: 12 }}><span className="spacer" /><button className="btn primary" onClick={create}>만들기</button></div>
    </Modal>
  )
}
