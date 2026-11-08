import { describe, expect, it } from 'vitest'
import { appendImported, applyTranslations, newSection, parseQuestionTable, parseTranslationTable } from './questions'
import type { Template } from './types'

const tpl = (): Template => {
  const t = { id: 't', name: 't', origin: 'draft', jobType: 'common', sections: [] } as unknown as Template
  const r = parseQuestionTable([['영역', '질문', '유형', '선택지'], ['업무성과', '본인의 주요 성과를 적어주세요', '주관식', ''], ['태도', '협업은 어떠했나요?', '단일선택', '좋음|보통|나쁨']])
  appendImported(t, r.rows)
  return t
}

describe('D-250 번역 열', () => {
  it('문항 가져오기: 러시아어 열이 있으면 번역도 함께', () => {
    const r = parseQuestionTable([['영역', '질문', '유형', '선택지', '러시아어 번역', '선택지 RU', '영역(러시아어)'], ['태도', '협업은 어떠했나요?', '단일선택', '좋음|보통|나쁨', 'Как сотрудничество?', 'Хорошо|Средне|Плохо', 'Отношение']])
    expect(r.headerError).toBeNull()
    const q = r.rows[0].question!
    expect(q.i18n?.ru?.title).toBe('Как сотрудничество?')
    expect(Object.values(q.i18n?.ru?.options ?? {})).toEqual(['Хорошо', 'Средне', 'Плохо'])
    expect(q.i18n?.ru?.basis?.title).toBe('협업은 어떠했나요?')
    const t = { sections: [] } as unknown as Template
    appendImported(t, r.rows)
    expect(t.sections[0].i18n?.ru?.title).toBe('Отношение')
  })
  it('번역만 올리기: 같은 질문을 찾아 러시아어만 저장, 없는 질문은 건너뜀', () => {
    const t = tpl()
    const before = JSON.stringify(t.sections.map((s) => s.questions.map((q) => [q.id, q.title, q.type])))
    const tr = parseTranslationTable([['질문', 'RU'], ['본인의  주요 성과를 적어주세요', 'Опишите свои основные достижения'], ['없는 질문', 'X']], t)
    expect(tr.headerError).toBeNull()
    expect(tr.rows.map((r) => r.found)).toEqual([true, false])
    expect(applyTranslations(t, tr.rows)).toBe(1)
    expect(t.sections[0].questions[0].i18n?.ru?.title).toBe('Опишите свои основные достижения')
    expect(JSON.stringify(t.sections.map((s) => s.questions.map((q) => [q.id, q.title, q.type])))).toBe(before)
  })
  it('번역 열이 없으면 안내', () => {
    expect(parseTranslationTable([['질문', '유형'], ['a', '주관식']], tpl()).headerError).toMatch(/번역 열/)
  })
  it('기존 머리글(영역·선택지점수 등)은 번역 열로 오인하지 않음', () => {
    const r = parseQuestionTable([['구분', '평가내용', '배점'], ['업무', '성과', '10']])
    expect(r.ignored).toEqual([])
    expect(newSection('x').title).toBe('x')
  })
})

describe('D-251 질문·선택지만으로 문항 만들기', () => {
  it('질문만 → 주관식, 선택지(쉼표·| ·줄바꿈) → 객관식, 영역 없으면 미분류', () => {
    const r = parseQuestionTable([['질문', '선택지'], ['성과는?', ''], ['협업은?', '매우 우수, 우수, 보통'], ['만족도', '만족|보통'], ['태도', '좋음\n나쁨']])
    expect(r.headerError).toBeNull()
    expect(r.rows.every((x) => x.errors.length === 0)).toBe(true)
    expect(r.rows.map((x) => x.question!.type)).toEqual(['long', 'single', 'single', 'single'])
    expect(r.rows[1].question!.options.map((o) => o.label)).toEqual(['매우 우수', '우수', '보통'])
    expect(r.rows[3].question!.options.map((o) => o.label)).toEqual(['좋음', '나쁨'])
    expect(r.rows[0].section).toBe('미분류')
  })
})
