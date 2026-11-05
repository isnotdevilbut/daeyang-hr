import { createPortal } from 'react-dom'
import type { ReactNode } from 'react'
import { CELL_HELP, CELL_ICON, CELL_LABEL, type CellStatus } from '../domain/progress'
import type { Lang } from '../domain/types'
import { t } from '../i18n'

export function Notice({ kind, title, children }: { kind: 'assume' | 'demo' | 'warn' | 'info' | 'danger'; title?: string; children?: ReactNode }) {
  return (
    <div className={`notice ${kind}`} role={kind === 'danger' || kind === 'warn' ? 'alert' : undefined}>
      {title && <b>{title}</b>}
      {children}
    </div>
  )
}

/** 회사 확정 규칙이 아닌 값에 붙이는 표식 */
export function Assume({ children = '검토용 가정' }: { children?: ReactNode }) {
  return <span className="chip assume">◇ {children}</span>
}
export function DemoOnly({ children = '시연용' }: { children?: ReactNode }) {
  return <span className="chip locked">▶ {children}</span>
}
export function NotBuilt({ children = '미구현 · 실서비스 단계' }: { children?: ReactNode }) {
  return <span className="chip danger">✕ {children}</span>
}

/** lang을 주면 평가 참여자 화면 언어로 (관리자 화면은 한국어 그대로) */
export function StatusChip({ status, lang }: { status: CellStatus; lang?: Lang }) {
  return (
    <span className={`chip ${status}${status === 'locked' ? ' stage' : ''}`} title={lang ? undefined : CELL_HELP[status]}>{/* '대기'는 완료·미완료와 같은 크기(D-220) */}
      <span aria-hidden>{CELL_ICON[status]}</span> {lang ? t(`status.${status}`, lang) : CELL_LABEL[status]}
    </span>
  )
}

/** 모달은 문서 맨 위(body)에 그린다 — 작업 화면(.app-shell)이 따로 쌓임 층을 가져도 헤더까지 덮도록 (D-070) */
export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  return createPortal(
    <div className="modal-bg" onClick={onClose}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="row">
          <h2 style={{ margin: 0 }}>{title}</h2>
          <span className="spacer" />
          <button type="button" className="modal-x" aria-label="닫기" title="닫기" onClick={onClose}>✕</button>
        </div>
        <div style={{ marginTop: 14 }}>{children}</div>
      </div>
    </div>,
    document.body,
  )
}

export function Forbidden({ reason, lang = 'ko' }: { reason?: string; lang?: Lang }) {
  return (
    <div className="page">
      <Notice kind="danger" title={t('forbid.title', lang)}>
        {t('forbid.body', lang, { reason: reason ?? '' })}
      </Notice>
    </div>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="card muted" style={{ textAlign: 'center', padding: 30 }}>{children}</div>
}

/** 영역 접기·펼치기 큰 토글(D-202) — 응답 결과 토글과 같은 동그라미 화살표. 펼치면 화살표가 위로 */
export function SecToggle({ open, onClick, label }: { open: boolean; onClick: () => void; label: string }) {
  return (
    <button type="button" className={`toggle-ic sec-toggle ${open ? 'open' : ''}`} aria-expanded={open} aria-label={`${label} ${open ? '접기' : '펼치기'}`} onClick={onClick}>
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M6 9l6 6 6-6" /></svg>
    </button>
  )
}
