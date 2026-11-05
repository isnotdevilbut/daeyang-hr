// 평가표 버전 (D-082): 회차 안의 용도별 평가표(엑셀 시트처럼)와 적용 범위.
// - 버전 = cycle.templates[templateId]의 문항 세트 + 이름 + 적용 범위. 응답 보존용 내부 개정(문항 잠금·사용 중지)과는 별개
// - 범위: 모두에게 동일 적용(공통 기본 — 평가 유형별로 하나) / 직접 선택(평가받는 대상자의 팀·직급 + 평가 유형)
// - 한 배정에는 평가표 하나: 조건에 맞는 지정 버전이 하나면 그것, 없으면 공통 기본, 지정 버전이 둘 이상이면
//   관리자가 고른 버전(versionPicks)이 없는 한 바꾸지 않고 "충돌"로 알린다(임의 우선순위 없음). 문항은 합치지 않는다
// - 응답(작성 중·제출)이 있는 배정의 평가표는 조용히 바꾸지 않는다. 확정 회차는 다루지 않는다
import type { AppState, Assignment, Cycle, EvaluatorRule, ID, SlotKey, Template, TemplateVersion, VersionScope } from './types'
import { cloneQuestion, ctxFor, RULES, RULE_TEXT, applies } from './questions'
import { pathFor } from './progress'
import { templateFor } from './catalog'

/** 공통 기본 범위 = 자기·팀장·임원평가. 팀원→팀장평가(D-114)는 전용 평가표 버전이 따로 맡는다 */
export const ALL_SCOPE = (): VersionScope => ({ mode: 'all', rules: RULES.filter((r) => r !== 'upward'), teams: 'all', positions: 'all' })
/** 목록에 보이는 버전(숨김 제외, 초안 포함) */
export const activeVersions = (c: Pick<Cycle, 'versions'>) => (c.versions ?? []).filter((v) => !v.archived)
/** 실제 평가표 선택에 쓰는 버전: 숨김·초안·적용 평가가 비어 있는 버전 제외 (D-085 — 조건이 비었다고 전체에 적용하지 않음) */
export const liveVersions = (c: Pick<Cycle, 'versions'>) => activeVersions(c).filter((v) => !v.draft && v.scope.rules.length > 0)
export const pickKey = (ids: ID[]) => [...ids].sort().join('|')

export type Tier = '사원' | '팀장' | '임원'
export interface VersionCtx { rule: EvaluatorRule; teamId?: ID; positionId?: ID; employeeId?: ID; /** 평가받는 사람의 직급 구분(화살표 판단, D-211) */ tier?: Tier }

// ── 평가 화살표 (D-211) ─────────────────────────────
/** 화살표 8개: 평가하는 사람 → 평가받는 사람. 순서 = 화면 순서(1·2·3단계 → 상향평가) */
export const SLOTS: { key: SlotKey; rule: EvaluatorRule; tier: Tier; from: string; to: string }[] = [
  { key: 'self-member', rule: 'self', tier: '사원', from: '사원', to: '본인' },
  { key: 'self-lead', rule: 'self', tier: '팀장', from: '팀장', to: '본인' },
  { key: 'self-exec', rule: 'self', tier: '임원', from: '임원', to: '본인' },
  { key: 'lead-member', rule: 'teamLead', tier: '사원', from: '팀장', to: '사원' },
  { key: 'exec-member', rule: 'executive', tier: '사원', from: '임원', to: '사원' },
  { key: 'exec-lead', rule: 'executive', tier: '팀장', from: '임원', to: '팀장' },
  { key: 'up-lead', rule: 'upward', tier: '팀장', from: '사원', to: '팀장' },
  { key: 'up-exec', rule: 'upward', tier: '임원', from: '사원·팀장', to: '임원' },
]
export const slotOf = (rule: EvaluatorRule, tier?: Tier): SlotKey | undefined => SLOTS.find((x) => x.rule === rule && x.tier === tier)?.key
/** 화살표로 정하는 회차(D-211) — 버전 중 하나라도 slots가 있으면 */
export const slotMode = (c: Pick<Cycle, 'versions'>) => (c.versions ?? []).some((v) => !!v.scope.slots)
/** 화살표 목록으로 범위 만들기 — 평가 종류는 화살표에서, 팀·직급은 전체 */
export const slotScope = (slots: SlotKey[]): VersionScope => {
  const ks = SLOTS.filter((x) => slots.includes(x.key))
  return { mode: 'custom', rules: [...new Set(ks.map((x) => x.rule))], teams: 'all', positions: 'all', slots: ks.map((x) => x.key) }
}
/** 이 화살표를 맡은 적용 중 평가표(없으면 undefined = 평가 미배치) */
export const slotOwner = (c: Pick<Cycle, 'versions'>, key: SlotKey) => liveVersions(c).find((v) => v.scope.slots?.includes(key))
export interface Resolution { templateId: ID | null; candidates: ID[]; conflict: boolean }

/** 평가받는 사람 조건: 직접 선택한 사람(employees) 또는 팀, 그리고 직급 (D-087) */
export const whoInScope = (sc: VersionScope, x: Omit<VersionCtx, 'rule'>) =>
  (sc.employees ? (!!x.employeeId && sc.employees.includes(x.employeeId)) : (sc.teams === 'all' || (!!x.teamId && sc.teams.includes(x.teamId))))
  && (sc.positions === 'all' || (!!x.positionId && sc.positions.includes(x.positionId)))
const inScope = (v: TemplateVersion, x: VersionCtx) => v.scope.rules.includes(x.rule) && whoInScope(v.scope, x)

/** a의 평가받는 사람 조건이 b에 포함되는가(직급·팀·직접 선택한 사람). 판단할 수 없으면 false */
export function narrower(a: VersionScope, b: VersionScope): boolean {
  const sub = (x: 'all' | ID[], y: 'all' | ID[]) => y === 'all' || (x !== 'all' && x.every((v) => y.includes(v)))
  if (!sub(a.positions, b.positions)) return false
  if (b.employees) return !!a.employees && a.employees.every((e) => b.employees!.includes(e))
  if (a.employees) return b.teams === 'all'
  return sub(a.teams, b.teams)
}

/** 이 상황(평가 유형·대상 팀·대상 직급)에 쓰는 평가표 — 실제 평가·미리보기 공통 */
export function resolveVersion(c: Pick<Cycle, 'versions' | 'versionPicks' | 'templateByJob'>, x: VersionCtx & { jobType?: string }): Resolution {
  if (!c.versions?.length) return { templateId: x.jobType ? templateFor(c, x.jobType) : templateFor(c, 'office'), candidates: [], conflict: false }
  const act = liveVersions(c)
  // D-211: 화살표 방식 — 그 화살표를 맡은 평가표 하나(겹치지 않음). 맡은 평가표가 없으면 평가 미배치
  if (slotMode(c)) {
    const key = slotOf(x.rule, x.tier)
    const own = key ? act.filter((v) => v.scope.slots?.includes(key)).map((v) => v.templateId) : []
    return { templateId: own.length === 1 ? own[0] : null, candidates: own, conflict: own.length > 1 }
  }
  // D-210: 전체 체크(전체 팀·전체 직급) 평가표는 더 좁게 고른 평가표가 없을 때만 — 이전 '모두에게 동일 적용'과 같은 순서
  const hit = act.filter((v) => v.scope.mode === 'custom' && inScope(v, x))
  const narrowHit = hit.filter((v) => !wideScope(v.scope))
  const custom = (narrowHit.length ? narrowHit : hit).map((v) => v.templateId)
  if (custom.length === 1) return { templateId: custom[0], candidates: custom, conflict: false }
  if (custom.length > 1) {
    const pick = c.versionPicks?.[pickKey(custom)]
    if (pick && custom.includes(pick)) return { templateId: pick, candidates: custom, conflict: false }
    // D-125: 관리자가 고르지 않았으면 '더 좁게 지정한' 평가표 하나가 다른 모든 후보보다 좁을 때 그 평가표(예: 공통 = 사원·팀장, 팀장 자기평가표 = 팀장 → 팀장 자기평가는 팀장 자기평가표)
    const vs = custom.map((id) => act.find((v) => v.templateId === id)!)
    const narrowest = vs.filter((a) => vs.every((b) => a === b || (narrower(a.scope, b.scope) && !narrower(b.scope, a.scope))))
    if (narrowest.length === 1) return { templateId: narrowest[0].templateId, candidates: custom, conflict: false }
    return { templateId: null, candidates: custom, conflict: true }
  }
  const common = act.filter((v) => v.scope.mode === 'all' && v.scope.rules.includes(x.rule)).map((v) => v.templateId)
  return { templateId: common[0] ?? null, candidates: common, conflict: common.length > 1 }
}

/** 배정의 상황 (평가 유형은 경로 규칙, 팀·직급은 대상자 스냅샷) */
export function assignmentCtx(c: Cycle, a: Assignment): VersionCtx & { jobType?: string } {
  const t = c.targets.find((x) => x.employeeId === a.targetId)
  const rule: EvaluatorRule = a.direction === 'self' ? 'self' : a.direction === 'up' ? 'upward' : (t ? pathFor(c, t).find((st) => st.order === a.stageOrder)?.rule : undefined) ?? 'teamLead'
  // 평가받는 사람의 직급 구분: 회차 기록 기준. 대상자 명단에 없는 상향평가 대상은 임원(D-187)
  const tier: Tier | undefined = t ? (t.isExecutive ? '임원' : t.isTeamLead ? '팀장' : '사원') : a.direction === 'up' ? '임원' : undefined
  return { rule, teamId: t?.departmentId || undefined, positionId: t?.positionId, employeeId: a.targetId, jobType: t?.jobType, tier }
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
/** 대상자 명단에 없지만 상향평가를 받는 임원(D-187)도 센다 — 직접 선택한 사람으로만 판단(회차 정보가 없어 팀·직급은 모름, D-189) */
export const scopeTargets = (c: Pick<Cycle, 'targets'> & Partial<Pick<Cycle, 'assignments'>>, sc: VersionScope): { employeeId: ID }[] => {
  if (sc.slots) { // D-211: 화살표에 해당하는 배정의 평가받는 사람
    const cc = c as Cycle
    return [...new Set((cc.assignments ?? []).filter((a) => !a.excluded && sc.slots!.includes(slotOf(assignmentCtx(cc, a).rule, assignmentCtx(cc, a).tier) as SlotKey)).map((a) => a.targetId))].map((employeeId) => ({ employeeId }))
  }
  const extra = [...new Set((c.assignments ?? []).filter((a) => a.direction === 'up' && !a.excluded && !c.targets.some((t) => t.employeeId === a.targetId)).map((a) => a.targetId))]
    .map((employeeId) => ({ employeeId }))
  if (sc.mode === 'all') return [...c.targets, ...(sc.rules.includes('upward') ? extra : [])]
  return [
    ...c.targets.filter((t) => whoInScope(sc, { teamId: t.departmentId || undefined, positionId: t.positionId, employeeId: t.employeeId })),
    ...(sc.rules.includes('upward') ? extra.filter((x) => whoInScope(sc, x)) : []),
  ]
}

/** 공통 기본(모두에게 동일 적용)은 평가 유형별로 하나만 */
export function scopeErrors(c: Pick<Cycle, 'versions'>, templateId: ID, scope: VersionScope): string[] {
  const e: string[] = []
  if (scope.slots) { if (!scope.slots.length) e.push('이 평가표가 맡을 평가(화살표)를 하나 이상 고르세요.'); return e } // D-211: 화살표는 겹치지 않음
  if (!scope.rules.length) e.push('적용 평가를 하나 이상 고르세요.')
  if (scope.mode === 'custom') {
    if (scope.employees && !scope.employees.length) e.push('적용할 사람을 한 명 이상 고르세요(또는 전체 팀).')
    else if (!scope.employees && scope.teams !== 'all' && !scope.teams.length) e.push('적용 팀을 고르세요(또는 전체 팀).')
    if (scope.positions !== 'all' && !scope.positions.length) e.push('적용 직급을 고르세요(또는 전체 직급).')
  }
  // 전체 체크는 평가 유형별로 하나만(이전 '공통 기본은 평가 유형별 하나', D-210)
  if (wideScope(scope)) for (const v of liveVersions(c)) {
    if (v.templateId === templateId || !wideScope(v.scope)) continue
    const dup = scope.rules.filter((r) => v.scope.rules.includes(r))
    if (dup.length) e.push(`'${v.name}'이(가) 이미 ${dup.map((r) => RULE_TEXT[r]).join('·')}에 전체로 적용돼 있습니다. 한쪽은 팀·직급·사람을 골라 주세요.`)
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
  const trial = withScope(c, templateId, name.trim(), scope)
  trial.versionPicks = picks
  const conflicts = applyVersions(s, trial).filter((x) => x.kind === 'conflict')
  if (conflicts.length) errors.push('겹치는 평가가 있습니다. 적용할 버전을 고르거나 조건을 고치세요.')
  if (errors.length) return { errors, conflicts }
  c.versions = withScope(c, templateId, name.trim(), scope).versions // draft·pending 해제. 화살표는 다른 평가표에서 옮겨 옴(D-211)
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

/** 전체(모든 팀·모든 직급, 사람 지정 없음)를 고른 범위 — 이전 '모두에게 동일 적용'도 포함(D-210) */
export const wideScope = (sc: VersionScope) => sc.mode === 'all' || (sc.teams === 'all' && sc.positions === 'all' && !sc.employees)

/**
 * D-210: '모두에게 동일 적용 / 직접 선택하기' 구분 없앰 — 모든 평가표는 적용 평가·팀(사람)·직급을 체크해서 정한다.
 * 이전 '모두에게 동일 적용'(mode 'all')은 '전체 체크'(custom, 전체 팀·전체 직급)로 바꾼다 — 누가 어떤 평가표를 받는지는 그대로
 * (겹치면 더 좁게 고른 평가표가 먼저, D-125). 마감·확정 회차는 바꾸지 않음(화면에서 열면 전체 체크로 보임). 바꾼 버전 수
 */
export function scopesToCustom(c: Cycle): number {
  if (!c.versions || (c.status !== '준비' && c.status !== '진행')) return 0
  let n = 0
  const fix = (sc: VersionScope): VersionScope => (sc.mode === 'all' ? (n++, { mode: 'custom', rules: sc.rules, teams: 'all', positions: 'all' }) : sc)
  c.versions = c.versions.map((v) => ({ ...v, scope: fix(v.scope), ...(v.pending ? { pending: { ...v.pending, scope: fix(v.pending.scope) } } : {}) }))
  return n
}
/** v29 → v30 (D-210): 준비·진행 회차의 '모두에게 동일 적용' 평가표를 '전체 체크'로. 배정·응답 그대로, 반복 안전 */
export function versionScopesV30(s: AppState): string[] {
  const notes: string[] = []
  for (const c of s.cycles) { const n = scopesToCustom(c); if (n) notes.push(`${c.name}: '모두에게 동일 적용' 평가표 ${n}개 → 전체 체크(적용 대상 그대로)`) }
  return notes
}

/**
 * 이 평가표의 범위를 바꾼 회차 사본(D-211): 화살표는 한 평가표만 — 이 평가표가 맡은 화살표를 다른 평가표(적용 중·초안·수정 초안)에서 뺀다.
 * 적용 전 미리보기와 적용이 같은 함수를 쓴다
 */
export function withScope(c: Cycle, templateId: ID, name: string, scope: VersionScope): Cycle {
  const t = structuredClone(c)
  const mine = scope.slots ?? []
  const strip = (sc: VersionScope) => (sc.slots && mine.some((k) => sc.slots!.includes(k)) ? slotScope(sc.slots.filter((k) => !mine.includes(k))) : sc)
  t.versions = (t.versions ?? []).map((x) => x.templateId === templateId ? { templateId, name, scope } : { ...x, scope: strip(x.scope), ...(x.pending ? { pending: { ...x.pending, scope: strip(x.pending.scope) } } : {}) })
  return t
}

/**
 * D-211: 평가표 범위를 화살표로 — 지금 누가 어떤 평가표를 받는지 그대로 화살표에 옮긴다(화살표마다 지금 쓰이는 평가표 하나).
 * 수정 초안(pending)·초안 버전은 적용 평가 × 직급 조건에 맞는 화살표로(이미 다른 평가표가 맡은 화살표는 빼지 않고 적용 때 옮김).
 * 준비·진행 회차만, 이미 화살표 방식이면 그대로. 팀·사람 단위 조건은 쓰지 않게 됨
 */
export function toSlots(s: Pick<AppState, 'employees' | 'positions'>, c: Cycle): boolean {
  if (!c.versions?.length || slotMode(c) || (c.status !== '준비' && c.status !== '진행')) return false
  const tierPos = (tier: Tier) => (s.positions ?? []).find((p) => p.evalClass === tier)?.id
  const tierOfT = (t: Cycle['targets'][number]): Tier => (t.isExecutive ? '임원' : t.isTeamLead ? '팀장' : '사원')
  const owner = new Map<SlotKey, ID>()
  for (const sl of SLOTS) {
    // 대표 평가받는 사람: 그 직급의 회차 대상자(상향평가 임원은 참여 임원) — 없으면 직급만으로
    const t = c.targets.find((x) => tierOfT(x) === sl.tier)
    const ex = sl.key === 'up-exec' ? s.employees.find((e) => e.active && e.isExecutive && !e.isCeo && !(c.execOff ?? []).includes(e.id)) : undefined
    const ctx: VersionCtx = t ? { rule: sl.rule, teamId: t.departmentId || undefined, positionId: t.positionId, employeeId: t.employeeId } : { rule: sl.rule, teamId: ex?.teamId, positionId: ex?.positionId ?? tierPos(sl.tier), employeeId: ex?.id }
    const r = resolveVersion(c, ctx)
    if (r.templateId) owner.set(sl.key, r.templateId)
  }
  const guess = (sc: VersionScope): SlotKey[] => SLOTS.filter((sl) => sc.rules.includes(sl.rule) && (sc.positions === 'all' || sc.positions.includes(tierPos(sl.tier) ?? ''))).map((x) => x.key)
  c.versions = c.versions.map((v) => {
    const live = !v.archived && !v.draft && v.scope.rules.length > 0
    const scope = live ? slotScope(SLOTS.filter((sl) => owner.get(sl.key) === v.templateId).map((x) => x.key)) : slotScope(guess(v.scope))
    return { ...v, scope, ...(v.pending ? { pending: { ...v.pending, scope: slotScope(guess(v.pending.scope)) } } : {}) }
  })
  return true
}
/** v31 → v32 (D-211): 준비·진행 회차의 평가표 범위를 화살표로(누가 어떤 평가표를 받는지 그대로). 반복 안전 */
export function versionSlotsV32(s: AppState): string[] {
  const notes: string[] = []
  for (const c of s.cycles) if (toSlots(s, c)) notes.push(`${c.name}: 평가표 적용 범위를 화살표(누가 → 누구를)로`)
  return notes
}
