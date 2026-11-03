// 직원 명단 업로드: 파일 읽기(.xlsx/.csv) → 표 → 검증. 등록은 화면에서 사용자가 확인한 뒤에만 한다.
// 회사·언어·재직 상태·평가 제외 여부는 받지 않는다(D-051). 사번은 글자로 다뤄 앞자리 0을 보존한다.
// 열 순서는 직원 목록과 같게 팀·직급·이름·직무·사번(D-104) — 읽을 때는 머리글 이름으로 찾으므로 순서가 달라도 된다.
// 그 밖의 열: 머리글이 조직 관리의 분류 기준 이름과 같으면 그 값으로 함께 등록(선택형은 선택지 이름만), 아니면 쓰지 않는 열로 표시만.
import type { AppState, CustomField, Employee, EvalClass, JobType, Team } from './types'
import { activeJobs, positionById, positionsOf } from './catalog'
import { readXlsx, templateXlsx, type Sheet } from './xlsx'

export const MAX_FILE_BYTES = 5 * 1024 * 1024
export const MAX_ROWS = 2000

export type RosterKey = 'empNo' | 'name' | 'team' | 'position' | 'job'
export const ROSTER_FIELDS: { key: RosterKey; label: string; aliases: string[] }[] = [
  { key: 'team', label: '팀', aliases: ['팀', '팀명', '소속팀', 'team'] },
  { key: 'position', label: '직급', aliases: ['직급', 'position'] },
  { key: 'name', label: '이름', aliases: ['이름', '성명', '직원명', 'name'] },
  { key: 'job', label: '직무', aliases: ['직무', '직군', 'job'] },
  { key: 'empNo', label: '사번', aliases: ['사번', '사원번호', '직원번호', 'empno', 'emp_no', 'employeeno'] },
]
export const ROSTER_HEADER = ROSTER_FIELDS.map((f) => f.label)
const LABEL = Object.fromEntries(ROSTER_FIELDS.map((f) => [f.key, f.label])) as Record<RosterKey, string>

// ── 파일 읽기 ─────────────────────────────────────────
/** CSV 글자 해석: UTF-8(BOM 포함) 우선, UTF-8이 아니면 한글 윈도우 엑셀 기본값(EUC-KR/CP949) */
export function decodeText(b: Uint8Array): string {
  if (b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) return new TextDecoder('utf-8').decode(b.subarray(3))
  if (b[0] === 0xff && b[1] === 0xfe) return new TextDecoder('utf-16le').decode(b.subarray(2))
  if (b[0] === 0xfe && b[1] === 0xff) return new TextDecoder('utf-16be').decode(b.subarray(2))
  try { return new TextDecoder('utf-8', { fatal: true }).decode(b) } catch { return new TextDecoder('euc-kr').decode(b) }
}

/** RFC 4180 CSV: 따옴표 안의 쉼표·줄바꿈·"" 처리 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let q = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (q) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++ } else q = false
      } else cell += ch
    } else if (ch === '"' && cell === '') q = true
    else if (ch === ',') { row.push(cell); cell = '' }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(cell); rows.push(row); row = []; cell = ''
    } else cell += ch
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row) }
  return rows
}

export type ReadResult = { ok: true; sheets: Sheet[] } | { ok: false; error: string }

/** 선택한 파일 → 시트 목록. 확장자로 형식을 정하고 내용도 확인한다 */
export async function readRosterFile(name: string, bytes: Uint8Array): Promise<ReadResult> {
  const ext = name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? ''
  if (bytes.length > MAX_FILE_BYTES) return { ok: false, error: '파일이 너무 큽니다 (5MB까지).' }
  try {
    if (ext === 'csv') return { ok: true, sheets: [{ name, rows: parseCsv(decodeText(bytes).replace(/^﻿/, '')) }] }
    if (ext === 'xlsx') return { ok: true, sheets: await readXlsx(bytes) }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : '파일을 읽을 수 없습니다.' }
  }
  return { ok: false, error: '엑셀(.xlsx) 또는 CSV(.csv) 파일만 올릴 수 있습니다.' }
}

// ── 검증 ─────────────────────────────────────────────
export interface CellError { col: string; msg: string }
export interface RosterRow {
  line: number // 파일의 행 번호 (머리글 = 1행 기준)
  v: Record<RosterKey, string>
  errors: CellError[]
  skip: boolean // 기존 사번과 겹쳐 건너뜀 (사용자가 "건너뛰기"를 고른 경우)
  existing?: string // 겹친 기존 직원 이름
  custom: Record<string, string> // 분류 기준 ID → 파일의 글자 그대로(화면 표시용)
  customIds: Record<string, string> // 분류 기준 ID → 저장할 값(텍스트 = 글자, 선택형 = 선택지 ID). 빈 칸은 넣지 않음
  teamId?: string
  jobType?: JobType
  positionId?: string
  evalClass?: EvalClass
}
export interface RosterCheck {
  error: string | null // 파일 전체 오류 (머리글 등)
  ignored: string[] // 쓰지 않는 열
  extra: CustomField[] // 분류 기준과 이름이 같아 함께 등록할 열(파일 순서)
  rows: RosterRow[]
  addable: number
  skipped: number
  errorRows: number
  existingDup: number // 기존 사번과 겹친 행 수 (처리 방식과 무관)
}

const norm = (h: string) => h.replace(/^﻿/, '').replace(/[\s*]/g, '').toLowerCase()

export type ExistingMode = 'error' | 'skip'

/** cat: 직무·직급 목록 (D-080, 없으면 기본 관리직·생산직 / 임원·팀장·사원) */
export function checkRoster(table: string[][], employees: Employee[], teams: Team[], mode: ExistingMode, cat: Pick<AppState, 'jobs' | 'positions' | 'customFields'> = {}): RosterCheck {
  const jobs = activeJobs(cat), positions = positionsOf(cat)
  const empty: RosterCheck = { error: null, ignored: [], extra: [], rows: [], addable: 0, skipped: 0, errorRows: 0, existingDup: 0 }
  const hi = table.findIndex((r) => r.some((c) => c.trim()))
  if (hi < 0) return { ...empty, error: '빈 파일입니다.' }
  const header = table[hi].map((h) => h.trim())
  const idx = {} as Record<RosterKey, number>
  for (const f of ROSTER_FIELDS) {
    const hits = header.map((h, i) => (f.aliases.includes(norm(h)) ? i : -1)).filter((i) => i >= 0)
    if (hits.length > 1) return { ...empty, error: `'${f.label}' 열이 두 번 이상 있습니다.` }
    idx[f.key] = hits[0] ?? -1
  }
  const missing = ROSTER_FIELDS.filter((f) => idx[f.key] < 0).map((f) => f.label)
  if (missing.length) return { ...empty, error: `필수 열이 없습니다: ${missing.join(', ')}` }
  const used = new Set(Object.values(idx))
  // 추가 열 → 분류 기준(이름 일치, 공백 무시)
  const cfIdx = new Map<CustomField, number>()
  for (const f of cat.customFields ?? []) {
    const hits = header.map((h, i) => (!used.has(i) && norm(h) === norm(f.name) ? i : -1)).filter((i) => i >= 0)
    if (hits.length > 1) return { ...empty, error: `'${f.name}' 열이 두 번 이상 있습니다.` }
    if (hits.length) cfIdx.set(f, hits[0])
  }
  cfIdx.forEach((i) => used.add(i))
  const extra = [...cfIdx.entries()].sort((a, b) => a[1] - b[1]).map(([f]) => f)
  const ignored = header.filter((h, i) => h && !used.has(i))

  const body = table.slice(hi + 1).map((r, i) => ({ r, line: hi + i + 2 })).filter(({ r }) => r.some((c) => (c ?? '').trim()))
  if (body.length > MAX_ROWS) return { ...empty, ignored, extra, error: `한 번에 ${MAX_ROWS.toLocaleString()}행까지 올릴 수 있습니다.` }

  const byNo = new Map<string, number[]>()
  const rows: RosterRow[] = body.map(({ r, line }) => {
    const v = Object.fromEntries(ROSTER_FIELDS.map((f) => [f.key, (r[idx[f.key]] ?? '').trim()])) as Record<RosterKey, string>
    if (v.empNo) byNo.set(v.empNo, [...(byNo.get(v.empNo) ?? []), line])
    const custom = Object.fromEntries(extra.map((f) => [f.id, (r[cfIdx.get(f)!] ?? '').trim()]))
    return { line, v, errors: [], skip: false, custom, customIds: {} }
  })
  for (const row of rows) {
    const err = (k: RosterKey, msg: string) => row.errors.push({ col: LABEL[k], msg })
    for (const f of ROSTER_FIELDS) if (!row.v[f.key]) err(f.key, '비어 있음')
    // 분류 기준 값은 선택 입력(빈 칸 = 값 없음). 선택형은 선택지 이름과 같아야 함
    for (const f of extra) {
      const text = row.custom[f.id]
      if (!text) continue
      if (f.type === 'text') { row.customIds[f.id] = text; continue }
      const o = f.options.find((x) => x.label.trim() === text)
      if (o) row.customIds[f.id] = o.id
      else row.errors.push({ col: f.name, msg: f.options.length ? `${f.options.map((x) => x.label).join('·')} 중 하나` : '선택지가 없는 항목' })
    }
    if (row.v.empNo) {
      const lines = byNo.get(row.v.empNo)!
      if (lines.length > 1) err('empNo', `파일 안에서 중복 (${lines.filter((l) => l !== row.line).join(', ')}행)`)
      const ex = employees.find((e) => e.empNo === row.v.empNo)
      if (ex) {
        row.existing = ex.name
        if (mode === 'error') err('empNo', `이미 등록된 사번 (${ex.name})`)
        else row.skip = true
      }
    }
    if (row.v.team) {
      const matched = teams.filter((t) => t.name.trim() === row.v.team)
      if (matched.length === 0) err('team', '없는 팀')
      else if (matched.length > 1) err('team', `같은 이름의 팀이 ${matched.length}개`)
      else row.teamId = matched[0].id
    }
    // 직무·직급은 조직 설정의 목록 이름 (D-080)
    if (row.v.job) {
      const j = jobs.find((x) => x.name.trim() === row.v.job)
      if (j) row.jobType = j.id
      else err('job', `${jobs.map((x) => x.name).join('·')} 중 하나`)
    }
    if (row.v.position) {
      const p = positions.find((x) => x.name.trim() === row.v.position)
      if (p) { row.positionId = p.id; row.evalClass = p.evalClass }
      else err('position', `${positions.map((x) => x.name).join('·')} 중 하나`)
    }
  }
  // 팀장: 팀마다 한 명, 팀장이 비어 있는 팀만 (기존 팀장을 조용히 바꾸지 않음)
  for (const row of rows) {
    if (row.evalClass !== '팀장' || !row.teamId || row.skip) continue
    const t = teams.find((x) => x.id === row.teamId)!
    const cur = t.leadId ? employees.find((e) => e.id === t.leadId && e.active) : undefined
    if (cur) row.errors.push({ col: LABEL.position, msg: `${t.name}에 이미 팀장(${cur.name})이 있음` })
    const same = rows.filter((r) => r !== row && !r.skip && r.evalClass === '팀장' && r.teamId === row.teamId)
    if (same.length) row.errors.push({ col: LABEL.position, msg: `같은 팀 팀장이 파일에 여러 명 (${same.map((r) => r.line).join(', ')}행)` })
  }
  // 건너뛰는 행이라도 다른 오류가 있으면 오류로 센다 (파일을 고쳐야 함)
  const errorRows = rows.filter((r) => r.errors.length > 0).length
  const skipped = rows.filter((r) => r.skip && r.errors.length === 0).length
  return {
    error: null, ignored, extra, rows, errorRows, skipped,
    addable: rows.filter((r) => !r.skip && r.errors.length === 0).length,
    existingDup: rows.filter((r) => r.existing).length,
  }
}

/** 차단 오류가 하나라도 있으면 아무것도 등록하지 않는다 (부분 등록 없음) */
export const canRegister = (c: RosterCheck) => !c.error && c.errorRows === 0 && c.addable > 0

/** 등록할 새 직원. 그 밖의 값은 직원 추가 화면의 기본값과 같다 (재직 중·평가 대상). 임원은 임원 표시·평가 대상 제외, 팀장은 등록 후 팀 연결(rosterLeads) */
export function rosterEmployees(c: RosterCheck, newId: (i: number) => string): Employee[] {
  if (!canRegister(c)) return []
  return c.rows
    .filter((r) => !r.skip)
    .map((r, i) => ({
      id: newId(i), empNo: r.v.empNo, name: r.v.name, teamId: r.teamId!, position: r.v.position, positionId: r.positionId, jobType: r.jobType!,
      isExecutive: r.evalClass === '임원', isCeo: false, active: true, evalExcluded: r.evalClass === '임원',
      ...(Object.keys(r.customIds).length ? { custom: { ...r.customIds } } : {}),
    }))
}

/** 등록한 직원 중 팀장 → 그 팀의 팀장으로 연결 (검증에서 빈 팀·한 명만 허용됨) */
export function rosterLeads(d: Pick<AppState, 'teams' | 'positions'>, added: Employee[]) {
  for (const e of added) if ((positionById(d, e.positionId)?.evalClass ?? (e.position === '팀장' ? '팀장' : '')) === '팀장') { const t = d.teams.find((x) => x.id === e.teamId); if (t && !t.leadId) t.leadId = e.id }
}

// ── 템플릿 ───────────────────────────────────────────
/** 양식 머리글 = 필수 5열 + 현재 분류 기준(선택 입력) */
export const templateHeader = (cat: Pick<AppState, 'customFields'> = {}) => [...ROSTER_HEADER, ...(cat.customFields ?? []).map((f) => f.name)]
export const templateXlsxBytes = (cat: Pick<AppState, 'customFields'> = {}) => templateXlsx('직원 명단', templateHeader(cat))
/** 엑셀에서 한글이 깨지지 않도록 UTF-8 BOM을 붙인다 */
export const templateCsvText = (cat: Pick<AppState, 'customFields'> = {}) => `﻿${templateHeader(cat).map(csvCell).join(',')}\r\n`
const csvCell = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)

// ── 기존 직원 칼럼 값 채우기 (D-136) ───────────────────
// 사번으로 재직 중인 직원을 찾아 '이미 만든 칼럼'(조직 관리 → + 칼럼 추가)의 값만 채우거나 바꾼다.
// - 칼럼은 만들지 않는다: 칼럼 이름과 다른 열은 쓰지 않는 열로 표시만
// - 팀·직급·이름·직무는 바꾸지 않는다(팀장 연결·평가 배정이 함께 바뀌므로 직원 수정 창에서) — 그 열이 있으면 '바꾸지 않는 열'로 표시
// - 빈 칸 = 그대로(지우지 않음). 선택형은 선택지 이름만. 오류가 하나라도 있으면 아무것도 바꾸지 않음
export interface FillChange { fieldId: string; field: string; before: string; after: string; value: string }
export interface FillRow { line: number; empNo: string; name: string; employeeId?: string; changes: FillChange[]; errors: CellError[] }
export interface FillCheck { error: string | null; ignored: string[]; fixed: string[]; fields: CustomField[]; rows: FillRow[]; errorRows: number; changed: number }

export function checkRosterFill(table: string[][], employees: Employee[], cat: Pick<AppState, 'customFields'>): FillCheck {
  const empty: FillCheck = { error: null, ignored: [], fixed: [], fields: [], rows: [], errorRows: 0, changed: 0 }
  const cfs = cat.customFields ?? []
  if (!cfs.length) return { ...empty, error: "만든 칼럼이 없습니다. 직원 목록에서 '+ 칼럼 추가'로 칼럼을 먼저 만드세요." }
  const hi = table.findIndex((r) => r.some((c) => (c ?? '').trim()))
  if (hi < 0) return { ...empty, error: '빈 파일입니다.' }
  const header = table[hi].map((h) => (h ?? '').trim())
  const noIdx = header.findIndex((h) => ROSTER_FIELDS.find((f) => f.key === 'empNo')!.aliases.includes(norm(h)))
  if (noIdx < 0) return { ...empty, error: '사번 열이 없습니다(사번으로 직원을 찾습니다).' }
  const fixedKeys = ROSTER_FIELDS.filter((f) => f.key !== 'empNo')
  const fixed = header.filter((h, i) => h && i !== noIdx && fixedKeys.some((f) => f.aliases.includes(norm(h))))
  const cfIdx = new Map<CustomField, number>()
  for (const f of cfs) {
    const hits = header.map((h, i) => (i !== noIdx && norm(h) === norm(f.name) ? i : -1)).filter((i) => i >= 0)
    if (hits.length > 1) return { ...empty, error: `'${f.name}' 열이 두 번 이상 있습니다.` }
    if (hits.length) cfIdx.set(f, hits[0])
  }
  const fields = [...cfIdx.entries()].sort((a, b) => a[1] - b[1]).map(([f]) => f)
  const used = new Set([noIdx, ...cfIdx.values()])
  const ignored = header.filter((h, i) => h && !used.has(i) && !fixed.includes(h))
  if (!fields.length) return { ...empty, ignored, fixed, error: `채울 칼럼 열이 없습니다. 열 이름을 만든 칼럼 이름(${cfs.map((f) => f.name).join(', ')})과 같게 쓰세요.` }
  const body = table.slice(hi + 1).map((r, i) => ({ r, line: hi + i + 2 })).filter(({ r }) => r.some((c) => (c ?? '').trim()))
  if (body.length > MAX_ROWS) return { ...empty, ignored, fixed, fields, error: `한 번에 ${MAX_ROWS.toLocaleString()}행까지 올릴 수 있습니다.` }
  const seen = new Map<string, number[]>()
  body.forEach(({ r, line }) => { const no = (r[noIdx] ?? '').trim(); if (no) seen.set(no, [...(seen.get(no) ?? []), line]) })
  const rows: FillRow[] = body.map(({ r, line }) => {
    const empNo = (r[noIdx] ?? '').trim()
    const errors: CellError[] = []
    const e = empNo ? employees.find((x) => x.active && x.empNo === empNo) : undefined
    if (!empNo) errors.push({ col: '사번', msg: '비어 있음' })
    else if (!e) errors.push({ col: '사번', msg: '재직 중인 직원 중 이 사번이 없음' })
    if (empNo && seen.get(empNo)!.length > 1) errors.push({ col: '사번', msg: `파일 안에서 중복 (${seen.get(empNo)!.filter((l) => l !== line).join(', ')}행)` })
    const changes: FillChange[] = []
    for (const f of fields) {
      const text = (r[cfIdx.get(f)!] ?? '').trim()
      if (!text) continue // 빈 칸 = 그대로
      let value = text
      if (f.type === 'select') {
        const o = f.options.find((x) => x.label.trim() === text)
        if (!o) { errors.push({ col: f.name, msg: f.options.length ? `${f.options.map((x) => x.label).join('·')} 중 하나` : '선택지가 없는 칼럼' }); continue }
        value = o.id
      }
      const cur = e?.custom?.[f.id] ?? ''
      if (cur === value) continue
      const label = (v: string) => (f.type === 'select' ? f.options.find((x) => x.id === v)?.label ?? '' : v)
      changes.push({ fieldId: f.id, field: f.name, before: label(cur), after: text, value })
    }
    return { line, empNo, name: e?.name ?? '', employeeId: e?.id, changes, errors }
  })
  return { error: null, ignored, fixed, fields, rows, errorRows: rows.filter((x) => x.errors.length).length, changed: rows.filter((x) => !x.errors.length && x.changes.length).length }
}

export const canFill = (c: FillCheck) => !c.error && c.errorRows === 0 && c.changed > 0

/** 칼럼 값만 바꾼다(다른 직원 정보·평가 배정은 그대로) */
export function applyRosterFill(d: Pick<AppState, 'employees'>, c: FillCheck) {
  if (!canFill(c)) return 0
  let n = 0
  for (const r of c.rows) {
    const e = d.employees.find((x) => x.id === r.employeeId)
    if (!e || !r.changes.length) continue
    e.custom = { ...(e.custom ?? {}) }
    for (const ch of r.changes) e.custom[ch.fieldId] = ch.value
    n++
  }
  return n
}
