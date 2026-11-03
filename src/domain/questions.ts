// 문항 적용 범위·문항 생성·단계 반영 비율 검증·문항 CSV 가져오기.
import type { AppState, Assignment, Cycle, Direction, EvaluatorRule, JobType, Option, Question, QuestionType, Section, Template } from './types'

// ── 적용 범위 ───────────────────────────────────────
/** 응답 상황. teamId·positionId = 평가받는 대상자의 팀·직급 (D-082) */
export interface QCtx { direction: Direction; rule?: EvaluatorRule; jobType?: JobType; isLead?: boolean; teamId?: string; positionId?: string }

export const RULE_TEXT: Record<EvaluatorRule, string> = { self: '자기평가', upward: '팀원→팀장평가', teamLead: '팀장평가', executive: '임원평가' }
export const RULES: EvaluatorRule[] = ['self', 'upward', 'teamLead', 'executive']

/** 이 문항을 이 응답 상황에서 보여주는가 */
export function applies(q: Question, ctx: QCtx): boolean {
  if (!q.active || !q.directions.includes(ctx.direction)) return false
  if (q.rules?.length && ctx.rule && !q.rules.includes(ctx.rule)) return false
  if (q.jobs?.length && ctx.jobType && !q.jobs.includes(ctx.jobType)) return false
  if (q.targetRoles?.length && ctx.isLead !== undefined && !q.targetRoles.includes(ctx.isLead ? 'lead' : 'member')) return false
  // 문항별 추가 제한(선택): 대상자 팀·직급. 버전 범위와 함께 두 조건을 모두 만족해야 보임 (D-082)
  if (q.teams?.length && ctx.teamId !== undefined && !q.teams.includes(ctx.teamId)) return false
  if (q.positions?.length && ctx.positionId !== undefined && !q.positions.includes(ctx.positionId)) return false
  return true
}

/** 문항의 적용 평가(자기·팀장·임원). rules가 없던 이전 데이터는 directions에서 유도 */
export function rulesOf(q: Question): EvaluatorRule[] {
  if (q.rules?.length) return q.rules
  const r: EvaluatorRule[] = []
  if (q.directions.includes('self')) r.push('self')
  if (q.directions.includes('up')) r.push('upward')
  if (q.directions.includes('down')) r.push('teamLead', 'executive')
  return r
}

export function directionsFromRules(rules: EvaluatorRule[]): Direction[] {
  const d: Direction[] = []
  if (rules.includes('self')) d.push('self')
  if (rules.includes('upward')) d.push('up')
  if (rules.includes('teamLead') || rules.includes('executive')) d.push('down')
  return d
}

/** 배정 → 응답 상황(평가 방향·평가 유형·대상 직무·대상 팀장 여부) */
export function ctxFor(cycle: Cycle, a: Assignment): QCtx {
  const t = cycle.targets.find((x) => x.employeeId === a.targetId)
  const path = t?.isTeamLead ? cycle.path.lead : cycle.path.member
  const stage = path.find((s) => s.order === a.stageOrder)
  return { direction: a.direction, rule: a.direction === 'self' ? 'self' : a.direction === 'up' ? 'upward' : stage?.rule, jobType: t?.jobType, isLead: t?.isTeamLead, teamId: t?.departmentId || undefined, positionId: t?.positionId }
}

// ── 문항 만들기 ─────────────────────────────────────
export const BASIC_TYPES: QuestionType[] = ['short', 'long', 'single', 'ox', 'scale5']
export const TYPE_TEXT: Record<QuestionType, string> = {
  short: '짧은 주관식', long: '긴 서술형', single: '단일선택 객관식', ox: '예/아니오(O/X)', scale5: '5점 척도', grade: '등급 선택',
}
export const isChoice = (t: QuestionType) => t === 'single' || t === 'ox' || t === 'scale5' || t === 'grade'

const uid = (p: string) => `${p}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`

export function defaultOptions(type: QuestionType, qid: string): Option[] {
  const mk = (items: [string, number | null][]) => items.map(([label, value], i) => ({ id: `${qid}-o${i}-${Math.random().toString(36).slice(2, 5)}`, label, value }))
  if (type === 'ox') return mk([['예', null], ['아니오', null]])
  if (type === 'scale5') return mk([['매우 그렇다', 5], ['그렇다', 4], ['보통이다', 3], ['그렇지 않다', 2], ['전혀 그렇지 않다', 1]])
  if (type === 'single') return mk([['선택지 1', null], ['선택지 2', null]])
  if (type === 'grade') return mk([['A', null], ['B', null], ['C', null], ['D', null]])
  return []
}

export function newQuestion(type: QuestionType): Question {
  const id = uid('q')
  return {
    id, type, title: '', help: '', required: true,
    purpose: type === 'scale5' ? 'score' : 'info',
    maxPoints: null, options: defaultOptions(type, id),
    directions: ['self'], rules: ['self'], active: true,
  }
}

export function newSection(title: string): Section {
  return { id: uid('sec'), title, area: null, questions: [] }
}

/** keepTitle: 평가표 버전 복제(D-082)는 제목을 그대로, 문항 하나 복제는 "(복사)"를 붙인다 */
export function cloneQuestion(q: Question, keepTitle = false): Question {
  const c = structuredClone(q)
  c.id = uid('q')
  c.options = c.options.map((o, i) => ({ ...o, id: `${c.id}-o${i}` }))
  // 번역도 함께 복제 — 선택지 번역은 새 선택지 ID로 옮겨 연결 (D-075)
  const tr = q.i18n?.ru
  if (tr) {
    const map = Object.fromEntries(q.options.map((o, i) => [o.id, c.options[i].id]))
    const remap = (r?: Record<string, string>) => (r ? Object.fromEntries(Object.entries(r).filter(([k]) => map[k]).map(([k, v]) => [map[k], v])) : undefined)
    c.i18n = { ru: { ...tr, options: remap(tr.options), basis: tr.basis ? { ...tr.basis, options: remap(tr.basis.options) ?? {} } : undefined } }
  }
  if (keepTitle) return c
  c.title = `${q.title} (복사)`
  // "(복사)" 꼬리말은 뜻이 바뀐 게 아니므로 번역 재확인 대상으로 만들지 않음
  if (c.i18n?.ru?.basis && c.i18n.ru.basis.title === q.title) c.i18n.ru.basis.title = c.title
  return c
}

/** 문항 저장 전 검증. 오류가 있으면 문구 목록 */
export function validateQuestion(q: Question): string[] {
  const e: string[] = []
  if (!q.title.trim()) e.push('질문 제목을 입력하세요.')
  if (rulesOf(q).length === 0) e.push('적용 평가를 하나 이상 고르세요.')
  if (isChoice(q.type)) {
    if (q.options.length < 2) e.push('선택지는 2개 이상이어야 합니다.')
    if (q.options.some((o) => !o.label.trim())) e.push('비어 있는 선택지가 있습니다.')
    if (q.purpose === 'score' && q.type !== 'grade' && q.options.some((o) => o.value === null || Number.isNaN(o.value)))
      e.push('점수에 반영하려면 모든 선택지에 점수를 입력하세요. (빈 점수를 0점으로 처리하지 않습니다)')
  }
  // D-103: 서술형은 배점을 입력했을 때만 점수 반영(관리자 채점). 자동 점수화하지 않음
  if (!isChoice(q.type) && q.purpose === 'score' && !(typeof q.points === 'number' && q.points > 0)) e.push('서술형을 점수에 반영하려면 배점을 입력하세요(관리자가 채점).')
  if (q.points !== undefined && q.points !== null && !(q.points >= 0 && Number.isFinite(q.points))) e.push('문항 배점은 0 이상 숫자로 입력하세요.')
  return e
}

/** 이 회차에서 이 문항에 답한 응답 수 (임시저장 포함) */
export function answeredCount(s: AppState, cycle: Cycle, qid: string): number {
  return cycle.assignments.filter((a) => {
    const v = s.responses[a.id]?.answers[qid]
    return v !== undefined && v !== null && String(v).trim() !== ''
  }).length
}

export function cycleHasResponses(s: AppState, cycle: Cycle): boolean {
  return cycle.assignments.some((a) => s.responses[a.id])
}

/** 회차가 쓰는 문항 세트 id (관리직·생산직이 같은 세트를 쓰면 1개) */
export function questionSetIds(cycle: Cycle): string[] {
  return [...new Set([cycle.templateByJob.office, cycle.templateByJob.production])].filter((id) => cycle.templates[id])
}

// ── 단계 반영 비율 ───────────────────────────────────
export function weightErrors(stages: { order: number; label: string }[], w: Record<number, number | null>): string[] {
  const e: string[] = []
  for (const st of stages) {
    const v = w[st.order]
    if (v === null || v === undefined || Number.isNaN(v)) e.push(`${st.order}단계(${st.label}) 비율을 입력하세요.`)
    else if (v < 0 || v > 100) e.push(`${st.order}단계(${st.label}) 비율은 0~100 사이여야 합니다.`)
  }
  // D-103: 적용되는 단계의 설정 비율을 합계 100%로 환산해 계산 — 입력 합계가 100이 아니어도 된다(예: 팀장 경로 20·40). 모두 0이면 계산할 수 없음
  if (e.length === 0 && stages.length > 0 && stages.every((st) => (w[st.order] as number) === 0)) e.push('반영 비율이 모두 0%입니다. 하나 이상 입력하세요.')
  return e
}

export function weightSum(stages: { order: number }[], w: Record<number, number | null>): number | null {
  if (stages.some((st) => typeof w[st.order] !== 'number')) return null
  return +stages.reduce((a, st) => a + (w[st.order] as number), 0).toFixed(2)
}

// ── 문항 CSV 가져오기 ─────────────────────────────────
export const Q_COLUMNS = ['영역', '질문', '유형', '필수', '선택지', '선택지점수', '적용평가', '도움말'] as const
export const Q_REQUIRED = ['영역', '질문', '유형'] as const

const TYPE_ALIAS: Record<string, QuestionType> = {
  '짧은 주관식': 'short', 주관식: 'short', '긴 서술형': 'long', 서술형: 'long',
  '단일선택': 'single', '단일선택 객관식': 'single', 객관식: 'single',
  'O/X': 'ox', OX: 'ox', '예/아니오': 'ox', '5점 척도': 'scale5', '5점척도': 'scale5',
}
const RULE_ALIAS: Record<string, EvaluatorRule> = { 자기: 'self', 자기평가: 'self', 팀장: 'teamLead', 팀장평가: 'teamLead', 임원: 'executive', 임원평가: 'executive', '팀원→팀장': 'upward', '팀원→팀장평가': 'upward', 상향: 'upward', 상향평가: 'upward' }

/** 따옴표("…, …")를 지원하는 간단한 CSV 분해 */
export function splitCsvLine(line: string): string[] {
  const out: string[] = []
  let cur = ''
  let q = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (q) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++ } else if (ch === '"') q = false
      else cur += ch
    } else if (ch === '"') q = true
    else if (ch === ',') { out.push(cur.trim()); cur = '' } else cur += ch
  }
  out.push(cur.trim())
  return out
}

export interface QRow { line: number; section: string; question: Question | null; errors: string[] }
export interface QUploadResult { headerError: string | null; ignored: string[]; rows: QRow[] }

export function parseQuestionCsv(text: string): QUploadResult {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim())
  const header = splitCsvLine(lines[0] ?? '')
  const miss = Q_REQUIRED.filter((c) => !header.includes(c))
  if (miss.length) return { headerError: `필수 열이 없습니다: ${miss.join(', ')}`, ignored: [], rows: [] }
  const ignored = header.filter((h) => h && !(Q_COLUMNS as readonly string[]).includes(h))
  const col = (cells: string[], k: string) => (header.includes(k) ? cells[header.indexOf(k)] ?? '' : '')
  const rows = lines.slice(1).map((l, i): QRow => {
    const c = splitCsvLine(l)
    const errors: string[] = []
    const section = col(c, '영역')
    const title = col(c, '질문')
    const type = TYPE_ALIAS[col(c, '유형')]
    if (!section) errors.push('영역: 비어 있음')
    if (!title) errors.push('질문: 비어 있음')
    if (!type) errors.push(`유형: '${col(c, '유형')}'은(는) 지원하지 않는 유형`)
    const reqRaw = col(c, '필수')
    const required = reqRaw === '' ? true : ['Y', 'y', '예', '필수', 'O'].includes(reqRaw) ? true : ['N', 'n', '아니오', '선택', 'X'].includes(reqRaw) ? false : null
    if (required === null) errors.push(`필수: '${reqRaw}'는 Y/N이 아님`)
    const ruleRaw = col(c, '적용평가')
    const rules = ruleRaw ? ruleRaw.split('|').map((x) => RULE_ALIAS[x.trim()]) : (['self'] as EvaluatorRule[])
    if (rules.some((r) => !r)) errors.push(`적용평가: '${ruleRaw}' — 자기|팀장|임원 중에서 쓰세요`)
    if (errors.length || !type) return { line: i + 2, section, question: null, errors }
    const q = newQuestion(type)
    q.title = title
    q.help = col(c, '도움말')
    q.required = required as boolean
    q.rules = rules as EvaluatorRule[]
    q.directions = directionsFromRules(q.rules)
    const optRaw = col(c, '선택지')
    const scoreRaw = col(c, '선택지점수')
    if (type === 'single') {
      const labels = optRaw.split('|').map((x) => x.trim()).filter(Boolean)
      if (labels.length < 2) errors.push('선택지: 단일선택은 | 로 구분한 선택지 2개 이상 필요')
      q.options = labels.map((label, k) => ({ id: `${q.id}-o${k}`, label, value: null }))
    }
    if (scoreRaw) {
      if (!isChoice(type)) errors.push('선택지점수: 주관식·서술형은 점수에 반영할 수 없음')
      else {
        const vals = scoreRaw.split('|').map((x) => Number(x.trim()))
        if (vals.length !== q.options.length || vals.some((v) => Number.isNaN(v))) errors.push(`선택지점수: 선택지 ${q.options.length}개와 개수가 맞지 않거나 숫자가 아님`)
        else { q.options.forEach((o, k) => (o.value = vals[k])); q.purpose = 'score' }
      }
    } else if (type !== 'scale5') {
      q.purpose = 'info'
    }
    return { line: i + 2, section, question: errors.length ? null : q, errors }
  })
  return { headerError: null, ignored, rows }
}

/** 가져온 문항을 문항 세트에 추가(같은 이름의 영역 뒤, 없으면 새 영역). 교체는 호출 측에서 응답 없음 확인 후 sections를 비우고 호출 */
export function appendImported(t: Template, rows: QRow[]) {
  for (const r of rows) {
    if (!r.question) continue
    let sec = t.sections.find((x) => x.title === r.section)
    if (!sec) { sec = newSection(r.section); t.sections.push(sec) }
    sec.questions.push(r.question)
  }
}
