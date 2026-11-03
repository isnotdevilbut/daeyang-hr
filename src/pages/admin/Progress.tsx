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
// '미완료만' 체크는 D-135에서 제거 — 미완료자 카드로 대신. 이전에 저장된 onlyOpen 값은 읽지 않음(숨은 필터 방지)
type Saved = { cycleId?: string; q?: string; tier?: string; pick?: CardPick }

function Body({ s, cycle }: { s: AppState; cycle: Cycle }) {
  const max = 3 // 작성 단계는 1 자기·2 팀장·3 임원으로 고정
  // 카드 선택·검색·필터는 이 브라우저 탭에 기억 → 상세 화면에서 돌아와도 유지. 다른 회차로 바꾸면 초기화
  const saved: Saved = (() => {
    try { const v = JSON.parse(sessionStorage.getItem(FILTER_KEY) ?? '{}'); return v.cycleId === cycle.id ? v : {} } catch { return {} }
  })()
  // 카드는 전체 대상자·완료자·미완료자 세 가지(D-109). 이전에 기억된 단계 카드 선택은 읽지 않음
  const validPick = (p?: CardPick): CardPick => (p?.kind === 'complete' || p?.kind === 'open' || p?.kind === 'all' ? p : null)
  const [q, setQ] = useState<string>(saved.q ?? '')
  // 직급 필터 = 직급 ID (D-080). 이전에 저장된 값이 직급 ID가 아니면 읽지 않음(숨은 필터 방지)
  const [tier, setTier] = useState<string>(positionById(s, saved.tier) ? saved.tier! : '')
  // 처음 들어오면(이 탭에 저장된 카드 선택 없음) '평가 참여자' 카드가 선택된 상태 — 카드를 눌러 명단을 바꿀 수 있다는 점이 보이게(D-096). 명단은 선택 없음과 같음
  const [pick, setPick] = useState<CardPick>(saved.pick === undefined ? { kind: 'all' } : validPick(saved.pick))
  useEffect(() => { try { sessionStorage.setItem(FILTER_KEY, JSON.stringify({ cycleId: cycle.id, q, tier, pick })) } catch { /* 무시 */ } }, [cycle.id, q, tier, pick])
  // 상세에서 돌아오면 그때의 스크롤 위치로
  useEffect(() => {
    try {
      const y = sessionStorage.getItem(SCROLL_KEY)
      if (y !== null) { sessionStorage.removeItem(SCROLL_KEY); requestAnimationFrame(() => window.scrollTo(0, Number(y))) }
    } catch { /* 무시 */ }
  }, [])
  // 진행 현황(D-076). 순서는 고정(D-107): 팀 가나다순 → 팀 안에서 임원·팀장·사원 → 같은 직급은 이름순. 머리글 정렬 없음: 행 = 평가 참여자(받는 평가 또는 작성 업무가 있는 직원), 칸 = 직급에 따라 받는 평가 상태 또는 작성 업무 건수.
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
      progressFilter(r, pick, false),
  )
  const openOn = pick?.kind === 'open'
  const wrapRef = useRef<HTMLDivElement>(null)
  const [glow, setGlow] = useState<{ left: number; width: number; height: number } | null>(null)
  // 미완료자 카드 선택 중 평가 열 머리글을 누르면 그 열 하나만 테두리(D-119, 다시 누르면 해제). 다른 카드로 바꾸면 해제
  const [colOn, setColOn] = useState<number | null>(null)
  useEffect(() => { if (!openOn) setColOn(null) }, [openOn])
  // 테두리 = 선택 열 머리글의 위치·폭, 높이 = 표 전체. 표·창 크기·필터가 바뀌면 다시 잼
  useLayoutEffect(() => {
    const wrap = wrapRef.current
    if (!wrap) return
    const measure = () => {
      const th = openOn && colOn ? wrap.querySelector<HTMLElement>(`th[data-col="${colOn}"]`) : null
      const tbl = wrap.querySelector<HTMLElement>('table')
      setGlow(th && tbl ? { left: th.offsetLeft + 1, width: th.offsetWidth - 2, height: tbl.offsetHeight } : null)
    }
    measure()
    const ro = new ResizeObserver(measure); ro.observe(wrap); const tbl = wrap.querySelector('table'); if (tbl) ro.observe(tbl)
    return () => ro.disconnect()
  }, [openOn, colOn, filtered.length])
  // 미완료자 카드는 이미 미완료만 보여 주므로 "미완료만"은 적용된 것으로 표시(충돌 없음)
  const filtering = !!needle || !!tier
  const nameCount = new Map<string, number>()
  rows.forEach((r) => nameCount.set(r.t.name, (nameCount.get(r.t.name) ?? 0) + 1))
  const frac = (a: number, b: number) => (b === 0 ? <span className="n-na">배정 없음</span> : <><span className="nv">{a}</span><span className="of"> / {b}</span></>)

  // 카드 선택(한 번에 하나): 범위가 바로 보이도록 검색·직급·미완료만은 초기화(그 뒤 함께 쓸 수 있음). 같은 카드를 다시 누르면 해제
  const clearFilters = () => { setQ(''); setTier('') }
  const same = (p: CardPick) => JSON.stringify(p) === JSON.stringify(pick)
  const choose = (p: CardPick) => { clearFilters(); setPick(same(p) ? null : p) }
  const scopeLabel = pick?.kind === 'open' ? '미완료자' : pick?.kind === 'complete' ? '완료자' : '전체'

  return (
    <>
      {/* D-109: 전체 대상자 / 완료자(받는 평가·작성 업무 모두 제출) / 미완료자(하나라도 미제출) — 누르면 명단 필터(선택 하나·재클릭 해제) */}
      <div className="stats5 stats3" role="group" aria-label="진행 요약 (선택 회차 전체 기준) — 눌러서 명단 보기" onPointerMove={cardGlow}>
        <button type="button" className="stat" aria-pressed={pick?.kind === 'all'} onClick={() => choose({ kind: 'all' })}><span className="l">전체 대상자</span><span className="n"><span className="nv">{counts.participants}</span><span className="of">명</span></span></button>
        <button type="button" className="stat" aria-pressed={pick?.kind === 'complete'} onClick={() => choose({ kind: 'complete' })}><span className="l">완료자</span><span className="n">{frac(counts.complete, counts.participants)}<span className="of">명</span></span></button>
        <button type="button" className="stat" aria-pressed={openOn} onClick={() => choose({ kind: 'open' })}><span className="l">미완료자</span><span className="n">{frac(counts.participants - counts.complete, counts.participants)}<span className="of">명</span></span></button>
      </div>

      <section className="panel" aria-label="직원별 진행 현황">
        {/* D-117: 카드와 겹치는 '전체 대상자 · n명' 제목·범례 제거 — 검색·필터를 쓸 때만 표시 인원을 필터 줄에 */}
        <div className="filters progress-filters">
          <input type="search" placeholder="이름·팀·사번 검색" value={q} onChange={(e) => setQ(e.target.value)} aria-label="이름·팀·사번 검색" />
          <select value={tier} onChange={(e) => setTier(e.target.value)} aria-label="직급">
            <option value="">전체 직급</option>
            {positionsOf(s).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <span className="spacer" />
          {filtering && <span className="muted" aria-live="polite">표시 <b>{filtered.length}</b>명 / {scopeLabel} {scope.length}명</span>}
          {filtering && <button className="btn small" onClick={clearFilters}>필터 초기화</button>}
        </div>
        <div className="table-wrap" ref={wrapRef} tabIndex={0} aria-label="표가 넓으면 옆으로 밀어 보세요">
          {/* 미완료자 카드 선택 중 고른 평가 열 하나를 감싸는 글라스 그라데이션 테두리(D-119, D-086 방식) — 클릭 방해 없음 */}
          <div className={`col-frame ${glow ? 'on' : ''}`} aria-hidden style={glow ? { transform: `translateX(${glow.left}px)`, width: glow.width, height: glow.height } : undefined} />
          <table className="tbl progress-tbl">
            <thead>
              <tr>
                <th className="c-team">팀</th><th className="c-tier">직급</th><th className="c-name">이름</th>
                {STAGE_COLS.map((h, i) => (
                  <th key={i} data-col={i + 1} className={`c-eval ${colOn === i + 1 ? 'col-on' : ''}`}>
                    {openOn ? <button type="button" className="col-pick" aria-pressed={colOn === i + 1} title={`${h} 열 표시`} onClick={() => setColOn(colOn === i + 1 ? null : i + 1)}>{h}</button> : h}
                  </th>
                ))}
                <th className="c-act"><span className="sr-only">상세</span></th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={5 + max} className="empty-row">조건에 맞는 참여자가 없습니다.</td></tr>
              ) : filtered.map((r) => (
                <tr key={r.t.employeeId}>
                  <td className="c-team"><span className="cell-in">{r.t.teamName}</span></td>
                  <td className="c-tier"><span className="cell-in">{posText(r.t.employeeId) || r.tier}</span></td>
                  <td className="c-name" title={`사번 ${r.t.empNo}`}>
                    {/* 이름 + 배지를 한 묶음으로 가운데 정렬 (D-087) */}
                    <span className="cell-in name-grp">
                      <b>{r.t.name}</b>
                      {(nameCount.get(r.t.name) ?? 0) > 1 && <span className="muted">({r.t.empNo})</span>}
                      {r.mismatch && <span className="chip draft tag">배정 확인</span>}
                    </span>
                  </td>
                  {/* 열 순서: 자기평가 · 팀원→팀장평가(1단계 분류, D-114) · 팀장평가 · 임원평가 */}
                  {[r.cells[0], r.up, r.cells[1], r.cells[2]].map((cell, i) => <td key={i} className="writes c-eval"><span className="cell-in"><Cell c={cell} plain={i === 1} /></span></td>)}
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

/** 열 이름(D-076) — 내부 단계 번호 1·2·3은 그대로. 팀원→팀장평가(D-114)는 1단계로 분류해 자기평가 옆 — 사원은 작성할 건, 팀장은 받는 건수 */
const STAGE_COLS = ['자기평가', '팀원→팀장평가', '팀장평가', '임원평가']

/** 칸: 받는 평가 = 완료/미완료(선행 대기·평가자 미지정도 미완료), 작성 업무 = 건수, 적용 안 됨 — */
/** plain = 팀원→팀장평가 열(D-121): 여러 건 'x/y 완료'는 모두 끝나도 초록 대신 굵은 검정 */
function Cell({ c, plain }: { c: ProgressCell; plain?: boolean }) {
  if (c.kind === 'na') return <span className="na-dash" aria-label="해당 없음">—</span>
  if (c.kind === 'write') return <Writes w={c.w} plain={plain} />
  return <RecvBadge status={c.status} />
}
function RecvBadge({ status }: { status: CellStatus }) {
  if (status === 'unassigned') return <StatusIcon done={false} title="미완료 — 평가자 미지정(임원 평가 배정에서 담당을 정하세요)" /> // 미완료로 셈 (D-087)
  return <StatusIcon done={status === 'submitted'} />
}

/** 완료 = 초록 원 안 ✓, 미완료 = 빨간 원 안 ✕ (D-115 — 글자 대신 아이콘, 이름은 화면 낭독·툴팁으로) */
function StatusIcon({ done, title }: { done: boolean; title?: string }) {
  const label = title ?? (done ? '완료' : '미완료')
  return <span className={`st-ico ${done ? 'ok' : 'no'}`} role="img" aria-label={label} title={label}>{done ? '✓' : '✕'}</span>
}

/**
 * 단계 칸 = 그 직원이 그 단계에서 작성할 업무(선행 대기도 미완료). 배정 없음 —, 1건 ✓ 완료/미완료,
 * 여러 건 "5/9 완료" — 남은 건이 있으면 빨간 글씨, 모두 제출이면 초록(D-108: "n건 미완료" 문구 제거)
 */
function Writes({ w, plain }: { w: WriteSummary; plain?: boolean }) {
  if (w.total === 0) return <span className="na-dash" aria-label="배정 없음">—</span>
  if (w.total === 1) return <StatusIcon done={!w.open} />
  return (
    <span className={`writes-sum ${w.open || plain ? 'open' : 'done'}`} aria-label={w.open ? `${w.total}건 중 ${w.done}건 완료, ${w.open}건 미완료` : undefined}>
      <span className="w-done">{w.done}/{w.total} 완료</span>
    </span>
  )
}
