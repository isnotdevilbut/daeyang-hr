// 빈 상태로 시작(empty-start): 직원·팀·평가·응답·KPI·문항이 하나도 없는 처음 상태.
// 남기는 것은 '틀'뿐 — 직급 목록(임원·팀장·사원), 직무 목록(관리직·생산직), 등급 기준, 빈 평가표 하나(새 평가가 이걸로 평가표 틀을 만듦).
// 가상 직원·응답은 코드에 넣지 않는다. 샘플은 별도 CSV 파일을 화면에서 올려 채운다.
import type { AppState, Cycle, SlotKey, Template } from './types'
import { DRAFT_ID } from './templates'
import { SCHEMA_VERSION } from './schemaVersion'
import { applyVersions, blankTemplate, slotScope } from './versions'

export function createEmptyState(): AppState {
  return {
    schemaVersion: SCHEMA_VERSION,
    companies: [],
    departments: [],
    teams: [],
    employees: [],
    templates: [{ id: DRAFT_ID, name: '빈 평가표', origin: 'draft', jobType: 'common', targetRole: 'any', locked: false, version: 1, sourceNote: '', sections: [] }],
    cycles: [],
    responses: {},
    tokens: [],
    kpi: [],
    kpiIndicators: [],
    policy: { id: 'policy-v0', name: '개발용 가정 v0', isAssumption: true, adjustMode: 'additive', gradeRatios: { A: 25, B: 25, C: 35, D: 15, E: 0 } },
    adjustments: [],
    session: { role: 'admin', personaId: null },
    jobs: [{ id: 'office', name: '관리직' }, { id: 'production', name: '생산직' }],
    positions: [
      { id: 'pos-exec', name: '임원', evalClass: '임원', builtIn: true },
      { id: 'pos-lead', name: '팀장', evalClass: '팀장', builtIn: true },
      { id: 'pos-staff', name: '사원', evalClass: '사원', builtIn: true },
    ],
  }
}

/** 원본 웹앱과 같은 평가표 구성(평가자 → 평가대상 화살표 8개를 6개 평가표가 나눠 맡음) — 문항은 비어 있고 CSV로 올린다 */
const FORMS: { name: string; slots: SlotKey[] }[] = [
  { name: '자기평가(사원)', slots: ['self-member', 'self-exec'] },
  { name: '팀장평가표', slots: ['lead-member'] },
  { name: '임원평가표', slots: ['exec-member', 'exec-lead'] },
  { name: '팀장 자기평가표', slots: ['self-lead'] },
  { name: '팀원→팀장 평가표', slots: ['up-lead'] },
  { name: '임원 상향평가표', slots: ['up-exec'] },
]

/** 새 평가의 평가표가 모두 비어 있으면(빈 상태로 시작) 원본과 같은 6개 평가표 틀로 바꾼다. 문항이 있으면 그대로 */
export function emptyForms(s: Pick<AppState, 'responses'>, c: Cycle): void {
  // 판단 기준 = 평가표 목록에서 가져온 기본 평가표(상향평가표는 기본 문항으로 자동 생성되므로 보지 않음)
  const any = [...new Set(Object.values(c.templateByJob))].some((id) => c.templates[id]?.sections.some((sec) => sec.questions.length > 0))
  if (any || !c.versions) return
  const templates: Record<string, Template> = {}
  c.versions = FORMS.map((f) => {
    const t = blankTemplate(f.name)
    templates[t.id] = t
    return { templateId: t.id, name: f.name, scope: slotScope(f.slots) }
  })
  for (const id of Object.values(c.templateByJob)) if (!templates[id]) templates[id] = structuredClone(c.templates[id] ?? blankTemplate('빈 평가표')) // 직무별 연결(이전 방식) 자리 보존
  c.templates = templates
  applyVersions(s, c) // 배정마다 맡은 평가표 연결
}

