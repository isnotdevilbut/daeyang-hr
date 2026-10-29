// 저장하지 않은 편집 보호: 편집 중인 폼이 표시하고, 회차·탭 전환과 페이지 이탈 전에 확인한다.
import { useEffect } from 'react'

let dirty = false

export function confirmLeave(): boolean {
  if (!dirty) return true
  const ok = confirm('저장하지 않은 변경이 있습니다. 이동하면 변경 내용이 사라집니다. 이동할까요?')
  if (ok) dirty = false
  return ok
}

/** 폼이 "저장 안 된 변경 있음" 상태를 알린다. 화면을 떠나면 자동 해제 */
export function useDirty(isDirty: boolean) {
  useEffect(() => {
    dirty = isDirty
    if (!isDirty) return
    const h = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [isDirty])
  useEffect(() => () => { dirty = false }, [])
}
