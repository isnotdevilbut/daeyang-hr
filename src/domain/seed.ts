// 가상 데이터. 실제 직원·조직·평가 결과가 아니다. 이름은 "성 + 역할" 형태의 가상 이름.
import { LEAD_BLEND_OLD, scoringV16 } from './scoringV16'
import { execPerTeam } from './execTeamsV17'
import { versionScopesV30, versionSlotsV32 } from './versions'
import { purgeInactiveV33 } from './org'
import { stripVirtualV34 } from './demoV34'
import { gradeQNoExecV35 } from './gradeQV35'
import { unifyTextV36 } from './qtypeV36'
import { EXEC_BLEND_OLD, execUpwardFormV27, execUpwardPairsV28, upwardDemoMoreV29, upwardExecV26, upwardPairedV31, upwardV18 } from './upward'
import { joinAllStaff } from './joinAllV19'
import { leadUpwardOpen, moreDemo } from './demoV20'
import { demoKpiV23 } from './demoV23'
import { rosterAndPaths } from './rosterV12'
import { ensureCatalog } from './catalog'
import { syncCycle } from './cycleSync'
import { v15 } from './demoV15'
import { tierOf } from './org'
import { reorganizeToFourTeams } from './reorg'
import { fixedStagesAndTiers } from './stagesV8'
import { attachDefaultTranslations } from '../i18n/content'
import { execsAndAssignments } from './execsV10'
import { selfForStaff } from './cycle'
import type { AppState, Employee, Response, Team } from './types'
import { ORIGINAL_TEMPLATES, makeDraftTemplate } from './templates'
import { createCycle, DEFAULT_TEMPLATE_BY_JOB, eligibleTargets } from './cycle'
import { isUnlocked } from './progress'

// v2: 상향평가 제외 / v3: 단계 반영 비율 회차별 / v4: KPI 지표·개인평가 반영. 이전 저장본은 data/migrate.ts에서 변환
export const SCHEMA_VERSION = 36

function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296
    return seed / 4294967296
  }
}

const emp = (
  id: string, empNo: string, name: string, teamId: string, position: string, jobType: Employee['jobType'],
  extra: Partial<Employee> = {},
): Employee => ({
  id, empNo, name, teamId, position, jobType,
  isExecutive: false, isCeo: false, active: true, evalExcluded: false, ...extra,
})

const SELF_TEXTS = [
  '상반기 주요 설비 납품 일정을 맞추고 설계 변경 요청을 정리했습니다. (가상 응답)',
  '신규 거래처 3곳과 협의를 진행했고 견적 처리 시간을 줄였습니다. (가상 응답)',
  '라인 정리정돈과 안전점검 체크리스트를 꾸준히 지켰습니다. (가상 응답)',
  '후배 작업자 교육을 맡아 작업 표준서를 정리했습니다. (가상 응답)',
]
const GOAL_TEXTS = [
  '자동화 설비 관련 자격증 취득을 목표로 하겠습니다. (가상 응답)',
  '업무 매뉴얼을 정리해 부재 시에도 대응 가능하게 하겠습니다. (가상 응답)',
  '불량률을 줄이기 위해 작업 전 점검을 습관화하겠습니다. (가상 응답)',
]
const SUGGEST = ['', '휴게 공간 냉난방 점검을 부탁드립니다. (가상 응답)', '', '교육 일정을 미리 공지해 주시면 좋겠습니다. (가상 응답)']
const OPINION = [
  '일정 관리가 안정적임. 문서화는 보완 필요. (가상 의견)',
  '협업 태도가 좋음. 신규 업무 적응을 지원할 예정. (가상 의견)',
  '안전 수칙 준수가 모범적임. (가상 의견)',
]

/** 시드가 넣은 시연용 응답 문구(꼬리말 포함 원문 그대로). 화면 표시에서만 꼬리말을 뗀다 — 사용자가 입력한 글은 대상 아님 */
export const SEED_TEXTS: ReadonlySet<string> = new Set([...SELF_TEXTS, ...GOAL_TEXTS, ...SUGGEST.filter(Boolean), ...OPINION])
export function displayAnswer(v: string): string {
  return SEED_TEXTS.has(v) ? v.replace(/\s*\(가상 (응답|의견)\)$/, '') : v
}

/** legacy = 네 팀 정리 전의 이전 구조 그대로 (변환 테스트용) */
/** until: 그 저장 구조 버전까지의 단계만(이전 버전 저장 데이터 시험용 — 화면은 항상 최신) */
export function createSeed(opts: { legacy?: boolean; until?: number } = {}): AppState {
  const teams: Team[] = [
    { id: 'tm-plan', departmentId: 'd-a-mgmt', name: '경영기획팀', leadId: 'e04' },
    { id: 'tm-sales', departmentId: 'd-a-mgmt', name: '영업팀', leadId: 'e07' },
    { id: 'tm-design', departmentId: 'd-a-tech', name: '설계팀', leadId: 'e10' },
    { id: 'tm-prod1', departmentId: 'd-a-prod', name: '생산1팀', leadId: 'e13' },
    { id: 'tm-prod2', departmentId: 'd-a-prod', name: '생산2팀', leadId: 'e17' },
    { id: 'tm-b-adm', departmentId: 'd-b-mgmt', name: '관리팀', leadId: 'e21' },
    { id: 'tm-b-prod', departmentId: 'd-b-prod', name: '생산팀', leadId: 'e24' },
  ]
  const employees: Employee[] = [
    emp('e01', '0001', '홍대표', 'tm-plan', '대표이사', 'office', { isCeo: true, evalExcluded: true }),
    emp('e02', '0002', '김임원', 'tm-plan', '이사', 'office', { isExecutive: true, evalExcluded: true }),
    emp('e03', '0003', '박임원', 'tm-prod1', '상무', 'production', { isExecutive: true, evalExcluded: true }),
    emp('e04', '0004', '이팀장', 'tm-plan', '차장', 'office'),
    emp('e05', '0005', '최사원', 'tm-plan', '대리', 'office'),
    emp('e06', '0006', '정사원', 'tm-plan', '사원', 'office'),
    emp('e07', '0007', '강팀장', 'tm-sales', '과장', 'office'),
    emp('e08', '0008', '조사원', 'tm-sales', '대리', 'office'),
    emp('e09', '0009', '윤사원', 'tm-sales', '사원', 'office'),
    emp('e10', '0010', '장팀장', 'tm-design', '차장', 'office'),
    emp('e11', '0011', '임사원', 'tm-design', '과장', 'office'),
    emp('e12', '0012', '한사원', 'tm-design', '사원', 'office'),
    emp('e13', '0013', '오반장', 'tm-prod1', '반장', 'production'),
    emp('e14', '0014', '서작업', 'tm-prod1', '주임', 'production'),
    emp('e15', '0015', '신작업', 'tm-prod1', '사원', 'production'),
    emp('e16', '0016', '바크트(가상)', 'tm-prod1', '사원', 'production'),
    emp('e17', '0017', '권반장', 'tm-prod2', '반장', 'production'),
    emp('e18', '0018', '황작업', 'tm-prod2', '주임', 'production'),
    emp('e19', '0019', '안작업', 'tm-prod2', '사원', 'production'),
    emp('e20', '0020', '누를란(가상)', 'tm-prod2', '사원', 'production'),
    emp('e21', '0021', '송팀장', 'tm-b-adm', '과장', 'office'),
    emp('e22', '0022', '류사원', 'tm-b-adm', '사원', 'office'),
    emp('e23', '0023', '전임원', 'tm-b-adm', '이사', 'office', { isExecutive: true, evalExcluded: true }),
    emp('e24', '0024', '배반장', 'tm-b-prod', '반장', 'production'),
    emp('e25', '0025', '고작업', 'tm-b-prod', '사원', 'production'),
    emp('e26', '0026', '문작업', 'tm-b-prod', '사원', 'production', { evalExcluded: true }), // 예: 입사 6개월 미만(규칙 미정)
  ]

  const state: AppState = {
    schemaVersion: SCHEMA_VERSION,
    companies: [
      { id: 'c-a', name: '가상회사 A' },
      { id: 'c-b', name: '가상회사 B' },
    ],
    departments: [
      { id: 'd-a-mgmt', companyId: 'c-a', name: '경영지원부' },
      { id: 'd-a-tech', companyId: 'c-a', name: '기술부' },
      { id: 'd-a-prod', companyId: 'c-a', name: '생산부' },
      { id: 'd-b-mgmt', companyId: 'c-b', name: '관리부' },
      { id: 'd-b-prod', companyId: 'c-b', name: '생산지원부' }, // 이름에 회사 표시를 넣지 않음
    ],
    teams,
    employees,
    templates: [...ORIGINAL_TEMPLATES, makeDraftTemplate()],
    cycles: [],
    responses: {},
    tokens: [],
    kpi: [],
    kpiIndicators: [],
    policy: {
      id: 'policy-v0',
      name: '개발용 가정 v0',
      isAssumption: true,
      adjustMode: 'additive',
      gradeRatios: { A: 25, B: 25, C: 35, D: 15, E: 0 },
    },
    adjustments: [],
    session: { role: 'admin', personaId: null },
  }

  const cycle = createCycle(state, {
    name: '2026 하반기 인사평가',
    period: '2026-07-01 ~ 2026-12-31',
    dueDate: '2026-11-30',
    presetId: 'A',
    templateByJob: DEFAULT_TEMPLATE_BY_JOB,
    targetIds: eligibleTargets(state).map((e) => e.id),
  }, true, false) // 원래 시연 데이터 그대로(임원평가 한 명, 팀원→팀장평가는 끝에서 upwardV18) → 끝에서 저장 데이터 변환과 같은 syncCycle로 임원 전원 연결 (D-081)
  cycle.status = '진행'
  // 개발용 가정(회사 승인값 아님): 단계별 동일 비중. docs/scoring.md
  cycle.stageWeights = { member: { 1: 33.3, 2: 33.3, 3: 33.4 }, lead: { 1: 50, 3: 50 }, exec: { 1: 100 } } // 단계 번호 = 평가 유형(D-068)
  state.cycles.push(cycle)

  // 가상 응답: 대상자별로 진행 정도를 다르게
  const rand = rng(42)
  const now = Date.parse('2026-10-27T09:00:00+09:00')
  const fill = (assignmentId: string, status: Response['status']) => {
    const a = cycle.assignments.find((x) => x.id === assignmentId)!
    const t = cycle.templates[a.templateId]
    const answers: Record<string, string | null> = {}
    for (const s of t.sections)
      for (const q of s.questions) {
        if (!q.directions.includes(a.direction)) continue
        if (status === 'draft' && q.id !== 'd-s1') continue // 작성 중: 첫 문항만 작성한 상태
        if (q.options.length) {
          const bias = q.type === 'scale5' ? Math.floor(rand() * 3) : Math.floor(rand() * q.options.length)
          answers[q.id] = q.options[Math.min(bias, q.options.length - 1)].id
        } else if (q.id === 'd-s1') answers[q.id] = SELF_TEXTS[Math.floor(rand() * SELF_TEXTS.length)]
        else if (q.id === 'd-s2') answers[q.id] = GOAL_TEXTS[Math.floor(rand() * GOAL_TEXTS.length)]
        else if (q.id === 'd-s3') answers[q.id] = SUGGEST[Math.floor(rand() * SUGGEST.length)]
        else answers[q.id] = OPINION[Math.floor(rand() * OPINION.length)]
      }
    const at = new Date(now - Math.floor(rand() * 5 * 864e5)).toISOString()
    state.responses[assignmentId] = { assignmentId, answers, status, savedAt: at, submittedAt: status === 'submitted' ? at : null, lang: 'ko' }
  }
  // 진행 수준: 0=미시작, 1=1단계 작성 중, 2=1단계 제출, 3=2단계까지 제출, 4=전 단계 제출
  // 대상자 순서: 이팀장, 최사원, 정사원, 강팀장, 조사원, 윤사원, 장팀장, … (강팀장은 자기평가 작성 중 + 윤사원 평가 차례 — 팀장의 두 역할 시연)
  const levels = [4, 4, 3, 1, 4, 2, 3, 0, 4, 2, 3, 4, 1, 2, 4, 0, 3, 4, 2, 4]
  cycle.targets.forEach((t, i) => {
    const lv = levels[i % levels.length]
    const staged = cycle.assignments.filter((a) => a.targetId === t.employeeId).sort((a, b) => a.stageOrder! - b.stageOrder!)
    staged.forEach((a) => {
      const o = a.stageOrder!
      if (lv === 1 && o === 1) fill(a.id, 'draft')
      else if (lv >= 2 && o === 1) fill(a.id, 'submitted')
      else if (lv >= 3 && o === 2) fill(a.id, 'submitted')
      else if (lv >= 4 && o >= 3) fill(a.id, 'submitted')
    })
  })
  // 잠금 규칙과 모순되는 가상 응답이 없는지 확인
  for (const a of cycle.assignments) if (state.responses[a.id] && !isUnlocked(cycle, state.responses, a)) delete state.responses[a.id]

  // 개인 링크는 만들지 않는다 — 직원도 사번으로 로그인 (D-049). tokens는 이전 데이터 호환용 빈 목록

  // 기존 방식의 "직접 입력" 부서 KPI 점수 (가상). 지표 예시는 넣지 않는다 — 지표는 화면에서 등록
  state.kpi = [
    { cycleId: cycle.id, departmentId: 'd-a-mgmt', score: 88, mode: 'manual' },
    { cycleId: cycle.id, departmentId: 'd-a-tech', score: 92, mode: 'manual' },
    { cycleId: cycle.id, departmentId: 'd-a-prod', score: 0, mode: 'manual' }, // 0과 미입력 구분 시연
  ]
  state.adjustments = [
    { id: 'adj-1', cycleId: cycle.id, kind: 'dept', targetKey: 'd-a-prod', value: 1, reason: '시연용 예시 (가상)', by: '운영담당자(시연)', at: new Date(now).toISOString(), before: null },
  ]
  // 네 팀 구조·자연스러운 가상 성명으로 정리 (D-065) — 저장 데이터 변환과 같은 함수라 새 데이터와 변환된 데이터가 같다
  if (opts.legacy) { state.schemaVersion = 6; return state }
  reorganizeToFourTeams(state)
  fixedStagesAndTiers(state) // 고정 단계 번호·세 직급·대표자 → 임원 (D-068) — 저장 데이터 변환과 같은 함수
  attachDefaultTranslations(state) // 기본 문항 러시아어 번역 초안 (D-075) — 저장 데이터 변환과 같은 함수
  execsAndAssignments(state) // 임원 4명 보장·현재 팀장 기준 2단계·임원평가 분배 (D-076) — 저장 데이터 변환과 같은 함수
  state.cycles.forEach((c) => selfForStaff(state, c.id)) // 현재 사원은 자기평가 필수 (D-077)
  rosterAndPaths(state, () => true) // 35명 구성·현재 조직 기준 평가 경로 (D-079) — 새 데이터의 응답은 모두 시연 응답
  ensureCatalog(state, (e) => tierOf(state, e)) // 직무·직급 목록과 ID 연결 (D-080) — 저장 데이터 변환과 같은 함수
  state.cycles.forEach((c) => syncCycle(state, c, () => true)) // 배정 맞추기 (D-081) — 저장 데이터 변환과 같은 함수
  joinAllStaff(state) // 재직 사원·팀장 모두 평가 참여 (D-116) — 임원 담당 나누기(v15) 전에 넣어 새 데이터와 변환 데이터가 같게
  v15(state, () => true) // 평가표 버전·임원 담당 나누기·시연 완료 구성(팀장 2·임원 1) (D-082) — 저장 데이터 변환과 같은 함수
  scoringV16(state) // 평가표 배점·팀장 자기평가표·반영 비율 20/40/40 (D-103) — 저장 데이터 변환과 같은 함수
  for (const c of state.cycles) if (c.finalBlendPlan) c.finalBlendPlan.exec = EXEC_BLEND_OLD() // v26 이전 저장 데이터와 같게: 임원 상향평가 꺼짐 → 끝에서 upwardExecV26 (D-187)
  execPerTeam(state) // 임원 팀마다 한 명 (D-110) — 저장 데이터 변환과 같은 함수
  upwardV18(state) // 팀원→팀장평가 배정·시연 응답 (D-114) — 저장 데이터 변환과 같은 함수
  if ((opts.until ?? SCHEMA_VERSION) < 20) { state.schemaVersion = opts.until!; return state }
  moreDemo(state) // 시연 완료 비중 높임 (D-117) — 저장 데이터 변환과 같은 함수
  leadUpwardOpen(state) // 장현우 팀원→팀장평가 5/6 (D-121) — 저장 데이터 변환과 같은 함수
  if ((opts.until ?? SCHEMA_VERSION) < 23) { state.schemaVersion = opts.until!; return state }
  demoKpiV23(state) // 경영기획팀 가상 KPI 지표 (D-151) — 저장 데이터 변환과 같은 함수
  if ((opts.until ?? SCHEMA_VERSION) < 24) { delete (state.policy.gradeRatios as Partial<AppState['policy']['gradeRatios']>).E; state.schemaVersion = opts.until!; return state } // v24 이전: E 등급 없음 (D-160)
  if ((opts.until ?? SCHEMA_VERSION) < 25) { for (const c of state.cycles) if (c.finalBlendPlan) c.finalBlendPlan.lead = LEAD_BLEND_OLD(); state.schemaVersion = opts.until!; return state } // v25 이전: 팀장 20/30/40 (D-183)
  if ((opts.until ?? SCHEMA_VERSION) < 26) { state.schemaVersion = opts.until!; return state }
  upwardExecV26(state) // 상향평가 팀원·팀장 → 임원·임원 최종 반영 상향평가 켬 (D-187) — 저장 데이터 변환과 같은 함수
  if ((opts.until ?? SCHEMA_VERSION) < 27) { state.schemaVersion = opts.until!; return state }
  execUpwardFormV27(state) // 임원 상향평가표(임원 직접 선택) (D-189) — 저장 데이터 변환과 같은 함수
  if ((opts.until ?? SCHEMA_VERSION) < 28) { state.schemaVersion = opts.until!; return state }
  execUpwardPairsV28(state) // 임원 상향평가 = 담당 임원 기준 (D-191) — 새 시드는 이미 담당 기준이라 바뀌는 것 없음
  if ((opts.until ?? SCHEMA_VERSION) < 29) { state.schemaVersion = opts.until!; return state }
  upwardDemoMoreV29(state) // 상향평가 시연 제출 늘림(시연 화면) (D-208) — 저장 데이터 변환과 같은 함수
  if ((opts.until ?? SCHEMA_VERSION) < 30) { state.schemaVersion = opts.until!; return state }
  versionScopesV30(state) // 평가표 범위 = 체크 방식(모두에게 동일 적용 → 전체 체크) (D-210) — 저장 데이터 변환과 같은 함수
  if ((opts.until ?? SCHEMA_VERSION) < 31) { state.schemaVersion = opts.until!; return state }
  upwardPairedV31(state) // 임원 상향평가 따로 배정 없앰(쌍방) (D-212) — 새 시드는 바뀌는 것 없음
  if ((opts.until ?? SCHEMA_VERSION) < 32) { state.schemaVersion = opts.until!; return state }
  versionSlotsV32(state) // 평가표 범위 = 화살표(누가 → 누구를) (D-211) — 저장 데이터 변환과 같은 함수
  if ((opts.until ?? SCHEMA_VERSION) < 33) { state.schemaVersion = opts.until!; return state }
  purgeInactiveV33(state) // 퇴사 처리 직원 완전 삭제 (D-216) — 새 시드는 없음
  if ((opts.until ?? SCHEMA_VERSION) < 34) { state.schemaVersion = opts.until!; return state }
  stripVirtualV34(state) // '(가상)' 표시 떼기 (D-218) — 저장 데이터 변환과 같은 함수
  if ((opts.until ?? SCHEMA_VERSION) < 35) { state.schemaVersion = opts.until!; return state }
  gradeQNoExecV35(state) // 임원평가에서 종합 등급 빼기 (D-223) — 저장 데이터 변환과 같은 함수
  if ((opts.until ?? SCHEMA_VERSION) < 36) { state.schemaVersion = opts.until!; return state }
  unifyTextV36(state) // 주관식 하나로 (D-230) — 저장 데이터 변환과 같은 함수
  return state
}
