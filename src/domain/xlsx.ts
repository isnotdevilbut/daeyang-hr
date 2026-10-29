// 엑셀(.xlsx) 읽기·템플릿 만들기 — 외부 라이브러리 없이 필요한 만큼만 구현한다.
// .xlsx는 ZIP 안의 XML 파일 묶음이다. 셀 값은 저장된 값만 읽고, 수식·매크로는 실행하지 않는다
// (수식 셀은 엑셀이 마지막으로 저장해 둔 결과값만 쓴다). .xls(구형)·.xlsm·암호 걸린 파일은 지원하지 않는다.

export interface Sheet { name: string; rows: string[][] }

const MAX_ENTRY = 30 * 1024 * 1024 // 압축 해제 크기 상한 (비정상 파일 방지)

// ── ZIP 읽기 ─────────────────────────────────────────
interface ZipEntry { name: string; method: number; flags: number; compSize: number; size: number; offset: number }

function zipEntries(b: Uint8Array): Map<string, ZipEntry> {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength)
  let eocd = -1
  for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i--) if (v.getUint32(i, true) === 0x06054b50) { eocd = i; break }
  if (eocd < 0) throw new Error('엑셀 파일 구조를 읽을 수 없습니다.')
  const count = v.getUint16(eocd + 10, true)
  let p = v.getUint32(eocd + 16, true)
  if (p === 0xffffffff) throw new Error('너무 큰 파일은 읽을 수 없습니다.')
  const out = new Map<string, ZipEntry>()
  const dec = new TextDecoder()
  for (let i = 0; i < count; i++) {
    if (v.getUint32(p, true) !== 0x02014b50) throw new Error('엑셀 파일 구조를 읽을 수 없습니다.')
    const nameLen = v.getUint16(p + 28, true)
    const e: ZipEntry = {
      flags: v.getUint16(p + 8, true),
      method: v.getUint16(p + 10, true),
      compSize: v.getUint32(p + 20, true),
      size: v.getUint32(p + 24, true),
      offset: v.getUint32(p + 42, true),
      name: dec.decode(b.subarray(p + 46, p + 46 + nameLen)),
    }
    out.set(e.name.replace(/^\//, ''), e)
    p += 46 + nameLen + v.getUint16(p + 30, true) + v.getUint16(p + 32, true)
  }
  return out
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

async function readEntry(b: Uint8Array, e: ZipEntry): Promise<string> {
  if (e.flags & 1) throw new Error('암호가 걸린 파일은 읽을 수 없습니다.')
  if (e.size > MAX_ENTRY) throw new Error('파일 내용이 너무 큽니다.')
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength)
  if (v.getUint32(e.offset, true) !== 0x04034b50) throw new Error('엑셀 파일 구조를 읽을 수 없습니다.')
  const start = e.offset + 30 + v.getUint16(e.offset + 26, true) + v.getUint16(e.offset + 28, true)
  const raw = b.subarray(start, start + e.compSize)
  const data = e.method === 0 ? raw : e.method === 8 ? await inflateRaw(raw) : null
  if (!data) throw new Error('지원하지 않는 압축 방식입니다.')
  return new TextDecoder().decode(data)
}

// ── XML 조각 읽기 ─────────────────────────────────────
const unescape = (x: string) =>
  x
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')
    .replace(/_x([0-9a-f]{4})_/gi, (_, h) => String.fromCharCode(parseInt(h, 16))) // 엑셀 문자 이스케이프 (_x000D_ 등)

function attrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const m of tag.matchAll(/([\w:.-]+)\s*=\s*("([^"]*)"|'([^']*)')/g)) out[m[1]] = unescape(m[3] ?? m[4] ?? '')
  return out
}
const attrEnd = (a: Record<string, string>, local: string) => Object.entries(a).find(([k]) => k === local || k.endsWith(':' + local))?.[1]

/** <t> 글자들을 이어 붙인다. 후리가나(rPh)는 뺀다 */
const textOf = (xml: string) =>
  [...xml.replace(/<(?:\w+:)?rPh\b[\s\S]*?<\/(?:\w+:)?rPh>/g, '').matchAll(/<(?:\w+:)?t\b[^>]*?(?:\/>|>([\s\S]*?)<\/(?:\w+:)?t>)/g)].map((m) => unescape(m[1] ?? '')).join('')

const colIndex = (ref: string) => {
  const letters = ref.replace(/[^A-Z]/gi, '').toUpperCase()
  let n = 0
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64)
  return n - 1
}

function numberText(v: string): string {
  const t = v.trim()
  if (/^-?\d+(\.\d+)?$/.test(t)) return t // 저장된 글자 그대로 (사라진 앞자리 0을 되살리지 않음)
  const n = Number(t)
  return Number.isFinite(n) ? String(n) : t
}

function parseSheet(xml: string, shared: string[]): string[][] {
  const rows: string[][] = []
  let nextRow = 0
  for (const rm of xml.matchAll(/<(?:\w+:)?row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?row>)/g)) {
    const ra = attrs(rm[1])
    const r = ra.r ? Number(ra.r) - 1 : nextRow
    nextRow = r + 1
    const cells: string[] = []
    let nextCol = 0
    for (const cm of (rm[2] ?? '').matchAll(/<(?:\w+:)?c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?c>)/g)) {
      const ca = attrs(cm[1])
      const c = ca.r ? colIndex(ca.r) : nextCol
      nextCol = c + 1
      const body = cm[2] ?? ''
      const vm = body.match(/<(?:\w+:)?v\b[^>]*>([\s\S]*?)<\/(?:\w+:)?v>/)
      const v = vm ? unescape(vm[1]) : ''
      let val = ''
      if (ca.t === 's') val = shared[Number(v)] ?? ''
      else if (ca.t === 'inlineStr') val = textOf(body.replace(/<(?:\w+:)?f\b[\s\S]*?(?:\/>|<\/(?:\w+:)?f>)/g, ''))
      else if (ca.t === 'b') val = v === '1' ? 'TRUE' : v === '0' ? 'FALSE' : v
      else if (ca.t === 'str' || ca.t === 'e') val = v
      else val = v === '' ? '' : numberText(v)
      while (cells.length < c) cells.push('')
      cells[c] = val
    }
    rows[r] = cells
  }
  for (let i = 0; i < rows.length; i++) if (!rows[i]) rows[i] = []
  return rows
}

/** .xlsx 바이트 → 시트 목록(행·열 글자). 실패하면 이유를 담은 Error */
export async function readXlsx(bytes: Uint8Array): Promise<Sheet[]> {
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) throw new Error('엑셀(.xlsx) 파일이 아닙니다.')
  const zip = zipEntries(bytes)
  const get = async (path: string) => { const e = zip.get(path); return e ? readEntry(bytes, e) : null }
  const wb = await get('xl/workbook.xml')
  if (!wb) throw new Error('엑셀(.xlsx) 파일이 아닙니다.')
  const rels = new Map<string, { type: string; target: string }>()
  for (const m of ((await get('xl/_rels/workbook.xml.rels')) ?? '').matchAll(/<(?:\w+:)?Relationship\b[^>]*>/g)) {
    const a = attrs(m[0])
    const target = (a.Target ?? '').startsWith('/') ? a.Target.slice(1) : `xl/${a.Target}`
    rels.set(a.Id, { type: a.Type ?? '', target: target.replace(/\/\.\//g, '/') })
  }
  const ssPath = [...rels.values()].find((r) => r.type.endsWith('/sharedStrings'))?.target ?? 'xl/sharedStrings.xml'
  const ss = await get(ssPath)
  const shared = ss ? [...ss.matchAll(/<(?:\w+:)?si\b[^>]*>([\s\S]*?)<\/(?:\w+:)?si>|<(?:\w+:)?si\b[^>]*\/>/g)].map((m) => textOf(m[1] ?? '')) : []
  const sheets: Sheet[] = []
  for (const m of wb.matchAll(/<(?:\w+:)?sheet\b[^>]*>/g)) {
    const a = attrs(m[0])
    const rel = rels.get(attrEnd(a, 'id') ?? '')
    if (!rel || !rel.type.endsWith('/worksheet')) continue // 차트 시트 등은 건너뜀
    const xml = await get(rel.target)
    if (xml !== null) sheets.push({ name: a.name ?? `시트${sheets.length + 1}`, rows: parseSheet(xml, shared) })
  }
  if (!sheets.length) throw new Error('읽을 수 있는 시트가 없습니다.')
  return sheets
}

// ── 템플릿 .xlsx 만들기 (압축 없이 저장) ───────────────────
const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0 }
  return t
})()
function crc32(d: Uint8Array) {
  let c = 0xffffffff
  for (let i = 0; i < d.length; i++) c = CRC_TABLE[(c ^ d[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

export function zipStore(files: { name: string; data: string }[]): Uint8Array {
  const enc = new TextEncoder()
  const parts: Uint8Array[] = []
  const central: Uint8Array[] = []
  let offset = 0
  for (const f of files) {
    const name = enc.encode(f.name)
    const data = enc.encode(f.data)
    const crc = crc32(data)
    const local = new Uint8Array(30 + name.length)
    const lv = new DataView(local.buffer)
    lv.setUint32(0, 0x04034b50, true); lv.setUint16(4, 20, true); lv.setUint16(6, 0x0800, true)
    lv.setUint16(10, 0, true); lv.setUint16(12, 0x21, true) // 1980-01-01
    lv.setUint32(14, crc, true); lv.setUint32(18, data.length, true); lv.setUint32(22, data.length, true)
    lv.setUint16(26, name.length, true); local.set(name, 30)
    const cen = new Uint8Array(46 + name.length)
    const cv = new DataView(cen.buffer)
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true); cv.setUint16(8, 0x0800, true)
    cv.setUint16(14, 0x21, true); cv.setUint32(16, crc, true); cv.setUint32(20, data.length, true); cv.setUint32(24, data.length, true)
    cv.setUint16(28, name.length, true); cv.setUint32(42, offset, true); cen.set(name, 46)
    parts.push(local, data); central.push(cen)
    offset += local.length + data.length
  }
  const cenSize = central.reduce((a, c) => a + c.length, 0)
  const end = new Uint8Array(22)
  const ev = new DataView(end.buffer)
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, files.length, true); ev.setUint16(10, files.length, true)
  ev.setUint32(12, cenSize, true); ev.setUint32(16, offset, true)
  const all = [...parts, ...central, end]
  const out = new Uint8Array(all.reduce((a, c) => a + c.length, 0))
  let p = 0
  for (const c of all) { out.set(c, p); p += c.length }
  return out
}

const esc = (x: string) => x.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const NS = 'http://schemas.openxmlformats.org'

/** 머리글 한 줄짜리 템플릿. 모든 열을 "텍스트" 서식으로 두어 사번의 앞자리 0이 사라지지 않게 한다 */
export function templateXlsx(sheetName: string, header: string[], rows: string[][] = []): Uint8Array {
  const X = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
  const col = (i: number) => String.fromCharCode(65 + i)
  const row = (cells: string[], r: number, s: number) =>
    `<row r="${r}">${cells.map((v, i) => `<c r="${col(i)}${r}" t="inlineStr" s="${s}"><is><t xml:space="preserve">${esc(v)}</t></is></c>`).join('')}</row>`
  return zipStore([
    { name: '[Content_Types].xml', data: `${X}<Types xmlns="${NS}/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>` },
    { name: '_rels/.rels', data: `${X}<Relationships xmlns="${NS}/package/2006/relationships"><Relationship Id="rId1" Type="${NS}/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
    { name: 'xl/workbook.xml', data: `${X}<workbook xmlns="${NS}/spreadsheetml/2006/main" xmlns:r="${NS}/officeDocument/2006/relationships"><sheets><sheet name="${esc(sheetName)}" sheetId="1" r:id="rId1"/></sheets></workbook>` },
    { name: 'xl/_rels/workbook.xml.rels', data: `${X}<Relationships xmlns="${NS}/package/2006/relationships"><Relationship Id="rId1" Type="${NS}/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${NS}/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
    { name: 'xl/styles.xml', data: `${X}<styleSheet xmlns="${NS}/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="맑은 고딕"/></font><font><b/><sz val="11"/><name val="맑은 고딕"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="49" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>` },
    { name: 'xl/worksheets/sheet1.xml', data: `${X}<worksheet xmlns="${NS}/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols><col min="1" max="${header.length}" width="16" style="1" customWidth="1"/></cols><sheetData>${row(header, 1, 2)}${rows.map((r, i) => row(r, i + 2, 1)).join('')}</sheetData></worksheet>` },
  ])
}
