import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { update, useAppState } from '../../data/store'
import { can } from '../../domain/permissions'
import { activeTeams, applyTier, customFieldErrors, customFieldUsage, customValueText, deleteCustomField, deleteEmployee, deleteTeam, nameConflicts, otherLead, saveCustomField, syncTiers, teamMembers, teamNameError, tierOf, TIERS } from '../../domain/org'
import { syncOpenCycles } from '../../domain/cycleSync'
import { joinOpenCycles } from '../../domain/cycle'
import { activeJobs, classDefault, deleteJob, deletePosition, jobName, jobUsage, positionById, positionName, positionsOf, positionUsage, saveJob, savePosition } from '../../domain/catalog'
import { applyRosterFill, canFill, canRegister, checkRoster, checkRosterFill, readRosterFile, ROSTER_FIELDS, ROSTER_HEADER, rosterEmployees, rosterLeads, type ExistingMode, type RosterRow } from '../../domain/roster'
import type { Sheet } from '../../domain/xlsx'
import type { CustomField, Employee, EvalClass, JobDef, PositionDef } from '../../domain/types'
import { Forbidden, Modal, Notice } from '../../components/ui'

const blank = (teamId: string): Employee => ({
  id: '', empNo: '', name: '', teamId, position: '사원', positionId: 'pos-staff', jobType: 'office',
  isExecutive: false, isCeo: false, active: true, evalExcluded: false,
})

type Tab = 'emp' | 'org' | 'upload'
const TABS: [Tab, string][] = [['emp', '직원 목록'], ['org', '조직 설정'], ['upload', '일괄 업로드']]

export default function People() {
  const s = useAppState()
  const [tab, setTab] = useState<Tab>('emp')
  if (!can(s.session.role, 'editPeople')) return <Forbidden />
  return (
    <div className="page">
      <div className="page-head"><h1>조직 관리</h1></div>
      <div className="tabs" role="tablist" aria-label="조직 관리">
        {TABS.map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{label}</button>
        ))}
      </div>
      {tab === 'emp' && <EmployeeList />}
      {tab === 'org' && <OrgEditor />}
      {tab === 'upload' && <Upload />}
    </div>
  )
}

function EmployeeList() {
  const s = useAppState()
  const [q, setQ] = useState('')
  const [team, setTeam] = useState('')
  const [roleF, setRoleF] = useState('')
  const [edit, setEdit] = useState<Employee | null>(null)
  const [fieldEdit, setFieldEdit] = useState<CustomField | null>(null) // 분류 기준 추가·편집 (D-078)
  const [memoFor, setMemoFor] = useState<Employee | null>(null)
  const [menu, setMenu] = useState<string | null>(null) // 열 머리글 메뉴가 열린 분류 기준 ID
  const fields = s.customFields ?? []
  // 머리글 메뉴: 바깥을 누르거나 Esc로 닫기
  useEffect(() => {
    if (!menu) return
    const down = (e: MouseEvent) => { if (!(e.target as Element).closest('.cf-th')) setMenu(null) }
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenu(null) }
    document.addEventListener('mousedown', down); document.addEventListener('keydown', key)
    return () => { document.removeEventListener('mousedown', down); document.removeEventListener('keydown', key) }
  }, [menu])
  const teamName = (id: string) => s.teams.find((t) => t.id === id)?.name ?? ''
  const needle = q.trim()
  // 기본 목록 = 재직 중인 직원 전체 (평가 대상이 아닌 대표자·임원 포함)
  const list = s.employees
    .filter((e) => e.active)
    .filter((e) => {
      if (needle && !(e.name.includes(needle) || e.empNo.includes(needle) || teamName(e.teamId).includes(needle))) return false
      if (team && e.teamId !== team) return false
      if (roleF && positionById(s, e.positionId)?.id !== roleF) return false
      return true
    })
    .sort((a, b) => teamName(a.teamId).localeCompare(teamName(b.teamId), 'ko') || TIERS.indexOf(tierOf(s, a)) - TIERS.indexOf(tierOf(s, b)) || positionName(s, a).localeCompare(positionName(s, b), 'ko') || a.name.localeCompare(b.name, 'ko'))
  const filtering = !!needle || !!team || !!roleF
  const dupNames = nameConflicts(s).employees

  return (
    <>
      <section className="panel">
        <div className="filters">
          <input type="search" placeholder="이름·사번·팀 검색" value={q} onChange={(e) => setQ(e.target.value)} aria-label="이름·사번·팀 검색" />
          <select value={team} onChange={(e) => setTeam(e.target.value)} aria-label="팀">
            <option value="">전체 팀</option>
            {activeTeams(s).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <select value={roleF} onChange={(e) => setRoleF(e.target.value)} aria-label="직급">
            <option value="">전체 직급</option>
            {positionsOf(s).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          {filtering && <button className="btn small" onClick={() => { setQ(''); setTeam(''); setRoleF('') }}>필터 초기화</button>}
          <span className="spacer" />
          <div className="row people-actions">
            <button className="btn primary" onClick={() => setEdit(blank(activeTeams(s)[0]?.id ?? ''))}>+ 직원 추가</button>
            <button className="btn soft" onClick={() => setFieldEdit({ id: '', name: '', type: 'text', options: [] })}>+ 칼럼 추가</button>
          </div>
        </div>
        <div className="table-wrap" tabIndex={0}>
          {/* D-087: 팀·직급·이름·직무·사번 5열은 같은 너비(고정 표 배치에서 남는 폭을 똑같이 나눔), 분류 기준·수정·메모 열은 필요한 폭만 */}
          <table className="tbl org-tbl emp-tbl" style={{ minWidth: `calc(${5 * 7}em + ${fields.length * 10}em + 150px)` }}>
            <thead>
              <tr>
                <th className="ec">팀</th><th className="ec">직급</th><th className="ec">이름</th><th className="ec">직무</th>
                {/* 사용자 정의 분류 기준 열 — 머리글 메뉴에서 편집·삭제 */}
                {fields.map((f) => (
                  <th key={f.id} className="cf-th">
                    <button type="button" className="cf-head" aria-haspopup="menu" aria-expanded={menu === f.id} onClick={() => setMenu(menu === f.id ? null : f.id)}>{f.name} <span aria-hidden>▾</span></button>
                    {menu === f.id && (
                      <div className="cf-menu" role="menu">
                        <button type="button" role="menuitem" onClick={() => { setMenu(null); setFieldEdit(structuredClone(f)) }}>이름·선택지 편집</button>
                        <button type="button" role="menuitem" className="danger" onClick={() => {
                          setMenu(null)
                          const n = customFieldUsage(s, f.id)
                          if (!confirm(n ? `'${f.name}' 항목을 삭제하면 직원 ${n}명의 값도 함께 삭제됩니다. 삭제할까요?` : `'${f.name}' 항목을 삭제할까요?`)) return
                          update((d) => deleteCustomField(d, f.id))
                        }}>항목 삭제</button>
                      </div>
                    )}
                  </th>
                ))}
                <th className="ec">사번</th><th className="c-act"><span className="sr-only">수정·메모</span></th>
              </tr>
            </thead>
            <tbody>
              {list.length === 0 ? (
                <tr><td colSpan={6 + fields.length} className="empty-row">조건에 맞는 직원이 없습니다.</td></tr>
              ) : list.map((e) => (
                <tr key={e.id}>
                  <td className="ec">{teamName(e.teamId)}</td>
                  <td className="ec">{positionName(s, e)}</td>
                  <td className="ec ec-name"><span className="cell-in name-grp"><b>{e.name}</b></span></td>
                  <td className="ec">{jobName(s, e.jobType)}</td>
                  {fields.map((f) => <td key={f.id} className="cf-td">{customValueText(f, e.custom?.[f.id])}</td>)}
                  <td className="ec num-text">{e.empNo}</td>
                  <td className="c-act">
                    <div className="row-actions">
                      <button className="btn small" onClick={() => setEdit(e)}>수정</button>
                      {/* 관리자 메모 — 내용은 목록에 펼치지 않고 있으면 점으로만 */}
                      <button className={`btn small memo-btn ${s.memos?.[e.id] ? 'has' : ''}`} aria-label={s.memos?.[e.id] ? `${e.name} 메모 (작성됨)` : `${e.name} 메모`} onClick={() => setMemoFor(e)}>메모{s.memos?.[e.id] && <span className="memo-dot" aria-hidden />}</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      {dupNames.length > 0 && (
        <Notice kind="warn" title="이름이 같은 직원이 있습니다 (자동으로 합치지 않음)">
          {dupNames.map((d) => `${d.name}: ${d.detail.join(' / ')}`).join(' · ')}
        </Notice>
      )}
      {edit && <EmployeeModal emp={edit} onClose={() => setEdit(null)} />}
      {fieldEdit && <FieldModal field={fieldEdit} onClose={() => setFieldEdit(null)} />}
      {memoFor && <MemoModal emp={memoFor} onClose={() => setMemoFor(null)} />}
    </>
  )
}

/** 분류 기준 추가·편집 (D-078). 이름·입력 방식(텍스트/선택형)·선택지. 값이 있는 항목은 입력 방식을 바꾸지 않음 */
function FieldModal({ field, onClose }: { field: CustomField; onClose: () => void }) {
  const s = useAppState()
  const [f, setF] = useState<CustomField>(field)
  const [err, setErr] = useState<string[]>([])
  const isNew = !field.id
  const used = isNew ? 0 : customFieldUsage(s, field.id)
  const save = () => {
    const e = customFieldErrors(s, f)
    setErr(e)
    if (e.length) return
    // 지운 선택지를 쓰던 직원이 있으면 확인
    const removed = field.options.filter((o) => !f.options.some((x) => x.id === o.id)).map((o) => ({ o, n: customFieldUsage(s, field.id, o.id) })).filter((x) => x.n > 0)
    if (removed.length && !confirm(`${removed.map((x) => `'${x.o.label}'(${x.n}명)`).join(', ')} 선택지를 지우면 그 직원들의 값이 비워집니다. 저장할까요?`)) return
    update((d) => saveCustomField(d, { ...f, id: f.id || `cf-${Date.now().toString(36)}` }))
    onClose()
  }
  const setOpt = (i: number, label: string) => setF({ ...f, options: f.options.map((o, k) => (k === i ? { ...o, label } : o)) })
  return (
    <Modal title={isNew ? '칼럼 추가' : '칼럼 편집'} onClose={onClose}>
      <label className="field">항목 이름<input type="text" value={f.name} autoFocus onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
      <fieldset className="field cf-type">
        <legend>입력 방식</legend>
        <div className="row">
          <label className="check"><input type="radio" name="cf-type" checked={f.type === 'text'} disabled={used > 0} onChange={() => setF({ ...f, type: 'text' })} /> 텍스트</label>
          <label className="check"><input type="radio" name="cf-type" checked={f.type === 'select'} disabled={used > 0} onChange={() => setF({ ...f, type: 'select', options: f.options.length ? f.options : [{ id: `o-${Date.now().toString(36)}`, label: '' }] })} /> 선택형</label>
        </div>
      </fieldset>
      {f.type === 'select' && (
        <fieldset className="field cf-opts">
          <legend>선택지</legend>
          {f.options.map((o, i) => (
            <div className="opt-row" key={o.id}>
              <input type="text" aria-label={`선택지 ${i + 1}`} value={o.label} onChange={(e) => setOpt(i, e.target.value)} />
              <button type="button" className="btn small danger" onClick={() => setF({ ...f, options: f.options.filter((_, k) => k !== i) })}>삭제</button>
            </div>
          ))}
          <button type="button" className="btn small" onClick={() => setF({ ...f, options: [...f.options, { id: `o-${Date.now().toString(36)}${f.options.length}`, label: '' }] })}>+ 선택지 추가</button>
        </fieldset>
      )}
      {err.length > 0 && <div className="feedback fail" role="alert">{err.map((x) => <div key={x}>✕ {x}</div>)}</div>}
      <div className="row" style={{ marginTop: 14 }}><span className="spacer" /><button className="btn primary" onClick={save}>{isNew ? '추가' : '저장'}</button></div>
    </Modal>
  )
}

/** 직원별 관리자 메모 (D-078) — 직원 ID에 연결, 관리자 화면에서만 */
function MemoModal({ emp, onClose }: { emp: Employee; onClose: () => void }) {
  const s = useAppState()
  const [v, setV] = useState(s.memos?.[emp.id] ?? '')
  const save = () => {
    update((d) => {
      const m = { ...(d.memos ?? {}) }
      if (v.trim()) m[emp.id] = v
      else delete m[emp.id]
      d.memos = m
    })
    onClose()
  }
  return (
    <Modal title={`메모 — ${emp.name}`} onClose={onClose}>
      <label className="field">메모<textarea className="memo-text" rows={7} value={v} autoFocus onChange={(e) => setV(e.target.value)} /></label>
      <div className="row" style={{ marginTop: 14 }}><span className="spacer" /><button className="btn primary" onClick={save}>저장</button></div>
    </Modal>
  )
}

function EmployeeModal({ emp, onClose }: { emp: Employee; onClose: () => void }) {
  const s = useAppState()
  const [e, setE] = useState<Employee>(emp)
  // 직급 선택 = 직급 ID. 평가 동작은 그 직급의 평가 구분(임원·팀장·사원)으로 맞춘다 (D-080)
  const [posId, setPosId] = useState<string>(() => positionById(s, emp.positionId)?.id ?? classDefault(s, emp.id ? tierOf(s, emp) : '사원').id)
  const tier: EvalClass = positionById(s, posId)?.evalClass ?? '사원'
  const [err, setErr] = useState('')
  const set = <K extends keyof Employee>(k: K, v: Employee[K]) => setE({ ...e, [k]: v })
  const teamName = (id: string) => s.teams.find((t) => t.id === id)?.name ?? ''
  const teamChanged = !!emp.id && e.teamId !== emp.teamId
  const inCycles = s.cycles.filter((c) => c.targets.some((t) => t.employeeId === emp.id))
  const replaced = tier === '팀장' ? otherLead(s, e.teamId, e.id) : null
  const wasLead = !!emp.id && tierOf(s, emp) === '팀장'
  const save = () => {
    const empNo = e.empNo.trim() // 글자 그대로 저장 → 앞자리 0 보존
    if (!e.name.trim() || !empNo) return setErr('이름과 사번은 필수입니다.')
    if (!e.teamId) return setErr('팀을 선택하세요.')
    if (s.employees.some((x) => x.empNo === empNo && x.id !== e.id)) return setErr(`사번 ${empNo}는 이미 있습니다.`)
    // 다른 사람이 이미 이 팀의 팀장이면 조용히 바꾸지 않고 확인
    if (replaced && !confirm(`${teamName(e.teamId)}의 팀장은 현재 ${replaced.name}입니다.\n${e.name.trim() || '이 직원'}(으)로 바꾸면 ${replaced.name}은(는) 사원이 됩니다. 계속할까요?`)) return
    update((d) => {
      // 기존 직원: 같은 ID를 그대로 갱신(이전 저장 데이터의 다른 필드도 보존)
      let id = e.id
      const isNewEmp = !id
      if (id) d.employees = d.employees.map((x) => (x.id === id ? { ...x, ...e, name: e.name.trim(), empNo } : x))
      else { id = `e-${Date.now().toString(36)}`; d.employees.push({ ...e, id, name: e.name.trim(), empNo }) }
      d.employees.find((x) => x.id === id)!.positionId = posId
      applyTier(d, id, tier)
      if (isNewEmp) joinOpenCycles(d, [id]) // 새 직원은 준비·진행 회차 참여자로 시작 (D-112)
      syncOpenCycles(d) // 진행 중 회차의 팀·팀장·임원 배정을 현재 조직에 맞춤 (D-081, 응답 있는 배정은 그대로)
    })
    onClose()
  }
  const remove = () => {
    if (!confirm(`'${emp.name}' 직원을 삭제할까요?`)) return
    update((d) => { deleteEmployee(d, emp.id); syncOpenCycles(d) })
    onClose()
  }
  return (
    <Modal title={e.id ? '직원 정보 수정' : '직원 추가'} onClose={onClose}>
      <div className="grid form-grid">
        <label className="field">이름<input type="text" value={e.name} onChange={(x) => set('name', x.target.value)} /></label>
        <label className="field">사번<input type="text" inputMode="numeric" value={e.empNo} onChange={(x) => set('empNo', x.target.value)} /></label>
        <label className="field">팀
          <select value={e.teamId} onChange={(x) => set('teamId', x.target.value)}>
            {activeTeams(s).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </label>
        <label className="field">직급
          <select value={posId} onChange={(x) => setPosId(x.target.value)}>
            {positionsOf(s).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
        <label className="field">직무
          <select value={e.jobType} onChange={(x) => set('jobType', x.target.value)}>
            {activeJobs(s).map((j) => <option key={j.id} value={j.id}>{j.name}</option>)}
            {!activeJobs(s).some((j) => j.id === e.jobType) && <option value={e.jobType}>{jobName(s, e.jobType)}</option>}
          </select>
        </label>
        {/* 사용자 정의 분류 기준 (D-078) — 비워 두면 값 없음 */}
        {(s.customFields ?? []).map((f) => {
          const v = e.custom?.[f.id] ?? ''
          const setV = (val: string) => { const c = { ...(e.custom ?? {}) }; if (val.trim()) c[f.id] = val; else delete c[f.id]; setE({ ...e, custom: c }) }
          return (
            <label className="field" key={f.id}>{f.name}
              {f.type === 'select'
                ? <select value={v} onChange={(x) => setV(x.target.value)}><option value="">(없음)</option>{f.options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</select>
                : <input type="text" value={v} onChange={(x) => setV(x.target.value)} />}
            </label>
          )
        })}
      </div>
      {replaced && <p className="save-note">{teamName(e.teamId)}의 현재 팀장 {replaced.name}은(는) 저장하면 사원이 됩니다.</p>}
      {wasLead && tier === '팀장' && teamChanged && <p className="save-note">'{teamName(emp.teamId)}'의 팀장 연결은 해제되고 '{teamName(e.teamId)}' 팀장이 됩니다.</p>}
      {wasLead && tier !== '팀장' && <p className="save-note">'{teamName(emp.teamId)}'의 팀장 연결이 해제되어 팀장 자리가 비게 됩니다.</p>}
      {teamChanged && inCycles.length > 0 && (
        <p className="save-note">진행 중인 평가의 팀·팀장평가 담당도 새 팀 기준으로 맞춰집니다(이미 응답한 평가는 그대로).</p>
      )}
      {err && <p className="feedback fail" role="alert">✕ {err}</p>}
      <div className="row modal-foot">
        {emp.id && <button className="btn danger" onClick={remove}>직원 삭제</button>}
        <span className="spacer" /><button className="btn primary" onClick={save}>저장</button>
      </div>
    </Modal>
  )
}

type Draft = { name: string; leadId: string }

/** 팀 관리 (D-064·D-065): 팀 이름·팀장 수정, 인원 펼치기, 행 추가(+ 추가), 삭제(소속 직원은 다른 팀으로 이동). 상위 부서 없음 */
function OrgEditor() {
  const s = useAppState()
  const teams = activeTeams(s)
  const [open, setOpen] = useState<Set<string>>(new Set()) // 구성원 펼친 팀 (기본 접힘)
  const [draft, setDraft] = useState<Draft | null>(null) // 저장 전 새 팀 행 (데이터에는 아직 없음)
  const [draftErr, setDraftErr] = useState('')
  const [removing, setRemoving] = useState<{ id: string; moveTo: string } | null>(null)
  const [msg, setMsg] = useState('')
  const dupTeams = nameConflicts(s).teams
  const active = s.employees.filter((e) => e.active)
  const teamName = (id: string) => s.teams.find((t) => t.id === id)?.name ?? ''
  const toggle = (id: string) => { const n = new Set(open); if (n.has(id)) n.delete(id); else n.add(id); setOpen(n) }

  /** 팀장 후보: 이 팀 소속 먼저, 다른 팀 직원은 팀 이름을 붙여 구분 (소속은 바꾸지 않음) */
  // D-138: 팀장 후보 = 팀별로 묶음(그 팀이 맨 위, 나머지 팀 가나다순), 글자 = '(직급 · 팀) 이름'
  const leadGroups = (teamId: string | null) => {
    const pool = active.filter((e) => !e.isExecutive && !e.isCeo) // 임원은 팀장 후보가 아님 (직급 = 임원·팀장·사원 중 하나)
    const ids = [...new Set(pool.map((e) => e.teamId))].sort((a, b) => Number(b === teamId) - Number(a === teamId) || teamName(a).localeCompare(teamName(b), 'ko'))
    return ids.map((gid) => ({ id: gid, label: `${teamName(gid) || '팀 없음'}${gid === teamId ? ' (해당 팀)' : ''}`, items: pool.filter((e) => e.teamId === gid).sort((a, b) => a.name.localeCompare(b.name, 'ko')).map((m) => ({ id: m.id, label: `(${m.position} · ${teamName(m.teamId)}) ${m.name}` })) }))
  }
  const saveDraft = () => {
    if (!draft) return
    const err = teamNameError(s, draft.name)
    if (err) return setDraftErr(err)
    const name = draft.name.trim()
    update((d) => { d.teams.push({ id: `tm-${Date.now().toString(36)}`, name, leadId: draft.leadId || null }); syncTiers(d); syncOpenCycles(d) })
    setDraft(null); setDraftErr(''); setMsg(`'${name}' 팀을 추가했습니다.`)
  }
  const startRemove = (id: string, name: string) => {
    setMsg('')
    if (teamMembers(s, id).length === 0) {
      if (!confirm(`'${name}' 팀을 삭제할까요?`)) return
      update((d) => { deleteTeam(d, id, null); syncOpenCycles(d) })
      setMsg(`'${name}' 팀을 삭제했습니다.`)
    } else setRemoving({ id, moveTo: '' })
  }
  const finishRemove = () => {
    if (!removing) return
    const name = teamName(removing.id)
    let err: string | null = null
    update((d) => { err = deleteTeam(d, removing.id, removing.moveTo || null); if (!err) syncOpenCycles(d) })
    if (err) return setMsg(err)
    setRemoving(null); setMsg(`'${name}' 팀을 삭제하고 직원을 '${teamName(removing.moveTo)}'(으)로 옮겼습니다.`)
  }

  return (
    <>
      <section className="panel">
        <div className="panel-head row team-head">
          <h2 className="org-sub">팀 관리</h2>
          <span className="spacer" />
          {msg && <span className="feedback ok" role="status">✓ {msg}</span>}
          <button className="btn primary" disabled={!!draft} onClick={() => { setDraft({ name: '', leadId: '' }); setDraftErr(''); setMsg('') }}>+ 추가</button>
        </div>
        <div className="table-wrap" tabIndex={0}>
          <table className="tbl org-tbl team-tbl">
            <thead><tr><th>팀 이름</th><th>팀장</th><th>인원</th><th>삭제</th></tr></thead>
            <tbody>
              {teams.map((t) => {
                const members = teamMembers(s, t.id)
                const isOpen = open.has(t.id)
                const leadOutside = t.leadId && !members.some((m) => m.id === t.leadId)
                return [
                  <tr key={t.id}>
                    <td><input type="text" aria-label={`${t.name} 팀 이름`} value={t.name} onChange={(e) => update((x) => { x.teams.find((y) => y.id === t.id)!.name = e.target.value })} /></td>
                    <td>
                      <LeadPicker label={`${t.name} 팀장`} value={t.leadId ?? ''} groups={leadGroups(t.id)} onChange={(v) => update((x) => { x.teams.find((y) => y.id === t.id)!.leadId = v || null; syncTiers(x); syncOpenCycles(x) })} />
                    </td>
                    <td>
                      <button type="button" className="count-toggle" aria-expanded={isOpen} aria-controls={`members-${t.id}`} onClick={() => toggle(t.id)}>
                        {members.length}명
                      </button>
                    </td>
                    <td><button className="btn small danger" onClick={() => startRemove(t.id, t.name)}>삭제</button></td>
                  </tr>,
                  removing?.id === t.id && (
                    <tr key={`${t.id}-rm`} className="team-sub">
                      <td colSpan={4}>
                        <div className="row team-move">
                          <span>'{t.name}' 소속 {members.length}명을 옮길 팀</span>
                          <select aria-label="옮길 팀" value={removing.moveTo} onChange={(e) => setRemoving({ ...removing, moveTo: e.target.value })}>
                            <option value="">선택</option>
                            {teams.filter((x) => x.id !== t.id).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                          </select>
                          <button className="btn small danger" disabled={!removing.moveTo} onClick={finishRemove}>옮기고 삭제</button>
                          <button className="btn small" onClick={() => setRemoving(null)}>취소</button>
                        </div>
                      </td>
                    </tr>
                  ),
                  isOpen && (
                    <tr key={`${t.id}-m`} id={`members-${t.id}`} className="team-sub">
                      <td colSpan={4}>
                        {members.length === 0 ? <p className="muted team-empty">소속 직원이 없습니다.</p> : (
                          <ul className="team-members">
                            {members.map((m) => (
                              <li key={m.id}><b>{m.name}</b><span className={`chip tag ${m.id === t.leadId ? 'info' : 'na'}`}>{m.id === t.leadId ? positionName(s, m) : tierOf(s, m) === '팀장' ? '다른 팀 팀장' : positionName(s, m)}</span></li>
                            ))}
                          </ul>
                        )}
                        {leadOutside && <p className="muted team-empty">팀장 {s.employees.find((e) => e.id === t.leadId)?.name}은(는) {teamName(s.employees.find((e) => e.id === t.leadId)?.teamId ?? '')} 소속이라 인원에 포함되지 않습니다.</p>}
                      </td>
                    </tr>
                  ),
                ]
              })}
              {draft && (
                <tr className="team-draft">
                  <td><input type="text" aria-label="새 팀 이름" placeholder="팀 이름" value={draft.name} autoFocus onChange={(e) => { setDraft({ ...draft, name: e.target.value }); setDraftErr('') }} onKeyDown={(e) => e.key === 'Enter' && saveDraft()} /></td>
                  <td><LeadPicker label="새 팀 팀장" value={draft.leadId} groups={leadGroups(null)} onChange={(v) => setDraft({ ...draft, leadId: v })} /></td>
                  <td className="muted">0명</td>
                  <td><div className="row draft-actions"><button className="btn small primary" onClick={saveDraft}>저장</button><button className="btn small" onClick={() => { setDraft(null); setDraftErr('') }}>취소</button></div></td>
                </tr>
              )}
              {draft && draftErr && <tr className="team-sub"><td colSpan={4}><p className="feedback fail" role="alert">✕ {draftErr}</p></td></tr>}
            </tbody>
          </table>
        </div>
      </section>
      {dupTeams.length > 0 && (
        <Notice kind="warn" title="이름이 같은 팀이 있습니다 (자동으로 합치지 않음)">
          {dupTeams.map((d) => `${d.name}: ${d.detail.join(' / ')}`).join(' · ')}
        </Notice>
      )}
      <div className="org-catalogs">
        <JobEditor />
        <PositionEditor />
      </div>
    </>
  )
}

/** 직무 관리 (D-080): 이름 추가·수정·삭제. 쓰는 직원이 있으면 대체 직무로 옮긴 뒤 삭제. 평가 배정·권한은 바꾸지 않음 */
function JobEditor() {
  const s = useAppState()
  const jobs = activeJobs(s)
  const [edit, setEdit] = useState<{ id: string | null; name: string } | null>(null)
  const [removing, setRemoving] = useState<{ id: string; to: string } | null>(null)
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')
  const count = (j: JobDef) => jobUsage(s, j.id).filter((e) => e.active).length
  const save = () => {
    if (!edit) return
    let e: string | null = null
    update((d) => { e = saveJob(d, edit.id, edit.name) })
    if (e) return setErr(e)
    setMsg(edit.id ? '직무 이름을 바꿨습니다.' : `'${edit.name.trim()}' 직무를 추가했습니다.`); setEdit(null); setErr('')
  }
  const remove = (j: JobDef, to: string | null) => {
    let e: string | null = null
    update((d) => { e = deleteJob(d, j.id, to) })
    if (e) return setErr(e)
    setRemoving(null); setErr(''); setMsg(to ? `'${j.name}' 직무를 삭제하고 직원을 '${jobName(s, to)}'(으)로 옮겼습니다.` : `'${j.name}' 직무를 삭제했습니다.`)
  }
  const nameInput = (label: string) => <input type="text" aria-label={label} value={edit!.name} autoFocus onChange={(e) => { setEdit({ ...edit!, name: e.target.value }); setErr('') }} onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEdit(null) }} />
  const actions = <div className="row draft-actions"><button className="btn small primary" onClick={save}>저장</button><button className="btn small" onClick={() => { setEdit(null); setErr('') }}>취소</button></div>
  return (
    <section className="panel catalog" aria-label="직무 관리">
      <div className="panel-head row team-head">
        <h2 className="org-sub">직무 관리</h2>
        <span className="spacer" />
        {msg && <span className="feedback ok" role="status">✓ {msg}</span>}
        <button className="btn primary small" disabled={!!edit} onClick={() => { setEdit({ id: null, name: '' }); setRemoving(null); setErr(''); setMsg('') }}>+ 추가</button>
      </div>
      <div className="table-wrap" tabIndex={0}>
        <table className="tbl org-tbl catalog-tbl">
          <thead><tr><th>직무</th><th>인원</th><th><span className="sr-only">수정·삭제</span></th></tr></thead>
          <tbody>
            {jobs.map((j) => [
              <tr key={j.id}>
                {edit?.id === j.id ? <><td>{nameInput(`${j.name} 직무 이름`)}</td><td>{count(j)}명</td><td>{actions}</td></> : <>
                  <td><b>{j.name}</b></td><td>{count(j)}명</td>
                  <td><div className="row-actions">
                    <button className="btn small" disabled={!!edit} onClick={() => { setEdit({ id: j.id, name: j.name }); setRemoving(null); setErr(''); setMsg('') }}>수정</button>
                    <button className="btn small danger" disabled={!!edit || jobs.length <= 1} title={jobs.length <= 1 ? '직무는 하나 이상 있어야 합니다' : undefined} onClick={() => {
                      setMsg(''); setErr('')
                      if (jobUsage(s, j.id).length) setRemoving({ id: j.id, to: '' })
                      else if (confirm(`'${j.name}' 직무를 삭제할까요?`)) remove(j, null)
                    }}>삭제</button>
                  </div></td>
                </>}
              </tr>,
              removing?.id === j.id && (
                <tr key={`${j.id}-rm`} className="team-sub"><td colSpan={3}>
                  <div className="row team-move">
                    <span>'{j.name}' 직원 {jobUsage(s, j.id).length}명을 옮길 직무</span>
                    <select aria-label="옮길 직무" value={removing.to} onChange={(e) => setRemoving({ ...removing, to: e.target.value })}>
                      <option value="">선택</option>
                      {jobs.filter((x) => x.id !== j.id).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                    </select>
                    <button className="btn small danger" disabled={!removing.to} onClick={() => remove(j, removing.to)}>옮기고 삭제</button>
                    <button className="btn small" onClick={() => setRemoving(null)}>취소</button>
                  </div>
                </td></tr>
              ),
            ])}
            {edit && !edit.id && <tr className="team-draft"><td>{nameInput('새 직무 이름')}</td><td className="muted">0명</td><td>{actions}</td></tr>}
            {err && <tr className="team-sub"><td colSpan={3}><p className="feedback fail" role="alert">✕ {err}</p></td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  )
}

/**
 * 직급 관리 (D-080, D-083): 화면에는 이름·인원만. 내부 평가 구분은 그대로 유지(새 직급 = 사원 기준, 기본 직급은 삭제 불가).
 * 쓰는 직원이 있는 직급은 평가 구분을 바꾸지 않고, 삭제는 같은 평가 구분의 대체 직급으로 옮긴 뒤. 팀장 임명·권한·배정은 바꾸지 않음
 */
function PositionEditor() {
  const s = useAppState()
  const list = positionsOf(s)
  // 화면에는 이름만(D-083). 평가 구분은 내부 값으로만 유지 — 새 직급은 사원 기준, 수정 시 그대로
  const [edit, setEdit] = useState<{ id: string | null; name: string } | null>(null)
  const [removing, setRemoving] = useState<{ id: string; to: string } | null>(null)
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')
  const used = (p: PositionDef) => positionUsage(s, p.id).length
  const save = () => {
    if (!edit) return
    const cls: EvalClass = (edit.id && positionById(s, edit.id)?.evalClass) || '사원'
    let e: string | null = null
    update((d) => { e = savePosition(d, edit.id, edit.name, cls) })
    if (e) return setErr(e)
    setMsg(edit.id ? '직급을 수정했습니다.' : `'${edit.name.trim()}' 직급을 추가했습니다.`); setEdit(null); setErr('')
  }
  const remove = (p: PositionDef, to: string | null) => {
    let e: string | null = null
    update((d) => { e = deletePosition(d, p.id, to) })
    if (e) return setErr(e)
    setRemoving(null); setErr(''); setMsg(to ? `'${p.name}' 직급을 삭제하고 직원을 '${positionById(s, to)?.name}'(으)로 옮겼습니다.` : `'${p.name}' 직급을 삭제했습니다.`)
  }
  const editRow = (p?: PositionDef) => (
    <>
      <td><input type="text" aria-label={p ? `${p.name} 직급 이름` : '새 직급 이름'} value={edit!.name} autoFocus onChange={(e) => { setEdit({ ...edit!, name: e.target.value }); setErr('') }} onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEdit(null) }} /></td>
      <td className={p ? '' : 'muted'}>{p ? used(p) : 0}명</td>
      <td><div className="row draft-actions"><button className="btn small primary" onClick={save}>저장</button><button className="btn small" onClick={() => { setEdit(null); setErr('') }}>취소</button></div></td>
    </>
  )
  return (
    <section className="panel catalog" aria-label="직급 관리">
      <div className="panel-head row team-head">
        <h2 className="org-sub">직급 관리</h2>
        <span className="spacer" />
        {msg && <span className="feedback ok" role="status">✓ {msg}</span>}
        <button className="btn primary small" disabled={!!edit} onClick={() => { setEdit({ id: null, name: '' }); setRemoving(null); setErr(''); setMsg('') }}>+ 추가</button>
      </div>
      <div className="table-wrap" tabIndex={0}>
        <table className="tbl org-tbl catalog-tbl">
          <thead><tr><th>직급</th><th>인원</th><th><span className="sr-only">수정·삭제</span></th></tr></thead>
          <tbody>
            {list.map((p) => [
              <tr key={p.id}>
                {edit?.id === p.id ? editRow(p) : <>
                  <td><b>{p.name}</b></td><td>{positionUsage(s, p.id).filter((e) => e.active).length}명</td>
                  <td><div className="row-actions">
                    <button className="btn small" disabled={!!edit} onClick={() => { setEdit({ id: p.id, name: p.name }); setRemoving(null); setErr(''); setMsg('') }}>수정</button>
                    <button className="btn small danger" disabled={!!edit || !!p.builtIn} title={p.builtIn ? '기본 직급은 삭제할 수 없습니다' : undefined} onClick={() => {
                      setMsg(''); setErr('')
                      if (used(p)) setRemoving({ id: p.id, to: '' })
                      else if (confirm(`'${p.name}' 직급을 삭제할까요?`)) remove(p, null)
                    }}>삭제</button>
                  </div></td>
                </>}
              </tr>,
              removing?.id === p.id && (
                <tr key={`${p.id}-rm`} className="team-sub"><td colSpan={3}>
                  <div className="row team-move">
                    <span>'{p.name}' 직원 {used(p)}명을 옮길 직급</span>
                    <select aria-label="옮길 직급" value={removing.to} onChange={(e) => setRemoving({ ...removing, to: e.target.value })}>
                      <option value="">선택</option>
                      {list.filter((x) => x.id !== p.id && x.evalClass === p.evalClass).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                    </select>
                    <button className="btn small danger" disabled={!removing.to} onClick={() => remove(p, removing.to)}>옮기고 삭제</button>
                    <button className="btn small" onClick={() => setRemoving(null)}>취소</button>
                  </div>
                </td></tr>
              ),
            ])}
            {edit && !edit.id && <tr className="team-draft">{editRow()}</tr>}
            {err && <tr className="team-sub"><td colSpan={3}><p className="feedback fail" role="alert">✕ {err}</p></td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  )
}

type Loaded = { file: string; sheets: Sheet[]; sheet: number }

/** 직원 명단 업로드: 파일 선택 → 표 미리보기·검증 → 등록 (검증 전 자동 등록 없음, 차단 오류가 있으면 등록 안 함) */
/** 일괄 업로드(D-136·D-137): 직원 명단 업로드(새 직원 등록) 아래에 칼럼 값 채우기 — 칼럼은 CSV로 만들지 않음(직원 목록의 '+ 칼럼 추가'로만) */
function Upload() {
  return (
    <>
      <AddUpload />
      <FillUpload />
    </>
  )
}

/** 기존 직원 칼럼 값 채우기(D-136): 사번으로 찾아 만든 칼럼의 값만 — 미리보기(이전 → 새 값) 확인 후 저장, 오류가 있으면 아무것도 바꾸지 않음 */
function FillUpload() {
  const s = useAppState()
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [readErr, setReadErr] = useState('')
  const [done, setDone] = useState('')
  const [inputKey, setInputKey] = useState(0)
  const cfs = s.customFields ?? []
  const table = loaded?.sheets[loaded.sheet]?.rows ?? null
  const res = useMemo(() => (table ? checkRosterFill(table, s.employees, s) : null), [table, s.employees, s.customFields])
  const pick = async (f: File | undefined) => {
    setDone(''); setReadErr(''); setLoaded(null)
    if (!f) return
    const r = await readRosterFile(f.name, new Uint8Array(await f.arrayBuffer()))
    if (!r.ok) return setReadErr(r.error)
    setLoaded({ file: f.name, sheets: r.sheets, sheet: 0 })
  }
  const reset = () => { setLoaded(null); setReadErr(''); setInputKey((k) => k + 1) }
  const apply = () => {
    if (!res || !canFill(res)) return
    let n = 0
    update((d) => { n = applyRosterFill(d, res) })
    setDone(`${n}명의 칼럼 값을 저장했습니다.`)
    reset()
  }
  return (
    <section className="panel pad upload">
      <div className="row"><h2 style={{ margin: 0 }}>칼럼 값 채우기</h2><span className="muted">이미 등록된 직원의 칼럼 값을 사번으로 한꺼번에</span></div>
      <p className="muted upload-cols">필수 열: 사번 · 채울 칼럼: {cfs.length ? cfs.map((f) => f.name).join(' · ') : '없음(직원 목록에서 + 칼럼 추가)'} · 빈 칸은 그대로 · 칼럼은 새로 만들지 않음 · 팀·직급·이름·직무는 바꾸지 않음(직원 수정 창에서)</p>
      <div className="row upload-pick">
        <label className="btn primary file-btn">
          파일 선택
          <input key={inputKey} type="file" accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv" onChange={(e) => pick(e.target.files?.[0])} />
        </label>
        <span className="muted">{loaded ? loaded.file : '엑셀(.xlsx) 또는 CSV(.csv)'}</span>
        {loaded && loaded.sheets.length > 1 && (
          <label className="row sheet-pick">시트
            <select value={loaded.sheet} onChange={(e) => setLoaded({ ...loaded, sheet: Number(e.target.value) })}>
              {loaded.sheets.map((sh, i) => <option key={i} value={i}>{sh.name}</option>)}
            </select>
          </label>
        )}
      </div>
      {readErr && <p className="feedback fail" role="alert">✕ {readErr}</p>}
      {done && <p className="feedback ok" role="status">✓ {done}</p>}
      {res?.error && <p className="feedback fail" role="alert">✕ {res.error}</p>}
      {res && !res.error && (
        <>
          <div className="row upload-sum" aria-live="polite">
            <span>전체 <b>{res.rows.length}</b>행</span>
            <span>값 바뀌는 직원 <b>{res.changed}</b>명</span>
            <span className={res.errorRows ? 'err' : ''}>오류 <b>{res.errorRows}</b>행</span>
            <span className="muted">채울 칼럼: {res.fields.map((f) => f.name).join(', ')}</span>
            {res.fixed.length > 0 && <span className="muted">바꾸지 않는 열: {res.fixed.join(', ')}</span>}
            {res.ignored.length > 0 && <span className="muted">쓰지 않는 열(칼럼 없음 — 만들지 않음): {res.ignored.join(', ')}</span>}
          </div>
          <div className="table-wrap upload-preview" tabIndex={0}>
            <table className="tbl">
              <thead><tr><th className="num">행</th><th>사번</th><th>이름</th>{res.fields.map((f) => <th key={f.id}>{f.name}</th>)}<th>확인</th></tr></thead>
              <tbody>
                {res.rows.map((r) => (
                  <tr key={r.line} className={r.errors.length ? 'row-err' : !r.changes.length ? 'row-skip' : ''}>
                    <td className="num">{r.line}</td>
                    <td className={r.errors.some((e) => e.col === '사번') ? 'cell-err' : ''}>{r.empNo || <span className="muted">(빈 칸)</span>}</td>
                    <td>{r.name || '—'}</td>
                    {res.fields.map((f) => { const ch = r.changes.find((x) => x.fieldId === f.id); const bad = r.errors.some((e) => e.col === f.name); return <td key={f.id} className={bad ? 'cell-err' : ''}>{ch ? <><span className="muted">{ch.before || '(빈 칸)'}</span> → <b>{ch.after}</b></> : <span className="muted">그대로</span>}</td> })}
                    <td>{r.errors.length ? r.errors.map((e, i) => <div key={i} className="err-msg">{e.col}: {e.msg}</div>) : r.changes.length ? <span className="chip submitted">✓</span> : <span className="chip na">바뀌는 값 없음</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="row" style={{ marginTop: 12 }}>
            <button className="btn primary" disabled={!canFill(res)} onClick={apply}>{res.changed}명 값 저장</button>
            <button className="btn" onClick={reset}>취소</button>
            {res.errorRows > 0 && <span className="feedback fail">오류가 있어 저장할 수 없습니다.</span>}
          </div>
        </>
      )}
    </section>
  )
}

/** 새 직원 등록 */
function AddUpload() {
  const s = useAppState()
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [readErr, setReadErr] = useState('')
  const [mode, setMode] = useState<ExistingMode>('error')
  const [done, setDone] = useState('')
  const [inputKey, setInputKey] = useState(0)
  const table = loaded?.sheets[loaded.sheet]?.rows ?? null
  const res = useMemo(() => (table ? checkRoster(table, s.employees, activeTeams(s), mode, s) : null), [table, s.employees, s.teams, s.jobs, s.positions, s.customFields, mode])
  const cfs = s.customFields ?? []

  const pick = async (f: File | undefined) => {
    setDone(''); setReadErr(''); setLoaded(null); setMode('error') // 새 파일마다 기본값(오류로 표시)으로
    if (!f) return
    const r = await readRosterFile(f.name, new Uint8Array(await f.arrayBuffer()))
    if (!r.ok) return setReadErr(r.error)
    setLoaded({ file: f.name, sheets: r.sheets, sheet: 0 })
  }
  const reset = () => { setLoaded(null); setReadErr(''); setInputKey((k) => k + 1) }
  const apply = () => {
    if (!res) return
    const stamp = Date.now().toString(36)
    const add = rosterEmployees(res, (i) => `e-${stamp}-${i}`)
    if (!add.length) return
    update((d) => { d.employees.push(...add); rosterLeads(d, add); syncTiers(d); joinOpenCycles(d, add.map((e) => e.id)); syncOpenCycles(d) }) // 새 직원은 준비·진행 회차 참여자로 (D-112)
    const open = s.cycles.filter((c) => c.status === '준비' || c.status === '진행').length
    setDone(`${add.length}명을 등록했습니다.${res.skipped ? ` (기존 사번 ${res.skipped}행 건너뜀)` : ''}${open ? ' 진행 중인 평가의 참여자로 추가했습니다(평가 관리 → 평가 설정에서 해제 가능).' : ''}`)
    reset()
  }
  const cellErr = (r: RosterRow, label: string) => r.errors.some((e) => e.col === label)

  return (
    <section className="panel pad upload">
      <div className="row">
        <h2 style={{ margin: 0 }}>직원 명단 업로드</h2>
      </div>
      <p className="muted upload-cols">필수 열: {ROSTER_HEADER.join(' · ')}{cfs.length > 0 && <> · 선택 열(추가한 칼럼): {cfs.map((f) => f.name).join(' · ')}</>}</p>
      <div className="row upload-pick">
        <label className="btn primary file-btn">
          파일 선택
          <input key={inputKey} type="file" accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv" onChange={(e) => pick(e.target.files?.[0])} />
        </label>
        <span className="muted">{loaded ? loaded.file : '엑셀(.xlsx) 또는 CSV(.csv)'}</span>
        {loaded && loaded.sheets.length > 1 && (
          <label className="row sheet-pick">시트
            <select value={loaded.sheet} onChange={(e) => setLoaded({ ...loaded, sheet: Number(e.target.value) })}>
              {loaded.sheets.map((sh, i) => <option key={i} value={i}>{sh.name}</option>)}
            </select>
          </label>
        )}
      </div>
      {readErr && <p className="feedback fail" role="alert">✕ {readErr}</p>}
      {done && <p className="feedback ok" role="status">✓ {done}</p>}
      {res?.error && <p className="feedback fail" role="alert">✕ {res.error}</p>}
      {res && !res.error && (
        <>
          <div className="row upload-sum" aria-live="polite">
            <span>전체 <b>{res.rows.length}</b>행</span>
            <span>등록 가능 <b>{res.addable}</b></span>
            {res.skipped > 0 && <span>건너뜀 <b>{res.skipped}</b></span>}
            <span className={res.errorRows ? 'err' : ''}>오류 <b>{res.errorRows}</b>행</span>
            {res.extra.length > 0 && <span className="muted">함께 등록할 칼럼: {res.extra.map((f) => f.name).join(', ')}</span>}
            {res.ignored.length > 0 && <span className="muted">쓰지 않는 열(등록 안 함): {res.ignored.join(', ')}</span>}
          </div>
          {res.existingDup > 0 && (
            <fieldset className="row dup-mode">
              <legend>이미 등록된 사번</legend>
              <label className="check"><input type="radio" name="dupmode" checked={mode === 'error'} onChange={() => setMode('error')} /> 오류로 표시</label>
              <label className="check"><input type="radio" name="dupmode" checked={mode === 'skip'} onChange={() => setMode('skip')} /> 건너뛰기</label>
            </fieldset>
          )}
          <div className="table-wrap upload-preview" tabIndex={0}>
            <table className="tbl">
              <thead><tr><th className="num">행</th>{ROSTER_FIELDS.map((f) => <th key={f.key}>{f.label}</th>)}{res.extra.map((f) => <th key={f.id}>{f.name}</th>)}<th>확인</th></tr></thead>
              <tbody>
                {res.rows.length === 0 ? <tr><td colSpan={7 + res.extra.length} className="empty-row">머리글 아래에 직원 행이 없습니다.</td></tr> : res.rows.map((r) => (
                  <tr key={r.line} className={r.errors.length ? 'row-err' : r.skip ? 'row-skip' : ''}>
                    <td className="num">{r.line}</td>
                    {ROSTER_FIELDS.map((f) => <td key={f.key} className={cellErr(r, f.label) ? 'cell-err' : ''}>{r.v[f.key] || <span className="muted">(빈 칸)</span>}</td>)}
                    {res.extra.map((f) => <td key={f.id} className={cellErr(r, f.name) ? 'cell-err' : ''}>{r.custom[f.id] || <span className="muted">—</span>}</td>)}
                    <td>
                      {r.errors.length > 0
                        ? r.errors.map((e, i) => <div key={i} className="err-msg">{e.col}: {e.msg}</div>)
                        : r.skip ? <span className="chip na">건너뜀</span> : <span className="chip submitted">✓</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="row" style={{ marginTop: 12 }}>
            <button className="btn primary" disabled={!canRegister(res)} onClick={apply}>{res.addable}명 등록</button>
            <button className="btn" onClick={reset}>취소</button>
            {res.errorRows > 0 && <span className="feedback fail">오류가 있어 등록할 수 없습니다.</span>}
          </div>
        </>
      )}
    </section>
  )
}

/**
 * 팀장 고르기(D-138): 기본 select 대신 직접 그린 펼침 목록 — 펼친 목록도 칸 가운데 정렬·여백 없이, 팀 이름으로 묶음.
 * 키보드: 위·아래로 이동, Enter 선택, Esc 닫기. 바깥을 누르면 닫힘
 */
function LeadPicker({ label, value, groups, onChange }: { label: string; value: string; groups: { id: string; label: string; items: { id: string; label: string }[] }[]; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false)
  const [hi, setHi] = useState<string | null>(null)
  const [pos, setPos] = useState<{ left: number; top: number; width: number; up: boolean } | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  // 목록은 문서 맨 위(body)에 띄워 표 상자에 잘리지 않게 — 칸 바로 아래(아래 공간이 모자라면 위)
  const place = () => { const r = ref.current?.getBoundingClientRect(); if (r) setPos({ left: r.left, top: r.bottom + 4, width: r.width, up: innerHeight - r.bottom < 260 && r.top > innerHeight - r.bottom }) }
  const flat = [{ id: '', label: '(미지정)' }, ...groups.flatMap((g) => g.items)]
  const cur = flat.find((x) => x.id === value) ?? flat[0]
  useEffect(() => {
    if (!open) return
    place()
    const down = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node) && !menuRef.current?.contains(e.target as Node)) setOpen(false) }
    const away = (e: Event) => { if (!(e.target instanceof Node) || !menuRef.current?.contains(e.target)) setOpen(false) } // 화면을 스크롤하거나 크기가 바뀌면 닫음
    document.addEventListener('mousedown', down); window.addEventListener('scroll', away, true); window.addEventListener('resize', away)
    requestAnimationFrame(() => { const m = menuRef.current, o = m?.querySelector<HTMLElement>('[aria-selected="true"]'); if (m && o) m.scrollTop = o.offsetTop - m.clientHeight / 2 + o.offsetHeight / 2 })
    return () => { document.removeEventListener('mousedown', down); window.removeEventListener('scroll', away, true); window.removeEventListener('resize', away) }
  }, [open])
  const pick = (id: string) => { setOpen(false); if (id !== value) onChange(id) }
  const key = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { setOpen(false); return }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault(); if (!open) { setOpen(true); setHi(value); return }
      const i = Math.max(0, flat.findIndex((x) => x.id === (hi ?? value)))
      setHi(flat[Math.min(flat.length - 1, Math.max(0, i + (e.key === 'ArrowDown' ? 1 : -1)))].id)
    }
    if (e.key === 'Enter' && open && hi !== null) { e.preventDefault(); pick(hi) }
  }
  const opt = (x: { id: string; label: string }) => (
    <button key={x.id || 'none'} type="button" role="option" aria-selected={x.id === value} className={`lead-opt ${x.id === value ? 'on' : ''} ${x.id === hi ? 'hi' : ''}`} onMouseEnter={() => setHi(x.id)} onClick={() => pick(x.id)}>{x.label}</button>
  )
  return (
    <div className="lead-pick" ref={ref} onKeyDown={key}>
      <button type="button" className="lead-btn" aria-label={label} aria-haspopup="listbox" aria-expanded={open} onClick={() => { setOpen(!open); setHi(value) }}>
        <span className="lead-cur">{cur.label}</span>
      </button>
      {open && pos && createPortal(
        <div className="lead-menu" ref={menuRef} role="listbox" aria-label={label} onKeyDown={key}
          style={{ left: pos.left, width: pos.width, ...(pos.up ? { bottom: innerHeight - pos.top + 48 } : { top: pos.top }) }}>
          {opt(flat[0])}
          {groups.map((g) => (
            <div key={g.id} role="group" aria-label={g.label} className="lead-grp">
              <div className="lead-grp-h">{g.label}</div>
              {g.items.map(opt)}
            </div>
          ))}
        </div>,
        document.body,
      )}
    </div>
  )
}
