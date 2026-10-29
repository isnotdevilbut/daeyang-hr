// 임원평가 담당 나누기 (D-082). 회차 생성·참여 변경·배정 맞추기·저장 데이터 변환이 같은 함수를 쓴다.
import type { AppState, Assignment, Cycle, Employee } from './types'
import { pathFor } from './progress'
import { templateFor } from './catalog'
import { applyVersions } from './versions'

export type IsDemo = (a: Assignment) => boolean

/** 이 회차에 평가자로 참여하는 임원(재직·임원 표시·참여 해제 아님) */
export function cycleExecs(s: Pick<AppState, 'employees'>, c: Pick<Cycle, 'execOff'>): Employee[] {
  const off = new Set(c.execOff ?? [])
  return s.employees.filter((e) => e.active && (e.isExecutive || e.isCeo) && !off.has(e.id))
}

/**
 * 임원평가 담당 나누기 (D-082): 대상자(참여 사원·팀장)마다 담당 임원 한 명.
 *  - 응답(작성 중·제출)이 있는 임원평가는 담당 고정(작성자 변경 없음). 한 대상자에 응답 있는 임원평가가 둘 이상이면 모두 두고 충돌 보고
 *  - 응답 없는 중복(이전 전원 평가로 생긴 것)은 지운다. rebalance=false면 남은 응답 없는 담당(관리자가 고른 담당 포함)도 그대로
 *  - 담당이 없는 대상자(rebalance면 응답 없는 담당 전부)를 팀 단위로 나눈다: 큰 팀부터, 그 팀에 이미 담당이 있는 임원 → 덜 맡은 임원 순,
 *    한 임원 몫은 ceil(대상자 수 ÷ 임원 수)까지. 넘치면 같은 팀 안에서 다음 임원에게
 */
export function distributeExecs(s: Pick<AppState, 'employees' | 'responses'>, c: Cycle, isDemo: IsDemo = () => false, rebalance = false): string[] {
  const notes: string[] = []
  const pre = `${c.name}: `
  const execs = cycleExecs(s, c)
  if (!execs.length) return notes
  const execIds = new Set(execs.map((x) => x.id))
  const emp = (id: string) => s.employees.find((e) => e.id === id)
  const name = (id: string) => emp(id)?.name ?? id
  const answered = (a: Assignment) => !!s.responses[a.id]
  void isDemo
  type T = { t: Cycle['targets'][number]; order: number; tpl: string }
  const targets: T[] = []
  for (const t of c.targets) {
    const e = emp(t.employeeId)
    if (!e || !e.active || e.evalExcluded || t.isExecutive) continue
    const st = pathFor(c, t).find((x) => x.rule === 'executive')
    if (!st) continue
    targets.push({ t, order: st.order, tpl: c.assignments.find((a) => a.targetId === t.employeeId)?.templateId ?? templateFor(c, t.jobType) })
  }
  const live3 = (x: T) => c.assignments.filter((a) => a.targetId === x.t.employeeId && a.stageOrder === x.order && a.direction === 'down' && !a.excluded && execIds.has(a.evaluatorId))
  const owner = new Map<string, string>() // 대상자 → 담당 임원(고정)
  const free: T[] = []
  const cleared = new Set(c.execUnassigned ?? [])
  for (const x of targets) {
    const as = live3(x)
    // 관리자가 비워 둔 대상자(D-087): 담당이 없으면 자동으로 채우지 않는다. 담당이 다시 생겼으면 목록에서 뺀다
    if (cleared.has(x.t.employeeId)) {
      if (!as.length) continue
      c.execUnassigned = (c.execUnassigned ?? []).filter((id) => id !== x.t.employeeId)
    }
    const ans = as.filter(answered)
    if (ans.length) {
      if (ans.length > 1) notes.push(`${pre}충돌(유지): ${x.t.name}의 임원평가 응답이 ${ans.length}건(${ans.map((a) => name(a.evaluatorId)).join('·')})`)
      for (const a of as) if (!answered(a)) c.assignments = c.assignments.filter((y) => y !== a)
      if (as.length > ans.length) notes.push(`${pre}${x.t.name} 임원평가: 응답 없는 중복 ${as.length - ans.length}건 정리`)
      owner.set(x.t.employeeId, ans[0].evaluatorId)
      continue
    }
    if (!rebalance && as.length) {
      // 하나만 남김: 이전부터 있던 배정(전원 평가로 추가된 것이 아닌 것)을 우선
      const keep = as.find((a) => !a.id.includes('-x-')) ?? as[0]
      for (const a of as) if (a !== keep) c.assignments = c.assignments.filter((y) => y !== a)
      if (as.length > 1) notes.push(`${pre}${x.t.name} 임원평가: 응답 없는 중복 ${as.length - 1}건 정리`)
      owner.set(x.t.employeeId, keep.evaluatorId)
      continue
    }
    free.push(x)
  }
  if (!free.length) return notes
  const cap = Math.ceil(targets.filter((x) => !cleared.has(x.t.employeeId) || live3(x).length).length / execs.length)
  const load = new Map(execs.map((x) => [x.id, 0]))
  for (const ex of owner.values()) load.set(ex, (load.get(ex) ?? 0) + 1)
  const teamOf = (x: T) => x.t.departmentId || x.t.teamName
  const byTeam = new Map<string, T[]>()
  for (const x of free) byTeam.set(teamOf(x), [...(byTeam.get(teamOf(x)) ?? []), x])
  const teams = [...byTeam.entries()].sort((a, b) => b[1].length - a[1].length || (a[1][0].t.teamName).localeCompare(b[1][0].t.teamName, 'ko'))
  const plan = new Map<string, string>()
  for (const [team, list] of teams) {
    const affinity = (ex: string) => targets.filter((y) => teamOf(y) === team && (owner.get(y.t.employeeId) === ex || plan.get(y.t.employeeId) === ex)).length
    // 대상자: 팀장 먼저, 이름순 — 팀 안에서 나눌 때도 결과가 매번 같게
    const queue = [...list].sort((a, b) => Number(b.t.isTeamLead) - Number(a.t.isTeamLead) || a.t.name.localeCompare(b.t.name, 'ko'))
    while (queue.length) {
      const room = (ex: string) => cap - (load.get(ex) ?? 0)
      const order = [...execs].sort((a, b) => {
        const fitA = room(a.id) >= queue.length ? 1 : 0, fitB = room(b.id) >= queue.length ? 1 : 0
        return affinity(b.id) - affinity(a.id) || fitB - fitA || (load.get(a.id)! - load.get(b.id)!) || a.name.localeCompare(b.name, 'ko')
      })
      const ex = order.find((x) => room(x.id) > 0) ?? [...execs].sort((a, b) => load.get(a.id)! - load.get(b.id)!)[0]
      const n = Math.max(1, Math.min(queue.length, room(ex.id)))
      for (const x of queue.splice(0, n)) { plan.set(x.t.employeeId, ex.id); load.set(ex.id, (load.get(ex.id) ?? 0) + 1) }
    }
  }
  let moved = 0, added = 0
  for (const x of free) {
    const ex = plan.get(x.t.employeeId)!
    const as = live3(x)
    const keep = as.find((a) => a.evaluatorId === ex) ?? as.find((a) => !a.id.includes('-x-')) ?? as[0]
    for (const a of as) if (a !== keep) c.assignments = c.assignments.filter((y) => y !== a)
    if (keep) { if (keep.evaluatorId !== ex) { keep.evaluatorId = ex; moved++ } }
    else {
      const id = `${c.id}-e-${x.t.employeeId}`
      c.assignments.push({ id: c.assignments.some((a) => a.id === id) ? `${id}-${Date.now().toString(36)}` : id, targetId: x.t.employeeId, evaluatorId: ex, direction: 'down', stageOrder: x.order, templateId: x.tpl })
      added++
    }
  }
  if (moved || added) notes.push(`${pre}임원평가 담당 나누기: ${execs.map((x) => `${x.name} ${[...owner.values(), ...plan.values()].filter((v) => v === x.id).length}명`).join(', ')} (재배정 ${moved}건·추가 ${added}건)`)
  return notes
}

/** 대상자의 임원평가 단계(경로 규칙 executive) 활성 배정 */
export const execOrder = (c: Cycle, t: Cycle['targets'][number]) => pathFor(c, t).find((st) => st.rule === 'executive')?.order
export const execAssignment = (c: Cycle, t: Cycle['targets'][number]) => { const o = execOrder(c, t); return o === undefined ? undefined : c.assignments.find((a) => a.targetId === t.employeeId && a.stageOrder === o && a.direction === 'down' && !a.excluded) }

/**
 * 저장(D-086·D-087): 대상자 → 담당 임원('' = 미지정). 응답 없는 임원평가는 담당만 바꾸고, 작성 중(임시저장)인 평가는 이전 임원의 기록을
 * 지우지 않고 보존(reassigned) 뒤 새 담당 임원에게 새 배정. 제출된 평가는 바꾸지 않음. 대상자당 한 건(중복 없음).
 * 미지정으로 바꾼 대상자는 execUnassigned에 넣어 자동 채우기에서 빼고, 다시 담당을 정하면 목록에서 뺀다
 */
export function applyExecDraft(d: AppState, c: Cycle, execDraft: Record<string, string>) {
  const cleared = new Set(c.execUnassigned ?? [])
  for (const [tid, ex] of Object.entries(execDraft)) {
    const t = c.targets.find((x) => x.employeeId === tid)
    if (!t) continue
    const o = execOrder(c, t)
    if (o === undefined) continue
    const a = execAssignment(c, t)
    const r = a ? d.responses[a.id] : undefined
    if (a && r?.status === 'submitted') continue
    if (ex) cleared.delete(tid); else cleared.add(tid)
    if (a && a.evaluatorId === ex) continue
    if (a && !r) {
      if (ex) a.evaluatorId = ex
      else c.assignments = c.assignments.filter((x) => x !== a)
      continue
    }
    if (a && r) a.excluded = 'reassigned'
    if (!ex) continue
    const id = `${c.id}-r-${tid}-${Date.now().toString(36)}`
    c.assignments.push({ id, targetId: tid, evaluatorId: ex, direction: 'down', stageOrder: o, templateId: a?.templateId ?? c.templateByJob.office })
  }
  c.execUnassigned = [...cleared]
  if (!c.execUnassigned.length) delete c.execUnassigned
  applyVersions(d, c)
}

