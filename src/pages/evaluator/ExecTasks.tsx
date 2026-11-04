// 임원 "내 평가" (D-062·D-065): 선택 회차에서 이 임원에게 배정된 평가만, 팀별 카드로.
// 단계 번호는 보이지 않지만 순서·선행 제출 조건은 그대로(assignmentCell) — 대기 항목은 열 수 없다.
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAppState } from '../../data/store'
import { cycleLabel } from '../../domain/cycle'
import { assignmentCell, cycleClosed, isActiveAssignment, type CellStatus } from '../../domain/progress'
import type { Assignment, Cycle, Lang, TargetSnapshot } from '../../domain/types'
import { t as tr, tierText, useLang, type TKey } from '../../i18n'
import { targetPosition } from '../../domain/catalog'

type Filter = 'all' | 'open' | 'done'
const FILTERS: [Filter, TKey][] = [['all', 'exec.all'], ['open', 'exec.open'], ['done', 'exec.done']]
const KEY = 'daeyang-hr-exec-tasks' // 회차·필터·스크롤·마지막으로 본 미완료 목록 (이 탭, 로그인한 임원별)

type Row = { a: Assignment; t: TargetSnapshot; cell: CellStatus }
type Saved = { cycleId?: string; filter?: Filter; scroll?: number; open?: string[] }
const load = (me: string): Saved => { try { return JSON.parse(sessionStorage.getItem(`${KEY}:${me}`) ?? '{}') } catch { return {} } }
const save = (me: string, v: Saved) => { try { sessionStorage.setItem(`${KEY}:${me}`, JSON.stringify({ ...load(me), ...v })) } catch { /* 무시 */ } }

const STATUS: Record<'notStarted' | 'draft' | 'locked' | 'submitted', { chip: string; label: TKey; btn?: TKey }> = {
  notStarted: { chip: 'stage todo', label: 'status.open', btn: 'btn.evaluate' },
  draft: { chip: 'draft', label: 'status.draft', btn: 'btn.continue' },
  locked: { chip: 'locked', label: 'status.locked' }, // 선행 평가가 끝나지 않음 → 작성 버튼 없음
  submitted: { chip: 'stage done', label: 'status.submitted', btn: 'btn.viewSubmitted' },
}

export default function ExecTasks() {
  const s = useAppState()
  const [lang] = useLang() // 평가 참여자 화면 언어 (D-075)
  const me = s.session.personaId ?? ''
  // 이 임원에게 실제로 배정된 평가가 있는 회차만 (여러 회차를 한 목록에 섞지 않음)
  const cycles = s.cycles.filter((c) => c.assignments.some((a) => a.evaluatorId === me && isActiveAssignment(a)))
  const saved = load(me)
  const initial = cycles.find((c) => c.id === saved.cycleId) ?? cycles.find((c) => c.status === '진행') ?? cycles.at(-1)
  const [cycleId, setCycleId] = useState(initial?.id ?? '')
  const [filter, setFilter] = useState<Filter>(saved.filter ?? 'open') // 기본: 미완료
  useEffect(() => { save(me, { cycleId, filter }) }, [me, cycleId, filter])
  const cycle = cycles.find((c) => c.id === cycleId)
  return (
    <div className="page exec-page">
      <div className="page-head">
        <h1>{tr('nav.myEval', lang)}</h1>
        {cycles.length > 1 && cycle && (
          <div className="cycle-pick">
            <label>
              <span className="pick-label">{tr('list.cycle', lang)}</span>
              <select value={cycle.id} onChange={(e) => setCycleId(e.target.value)}>
                {cycles.map((c) => <option key={c.id} value={c.id}>{cycleLabel(c)}</option>)}
              </select>
            </label>
          </div>
        )}
      </div>
      {!cycle ? <section className="panel pad"><p className="muted" style={{ margin: 0 }}>{tr('list.none', lang)}</p></section>
        : <Body key={cycle.id} cycle={cycle} me={me} filter={filter} setFilter={setFilter} lang={lang} />}
    </div>
  )
}

function Body({ cycle, me, filter, setFilter, lang }: { cycle: Cycle; me: string; filter: Filter; setFilter: (f: Filter) => void; lang: Lang }) {
  const closed = cycleClosed(cycle) // 마감·확정 회차(D-093): 미제출은 '마감'·작성 버튼 없음, 제출은 보기만
  const s = useAppState()
  const rows: Row[] = useMemo(
    () => cycle.assignments
      .filter((a) => a.evaluatorId === me && a.direction !== 'self' && isActiveAssignment(a))
      .filter((a) => closed || !!s.employees.find((e) => e.id === a.targetId)?.active) // D-207: 퇴사 처리된 대상자는 바로 뺌(기록은 그대로)
      .map((a) => ({ a, t: cycle.targets.find((x) => x.employeeId === a.targetId)!, cell: assignmentCell(cycle, s.responses, a) }))
      .filter((r) => r.t),
    [cycle, me, s.responses, s.employees, closed],
  )
  // 본인 자기평가 — 이 회차에서 켜진 경우만 (D-068). 평가자로서의 작성(3단계)과는 별개로 잠기지 않는다
  const self = cycle.assignments.find((a) => a.evaluatorId === me && a.targetId === me && a.direction === 'self' && isActiveAssignment(a))
  const selfCell = self ? assignmentCell(cycle, s.responses, self) : null
  const total = rows.length
  const done = rows.filter((r) => r.cell === 'submitted').length
  const open = total - done

  // 지난번에 미완료였다가 지금 제출된 평가 → 짧은 제출 안내 (작성 화면에서 돌아왔을 때)
  const [justDone] = useState<string[]>(() => {
    const prev = load(me).open
    return prev ? rows.filter((r) => r.cell === 'submitted' && prev.includes(r.a.id)).map((r) => r.t.name) : []
  })
  useEffect(() => { save(me, { open: rows.filter((r) => r.cell !== 'submitted').map((r) => r.a.id) }) }, [me, rows])
  // 작성 화면에서 돌아오면 목록 위치 복원
  useEffect(() => {
    const y = load(me).scroll
    if (y) { save(me, { scroll: 0 }); requestAnimationFrame(() => window.scrollTo(0, y)) }
  }, [])

  const shown = rows.filter((r) => (filter === 'all' ? true : filter === 'open' ? r.cell !== 'submitted' : r.cell === 'submitted'))
  // 팀(회차 스냅샷의 조직 단위 ID) → 카드. 카드 안: 팀장 먼저, 같은 그룹은 이름순 (확정된 이전 회차는 그때의 단위·팀)
  const depts = [...new Map(rows.map((r) => [r.t.departmentId, r.t.departmentName])).entries()].sort((x, y) => x[1].localeCompare(y[1], 'ko'))
  const cards = depts
    .map(([id, name]) => {
      const all = rows.filter((r) => r.t.departmentId === id)
      const list = shown.filter((r) => r.t.departmentId === id).sort((x, y) =>
        x.t.teamName.localeCompare(y.t.teamName, 'ko') || Number(y.t.isTeamLead) - Number(x.t.isTeamLead) || x.t.name.localeCompare(y.t.name, 'ko'))
      return { id, name, list, done: all.filter((r) => r.cell === 'submitted').length, total: all.length, multiTeam: new Set(all.map((r) => r.t.teamName)).size > 1 }
    })
    .filter((c) => c.list.length > 0)

  return (
    <>
      {self && selfCell && (
        <section className="panel exec-self" aria-label={tr('list.mySelf', lang)}>
          <div className="who"><b>{tr('list.mySelf', lang)}</b><span className="sub">{tr('exec.selfNote', lang)}</span></div>
          {closed && selfCell !== 'submitted'
            ? <span className="chip locked">{tr('status.closed', lang)}</span>
            : <span className={`chip ${STATUS[selfCell as keyof typeof STATUS].chip}`}>{tr(STATUS[selfCell as keyof typeof STATUS].label, lang)}</span>}
          {closed && selfCell === 'submitted' && <span className="chip na tag">{tr('status.closed', lang)}</span>}
          {(!closed || selfCell === 'submitted') && <Link className={`btn small ${selfCell === 'submitted' ? '' : 'primary'}`} to={`/eval/self/${self.id}`}>{selfCell === 'submitted' ? tr('btn.viewSubmitted', lang) : selfCell === 'draft' ? tr('btn.continue', lang) : tr('btn.start', lang)}</Link>}
        </section>
      )}
      {/* 요약 숫자 = 필터 버튼 (D-063). 숫자는 필터와 무관하게 이 회차의 전체 배정 기준 */}
      <div className="exec-bar" role="group" aria-label={tr('exec.filter', lang)}>
        {FILTERS.map(([k, label]) => (
          <button key={k} type="button" className={`exec-filter ${k}`} aria-pressed={filter === k} onClick={() => setFilter(k)}>
            <span className="l">{tr(label, lang)}</span><span className="n">{{ all: total, open, done }[k]}</span>
          </button>
        ))}
      </div>
      {justDone.length > 0 && <p className="feedback ok exec-flash" role="status">✓ {tr('exec.submittedFlash', lang, { names: justDone.join(', ') })}</p>}

      {total === 0 && self ? null : cards.length === 0 ? (
        <section className="panel pad exec-empty">
          {filter === 'open' && total > 0
            ? <><p>{tr('exec.allDone', lang)}</p><button className="btn" onClick={() => setFilter('all')}>{tr('exec.showAll', lang)}</button></>
            : <p>{filter === 'done' ? tr('exec.noneDone', lang) : tr('list.none', lang)}</p>}
        </section>
      ) : (
        <div className="dept-grid">
          {cards.map((c) => (
            <section className="panel dept-card" key={c.id} aria-label={tr('exec.cardLabel', lang, { team: c.name })}>
              <div className="dept-card-head"><h2>{c.name}</h2><span className="muted">{tr('exec.cardDone', lang, { d: c.done, t: c.total })}</span></div>
              <ul className="exec-list">
                {c.list.map((r) => {
                  const st = STATUS[r.cell as keyof typeof STATUS]
                  return (
                    <li key={r.a.id} className={r.t.isTeamLead ? 'lead' : ''}>
                      <div className="who">
                        <b>{r.t.name}</b>{r.t.isTeamLead && <span className="chip info tag">{tierText('팀장', lang)}</span>}
                        <span className="sub">{tierText(targetPosition(s, cycle, r.t), lang)}{c.multiTeam && ` · ${r.t.teamName}`}</span>
                      </div>
                      {closed && r.cell !== 'submitted'
                        ? <span className="chip locked">{tr('status.closed', lang)}</span>
                        : <span className={`chip ${st.chip}`}>{tr(st.label, lang)}{closed && <span className="sr-only"> · {tr('status.closed', lang)}</span>}</span>}
                      {st.btn && (!closed || r.cell === 'submitted')
                        ? <Link className={`btn small ${r.cell === 'submitted' ? '' : 'primary'}`} to={`/eval/${r.a.id}`} onClick={() => save(me, { scroll: window.scrollY })}>{tr(st.btn, lang)}</Link>
                        : <span className="btn-slot" aria-hidden />}
                    </li>
                  )
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </>
  )
}
