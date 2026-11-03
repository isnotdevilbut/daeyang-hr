// 목록 열 정렬(팀원 피드백): 머리글을 누르면 오름차순 ↔ 내림차순. 처음에는 각 화면의 기본 순서(팀·직급·이름 등) 그대로.
// 정렬은 안정 정렬이라 같은 값끼리는 기본 순서를 유지하고, 빈 값(점수 없음·해당 없음)은 방향과 관계없이 맨 아래.
import { useState, type ReactNode } from 'react'

export type SortDir = 'asc' | 'desc'
export type Sort = { key: string; dir: SortDir } | null
export type SortVal = string | number | null | undefined

const coll = new Intl.Collator('ko', { numeric: true })
const blank = (v: SortVal) => v === null || v === undefined || v === ''

export function sortRows<T>(rows: T[], sort: Sort, get: (r: T, key: string) => SortVal): T[] {
  if (!sort) return rows
  const m = sort.dir === 'asc' ? 1 : -1
  return [...rows].sort((a, b) => {
    const x = get(a, sort.key), y = get(b, sort.key)
    if (blank(x) || blank(y)) return blank(x) === blank(y) ? 0 : blank(x) ? 1 : -1
    return m * (typeof x === 'number' && typeof y === 'number' ? x - y : coll.compare(String(x), String(y)))
  })
}

/** 같은 열을 다시 누르면 방향 전환, 다른 열은 오름차순부터 */
export const nextSort = (cur: Sort, key: string): Sort => (cur?.key === key ? { key, dir: cur.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' })

export function useSort(init: Sort = null) {
  const [sort, setSort] = useState<Sort>(init)
  return [sort, (key: string) => setSort((c) => nextSort(c, key))] as const
}

/** 정렬 머리글 — 화살표는 글자 옆에 띄워(absolute) 가운데 정렬된 제목 위치를 바꾸지 않음 */
export function SortTh({ k, sort, onSort, className, children, extra, col }: { k: string; sort: Sort; onSort: (k: string) => void; className?: string; children: ReactNode; extra?: ReactNode; col?: number }) {
  const on = sort?.key === k
  const dir = on ? sort!.dir : null
  return (
    <th data-col={col} className={`sortable ${on ? 'sorted' : ''} ${className ?? ''}`} aria-sort={dir === 'asc' ? 'ascending' : dir === 'desc' ? 'descending' : 'none'}>
      <button type="button" className="sort-btn" onClick={() => onSort(k)} title={dir === 'asc' ? '내림차순으로 정렬' : '오름차순으로 정렬'}>
        {children}<span className="sort-ic" aria-hidden>{dir === 'desc' ? '▼' : '▲'}</span>
      </button>
      {extra}
    </th>
  )
}
