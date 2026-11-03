// 저장하지 않은 편집 보호: 편집 중인 폼이 표시하고, 회차·탭 전환과 페이지 이탈 전에 확인한다.
// 한 화면에 폼이 여럿이어도(D-164: 평가자 배정 = 평가 참여자 + 임원 평가 배정) 하나라도 저장 안 된 변경이 있으면 확인
import { useEffect, useRef } from 'react'

const sources = new Set<object>()

export function confirmLeave(): boolean {
  if (sources.size === 0) return true
  const ok = confirm('저장하지 않은 변경이 있습니다. 이동하면 변경 내용이 사라집니다. 이동할까요?')
  if (ok) sources.clear()
  return ok
}

/** 폼이 "저장 안 된 변경 있음" 상태를 알린다. 화면을 떠나면 자동 해제 */
export function useDirty(isDirty: boolean) {
  const token = useRef({})
  useEffect(() => {
    if (isDirty) sources.add(token.current)
    else sources.delete(token.current)
    if (!isDirty) return
    const h = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [isDirty])
  useEffect(() => { const t = token.current; return () => { sources.delete(t) } }, [])
}
