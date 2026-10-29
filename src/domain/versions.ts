// 평가표 버전 (D-082): 회차 안의 용도별 평가표(엑셀 시트처럼)와 적용 범위.
// - 버전 = cycle.templates[templateId]의 문항 세트 + 이름 + 적용 범위. 응답 보존용 내부 개정(문항 잠금·사용 중지)과는 별개
// - 범위: 모두에게 동일 적용(공통 기본 — 평가 유형별로 하나) / 직접 선택(평가받는 대상자의 팀·직급 + 평가 유형)
// - 한 배정에는 평가표 하나: 조건에 맞는 지정 버전이 하나면 그것, 없으면 공통 기본, 지정 버전이 둘 이상이면
//   관리자가 고른 버전(versionPicks)이 없는 한 바꾸지 않고 "충돌"로 알린다(임의 우선순위 없음). 문항은 합치지 않는다
// - 응답(작성 중·제출)이 있는 배정의 평가표는 조용히 바꾸지 않는다. 확정 회차는 다루지 않는다
import type { AppState, Assignment, Cycle, EvaluatorRule, ID, Template, TemplateVersion, VersionScope } from './types'
import { cloneQuestion, ctxFor, RULES, RULE_TEXT, applies } from './questions'
import { pathFor } from './progress'
import { templateFor } from './catalog'

export const ALL_SCOPE = (): VersionScope => ({ mode: 'all', rules: [...RULES], teams: 'all', positions: 'all' })
/** 목록에 보이는 버전(숨김 제외, 초안 포함) */
export const activeVersions = (c: Pick<Cycle, 'versions'>) => (c.versions ?? []).filter((v) => !v.archived)
/** 실제 평가표 선택에 쓰는 버전: 숨김·초안·적용 평가가 비어 있는 버전 제외 (D-085 — 조건이 비었다고 전체에 적용하지 않음) */
export const liveVersions = (c: Pick<Cycle, 'versions'>) => activeVersions(c).filter((v) => !v.draft && v.scope.rules.length > 0)
export const pickKey = (ids: ID[]) => [...ids].sort().join('|')

export interface VersionCtx { rule: EvaluatorRule; teamId?: ID; positionId?: ID; employeeId?: ID }
export interface Resolution { templateId: ID | null; candidates: ID[]; conflict: boolean }

/** 평가받는 사람 조건: 직접 선택한 사람(employees) 또는 팀, 그리고 직급 (D-087) */
export const whoInScope = (sc: VersionScope, x: Omit<VersionCtx, 'rule'>) =>
  (sc.employees ? (!!x.employeeId && sc.employees.includes(x.employeeId)) : (sc.teams === 'all' || (!!x.teamId && sc.teams.includes(x.teamId))))
  && (sc.positions === 'all' || (!!x.positionId && sc.positions.includes(x.positionId)))
const inScope = (v: TemplateVersion, x: VersionCtx) => v.scope.rules.includes(x.rule) && whoInScope(v.scope, x)

/** 이 상황(평가 유형·대상 팀·대상 직급)에 쓰는 평가표 — 실제 평가·미리보기 공통 */
export function resolveVersion(c: Pick<Cycle, 'versions' | 'versionPicks' | 'templateByJob'>, x: VersionCtx & { jobType?: string }): Resolution {
  if (!c.versions?.length) return { templateId: x.jobType ? templateFor(c, x.jobType) : templateFor(c, 'office'), candidates: [], conflict: false }
  const act = liveVersions(c)
  const custom = act.filter((v) => v.scope.mode === 'custom' && inScope(v, x)).map((v) => v.templateId)
  if (custom.length === 1) return { templateId: custom[0], candidates: custom, conflict: false }
  if (custom.length > 1) {
    const pick = c.versionPicks?.[pickKey(custom)]
    return pick && custom.includes(pick) ? { templateId: pick, candidates: custom, conflict: false } : { templateId: null, candidates: custom, conflict: true }
  }
  const common = act.filter((v) => v.scope.mode === 'all' && v.scope.rules.includes(x.rule)).map((v) => v.templateId)
  return { templateId: common[0] ?? null, candidates: common, conflict: common.length > 1 }
}

/** 배정의 상황 (평가 유형은 경로 규칙, 팀·직급은 대상자 스냅샷) */
export function assignmentCtx(c: Cycle, a: Assignment): VersionCtx & { jobType?: string } {
  const t = c.targets.find((x) => x.employeeId === a.targetId)
  const rule: EvaluatorRule = a.direction === 'self' ? 'self' : (t ? pathFor(c, t).find((st) => st.order === a.stageOrder)?.rule : undefined) ?? 'teamLead'
  return { rule, teamId: t?.departmentId || undefined, positionId: t?.positionId, employeeId: a.targetId, jobType: t?.jobType }
}

export type VersionProblem = { kind: 'conflict' | 'none' | 'empty'; a: Assignment; candidates: ID[] }

/** 응답 없는 배정에 알맞은 평가표를 연결하고, 연결할 수 없는 배정(충돌·평가표 없음·표시 문항 0개)을 돌려준다 */
export function applyVersions(s: Pick<AppState, 'responses'>, c: Cycle): VersionProblem[] {
  const problems: VersionProblem[] = []
  if (!c.versions?.length || c.status === '확정') return problems
  for (const a of c.assignments) {
    if (a.excluded) continue
    const r = resolveVersion(c, assignmentCtx(c, a))
    if (r.templateId && !s.responses[a.id] && a.templateId !== r.templateId) a.templateId = r.templateId
    if (r.conflict) { problems.push({ kind: 'conflict', a, candidates: r.candidates }); continue }
    if (!r.templateId) { problems.push({ kind: 'none', a, candidates: [] }); continue }
    const tpl = c.templates[a.templateId]
    if (!tpl || visibleCount(tpl, c, a) === 0) problems.push({ kind: 'empty', a, candidates: [] })
  }
  return problems
}

export const visibleCount = (t: Template, c: Cycle, a: Assignment) => t.sections.reduce((n, sec) => n + sec.questions.filter((q) => applies(q, ctxFor(c, a))).length, 0)

/** 이번 회차 참여 대상자 중 이 범위(사람·팀·직급)에 드는 사람 — 최종 적용 인원 표시·빈 대상 검사 (D-087) */
export const scopeTargets = (c: Pick<Cycle, 'targets'>, sc: VersionScope) =>
  sc.mode === 'all' ? c.targets : c.targets.filter((t) => whoInScope(sc, { teamId: t.departmentId || undefined, positionId: t.positionId, employeeId: t.employeeId }))

/** 공통 기본(모두에게 동일 적용)은 평가 유형별로 하나만 */
export function scopeErrors(c: Pick<Cycle, 'versions'>, templateId: ID, scope: VersionScope): string[] {
  const e: string[] = []
  if (!scope.rules.length) e.push('적용 평가를 하나 이상 고르세요.')
  if (scope.mode === 'custom') {
    if (scope.employees && !scope.employees.length) e.push('적용할 사람을 한 명 이상 고르세요(또는 전체 팀).')
    else if (!scope.employees && scope.teams !== 'all' && !scope.teams.length) e.push('적용 팀을 고르세요(또는 전체 팀).')
    if (scope.positions !== 'all' && !scope.positions.length) e.push('적용 직급을 고르세요(또는 전체 직급).')
  } else {
    for (const v of liveVersions(c)) {
      if (v.templateId === templateId || v.scope.mode !== 'all') continue
      const dup = scope.rules.filter((r) => v.scope.rules.includes(r))
      if (dup.length) e.push(`'${v.name}'이(가) 이미 ${dup.map((r) => RULE_TEXT[r]).join('·')}의 공통 기본입니다.`)
    }
  }
  return e
}

/** 응답(작성 중 포함)이 있는 배정이 쓰는 평가표 = 사용 이력 */
export const versionUsed = (s: Pick<AppState, 'responses'>, c: Cycle, templateId: ID) => c.assignments.some((a) => a.templateId === templateId && !!s.responses[a.id])

const uid = (p: string) => `${p}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`

export function blankTemplate(name: string): Template {
  return { id: uid('tpl'), name, origin: 'draft', jobType: 'common', targetRole: 'any', locked: false, version: 1, sourceNote: '', sections: [] }
}

/** 복제: 영역·문항·선택지 ID를 새로 부여, 점수·선택지·한국어·러시아어 번역과 설정은 함께 (원본과 독립) */
export function cloneTemplate(t: Template, name: string): Template {
  const c = structuredClone(t)
  c.id = uid('tpl'); c.name = name; c.version = 1; c.locked = false
  c.sections = t.sections.map((sec) => ({ ...structuredClone(sec), id: uid('sec'), questions: sec.questions.map((q) => cloneQuestion(q, true)) }))
  return c
}

/** 새 버전(빈 평가표·복제본)은 초안으로 시작 — 적용 전까지 평가에 쓰이지 않음 (D-085) */
export function addVersion(c: Cycle, tpl: Template, name: string, scope: VersionScope, draft = true) {
  c.templates[tpl.id] = tpl
  c.versions = [...(c.versions ?? []), { templateId: tpl.id, name, scope, ...(draft ? { draft: true } : {}) }]
}

/** 초안 저장: 검증 없이 보관. 초안 버전은 name·scope에 바로, 적용 중인 버전은 pending에(적용 전까지 기존 설정 유지) */
export function saveVersionDraft(c: Cycle, templateId: ID, name: string, scope: VersionScope) {
  c.versions = (c.versions ?? []).map((v) => {
    if (v.templateId !== templateId) return v
    if (v.draft) return { ...v, name, scope }
    const same = v.name === name && JSON.stringify(v.scope) === JSON.stringify(scope)
    const { pending: _p, ...rest } = v; void _p
    return same ? rest : { ...v, pending: { name, scope } }
  })
  if (c.templates[templateId] && (c.versions.find((v) => v.templateId === templateId)?.draft)) c.templates[templateId].name = name
}

/** 적용: 필수 조건·이름·겹침(관리자가 고른 버전 포함) 검증 후 실제 적용. 실패하면 오류 목록(호출 쪽에서 초안으로 보관) */
export function applyVersion(s: Pick<AppState, 'responses'>, c: Cycle, templateId: ID, name: string, scope: VersionScope, picks: Record<string, ID>): { errors: string[]; conflicts: VersionProblem[] } {
  const errors = scopeErrors(c, templateId, scope)
  if (!name.trim()) errors.push('버전 이름을 입력하세요.')
  // D-087: 문항 0개·적용 대상 0명이면 적용하지 않음(초안으로 보관)
  const tpl = c.templates[templateId]
  if (!tpl || !tpl.sections.some((sec) => sec.questions.some((q) => q.active))) errors.push('문항이 없습니다. 문항을 추가한 뒤 적용하세요.')
  if (scope.mode === 'custom' && !errors.some((x) => x.startsWith('적용할 사람') || x.startsWith('적용 팀') || x.startsWith('적용 직급')) && !scopeTargets(c, scope).length) errors.push('조건에 맞는 이번 회차 대상자가 없습니다.')
  if (activeVersions(c).some((x) => x.templateId !== templateId && x.name === name.trim())) errors.push(`'${name.trim()}' 이름이 이미 있습니다.`)
  const trial = structuredClone(c)
  trial.versions = trial.versions!.map((x) => (x.templateId === templateId ? { templateId, name: name.trim(), scope } : x))
  trial.versionPicks = picks
  const conflicts = applyVersions(s, trial).filter((x) => x.kind === 'conflict')
  if (conflicts.length) errors.push('겹치는 평가가 있습니다. 적용할 버전을 고르거나 조건을 고치세요.')
  if (errors.length) return { errors, conflicts }
  c.versions = c.versions!.map((x) => (x.templateId === templateId ? { templateId, name: name.trim(), scope } : x)) // draft·pending 해제
  c.templates[templateId].name = name.trim()
  c.versionPicks = picks
  applyVersions(s, c)
  return { errors: [], conflicts: [] }
}

/** 삭제: 사용 이력(응답)이 있으면 목록에서만 숨김(기록용 문항 보존), 없으면 지움. 응답 없는 배정은 다시 연결 */
export function deleteVersion(s: Pick<AppState, 'responses'>, c: Cycle, templateId: ID): 'archived' | 'deleted' {
  const used = versionUsed(s, c, templateId)
  if (used) c.versions = (c.versions ?? []).map((v) => (v.templateId === templateId ? { ...v, archived: true } : v))
  else c.versions = (c.versions ?? []).filter((v) => v.templateId !== templateId)
  if (c.versionPicks) for (const [k, v] of Object.entries(c.versionPicks)) if (v === templateId || k.split('|').includes(templateId)) delete c.versionPicks[k]
  applyVersions(s, c)
  if (!used && !c.assignments.some((a) => a.templateId === templateId) && !Object.values(c.templateByJob).includes(templateId)) delete c.templates[templateId]
  return used ? 'archived' : 'deleted'
}

/** 이전 데이터 → 버전: 직무별 평가표가 하나로 같으면 그 평가표를 "공통 평가표"로. 확정 회차·직무별로 다른 평가표는 이전 방식 그대로 */
export function ensureVersions(c: Cycle): boolean {
  if (c.versions || c.status === '확정') return false
  const ids = [...new Set(Object.values(c.templateByJob))].filter((id) => c.templates[id])
  if (ids.length !== 1) return false
  c.versions = [{ templateId: ids[0], name: '공통 평가표', scope: ALL_SCOPE() }]
  return true
}
