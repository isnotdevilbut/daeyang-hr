// v33 → v34 (D-218): 화면·데이터에서 '(가상)' 표시 떼기 — 시연 데이터도 실제 자료처럼 보이게(사용자 요청).
// 시연 응답 끝의 '(가상 응답)'·'(가상 의견)', 시연 KPI 지표 이름의 '(가상)', 시연 보정 사유의 '(가상)'만 뗀다. 사용자가 쓴 다른 글은 그대로. 반복 실행 안전
import type { AppState } from './types'

const TAIL = /\s*\(가상( 응답| 의견)?\)$/

export function stripVirtualV34(s: AppState): string[] {
  let answers = 0, kpis = 0, adjs = 0
  for (const r of Object.values(s.responses)) {
    for (const [k, v] of Object.entries(r.answers ?? {})) {
      if (typeof v === 'string' && /\(가상 (응답|의견)\)$/.test(v)) { r.answers[k] = v.replace(TAIL, ''); answers++ }
    }
  }
  for (const k of s.kpiIndicators ?? []) if (/\(가상\)$/.test(k.name)) { k.name = k.name.replace(TAIL, ''); kpis++ }
  for (const a of s.adjustments ?? []) if (a.reason && /\(가상\)$/.test(a.reason)) { a.reason = a.reason.replace(TAIL, ''); adjs++ }
  return answers || kpis || adjs ? [`'(가상)' 표시 떼기: 응답 글 ${answers}곳, KPI 지표 이름 ${kpis}개, 보정 사유 ${adjs}건`] : []
}
