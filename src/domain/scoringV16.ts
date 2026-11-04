// v15 → v16 (D-103): 평가표 배점·단계 반영 비율 초기값(자문 기준). 저장 데이터 변환과 새 시드가 같은 함수를 쓴다.
// - 준비·진행 회차만(마감·확정 회차의 평가표·비율·점수는 그대로)
// - 공통 평가표의 5개 영역에 배점·설명(이미 배점이 있는 평가표는 그대로)
// - 팀장 자기평가표 버전 추가(적용: 자기평가 · 팀장 직급). 응답이 있는 배정의 평가표는 바꾸지 않는다(applyVersions 규칙)
// - 단계 반영 비율: 이전 개발용 기본값(사원 33.3/33.3/33.4, 팀장 50/50)이거나 비어 있을 때만 20/40/40 (팀장 경로 20·40)
// - 직급별 최종 반영 예시 보관(적용 보류)
import type { AppState, Cycle, FinalBlendPlan } from './types'
import { applyMemberPoints, LEAD_SELF_NAME, makeLeadSelfTemplate } from './templates'
import { applyVersions, activeVersions } from './versions'
import { syncable } from './cycleSync'

export const FINAL_BLEND_EXAMPLE = (): FinalBlendPlan => ({
  member: [{ key: 'personal', on: true, pct: 80 }, { key: 'kpi', on: true, pct: 20 }],
  lead: [{ key: 'self', on: true, pct: 20 }, { key: 'kpi', on: true, pct: 40 }, { key: 'upward', on: true, pct: 40 }], // D-183: 회사 정정 20/40/40(이전 예시 20/30/40·상향 꺼짐)
  exec: [{ key: 'kpi', on: true, pct: 60 }, { key: 'upward', on: false, pct: 40 }],
})
const same = (a: Record<number, number | null> | undefined, b: Record<number, number>) => !!a && JSON.stringify(Object.entries(a).filter(([, v]) => v !== null).sort()) === JSON.stringify(Object.entries(b).sort())
const empty = (a: Record<number, number | null> | undefined) => !a || Object.values(a).every((v) => v === null || v === undefined)

/** D-183 이전 팀장 예시(20/30/40·상향평가 꺼짐) */
export const LEAD_BLEND_OLD = (): FinalBlendPlan['lead'] => [{ key: 'self', on: true, pct: 20 }, { key: 'kpi', on: true, pct: 30 }, { key: 'upward', on: false, pct: 40 }]
/**
 * v24 → v25 (D-183): 직급별 최종 반영 비율의 팀장 = 자기평가 20 / 팀 KPI 40 / 상향평가 40(회사 정정, 합계 100).
 * 준비·진행 회차 중 팀장 값이 이전 예시 그대로일 때만 바꾼다(사용자가 고친 값·마감·확정 회차 그대로). 점수 계산은 바꾸지 않음
 */
export function leadBlendV25(s: AppState): string[] {
  const notes: string[] = []
  for (const c of s.cycles ?? []) {
    if (!syncable(c) || !c.finalBlendPlan) continue
    if (JSON.stringify(c.finalBlendPlan.lead) !== JSON.stringify(LEAD_BLEND_OLD())) continue
    c.finalBlendPlan.lead = FINAL_BLEND_EXAMPLE().lead
    notes.push(`${c.name}: 팀장 최종 반영 비율 자기평가 20 / 팀 KPI 40 / 상향평가 40`)
  }
  return notes
}

export function scoringV16(s: AppState): string[] {
  const notes: string[] = []
  for (const c of s.cycles ?? []) {
    if (!syncable(c)) continue // 마감·확정 회차는 그대로
    if (!c.finalBlendPlan) c.finalBlendPlan = FINAL_BLEND_EXAMPLE()
    const pre = `${c.name}: `
    // 1. 공통 평가표(들) 배점
    let pts = 0
    for (const t of Object.values(c.templates)) if (applyMemberPoints(t)) pts++
    if (pts) notes.push(`${pre}평가표 ${pts}개에 영역 배점(35·20·20·10·15) 적용`)
    // 2. 팀장 자기평가표 버전
    if (c.versions && !activeVersions(c).some((v) => v.name === LEAD_SELF_NAME)) addLeadSelf(s, c, notes, pre)
    // 3. 단계 반영 비율 초기값
    const w = c.stageWeights ?? { member: {}, lead: {} }
    if (empty(w.member) || same(w.member, { 1: 33.3, 2: 33.3, 3: 33.4 })) { w.member = { 1: 20, 2: 40, 3: 40 }; notes.push(`${pre}사원 경로 반영 비율 20/40/40`) }
    if (empty(w.lead) || same(w.lead, { 1: 50, 3: 50 })) { w.lead = { 1: 20, 3: 40 }; notes.push(`${pre}팀장 경로 반영 비율 20/40(적용 단계 기준 100%로 환산)`) }
    c.stageWeights = w
  }
  return notes
}

function addLeadSelf(s: AppState, c: Cycle, notes: string[], pre: string) {
  const leadPos = (s.positions ?? []).filter((p) => p.evalClass === '팀장').map((p) => p.id)
  if (!leadPos.length) return
  const id = `${c.id}-tpl-lead-self`
  if (!c.templates[id]) c.templates[id] = makeLeadSelfTemplate(id)
  c.versions = [...(c.versions ?? []), { templateId: id, name: LEAD_SELF_NAME, scope: { mode: 'custom', rules: ['self'], teams: 'all', positions: leadPos } }]
  const probs = applyVersions(s, c)
  if (probs.some((p) => p.kind === 'conflict' && p.candidates.includes(id))) {
    // 다른 지정 버전과 겹치면 임의로 고르지 않고 초안으로 둔다(관리자가 문항 관리에서 적용)
    c.versions = c.versions.map((v) => (v.templateId === id ? { ...v, draft: true } : v))
    applyVersions(s, c)
    notes.push(`${pre}${LEAD_SELF_NAME} — 다른 버전과 겹쳐 초안으로 추가(적용 전)`)
  } else notes.push(`${pre}${LEAD_SELF_NAME} 추가(팀장 자기평가 — 응답 있는 평가는 기존 평가표 유지)`)
}
