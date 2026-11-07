import { Link } from 'react-router-dom'
import { useAppState } from '../../data/store'
import { can } from '../../domain/permissions'
import { cycleLabel } from '../../domain/cycle'
import { assignmentCell, cycleClosed, isActiveAssignment, isUpward, personSnap, statusOf, type CellStatus } from '../../domain/progress'
import type { Assignment, Cycle, Lang, TargetSnapshot } from '../../domain/types'
import { t as tr, tierText, useLang } from '../../i18n'
import { targetPosition } from '../../domain/catalog'
import { Empty, Forbidden, StatusChip } from '../../components/ui'
import ExecTasks from './ExecTasks'

export default function MyTasks() {
  const s = useAppState()
  const [lang] = useLang() // 평가 참여자 화면 언어 (머리글에서 선택, D-075)
  if (!can(s.session.role, 'evaluate')) return <Forbidden lang={lang} />
  if (s.session.role === 'exec') return <ExecTasks /> // 임원: 팀별 카드 화면 (D-062·D-065). 팀장·직원 화면은 그대로
  const me = s.session.personaId
  // 본인에게 배정된 자기평가 (임원 자기평가 여부는 미정 — 배정된 것만 보여 준다)
  const mine = s.cycles.flatMap((c) => c.assignments.filter((a) => a.evaluatorId === me && a.direction === 'self' && isActiveAssignment(a)).map((a) => ({ c, a })))
  // 내가 평가할 사람
  const rowsOf = (pick: (a: Assignment) => boolean) => s.cycles.flatMap((c) =>
    c.assignments
      .filter((a) => a.evaluatorId === me && pick(a))
      .filter((a) => cycleClosed(c) || !!s.employees.find((e) => e.id === a.targetId)?.active) // D-207: 진행 중 평가는 퇴사 처리된 사람을 평가하는 일을 바로 뺌(기록은 그대로)
      .map((a) => ({ c, a, t: personSnap(s, c, a.targetId)!, cell: assignmentCell(c, s.responses, a) })) // 상향평가 대상 임원은 대상자 명단에 없을 수 있음(D-187)
      .filter((r) => !!r.t),
  )
  const rows = rowsOf((a) => a.direction === 'down' && isActiveAssignment(a))
  // 상향평가(D-114·D-187): 사원이 소속 팀 팀장·임원을, 팀장이 소속 팀 임원을 평가 — 자기평가 아래 따로
  const ups = rowsOf(isUpward)

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

      {ups.length > 0 && <section className="panel">
        <div className="panel-head"><h2>{tr('list.upward', lang)} <span className="muted">{tr('count.items', lang, { n: ups.length })}</span></h2></div>
        <TaskTable rows={ups} lang={lang} />
      </section>}

      {(rows.length > 0 || (mine.length === 0 && ups.length === 0)) && <section className="panel">
        <div className="panel-head"><h2>{mine.length > 0 || ups.length > 0 ? tr('list.team', lang) : tr('list.assigned', lang)} <span className="muted">{tr('count.items', lang, { n: rows.length })}</span></h2></div>
        {rows.length === 0 ? <Empty>{tr('list.none', lang)}</Empty> : <TaskTable rows={rows} lang={lang} />}
      </section>}
    </div>
  )
}

type TaskRow = { c: Cycle; a: Assignment; t: TargetSnapshot; cell: CellStatus }
/** 작성할 평가 목록(팀원 평가·팀원→팀장평가 공통) */
function TaskTable({ rows, lang }: { rows: TaskRow[]; lang: Lang }) {
  const s = useAppState()
  return (
    <div className="table-wrap">
      {/* D-090: 팀·직급(D-243)·이름·상태·버튼(회차·평가 유형 열 제거 — 데이터는 그대로). 휴대폰에서는 한 사람 = 한 묶음(이름·팀 / 상태·버튼) */}
      <table className="tbl org-tbl task-tbl">
        <thead><tr><th>{tr('list.teamCol', lang)}</th><th>{tr('list.tier', lang)}</th><th>{tr('list.target', lang)}</th><th>{tr('list.status', lang)}</th><th><span className="sr-only">{tr('list.write', lang)}</span></th></tr></thead>
        <tbody>
          {rows.map(({ c, a, t, cell }) => {
            const closed = cycleClosed(c)
            return (
            <tr key={a.id}>
              <td className="tk-team">{t.teamName}</td>
              <td className="tk-tier">{tierText(targetPosition(s, c, t), lang)}</td>
              <td className="tk-name"><b>{t.name}</b></td>
              <td className="tk-st">
                {closed && cell !== 'submitted' ? <span className="chip locked">{tr('status.closed', lang)}</span> : <StatusChip status={cell} lang={lang} />}
                {closed && cell === 'submitted' && <span className="chip na tag">{tr('status.closed', lang)}</span>}
              </td>
              <td className="tk-act">{cell !== 'locked' && (!closed || cell === 'submitted') && <Link className={`btn small ${cell === 'submitted' ? '' : 'primary'}`} to={`/eval/${a.id}`}>{cell === 'submitted' ? tr('btn.viewSubmitted', lang) : tr('btn.evaluate', lang)}</Link>}</td>
            </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
