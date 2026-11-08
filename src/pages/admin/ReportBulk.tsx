import { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useAppState } from '../../data/store'
import { cycleLabel } from '../../domain/cycle'
import type { Cycle } from '../../domain/types'
import { byTierThenName } from '../../domain/catalog'
import { resultPeople } from '../../domain/progress'
import { Modal } from '../../components/ui'
import { templateXlsx } from '../../domain/xlsx'
import { csvCell, evalParts, REPORT_HEAD, ReportSheet, reportRows, saveFile, sheetModel } from './Report'

/**
 * 결과·리포트 선택 항목 다운로드(D-167): 체크한 사람들의 개인 리포트를 한 파일로.
 * - 포함 항목은 평가 답변 묶음(자기평가·팀장평가·임원평가) 단위로 고름 — 개인 리포트와 같은 본문(기본 정보·점수·추가 기록은 항상)
 * - 형식: 인쇄·PDF 저장 / 엑셀(.xlsx) / CSV — 개인 리포트와 같음(워드는 제거, D-177). 엑셀·CSV는 맨 앞에 이름 열, 인쇄는 사람마다 새 쪽
 * - 브라우저 안에서 만들어 내려받기(외부 전송 없음)
 */
const GROUPS = [{ key: 'self', label: '자기평가 답변' }, { key: 'lead', label: '팀장평가 답변·의견' }, { key: 'exec', label: '임원평가 답변·의견' }] as const
/** D-225: 단계별 점수도 단계마다 골라서 */
const STAGE_KEYS = [{ key: 'stage:1', label: '1단계 자기평가 점수' }, { key: 'stage:2', label: '2단계 팀장평가 점수' }, { key: 'stage:3', label: '3단계 임원평가 점수' }] as const
type Kind = 'print' | 'xlsx' | 'csv'
const KINDS: [Kind, string][] = [['print', '인쇄·PDF 저장'], ['xlsx', '엑셀(.xlsx)'], ['csv', 'CSV']]

export function BulkDownload({ cycle, ids, onClose }: { cycle: Cycle; ids: string[]; onClose: () => void }) {
  const s = useAppState()
  const [inc, setInc] = useState<Record<string, boolean>>({ self: true, lead: false, exec: false, 'stage:1': true, 'stage:2': false, 'stage:3': false }) // D-248: 처음엔 자기평가만
  const [kind, setKind] = useState<Kind>('xlsx')
  const on = (k: string) => { if (k in inc) return inc[k]; const g = k.split(':')[0]; return g in inc ? inc[g] : true }
  // 파일 안 순서 = 결과 화면과 같은 고정 순서(팀 가나다 → 직급 → 이름, D-169)
  const targets = useMemo(() => {
    const order = byTierThenName(s, cycle)
    return resultPeople(s, cycle).filter((t) => ids.includes(t.employeeId)).sort((a, b) => a.departmentName.localeCompare(b.departmentName, 'ko') || order(a, b))
  }, [s, cycle, ids])
  const sheets = targets.map((t) => { const parts = evalParts(s, cycle, t); return { t, parts, m: sheetModel(s, cycle, t, parts, on) } })
  const fileBase = `${cycleLabel(cycle)}_개인리포트_선택`.replace(/[\\/:*?"<>|]/g, '_')
  const go = () => {
    const a4s = [...document.querySelectorAll<HTMLElement>('.bulk-shell .a4')]
    if (kind === 'print') {
      document.body.classList.add('print-bulk')
      const done = () => { document.body.classList.remove('print-bulk'); window.removeEventListener('afterprint', done) }
      window.addEventListener('afterprint', done)
      window.print()
      return
    }
    const head = ['이름', ...REPORT_HEAD]
    const rows = a4s.flatMap((a4, i) => reportRows(a4).map((r) => [targets[i].name, ...r]))
    if (kind === 'xlsx') return saveFile(`${fileBase}.xlsx`, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', templateXlsx('개인 리포트', head, rows))
    saveFile(`${fileBase}.csv`, 'text/csv;charset=utf-8', '﻿' + [head, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n')
  }
  return (
    <Modal title="선택 항목 다운로드" onClose={onClose}>
      <div className="bulk-dl">
        {/* D-219: 전체를 고르면 이름 대신 '전체' */}
        <p className="muted small bulk-who">{targets.length === resultPeople(s, cycle).length ? '전체' : targets.map((t) => t.name).join(', ')}</p>
        <fieldset className="bulk-set">
          <legend>포함 항목</legend>
          {GROUPS.map((g) => <label key={g.key} className="check"><input type="checkbox" checked={inc[g.key]} onChange={(e) => setInc({ ...inc, [g.key]: e.target.checked })} /> {g.label}</label>)}
          {STAGE_KEYS.map((g) => <label key={g.key} className="check"><input type="checkbox" checked={inc[g.key]} onChange={(e) => setInc({ ...inc, [g.key]: e.target.checked })} /> {g.label}</label>)}
        </fieldset>
        <fieldset className="bulk-set">
          <legend>다운로드 형식</legend>
          <div className="seg" role="radiogroup" aria-label="다운로드 형식">
            {KINDS.map(([k, label]) => <button key={k} type="button" role="radio" aria-checked={kind === k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>{label}</button>)}
          </div>
          {kind === 'print' && <span className="muted small">인쇄 창에서 'PDF로 저장'을 고르면 PDF 파일로 받을 수 있어요(사람마다 새 쪽)</span>}
        </fieldset>
        <div className="row"><span className="spacer" /><button className="btn primary" onClick={go}>다운로드</button></div>
      </div>
      {/* 리포트 본문 — 화면에는 숨기고 파일·인쇄에만 */}
      {createPortal(
        <div className="report-shell bulk-shell print-only">
          {sheets.map(({ t, parts, m }) => <ReportSheet key={t.employeeId} s={s} cycle={cycle} t={t} parts={parts} m={m} />)}
        </div>,
        document.body,
      )}
    </Modal>
  )
}
