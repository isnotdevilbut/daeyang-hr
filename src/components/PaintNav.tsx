// 상단 메뉴와 배경 빛 (D-069, D-068의 메뉴 상자·배경 빛을 대체).
//
// 메뉴는 버튼 상자가 아니라 블루 배경 위의 글자다. 그 뒤로 색이 번진다:
//  - 선택 빛: 현재 페이지 메뉴 뒤에 머무는 넓고 부드러운 파랑·청록 빛. 물 위의 빛처럼 천천히 모양이 변하고(CSS),
//    다른 페이지로 가면 새 메뉴로 부드럽게 옮겨 간다. hover로 사라지지 않는다.
//  - hover 빛: 포인터 위치를 따라오는 더 옅은 임시 빛(선택 빛과 구분). 흰 작업 화면·모달 위에서는 꺼진다.
//  - 파동: 메뉴를 누르거나 새 메뉴에 들어갈 때 그 자리에서 부드럽게 퍼지는 고리.
//
// 같은 빛을 두 층에 똑같이 그린다(<Aurora layer="header|page">). 헤더 배경은 페이지 배경과 같은 고정 그라데이션이라
// 두 층이 이어져 보이고, 빛이 헤더 아래 경계에서 잘려 보이지 않는다. 페이지 층은 흰 작업 화면(.app-shell)보다 아래다.
// 좌표는 문서 루트의 CSS 변수로만 넘긴다. 장식은 모두 pointer-events: none·aria-hidden이라 클릭·스크롤·글자 선택을 막지 않는다.
// 터치: 선택 빛만(hover·파동 없음). 움직임 줄이기: 움직임 없이 선택 빛만 정적으로.
import { useLayoutEffect, useRef, type PointerEvent as RPointerEvent } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { confirmLeave } from '../data/dirty'

export interface NavItem { to: string; label: string; end?: boolean }

const root = () => document.documentElement
const fine = () => window.matchMedia('(hover: hover) and (pointer: fine)').matches
const calm = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

/** 두 빛 층에 같은 파동을 같은 순간에 넣는다(같이 시작해 같이 끝남) */
function ripple(x: number, y: number, weak = false) {
  if (calm()) return
  document.querySelectorAll('.aurora').forEach((layer) => {
    const r = document.createElement('i')
    r.className = weak ? 'a-ripple weak' : 'a-ripple'
    r.style.left = `${x}px`
    r.style.top = `${y}px`
    layer.appendChild(r)
    r.addEventListener('animationend', () => r.remove(), { once: true })
    window.setTimeout(() => r.remove(), 1600)
  })
}

export function PaintNav({ items, label }: { items: NavItem[]; label: string }) {
  const navRef = useRef<HTMLElement>(null)
  const { pathname } = useLocation()
  const lastLink = useRef<Element | null>(null)

  // 선택 빛 위치 = 실제 현재 경로의 메뉴(NavLink의 active). 새로고침·직접 주소·뒤로 가기에서도 경로 기준
  useLayoutEffect(() => {
    const nav = navRef.current
    if (!nav) return
    const measure = () => {
      const a = nav.querySelector<HTMLElement>('a.active')
      const el = root()
      if (!a) { el.dataset.sel = '0'; return }
      const r = a.getBoundingClientRect()
      el.style.setProperty('--sx', `${r.left + r.width / 2}px`)
      el.style.setProperty('--sy', `${r.top + r.height / 2}px`)
      el.style.setProperty('--sw', `${r.width}px`)
      el.dataset.sel = '1'
    }
    measure()
    // 처음 자리 잡을 때는 미끄러지지 않고, 그 뒤 이동만 부드럽게
    const t = requestAnimationFrame(() => requestAnimationFrame(() => { root().dataset.selMove = '1' }))
    const ro = new ResizeObserver(measure)
    ro.observe(nav)
    nav.addEventListener('scroll', measure, { passive: true }) // 좁은 화면의 가로 스크롤 메뉴
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, { passive: true })
    return () => {
      cancelAnimationFrame(t)
      ro.disconnect()
      nav.removeEventListener('scroll', measure)
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', measure)
    }
  }, [pathname, items.length])

  const onDown = (e: RPointerEvent) => {
    if (e.pointerType === 'touch' || e.button !== 0) return
    if ((e.target as Element).closest('a.paint-link')) ripple(e.clientX, e.clientY)
  }
  // 새 메뉴에 들어갈 때 작은 파동 (같은 메뉴 안에서 움직일 때는 없음)
  const onOver = (e: RPointerEvent) => {
    if (e.pointerType === 'touch' || !fine()) return
    const a = (e.target as Element).closest('a.paint-link')
    if (a && a !== lastLink.current) ripple(e.clientX, e.clientY, true)
    lastLink.current = a
  }

  return (
    <nav ref={navRef} className="admin-nav" aria-label={label} onPointerDown={onDown} onPointerOver={onOver} onPointerLeave={() => { lastLink.current = null }}>
      {items.map((n) => (
        <NavLink key={n.to} to={n.to} end={n.end} className="paint-link" onClick={(e) => { if (!confirmLeave()) e.preventDefault() }}>{/* 저장하지 않은 편집이 있으면 이동 전 확인 */}
          <span className="nav-label">{n.label}</span>
        </NavLink>
      ))}
    </nav>
  )
}

/** 빛 층 하나. 헤더 안(layer="header")과 작업 화면 뒤(layer="page")에 하나씩 둔다 */
export function Aurora({ layer }: { layer: 'header' | 'page' }) {
  return (
    <div className={`aurora no-print aurora-${layer}`} aria-hidden>
      <i className="a-sel"><b /></i>
      <i className="a-hov" />
    </div>
  )
}

/** 포인터 추적(한 번만 둔다): hover 빛 좌표·켜짐. 흰 작업 화면·모달·로그인 카드 위에서는 끈다. 터치·움직임 줄이기에서는 켜지 않음 */
export function PointerGlow() {
  useLayoutEffect(() => {
    if (!fine() || calm()) return
    let frame = 0
    let next: { x: number; y: number; on: boolean } | null = null
    const apply = () => {
      frame = 0
      if (!next) return
      const el = root()
      el.style.setProperty('--gx', `${next.x}px`)
      el.style.setProperty('--gy', `${next.y}px`)
      el.dataset.hov = next.on ? '1' : '0'
    }
    const move = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return
      const over = (e.target as Element | null)?.closest?.('.app-panel, .modal, .modal-bg, .login-card')
      next = { x: e.clientX, y: e.clientY, on: !over }
      if (!frame) frame = requestAnimationFrame(apply)
    }
    const leave = () => { root().dataset.hov = '0' }
    window.addEventListener('pointermove', move, { passive: true })
    document.documentElement.addEventListener('pointerleave', leave)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('pointermove', move)
      document.documentElement.removeEventListener('pointerleave', leave)
      delete root().dataset.hov
    }
  }, [])
  return null
}
