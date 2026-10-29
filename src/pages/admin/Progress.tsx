import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAppState } from '../../data/store'
import { useSelectedCycle } from '../../data/hooks'
import { can } from '../../domain/permissions'
import { cycleLabel } from '../../domain/cycle'
import { progressCounts, progressFilter, progressRows, type CardPick, type CellStatus, type ProgressCell, type WriteSummary } from '../../domain/progress'
import type { AppState, Cycle } from '../../domain/types'
import { TIERS } from '../../domain/org'
import { positionById, positionName, positionsOf } from '../../domain/catalog'
import { Empty, Forbidden } from '../../components/ui'

const FILTER_KEY = 'daeyang-hr-progress-filters'
const SCROLL_KEY = 'daeyang-hr-progress-scroll'

export default function Progress() {
  const s = useAppState()
  const [cycle, selectCycle, cycles] = useSelectedCycle()
  if (!can(s.session.role, 'viewProgress')) return <Forbidden />
  return (
    <div className="page">
      <div className="page-head">
        <h1>진행 현황</h1>
        {cycle && (
          <div className="cycle-pick">
            <label>
              <span className="pick-label">평가 회차</span>
              <select value={cycle.id} onChange={(e) => selectCycle(e.target.value)}>
                {cycles.map((c) => <option key={c.id} value={c.id}>{cycleLabel(c)}</option>)}
              </select>
            </label>
            <span className="due">마감 <b>{cycle.dueDate || '미정'}</b></span>
          </div>
        )}
      </div>
      {!cycle ? <Empty>평가 회차가 없습니다. 회차·배정 메뉴에서 회차를 만들어 주세요.</Empty> : <Body key={cycle.id} s={s} cycle={cycle} />}
    </div>
  )
}

// 직무 필터는 D-074에서 제거 — 이전에 저장된 job 값은 읽지 않는다(숨은 필터로 남지 않게)
type Saved = { cycleId?: string; q?: string; tier?: string; onlyOpen?: boolean; pick?: CardPick }

function Body({ s, cycle }: { s: AppState; cycle: Cycle }) {
  const max = 3 // 작성 단계는 1 자기·2 팀장·3 임원으로 고정
  // 카드 선택·검색·필터는 이 브라우저 탭에 기억 → 상세 화면에서 돌아와도 유지. 다른 회차로 바꾸면 초기화
  const saved: Saved = (() => {
    try { const v = JSON.parse(sessionStorage.getItem(FILTER_KEY) ?? '{}'); return v.cycleId === cycle.id ? v : {} } catch { return {} }
  })()
  const validPick = (p?: CardPick): CardPick => (p?.kind === 'stage' ? (p.order >= 1 && p.order <= max ? p : null) : p?.kind === 'complete' || p?.kind === 'all' ? p : null)
  const [q, setQ] = useState<string>(saved.q ?? '')
  // 직급 필터 = 직급 ID (D-080). 이전에 저장된 값이 직급 ID가 아니면 읽지 않음(숨은 필터 방지)
  const [tier, setTier] = useState<string>(positionById(s, saved.tier) ? saved.tier! : '')
  const [onlyOpen, setOnlyOpen] = useState<boolean>(!!saved.onlyOpen)
  const [pick, setPick] = useState<CardPick>(validPick(saved.pick))
  useEffect(() => { try { sessionStorage.setItem(FILTER_KEY, JSON.stringify({ cycleId: cycle.id, q, tier, onlyOpen, pick })) } catch { /* 무시 */ } }, [cycle.id, q, tier, onlyOpen, pick])
  // 상세에서 돌아오면 그때의 스크롤 위치로
  useEffect(() => {
    try {
      const y = sessionStorage.getItem(SCROLL_KEY)
      if (y !== null) { sessionStorage.removeItem(SCROLL_KEY); requestAnimationFrame(() => window.scrollTo(0, Number(y))) }
    } catch { /* 무시 */ }
  }, [])
  // 진행 현황(D-076): 행 = 평가 참여자(받는 평가 또는 작성 업무가 있는 직원), 칸 = 직급에 따라 받는 평가 상태 또는 작성 업무 건수.
  // 카드 숫자는 모두 사람 수이며 아래 검색·필터와 무관하게 회차 전체 기준
  const rows = useMemo(
    () => progressRows(s, cycle)
      .sort((a, b) => a.t.teamName.localeCompare(b.t.teamName, 'ko') || TIERS.indexOf(a.tier) - TIERS.indexOf(b.tier) || a.t.name.localeCompare(b.t.name, 'ko')),
    [cycle, s.responses, s.employees, s.teams], // eslint-disable-line react-hooks/exhaustive-deps
  )
  const empPos = (id: string) => s.employees.find((e) => e.id === id)?.positionId
  const posText = (id: string) => { const e = s.employees.find((x) => x.id === id); return e ? positionName(s, e) : '' }
  const needle = q.trim()
  const counts = useMemo(() => progressCounts(rows), [rows])
  const scope = rows.filter((r) => progressFilter(r, pick, false)) // 카드가 정한 범위
  const filtered = scope.filter(
    (r) =>
      (!needle || r.t.name.includes(needle) || r.t.teamName.includes(needle) || r.t.empNo.includes(needle)) &&
      (!tier || empPos(r.t.employeeId) === tier) &&
      progressFilter(r, pick, onlyOpen),
  )
  const stageOn = pick?.kind === 'stage' ? pick.order : null
  const wrapRef = useRef<HTMLDivElement>(null)
  const [glow, setGlow] = useState<{ left: number; width: number; height: number } | null>(null)
  // 테두리 위치 = 선택 열 머리글의 위치·폭, 높이 = 표 전체. 표·창 크기·필터가 바뀌면 다시 잼
  useLayoutEffect(() => {
    const wrap = wrapRef.current
    if (!wrap) return
    const measure = () => {
      const th = stageOn ? wrap.querySelector<HTMLElement>(`th[data-col="${stageOn}"]`) : null
      const tbl = wrap.querySelector<HTMLElement>('table')
      setGlow(th && tbl ? { left: th.offsetLeft + 1, width: th.offsetWidth - 2, height: tbl.offsetHeight } : null)
    }
    measure()
    const ro = new ResizeObserver(measure); ro.observe(wrap); const tbl = wrap.querySelector('table'); if (tbl) ro.observe(tbl)
    return () => ro.disconnect()
  }, [stageOn, filtered.length])
  // 단계 카드는 이미 "그 단계 미완료"만 보여 주므로 미완료만은 적용된 것으로 표시(충돌 없음)
  const filtering = !!needle || !!tier || (onlyOpen && !stageOn)
  const nameCount = new Map<string, number>()
  rows.forEach((r) => nameCount.set(r.t.name, (nameCount.get(r.t.name) ?? 0) + 1))
  const frac = (a: number, b: number) => (b === 0 ? <span className="n-na">배정 없음</span> : <><span className="nv">{a}</span><span className="of"> / {b}</span></>)

  // 카드 선택(한 번에 하나): 범위가 바로 보이도록 검색·직급·미완료만은 초기화(그 뒤 함께 쓸 수 있음). 같은 카드를 다시 누르면 해제
  const clearFilters = () => { setQ(''); setTier(''); setOnlyOpen(false) }
  const same = (p: CardPick) => JSON.stringify(p) === JSON.stringify(pick)
  const choose = (p: CardPick) => { clearFilters(); setPick(same(p) ? null : p) }
  const changeOnlyOpen = (v: boolean) => { setOnlyOpen(v); if (v && pick?.kind === 'complete') setPick(null) } // 완료 카드와 모순 → 해제
  const title = pick?.kind === 'stage' ? `${pick.order}단계 미완료` : pick?.kind === 'complete' ? '평가 업무 완료' : '평가 참여자'
  const scopeLabel = pick?.kind === 'stage' ? `${pick.order}단계 미완료` : pick?.kind === 'complete' ? '완료' : '전체'

  return (
    <>
      <div className="stats5" role="group" aria-label="진행 요약 (선택 회차 전체 기준) — 눌러서 명단 보기" onPointerMove={cardGlow}>
        <button type="button" className="stat" aria-pressed={pick?.kind === 'all'} onClick={() => choose({ kind: 'all' })}><span className="l">평가 참여자</span><span className="n"><span className="nv">{counts.participants}</span><span className="of">명</span></span></button>
        <button type="button" className="stat" aria-pressed={pick?.kind === 'complete'} onClick={() => choose({ kind: 'complete' })}><span className="l">평가 업무 완료</span><span className="n">{frac(counts.complete, counts.participants)}<span className="of">명</span></span></button>
        {counts.byStage.map((b) => (
          <button type="button" className="stat" key={b.order} aria-pressed={stageOn === b.order} onClick={() => choose({ kind: 'stage', order: b.order })}><span className="l">{b.order}단계 완료</span><span className="n">{frac(b.done, b.writers)}<span className="of">명</span></span></button>
        ))}
      </div>

      <section className="panel" aria-label="직원별 진행 현황">
        <div className="list-head" aria-live="polite">
          <h2>{title} · <b>{scope.length}</b>명</h2>
          {filtering && <span className="muted">표시 <b>{filtered.length}</b>명 / {scopeLabel} {scope.length}명</span>}
        </div>
        <div className="filters">
          <input type="search" placeholder="이름·팀·사번 검색" value={q} onChange={(e) => setQ(e.target.value)} aria-label="이름·팀·사번 검색" />
          <select value={tier} onChange={(e) => setTier(e.target.value)} aria-label="직급">
            <option value="">전체 직급</option>
            {positionsOf(s).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <label className={`check ${stageOn ? 'is-implied' : ''}`} title={stageOn ? '단계 카드를 고르면 그 단계 미완료만 보입니다' : undefined}><input type="checkbox" checked={onlyOpen || !!stageOn} disabled={!!stageOn} onChange={(e) => changeOnlyOpen(e.target.checked)} /> 미완료만</label>
          <span className="spacer" />
          {filtering && <button className="btn small" onClick={clearFilters}>필터 초기화</button>}
        </div>
        <div className="table-wrap" ref={wrapRef} tabIndex={0} aria-label="표가 넓으면 옆으로 밀어 보세요">
          {/* 선택된 평가 열 강조(D-086): 제목~마지막 행을 감싸는 연속된 글라스 그라데이션 테두리 한 장 — 안쪽은 비움, 클릭·선택 방해 없음 */}
          <div className={`col-frame ${glow ? 'on' : ''}`} aria-hidden style={glow ? { transform: `translateX(${glow.left}px)`, width: glow.width, height: glow.height } : undefined} />
          <table className="tbl progress-tbl">
            <thead>
              <tr>
                <th className="c-team">팀</th><th className="c-name">이름</th><th className="c-tier">직급</th>
                {STAGE_COLS.map((h, i) => <th key={i} data-col={i + 1} className={`c-eval ${stageOn === i + 1 ? 'col-on' : ''}`}>{h}</th>)}
                <th className="c-act"><span className="sr-only">상세</span></th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={4 + max} className="empty-row">조건에 맞는 참여자가 없습니다.</td></tr>
              ) : filtered.map((r) => (
                <tr key={r.t.employeeId}>
                  <td className="c-team"><span className="cell-in">{r.t.teamName}</span></td>
                  <td className="c-name" title={`사번 ${r.t.empNo}`}>
                    {/* 이름 + 배지를 한 묶음으로 가운데 정렬 (D-087) */}
                    <span className="cell-in name-grp">
                      <b>{r.t.name}</b>
                      {(nameCount.get(r.t.name) ?? 0) > 1 && <span className="muted">({r.t.empNo})</span>}
                      {r.mismatch && <span className="chip draft tag">배정 확인</span>}
                    </span>
                  </td>
                  <td className="c-tier"><span className="cell-in">{posText(r.t.employeeId) || r.tier}</span></td>
                  {r.cells.map((cell, i) => <td key={i} className={`writes c-eval ${stageOn === i + 1 ? 'col-on' : ''}`}><span className="cell-in"><Cell c={cell} /></span></td>)}
                  <td className="c-act">{can(s.session.role, 'viewResults') && <Link className="btn small" to={`/admin/results/${r.t.employeeId}?from=progress`} onClick={() => { try { sessionStorage.setItem(SCROLL_KEY, String(window.scrollY)) } catch { /* 무시 */ } }}>상세</Link>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  )
}

/** 카드 hover 빛 위치 = 커서 위치 (CSS 변수만, D-070) */
function cardGlow(e: React.PointerEvent) {
  if (e.pointerType === 'touch') return
  const b = (e.target as Element).closest<HTMLElement>('button.stat')
  if (!b) return
  const r = b.getBoundingClientRect()
  b.style.setProperty('--cx', `${e.clientX - r.left}px`)
  b.style.setProperty('--cy', `${e.clientY - r.top}px`)
}

/** 열 이름(D-076) — 내부 단계 번호 1·2·3은 그대로 */
const STAGE_COLS = ['자기평가', '팀장평가', '임원평가']

/** 칸: 받는 평가 = 완료/미완료(선행 대기·평가자 미지정도 미완료), 작성 업무 = 건수, 적용 안 됨 — */
function Cell({ c }: { c: ProgressCell }) {
  if (c.kind === 'na') return <span className="na-dash" aria-label="해당 없음">—</span>
  if (c.kind === 'write') return <Writes w={c.w} />
  return <RecvBadge status={c.status} />
}
function RecvBadge({ status }: { status: CellStatus }) {
  if (status === 'unassigned') return <span className="chip stage todo" title="평가자 미지정 — 임원 평가 배정에서 담당을 정하세요">미지정</span> // 미완료로 셈 (D-087)
  return status === 'submitted' ? <span className="chip stage done">✓ 완료</span> : <span className="chip stage todo">미완료</span>
}

/**
 * 단계 칸 = 그 직원이 그 단계에서 작성할 업무(선행 대기도 미완료). 배정 없음 —, 1건 ✓ 완료/미완료,
 * 여러 건 "5/9 완료 · 4건 미완료"(모두 제출이면 초록 "9/9 완료")
 */
function Writes({ w }: { w: WriteSummary }) {
  if (w.total === 0) return <span className="na-dash" aria-label="배정 없음">—</span>
  if (w.total === 1) return w.open ? <span className="chip stage todo">미완료</span> : <span className="chip stage done">✓ 완료</span>
  // 여러 건: "1/2 완료"와 "1건 미완료"를 별도 요소로(가운뎃점 없이 간격으로 구분, 좁으면 위아래) — D-074
  return (
    <span className={`writes-sum ${w.open ? 'open' : 'done'}`}>
      <span className="w-done">{w.done}/{w.total} 완료</span>
      {w.open > 0 && <b className="w-open">{w.open}건 미완료</b>}
    </span>
  )
}
