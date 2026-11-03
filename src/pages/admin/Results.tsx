import { Link } from 'react-router-dom'
import { update, useAppState } from '../../data/store'
import { useSelectedCycle } from '../../data/hooks'
import { can } from '../../domain/permissions'
import { cycleLabel } from '../../domain/cycle'
import { fmt, latestAdjustment, personResult, type PersonResult } from '../../domain/scoring'
import type { AdjustKind, Cycle, TargetSnapshot } from '../../domain/types'
import { Forbidden } from '../../components/ui'
import { positionsOf, targetPosition } from '../../domain/catalog'

export function addAdjustment(cycleId: string, kind: AdjustKind, key: string, value: number | string | null, reason: string, by: string) {
  update((d) => {
    const prev = latestAdjustment(d.adjustments, cycleId, kind, key)
    d.adjustments.push({ id: `adj-${Date.now().toString(36)}`, cycleId, kind, targetKey: key, value, reason, by, at: new Date().toISOString(), before: prev?.value ?? null })
  })
}

export default function Results() {
  const s = useAppState()
  const [cycle, selectCycle, cycles] = useSelectedCycle()
  if (!can(s.session.role, 'viewResults')) return <Forbidden />
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
          </div>
        )}
      </div>
      {!cycle ? <div className="panel pad empty-start"><p>평가 회차가 없습니다.</p></div> : <Body key={cycle.id} cycle={cycle} />}
    </div>
  )
}

function Body({ cycle }: { cycle: Cycle }) {
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
        return (
          <section className="panel result-dept" key={deptId} aria-label={`${deptName} 결과`}>
            <DeptHead cycle={cycle} deptId={deptId} deptName={deptName} count={targets.length} />
            <div className="table-wrap" tabIndex={0}>
              <table className="tbl result-tbl">
                <thead>
                  <tr>
                    <th className="c-team">팀</th><th className="c-pos">직급</th><th className="c-name">이름</th>
                    <th className="num c-score">개인 평가 점수</th>
                    {kpiOn && <><th className="num c-score">팀 KPI</th><th className="num c-score">KPI 반영 후 점수</th></>}
                    <th className="num c-score">최종 점수</th><th className="center c-grade">최종 등급</th>
                    <th className="c-btn"><span className="sr-only">상세</span></th><th className="c-btn"><span className="sr-only">리포트</span></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(({ t, r }) => <ResultRow key={t.employeeId} cycle={cycle} t={t} r={r} kpiOn={kpiOn} />)}
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

function ResultRow({ cycle, t, r, kpiOn }: { cycle: Cycle; t: TargetSnapshot; r: PersonResult; kpiOn: boolean }) {
  const s = useAppState()
  const c = r.combined
  const baseState = r.stages.some((x) => !x.submitted) ? '미완료' : '계산 안 됨'
  return (
    <tr>
      <td>{t.teamName}</td><td>{targetPosition(s, cycle, t)}</td><td><b>{t.name}</b></td>
      <td className="num">{c.base !== null ? fmt(c.base) : <Pending text={baseState} />}</td>
      {kpiOn && (
        <>
          {/* KPI는 팀별 선택 항목(D-074): 유효한 KPI가 없으면 —, 실제로 반영해 계산한 경우에만 반영 후 점수 */}
          <td className="num">{r.kpi !== null ? fmt(r.kpi) : <span className="na-dash" aria-label="없음">—</span>}</td>
          <td className="num">{c.kpiApplied && c.afterKpi !== null ? fmt(c.afterKpi) : <span className="na-dash" aria-label="없음">—</span>}</td>
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
