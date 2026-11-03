// 직무·직급 목록 (D-080). 직원은 이름 대신 ID로 연결해 이름을 바꿔도 관계가 유지된다.
// 직급은 표시 이름과 평가 구분(임원·팀장·사원)을 따로 가진다. 실제 평가 동작은 지금처럼 임원 표시·팀장 연결로 정해지고,
// 직급의 평가 구분은 직원 저장 시 그 둘을 맞추는 기준이다. 직급 이름(글자)으로 평가 구분을 추측하지 않는다.
import type { AppState, Cycle, EvalClass, Employee, ID, JobDef, PositionDef } from './types'
import { JOB_LABEL } from './types'

export const DEFAULT_JOBS: JobDef[] = [{ id: 'office', name: '관리직' }, { id: 'production', name: '생산직' }]
export const DEFAULT_POSITIONS: PositionDef[] = [
  { id: 'pos-exec', name: '임원', evalClass: '임원', builtIn: true },
  { id: 'pos-lead', name: '팀장', evalClass: '팀장', builtIn: true },
  { id: 'pos-staff', name: '사원', evalClass: '사원', builtIn: true },
]
export const EVAL_CLASSES: EvalClass[] = ['임원', '팀장', '사원']
const CLASS_DEFAULT: Record<EvalClass, ID> = { 임원: 'pos-exec', 팀장: 'pos-lead', 사원: 'pos-staff' }

type S = Pick<AppState, 'jobs' | 'positions'>
export const jobsOf = (s: S): JobDef[] => s.jobs ?? DEFAULT_JOBS
export const activeJobs = (s: S): JobDef[] => jobsOf(s).filter((j) => !j.archived)
export const jobName = (s: S, id: ID): string => jobsOf(s).find((j) => j.id === id)?.name ?? JOB_LABEL[id] ?? id
export const positionsOf = (s: S): PositionDef[] => s.positions ?? DEFAULT_POSITIONS
/** 평가 구분의 기본 직급(처음 목업의 임원·팀장·사원). 이름은 바뀌었을 수 있다 */
export const classDefault = (s: S, c: EvalClass): PositionDef => positionsOf(s).find((p) => p.id === CLASS_DEFAULT[c]) ?? positionsOf(s).find((p) => p.evalClass === c) ?? DEFAULT_POSITIONS.find((p) => p.evalClass === c)!
export const positionById = (s: S, id: ID | undefined): PositionDef | undefined => positionsOf(s).find((p) => p.id === id)

/** 이름 검증: 빈 값·공백만·같은 목록의 중복(앞뒤 공백 무시) */
export function catalogNameError(list: { id: ID; name: string; archived?: boolean }[], name: string, selfId?: ID): string | null {
  const n = name.trim()
  if (!n) return '이름을 입력하세요.'
  if (list.some((x) => !x.archived && x.id !== selfId && x.name.trim() === n)) return `'${n}'이(가) 이미 있습니다.`
  return null
}

export const jobUsage = (s: Pick<AppState, 'employees'>, id: ID) => s.employees.filter((e) => e.jobType === id)
export const positionUsage = (s: Pick<AppState, 'employees'>, id: ID) => s.employees.filter((e) => e.positionId === id)

// ── 직무 ─────────────────────────────────────────────
export function saveJob(d: AppState, id: ID | null, name: string): string | null {
  d.jobs = structuredClone(jobsOf(d))
  const err = catalogNameError(d.jobs, name, id ?? undefined)
  if (err) return err
  if (id) { const j = d.jobs.find((x) => x.id === id); if (!j) return '직무를 찾을 수 없습니다.'; j.name = name.trim() }
  else d.jobs.push({ id: `job-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, name: name.trim() })
  return null
}

/** 삭제: 쓰는 직원(재직·퇴사 모두)이 있으면 대체 직무로 옮긴 뒤 목록에서 숨김(이전 회차 기록의 이름 참조용으로 남김). 평가 배정은 바꾸지 않음 */
export function deleteJob(d: AppState, id: ID, replaceId: ID | null): string | null {
  d.jobs = structuredClone(jobsOf(d))
  const j = d.jobs.find((x) => x.id === id && !x.archived)
  if (!j) return '직무를 찾을 수 없습니다.'
  if (d.jobs.filter((x) => !x.archived).length <= 1) return '직무는 하나 이상 있어야 합니다.'
  const users = jobUsage(d, id)
  if (users.length) {
    if (!replaceId || replaceId === id || !d.jobs.some((x) => x.id === replaceId && !x.archived)) return '옮길 직무를 선택하세요.'
    users.forEach((e) => { e.jobType = replaceId })
  }
  j.archived = true
  return null
}

// ── 직급 ─────────────────────────────────────────────
/**
 * 직급 추가·수정. 기본 직급의 평가 구분은 바꾸지 않는다. 직원이 쓰는 직급의 평가 구분을 바꾸면 그 직원들의 팀장 연결·임원 여부와
 * 어긋나므로 막는다(자동으로 팀장 임명·해제하지 않음) — 대신 같은 평가 구분의 새 직급을 만들고 직원별로 옮긴다.
 */
export function savePosition(d: AppState, id: ID | null, name: string, evalClass: EvalClass): string | null {
  d.positions = structuredClone(positionsOf(d))
  const err = catalogNameError(d.positions, name, id ?? undefined)
  if (err) return err
  if (!EVAL_CLASSES.includes(evalClass)) return '평가 구분을 선택하세요.'
  if (id) {
    const p = d.positions.find((x) => x.id === id)
    if (!p) return '직급을 찾을 수 없습니다.'
    if (p.evalClass !== evalClass) {
      if (p.builtIn) return `기본 직급 '${p.name}'의 평가 구분은 바꿀 수 없습니다.`
      const n = positionUsage(d, id).length
      if (n) return `직원 ${n}명이 쓰는 직급이라 평가 구분을 바꿀 수 없습니다.`
    }
    p.name = name.trim(); p.evalClass = evalClass
    d.employees.forEach((e) => { if (e.positionId === id) e.position = p.name })
  } else d.positions.push({ id: `pos-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, name: name.trim(), evalClass })
  return null
}

/** 삭제: 기본 직급은 삭제 불가. 쓰는 직원이 있으면 같은 평가 구분의 대체 직급으로 옮긴 뒤 삭제(평가 동작·응답 변경 없음) */
export function deletePosition(d: AppState, id: ID, replaceId: ID | null): string | null {
  d.positions = structuredClone(positionsOf(d))
  const p = d.positions.find((x) => x.id === id)
  if (!p) return '직급을 찾을 수 없습니다.'
  if (p.builtIn) return `기본 직급 '${p.name}'은(는) 삭제할 수 없습니다.`
  const users = positionUsage(d, id)
  if (users.length) {
    const r = d.positions.find((x) => x.id === replaceId && x.id !== id)
    if (!r) return '옮길 직급을 선택하세요.'
    if (r.evalClass !== p.evalClass) return '같은 평가 구분의 직급으로만 옮길 수 있습니다.'
    users.forEach((e) => { e.positionId = r.id; e.position = r.name })
  }
  d.positions = d.positions.filter((x) => x.id !== id)
  return null
}

/** 직원의 직급 이름 (직급 ID가 없거나 사라졌으면 저장된 이름) */
export const positionName = (s: S, e: Pick<Employee, 'positionId' | 'position'>): string => positionById(s, e.positionId)?.name ?? e.position

/** 회차 대상자 직급 표시: 확정 회차는 그때의 스냅샷, 그 밖에는 현재 직원 직급 이름 */
export function targetPosition(s: S & Pick<AppState, 'employees'>, cycle: Pick<Cycle, 'status'>, t: { employeeId: ID; position: string }): string {
  if (cycle.status === '확정') return t.position
  const e = s.employees.find((x) => x.id === t.employeeId)
  return e ? positionName(s, e) : t.position
}

/**
 * 결과·리포트의 팀 안 순서(D-169): 직급(임원 → 팀장 → 사원 — 직급의 평가 구분 기준, 같은 구분이면 직급 목록 순서) → 이름 가나다순.
 * 직급을 찾을 수 없으면 맨 뒤
 */
export function byTierThenName(s: S & Pick<AppState, 'employees'>, cycle: Pick<Cycle, 'status'>) {
  const list = positionsOf(s)
  const CLS = ['임원', '팀장', '사원']
  const rank = (t: { employeeId: ID; position: string }) => {
    const i = list.findIndex((p) => p.name === targetPosition(s, cycle, t))
    if (i < 0) return 9999
    const c = CLS.indexOf(list[i].evalClass)
    return (c < 0 ? 3 : c) * 1000 + i
  }
  return (a: { employeeId: ID; position: string; name: string }, b: { employeeId: ID; position: string; name: string }) => rank(a) - rank(b) || a.name.localeCompare(b.name, 'ko')
}

/** 회차 문항: 직무별 문항이 없으면(새 직무) 관리직 → 첫 번째 문항 */
export const templateFor = (c: Pick<Cycle, 'templateByJob'>, job: ID): ID => c.templateByJob[job] ?? c.templateByJob.office ?? Object.values(c.templateByJob)[0]

/**
 * 저장 데이터 정리 (v12 → v13, 새 데이터 공통): 직무·직급 목록을 만들고 모든 직원(재직·퇴사)을 ID로 연결한다.
 * 직급 평가 구분은 지금의 임원 표시·팀장 연결(tierOf)로 정한다 — 이름 글자로 추측하지 않음.
 * 목록에 없는 직무 값·직급 이름이 있으면 빠짐없이 항목으로 만든다. 다시 실행해도 바뀌는 것이 없다.
 */
export function ensureCatalog(s: AppState, tierOf: (e: Employee) => EvalClass): string[] {
  const notes: string[] = []
  if (!s.jobs) s.jobs = structuredClone(DEFAULT_JOBS)
  const seenJobs = new Set([...s.employees.map((e) => e.jobType), ...s.cycles.flatMap((c) => c.targets.map((t) => t.jobType))])
  for (const j of seenJobs) if (j && !s.jobs.some((x) => x.id === j)) { s.jobs.push({ id: j, name: JOB_LABEL[j] ?? j }); notes.push(`직무 목록에 추가: ${JOB_LABEL[j] ?? j}`) }
  if (!s.positions) s.positions = structuredClone(DEFAULT_POSITIONS)
  for (const e of s.employees) {
    if (positionById(s, e.positionId)) continue
    const c = tierOf(e)
    const name = (e.position ?? '').trim()
    // 같은 이름·같은 평가 구분 직급이 있으면 그 직급, 기본 이름(임원·팀장·사원)이거나 비었으면 평가 구분의 기본 직급
    let p = s.positions.find((x) => x.name === name && x.evalClass === c)
    if (!p && (!name || EVAL_CLASSES.includes(name as EvalClass))) p = classDefault(s, c)
    if (!p) {
      const taken = s.positions.some((x) => x.name === name)
      p = { id: `pos-${s.positions.length}-${c === '임원' ? 'x' : c === '팀장' ? 'l' : 's'}`, name: taken ? `${name}(${c})` : name, evalClass: c }
      s.positions.push(p)
      notes.push(`직급 목록에 추가: ${p.name} (평가 구분 ${c})`)
    }
    e.positionId = p.id
    if (e.active) e.position = p.name
  }
  return notes
}
