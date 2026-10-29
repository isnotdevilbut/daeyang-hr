import { useState } from 'react'
import { useAppState } from './store'
import type { Cycle } from '../domain/types'

const KEY = 'daeyang-hr-selected-cycle'

/** 화면에서 보고 있는 회차 (이 브라우저 탭 편의용 기억) */
export function useSelectedCycle(): [Cycle | null, (id: string) => void, Cycle[]] {
  const s = useAppState()
  const [id, setId] = useState<string | null>(() => {
    try { return sessionStorage.getItem(KEY) } catch { return null }
  })
  const cycle = s.cycles.find((c) => c.id === id) ?? s.cycles.find((c) => c.status === '진행') ?? s.cycles[0] ?? null
  const select = (v: string) => {
    setId(v)
    try { sessionStorage.setItem(KEY, v) } catch { /* 무시 */ }
  }
  return [cycle, select, s.cycles]
}

export function useEmployeeName() {
  const s = useAppState()
  return (id: string | null | undefined) => s.employees.find((e) => e.id === id)?.name ?? '(미지정)'
}
