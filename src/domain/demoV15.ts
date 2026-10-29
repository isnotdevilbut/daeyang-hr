// 저장 데이터 v14 → v15 (D-082)와 새 데이터 공통. 다시 실행해도 바뀌는 것이 없다.
//  1) 평가표 버전: 지금 문항을 "공통 평가표"로 연결(확정 회차 제외), 대상자 스냅샷에 직급 ID
//  2) 임원평가 = 대상자당 담당 임원 한 명(전원 평가로 생긴 응답 없는 중복 정리, 응답 있는 담당 고정, 나머지는 팀 단위로 다시 나눔)
//  3) 시연 회차 완료 구성(사용자가 고른 목업 구성): 담당 사원 평가를 모두 제출한 팀장 2명, 담당 평가를 모두 제출한 임원 1명.
//     카드 숫자를 고정하지 않고 실제 응답으로 만든다 — 모자라면 응답 없는(또는 기본 시연 임시저장) 배정에 시연 응답을 채우고
//     선행 단계(자기·팀장평가)도 채운다. 남으면 기본 시연 응답만 되돌린다. 사용자 기록은 바꾸지 않고, 불가능하면 충돌로 보고
import type { AppState, Assignment, Cycle } from './types'
import { activeWriteAssignments, progressCounts, progressRows } from './progress'
import { applies, ctxFor } from './questions'
import { ensureVersions } from './versions'
import { distributeExecs, type IsDemo } from './execPlan'
import { syncCycle } from './cycleSync'

const TEXTS = ['담당 업무를 기한 안에 처리했습니다. (가상 응답)', '협업과 공유가 원활했습니다. (가상 응답)', '다음 분기에는 문서화를 보완하겠습니다. (가상 응답)']
const hash = (x: string) => { let h = 7; for (const ch of x) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return h }

/** 시연 응답: 적용 문항마다 선택지는 위쪽 세 개 중 하나, 서술은 짧은 가상 문장 */
export function demoAnswers(c: Cycle, a: Assignment): Record<string, string> {
  const t = c.templates[a.templateId]
  const out: Record<string, string> = {}
  if (!t) return out
  for (const sec of t.sections) for (const q of sec.questions.filter((x) => applies(x, ctxFor(c, a)))) {
    const h = hash(a.id + q.id)
    out[q.id] = q.options.length ? q.options[h % Math.min(3, q.options.length)].id : TEXTS[h % TEXTS.length]
  }
  return out
}

/** 시연 회차 완료 구성. 바꾼 내용·충돌을 돌려준다 */
export function composeDemo(s: AppState, c: Cycle, isDemo: IsDemo, want = { leads: 2, execs: 1 }): string[] {
  const notes: string[] = []
  const pre = `${c.name}: `
  const at = '2026-10-27T00:00:00.000Z'
  const name = (id: string) => s.employees.find((e) => e.id === id)?.name ?? id
  const mine = (st: AppState) => activeWriteAssignments(st.cycles.find((x) => x.id === c.id)!, st.employees)
  const counts = (st: AppState) => progressCounts(progressRows(st, st.cycles.find((x) => x.id === c.id)!)).byStage
  const writable = (st: AppState, a: Assignment) => { const r = st.responses[a.id]; return !r || (r.status === 'draft' && (isDemo(a) || !!r.demo)) }
  /** a를 제출하려면 채울 배정(선행 단계 포함). 사용자 기록 때문에 불가능하면 null */
  const plan = (st: AppState, a: Assignment): Assignment[] | null => {
    const cy = st.cycles.find((x) => x.id === c.id)!
    const need: Assignment[] = []
    const prior = mine(st).filter((x) => x.targetId === a.targetId && x.stageOrder < a.stageOrder)
    for (const p of [...prior, a]) {
      if (st.responses[p.id]?.status === 'submitted') continue
      if (!writable(st, p)) return null
      need.push(cy.assignments.find((x) => x.id === p.id)!)
    }
    return need
  }
  const fill = (st: AppState, list: Assignment[]) => {
    const cy = st.cycles.find((x) => x.id === c.id)!
    for (const a of list) st.responses[a.id] = { assignmentId: a.id, answers: demoAnswers(cy, a), status: 'submitted', savedAt: at, submittedAt: at, lang: 'ko', demo: true }
  }
  /** 담당자(평가자) 한 명의 그 단계 업무를 모두 제출하려면 채울 배정 */
  const planWriter = (st: AppState, who: string, order: number) => {
    const all: Assignment[] = []
    for (const a of mine(st).filter((x) => x.evaluatorId === who && x.stageOrder === order && x.targetId !== who)) {
      const p = plan(st, a)
      if (!p) return null
      for (const x of p) if (!all.includes(x)) all.push(x)
    }
    return all
  }
  const rowsOf = (st: AppState, tier: '팀장' | '임원', i: number) => progressRows(st, st.cycles.find((x) => x.id === c.id)!).filter((r) => r.tier === tier && r.writes && r.writes.stages[i].total > 0)

  const step = (tier: '팀장' | '임원', i: number, target: number, other: { i: number } | null) => {
    let byStage = counts(s)
    const cur = () => byStage[i].done
    if (byStage[i].writers < target) { notes.push(`${pre}충돌: ${i + 1}단계 담당자가 ${byStage[i].writers}명뿐이라 완료 ${target}명을 만들 수 없음`); return }
    // 모자라면 채우기 — 채울 양이 적은 사람부터, 다른 단계 완료 인원이 바뀌지 않는 경우만
    while (cur() < target) {
      const cands = rowsOf(s, tier, i).filter((r) => r.writes!.stages[i].open > 0).map((r) => ({ id: r.t.employeeId, need: planWriter(s, r.t.employeeId, i + 1) }))
        .filter((x): x is { id: string; need: Assignment[] } => !!x.need).sort((a, b) => a.need.length - b.need.length || name(a.id).localeCompare(name(b.id), 'ko'))
      let done = false
      for (const cnd of cands) {
        const trial = structuredClone(s)
        fill(trial, cnd.need)
        const after = counts(trial)
        if (after[i].done !== cur() + 1) continue
        if (other && after[other.i].done !== counts(s)[other.i].done) continue // 다른 단계 완료 인원은 그대로
        fill(s, cnd.need)
        notes.push(`${pre}시연 완료 구성: ${tier} ${name(cnd.id)}의 담당 평가 모두 제출(시연 응답 ${cnd.need.length}건 추가·선행 단계 포함)`)
        done = true; break
      }
      byStage = counts(s)
      if (!done) { notes.push(`${pre}충돌: ${tier} 완료 ${target}명을 만들 수 없음(사용자 기록·선행 조건) — 현재 ${cur()}명`); return }
    }
    // 남으면 기본 시연 응답만 되돌리기(뒤 단계가 제출되지 않은 것만)
    for (const r of rowsOf(s, tier, i).filter((x) => x.writes!.stages[i].open === 0).sort((a, b) => b.t.name.localeCompare(a.t.name, 'ko'))) {
      if (counts(s)[i].done <= target) break
      const undo = mine(s).filter((a) => a.evaluatorId === r.t.employeeId && a.stageOrder === i + 1 && a.targetId !== r.t.employeeId)
        .find((a) => (isDemo(a) || s.responses[a.id]?.demo) && !mine(s).some((x) => x.targetId === a.targetId && x.stageOrder > a.stageOrder && s.responses[x.id]))
      if (undo) { delete s.responses[undo.id]; notes.push(`${pre}시연 완료 구성: ${tier} ${r.t.name}의 시연 응답 1건을 미제출로(${name(undo.targetId)})`) }
      else notes.push(`${pre}충돌: ${tier} ${r.t.name}은(는) 사용자 기록으로 완료 상태라 그대로 둠`)
    }
  }
  step('팀장', 1, want.leads, null)
  step('임원', 2, want.execs, { i: 1 })
  return notes
}

/** 시연 회차 = 기본 시연 응답이 있는 확정 전 회차 */
export const isDemoCycle = (s: AppState, c: Cycle, isDemo: IsDemo) => c.status !== '확정' && c.assignments.some((a) => s.responses[a.id] && (isDemo(a) || s.responses[a.id].demo))

export function v15(s: AppState, isDemo: IsDemo): string[] {
  const notes: string[] = []
  for (const c of s.cycles) {
    if (c.status === '확정') continue
    if (ensureVersions(c)) notes.push(`${c.name}: 지금 문항을 '공통 평가표'로 연결`)
    for (const t of c.targets) { const e = s.employees.find((x) => x.id === t.employeeId); if (e?.positionId && t.positionId !== e.positionId) t.positionId = e.positionId }
    notes.push(...distributeExecs(s, c, isDemo, true))
    notes.push(...syncCycle(s, c, isDemo))
  }
  for (const c of s.cycles) if (isDemoCycle(s, c, isDemo)) notes.push(...composeDemo(s, c, isDemo))
  return notes
}
