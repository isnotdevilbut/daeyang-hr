// 데이터 계약. 목업(localStorage)과 실서비스(서버 DB)가 같은 타입을 사용한다.
// 자세한 설명: docs/data-model.md

export type ID = string

/** 직무 ID (D-080). 기본 직무는 'office'(관리직)·'production'(생산직) 그대로, 관리자가 추가한 직무는 고유 ID. 이름은 AppState.jobs */
export type JobType = string
/** 기본 직무의 처음 이름(직무 목록이 없는 이전 데이터 호환용). 화면 표시는 catalog.jobName */
export const JOB_LABEL: Record<string, string> = { office: '관리직', production: '생산직' }

/** 직무 (D-080): 이름만 바뀌고 직원은 ID로 연결. archived = 삭제(이전 회차 기록의 이름 참조용으로만 남음) */
export interface JobDef { id: ID; name: string; archived?: boolean }
/** 직급 평가 구분 (D-080) — 평가 동작은 이 값으로, 화면에는 직급 이름 */
export type EvalClass = '임원' | '팀장' | '사원'
/** 직급 (D-080): 표시 이름 + 평가 구분. builtIn = 처음 목업의 임원·팀장·사원(평가 구분 변경·삭제 불가, 이름은 변경 가능) */
export interface PositionDef { id: ID; name: string; evalClass: EvalClass; builtIn?: boolean }

/** 내부 호환용. 화면에서는 회사·부서를 구분하지 않는다 (D-012, D-017, D-065) */
export interface Company { id: ID; name: string }
export interface Department { id: ID; companyId: ID; name: string }
/** archived = 삭제한 팀(D-064): 현재 조직 목록·선택지에서 빠지고, 퇴사 처리된 직원 등 이전 기록의 참조용으로만 남는다 */
export interface Team { id: ID; /** 이전 구조의 상위 부서(호환용, 화면에서 쓰지 않음 — D-065) */ departmentId?: ID; name: string; leadId: ID | null; archived?: boolean }

/** 직원 응답 화면 언어 (D-019): 한국어·러시아어. 관리자 화면은 한국어만 */
export type Lang = 'ko' | 'ru'

export interface Employee {
  id: ID
  empNo: string // 문자열: 앞자리 0 보존
  name: string
  teamId: ID
  position: string // 직급 표시 이름(positionId 직급의 이름과 같게 유지)
  /** 직급 ID (D-080). 평가 구분은 직급 설정에서, 실제 팀장 여부는 팀장 연결로 */
  positionId?: ID
  jobType: JobType
  isExecutive: boolean // 임원 (업무 역할)
  isCeo: boolean // 대표자 (업무 역할)
  active: boolean // 재직·활성
  evalExcluded: boolean // 새 회차의 기본 평가 대상에서 제외 (재직 여부와 별개)
  /** 미사용(D-019): 언어는 직원이 응답 화면에서 직접 고른다. 이전 저장 데이터 호환을 위해 선택 필드로만 남김 */
  preferredLang?: string | null
  /** 사용자 정의 분류 기준 값 (분류 기준 ID → 텍스트 또는 선택지 ID, D-078). 평가·로그인과 무관 */
  custom?: Record<ID, string>
}

// ── 평가표 ──────────────────────────────────────────
export type QuestionType = 'single' | 'ox' | 'scale5' | 'grade' | 'short' | 'long'
export const QTYPE_LABEL: Record<QuestionType, string> = {
  single: '단일선택(객관식)',
  ox: 'O/X (예/아니오)',
  scale5: '5점 척도',
  grade: '등급 선택',
  short: '짧은 주관식',
  long: '긴 서술형',
}

/**
 * 평가 방향: 누가 누구를 평가하는가 (진행 단계와 별개).
 * 'up'(팀원→팀장)은 2026-10-27 후속 확인으로 활성 기능에서 제외. 2022 원본 양식 보존용으로만 남긴다.
 */
export type Direction = 'self' | 'down' | 'up'
export const DIRECTION_LABEL: Record<Direction, string> = {
  self: '자기평가',
  down: '상위자 평가(하향)',
  up: '팀원→팀장(과거 양식, 미사용)',
}

export type AreaKey = 'performance' | 'ability' | 'attitude' | 'compliance' | 'culture' | 'leadership'
export const AREA_LABEL: Record<AreaKey, string> = {
  performance: '업무성과',
  ability: '업무능력',
  attitude: '근무태도',
  compliance: '규정준수',
  culture: '조직문화 기여도',
  leadership: '리더십(팀장)',
}
/** 2025 가이드라인의 5개 평가영역 */
export const FIVE_AREAS: AreaKey[] = ['performance', 'ability', 'attitude', 'compliance', 'culture']

export interface Option { id: ID; label: string; value: number | null } // 정보 문항은 value=null

/**
 * 저장된 러시아어 번역 (D-075, "번역문 미리 저장" 방식 — 외부 번역 요청 없음).
 * 선택지 번역은 선택지 고유 ID로 연결한다(순서·문구가 바뀌어도 점수·응답 연결 유지).
 * basis = 번역할 때 기준이 된 한국어 원문. 한국어가 바뀌면 관리자 편집 영역에만 "번역 재확인" 표시.
 */
export interface QuestionTr {
  title?: string
  help?: string
  options?: Record<ID, string>
  basis?: { title: string; help: string; options: Record<ID, string> }
}
export interface SectionTr { title?: string; basis?: string }

export interface Question {
  id: ID
  type: QuestionType
  title: string
  help: string
  required: boolean
  purpose: 'score' | 'info' // 점수 문항 / 정보 수집 문항
  maxPoints: number | null // 원본 양식의 표시 배점 (참고용)
  /** 영역 안 문항 배점(D-103) — 영역 달성 비율을 구할 때의 문항 비중. 영역 배점과 중복 합산하지 않는다. 서술형은 채점값 범위(0~배점) */
  points?: number | null
  options: Option[]
  directions: Direction[] // 이 문항에 답하는 평가 방향 (self / down)
  active: boolean
  /** 적용 평가 세분화: 자기평가·팀장평가·임원평가. 비어 있으면 directions만으로 판단 (이전 데이터 호환) */
  rules?: EvaluatorRule[]
  /** 다른 언어 번역(현재 러시아어만). 없으면 한국어 원문 표시 */
  i18n?: { ru?: QuestionTr }
  /** 적용 직무. 비어 있으면 전체 */
  jobs?: JobType[]
  /** 적용 대상(평가받는 사람): 팀원/팀장. 비어 있으면 전체 */
  targetRoles?: ('member' | 'lead')[]
  /** 문항별 추가 제한(D-082, 선택): 평가받는 대상자의 팀·직급 ID. 비어 있으면 평가표 버전의 범위를 그대로 따름 */
  teams?: ID[]
  positions?: ID[]
}

/** points = 영역 배점(D-103). 하나라도 있으면 그 평가표는 배점 방식으로 계산(없으면 이전 방식). desc = 영역 설명(관리자 편집·참고) */
export interface Section { id: ID; title: string; area: AreaKey | null; questions: Question[]; i18n?: { ru?: SectionTr }; points?: number | null; desc?: string }

export interface Template {
  id: ID
  name: string
  origin: '2022' | '2025' | 'draft'
  jobType: JobType | 'common'
  targetRole: 'member' | 'lead' | 'any'
  locked: boolean // 원본 보존 (편집 불가, 복제해서 사용)
  version: number
  sourceNote: string
  sections: Section[]
  /** 등급 문항의 점수 환산(D-103, 평가표별 수정 가능). 없으면 기본 A=5·B=4·C=3·D=2·E=1 */
  gradeScale?: Record<string, number>
}

// ── 회차·배정·응답 ─────────────────────────────────
/** upward = 팀원 → 팀장평가(D-114): 사원이 소속 팀 팀장을 평가. 경로(path) 단계가 아니라 별도 배정(direction 'up', 1단계 분류) — 점수·순차 잠금에 넣지 않음 */
export type EvaluatorRule = 'self' | 'teamLead' | 'executive' | 'upward'
export const RULE_LABEL: Record<EvaluatorRule, string> = { self: '본인', teamLead: '소속 팀장', executive: '담당 임원', upward: '소속 팀원' }

/** 진행 단계 (순서). 방향과 평가자 규칙을 가진다. */
export interface Stage { order: number; label: string; direction: Direction; rule: EvaluatorRule }

export interface PathPolicy {
  member: Stage[] // 사원 대상자의 경로
  lead: Stage[] // 팀장 대상자의 경로
  /** 임원 대상자의 경로 (D-068): 자기평가(1단계)만. 없으면 기본값 */
  exec?: Stage[]
  gating: 'perTarget' | 'allTargets'
  isAssumption: true // 회사 확정 전 검토용 가정
}

/** 평가 상태 4가지 (D-054). 이전의 '보정검토'는 저장 데이터 변환 시 '마감'으로 바뀐다 */
export type CycleStatus = '준비' | '진행' | '마감' | '확정'

export interface TargetSnapshot {
  employeeId: ID
  name: string
  empNo: string
  companyName: string // 이전 데이터 호환용 (새 회차는 빈 값)
  /** 조직 단위 = 팀 (D-065): 새 기준에서는 팀 ID·팀 이름. KPI·팀 보정·결과 묶음의 키. 확정된 이전 회차는 그때의 부서 값이 남아 있다 */
  departmentId: ID
  departmentName: string
  /** 네 팀 정리 전의 조직 단위(옛 부서 ID, D-065). 그 단위에 기록된 팀 보정이 새 팀 보정이 없을 때 그대로 적용된다 — 최종 점수가 정리 때문에 바뀌지 않게 */
  legacyUnitId?: ID
  teamName: string
  position: string
  jobType: JobType
  isTeamLead: boolean
  /** 회차 시작 시점 임원 여부. 임원은 본인이 받는 평가가 자기평가(1단계, 켠 경우)뿐 (D-068) */
  isExecutive?: boolean
  /** 직급 ID (D-082, 평가표 버전·문항 범위 판단용 — 확정 회차는 없을 수 있음) */
  positionId?: ID
}

export interface Assignment {
  id: ID
  targetId: ID // employeeId
  evaluatorId: ID
  direction: Direction
  stageOrder: number // 진행 단계 번호
  templateId: ID // cycle.templates 스냅샷의 id
  /** 집계·작성에서 빠진 배정 (지우지 않고 응답과 함께 보존). execSelf = 이전 기준의 임원 자기평가(D-056), selfOff = 관리자가 자기평가를 끔(D-068), leadChanged = 팀장이 바뀌기 전 이전 팀장이 쓴 시연 응답(D-079, 보존만), reassigned = 작성 중에 담당 임원을 바꿔 이전 임원의 임시저장을 보존만(D-086) */
  excluded?: 'execSelf' | 'selfOff' | 'leadChanged' | 'reassigned'
}

/** 평가표 버전 적용 범위 (D-082). 팀·직급은 "평가받는 대상자" 기준. all = 모두에게 동일 적용(공통 기본 — 평가 유형별 하나) */
/**
 * employees(D-087) = 직접 선택한 평가받는 사람(직원 ID). 있으면 teams 대신 이 목록으로 대상을 고른다(새 직원 자동 포함 없음, 이름·팀이 바뀌어도 유지).
 * 없으면 이전 방식(팀 단위 — 그 팀의 대상자 전체). positions는 어느 쪽이든 함께 충족해야 함
 */
export interface VersionScope { mode: 'all' | 'custom'; rules: EvaluatorRule[]; teams: 'all' | ID[]; positions: 'all' | ID[]; employees?: ID[] }
/**
 * draft = 아직 적용하지 않은 초안 버전(평가표 선택·배정·점수에 쓰이지 않음, D-085).
 * pending = 적용 중인 버전의 이름·적용 범위를 고친 초안(적용 전까지 name·scope가 그대로 쓰임)
 */
export interface TemplateVersion { templateId: ID; name: string; scope: VersionScope; archived?: boolean; draft?: boolean; pending?: { name: string; scope: VersionScope } }

export interface Cycle {
  id: ID
  name: string
  period: string
  dueDate: string
  status: CycleStatus
  templateByJob: Record<JobType, ID>
  path: PathPolicy
  templates: Record<ID, Template> // 이 회차 전용 문항 복사본 (다른 회차와 공유하지 않음)
  /** 회차별 단계 반영 비율(%) — 경로별. null = 미입력 (0으로 간주하지 않음) */
  stageWeights: { member: Record<number, number | null>; lead: Record<number, number | null>; exec?: Record<number, number | null> }
  /** 팀장·임원의 자기평가 참여 여부(회차별·직원별, D-068). 없으면 기본값: 팀장 켬, 임원 끔. 사원은 항상 자기평가 */
  selfEval?: Record<ID, boolean>
  /** 이 회차에 참여하지 않는 임원(직원 ID, D-072). 없으면 재직 임원 모두 참여 — 참여 임원만 새 배정의 평가자로 고른다. 사원·팀장의 참여는 targets */
  execOff?: ID[]
  /** 관리자가 임원 평가 배정에서 담당 임원을 비워 둔 대상자(D-087) — 자동 채우기(distributeExecs)에서 빼고 '미지정'(미완료)으로 둔다 */
  execUnassigned?: ID[]
  /** 평가표 버전(D-082): 이 회차의 용도별 평가표(문항 세트 = templates[templateId])와 적용 범위. 없으면 이전 방식(직무별 templateByJob) */
  versions?: TemplateVersion[]
  /** 지정 버전 둘 이상이 같은 평가에 겹칠 때 관리자가 고른 버전 — 키 = 겹친 버전 ID를 정렬해 '|'로 이은 값 */
  versionPicks?: Record<string, ID>
  /** 부서 KPI의 개인평가 반영 (D-041). 기존 회차는 꺼진 상태로 변환 */
  /** 직급별 최종 반영 예시(D-103, 보관·검증만 — 적용 보류) */
  finalBlendPlan?: FinalBlendPlan
  kpiBlend: KpiBlend
  targets: TargetSnapshot[]
  assignments: Assignment[]
  createdAt: string
}

export type AnswerValue = string | null
export interface Response {
  assignmentId: ID
  answers: Record<ID, AnswerValue> // questionId → optionId 또는 텍스트
  status: 'draft' | 'submitted'
  savedAt: string
  submittedAt: string | null
  lang: Lang
  /** 목업이 만든 기본 시연 응답(D-082). 사용자 기록과 구분하는 표시 */
  demo?: boolean
}

/** 미사용(D-049): 개인 링크 접속은 사번 로그인으로 대체. 이전 저장 데이터 보존을 위해 타입만 남김 */
export interface LinkToken { token: string; cycleId: ID; employeeId: ID; revoked: boolean }

// ── KPI·계산·보정 ─────────────────────────────────
/** 부서 KPI 기록(회차·부서별 1개). score = "직접 입력" 점수 — 지표 계산으로 바꿔도 지우지 않고 보관 */
export interface KpiEntry {
  cycleId: ID
  departmentId: ID
  score: number | null // null = 미입력 (0과 구분)
  /** 점수 출처: manual = 직접 입력, indicators = 지표 계산. 없으면 직접 입력 점수가 있을 때 manual (D-040) */
  mode?: 'manual' | 'indicators'
  // 아래는 v3까지 화면에서 입력받던 값. 화면에서는 쓰지 않고 이전 데이터 보존용으로만 남김
  range?: string
  unit?: string
  source?: string
  basisPeriod?: string
}

export type KpiUnit = 'percent' | 'count' | 'point' | 'amount' | 'other'
/** KPI 지표 (회차·부서별 여러 개) */
export interface KpiIndicator {
  id: ID
  cycleId: ID
  departmentId: ID
  name: string
  unit: KpiUnit
  direction: 'higher' | 'lower' // 높을수록 좋음 / 낮을수록 좋음
  target: number | null // null = 미입력
  actual: number | null
  weight: number | null // 부서 KPI 안의 지표 가중치(%)
}

/** 회차별 부서 KPI 개인평가 반영 설정. 비율은 % (합계 100) */
export interface KpiBlend { enabled: boolean; personal: number | null; kpi: number | null }

/** 직급별 최종 반영 요소(D-103, 자문 예시) — 저장·검증만 하고 아직 점수에 적용하지 않는다(의미·상향평가 미정) */
export type FinalPart = 'personal' | 'self' | 'kpi' | 'upward'
export interface FinalBlendItem { key: FinalPart; on: boolean; pct: number | null }
export type FinalBlendPlan = Record<'member' | 'lead' | 'exec', FinalBlendItem[]>

export interface CalcPolicy {
  id: ID
  name: string
  isAssumption: true
  /** v2까지 쓰던 전체 공통 가중치(상대 비중). v3부터 회차별 Cycle.stageWeights 사용, 이전 데이터 변환용으로만 남김 */
  stageWeights?: Record<number, number>
  /** v3까지의 표시값. v4부터 회차별 Cycle.kpiBlend 사용 */
  kpiMode?: string
  adjustMode: 'additive'
  gradeRatios: { A: number; B: number; C: number; D: number } // 참고값
}

export type AdjustKind = 'dept' | 'person' | 'ceoScore' | 'ceoGrade'
export interface Adjustment {
  id: ID
  cycleId: ID
  kind: AdjustKind
  targetKey: ID // dept: departmentId, 그 외: employeeId
  value: number | string | null
  reason: string
  by: string
  at: string
  before: number | string | null
}

/**
 * 로그인 계정에 연결된 화면 역할 (대표자 전용 화면은 없음 — D-035).
 * 평가 참여자(직원·팀장·임원)는 사번으로 로그인하고, 역할은 로그인 화면에서 고르지 않고 조직 데이터로 정한다 (D-048).
 */
export type DemoRole = 'admin' | 'member' | 'lead' | 'exec'
export const ROLE_LABEL: Record<DemoRole, string> = {
  admin: '운영담당자',
  member: '사원',
  lead: '팀장',
  exec: '임원',
}

/** 현재 로그인한 시연 계정의 역할. finalAdjust = 최종 점수·등급 지정 가능(목업 검토용 가정, D-036) */
export interface DemoSession { role: DemoRole; personaId: ID | null; finalAdjust?: boolean; accountId?: string }

/** 직원 분류 기준(사용자 정의 열, D-078). 이름과 별도 ID — 이름을 바꿔도 직원별 값 유지 */
export interface CustomField { id: ID; name: string; type: 'text' | 'select'; options: { id: ID; label: string }[] }

export interface AppState {
  schemaVersion: number
  companies: Company[]
  departments: Department[]
  teams: Team[]
  employees: Employee[]
  templates: Template[]
  cycles: Cycle[]
  responses: Record<ID, Response> // assignmentId → 응답
  tokens: LinkToken[]
  kpi: KpiEntry[]
  kpiIndicators: KpiIndicator[]
  policy: CalcPolicy
  adjustments: Adjustment[]
  /** 서술형 점수 문항의 관리자 채점값(D-103): 배정 ID → 문항 ID → 점수(0~문항 배점). 없으면 미채점(0점 아님) */
  manualScores?: Record<ID, Record<ID, number>>
  session: DemoSession
  /** 직원 분류 기준(없으면 빈 목록) */
  customFields?: CustomField[]
  /** 관리자 메모: 직원 ID → 자유 메모(관리자 화면 전용, 평가·리포트·다운로드에 쓰지 않음) */
  memos?: Record<ID, string>
  /** 개인 리포트 추가 기록 (D-081): 키 = `${회차 ID}|${직원 ID}`. 직원 메모·평가 의견·보정 사유와 별개, 점수·응답에 영향 없음 */
  reportNotes?: Record<string, string>
  /** 직무·직급 목록 (D-080) */
  jobs?: JobDef[]
  positions?: PositionDef[]
}
