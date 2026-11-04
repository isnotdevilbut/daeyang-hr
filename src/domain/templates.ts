// 평가표 템플릿. 2022·2025는 원본 PDF 문구를 옮긴 "원본 보존" 템플릿(locked).
// 원본: 대양롤랜트_ClaudeCode_전달자료/references/평가양식/
import type { AreaKey, Direction, Option, Question, QuestionType, Section, Template } from './types'

const opts = (qid: string, items: [string, number | null][]): Option[] =>
  items.map(([label, value], i) => ({ id: `${qid}-o${i + 1}`, label, value }))

function q(
  id: string,
  type: QuestionType,
  title: string,
  p: Partial<Omit<Question, 'id' | 'type' | 'title'>> & { optionItems?: [string, number | null][] } = {},
): Question {
  const { optionItems, ...rest } = p
  return {
    id,
    type,
    title,
    help: '',
    required: true,
    purpose: 'info',
    maxPoints: null,
    options: optionItems ? opts(id, optionItems) : type === 'ox' ? opts(id, [['예(O)', null], ['아니오(X)', null]]) : [],
    directions: ['self'],
    active: true,
    ...rest,
  }
}

const sec = (id: string, title: string, area: AreaKey | null, questions: Question[]): Section => ({ id, title, area, questions })

// ── 2022 공통 요소 ──────────────────────────────────
const AE: [string, number | null][] = [['A (5점)', 5], ['B (4점)', 4], ['C (3점)', 3], ['D (2점)', 2], ['E (1점)', 1]]
const EVAL_DIRS: Direction[] = ['self', 'down'] // 1차·2차·3차 열 — 방향 대응은 미정(원본 표시 그대로 보존)

/** 평정요소 1개 = A~E 등급 문항 1개, 평가내용 문장은 안내문으로 보존 */
const factor = (id: string, title: string, points: number, lines: string[], dirs: Direction[] = EVAL_DIRS) =>
  q(id, 'grade', `${title} (배점 ${points})`, {
    help: lines.map((l) => '· ' + l).join('\n'),
    purpose: 'score',
    maxPoints: points,
    optionItems: AE,
    directions: dirs,
  })

function selfObservation(p: string): Section {
  const five = (a: string[]) => a.map((l) => [l, null] as [string, null])
  return sec(`${p}-obs`, '자기관찰', null, [
    q(`${p}-obs1`, 'long', '현재 주요 담당 업무'),
    q(`${p}-obs2`, 'single', '업무의 양', { optionItems: five(['너무 많다', '약간 많다', '알맞다', '약간 적다', '너무 적다']) }),
    q(`${p}-obs3`, 'single', '업무의 난이도', { optionItems: five(['매우 어렵다', '약간 어렵다', '보통이다', '약간 쉽다', '매우 쉽다']) }),
    q(`${p}-obs4`, 'single', '업무에 대한 적성', { optionItems: five(['매우 적합', '비교적 적합', '보통이다', '약간 부적합', '매우 부적합']) }),
    q(`${p}-obs5`, 'single', '업무에 대한 만족도', { optionItems: five(['매우 만족', '비교적 만족', '보통이다', '비교적 불만', '매우 불만']) }),
    q(`${p}-obs6`, 'single', '부서 내 대인 관계', { optionItems: five(['매우 만족', '비교적 만족', '보통이다', '비교적 불만', '매우 불만']) }),
    q(`${p}-obs7`, 'single', '이동희망여부 및 시기', { optionItems: five(['가급적 빨리', '1년 이내', '2 ~ 3년 후', '현직 유지']) }),
    q(`${p}-obs8`, 'short', '이동 희망시 희망 부서', { required: false }),
    q(`${p}-obs9`, 'long', '기타 인력관리 등 의견', { required: false }),
    q(`${p}-obs10`, 'long', '건의사항', { required: false, help: '예) 부패, 횡령 등 고발 / 비윤리적 이슈 제보 / 이해관계 상충, 고충 등' }),
  ])
}

const selfNarrative = (p: string) => [
  q(`${p}-nar`, 'long', '본인의 주요 활동 및 성과 기재'),
  factor(`${p}-nar-g`, '본인서술형', 8, ['본인의 주요 활동 및 성과 기재 내용에 대한 평정']),
]

const L = {
  customer: [
    '고객(직원)들이 (피평가자를) 신뢰하고 있다',
    '고객(직원)들과의 의사소통(수정 사항 협의, 요구 사항, 일정 등)이 원활하다',
    '고객(직원)들의 불합리한 요청에도 적절한 방식으로 대응하며, 합의 가능한 중재안을 도출한다',
    '고객(직원)들의 요청에 즉각적이며 적극적으로 응대한다',
  ],
  qtyOffice: [
    '평가대상기간 중 수행한 업무량이 다른 직원들에 비해 상대적으로 많다',
    '업무를 처리하는 속도가 다른 직원들에 비해 신속하며 정확하다',
    '완성된 업무의 품질이 다른 직원들에 비해 상대적으로 우수하다',
    '업무 처리가 정확하고 실수가 없거나 적으며, 결과물을 신뢰할 수 있다',
    '규정된 프로세스를 준수하기 위해 노력한다',
  ],
  qtyProd: [
    '평가대상기간 중 수행한 작업이 다른 직원들에 비해 상대적으로 많다',
    '작업을 수행하는 속도가 다른 직원들에 비해 신속하며 정확하다',
    '완성된 작업의 품질이 다른 직원들에 비해 상대적으로 우수하다',
    '작업의 처리가 정확하고 실수가 없거나 적으며, 결과물을 신뢰할 수 있다',
    '안전수칙 및 규정된 프로세스를 준수하기 위해 노력한다',
  ],
  diffOffice: [
    '다른 직원들이 힘들어 하는 업무도 비교적 성공적으로 수행해 낸다',
    '어려운 업무도 포기하지 않고 해결방안을 찾기 위해 스스로 노력한다',
    '업무적 중압감을 잘 이겨내고, 자기 감정을 조절하여, 업무 수행을 일관되게 유지한다',
  ],
  diffProd: [
    '다른 직원들이 힘들어 하는 작업도 비교적 성공적으로 수행해 낸다',
    '어려운 작업도 포기하지 않고 해결방안을 찾기 위해 스스로 노력한다',
    '업무적 중압감을 잘 이겨내고, 자기 감정을 조절하여, 작업 수행을 일관되게 유지한다',
  ],
  mgmtOffice: [
    '업무 계획을 적절하게 수립하여 주어진 업무를 효율적으로 수행하고 완료한다',
    '업무를 규정된 시간 내에 처리하려고 노력한다',
    '업무관련 정보(자료)의 분류, 정리, 보관이 체계적이며 기록 및 관리가 잘 이루어진다',
    '자료/메일이 체계적으로 관리되어, 관련자가 쉽게 검색할 수 있고, 부재/비상시 대응이 가능하다',
  ],
  mgmtProd: [
    '생산 계획을 적절하게 수립하여 주어진 작업을 효율적으로 수행하고 완료한다',
    '작업을 규정된 시간 내에 처리하려고 노력한다',
    '작업관련 정보(자료)의 분류, 정리, 보관이 체계적이며 기록 및 관리가 잘 이루어진다',
    '자신의 작업 공간이 정돈되어 있으며 공구 및 설비의 관리가 잘 이루어진다',
    '다른 작업자가 부재/비상시 대응이 가능하다',
  ],
  jobOffice: [
    '업무를 원활하게 수행할 수 있는 지식 또는 기능을 보유하고 있다',
    '직무능력을 향상시키기 위해 적극적으로 노력한다',
    '업무를 익히는 속도가 빠르고 직무 능력이 뛰어나다',
  ],
  jobProd: [
    '작업을 원활하게 수행할 수 있는 지식 또는 기능을 보유하고 있다',
    '작업능력을 향상시키기 위해 적극적으로 노력한다',
    '작업을 익히는 속도가 빠르고 작업 능력이 뛰어나다',
  ],
  commOffice: [
    '의사소통 능력이 뛰어나고 상대방을 설득하는 능력이 있다',
    '프리젠테이션을 잘 수행할 수 있다',
    '혼자서 일을 처리하기 보다는 동료들과 협업하여 보다 효율적으로 일을 처리하려 한다',
  ],
  commProd: [
    '의사소통 능력이 뛰어나고 상대방을 설득하는 능력이 있다',
    '혼자서 일을 처리하기 보다는 동료들과 협업하여 보다 효율적으로 일을 처리하려 한다',
  ],
  judge: [
    '자신의 직무를 정확하게 파악하고 실행한다',
    '회사의 방향과 팀의 목표 등을 정확하게 이해하고 수행한다',
    '위기상황에서 위기관리 및 대처 능력이 있다',
  ],
  judgeLeadExtra: '업무과제를 신속, 정확하게 해결하는 판단력과 합리적인 의사결정을 내릴 수 있는 결단력이 있다',
  etcOffice: [
    '직무와 관련된 문제점, 개선사항 등을 정확하게 분석하여 보고한다',
    '직무와 관련된 정보를 분류하고 분석하는 능력이 있다',
    '보고서 등 업무관련 문서의 작성 능력이 뛰어나다',
    '중요한 사항들을 잘 기억하고 관리할 줄 아는 능력이 있다',
  ],
  etcProd: [
    '작업과 관련된 문제점, 개선사항 등을 정확하게 분석하여 보고한다',
    '작업과 관련된 정보를 분류하고 분석하는 능력이 있다',
    '중요한 사항들을 잘 기억하고 관리할 줄 아는 능력이 있다',
  ],
  attitude: [
    '보고 없이 또는 불분명한 사유로 지각, 조퇴, 외출, 결근 등을 하지 않는다',
    '보고없이 근무지를 무단이탈하여 업무에 지장을 주지 않는다',
    '업무 시간에 개인적인 대화, 메신저, 게임, 동영상 시청 등을 하지 않으며 업무 집중도가 높다',
  ],
  complianceOffice: ['대외비 자료가 유출되지 않도록 주의를 기울인다', '회사와 부서의 규정, 규칙을 준수한다'],
  complianceProd: [
    '대외비 자료가 유출되지 않도록 주의를 기울인다',
    '회사와 부서의 규정, 규칙을 준수한다',
    '안전사고 방지 및 안전규정을 철저히 준수하고 개선해나간다',
  ],
  cultureOffice: [
    '업무 수행에 있어 상사와 동료에게 적극적으로 협조한다',
    '개인과 부서의 이익만 추구하지 않고 회사 전체의 이익을 위하여 매사에 적극적으로 행동한다',
  ],
  cultureProd: [
    '작업 수행에 있어 상사와 동료에게 적극적으로 협조한다',
    '개인과 부서의 이익만 추구하지 않고 회사 전체의 이익을 위하여 매사에 적극적으로 행동한다',
  ],
  leadDev: [
    '팀원들에 대한 리더십이 뛰어나고, 신뢰와 존경을 받는다',
    '팀원 각각의 능력을 발휘할 수 있도록 지도한다',
    '팀원과의 소통이 잘 이루어지며 즐겁게 일할 수 있는 분위기를 조성할 수 있다',
    '관리자로서 필요한 직무 능력을 갖추고 있다',
    '팀원들을 차별하지 않으며 공정하게 대우한다',
    '팀원의 장단점과 능력을 정확하게 파악하고 적절하게 업무를 부여한다',
    '팀원의 업무에 대한 피드백이 적절히 이루어지고 있다',
    '팀원의 업무 능력이 향상될 수 있도록 직무교육 또는 외부교육을 제공한다',
  ],
  leadCulture: [
    '팀원간의 갈등해결을 위한 대안을 제시하며 해결할 수 있다',
    '팀원간의 협조를 포함하여 부서간의 협조가 적절하게 이루어질 수 있도록 업무 관계를 유지한다',
    '회사 전체의 이익을 위하여 협업하는 분위기를 조성한다',
  ],
  leadInnov: [
    '부서의 발전을 위해서 문제점을 개선하고 새로운 아이디어를 개발한다',
    '조직의 변화에 효과적으로 대응하며 조직의 목표를 수립하고 수행할 수 있다',
    '부서와 회사의 이익을 위하여 중장기적인 목표를 계획하고 이를 위한 방법을 연구한다',
    '회사의 방침과 목표를 정확하게 파악하고 부하직원을 지도한다',
  ],
}

const leadership = (p: string, a: number, b: number, c: number, dirs: Direction[] = EVAL_DIRS) =>
  sec(`${p}-lead`, '팀장/임원 리더십', 'leadership', [
    factor(`${p}-l1`, '팀원 관리 및 육성', a, L.leadDev, dirs),
    factor(`${p}-l2`, '조직문화', b, L.leadCulture, dirs),
    factor(`${p}-l3`, '혁신', c, L.leadInnov, dirs),
  ])

function t2022(
  id: string,
  name: string,
  jobType: Template['jobType'],
  targetRole: Template['targetRole'],
  sourceNote: string,
  sections: Section[],
): Template {
  return { id, name, origin: '2022', jobType, targetRole, locked: true, version: 1, sourceNote, sections }
}

const T22_OM = t2022('t22-om', '2022 인사평가표 [관리직-팀원]', 'office', 'member',
  '원본: 2022/1. 인사고과표_관리직팀원.pdf · A~E=5~1점 · 1차 20% / 2차 40% / 3차 40% (원본 표시, 현재 정책 아님)', [
    selfObservation('t22-om'),
    sec('t22-om-perf', '업무성과 (35)', 'performance', [
      ...selfNarrative('t22-om'),
      factor('t22-om-p2', '고객(직원) 만족', 7, L.customer),
      factor('t22-om-p3', '업무의 양과 질', 8, L.qtyOffice),
      factor('t22-om-p4', '업무의 난이도', 5, L.diffOffice),
      factor('t22-om-p5', '업무관리', 7, L.mgmtOffice),
    ]),
    sec('t22-om-abil', '능력 (20)', 'ability', [
      factor('t22-om-a1', '직무능력', 5, L.jobOffice),
      factor('t22-om-a2', '소통능력', 5, L.commOffice),
      factor('t22-om-a3', '판단능력', 5, L.judge),
      factor('t22-om-a4', '기타', 5, L.etcOffice),
    ]),
    sec('t22-om-att', '근무태도 (20)', 'attitude', [factor('t22-om-t1', '근무태도', 20, L.attitude)]),
    sec('t22-om-comp', '보안, 규정준수 (10)', 'compliance', [factor('t22-om-c1', '보안, 규정준수', 10, L.complianceOffice)]),
    sec('t22-om-cult', '조직문화 (15)', 'culture', [factor('t22-om-u1', '조직문화', 15, L.cultureOffice)]),
  ])

const T22_OL = t2022('t22-ol', '2022 인사평가표 [관리직-팀장&임원]', 'office', 'lead',
  "원본: 2022/2. 인사고과표_관리직팀장&임원.pdf · 1차 20% / 2차 80% / 3차 0%(음영) · '총괄본부장' 제출, 절대 보안 · 2차 의견란만 있음", [
    selfObservation('t22-ol'),
    sec('t22-ol-perf', '업무성과 (35)', 'performance', [
      ...selfNarrative('t22-ol'),
      factor('t22-ol-p2', '고객(직원) 만족', 7, L.customer),
      factor('t22-ol-p3', '업무의 양과 질', 8, L.qtyOffice),
      factor('t22-ol-p4', '업무의 난이도', 5, L.diffOffice),
      factor('t22-ol-p5', '업무관리', 7, L.mgmtOffice),
    ]),
    sec('t22-ol-abil', '능력 (20)', 'ability', [
      factor('t22-ol-a1', '직무능력', 5, L.jobOffice),
      factor('t22-ol-a2', '소통능력', 5, L.commOffice),
      factor('t22-ol-a3', '판단능력', 5, [...L.judge, L.judgeLeadExtra]),
      factor('t22-ol-a4', '기타', 5, L.etcOffice),
    ]),
    leadership('t22-ol', 20, 10, 15),
  ])

const T22_LE = t2022('t22-le', '2022 팀장평가표 [공통]', 'common', 'lead',
  "원본: 2022/3. 팀장평가표_공통.pdf · 1차 40% / 2·3차 0%(음영) · '본인 평가점수와 무관' · '총괄본부장' 제출", [
    sec('t22-le-op', '평가의견', null, [
      q('t22-le-o1', 'long', '평가의견', { directions: ['up'] }),
      q('t22-le-o2', 'long', '건의사항', { directions: ['up'], required: false, help: '예) 부패, 횡령 등 고발 / 비윤리적 이슈 제보 / 이해관계 상충, 고충 등' }),
    ]),
    leadership('t22-le', 40, 30, 30, ['up']),
  ])

const T22_PM = t2022('t22-pm', '2022 인사평가표 [생산직-팀원]', 'production', 'member',
  '원본: 2022/4. 인사고과표_생산직팀원.pdf · 1차 20% / 2차 40% / 3차 40% · 고객만족 항목 없음', [
    selfObservation('t22-pm'),
    sec('t22-pm-perf', '업무성과 (35)', 'performance', [
      ...selfNarrative('t22-pm'),
      factor('t22-pm-p2', '업무의 양과 질', 10, L.qtyProd),
      factor('t22-pm-p3', '업무의 난이도', 8, L.diffProd),
      factor('t22-pm-p4', '업무관리', 9, L.mgmtProd),
    ]),
    sec('t22-pm-abil', '능력 (20)', 'ability', [
      factor('t22-pm-a1', '직무능력', 5, L.jobProd),
      factor('t22-pm-a2', '소통능력', 5, L.commProd),
      factor('t22-pm-a3', '판단능력', 5, L.judge),
      factor('t22-pm-a4', '기타', 5, L.etcProd),
    ]),
    sec('t22-pm-att', '근무태도 (20)', 'attitude', [factor('t22-pm-t1', '근무태도', 20, L.attitude)]),
    sec('t22-pm-comp', '보안, 규정준수 (10)', 'compliance', [factor('t22-pm-c1', '보안, 규정준수', 10, L.complianceProd)]),
    sec('t22-pm-cult', '조직문화 (15)', 'culture', [factor('t22-pm-u1', '조직문화', 15, L.cultureProd)]),
  ])

const T22_PL = t2022('t22-pl', '2022 인사평가표 [생산직-팀장]', 'production', 'lead',
  "원본: 2022/5. 인사고과표_생산직팀장.pdf · 1차 20% / 2차 80% / 3차 0%(음영)이지만 3차 의견란 존재 · '총괄본부장' 제출", [
    selfObservation('t22-pl'),
    sec('t22-pl-perf', '업무성과 (35)', 'performance', [
      ...selfNarrative('t22-pl'),
      factor('t22-pl-p2', '고객(직원) 만족', 7, L.customer),
      factor('t22-pl-p3', '업무의 양과 질', 8, L.qtyProd),
      factor('t22-pl-p4', '업무의 난이도', 5, L.diffProd),
      factor('t22-pl-p5', '업무관리', 7, L.mgmtProd),
    ]),
    sec('t22-pl-abil', '능력 (20)', 'ability', [
      factor('t22-pl-a1', '직무능력', 5, L.jobProd),
      factor('t22-pl-a2', '소통능력', 5, L.commProd),
      factor('t22-pl-a3', '판단능력', 5, [...L.judge, L.judgeLeadExtra]),
      factor('t22-pl-a4', '기타', 5, L.etcProd),
    ]),
    leadership('t22-pl', 20, 10, 15),
  ])

// ── 2025 간소형 ─────────────────────────────────────
const AD: [string, number | null][] = [['A 탁월', null], ['B 우수', null], ['C 보통', null], ['D 미흡', null]] // 점수 환산 미정 → 값 없음

function t2025(id: string, name: string, jobType: 'office' | 'production', note: string): Template {
  return {
    id, name, origin: '2025', jobType, targetRole: 'any', locked: true, version: 1, sourceNote: note,
    sections: [
      sec(`${id}-self`, '본인 작성', null, [
        q(`${id}-s1`, 'long', '본인의 성과 기재', { help: '자세히 서술, 작성 어려울 시 임원면담 후 작성' }),
        q(`${id}-s2`, 'long', '다음년도 목표', { help: '개인 성장목표, 역량 강화계획 등' }),
        q(`${id}-s3`, 'long', '건의사항', { required: false }),
      ]),
      sec(`${id}-ev`, '평가자 작성', null, [
        q(`${id}-e1`, 'grade', '평가점수 [등급(A~D)]', { directions: ['down'], purpose: 'score', optionItems: AD }),
        q(`${id}-e2`, 'long', '평가자 의견', { directions: ['down'], required: false }),
      ]),
    ],
  }
}

const T25_O = t2025('t25-o', '2025 인사평가표 [관리직]', 'office',
  '원본: 2025/인사평가 양식_R5_관리직.pdf · 평가자 칸: 임원평가·대표자평가·최종점수 (팀장평가 칸 없음) · 등급 A~D')
const T25_P = t2025('t25-p', '2025 인사평가표 [생산직]', 'production',
  '원본: 2025/인사평가 양식_R5_생산직.pdf · 평가자 칸: 팀장평가·임원평가·대표자평가·최종점수 · 등급 A~D')

// ── 검토용 작업본 (2025 간소형 + 5개 평가영역) ───────────
const S15: [string, number | null][] = [
  ['5 매우 우수', 5], ['4 우수', 4], ['3 보통', 3], ['2 미흡', 2], ['1 매우 미흡', 1],
]
const AREA_GUIDE: Record<string, string> = {
  performance: '목표 달성도, KPI달성률, 성과의 질·양',
  ability: '전문지식, 문제해결능력 등',
  attitude: '성실성, 책임감, 협업태도, 시간관리',
  compliance: '회사규정·지침 준수, 보안·윤리 의식',
  culture: '소통 및 팀워크',
}

/** 이전 기본 문항에 들어 있던 개발용 도움말 (응답 화면에 노출되면 안 됨). 정확히 같은 문구만 변환 시 비운다 */
export const LEGACY_DEV_HELP = [
  '평가영역 문구는 2025 가이드라인 기준. 1~5점 환산은 개발용 가정.',
  '등급↔점수 환산 미정. 등급별 인원 비율은 참고 표시·경고만.',
  '평가 마지막 문항. 별도 게시판은 두지 않습니다.',
]

export const DRAFT_ID = 'tpl-draft'
export function makeDraftTemplate(): Template {
  const areaSec = (key: keyof typeof AREA_GUIDE, title: string) =>
    sec(`d-${key}`, title, key as AreaKey, [
      q(`d-${key}-q`, 'scale5', `${title}: ${AREA_GUIDE[key]}`, {
        purpose: 'score',
        directions: ['self', 'down'],
        optionItems: S15,
      }),
    ])
  return {
    id: DRAFT_ID,
    name: '2026 검토용 작업본 (2025 간소형 + 5개 평가영역)',
    origin: 'draft', jobType: 'common', targetRole: 'any', locked: false, version: 1,
    sourceNote: '2025 간소형을 시작점으로 만든 편집 가능한 작업본. 문항·점수 방식은 검토용이며 회사 확정 아님.',
    sections: [
      sec('d-self', '본인 작성', null, [
        q('d-s1', 'long', '올해 본인의 주요 성과를 적어주세요', { help: '자세히 서술, 작성 어려울 시 임원면담 후 작성' }),
        q('d-s2', 'long', '내년 목표를 적어주세요', { help: '개인 성장목표, 역량 강화계획 등' }),
      ]),
      areaSec('performance', '업무성과'),
      areaSec('ability', '업무능력'),
      areaSec('attitude', '근무태도'),
      areaSec('compliance', '규정준수'),
      areaSec('culture', '조직문화 기여도'),
      sec('d-ev', '평가자 종합', null, [
        q('d-e1', 'grade', '종합 등급', { directions: ['down'], purpose: 'score', optionItems: AD }),
        q('d-e2', 'long', '평가 의견 (잘한 점·개선 방향)', { directions: ['down'], required: false }),
      ]),
      sec('d-last', '건의사항', null, [
        q('d-s3', 'long', '회사에 건의하고 싶은 내용이 있으면 자유롭게 적어주세요', { required: false }),
      ]),
    ],
  }
}

/** 이전 목업(v1)의 상향평가 템플릿 id. 후속 확인으로 상향평가를 제외해 마이그레이션에서만 사용 */
export const LEGACY_UPWARD_ID = 'tpl-upward'

export const ORIGINAL_TEMPLATES: Template[] = [T22_OM, T22_OL, T22_LE, T22_PM, T22_PL, T25_O, T25_P]

// ── D-103 배점 초기값(자문 기준, 모두 수정 가능) ─────────────
/** 사원 평가표(공통 평가표의 5개 영역): 영역 → [이름, 배점, 설명] */
export const MEMBER_POINTS: Record<string, [string, number, string]> = {
  performance: ['업무성과', 35, '본인 서술형'],
  ability: ['능력', 20, '직무·소통·판단능력 등'],
  attitude: ['근무태도', 20, '근태·업무집중도 등'],
  compliance: ['규정준수', 10, '회사규정·대외비·규칙 준수 등'],
  culture: ['조직문화', 15, '협조·회사 방향성과의 적합도'],
}
/** 팀장 자기평가표 영역: [ID 꼬리, 이름, 배점, 설명] */
export const LEAD_SELF_AREAS: [string, string, number, string][] = [
  ['perf', '업무성과', 30, '부서 목표 달성도, 업무 추진실적, 성과 창출 및 개선실적'],
  ['lead', '리더십 및 조직관리', 25, '업무분장, 구성원 지도·육성, 갈등 조정, 조직 운영능력'],
  ['judge', '직무역량 및 의사결정', 20, '직무 전문성, 문제해결 능력, 상황 판단 및 의사결정의 적절성'],
  ['resp', '책임감 및 규정준수', 15, '관리자로서의 책임 이행, 회사규정 준수, 리스크 예방 및 대응'],
  ['collab', '협업 및 조직기여', 10, '타 부서 협력, 경영방침 이행, 조직 전체 목표 달성 기여'],
]
export const LEAD_SELF_NAME = '팀장 자기평가표'
/** 공통 평가표의 5개 영역에 배점·설명·이름(사원 평가표 초기값). 이미 배점이 있는 평가표는 손대지 않음 */
export function applyMemberPoints(t: Template): boolean {
  if (t.sections.some((s) => typeof s.points === 'number')) return false
  const areas = t.sections.filter((s) => s.area && MEMBER_POINTS[s.area])
  if (areas.length !== 5) return false
  for (const s of areas) { const [name, pts, desc] = MEMBER_POINTS[s.area!]; s.title = name; s.points = pts; s.desc = desc }
  t.gradeScale = t.gradeScale ?? { A: 5, B: 4, C: 3, D: 2, E: 1 }
  return true
}
/** 팀장 자기평가표(새 평가표): 본인 작성 서술 + 5개 영역(5점 척도, 자기평가) + 건의사항 */
export function makeLeadSelfTemplate(id: string): Template {
  const self = { directions: ['self'] as Direction[], rules: ['self' as const] }
  return {
    id, name: LEAD_SELF_NAME, origin: 'draft', jobType: 'common', targetRole: 'lead', locked: false, version: 1,
    sourceNote: '자문 기준 팀장 자기평가표 초기값(D-103). 영역·내용·배점은 수정 가능',
    gradeScale: { A: 5, B: 4, C: 3, D: 2, E: 1 },
    sections: [
      sec(`${id}-self`, '본인 작성', null, [
        q(`${id}-s1`, 'long', '올해 부서와 본인의 주요 성과를 적어주세요', { ...self, help: '자세히 서술, 작성 어려울 시 임원면담 후 작성' }),
        q(`${id}-s2`, 'long', '내년 목표를 적어주세요', { ...self, help: '부서 목표, 리더십 강화 계획 등' }),
      ]),
      ...LEAD_SELF_AREAS.map(([k, name, pts, desc]) => ({
        ...sec(`${id}-${k}`, name, null, [q(`${id}-${k}-q`, 'scale5', `${name}: ${desc}`, { ...self, purpose: 'score', optionItems: S15 })]),
        points: pts, desc,
      })),
      sec(`${id}-last`, '건의사항', null, [q(`${id}-s3`, 'long', '회사에 건의하고 싶은 내용이 있으면 자유롭게 적어주세요', { ...self, required: false })]),
    ],
  }
}

// ── 팀원 → 팀장평가 (D-114) ─────────────────────────
export const UPWARD_NAME = '팀원→팀장 평가표'
/** 상향평가 예시(회사 자료 '임원 및 팀장 상향평가 예시', D-124): 구분·배점·평가내용 — 영역 배점 합 100, 영역마다 5점 척도 문항 하나 */
export const UPWARD_AREAS: [key: string, area: string, pts: number, desc: string, areaRu: string, descRu: string][] = [
  ['order', '업무지시 및 관리능력', 25, '업무지시의 명확성, 업무분장의 적정성, 업무 진행상황 관리', 'Постановка задач и управление', 'Чёткость поручений, разумное распределение задач, контроль хода работы'],
  ['decide', '리더십 및 의사결정', 25, '문제해결 능력, 합리적인 의사결정, 책임 있는 업무처리', 'Лидерство и принятие решений', 'Умение решать проблемы, обоснованные решения, ответственное выполнение работы'],
  ['comm', '소통 및 피드백', 20, '구성원 의견 경청, 원활한 의사소통, 적절한 업무지도 및 피드백', 'Коммуникация и обратная связь', 'Выслушивает сотрудников, открытое общение, своевременные указания и обратная связь'],
  ['trust', '공정성 및 신뢰성', 20, '구성원에 대한 공정한 대우, 객관적인 업무평가, 일관된 원칙 적용', 'Справедливость и надёжность', 'Справедливое отношение к сотрудникам, объективная оценка работы, единые принципы'],
  ['culture', '조직문화 및 협업', 10, '상호존중, 갈등관리, 협력적인 근무환경 조성', 'Корпоративная культура и сотрудничество', 'Взаимное уважение, управление конфликтами, атмосфера сотрудничества'],
]
const S15_RU = ['5 Отлично', '4 Хорошо', '3 Удовлетворительно', '2 Ниже ожиданий', '1 Неудовлетворительно']
/** D-114 첫 초기값의 영역 ID(D-124 변환에서 '손대지 않은 첫 초기값'인지 확인용) */
export const UPWARD_V1_KEYS = ['lead', 'talk', 'help', 'fair', 'free']
/** 팀원이 소속 팀 팀장을 평가하는 평가표 초기값(목업 — 회사 상향평가 예시의 영역·배점, D-124). 문항·영역은 문항 관리에서 수정. 러시아어 번역 초안 포함 */
export function makeUpwardTemplate(id: string): Template {
  const up = { directions: ['up'] as Direction[], rules: ['upward' as const] }
  const ru = (x: Question, title: string, opts?: string[]): Question => ({
    ...x,
    i18n: { ru: { title, options: Object.fromEntries((opts ?? []).map((o, i) => [x.options[i].id, o])), basis: { title: x.title, help: x.help, options: Object.fromEntries((opts ?? []).map((_, i) => [x.options[i].id, x.options[i].label])) } } },
  })
  const secRu = (x: Section, title: string): Section => ({ ...x, i18n: { ru: { title, basis: x.title } } })
  return {
    id, name: UPWARD_NAME, origin: 'draft', jobType: 'common', targetRole: 'lead', locked: false, version: 1,
    sourceNote: '상향평가 예시(회사 자료) 기준 초기값(D-124, 목업). 영역·배점·문항은 수정 가능',
    gradeScale: { A: 5, B: 4, C: 3, D: 2, E: 1 },
    sections: [
      ...UPWARD_AREAS.map(([k, area, pts, desc, areaRu, descRu]) => ({
        ...secRu(sec(`${id}-${k}`, area, null, [ru(q(`${id}-${k}-q`, 'scale5', `${area}: ${desc}`, { ...up, purpose: 'score', optionItems: S15 }), `${areaRu}: ${descRu}`, S15_RU)]), areaRu),
        points: pts, desc,
      })),
      secRu(sec(`${id}-free`, '의견', null, [ru(q(`${id}-free-q`, 'long', '팀장에게 바라는 점이나 하고 싶은 말을 자유롭게 적어주세요', { ...up, required: false }), 'Свободно напишите, чего вы ждёте от руководителя или что хотели бы ему сказать')]), 'Комментарий'),
    ],
  }
}

// ── 임원 상향평가 (D-189) ─────────────────────────
export const EXEC_UPWARD_NAME = '임원 상향평가표'
/** 사원·팀장이 소속 팀 임원을 평가하는 평가표 초기값(목업 — 회사 '임원 및 팀장 상향평가 예시'의 영역·배점, 팀원→팀장 평가표와 같은 구성). 러시아어 번역 초안 포함 */
export function makeExecUpwardTemplate(id: string): Template {
  const base = makeUpwardTemplate(id)
  const free = base.sections[base.sections.length - 1]
  const fq = free.questions[0]
  return {
    ...base, name: EXEC_UPWARD_NAME, targetRole: 'any',
    sourceNote: '임원 및 팀장 상향평가 예시(회사 자료) 기준 임원 상향평가 초기값(D-189, 목업). 영역·배점·문항은 수정 가능',
    sections: [
      ...base.sections.slice(0, -1),
      { ...free, questions: [{ ...fq, title: '임원에게 바라는 점이나 하고 싶은 말을 자유롭게 적어주세요', i18n: { ru: { ...fq.i18n!.ru!, title: 'Свободно напишите, чего вы ждёте от руководителя-директора или что хотели бы ему сказать', basis: { ...fq.i18n!.ru!.basis!, title: '임원에게 바라는 점이나 하고 싶은 말을 자유롭게 적어주세요' } } } }] },
    ],
  }
}
