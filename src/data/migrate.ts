// 브라우저에 저장된 이전 목업 데이터를 새 기준으로 변환한다. 사용자가 편집한 내용(인원·평가표·응답·보정)은 보존한다.
import type { AppState } from '../domain/types'
import { LEGACY_DEV_HELP, LEGACY_UPWARD_ID } from '../domain/templates'
import { reorganizeToFourTeams } from '../domain/reorg'
import { fixedStagesAndTiers } from '../domain/stagesV8'
import { attachDefaultTranslations } from '../i18n/content'
import { execsAndAssignments } from '../domain/execsV10'
import { selfForStaff } from '../domain/cycle'
import { rosterAndPaths } from '../domain/rosterV12'
import { createSeed } from '../domain/seed'
import { ensureCatalog } from '../domain/catalog'
import { syncCycle } from '../domain/cycleSync'
import { v15 } from '../domain/demoV15'
import { leadBlendV25, scoringV16 } from '../domain/scoringV16'
import { execPerTeam } from '../domain/execTeamsV17'
import { execUpwardFormV27, upwardExecV26, upwardFormV22, upwardV18 } from '../domain/upward'
import { joinAllStaff } from '../domain/joinAllV19'
import { leadUpwardOpen, moreDemo } from '../domain/demoV20'
import { demoKpiV23 } from '../domain/demoV23'
import { tierOf } from '../domain/org'

export interface MigrationResult { state: AppState; notes: string[] }

/* eslint-disable @typescript-eslint/no-explicit-any */
export function migrate(raw: any): MigrationResult | null {
  if (!raw || typeof raw !== 'object') return null
  const notes: string[] = []
  const s = structuredClone(raw)

  if (s.schemaVersion === 1) {
    // v1 → v2: 상향평가(팀원→팀장) 제외 — 2026-10-27 후속 확인 (docs/decisions.md D-011)
    let removedAssign = 0
    let removedResp = 0
    let removedTok = 0
    for (const c of s.cycles ?? []) {
      const isUp = (a: any) => a.direction === 'up' || a.stageOrder === null || a.stageOrder === undefined
      const ups = (c.assignments ?? []).filter(isUp)
      for (const a of ups) {
        if (s.responses?.[a.id]) { delete s.responses[a.id]; removedResp++ }
      }
      removedAssign += ups.length
      c.assignments = (c.assignments ?? []).filter((a: any) => !isUp(a))
      delete c.upwardEnabled
      delete c.upwardTemplateId
      if (c.templates) delete c.templates[LEGACY_UPWARD_ID]
      // 자기평가가 없는 사람(상향평가만 하던 사람)의 개인 링크 회수
      const selfIds = new Set(c.assignments.filter((a: any) => a.direction === 'self').map((a: any) => a.evaluatorId))
      const before = (s.tokens ?? []).length
      s.tokens = (s.tokens ?? []).filter((t: any) => t.cycleId !== c.id || selfIds.has(t.employeeId))
      removedTok += before - s.tokens.length
    }
    // 시드 그대로인(편집하지 않은) 상향평가 템플릿만 제거. 편집했다면 보존한다.
    const up = (s.templates ?? []).find((t: any) => t.id === LEGACY_UPWARD_ID)
    if (up && up.version === 1) s.templates = s.templates.filter((t: any) => t.id !== LEGACY_UPWARD_ID)
    else if (up) notes.push('편집된 상향평가 템플릿은 보존했지만 회차에서는 쓰지 않습니다.')
    s.schemaVersion = 2
    notes.unshift(`이전 저장 데이터에서 상향평가 배정 ${removedAssign}건, 응답 ${removedResp}건, 링크 ${removedTok}건을 제외했습니다. 다른 편집 내용은 그대로 유지했습니다.`)
  }

  if (s.schemaVersion === 2) {
    // v2 → v3: 전체 공통 가중치(상대 비중)를 회차별·경로별 반영 비율(%)로 옮긴다. 사용자가 바꾼 비율도 그대로 환산
    const rel: Record<number, number> = s.policy?.stageWeights ?? {}
    const toPct = (orders: number[]) => {
      const total = orders.reduce((a, o) => a + (Number(rel[o]) || 0), 0)
      const out: Record<number, number | null> = {}
      if (total <= 0) { orders.forEach((o) => (out[o] = null)); return out }
      let acc = 0
      orders.forEach((o, i) => {
        if (i === orders.length - 1) out[o] = Math.round((100 - acc) * 10) / 10
        else { out[o] = Math.round(((Number(rel[o]) || 0) / total) * 1000) / 10; acc += out[o] as number }
      })
      return out
    }
    for (const c of s.cycles ?? []) {
      if (c.stageWeights) continue
      c.stageWeights = {
        member: toPct((c.path?.member ?? []).map((x: any) => x.order)),
        lead: toPct((c.path?.lead ?? []).map((x: any) => x.order)),
      }
    }
    if (s.policy) delete s.policy.stageWeights
    // 기본 문항의 개발용 도움말 제거 (문구가 정확히 같을 때만 — 사용자가 고친 도움말은 그대로)
    let cleared = 0
    const clean = (t: any) => t?.sections?.forEach((sec: any) => sec.questions?.forEach((q: any) => { if (LEGACY_DEV_HELP.includes(q.help)) { q.help = ''; cleared++ } }))
    ;(s.templates ?? []).forEach(clean)
    for (const c of s.cycles ?? []) Object.values(c.templates ?? {}).forEach(clean)
    if (cleared) notes.push(`응답 화면에 보이던 개발용 도움말 ${cleared}개를 지웠습니다.`)
    s.schemaVersion = 3
    notes.push('단계 반영 비율을 회차별 설정으로 옮겼습니다.')
  }

  if (s.schemaVersion === 3) {
    // v3 → v4: KPI 지표·개인평가 반영 추가. 기존 직접 입력 점수는 그대로 두고 출처만 "직접 입력"으로 표시,
    // 목표·실적을 거꾸로 만들지 않는다. 기존 회차는 KPI 반영 "끔" — 최종 점수가 갑자기 바뀌지 않게
    s.kpiIndicators = s.kpiIndicators ?? []
    let manual = 0
    for (const k of s.kpi ?? []) if (!k.mode && k.score !== null && k.score !== undefined) { k.mode = 'manual'; manual++ }
    for (const c of s.cycles ?? []) if (!c.kpiBlend) c.kpiBlend = { enabled: false, personal: null, kpi: null }
    if (s.policy) delete s.policy.kpiMode
    s.schemaVersion = 4
    if (manual) notes.push(`기존 부서 KPI 점수 ${manual}개를 "직접 입력" 점수로 유지했습니다.`)
  }

  if (s.schemaVersion === 4) {
    // v4 → v5: 평가 상태에서 '보정검토' 제거 (D-054). 그 회차는 '마감'으로 — 응답·점수·보정·변경 기록은 손대지 않는다
    let moved = 0
    for (const c of s.cycles ?? []) if (c.status === '보정검토') { c.status = '마감'; moved++ }
    s.schemaVersion = 5
    if (moved) notes.push(`'보정 검토' 상태 회차 ${moved}개를 '마감'으로 바꿨습니다.`)
  }

  if (s.schemaVersion === 5) {
    // v5 → v6: 임원은 자기평가를 하지 않는다 (D-056). 대상자 스냅샷에 임원 여부를 채우고,
    // 이미 있는 임원 자기평가 배정은 지우지 않고 "제외"로 표시 — 임시저장·제출 응답은 그대로 보존, 집계·작성 목록에서만 빠진다
    const execIds = new Set((s.employees ?? []).filter((e: any) => e.isExecutive).map((e: any) => e.id))
    let excluded = 0
    for (const c of s.cycles ?? []) {
      for (const t of c.targets ?? []) if (t.isExecutive === undefined) t.isExecutive = execIds.has(t.employeeId)
      for (const a of c.assignments ?? []) {
        if (a.direction === 'self' && execIds.has(a.evaluatorId) && !a.excluded) { a.excluded = 'execSelf'; excluded++ }
      }
    }
    s.schemaVersion = 6
    if (excluded) notes.push(`임원 자기평가 배정 ${excluded}건을 집계에서 제외했습니다(응답은 보존).`)
  }

  if (s.schemaVersion === 6) {
    // v6 → v7: 네 팀 구조·자연스러운 가상 성명 (D-065). 원래 시드 값과 같은 항목만 바꾸고 사용자 편집은 보존·보고
    notes.push(...reorganizeToFourTeams(s))
    s.schemaVersion = 7
  }

  if (s.schemaVersion === 7) {
    // v7 → v8: 고정 단계 번호(1 자기·2 팀장·3 임원), 팀장·임원 자기평가 설정, 세 직급 (D-068)
    notes.push(...fixedStagesAndTiers(s))
    s.schemaVersion = 8
  }

  if (s.schemaVersion === 8) {
    // v8 → v9: 문항·선택지·평가영역 러시아어 번역 필드 (D-075). 한국어 원문이 기본값 그대로인 기본 문항에만 번역 초안을 붙이고,
    // 사용자가 고친 문항·이미 있는 번역은 그대로 둔다. 응답·점수·문항/선택지 ID 변경 없음
    const n = attachDefaultTranslations(s)
    if (n) notes.push(`기본 문항 러시아어 번역 초안 ${n}건 연결`)
    s.schemaVersion = 9
  }

  if (s.schemaVersion === 9) {
    // v9 → v10: 임원 4명 보장(모자랄 때만), 응답 없는 2단계를 현재 팀장으로, 작성 배정 없는 임원에게 응답 없는 임원평가 분배 (D-076)
    notes.push(...execsAndAssignments(s))
    s.schemaVersion = 10
  }

  if (s.schemaVersion === 10) {
    // v10 → v11: 확정 전 회차에서 현재 사원인데 자기평가가 꺼진 대상자는 켬(현재 직급 기준, D-077). 응답은 보존·되살림
    for (const c of s.cycles ?? []) { const names = selfForStaff(s, c.id); if (names.length) notes.push(`현재 사원 자기평가 켬: ${names.join(', ')}`) }
    s.schemaVersion = 11
  }

  if (s.schemaVersion === 11) {
    // v11 → v12: 35명 구성(경영기획팀 팀장 복원·설계팀 이동·가상 사원 추가), 확정 전 회차 직급·평가 경로 정리 (D-079).
    // 기본 시연 응답 = 원래 시드가 만든 응답과 대상자·저장 시각·답이 모두 같은 응답. 그 밖의 응답은 사용자 기록으로 보고 건드리지 않음
    notes.push(...rosterAndPaths(s, demoResponseCheck(s)))
    s.schemaVersion = 12
  }

  if (s.schemaVersion === 12) {
    // v12 → v13: 직무·직급 목록과 직원 ID 연결 (D-080). 직급 평가 구분은 지금의 임원 표시·팀장 연결로, 이름 글자로 추측하지 않음.
    // 직원·응답·배정·회차 스냅샷 변경 없음
    notes.push(...ensureCatalog(s, (e: any) => tierOf(s, e)))
    s.schemaVersion = 13
  }

  if (s.schemaVersion === 13) {
    // v13 → v14: 준비·진행 회차를 현재 조직 기준으로 맞춤 — 참여 임원 모두가 각각 모든 참여 사원·팀장을 평가(부족한 배정만 추가),
    // 임원이 아닌 평가자에게 남은 응답 없는 임원평가 정리, 팀장평가는 현재 팀장 (D-081). 응답·작성자 변경 없음, 마감·확정 회차 그대로
    const demo = demoResponseCheck(s)
    for (const c of s.cycles ?? []) notes.push(...syncCycle(s, c, demo))
    s.schemaVersion = 14
  }

  if (s.schemaVersion === 14) {
    // v14 → v15 (D-082): 평가표 버전(지금 문항 = 공통 평가표), 임원평가 = 대상자당 담당 임원 한 명(전원 평가 중복 정리), 시연 회차 완료 구성
    const fp = demoResponseCheck(s)
    notes.push(...v15(s, (a) => fp(a) || !!s.responses?.[a.id]?.demo))
    s.schemaVersion = 15
  }

  if (s.schemaVersion === 15) {
    // v15 → v16 (D-103): 평가표 배점(사원 35·20·20·10·15)·팀장 자기평가표 버전·단계 반영 비율 20/40/40(이전 개발용 기본값일 때만)·직급별 최종 반영 예시 보관.
    // 준비·진행 회차만, 응답·문항 ID·번역·배정·확정 회차 그대로
    notes.push(...scoringV16(s))
    s.schemaVersion = 16
  }

  if (s.schemaVersion === 16) {
    // v16 → v17 (D-110): 임원을 팀마다 한 명씩 — 임원의 소속 팀만 옮김(총 인원·배정·응답·담당 그대로). 임원 수 ≠ 팀 수면 그대로
    notes.push(...execPerTeam(s))
    s.schemaVersion = 17
  }

  if (s.schemaVersion === 17) {
    // v17 → v18 (D-114): 팀원→팀장평가 — 준비·진행 회차에 평가표 버전·배정(사원 → 소속 팀 팀장)·시연 응답(절반 제출). 기존 배정·응답·점수 그대로
    notes.push(...upwardV18(s))
    s.schemaVersion = 18
  }

  if (s.schemaVersion === 18) {
    // v18 → v19 (D-116): 재직 사원·팀장 모두 준비·진행 회차 참여자로(이전 '평가 제외' 해제, 이전에 업로드한 직원 포함). 기존 배정·응답·마감/확정 회차 그대로
    notes.push(...joinAllStaff(s))
    s.schemaVersion = 19
  }

  if (s.schemaVersion === 19) {
    // v19 → v20 (D-117): 시연 완료 비중 높임 — 응답 없는(또는 시연 임시저장) 배정에만 시연 제출, 순차 잠금·시연 완료 구성 유지, 사용자 응답 그대로
    notes.push(...moreDemo(s))
    s.schemaVersion = 20
  }

  if (s.schemaVersion === 20) {
    // v20 → v21 (D-121): 장현우가 받는 팀원→팀장평가 5/6(시연 응답 한 건만 미제출로, 사용자 응답 그대로)
    notes.push(...leadUpwardOpen(s))
    s.schemaVersion = 21
  }

  if (s.schemaVersion === 21) {
    // v21 → v22 (D-124): 팀원→팀장 평가표 = 회사 상향평가 예시(영역 5개·배점 100) — 첫 초기값 그대로·시연 응답만일 때, 시연 답은 새 문항에 맞춤
    notes.push(...upwardFormV22(s))
    s.schemaVersion = 22
  }

  if (s.schemaVersion === 22) {
    // v22 → v23 (D-151): 경영기획팀 가상 KPI 지표(목표·실적 입력) — 지표·직접 입력 점수가 없을 때만
    notes.push(...demoKpiV23(s))
    s.schemaVersion = 23
  }

  if (s.schemaVersion === 23) {
    // v23 → v24 (D-160): 등급 인원 비율에 E 등급 — 없을 때만 0%로 추가(A~D 값·합계 그대로)
    const gr = s.policy?.gradeRatios
    if (gr && typeof gr.E !== 'number') { gr.E = 0; notes.push('등급 인원 비율: E 등급 추가(0%)') }
    s.schemaVersion = 24
  }

  if (s.schemaVersion === 24) {
    // v24 → v25 (D-183): 팀장 최종 반영 비율 20/30/40 → 20/40/40(상향평가 켬) — 이전 예시 그대로인 준비·진행 회차만
    notes.push(...leadBlendV25(s))
    s.schemaVersion = 25
  }

  if (s.schemaVersion === 25) {
    // v25 → v26 (D-187): 상향평가에 팀원·팀장 → 소속 팀 임원 추가(새 배정에만 시연 응답), 임원 최종 반영 상향평가 켬(이전 예시 그대로일 때만)
    notes.push(...upwardExecV26(s))
    s.schemaVersion = 26
  }

  if (s.schemaVersion === 26) {
    // v26 → v27 (D-189): 임원 상향평가표(임원 직접 선택) 추가 — 임원이 받는 상향평가를 이 평가표로(사용자 응답 배정은 그대로)
    notes.push(...execUpwardFormV27(s))
    s.schemaVersion = 27
  }

  if (s.schemaVersion !== 27) return null
  return { state: s as AppState, notes }
}

/** 원래 시드(같은 난수)로 만든 시연 응답의 지문 — 대상자 + 저장 시각 + 답. 사용자가 고친 응답은 저장 시각이 달라 걸리지 않는다 */
function demoResponseCheck(s: any) {
  const leg = createSeed({ legacy: true })
  const fp = new Set(Object.entries(leg.responses).map(([id, r]) => `${leg.cycles[0].assignments.find((a) => a.id === id)?.targetId}|${r.savedAt}|${JSON.stringify(r.answers)}`))
  return (a: { id: string; targetId: string }) => { const r = s.responses?.[a.id]; return !!r && fp.has(`${a.targetId}|${r.savedAt}|${JSON.stringify(r.answers)}`) }
}
