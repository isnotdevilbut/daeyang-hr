import { Link } from 'react-router-dom'
import { useAppState } from '../../data/store'
import { can } from '../../domain/permissions'
import { cycleLabel } from '../../domain/cycle'
import { assignmentCell, cycleClosed, isActiveAssignment, statusOf } from '../../domain/progress'
import { t as tr, useLang } from '../../i18n'
import { Empty, Forbidden, StatusChip } from '../../components/ui'
import ExecTasks from './ExecTasks'
import { sortRows, SortTh, useSort } from '../../components/sort'

export default function MyTasks() {
  const s = useAppState()
  const [lang] = useLang() // 평가 참여자 화면 언어 (머리글에서 선택, D-075)
  if (!can(s.session.role, 'evaluate')) return <Forbidden lang={lang} />
  if (s.session.role === 'exec') return <ExecTasks /> // 임원: 팀별 카드 화면 (D-062·D-065). 팀장·직원 화면은 그대로
  const [sort, onSort] = useSort()
  const me = s.session.personaId
  // 본인에게 배정된 자기평가 (임원 자기평가 여부는 미정 — 배정된 것만 보여 준다)
  const mine = s.cycles.flatMap((c) => c.assignments.filter((a) => a.evaluatorId === me && a.direction === 'self' && isActiveAssignment(a)).map((a) => ({ c, a })))
  // 내가 평가할 사람
  const rows0 = s.cycles.flatMap((c) =>
    c.assignments
      .filter((a) => a.evaluatorId === me && a.direction === 'down' && isActiveAssignment(a))
      .map((a) => ({ c, a, t: c.targets.find((x) => x.employeeId === a.targetId)!, cell: assignmentCell(c, s.responses, a) })),
  )
  // 머리글 정렬 — 상태는 미완료(미시작·작성 중·대기) 먼저 < 완료
  const rows = sortRows(rows0, sort, (r, k) => (k === 'team' ? r.t.teamName : k === 'name' ? r.t.name : Number(r.cell === 'submitted')))

  return (
    <div className="page">
      <div className="page-head"><h1>{tr('nav.myEval', lang)}</h1></div>

      {mine.length > 0 && (
        <section className="panel">
          <div className="panel-head"><h2>{tr('list.mySelf', lang)}</h2></div>
          {/* 휴대폰에서도 작성 버튼이 화면 안에 보이도록 표 대신 한 줄 목록 */}
          <ul className="self-list">
            {mine.map(({ c, a }) => {
              const st = statusOf(s.responses, a.id)
              return (
                <li key={a.id}>
                  <b>{cycleLabel(c)}</b>
                  {/* 마감 회차(D-093): 미제출은 '마감'(작성 버튼 없음), 제출은 완료 + 마감 표시. 응답 상태는 그대로 */}
                  {cycleClosed(c) && st !== 'submitted' ? <span className="chip locked">{tr('status.closed', lang)}</span> : <StatusChip status={st} lang={lang} />}
                  {cycleClosed(c) && st === 'submitted' && <span className="chip na tag">{tr('status.closed', lang)}</span>}
                  {(!cycleClosed(c) || st === 'submitted') && <Link className={`btn ${st === 'submitted' ? '' : 'primary'}`} to={`/eval/self/${a.id}`}>{st === 'submitted' ? tr('btn.viewSubmitted', lang) : st === 'draft' ? tr('btn.continue', lang) : tr('btn.start', lang)}</Link>}
                </li>
              )
            })}
          </ul>
        </section>
      )}

      {(rows.length > 0 || mine.length === 0) && <section className="panel">
        <div className="panel-head"><h2>{mine.length > 0 ? tr('list.team', lang) : tr('list.assigned', lang)} <span className="muted">{tr('count.items', lang, { n: rows.length })}</span></h2></div>
        {rows.length === 0 ? <Empty>{tr('list.none', lang)}</Empty> : (
          <div className="table-wrap">
            {/* D-090: 팀·이름·상태·버튼만(회차·직급·평가 유형 열 제거 — 데이터는 그대로). 휴대폰에서는 한 사람 = 한 묶음(이름·팀 / 상태·버튼) */}
            <table className="tbl org-tbl task-tbl">
              <thead><tr><SortTh k="team" sort={sort} onSort={onSort}>{tr('list.teamCol', lang)}</SortTh><SortTh k="name" sort={sort} onSort={onSort}>{tr('list.target', lang)}</SortTh><SortTh k="st" sort={sort} onSort={onSort}>{tr('list.status', lang)}</SortTh><th><span className="sr-only">{tr('list.write', lang)}</span></th></tr></thead>
              <tbody>
                {rows.map(({ c, a, t, cell }) => {
                  const closed = cycleClosed(c)
                  return (
                  <tr key={a.id}>
                    <td className="tk-team">{t.teamName}</td>
                    <td className="tk-name"><b>{t.name}</b></td>
                    <td className="tk-st">
                      {closed && cell !== 'submitted' ? <span className="chip locked">{tr('status.closed', lang)}</span> : <StatusChip status={cell} lang={lang} />}
                      {closed && cell === 'submitted' && <span className="chip na tag">{tr('status.closed', lang)}</span>}
                      {!closed && cell === 'locked' && <span className="muted tk-wait">{tr('list.afterPrev', lang)}</span>}
                    </td>
                    <td className="tk-act">{cell !== 'locked' && (!closed || cell === 'submitted') && <Link className={`btn small ${cell === 'submitted' ? '' : 'primary'}`} to={`/eval/${a.id}`}>{cell === 'submitted' ? tr('btn.viewSubmitted', lang) : tr('btn.evaluate', lang)}</Link>}</td>
                  </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>}
    </div>
  )
}
