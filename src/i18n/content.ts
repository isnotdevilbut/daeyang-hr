// 기본 목업 문항(2026 작업본, tpl-draft)의 러시아어 번역 초안 (D-075).
// 개발 단계에서 직접 작성한 초안이며 회사 검수 전이다(docs/i18n.md). 외부 번역 서비스로 만들지 않았다.
// 연결 규칙: 문항·선택지·평가영역 ID가 같고 한국어 원문이 기본값과 "글자 그대로" 같을 때만 붙인다.
// 사용자가 한국어를 고친 항목, 이미 번역이 있는 항목(사용자 작성 번역 포함)은 건드리지 않는다. 다시 실행해도 같은 결과.
import type { AppState, Question, Section, Template } from '../domain/types'

type QDefault = { ko: string; ru: string; helpKo?: string; helpRu?: string; options?: Record<string, [string, string]> }

const S15 = (qid: string): Record<string, [string, string]> => ({
  [`${qid}-o1`]: ['5 매우 우수', '5 — отлично'],
  [`${qid}-o2`]: ['4 우수', '4 — хорошо'],
  [`${qid}-o3`]: ['3 보통', '3 — удовлетворительно'],
  [`${qid}-o4`]: ['2 미흡', '2 — недостаточно'],
  [`${qid}-o5`]: ['1 매우 미흡', '1 — крайне недостаточно'],
})

export const DEFAULT_SECTION_RU: Record<string, [string, string]> = {
  'd-self': ['본인 작성', 'Заполняет сотрудник'],
  'd-performance': ['업무성과', 'Результаты работы'],
  'd-ability': ['업무능력', 'Профессиональные навыки'],
  'd-attitude': ['근무태도', 'Отношение к работе'],
  'd-compliance': ['규정준수', 'Соблюдение правил'],
  'd-culture': ['조직문화 기여도', 'Вклад в корпоративную культуру'],
  'd-ev': ['평가자 종합', 'Итоговое заключение оценщика'],
  'd-last': ['건의사항', 'Предложения'],
}

export const DEFAULT_QUESTION_RU: Record<string, QDefault> = {
  'd-s1': {
    ko: '올해 본인의 주요 성과를 적어주세요', ru: 'Опишите ваши основные достижения за этот год',
    helpKo: '자세히 서술, 작성 어려울 시 임원면담 후 작성', helpRu: 'Опишите подробно. Если заполнить затруднительно, сделайте это после беседы с руководством.',
  },
  'd-s2': {
    ko: '내년 목표를 적어주세요', ru: 'Укажите ваши цели на следующий год',
    helpKo: '개인 성장목표, 역량 강화계획 등', helpRu: 'Цели личного развития, план повышения квалификации и т. п.',
  },
  'd-performance-q': { ko: '업무성과: 목표 달성도, KPI달성률, 성과의 질·양', ru: 'Результаты работы: степень достижения целей, выполнение KPI, качество и объём результатов', options: S15('d-performance-q') },
  'd-ability-q': { ko: '업무능력: 전문지식, 문제해결능력 등', ru: 'Профессиональные навыки: специальные знания, умение решать проблемы и т. п.', options: S15('d-ability-q') },
  'd-attitude-q': { ko: '근무태도: 성실성, 책임감, 협업태도, 시간관리', ru: 'Отношение к работе: добросовестность, ответственность, готовность к сотрудничеству, управление временем', options: S15('d-attitude-q') },
  'd-compliance-q': { ko: '규정준수: 회사규정·지침 준수, 보안·윤리 의식', ru: 'Соблюдение правил: следование правилам и инструкциям компании, информационная безопасность и этика', options: S15('d-compliance-q') },
  'd-culture-q': { ko: '조직문화 기여도: 소통 및 팀워크', ru: 'Вклад в корпоративную культуру: коммуникация и командная работа', options: S15('d-culture-q') },
  'd-e1': {
    ko: '종합 등급', ru: 'Итоговый уровень',
    options: { 'd-e1-o1': ['A 탁월', 'A — выдающийся'], 'd-e1-o2': ['B 우수', 'B — высокий'], 'd-e1-o3': ['C 보통', 'C — средний'], 'd-e1-o4': ['D 미흡', 'D — ниже ожидаемого'] },
  },
  'd-e2': { ko: '평가 의견 (잘한 점·개선 방향)', ru: 'Комментарий оценщика (сильные стороны и направления для улучшения)' },
  'd-s3': { ko: '회사에 건의하고 싶은 내용이 있으면 자유롭게 적어주세요', ru: 'Если у вас есть предложения для компании, напишите их в свободной форме' },
}

/** 문항 하나에 기본 번역을 붙인다(조건이 맞을 때만). 붙였으면 true */
function attachQuestion(q: Question): boolean {
  const d = DEFAULT_QUESTION_RU[q.id]
  if (!d || q.i18n?.ru) return false // 기본 문항이 아니거나 이미 번역(사용자 작성 포함)이 있음
  if (q.title !== d.ko) return false // 한국어를 고친 문항에는 맞지 않는 번역을 붙이지 않음
  const help = (d.helpKo !== undefined && q.help === d.helpKo) ? d.helpRu : undefined
  const options: Record<string, string> = {}
  const basisOpt: Record<string, string> = {}
  for (const o of q.options) {
    const od = d.options?.[o.id]
    if (od && od[0] === o.label) { options[o.id] = od[1]; basisOpt[o.id] = o.label }
  }
  q.i18n = { ...(q.i18n ?? {}), ru: { title: d.ru, ...(help ? { help } : {}), options, basis: { title: q.title, help: q.help, options: basisOpt } } }
  return true
}

function attachSection(sec: Section): boolean {
  const d = DEFAULT_SECTION_RU[sec.id]
  if (!d || sec.i18n?.ru || sec.title !== d[0]) return false
  sec.i18n = { ...(sec.i18n ?? {}), ru: { title: d[1], basis: sec.title } }
  return true
}

function attachTemplate(t: Template): number {
  let n = 0
  for (const sec of t.sections ?? []) {
    if (attachSection(sec)) n++
    for (const q of sec.questions ?? []) if (attachQuestion(q)) n++
  }
  return n
}

/** 문항 라이브러리와 모든 회차의 문항 복사본에 기본 번역 연결 (새 데이터·이전 저장 데이터 공통) */
export function attachDefaultTranslations(s: Pick<AppState, 'templates' | 'cycles'>): number {
  let n = 0
  for (const t of s.templates ?? []) n += attachTemplate(t)
  for (const c of s.cycles ?? []) for (const t of Object.values(c.templates ?? {})) n += attachTemplate(t)
  return n
}
