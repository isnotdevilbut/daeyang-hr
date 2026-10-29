// 직원 명단 업로드: 파일 읽기(.xlsx/.csv) → 표 → 검증. 등록은 화면에서 사용자가 확인한 뒤에만 한다.
// 회사·언어·재직 상태·평가 제외 여부는 받지 않는다(D-051). 사번은 글자로 다뤄 앞자리 0을 보존한다.
import type { AppState, Employee, EvalClass, JobType, Team } from './types'
import { activeJobs, positionById, positionsOf } from './catalog'
import { readXlsx, templateXlsx, type Sheet } from './xlsx'

export const MAX_FILE_BYTES = 5 * 1024 * 1024
export const MAX_ROWS = 2000

export type RosterKey = 'empNo' | 'name' | 'team' | 'position' | 'job'
export const ROSTER_FIELDS: { key: RosterKey; label: string; aliases: string[] }[] = [
  { key: 'empNo', label: '사번', aliases: ['사번', '사원번호', '직원번호', 'empno', 'emp_no', 'employeeno'] },
  { key: 'name', label: '이름', aliases: ['이름', '성명', '직원명', 'name'] },
  { key: 'team', label: '팀', aliases: ['팀', '팀명', '소속팀', 'team'] },
  { key: 'position', label: '직급', aliases: ['직급', 'position'] },
  { key: 'job', label: '직무', aliases: ['직무', '직군', 'job'] },
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
  teamId?: string
  jobType?: JobType
  positionId?: string
  evalClass?: EvalClass
}
export interface RosterCheck {
  error: string | null // 파일 전체 오류 (머리글 등)
  ignored: string[] // 쓰지 않는 열
  rows: RosterRow[]
  addable: number
  skipped: number
  errorRows: number
  existingDup: number // 기존 사번과 겹친 행 수 (처리 방식과 무관)
}

const norm = (h: string) => h.replace(/^﻿/, '').replace(/[\s*]/g, '').toLowerCase()

export type ExistingMode = 'error' | 'skip'

/** cat: 직무·직급 목록 (D-080, 없으면 기본 관리직·생산직 / 임원·팀장·사원) */
export function checkRoster(table: string[][], employees: Employee[], teams: Team[], mode: ExistingMode, cat: Pick<AppState, 'jobs' | 'positions'> = {}): RosterCheck {
  const jobs = activeJobs(cat), positions = positionsOf(cat)
  const empty: RosterCheck = { error: null, ignored: [], rows: [], addable: 0, skipped: 0, errorRows: 0, existingDup: 0 }
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
  const ignored = header.filter((h, i) => h && !used.has(i))

  const body = table.slice(hi + 1).map((r, i) => ({ r, line: hi + i + 2 })).filter(({ r }) => r.some((c) => (c ?? '').trim()))
  if (body.length > MAX_ROWS) return { ...empty, ignored, error: `한 번에 ${MAX_ROWS.toLocaleString()}행까지 올릴 수 있습니다.` }

  const byNo = new Map<string, number[]>()
  const rows: RosterRow[] = body.map(({ r, line }) => {
    const v = Object.fromEntries(ROSTER_FIELDS.map((f) => [f.key, (r[idx[f.key]] ?? '').trim()])) as Record<RosterKey, string>
    if (v.empNo) byNo.set(v.empNo, [...(byNo.get(v.empNo) ?? []), line])
    return { line, v, errors: [], skip: false }
  })
  for (const row of rows) {
    const err = (k: RosterKey, msg: string) => row.errors.push({ col: LABEL[k], msg })
    for (const f of ROSTER_FIELDS) if (!row.v[f.key]) err(f.key, '비어 있음')
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
    error: null, ignored, rows, errorRows, skipped,
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
    }))
}

/** 등록한 직원 중 팀장 → 그 팀의 팀장으로 연결 (검증에서 빈 팀·한 명만 허용됨) */
export function rosterLeads(d: Pick<AppState, 'teams' | 'positions'>, added: Employee[]) {
  for (const e of added) if ((positionById(d, e.positionId)?.evalClass ?? (e.position === '팀장' ? '팀장' : '')) === '팀장') { const t = d.teams.find((x) => x.id === e.teamId); if (t && !t.leadId) t.leadId = e.id }
}

// ── 템플릿 ───────────────────────────────────────────
export const templateXlsxBytes = () => templateXlsx('직원 명단', ROSTER_HEADER)
/** 엑셀에서 한글이 깨지지 않도록 UTF-8 BOM을 붙인다 */
export const templateCsvText = () => `﻿${ROSTER_HEADER.join(',')}\r\n`
