// 권한 초안 (docs/permissions.md). ⚠ 목업은 화면에서만 검사한다.
// 실서비스에서는 같은 규칙을 서버·API·파일 다운로드에서 검사해야 한다.
import type { DemoRole, DemoSession } from './types'

const RULES = {
  viewProgress: ['admin'],
  editPeople: ['admin'],
  editTemplates: ['admin'],
  manageCycles: ['admin'],
  editKpi: ['admin'],
  viewKpi: ['admin'],
  viewResults: ['admin'],
  adjust: ['admin'],
  reportPreview: ['admin'],
  evaluate: ['member', 'lead', 'exec'], // 본인에게 배정된 평가만 (화면에서 evaluatorId로 다시 확인)
} satisfies Record<string, DemoRole[]>

export type Action = keyof typeof RULES
export const can = (role: DemoRole, action: Action) => (RULES[action] as DemoRole[]).includes(role)

/**
 * 최종 점수·등급 지정. 대표자가 직접 할지 담당자가 승인 내용을 반영할지 미정이라
 * 목업에서는 "최종 조정 가능" 표시가 있는 운영담당자 계정만 허용한다 (D-036, 실서비스 권한 아님).
 */
export const canFinalAdjust = (s: DemoSession) => s.role === 'admin' && s.finalAdjust === true

/** 회사 확인이 필요한 권한 — 화면에 ⚠ 표시 */
export const PENDING: Partial<Record<Action, string>> = {
  editKpi: 'KPI 입력 권한 확인 필요',
  viewResults: '담당자의 결과 열람 범위 확인 필요',
  adjust: '보정 입력 권한 확인 필요',
  reportPreview: '담당자의 리포트 생성·열람 범위 확인 필요',
}

export const ADMIN_NAV: { to: string; label: string; action: Action }[] = [
  { to: '/admin/progress', label: '진행 현황', action: 'viewProgress' },
  { to: '/admin/people', label: '조직 관리', action: 'editPeople' }, // 주소는 기존 그대로 유지
  { to: '/admin/evaluation', label: '평가 관리', action: 'manageCycles' }, // 평가표 + 회차·배정 통합 (D-023)
  { to: '/admin/kpi', label: 'KPI 반영', action: 'viewKpi' },
  { to: '/admin/results', label: '결과·리포트', action: 'viewResults' },
]
