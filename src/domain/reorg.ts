// 목업 조직을 같은 수준의 네 팀(현장팀·생산팀·경영기획팀·설계팀)으로 정리하고 가상 직원 이름을 자연스러운 가상 성명으로 바꾼다 (D-065).
// 저장 데이터 변환(v6 → v7)과 새 시드가 같은 함수를 쓴다.
//  - 원래 시드 값과 "그대로 같은" 항목만 바꾼다 → 사용자가 추가·수정한 팀·직원·이름은 건드리지 않고 충돌로 기록
//  - 다시 실행해도 바뀌는 것이 없다(이름·소속이 이미 새 값이면 건너뜀)
//  - 직원 ID·사번·배정·응답·점수·보정·변경 이력은 그대로. KPI·팀 보정은 옛 부서와 새 팀이 1:1일 때만 새 팀으로 옮기고,
//    여러 부서가 한 팀으로 합쳐지거나 한 부서가 나뉘는 경우는 평균·합산하지 않고 원래 기록을 그대로 둔다(재설정 필요로 보고)
//  - 확정된 회차는 대상자 스냅샷(그때의 소속·이름)과 KPI·보정을 바꾸지 않는다
import type { AppState } from './types'

/** 원래 시드 팀: id → [이름, 옛 부서 id, 팀장] */
const ORIG_TEAMS: Record<string, [string, string, string]> = {
  'tm-plan': ['경영기획팀', 'd-a-mgmt', 'e04'],
  'tm-sales': ['영업팀', 'd-a-mgmt', 'e07'],
  'tm-design': ['설계팀', 'd-a-tech', 'e10'],
  'tm-prod1': ['생산1팀', 'd-a-prod', 'e13'],
  'tm-prod2': ['생산2팀', 'd-a-prod', 'e17'],
  'tm-b-adm': ['관리팀', 'd-b-mgmt', 'e21'],
  'tm-b-prod': ['생산팀', 'd-b-prod', 'e24'],
}
/** 옛 팀 → 새 팀(id, 이름). 새 팀은 기존 팀 레코드를 이어 쓴다(팀 ID 유지) */
export const TEAM_MAP: Record<string, { to: string; name: string }> = {
  'tm-plan': { to: 'tm-plan', name: '경영기획팀' }, // 경영기획
  'tm-sales': { to: 'tm-plan', name: '경영기획팀' }, // 영업 → 경영기획팀
  'tm-b-adm': { to: 'tm-plan', name: '경영기획팀' }, // 관리 → 경영기획팀
  'tm-design': { to: 'tm-design', name: '설계팀' }, // 설계·기술
  'tm-prod1': { to: 'tm-prod1', name: '생산팀' }, // 생산
  'tm-b-prod': { to: 'tm-prod1', name: '생산팀' }, // 생산(옛 생산지원부) → 생산팀
  'tm-prod2': { to: 'tm-prod2', name: '현장팀' }, // 현장 인원이 없어 생산 인력 한 팀을 현장팀으로 재배치
}
/** 원래 시드 직원: id → [이름, 팀] / 새 가상 성명 */
const ORIG_EMP: Record<string, [string, string]> = {
  e01: ['홍대표', 'tm-plan'], e02: ['김임원', 'tm-plan'], e03: ['박임원', 'tm-prod1'], e04: ['이팀장', 'tm-plan'], e05: ['최사원', 'tm-plan'],
  e06: ['정사원', 'tm-plan'], e07: ['강팀장', 'tm-sales'], e08: ['조사원', 'tm-sales'], e09: ['윤사원', 'tm-sales'], e10: ['장팀장', 'tm-design'],
  e11: ['임사원', 'tm-design'], e12: ['한사원', 'tm-design'], e13: ['오반장', 'tm-prod1'], e14: ['서작업', 'tm-prod1'], e15: ['신작업', 'tm-prod1'],
  e16: ['바크트(가상)', 'tm-prod1'], e17: ['권반장', 'tm-prod2'], e18: ['황작업', 'tm-prod2'], e19: ['안작업', 'tm-prod2'], e20: ['누를란(가상)', 'tm-prod2'],
  e21: ['송팀장', 'tm-b-adm'], e22: ['류사원', 'tm-b-adm'], e23: ['전임원', 'tm-b-adm'], e24: ['배반장', 'tm-b-prod'], e25: ['고작업', 'tm-b-prod'],
  e26: ['문작업', 'tm-b-prod'],
}
export const NEW_NAMES: Record<string, string> = {
  e01: '홍성훈', e02: '김도현', e03: '박재원', e04: '이준호', e05: '최유진', e06: '정민수', e07: '강태영', e08: '조은비', e09: '윤서준',
  e10: '장현우', e11: '임지혜', e12: '한승민', e13: '오정훈', e14: '서동욱', e15: '신예린', e16: '바크트 오스모노프', e17: '권민혁',
  e18: '황보람', e19: '안지훈', e20: '누를란 사디코프', e21: '송하은', e22: '류성민', e23: '전상철', e24: '배진우', e25: '고나연', e26: '문태호',
}

/** 옛 부서 → 새 팀이 1:1인 경우만 (KPI·팀 보정을 옮겨도 대상자가 같음) */
function oneToOne(): Record<string, string> {
  const fwd: Record<string, Set<string>> = {}
  const back: Record<string, Set<string>> = {}
  for (const [old, [, dept]] of Object.entries(ORIG_TEAMS)) {
    const to = TEAM_MAP[old].to
    ;(fwd[dept] ??= new Set()).add(to)
    ;(back[to] ??= new Set()).add(dept)
  }
  return Object.fromEntries(Object.entries(fwd).filter(([d, ts]) => ts.size === 1 && back[[...ts][0]].size === 1 && [...back[[...ts][0]]][0] === d).map(([d, ts]) => [d, [...ts][0]]))
}
const OLD_DEPTS = new Set(Object.values(ORIG_TEAMS).map((x) => x[1]))

export function reorganizeToFourTeams(s: AppState): string[] {
  const notes: string[] = []
  const emp = (id: string) => s.employees.find((e) => e.id === id)
  const team = (id: string) => s.teams.find((t) => t.id === id)

  // 1. 새 팀 이름 (원래 이름 그대로일 때만)
  for (const [old, m] of Object.entries(TEAM_MAP)) {
    if (m.to !== old) continue
    const t = team(old)
    if (!t || t.archived) { notes.push(`[충돌] ${m.name}: 기존 팀(${ORIG_TEAMS[old][0]})이 없거나 삭제되어 새 팀으로 쓰지 못했습니다.`); continue }
    if (t.name === ORIG_TEAMS[old][0] && t.name !== m.name) { notes.push(`팀 이름: ${t.name} → ${m.name}`); t.name = m.name }
    else if (t.name !== m.name && t.name !== ORIG_TEAMS[old][0]) notes.push(`[충돌] 팀 이름을 사용자가 '${t.name}'(으)로 바꿔 '${m.name}'(으)로 바꾸지 않았습니다.`)
  }

  // 2. 합쳐지는 팀의 직원 이동 (원래 시드 소속 그대로인 직원만), 비면 팀 숨김
  for (const [old, m] of Object.entries(TEAM_MAP)) {
    if (m.to === old) continue
    const src = team(old), dst = team(m.to)
    if (!src || src.archived || !dst || dst.archived) continue
    const members = s.employees.filter((e) => e.teamId === old)
    const movable = members.filter((e) => ORIG_EMP[e.id]?.[1] === old)
    const kept = members.filter((e) => e.active && !movable.includes(e))
    movable.forEach((e) => { e.teamId = m.to })
    if (movable.length) notes.push(`${ORIG_TEAMS[old][0]} 직원 ${movable.length}명 → ${dst.name}`)
    if (kept.length) {
      notes.push(`[충돌] ${src.name}: 사용자가 추가·이동한 직원 ${kept.map((e) => e.name).join(', ')}은(는) 옮기지 않았습니다 — 팀을 남겨 둡니다.`)
      continue
    }
    // 팀장 지정안: 합쳐지는 팀의 팀장은 새 팀의 팀원이 된다(새 팀의 기존 팀장 연결은 덮어쓰지 않음)
    if (src.leadId) {
      const lead = emp(src.leadId)
      if (lead) notes.push(`팀장 지정안: ${lead.name}(${ORIG_TEAMS[old][0]} 팀장) → ${dst.name} 팀원, ${dst.name} 팀장은 ${emp(dst.leadId ?? '')?.name ?? '미지정'} 유지 — 확인 필요`)
      src.leadId = null
    }
    src.archived = true
    notes.push(`${ORIG_TEAMS[old][0]}: 목록에서 숨김(이전 기록 참조용으로 보존)`)
  }

  // 3. 자연스러운 가상 성명 (원래 시드 이름 그대로인 직원만, 이미 바뀐 이름은 그대로)
  const renamed: Record<string, [string, string]> = {}
  for (const [id, [oldName]] of Object.entries(ORIG_EMP)) {
    const e = emp(id)
    if (!e) continue
    if (e.name === oldName) { renamed[id] = [oldName, NEW_NAMES[id]]; e.name = NEW_NAMES[id] }
    else if (e.name !== NEW_NAMES[id]) notes.push(`[보존] ${id}: 사용자가 바꾼 이름 '${e.name}'은(는) 그대로 둡니다.`)
  }
  if (Object.keys(renamed).length) notes.push(`가상 직원 ${Object.keys(renamed).length}명의 이름을 자연스러운 가상 성명으로 바꿨습니다.`)

  // 4. 확정되지 않은 회차: 대상자 스냅샷을 네 팀 기준으로 (옛 부서 id를 가진 대상자만 — 이미 바뀐 것은 건너뜀)
  const map11 = oneToOne()
  const teamNameToNew: Record<string, string> = Object.fromEntries(Object.entries(ORIG_TEAMS).map(([id, [n]]) => [n, TEAM_MAP[id].to]))
  for (const c of s.cycles) {
    if (c.status === '확정') { notes.push(`${c.name}: 확정 회차라 소속·이름 스냅샷과 KPI·보정을 그대로 둡니다.`); continue }
    let changed = 0
    for (const t of c.targets) {
      if (renamed[t.employeeId] && t.name === renamed[t.employeeId][0]) t.name = renamed[t.employeeId][1]
      // 옛 부서 id(이전 데이터) 또는 옛 팀 id(이전 구조로 만든 시드)를 가진 대상자만 — 이미 정리된 대상자는 건너뜀
      const byTeamId = TEAM_MAP[t.departmentId]
      if (!OLD_DEPTS.has(t.departmentId) && !(byTeamId && (byTeamId.to !== t.departmentId || t.teamName !== byTeamId.name))) continue
      const to = byTeamId ? byTeamId.to : teamNameToNew[t.teamName]
      const nt = to ? team(to) : undefined
      if (!nt) { notes.push(`[충돌] ${c.name} · ${t.name}: 옛 팀 '${t.teamName}'의 새 팀을 찾지 못해 그대로 둡니다.`); continue }
      const oldUnit = OLD_DEPTS.has(t.departmentId) ? t.departmentId : byTeamId ? ORIG_TEAMS[t.departmentId][1] : undefined
      if (oldUnit && map11[oldUnit] !== nt.id) t.legacyUnitId = oldUnit // 1:1로 옮긴 단위는 필요 없음
      t.departmentId = nt.id
      t.departmentName = nt.name
      t.teamName = nt.name
      t.companyName = ''
      changed++
    }
    if (changed) notes.push(`${c.name}: 대상자 ${changed}명의 소속을 네 팀 기준으로 정리(팀장 여부·평가 경로·배정은 그대로)`)
    // KPI·팀 보정: 1:1이면 새 팀으로, 아니면 원래 기록 보존 + 재설정 필요
    for (const k of s.kpi.filter((x) => x.cycleId === c.id && OLD_DEPTS.has(x.departmentId))) {
      const to = map11[k.departmentId]
      if (to && !s.kpi.some((x) => x.cycleId === c.id && x.departmentId === to)) { notes.push(`${c.name}: KPI 기록 ${k.departmentId} → ${team(to)?.name} (1:1)`); k.departmentId = to }
      else notes.push(`[재설정 필요] ${c.name}: 옛 조직(${k.departmentId}) KPI 기록${k.score !== null && k.score !== undefined ? ` ${k.score}점` : ''}은 여러 팀에 걸쳐 그대로 보존 — 새 팀 KPI는 따로 입력해야 합니다.`)
    }
    for (const k of s.kpiIndicators.filter((x) => x.cycleId === c.id && OLD_DEPTS.has(x.departmentId))) {
      const to = map11[k.departmentId]
      if (to) k.departmentId = to
      else notes.push(`[재설정 필요] ${c.name}: 옛 조직(${k.departmentId}) KPI 지표 '${k.name}' 보존 — 새 팀 지표로 다시 등록 필요`)
    }
    for (const a of s.adjustments.filter((x) => x.cycleId === c.id && x.kind === 'dept' && OLD_DEPTS.has(x.targetKey))) {
      const to = map11[a.targetKey]
      if (to) a.targetKey = to
      else notes.push(`[유지] ${c.name}: 옛 조직(${a.targetKey}) 팀 보정 ${a.value ?? '없음'} — 그 조직이었던 대상자 ${c.targets.filter((t) => t.legacyUnitId === a.targetKey).length}명에게 그대로 적용(최종 점수 변동 없음). 새 팀 기준으로 바꾸려면 결과 화면에서 팀 보정을 다시 입력`)
    }
  }
  return notes
}
