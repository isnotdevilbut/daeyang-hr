// 평가 참여자(직원·팀장·임원) 화면의 한국어·러시아어 (D-075). 관리자 화면은 한국어.
// "번역문 미리 저장" 방식: 고정 문구는 이 사전에, 문항·선택지·평가영역 번역은 문항 데이터(i18n.ru)에 저장해 두고
// 선택한 언어에 맞춰 보여 준다. 외부 번역 API·LLM·브라우저 번역을 쓰지 않고, 사용 중 외부로 번역을 요청하지 않는다.
// 러시아어 문구는 개발 단계 초안(docs/i18n.md) — 회사 검수 전.
// 번역이 없는 항목은 한국어 원문을 그대로 보여 준다(경고 배너 없음).
import { useEffect, useState } from 'react'
import type { Lang, Option, Question, Section } from '../domain/types'

export const LANGUAGES: { code: Lang; label: string }[] = [
  { code: 'ko', label: '한국어' },
  { code: 'ru', label: 'Русский' },
]

const ko = {
  // 공통·머리글
  'nav.myEval': '내 평가',
  'nav.logout': '로그아웃',
  'lang.label': '언어 선택 / Язык',
  'tier.임원': '임원',
  'tier.팀장': '팀장',
  'tier.사원': '사원',
  'rule.self': '자기평가',
  'rule.teamLead': '팀장평가',
  'rule.executive': '임원평가',
  'rule.upward': '상향평가',
  'stage.n': '{n}단계',
  'count.items': '{n}건',
  'count.people': '{n}명',
  // 로그인
  'login.title': '대양롤랜트 인사평가 시스템',
  'login.tag': '시연용 로그인',
  'login.linkGone': '개인 링크는 더 이상 사용하지 않습니다. 이름과 사번으로 로그인하세요.',
  'login.id': '아이디',
  'login.pw': '비밀번호',
  'login.show': '보기',
  'login.hide': '숨기기',
  'login.submit': '로그인',
  'login.busy': '로그인 중…',
  'login.errEmpty': '아이디와 비밀번호를 입력하세요.',
  'login.errWrong': '아이디 또는 비밀번호가 올바르지 않습니다.',
  'login.demo': '시연 계정 보기',
  'login.demoHint': '직원: 아이디 {name} · 비밀번호 {no} / 운영담당자: 비밀번호 {pw}',
  'login.demoName': '이름',
  'login.demoNo': '사번',
  // 목록
  'home.title': '나의 평가',
  'home.due': '마감일',
  'list.mySelf': '내 자기평가',
  'list.team': '팀원 평가',
  'list.assigned': '배정된 평가',
  'list.upward': '상향평가',
  'list.none': '배정된 평가가 없습니다.',
  'list.cycle': '평가 회차',
  'list.target': '대상자',
  'list.teamCol': '팀',
  'list.tier': '직급',
  'list.eval': '평가',
  'list.status': '상태',
  'list.write': '작성',
  'list.afterPrev': '앞 단계 제출 후 작성',
  'btn.start': '작성하기',
  'btn.continue': '이어서 작성',
  'btn.viewSubmitted': '제출 내용 보기',
  'btn.evaluate': '평가하기',
  'status.notStarted': '미완료',
  'status.draft': '작성 중',
  'status.locked': '대기',
  'status.closed': '마감',
  'ev.closed': '마감된 평가입니다',
  'status.submitted': '완료',
  'status.unassigned': '평가자 미지정',
  'status.na': '해당 없음',
  'status.open': '미완료',
  // 임원 목록
  'exec.filter': '상태 필터',
  'exec.all': '전체',
  'exec.open': '미완료',
  'exec.done': '완료',
  'exec.selfNote': '이 평가에서 임원 자기평가가 켜져 있습니다',
  'exec.cardDone': '완료 {d} / {t}',
  'exec.submittedFlash': '{names} 평가를 제출했습니다.',
  'exec.allDone': '배정된 평가를 모두 완료했습니다.',
  'exec.showAll': '전체 보기',
  'exec.noneDone': '완료한 평가가 없습니다.',
  'exec.cardLabel': '{team} 평가 대상',
  // 응답 화면
  'form.selfTitle': '자기평가',
  'form.backList': '← 나의 평가 목록',
  'form.backMy': '← 내 평가',
  'form.next': '다음',
  'form.prev': '이전',
  'form.save': '임시저장',
  'form.saving': '저장 중…',
  'form.saved': '임시저장됨',
  'form.savedNote': '이 기기에 저장됩니다',
  'form.dirty': '저장되지 않은 변경이 있습니다',
  'form.saveFail': '저장하지 못했습니다. 다시 눌러 주세요.',
  'form.review': '제출 전 확인',
  'form.submit': '최종 제출',
  'form.required': '필수',
  'form.missing': '아직 답하지 않은 필수 문항',
  'form.missingCount': '{n}개',
  'form.goAnswer': '답하러 가기',
  'form.allAnswered': '필수 문항에 모두 답했습니다.',
  'form.noEdit': '제출하면 수정할 수 없습니다.',
  'form.fix': '고치기',
  'form.empty': '(비어 있음)',
  'form.screen': '화면 {i} / {n}',
  'form.reqDone': '필수 응답 {d} / {t}개 완료',
  'form.segLabel': '화면별 작성 상태',
  'form.segDone': '작성 완료',
  'form.segTodo': '작성 전',
  'form.segCurrent': '현재 화면',
  'form.confirmSubmit': '최종 제출하면 수정할 수 없습니다. 제출할까요?',
  'form.failDemo': '[시연] 다음 임시저장을 실패시키기 (네트워크 오류 화면 확인용)',
  'form.submittedSuffix': '제출 내용',
  'done.title': '제출이 완료되었습니다',
  'done.body': '참여해 주셔서 감사합니다. 제출 후 수정이 필요하면 담당자에게 문의해 주세요.',
  'done.at': '제출 시각',
  'done.view': '제출한 내용 보기',
  'done.toList': '나의 평가 목록으로',
  'done.list': '목록으로',
  // 팀장·임원 평가 작성 화면
  'ev.title': '{name} 평가',
  'ev.submittedTitle': '제출 완료된 평가입니다',
  'ev.submittedBody': '수정하려면 담당자의 재개방이 필요합니다(실서비스 단계).',
  'ev.saveVirtual': '임시저장',
  'ev.submitVirtual': '최종 제출',
  'ev.req': '필수 {d}/{t}',
  'ev.saved': '✔ 저장됨',
  'ev.saveFail': '✕ 저장 실패 — 다시 시도',
  'ev.dirty': '저장 안 된 변경',
  'ev.confirm': '제출하면 수정할 수 없습니다. 제출할까요?',
  'ev.gradeTitle': '내 등급 배정 현황',
  'ev.gradeTag': '참고 · 경고만',
  'ev.gradeNote': '담당 {n}명 기준. 비율은 2025 가이드라인 참고값이며 적용 집단은 미정입니다.',
  'ev.grade': '등급',
  'ev.given': '배정',
  'ev.ref': '참고 인원',
  'ev.many': '⚠ 많음',
  'ev.selfRef': '대상자 자기평가 (참고)',
  'ev.selfRefTag': '열람 허용 여부 확인 필요',
  'ev.notSubmitted': '미제출',
  'ev.noAnswer': '응답 없음',
  'ev.unanswered': '미응답',
  'ev.onlyMine': '본인에게 배정된 평가만 열 수 있습니다.',
  'ev.noQuestions': '표시할 문항이 없어 작성할 수 없습니다. 담당자에게 문의해 주세요.',
  'ev.locked': '앞 단계가 아직 제출되지 않았습니다.',
  'forbid.title': '이 역할로는 볼 수 없는 화면입니다',
  'forbid.body': '시연용 권한 초안 기준입니다. {reason} 실서비스에서는 서버에서도 같은 권한을 검사합니다.',
} as const

export type TKey = keyof typeof ko

/** 러시아어 초안 — 인사평가 문맥의 정중한 표현(вы-форма). 고유명사(이름·사번·팀 이름·회차 이름)는 번역하지 않는다 */
const ru: Record<TKey, string> = {
  'nav.myEval': 'Мои оценки',
  'nav.logout': 'Выйти',
  'lang.label': 'Язык / 언어 선택',
  'tier.임원': 'Топ-менеджер',
  'tier.팀장': 'Руководитель группы',
  'tier.사원': 'Сотрудник',
  'rule.self': 'Самооценка',
  'rule.teamLead': 'Оценка руководителя группы',
  'rule.executive': 'Оценка топ-менеджера',
  'rule.upward': 'Оценка снизу вверх',
  'stage.n': 'Этап {n}',
  'count.items': '{n} шт.',
  'count.people': '{n} чел.',
  'login.title': 'Система оценки персонала Daeyang Rollent',
  'login.tag': 'Демонстрационный вход',
  'login.linkGone': 'Персональные ссылки больше не используются. Войдите по имени и табельному номеру.',
  'login.id': 'Логин',
  'login.pw': 'Пароль',
  'login.show': 'Показать',
  'login.hide': 'Скрыть',
  'login.submit': 'Войти',
  'login.busy': 'Выполняется вход…',
  'login.errEmpty': 'Введите логин и пароль.',
  'login.errWrong': 'Неверный логин или пароль.',
  'login.demo': 'Демонстрационные учётные записи',
  'login.demoHint': 'Сотрудники: логин — {name}, пароль — {no} / Администратор: пароль {pw}',
  'login.demoName': 'имя',
  'login.demoNo': 'табельный номер',
  'home.title': 'Мои оценки',
  'home.due': 'Срок',
  'list.mySelf': 'Моя самооценка',
  'list.team': 'Оценка сотрудников группы',
  'list.assigned': 'Назначенные оценки',
  'list.upward': 'Оценка руководителей',
  'list.none': 'Назначенных оценок нет.',
  'list.cycle': 'Период оценки',
  'list.target': 'Сотрудник',
  'list.teamCol': 'Группа',
  'list.tier': 'Должность',
  'list.eval': 'Оценка',
  'list.status': 'Статус',
  'list.write': 'Заполнить',
  'list.afterPrev': 'Доступно после завершения предыдущего этапа',
  'btn.start': 'Заполнить',
  'btn.continue': 'Продолжить',
  'btn.viewSubmitted': 'Просмотреть ответы',
  'btn.evaluate': 'Оценить',
  'status.notStarted': 'Не завершено',
  'status.draft': 'В процессе',
  'status.locked': 'Ожидание',
  'status.closed': 'Закрыто',
  'ev.closed': 'Оценка закрыта',
  'status.submitted': 'Завершено',
  'status.unassigned': 'Оценщик не назначен',
  'status.na': 'Не применяется',
  'status.open': 'Не завершено',
  'exec.filter': 'Фильтр по статусу',
  'exec.all': 'Все',
  'exec.open': 'Не завершено',
  'exec.done': 'Завершено',
  'exec.selfNote': 'В этом периоде для топ-менеджеров включена самооценка',
  'exec.cardDone': 'Завершено {d} из {t}',
  'exec.submittedFlash': 'Оценка отправлена: {names}.',
  'exec.allDone': 'Все назначенные оценки завершены.',
  'exec.showAll': 'Показать все',
  'exec.noneDone': 'Завершённых оценок нет.',
  'exec.cardLabel': 'Сотрудники для оценки: {team}',
  'form.selfTitle': 'Самооценка',
  'form.backList': '← К списку оценок',
  'form.backMy': '← Мои оценки',
  'form.next': 'Далее',
  'form.prev': 'Назад',
  'form.save': 'Сохранить', // 하단 버튼 폭에 맞춘 짧은 표현 — 저장 후 문구는 "Черновик сохранён"
  'form.saving': 'Сохранение…',
  'form.saved': 'Черновик сохранён',
  'form.savedNote': 'Сохраняется на этом устройстве',
  'form.dirty': 'Есть несохранённые изменения',
  'form.saveFail': 'Не удалось сохранить. Нажмите ещё раз.',
  'form.review': 'Проверка перед отправкой',
  'form.submit': 'Отправить',
  'form.required': 'обязательно',
  'form.missing': 'Обязательные вопросы без ответа',
  'form.missingCount': '{n}',
  'form.goAnswer': 'Перейти к ответу',
  'form.allAnswered': 'Вы ответили на все обязательные вопросы.',
  'form.noEdit': 'После отправки изменить ответы будет нельзя.',
  'form.fix': 'Изменить',
  'form.empty': '(нет ответа)',
  'form.screen': 'Экран {i} из {n}',
  'form.reqDone': 'Обязательные ответы: {d} из {t}',
  'form.segLabel': 'Состояние заполнения по экранам',
  'form.segDone': 'заполнено',
  'form.segTodo': 'не заполнено',
  'form.segCurrent': 'текущий экран',
  'form.confirmSubmit': 'После окончательной отправки изменить ответы будет нельзя. Отправить?',
  'form.failDemo': '[Демонстрация] Сделать следующее сохранение неудачным (проверка экрана ошибки сети)',
  'form.submittedSuffix': 'отправленные ответы',
  'done.title': 'Ответы отправлены',
  'done.body': 'Спасибо за участие. Если после отправки нужно что-то исправить, обратитесь к ответственному сотруднику.',
  'done.at': 'Время отправки',
  'done.view': 'Просмотреть отправленные ответы',
  'done.toList': 'К списку моих оценок',
  'done.list': 'К списку',
  'ev.title': 'Оценка: {name}',
  'ev.submittedTitle': 'Оценка уже отправлена',
  'ev.submittedBody': 'Чтобы внести изменения, ответственный сотрудник должен заново открыть оценку (на этапе реального сервиса).',
  'ev.saveVirtual': 'Сохранить черновик',
  'ev.submitVirtual': 'Отправить',
  'ev.req': 'Обязательные: {d}/{t}',
  'ev.saved': '✔ Сохранено',
  'ev.saveFail': '✕ Ошибка сохранения — повторите попытку',
  'ev.dirty': 'Есть несохранённые изменения',
  'ev.confirm': 'После отправки изменить оценку будет нельзя. Отправить?',
  'ev.gradeTitle': 'Распределение моих оценок по уровням',
  'ev.gradeTag': 'справочно, только предупреждение',
  'ev.gradeNote': 'Из расчёта на {n} чел. Доли — справочные значения из рекомендаций 2025 года; группа применения пока не определена.',
  'ev.grade': 'Уровень',
  'ev.given': 'Выставлено',
  'ev.ref': 'Ориентир',
  'ev.many': '⚠ Много',
  'ev.selfRef': 'Самооценка сотрудника (для справки)',
  'ev.selfRefTag': 'требуется подтверждение доступа к просмотру',
  'ev.notSubmitted': 'Не отправлено',
  'ev.noAnswer': 'Ответов нет',
  'ev.unanswered': 'Нет ответа',
  'ev.onlyMine': 'Можно открыть только назначенные вам оценки.',
  'ev.noQuestions': 'Нет вопросов для заполнения. Обратитесь к ответственному сотруднику.',
  'ev.locked': 'Предыдущий этап ещё не завершён.',
  'forbid.title': 'Этот экран недоступен для вашей роли',
  'forbid.body': 'Демонстрационные права доступа. {reason} В реальном сервисе те же права проверяются на сервере.',
}

const dictionaries: Record<Lang, Record<TKey, string>> = { ko, ru }

/** 고정 문구. {이름} 자리에 vars 값을 넣는다 */
export function t(key: TKey, lang: Lang, vars?: Record<string, string | number>): string {
  let s: string = dictionaries[lang]?.[key] ?? ko[key]
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v))
  return s
}

/** 직급(임원·팀장·사원) 표시 — 그 밖의 값은 원문 그대로 */
export function tierText(v: string, lang: Lang): string {
  const k = `tier.${v}` as TKey
  return k in ko ? t(k, lang) : v
}

/** 로그인 오류 문구(인증 함수가 돌려준 한국어) → 선택 언어 */
export function loginError(msg: string, lang: Lang): string {
  if (msg === ko['login.errEmpty']) return t('login.errEmpty', lang)
  if (msg === ko['login.errWrong']) return t('login.errWrong', lang)
  return msg
}

// ── 문항·선택지·평가영역 표시 (저장된 번역 → 없으면 한국어 원문) ─────────
const filled = (v: string | undefined) => (v && v.trim() ? v : undefined)
export function qTitle(q: Question, lang: Lang): string { return (lang === 'ru' && filled(q.i18n?.ru?.title)) || q.title }
export function qHelp(q: Question, lang: Lang): string { return (lang === 'ru' && q.help && filled(q.i18n?.ru?.help)) || q.help }
export function optLabel(q: Question, o: Option, lang: Lang): string { return (lang === 'ru' && filled(q.i18n?.ru?.options?.[o.id])) || o.label }
export function secTitle(sec: Pick<Section, 'title' | 'i18n'>, lang: Lang): string { return (lang === 'ru' && filled(sec.i18n?.ru?.title)) || sec.title }

/** 번역 이후 한국어 원문이 바뀌었는가 (관리자 편집 영역에만 "번역 재확인" 표시) */
export function needsReview(q: Question): boolean {
  const tr = q.i18n?.ru
  if (!tr?.basis) return false
  if (filled(tr.title) && tr.basis.title !== q.title) return true
  if (filled(tr.help) && tr.basis.help !== q.help) return true
  return q.options.some((o) => filled(tr.options?.[o.id]) && tr.basis!.options[o.id] !== o.label)
}
export function sectionNeedsReview(sec: Section): boolean {
  const tr = sec.i18n?.ru
  return !!tr && !!filled(tr.title) && tr.basis !== undefined && tr.basis !== sec.title
}

// ── 언어 선택 기억 (같은 브라우저: 다음 접속에도 적용) ─────────────
const LANG_KEY = 'daeyang-hr-lang'
const listeners = new Set<(l: Lang) => void>()
export function getLang(): Lang {
  try {
    const v = localStorage.getItem(LANG_KEY) ?? sessionStorage.getItem(LANG_KEY) // 이전에 탭에만 저장한 값도 이어받음
    return v === 'ru' ? 'ru' : 'ko' // 지원하지 않는 값(예: 이전의 'ky')은 한국어
  } catch { return 'ko' }
}
export function setLang(l: Lang) {
  try { localStorage.setItem(LANG_KEY, l) } catch { /* 무시 */ }
  listeners.forEach((f) => f(l))
}
/** 참여자 화면 언어 (탭 간에도 같은 값) */
export function useLang(): [Lang, (l: Lang) => void] {
  const [lang, setL] = useState<Lang>(getLang)
  useEffect(() => {
    const f = (l: Lang) => setL(l)
    listeners.add(f)
    const onStorage = (e: StorageEvent) => { if (e.key === LANG_KEY) setL(getLang()) }
    window.addEventListener('storage', onStorage)
    return () => { listeners.delete(f); window.removeEventListener('storage', onStorage) }
  }, [])
  return [lang, setLang]
}

/**
 * 회차 이름(관리자가 쓴 글) → 선택 언어(D-245). 한국어는 그대로.
 * 러시아어: 자주 쓰는 낱말(연도·상반기·하반기·인사평가·연간·복제)만 바꾸고, 그 밖의 글자는 원문 그대로
 */
export function cycleText(name: string, lang: Lang): string {
  if (lang !== 'ru') return name
  const HALF: Record<string, string> = { 상반기: '1-е полугодие', 하반기: '2-е полугодие', 연간: 'год', '1분기': '1-й квартал', '2분기': '2-й квартал', '3분기': '3-й квартал', '4분기': '4-й квартал' }
  const m = name.match(/^\s*(\d{4})\s*년?\s*(상반기|하반기|연간|[1-4]분기)?\s*(인사\s*평가|평가)\s*(.*)$/)
  const tail = (x: string) => x.replace(/\(\s*복제\s*\)/g, '(копия)').replace(/복제/g, 'копия')
  if (m) {
    const [, y, h, , rest] = m
    const when = h && h !== '연간' ? `${HALF[h]} ${y} г.` : `${y} г.`
    return `${h === '연간' ? 'Годовая оценка' : 'Оценка'} персонала за ${when}${rest ? ' ' + tail(rest) : ''}`
  }
  return tail(name.replace(/상반기/g, HALF.상반기).replace(/하반기/g, HALF.하반기).replace(/인사\s*평가/g, 'оценка персонала'))
}
