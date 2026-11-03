// v18 → v19 (D-116): 재직 중인 사원·팀장은 모두 준비·진행 회차의 평가 참여자로. 저장 데이터 변환과 새 시드가 같은 함수를 쓴다.
// - 이전 시연 데이터의 '평가 제외'(D-053에서 화면 설정이 없어져 되돌릴 수 없던 값)는 사원·팀장에게서 해제 — 임원은 그대로(평가자로만 참여)
// - 참여하지 않던 사원·팀장(이전에 업로드·추가한 직원 포함)을 대상자로 넣고 현재 조직 기준 배정 생성(joinOpenCycles, D-112와 같은 규칙)
// - 마감·확정 회차, 기존 배정·응답은 그대로. 이후 관리자가 평가 설정에서 참여를 해제할 수 있다. 다시 실행해도 바뀌는 것이 없다
import type { AppState } from './types'
import { joinOpenCycles } from './cycle'
import { syncOpenCycles } from './cycleSync'

export function joinAllStaff(s: AppState): string[] {
  const notes: string[] = []
  const staff = s.employees.filter((e) => e.active && !e.isExecutive && !e.isCeo)
  for (const e of staff) if (e.evalExcluded) { e.evalExcluded = false; notes.push(`${e.name}: 평가 제외 해제`) }
  const open = s.cycles.filter((c) => c.status === '준비' || c.status === '진행')
  const before = new Map(open.map((c) => [c.id, new Set(c.targets.map((t) => t.employeeId))]))
  joinOpenCycles(s, staff.map((e) => e.id))
  for (const c of open) {
    const added = c.targets.filter((t) => !before.get(c.id)!.has(t.employeeId)).map((t) => t.name)
    if (added.length) notes.push(`${c.name}: 평가 참여자 추가 ${added.join(', ')}`)
  }
  if (notes.length) syncOpenCycles(s)
  return notes
}
