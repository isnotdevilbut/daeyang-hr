import { useState } from 'react'
import { Link } from 'react-router-dom'
import { update, useAppState } from '../../data/store'
import { useSelectedCycle } from '../../data/hooks'
import { can } from '../../domain/permissions'
import { cycleLabel } from '../../domain/cycle'
import { fmt, latestAdjustment, personResult, type PersonResult } from '../../domain/scoring'
import type { AdjustKind, Cycle, TargetSnapshot } from '../../domain/types'
import { Forbidden } from '../../components/ui'
import { positionsOf, targetPosition } from '../../domain/catalog'
import { BulkDownload } from './ReportBulk'

export function addAdjustment(cycleId: string, kind: AdjustKind, key: string, value: number | string | null, reason: string, by: string) {
  update((d) => {
    const prev = latestAdjustment(d.adjustments, cycleId, kind, key)
    d.adjustments.push({ id: `adj-${Date.now().toString(36)}`, cycleId, kind, targetKey: key, value, reason, by, at: new Date().toISOString(), before: prev?.value ?? null })
  })
}

export default function Results() {
  const s = useAppState()
  const [cycle, selectCycle, cycles] = useSelectedCycle()
  // D-167: 선택 항목 다운로드 — 회차를 바꾸면 선택을 비움
  const [picked, setPicked] = useState<{ cycleId: string; ids: string[] }>({ cycleId: '', ids: [] })
  const [bulk, setBulk] = useState(false)
  if (!can(s.session.role, 'viewResults')) return <Forbidden />
  const ids = picked.cycleId === cycle?.id ? picked.ids : []
  const setIds = (next: string[]) => setPicked({ cycleId: cycle?.id ?? '', ids: next })
  const canReport = can(s.session.role, 'reportPreview')
  return (
    <div className="page">
      <div className="page-head">
        <h1>결과 · 리포트</h1>
        {cycle && (
          <div className="cycle-pick">
            <label>
              <span className="pick-label">평가 회차</span>
              <select value={cycle.id} onChange={(e) => selectCycle(e.target.value)}>
                {cycles.map((c) => <option key={c.id} value={c.id}>{cycleLabel(c)}</option>)}
              </select>
            </label>
            {canReport && ids.length > 0 && <button className="btn primary small" onClick={() => setBulk(true)}>선택 항목 다운로드 ({ids.length}명)</button>}
          </div>
        )}
      </div>
      {!cycle ? <div className="panel pad empty-start"><p>평가 회차가 없습니다.</p></div> : <Body key={cycle.id} cycle={cycle} ids={ids} setIds={setIds} pickable={canReport} />}
      {cycle && bulk && <BulkDownload cycle={cycle} ids={ids} onClose={() => setBulk(false)} />}
    </div>
  )
}

function Body({ cycle, ids, setIds, pickable }: { cycle: Cycle; ids: string[]; setIds: (x: string[]) => void; pickable: boolean }) {
  const s = useAppState()
  const kpiOn = !!cycle.kpiBlend?.enabled // 이 회차의 실제 반영 설정
  const depts = [...new Map(cycle.targets.map((t) => [t.departmentId, t.departmentName])).entries()]
  // 고정 순서(D-111): 팀 가나다순 → 팀 안에서 직급 목록 순서(임원·팀장·사원) → 이름순. 머리글 정렬 없음
  depts.sort((a, b) => a[1].localeCompare(b[1], 'ko'))
  const posRank = (t: TargetSnapshot) => { const i = positionsOf(s).findIndex((p) => p.name === targetPosition(s, cycle, t)); return i < 0 ? 99 : i }
  return (
    <>
      {depts.map(([deptId, deptName]) => {
        const targets = cycle.targets.filter((t) => t.departmentId === deptId)
        const rows = targets.sort((a, b) => posRank(a) - posRank(b) || a.name.localeCompare(b.name, 'ko')).map((t) => ({ t, r: personResult(s, cycle, t.employeeId)! }))
        const teamIds = rows.map((x) => x.t.employeeId)
        const n = teamIds.filter((id) => ids.includes(id)).length
        return (
          <section className="panel result-dept" key={deptId} aria-label={`${deptName} 결과`}>
            <DeptHead cycle={cycle} deptId={deptId} deptName={deptName} count={targets.length} />
            <div className="table-wrap" tabIndex={0}>
              <table className="tbl result-tbl">
                <thead>
                  <tr>
                    {pickable && <th className="c-pick"><input type="checkbox" aria-label={`${deptName} 전체 선택`} checked={n === teamIds.length} ref={(el) => { if (el) el.indeterminate = n > 0 && n < teamIds.length }}
                      onChange={(e) => setIds(e.target.checked ? [...new Set([...ids, ...teamIds])] : ids.filter((id) => !teamIds.includes(id)))} /></th>}
                    <th className="c-team">팀</th><th className="c-pos">직급</th><th className="c-name">이름</th>
                    <th className="num c-score">개인 평가 점수</th>
                    {kpiOn && <th className="num c-score">팀 KPI</th>}{/* D-168: 'KPI 반영 후 점수' 열 제거 — 최종 점수와 겹침 */}
                    <th className="num c-score">최종 점수</th><th className="center c-grade">최종 등급</th>
                    <th className="c-btn"><span className="sr-only">상세</span></th><th className="c-btn"><span className="sr-only">리포트</span></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(({ t, r }) => <ResultRow key={t.employeeId} cycle={cycle} t={t} r={r} kpiOn={kpiOn} pick={pickable ? { on: ids.includes(t.employeeId), set: (v) => setIds(v ? [...ids, t.employeeId] : ids.filter((x) => x !== t.employeeId)) } : undefined} />)}
                </tbody>
              </table>
            </div>
          </section>
        )
      })}
    </>
  )
}

/** 점수가 없을 때의 짧은 상태 표시 — 0점이나 정상 점수처럼 보이지 않게 */
const Pending = ({ text }: { text: string }) => <span className="chip stage todo">{text}</span>

function ResultRow({ cycle, t, r, kpiOn, pick }: { cycle: Cycle; t: TargetSnapshot; r: PersonResult; kpiOn: boolean; pick?: { on: boolean; set: (v: boolean) => void } }) {
  const s = useAppState()
  const c = r.combined
  const baseState = r.stages.some((x) => !x.submitted) ? '미완료' : '계산 안 됨'
  return (
    <tr className={pick?.on ? 'picked' : ''}>
      {pick && <td className="c-pick"><input type="checkbox" aria-label={`${t.name} 선택`} checked={pick.on} onChange={(e) => pick.set(e.target.checked)} /></td>}
      <td>{t.teamName}</td><td>{targetPosition(s, cycle, t)}</td><td><b>{t.name}</b></td>
      <td className="num">{c.base !== null ? fmt(c.base) : <Pending text={baseState} />}</td>
      {kpiOn && (
        <>
          {/* KPI는 팀별 선택 항목(D-074): 유효한 KPI가 없으면 — */}
          <td className="num">{r.kpi !== null ? fmt(r.kpi) : <span className="na-dash" aria-label="없음">—</span>}</td>
        </>
      )}
      <td className="num final">{c.final !== null ? fmt(c.final) : <span className="muted">—</span>}</td>
      <td className="center"><b>{r.ceoGrade ?? '—'}</b></td>
      <td><Link className="btn small" to={`/admin/results/${t.employeeId}?from=results`}>상세</Link></td>
      <td>{can(s.session.role, 'reportPreview') && <Link className="btn small" to={`/admin/report/${t.employeeId}?from=results`}>리포트</Link>}</td>
    </tr>
  )
}

/** 팀 제목 + 인원. 팀 전체 일괄 점수 조정(버튼·창)은 제거(D-094) — 이미 저장된 팀 보정값·변경 기록은 그대로 점수에 반영·보존 */
function DeptHead({ deptName, count }: { cycle: Cycle; deptId: string; deptName: string; count: number }) {
  return (
    <div className="result-dept-head">
      <div className="row">
        <h2>{deptName}</h2>
        <span className="muted">{count}명</span>
      </div>
    </div>
  )
}
