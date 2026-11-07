import { describe, expect, it } from 'vitest'
import { cycleText } from './index'

describe('D-245 회차 이름 러시아어', () => {
  it('자주 쓰는 형식은 러시아어 문장으로', () => {
    expect(cycleText('2026 하반기 인사평가', 'ru')).toBe('Оценка персонала за 2-е полугодие 2026 г.')
    expect(cycleText('2027 상반기 인사평가 (복제)', 'ru')).toBe('Оценка персонала за 1-е полугодие 2027 г. (копия)')
    expect(cycleText('2026년 연간 인사평가', 'ru')).toBe('Годовая оценка персонала за 2026 г.')
  })
  it('한국어는 그대로, 모르는 형식은 아는 낱말만', () => {
    expect(cycleText('2026 하반기 인사평가', 'ko')).toBe('2026 하반기 인사평가')
    expect(cycleText('특별 평가', 'ru')).toBe('특별 평가')
  })
})
