import { useEffect, useRef } from 'react'

/**
 * 로그인 배경 (D-086): 잔잔한 수면 위 빛처럼 넓고 부드러운 색 영역이 천천히 일렁이고, 마우스를 따라 작고 옅은 불규칙 번짐이 바로 따라온다(D-087).
 * - 카드 뒤 배경층(fixed, pointer-events 없음) — 입력·클릭·선택을 막지 않음
 * - 색 영역은 radial-gradient(가장자리 투명)라 도형 경계가 없고, alternate 반복이라 주기 끝이 튀지 않음
 * - 커서 추적은 마우스(정밀 포인터)이고 움직임 줄이기가 아닐 때만, 화면 밖으로 나가면 서서히 사라짐
 * - 화면을 떠나면 이벤트·애니메이션 프레임 정리(컴포넌트와 함께 사라짐)
 */
export function LoginBackdrop() {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const fine = window.matchMedia('(pointer: fine)').matches
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (!fine || reduce) return
    let tx = 0, ty = 0, x = 0, y = 0, started = false, raf = 0
    const tick = () => {
      x += (tx - x) * 0.28; y += (ty - y) * 0.28 // D-087: 반응 빠르게(긴 꼬리·관성 없음), 순간이동 없이 부드럽게
      const near = Math.abs(tx - x) + Math.abs(ty - y) < 1.5
      if (near) { x = tx; y = ty } // 마지막 몇 픽셀은 바로 맞춤 — 멈춘 뒤 느린 꼬리·떨림 없음
      el.style.setProperty('--mx', `${x.toFixed(1)}px`); el.style.setProperty('--my', `${y.toFixed(1)}px`)
      raf = near ? 0 : requestAnimationFrame(tick)
    }
    const move = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return
      tx = e.clientX; ty = e.clientY
      if (!started) { started = true; x = tx; y = ty }
      el.classList.add('cursor-on')
      if (!raf) raf = requestAnimationFrame(tick)
    }
    const leave = () => el.classList.remove('cursor-on')
    const out = (e: MouseEvent) => { if (!e.relatedTarget) leave() }
    window.addEventListener('pointermove', move, { passive: true })
    document.addEventListener('mouseout', out)
    window.addEventListener('blur', leave)
    return () => {
      window.removeEventListener('pointermove', move)
      document.removeEventListener('mouseout', out)
      window.removeEventListener('blur', leave)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [])
  return (
    <div ref={ref} className="login-bg" aria-hidden>
      <span className="lb lb1" /><span className="lb lb2" /><span className="lb lb3" /><span className="lb lb4" /><span className="lb lb5" />
      <span className="lb-cursor" />
    </div>
  )
}
