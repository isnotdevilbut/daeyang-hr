// 고정 단계 번호·팀장/임원 자기평가 설정·세 직급 정리 (D-068). 저장 데이터 변환(v7 → v8)과 새 시드가 같은 함수를 쓴다.
//  - 확정된 회차는 그대로 둔다(그때의 단계 번호·대상자·배정 유지).
//  - 확정 전 회차: 배정의 평가 유형(경로에서 그 번호가 가리키던 규칙)을 확인해 단계 번호를 고정 번호로 옮긴다
//    (팀장이 받는 임원평가 2 → 3). 배정 ID는 그대로라 응답·제출 상태가 다른 평가에 붙지 않는다.
//    반영 비율도 같은 평가 유형을 따라 옮긴다. 팀장·임원의 자기평가 설정을 현재 배정 그대로 기록한다.
//  - 직원 직급: 임원·대표자 → 임원, 실제 팀장 연결 → 팀장, 나머지 → 사원. 대표자 표시는 없애고 임원으로 통일.
//  - 다시 실행해도 바뀌는 것이 없다.
import type { AppState, Assignment, Cycle, Stage } from './types'
import { EXEC_PATH, STAGE_OF_RULE } from './progress'
import { tierOf } from './org'

function fixPath(path: Stage[]): Map<number, number> {
  const remap = new Map<number, number>()
  for (const st of path) {
    const to = STAGE_OF_RULE[st.rule]
    remap.set(st.order, to)
    st.order = to
  }
  path.sort((a, b) => a.order - b.order)
  return remap
}

function remapWeights(w: Record<number, number | null> | undefined, remap: Map<number, number>) {
  if (!w) return w
  const out: Record<number, number | null> = {}
  for (const [k, v] of Object.entries(w)) out[remap.get(Number(k)) ?? Number(k)] = v
  return out
}

export function fixedStagesAndTiers(s: AppState): string[] {
  const notes: string[] = []

  // 1. 직급 (대표자 → 임원)
  for (const e of s.employees) {
    if (e.isCeo) { e.isCeo = false; e.isExecutive = true; notes.push(`${e.name}: 대표자 → 임원`) }
  }
  let changedTier = 0
  for (const e of s.employees) {
    const tier = tierOf(s, e)
    if (e.position !== tier) { e.position = tier; changedTier++ }
  }
  if (changedTier) notes.push(`직원 ${changedTier}명의 직급을 임원·팀장·사원으로 정리`)

  // 2. 확정 전 회차: 고정 단계 번호·자기평가 설정
  for (const c of s.cycles) {
    if (c.status === '확정') { notes.push(`${c.name}: 확정 회차라 단계 번호·대상자를 그대로 둡니다.`); continue }
    const isLeadTarget = (id: string) => c.targets.find((t) => t.employeeId === id)?.isTeamLead
    const isExecTarget = (id: string) => !!c.targets.find((t) => t.employeeId === id)?.isExecutive
    const memberMap = fixPath(c.path.member)
    const leadMap = fixPath(c.path.lead)
    if (!c.path.exec) c.path.exec = structuredClone(EXEC_PATH)
    let moved = 0
    for (const a of c.assignments as Assignment[]) {
      const map = isExecTarget(a.targetId) ? null : isLeadTarget(a.targetId) ? leadMap : memberMap
      const to = map?.get(a.stageOrder)
      if (to !== undefined && to !== a.stageOrder) { a.stageOrder = to; moved++ }
    }
    if (moved) notes.push(`${c.name}: 배정 ${moved}건의 단계 번호를 평가 유형에 맞춰 고정 번호로 옮김(팀장 임원평가 2 → 3, 응답 연결 그대로)`)
    c.stageWeights = {
      member: remapWeights(c.stageWeights?.member, memberMap) ?? {},
      lead: remapWeights(c.stageWeights?.lead, leadMap) ?? {},
      exec: c.stageWeights?.exec ?? { 1: 100 },
    }
    // 팀장·임원 자기평가 설정: 지금 배정 그대로 기록(이미 있으면 유지)
    const sel = { ...(c.selfEval ?? {}) }
    for (const t of c.targets) {
      if (!t.isTeamLead && !t.isExecutive) continue
      if (t.employeeId in sel) continue
      sel[t.employeeId] = c.assignments.some((a) => a.targetId === t.employeeId && a.direction === 'self' && !a.excluded)
    }
    c.selfEval = sel
    // 대상자 스냅샷 직급 표시
    for (const t of c.targets) t.position = t.isExecutive ? '임원' : t.isTeamLead ? '팀장' : '사원'
  }
  return notes
}

/** 회차가 확정 전이면 고정 단계 기준을 쓰는가 (테스트·화면 보조) */
export const usesFixedStages = (c: Cycle) => c.path.lead.every((st) => st.order === STAGE_OF_RULE[st.rule])
