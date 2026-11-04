import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { update, useAppState } from '../../data/store'
import { confirmLeave, useDirty } from '../../data/dirty'
import { applyParticipation, assignmentProblems, cloneCycle, cycleLabel, deleteCycle, participation } from '../../domain/cycle'
import { selfApplies } from '../../domain/progress'
import { isEvalTarget, tierOf, TIERS } from '../../domain/org'
import type { Cycle, CycleStatus, Employee } from '../../domain/types'
import { Modal, SecToggle } from '../../components/ui'
import { positionName } from '../../domain/catalog'
import { syncCycle } from '../../domain/cycleSync'

const STATUSES: CycleStatus[] = ['준비', '진행', '마감', '확정']

function splitPeriod(p: string): [string, string] {
  const m = p.match(/^\s*(\d{4}-\d{2}-\d{2})?\s*~\s*(\d{4}-\d{2}-\d{2})?\s*$/)
  return m ? [m[1] ?? '', m[2] ?? ''] : ['', '']
}

type Form = { name: string; start: string; end: string; due: string; status: CycleStatus; join: string[]; self: Record<string, boolean> }

/** D-164: part = 'info'(기본 정보 — 평가 설정 탭, D-198) / 'people'(평가 참여자 — 평가자 배정 탭 맨 위). 저장은 같은 폼(보이지 않는 부분은 그대로) */
export default function EvalSettings({ cycle, onCreate, onSelect, part }: { cycle: Cycle; onCreate: () => void; onSelect: (id: string) => void; part: 'info' | 'people' }) {
  const s = useAppState()
  const [ps, pe] = splitPeriod(cycle.period)
  const emp = (id: string) => s.employees.find((e) => e.id === id)
  // 참여자 후보 = 재직 중인 평가 대상 직원 + 재직 임원 + 이미 이 회차에 들어 있는 사람 (직원 ID 기준 한 번씩)
  // D-205: 재직 중인 사람만 보이고 셈(진행 현황 전체 대상자와 같게). 퇴사 처리된 이전 대상자는 숨기되 회차 기록·응답은 그대로(저장에서도 건드리지 않음)
  const people = s.employees.filter((e) => e.active && (isEvalTarget(e) || e.isExecutive || cycle.targets.some((t) => t.employeeId === e.id)))
  /** 자기평가 스위치 = 현재 직급(조직 관리 기준)이 팀장·임원인 사람만 (D-077). 사원은 스위치 없이 자기평가 필수 */
  const configurable = (e: Employee) => tierOf(s, e) !== '사원'
  const selfNow = (e: Employee) => {
    const t = cycle.targets.find((x) => x.employeeId === e.id)
    return t ? selfApplies(cycle, t) : cycle.selfEval?.[e.id] ?? !e.isExecutive
  }
  const initial = useMemo<Form>(() => ({
    name: cycleLabel(cycle), start: ps, end: pe, due: cycle.dueDate, status: cycle.status,
    join: [...participation(s, cycle)].sort(),
    self: Object.fromEntries(people.filter(configurable).map((e) => [e.id, selfNow(e)])),
  }), [cycle, s.employees]) // eslint-disable-line react-hooks/exhaustive-deps
  const [f, setF] = useState<Form>(initial)
  // 저장 직후에는 저장된 상태(막힌 해제 포함)로 폼을 맞춘다 → 되돌리기 = 마지막 저장 상태
  const resync = useRef(false)
  useEffect(() => { if (resync.current) { resync.current = false; setF(initial) } }, [initial])
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [cloning, setCloning] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [peopleOpen, setPeopleOpen] = useState(false)
  // 저장 완료 메시지는 잠시 뒤 사라짐(오류·일부만 저장 안내는 다음 동작까지 유지)
  useEffect(() => { if (!msg?.ok) return; const t = setTimeout(() => setMsg(null), 3500); return () => clearTimeout(t) }, [msg])
  // 고정 위치 = 상단 내비게이션 바로 아래 (헤더 높이는 화면 폭에 따라 다름)
  useEffect(() => {
    const h = document.querySelector('.admin-header')
    if (!h) return
    const set = () => document.documentElement.style.setProperty('--hdr-h', `${Math.round(h.getBoundingClientRect().height)}px`)
    set()
    const ro = new ResizeObserver(set); ro.observe(h)
    return () => ro.disconnect()
  }, [])
  const dirty = JSON.stringify({ ...f, join: [...f.join].sort() }) !== JSON.stringify(initial)
  useDirty(dirty)
  const locked = cycle.status === '확정' // 확정 회차의 참여·자기평가는 바꾸지 않음
  const missing = assignmentProblems(s, cycle).filter((p) => p.includes('평가자 없음')).map((p) => p.replace(/: 평가자 없음$/, ''))

  // 카드 = 네 팀 + "임원"(이 화면에서만 쓰는 직급 묶음 — 조직의 팀이 아님). 임원은 소속 팀 카드에 다시 나오지 않는다
  const teamName = (id: string) => s.teams.find((t) => t.id === id)?.name ?? ''
  const teamIds = [...new Set(people.filter((e) => !e.isExecutive).map((e) => e.teamId))].sort((a, b) => teamName(a).localeCompare(teamName(b), 'ko'))
  const groups: { key: string; title: string; list: Employee[] }[] = [
    ...teamIds.map((tid) => ({ key: tid, title: teamName(tid), list: people.filter((e) => !e.isExecutive && e.teamId === tid) })),
    { key: 'exec', title: '임원', list: people.filter((e) => e.isExecutive) },
  ].map((g) => ({ ...g, list: g.list.sort((a, b) => TIERS.indexOf(tierOf(s, a)) - TIERS.indexOf(tierOf(s, b)) || a.name.localeCompare(b.name, 'ko')) })).filter((g) => g.list.length > 0)
  const joined = (id: string) => f.join.includes(id)
  const setJoin = (id: string, on: boolean) => setF({ ...f, join: on ? [...new Set([...f.join, id])] : f.join.filter((x) => x !== id) })
  const setJoinMany = (ids: string[], on: boolean) => setF({ ...f, join: on ? [...new Set([...f.join, ...ids])] : f.join.filter((x) => !ids.includes(x)) }) // 팀 단위 체크(D-203)
  const setSelf = (id: string, on: boolean) => setF({ ...f, self: { ...f.self, [id]: on } })

  const save = () => {
    setMsg(null)
    if (!f.name.trim()) return setMsg({ ok: false, text: '평가 이름을 입력하세요.' })
    if (f.start && f.end && f.start > f.end) return setMsg({ ok: false, text: '평가 대상 기간의 시작일이 종료일보다 늦습니다.' })
    // 영향이 있는 자기평가 변경만 짧게 확인: 응답 있는 자기평가 끄기 / 3단계가 이미 시작된 사람의 자기평가 켜기
    const changed = Object.entries(f.self).filter(([id, on]) => on !== initial.self[id] && joined(id))
    const offAnswered = changed.filter(([id, on]) => !on && cycle.assignments.some((a) => a.targetId === id && a.direction === 'self' && s.responses[a.id])).map(([id]) => emp(id)?.name)
    const onStarted = changed.filter(([id, on]) => on && cycle.assignments.some((a) => a.targetId === id && a.direction !== 'self' && !a.excluded && s.responses[a.id])).map(([id]) => emp(id)?.name)
    const notes = [
      offAnswered.length ? `자기평가 응답이 있는 ${offAnswered.join(', ')}: 끄면 응답은 보존되고 진행·점수에서 빠집니다.` : '',
      onStarted.length ? `3단계 평가가 시작된 ${onStarted.join(', ')}: 켜면 점수에 1단계가 포함되고, 남은 3단계는 자기평가 제출 후 열립니다.` : '',
    ].filter(Boolean)
    if (notes.length && !confirm(`${notes.join('\n')}\n저장할까요?`)) return
    let blocked: string[] = []
    update((d) => {
      const c = d.cycles.find((x) => x.id === cycle.id)!
      // 표시용으로 정리된 이름과 같으면 저장된 원래 이름(내부 연결)을 그대로 둔다
      if (f.name.trim() !== cycleLabel(c)) c.name = f.name.trim()
      c.period = f.start || f.end ? `${f.start} ~ ${f.end}` : c.period && !ps && !pe ? c.period : ''
      c.dueDate = f.due
      if (!locked) { blocked = applyParticipation(d, c.id, f.join, f.self); syncCycle(d, c) } // 참여·자기평가는 같은 저장에서 (상태 변경보다 먼저), 새 참여자는 현재 조직 기준으로 배정 연결 (D-081)
      c.status = f.status
    })
    resync.current = true
    if (blocked.length) setMsg({ ok: false, text: `저장했습니다. 단, 평가 배정이나 응답이 있는 ${blocked.join(', ')}은(는) 참여를 해제하지 않았습니다.` })
    else setMsg({ ok: true, text: '저장했습니다.' })
  }

  return (
    <>
      {/* 저장·되돌리기는 하위 탭 바로 아래 오른쪽, 스크롤해도 상단 내비게이션 아래에 붙어 보임 (D-080). 평가 복제·새 평가는 같은 줄 왼쪽 */}
      {/* D-166: 평가 참여자(평가자 배정 탭)는 위쪽 저장·되돌리기 줄 없이 영역 제목 줄의 저장 버튼만 */}
      {part === 'info' && <div className="tab-actions settings-bar">
        {part === 'info' && <>
          <button className="btn" onClick={() => confirmLeave() && setCloning(true)}>평가 복제</button>
          {/* D-192: 평가 삭제(빨간 테두리) — 확정된 평가는 지울 수 없음 */}
          <button className="btn danger" disabled={cycle.status === '확정'} title={cycle.status === '확정' ? '확정된 평가는 삭제할 수 없어요' : undefined} onClick={() => confirmLeave() && setDeleting(true)}>평가 삭제</button>
          <button className="btn" onClick={() => confirmLeave() && onCreate()}>+ 새 평가</button>
        </>}
        <span className="spacer" />
        {msg && <span className={`feedback ${msg.ok ? 'ok' : 'fail'}`} role={msg.ok ? 'status' : 'alert'}>{msg.ok ? '✓' : '✕'} {msg.text}</span>}
        <div className="row save-actions">
          <button className="btn" disabled={!dirty} onClick={() => { setF(initial); setMsg(null) }}>되돌리기</button>
          <button className="btn primary" disabled={!dirty} onClick={save}>저장</button>
        </div>
      </div>}
      {part === 'info' && <section className="panel pad">
        <h2>기본 정보</h2>
        <div className="grid settings-grid">
          <label className="field wide">평가 이름<input type="text" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
          <label className="field">상태
            <select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as CycleStatus })}>
              {STATUSES.map((v) => <option key={v}>{v}</option>)}
            </select>
          </label>
          <fieldset className="field period">
            <legend>평가 대상 기간</legend>
            <div className="row">
              <input type="date" aria-label="평가 대상 기간 시작" value={f.start} onChange={(e) => setF({ ...f, start: e.target.value })} />
              <span>~</span>
              <input type="date" aria-label="평가 대상 기간 종료" value={f.end} onChange={(e) => setF({ ...f, end: e.target.value })} />
            </div>
          </fieldset>
          <label className="field">응답 제출 마감일<input type="date" value={f.due} onChange={(e) => setF({ ...f, due: e.target.value })} /></label>
        </div>
      </section>}

      {part === 'people' && <section className="panel pad">
        <div className="row">
          {/* D-202: 큰 토글 — 처음엔 접힘, 제목이나 화살표를 누르면 아래 목록 */}
          <h2 style={{ margin: 0 }}><button type="button" className="sec-title-btn" onClick={() => setPeopleOpen(!peopleOpen)}>평가 참여자 <span className="muted">{f.join.filter((id) => people.some((e) => e.id === id)).length}명</span></button></h2>
          <span className="spacer" />
          {/* D-207: 모두 선택·모두 해제 버튼 없앰(팀 체크·사람 체크로) */}
          {part === 'people' && <div className="sec-save">
            {msg && <span className={`feedback ${msg.ok ? 'ok' : 'fail'}`} role={msg.ok ? 'status' : 'alert'}>{msg.ok ? '✓' : '✕'} {msg.text}</span>}
            <button className="btn primary small" disabled={!dirty} onClick={save}>저장</button>
          </div>}
          <SecToggle open={peopleOpen} onClick={() => setPeopleOpen(!peopleOpen)} label="평가 참여자" />
        </div>
        {peopleOpen && <>
        {locked && <p className="muted">확정된 평가라 참여자를 바꿀 수 없습니다.</p>}
        {/* 실제 담당자가 없는 평가(팀장 없는 팀 등) — 임의 담당자를 만들지 않고 짧게 알림 (D-081) */}
        {missing.length > 0 && (
          <p className="feedback fail missing-eval" role="alert">⚠ 평가자 없음 {missing.length}건: {missing.slice(0, 4).join(', ')}{missing.length > 4 ? ` 외 ${missing.length - 4}건` : ''} — 조직 관리에서 팀장을 지정하거나 <Link to="/admin/evaluation?tab=assign">평가자 배정</Link>에서 지정하세요.</p>
        )}
        <div className="target-teams">
          {groups.map((g) => (
            <div key={g.key} className={`target-team ${g.key === 'exec' ? 'exec-group' : ''}`} role="group" aria-label={g.title}>
              {/* D-203: 팀 이름 앞 체크 = 그 팀 모두 참여/해제(일부만 참여면 중간 표시) */}
              <div className="tt-head">{(() => { const n = g.list.filter((e) => joined(e.id)).length; return (
                <label className="tt-all"><input type="checkbox" disabled={locked} aria-label={`${g.title} 전체 참여`} checked={n === g.list.length && n > 0} ref={(el) => { if (el) el.indeterminate = n > 0 && n < g.list.length }} onChange={(x) => setJoinMany(g.list.map((e) => e.id), x.target.checked)} /><b>{g.title}</b><span className="muted">{n}/{g.list.length}명</span></label>
              ) })()}</div>
              {/* D-156: 열 이름 '참여'는 표시하지 않음(빈 칸으로 자리만 유지 — 자기평가는 오른쪽 그대로) */}
              <div className="tt-cols" aria-hidden><span />{g.list.some(configurable) && <span>자기평가</span>}</div>
              <ul className="target-list">
                {g.list.map((e) => {
                  const on = joined(e.id)
                  const can = configurable(e)
                  const snap = cycle.targets.find((x) => x.employeeId === e.id)
                  const mismatch = !!snap && !!(snap.isTeamLead || snap.isExecutive) && tierOf(s, e) === '사원' // 회차 스냅샷은 팀장, 현재 조직은 사원 (평가 경로는 회차 기준 유지)
                  return (
                    <li key={e.id} className={`p-row ${on ? 'on' : ''}`}>
                      <label className="p-who">
                        <input type="checkbox" checked={on} disabled={locked} aria-label={`${e.name} 참여`} onChange={(x) => setJoin(e.id, x.target.checked)} />
                        <span className="p-name">{e.name}</span>
                        <span className="muted p-tier">{positionName(s, e)}</span>
                        {mismatch && <span className="chip draft tag" title="지금 직급과 맞지 않는 평가 업무가 남아 있어요(직급·팀장을 바꾸기 전에 써 둔 평가)">⚠ 배정 확인 필요</span>}
                      </label>
                      {can && (
                        <button type="button" role="switch" aria-checked={!!f.self[e.id]} aria-label={`${e.name} 자기평가`} className={`p-switch ${f.self[e.id] ? 'on' : ''}`}
                          disabled={locked || !on} onClick={() => setSelf(e.id, !f.self[e.id])}><span aria-hidden /></button>
                      )}
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}
        </div>
        </>}
      </section>}

      {deleting && <DeleteModal cycle={cycle} onClose={() => setDeleting(false)} onDone={(id) => { setDeleting(false); if (id) onSelect(id) }} />}
      {cloning && <CloneModal cycle={cycle} onClose={() => setCloning(false)} onDone={(id) => { setCloning(false); onSelect(id) }} />}
    </>
  )
}

function DeleteModal({ cycle, onClose, onDone }: { cycle: Cycle; onClose: () => void; onDone: (nextId: string | null) => void }) {
  const s = useAppState()
  const answered = cycle.assignments.filter((a) => s.responses[a.id]).length
  const go = () => {
    let next: string | null = null
    update((d) => {
      if (!deleteCycle(d, cycle.id)) return
      next = (d.cycles.find((x) => x.status === '진행') ?? d.cycles[0])?.id ?? null
    })
    onDone(next)
  }
  return (
    <Modal title="평가 삭제" onClose={onClose}>
      <p><b>{cycleLabel(cycle)}</b>을(를) 삭제할까요?</p>
      <p className="muted" style={{ marginTop: 8 }}>이 평가의 문항·평가자 배정·응답{answered ? `(${answered}건)` : ''}·KPI·점수 보정·리포트 기록이 함께 지워지고 되돌릴 수 없어요. 직원·조직 정보와 다른 평가는 그대로예요.</p>
      <div className="row" style={{ marginTop: 14 }}><span className="spacer" /><button className="btn" onClick={onClose}>취소</button><button className="btn danger" onClick={go}>삭제</button></div>
    </Modal>
  )
}

function CloneModal({ cycle, onClose, onDone }: { cycle: Cycle; onClose: () => void; onDone: (id: string) => void }) {
  const [name, setName] = useState(`${cycleLabel(cycle)} (복제)`)
  const go = () => {
    if (!name.trim()) return
    let id = ''
    update((d) => {
      const c = cloneCycle(d, d.cycles.find((x) => x.id === cycle.id)!, name.trim())
      d.cycles.push(c)
      id = c.id
    })
    onDone(id)
  }
  return (
    <Modal title="평가 복제" onClose={onClose}>
      <label className="field">새 평가 이름<input type="text" value={name} onChange={(e) => setName(e.target.value)} /></label>
      <p className="muted" style={{ marginTop: 10 }}>문항·평가자 구성·반영 비율·대상자를 가져옵니다. 응답·제출 상태·결과는 가져오지 않습니다.</p>
      <div className="row" style={{ marginTop: 12 }}><span className="spacer" /><button className="btn primary" disabled={!name.trim()} onClick={go}>복제</button></div>
    </Modal>
  )
}
