// v36 → v37 (D-255): 문항마다 '적용 평가'를 고르지 않게 — 평가표 하나가 여러 평가(자기·팀장·임원)를 맡으면서
// 문항마다 보이는 평가가 다르면, 보이는 문항 묶음이 같은 평가끼리 평가표를 나눈다(예: 공통평가표 → 자기평가표·팀장평가표·임원평가표).
// - 문항 ID·영역 ID는 그대로 복사 → 이미 들어온 응답·관리자 채점이 그대로 이어지고 점수도 같다(나누기 전에도 그 평가에 보이던 문항만 계산)
// - 배정은 그 평가에 맞는 평가표로 옮긴다(응답이 있어도 — 같은 문항 ID라 답은 그대로 읽힘)
// - 화살표 방식(D-211) 준비·진행 회차만. 마감·확정 회차는 그대로. 반복 안전(이미 나뉜 평가표는 다시 나누지 않음)
import type { AppState, Cycle, EvaluatorRule, ID, SlotKey, Template } from './types'
import { directionsFromRules, rulesOf } from './questions'
import { assignmentCtx, liveVersions, SLOTS, slotMode, slotScope } from './versions'

const RULE_NAME: Record<EvaluatorRule, string> = { self: '자기평가', teamLead: '팀장평가', executive: '임원평가', upward: '상향평가' }
const isCommonName = (n: string) => /^공통\s*평가표$/.test(n.trim())

/** 이 회차의 평가표 중 문항마다 보이는 평가가 다른 것을 나눔. 나눈 평가표 수 */
export function splitByRule(c: Cycle): number {
  if (!c.versions?.length || !slotMode(c) || (c.status !== '준비' && c.status !== '진행')) return 0
  let n = 0
  for (const v of liveVersions(c)) {
    const tpl = c.templates[v.templateId]
    const slots = v.scope.slots ?? []
    if (!tpl || !slots.length) continue
    const rules = [...new Set(SLOTS.filter((x) => slots.includes(x.key)).map((x) => x.rule))]
    // 평가마다 보이는 문항(사용 중지 문항도 그 평가용이면 함께 — 기록 보존)
    const qsOf = (r: EvaluatorRule) => tpl.sections.flatMap((sec) => sec.questions.filter((q) => rulesOf(q).includes(r)).map((q) => q.id)).join('|')
    const groups: { rules: EvaluatorRule[]; key: string }[] = []
    for (const r of rules) {
      const key = qsOf(r)
      const g = groups.find((x) => x.key === key)
      if (g) g.rules.push(r); else groups.push({ rules: [r], key })
    }
    if (groups.length < 2) {
      // 이미 한 묶음 — 문항의 적용 평가를 평가표에 맞춰 둔다(화면에서 고르지 않으므로)
      for (const sec of tpl.sections) for (const q of sec.questions) if (rulesOf(q).some((r) => rules.includes(r)) && rulesOf(q).join() !== rules.join()) { q.rules = [...rules]; q.directions = directionsFromRules(q.rules) }
      continue
    }
    const used = new Set(Object.values(c.templates).map((t) => t.name).concat((c.versions ?? []).map((x) => x.name)))
    const nameFor = (g: { rules: EvaluatorRule[] }) => {
      // 자기평가만이면 '자기평가(사원)'처럼 누가 쓰는지(기존 '자기평가(팀장)'과 같은 모양), 그 밖엔 '팀장평가표'·'임원평가표'
      const all = [...new Set(SLOTS.filter((x) => slots.includes(x.key) && g.rules.includes(x.rule)).map((x) => x.tier))]
      const tiers = all.length > 1 ? all.filter((t) => t !== '임원') : all // 임원 자기평가는 보통 꺼져 있어 이름에서 뺌
      const label = g.rules.length === 1 && g.rules[0] === 'self' ? `자기평가(${tiers.join('·')})` : g.rules.map((r) => RULE_NAME[r].replace('평가', '')).join('·') + '평가표'
      let name = isCommonName(v.name) ? label : `${v.name} (${label})`
      for (let k = 2; used.has(name); k++) name = `${isCommonName(v.name) ? label : `${v.name} (${label})`} ${k}`
      used.add(name)
      return name
    }
    const made: { tid: ID; rules: EvaluatorRule[]; name: string }[] = []
    groups.forEach((g, gi) => {
      const ids = new Set(g.key.split('|').filter(Boolean))
      const t: Template = structuredClone(tpl)
      t.sections = t.sections.map((sec) => ({ ...sec, questions: sec.questions.filter((q) => ids.has(q.id)) })).filter((sec) => sec.questions.length > 0)
      for (const sec of t.sections) for (const q of sec.questions) { q.rules = [...g.rules]; q.directions = directionsFromRules(q.rules) }
      // 처음 묶음(자기평가가 있으면 그것)이 원래 평가표 ID를 이어받음 — 나머지는 새 ID
      const tid = gi === 0 ? tpl.id : `${tpl.id}-${g.rules.join('-')}`
      t.id = tid
      const name = nameFor(g)
      t.name = name
      c.templates[tid] = t
      made.push({ tid, rules: g.rules, name })
    })
    const slotsOf = (rs: EvaluatorRule[]): SlotKey[] => slots.filter((k) => rs.includes(SLOTS.find((x) => x.key === k)!.rule))
    const at = c.versions.indexOf(v)
    c.versions.splice(at, 1, ...made.map((m, i) => ({ templateId: m.tid, name: m.name, scope: slotScope(slotsOf(m.rules)), ...(i === 0 && v.pending ? { pending: v.pending } : {}) })))
    for (const a of c.assignments) {
      if (a.templateId !== tpl.id) continue
      const rule = assignmentCtx(c, a).rule
      const m = made.find((x) => x.rules.includes(rule))
      if (m) a.templateId = m.tid
    }
    n++
  }
  return n
}

export function splitByRuleV37(s: AppState): string[] {
  const notes: string[] = []
  for (const c of s.cycles) { const n = splitByRule(c); if (n) notes.push(`${c.name}: 평가마다 문항이 다른 평가표 ${n}개를 평가별 평가표로 나눔(문항·응답 그대로)`) }
  return notes
}
