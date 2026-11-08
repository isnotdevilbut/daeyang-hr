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
