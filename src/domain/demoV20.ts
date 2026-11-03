// v19 → v20 (D-117): 진행 현황 시연 데이터의 완료(✓) 비중을 높인다. 저장 데이터 변환과 새 시드가 같은 함수를 쓴다.
// - 준비·진행 회차만. 응답이 없거나 '기본 시연 임시저장'인 배정에만 시연 제출(demo) — 사용자가 쓴 응답은 그대로
// - 순차 잠금을 지킨다(앞 단계가 제출된 배정만, 1 → 2 → 3단계 순서로 채움). 팀원→팀장평가는 1단계로 함께
// - 시연 완료 구성(D-082: 팀장평가를 모두 낸 팀장 2명·임원평가를 모두 낸 임원 1명)은 유지 — 아직 다 내지 않은 팀장·임원은 담당 평가 하나를 남긴다
// - 자기평가·팀원→팀장평가는 열에 하나 정도(약 10%) 미제출로 남겨 미완료자 시연이 가능하게
// - 다시 실행해도 바뀌는 것이 없다(남기는 배정을 대상자·평가자·단계로 고정)
import type { AppState, Assignment, Cycle } from './types'
import { activeWriteAssignments, isUnlocked, statusOf, upwardAssignments } from './progress'
import { demoAnswers } from './demoV15'

const hash = (x: string) => { let h = 7; for (const ch of x) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return h }
/** 회차 ID(생성 시각)와 무관한 고정 키 — 새 데이터·변환 데이터에서 같은 배정을 고르게 */
const key = (a: Assignment) => hash(`${a.targetId}|${a.evaluatorId}|${a.stageOrder}|${a.direction}`)
const open = (c: Pick<Cycle, 'status'>) => c.status === '준비' || c.status === '진행'

/** v20 시연 제출의 저장 시각(이 단계가 만든 응답 표시) */
export const DEMO20_AT = '2026-10-29T00:00:00.000Z'

export function moreDemo(s: AppState): string[] {
  const notes: string[] = []
  const at = DEMO20_AT
  for (const c of s.cycles) {
    if (!open(c)) continue
    const writes = activeWriteAssignments(c, s.employees)
    const ups = upwardAssignments(c, s.employees)
    const fillable = (a: Assignment) => { const r = s.responses[a.id]; return !r || (r.status === 'draft' && !!r.demo) }
    // 팀장평가(2)·임원평가(3) 담당자별로 아직 다 내지 않았으면 하나를 남김(배정 ID 해시가 가장 큰 것)
    const keep = new Set<string>()
    for (const order of [2, 3]) {
      const by = new Map<string, Assignment[]>()
      for (const a of writes.filter((x) => x.stageOrder === order && x.evaluatorId !== x.targetId)) by.set(a.evaluatorId, [...(by.get(a.evaluatorId) ?? []), a])
      for (const list of by.values()) {
        const left = list.filter((a) => statusOf(s.responses, a.id) !== 'submitted')
        if (left.length) keep.add(left.sort((a, b) => key(b) - key(a))[0].id)
      }
    }
    // 자기평가·팀원→팀장평가: 약 10%는 미제출로
    for (const a of [...writes.filter((x) => x.direction === 'self'), ...ups]) if (key(a) % 10 === 0 && statusOf(s.responses, a.id) !== 'submitted') keep.add(a.id)
    let n = 0
    for (const order of [1, 2, 3]) {
      for (const a of [...writes, ...ups].filter((x) => x.stageOrder === order)) {
        if (keep.has(a.id) || !fillable(a) || statusOf(s.responses, a.id) === 'submitted') continue
        if (a.direction !== 'up' && !isUnlocked(c, s.responses, a)) continue
        s.responses[a.id] = { assignmentId: a.id, answers: demoAnswers(c, a), status: 'submitted', savedAt: at, submittedAt: at, lang: 'ko', demo: true }
        n++
      }
    }
    if (n) notes.push(`${c.name}: 시연 제출 ${n}건 추가(완료 비중 높임, 사용자 응답 그대로)`)
  }
  return notes
}
