// 문항 적용 범위·문항 생성·단계 반영 비율 검증·문항 CSV 가져오기.
import type { AppState, Assignment, Cycle, Direction, EvaluatorRule, JobType, Option, Question, QuestionType, Section, Template } from './types'

// ── 적용 범위 ───────────────────────────────────────
/** 응답 상황. teamId·positionId = 평가받는 대상자의 팀·직급 (D-082) */
export interface QCtx { direction: Direction; rule?: EvaluatorRule; jobType?: JobType; isLead?: boolean; teamId?: string; positionId?: string }

export const RULE_TEXT: Record<EvaluatorRule, string> = { self: '자기평가', upward: '상향평가', teamLead: '팀장평가', executive: '임원평가' }
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
export const BASIC_TYPES: QuestionType[] = ['long', 'single', 'ox', 'scale5'] // D-230: 주관식은 하나(여러 줄 입력)
export const TYPE_TEXT: Record<QuestionType, string> = {
  short: '주관식', long: '주관식', single: '단일선택 객관식', ox: '예/아니오(O/X)', scale5: '5점 척도', grade: '등급 선택',
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
  if (!isChoice(q.type) && q.purpose === 'score' && !(typeof q.points === 'number' && q.points > 0)) e.push('주관식을 점수에 반영하려면 배점을 입력하세요(관리자가 채점).')
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

// ── 문항 일괄 업로드 (엑셀 .xlsx / CSV, D-118 — 조직 관리 명단 업로드와 같은 흐름) ─────────────
// 파일 → 표(첫 번째로 비어 있지 않은 행 = 머리글, 열 이름으로 찾아 순서 무관) → 행마다 검증 → 오류가 하나라도 있으면 아무것도 넣지 않음
export const Q_COLUMNS = ['영역', '질문', '유형', '필수', '선택지', '선택지점수', '적용평가', '배점', '영역배점', '도움말'] as const
/** 꼭 있어야 하는 열은 질문 하나(D-120). 영역이 없으면 '미분류', 유형이 없으면 선택지가 있으면 단일선택·없으면 긴 서술형 — 문항 관리에서 나중에 고침 */
export const Q_REQUIRED = ['질문'] as const
export const Q_DEFAULT_SECTION = '미분류'
/** 열 이름 별칭(공백 무시) → 표준 열 이름 */
const Q_HEADER_ALIAS: Record<string, string> = {
  평가영역: '영역', 평가항목: '영역', 항목: '영역', 구분: '영역', 영역명: '영역',
  문항: '질문', 문항내용: '질문', 질문내용: '질문', 평가내용: '질문', 내용: '질문',
  문항유형: '유형', 응답유형: '유형', 형식: '유형', 응답방식: '유형',
  영역배점: '영역배점', 영역점수: '영역배점',
  필수여부: '필수', 보기: '선택지', 선택항목: '선택지', 점수: '선택지점수', 적용: '적용평가', 평가유형: '적용평가', 문항배점: '배점', 설명: '도움말', 안내: '도움말',
}
export const Q_MAX_ROWS = 500

const TYPE_ALIAS: Record<string, QuestionType> = {
  '짧은 주관식': 'long', 주관식: 'long', 단답형: 'long', '긴 서술형': 'long', 서술형: 'long', // D-230: 모두 주관식 하나로
  '단일선택': 'single', '단일선택 객관식': 'single', 객관식: 'single',
  'O/X': 'ox', OX: 'ox', '예/아니오': 'ox', '예/아니오(O/X)': 'ox', '5점 척도': 'scale5', '5점척도': 'scale5', 척도: 'scale5',
  등급: 'grade', '등급 선택': 'grade',
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

export interface QRow { line: number; section: string; question: Question | null; errors: string[]; /** 막지 않는 안내(기본값으로 채운 영역·유형) */ notes?: string[]; /** 영역 배점·설명(D-123: 구분·배점·평가내용 표) */ sectionPoints?: number | null; sectionDesc?: string }
export interface QUploadResult { headerError: string | null; ignored: string[]; rows: QRow[]; /** 표 전체 안내(합계 확인 등) */ notes?: string[] }

/** CSV 글자(붙여넣기·이전 호환) → 표 → 검증 */
export function parseQuestionCsv(text: string, defaultRules?: EvaluatorRule[]): QUploadResult {
  return parseQuestionTable(text.replace(/^﻿/, '').split(/\r?\n/).map(splitCsvLine), defaultRules)
}

const hnorm = (h: string) => { const k = h.replace(/^﻿/, '').replace(/[\s*]/g, ''); return Q_HEADER_ALIAS[k] ?? k }
/** 표(엑셀 시트·CSV) → 문항 행. defaultRules = 적용평가 칸이 비었을 때(없으면 자기평가) — 팀원→팀장 평가표면 팀원→팀장평가 */
export function parseQuestionTable(table: string[][], defaultRules: EvaluatorRule[] = ['self'], lineOffset = 0): QUploadResult {
  const hi = table.findIndex((r) => r.some((c) => (c ?? '').trim()))
  if (hi < 0) return { headerError: '빈 파일입니다.', ignored: [], rows: [] }
  const header = table[hi].map((h) => hnorm(h ?? ''))
  const dup = (Q_COLUMNS as readonly string[]).find((k) => header.filter((h) => h === k).length > 1)
  if (dup) return { headerError: `'${dup}' 열이 두 번 이상 있습니다.`, ignored: [], rows: [] }
  const miss = Q_REQUIRED.filter((c) => !header.includes(c))
  if (miss.length) return { headerError: `필수 열이 없습니다: ${miss.join(', ')}`, ignored: [], rows: [] }
  const ignored = table[hi].map((h) => (h ?? '').trim()).filter((h, i) => h && !(Q_COLUMNS as readonly string[]).includes(header[i]))
  // 행 번호 = 시트의 실제 행(표가 여러 개면 그 표의 시작 위치만큼)
  const body = table.slice(hi + 1).map((c, i) => ({ c, line: lineOffset + hi + i + 2 })).filter(({ c }) => c.some((x) => (x ?? '').trim()))
  if (body.length > Q_MAX_ROWS) return { headerError: `한 번에 ${Q_MAX_ROWS}행까지 올릴 수 있습니다.`, ignored, rows: [] }
  const col = (cells: string[], k: string) => (header.includes(k) ? (cells[header.indexOf(k)] ?? '').replace(/\s*\n\s*/g, ' ').trim() : '')
  // D-123: '합계' 줄은 문항이 아님 — 영역 배점 합과 맞는지만 확인
  const TOTAL = ['합계', '계', '총계', '소계', '총점']
  const isTotal = (c: string[]) => TOTAL.includes(col(c, '영역').replace(/\s/g, '')) && !col(c, '질문')
  const totals = body.filter(({ c }) => isTotal(c)).map(({ c }) => Number(col(c, '배점') || col(c, '영역배점')))
  const items = body.filter(({ c }) => !isTotal(c))
  // 영역 표(구분·배점·평가내용 — 영역마다 한 줄): 배점 = 영역 배점, 평가내용 = 그 영역의 5점 척도 문항·영역 설명(팀장 자기평가표와 같은 구조)
  const secNames = items.map(({ c }) => col(c, '영역')).filter(Boolean)
  const areaMode = header.includes('배점') && !header.includes('영역배점') && secNames.length === items.length && new Set(secNames).size === secNames.length && items.length > 0
  const rows = items.map(({ c, line }): QRow => {
    const errors: string[] = []
    const notes: string[] = []
    const title = col(c, '질문')
    if (!title) errors.push('질문: 비어 있음')
    let section = col(c, '영역')
    if (!section) { section = Q_DEFAULT_SECTION; notes.push(`영역 없음 → '${Q_DEFAULT_SECTION}'`) }
    const typeRaw = col(c, '유형')
    const scored = !!(col(c, '배점') || col(c, '영역배점'))
    let type: QuestionType | undefined = TYPE_ALIAS[typeRaw.replace(/\s+/g, ' ')] ?? TYPE_ALIAS[typeRaw.replace(/\s/g, '')]
    if (!type) {
      // 배점이 있으면 점수 문항(5점 척도), 선택지가 2개 이상이면 단일선택, 그 외 긴 서술형
      type = col(c, '선택지').split('|').filter((x) => x.trim()).length >= 2 ? 'single' : scored ? 'scale5' : 'long'
      notes.push(typeRaw ? `유형 '${typeRaw}' 모름 → ${TYPE_TEXT[type]}` : `유형 없음 → ${TYPE_TEXT[type]}`)
    }
    const reqRaw = col(c, '필수')
    const required = reqRaw === '' ? true : ['Y', 'y', '예', '필수', 'O'].includes(reqRaw) ? true : ['N', 'n', '아니오', '선택', 'X'].includes(reqRaw) ? false : null
    if (required === null) errors.push(`필수: '${reqRaw}'는 Y/N이 아님`)
    const ruleRaw = col(c, '적용평가')
    const rules = ruleRaw ? ruleRaw.split('|').map((x) => RULE_ALIAS[x.trim().replace(/\s/g, '')]) : [...defaultRules]
    if (rules.some((r) => !r)) errors.push(`적용평가: '${ruleRaw}' — 자기|팀원→팀장|팀장|임원 중에서 쓰세요`)
    const ptsRaw = col(c, '배점')
    const pts = ptsRaw === '' ? null : Number(ptsRaw)
    if (pts !== null && !(Number.isFinite(pts) && pts >= 0)) errors.push(`배점: '${ptsRaw}'은(는) 0 이상 숫자가 아님`)
    const secPtsRaw = areaMode ? ptsRaw : col(c, '영역배점')
    const secPts = secPtsRaw === '' ? null : Number(secPtsRaw)
    if (!areaMode && secPts !== null && !(Number.isFinite(secPts) && secPts >= 0)) errors.push(`영역배점: '${secPtsRaw}'은(는) 0 이상 숫자가 아님`)
    if (areaMode && secPts !== null && Number.isFinite(secPts)) notes.push(`영역 배점 ${secPts}점`)
    if (errors.length) return { line, section, question: null, errors, notes }
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
    } else if (optRaw && isChoice(type)) {
      // 5점 척도·O/X·등급도 선택지 글자를 바꿔 올릴 수 있음(개수는 기본과 같게)
      const labels = optRaw.split('|').map((x) => x.trim()).filter(Boolean)
      if (labels.length !== q.options.length) errors.push(`선택지: ${TYPE_TEXT[type]}는 선택지 ${q.options.length}개(| 로 구분)`)
      else q.options = q.options.map((o, k) => ({ ...o, label: labels[k] }))
    }
    if (pts !== null && !areaMode) q.points = pts // 영역 표에서는 배점 = 영역 배점(문항 배점 아님)
    if (type === 'scale5' || type === 'grade') q.purpose = 'score'
    if (scoreRaw) {
      if (!isChoice(type)) errors.push('선택지점수: 주관식은 점수에 반영할 수 없음')
      else {
        const vals = scoreRaw.split('|').map((x) => Number(x.trim()))
        if (vals.length !== q.options.length || vals.some((v) => Number.isNaN(v))) errors.push(`선택지점수: 선택지 ${q.options.length}개와 개수가 맞지 않거나 숫자가 아님`)
        else { q.options.forEach((o, k) => (o.value = vals[k])); q.purpose = 'score' }
      }
    } else if (type === 'grade') {
      q.purpose = 'score' // 등급은 평가표의 등급 환산(A=5…)으로 점수(D-103)
    } else if (type !== 'scale5') {
      q.purpose = 'info'
    }
    const extra = secPts !== null && Number.isFinite(secPts) && secPts >= 0 ? { sectionPoints: secPts, ...(areaMode ? { sectionDesc: title } : {}) } : {}
    return { line, section, question: errors.length ? null : q, errors, notes, ...extra }
  })
  const tnotes: string[] = []
  if (totals.length) {
    const sum = rows.reduce((a, r) => a + (r.sectionPoints ?? r.question?.points ?? 0), 0)
    const tot = totals[totals.length - 1]
    tnotes.push(Number.isFinite(tot) && Math.abs(tot - sum) < 0.001 ? `합계 줄 ${tot}점 = 배점 합 ${+sum.toFixed(2)}점(합계 줄은 문항으로 넣지 않음)` : `합계 줄 ${tot}점과 배점 합 ${+sum.toFixed(2)}점이 다릅니다(합계 줄은 문항으로 넣지 않음)`)
  }
  if (areaMode) tnotes.push('구분·배점·평가내용 표: 한 줄 = 영역 하나(배점 = 영역 배점, 평가내용 = 그 영역의 문항·영역 설명)')
  return { headerError: null, ignored, rows, notes: tnotes }
}

/**
 * 한 시트에 표가 여러 개(예: '팀장 본인평가 예시'·'임원 및 팀장 상향평가 예시')면 머리글 행마다 나눈다(D-123).
 * 머리글 = 질문(평가내용·문항) 열이 있는 행. 제목 = 머리글 바로 위의 글자 한 칸짜리 행. 머리글이 하나면 표 하나
 */
export function questionBlocks(table: string[][]): { title: string; table: string[][]; offset: number }[] {
  const isHead = (r: string[]) => { const h = r.map((x) => hnorm(x ?? '')); return h.includes('질문') && h.filter((x) => (Q_COLUMNS as readonly string[]).includes(x)).length >= 2 }
  const heads = table.map((r, i) => (isHead(r) ? i : -1)).filter((i) => i >= 0)
  if (heads.length <= 1) return [{ title: '', table, offset: 0 }]
  return heads.map((h, k) => {
    const end = heads[k + 1] ?? table.length
    let title = ''
    for (let i = h - 1; i >= (k ? heads[k - 1] + 1 : 0); i--) {
      const cells = table[i].map((x) => (x ?? '').trim()).filter(Boolean)
      if (cells.length === 1) { title = cells[0]; break }
      if (cells.length > 1) break
    }
    // 다음 표의 제목 행은 이 표에서 뺀다
    let stop = end
    if (k + 1 < heads.length) for (let i = end - 1; i > h; i--) { const n = table[i].filter((x) => (x ?? '').trim()).length; if (n === 0) continue; if (n === 1) stop = i; break }
    return { title: title || `표 ${k + 1}`, table: table.slice(h, stop), offset: h }
  })
}

/** 명단 업로드와 같은 규칙: 오류 행이 하나라도 있으면 아무것도 넣지 않음(부분 등록 없음) */
export const canImportQuestions = (r: QUploadResult) => !r.headerError && r.rows.length > 0 && r.rows.every((x) => !!x.question)

/** 가져온 문항을 문항 세트에 추가(같은 이름의 영역 뒤, 없으면 새 영역). 교체는 호출 측에서 응답 없음 확인 후 sections를 비우고 호출 */
export function appendImported(t: Template, rows: QRow[]) {
  for (const r of rows) {
    if (!r.question) continue
    let sec = t.sections.find((x) => x.title === r.section)
    if (!sec) { sec = newSection(r.section); t.sections.push(sec) }
    if (typeof r.sectionPoints === 'number') sec.points = r.sectionPoints // 파일에 영역 배점이 있으면 그 값(D-123)
    if (r.sectionDesc && !sec.desc) sec.desc = r.sectionDesc
    sec.questions.push(r.question)
  }
}
