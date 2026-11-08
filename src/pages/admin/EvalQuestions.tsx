import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { update, useAppState } from '../../data/store'
import { useDirty } from '../../data/dirty'
import {
  answeredCount, appendImported, BASIC_TYPES, ctxFor, cycleHasResponses, defaultOptions, directionsFromRules, isChoice,
  newQuestion, newSection, parseQuestionTable, questionBlocks, questionSetIds, RULE_TEXT, RULES, rulesOf, TYPE_TEXT, validateQuestion,
  trBasis, applyTranslations, cloneQuestion, markDuplicates, dupTranslation, type QUploadResult,
} from '../../domain/questions'
import { type AnswerValue, type Cycle, type EvaluatorRule, type JobType, type Lang, type Question, type QuestionTr, type QuestionType, type Template } from '../../domain/types'
import { visibleSections } from '../../components/QuestionView'
import { ResponsePager } from '../../components/ResponsePager'
import { MobileHead } from '../employee/mobile'
import { needsReview, sectionNeedsReview, t as tr } from '../../i18n'
import { Modal } from '../../components/ui'
import { readRosterFile } from '../../domain/roster'
import type { Sheet } from '../../domain/xlsx'
import { jobName, positionName, positionsOf } from '../../domain/catalog'
import { activeTeams } from '../../domain/org'
import { pointsErrors, usesPoints } from '../../domain/points'
import { activeVersions, liveVersions, addVersion, applyVersion, applyVersions, blankTemplate, cloneTemplate, deleteVersion, pickKey, resolveVersion, saveVersionDraft, scopeTargets, slotMode, slotScope, SLOTS, versionUsed, withScope, templateRules, type VersionProblem } from '../../domain/versions'
import type { AppState, SlotKey, TemplateVersion, VersionScope } from '../../domain/types'

/** 끌어서 옮길 자리: list = 영역 번호(영역을 옮길 때는 0), slot = 그 목록에서 끼워 넣을 자리(0 ~ 개수) */
type DragPos = { list: number; slot: number }
/**
 * 끌어서 순서 바꾸기(D-158·D-159). 손잡이를 누른 채 위아래로 움직이면 놓일 자리에 선이 보이고, 놓으면 그 자리로 옮긴다.
 * 영역은 영역끼리, 문항은 다른 영역으로도(D-159 — 포인터가 있는 영역에 놓임, 빈 영역도 가능). 마우스·터치 모두(pointer 이벤트), 화면 위·아래 끝에서는 저절로 스크롤
 */
function useDragSort(onDrop: (kind: 'sec' | 'q', from: DragPos, to: DragPos) => void) {
  const [drag, setDrag] = useState<{ kind: 'sec' | 'q'; from: DragPos; to: DragPos } | null>(null)
  const slotIn = (els: HTMLElement[], y: number) => { const k = els.findIndex((el) => { const r = el.getBoundingClientRect(); return y < r.top + r.height / 2 }); return k < 0 ? els.length : k }
  const target = (kind: 'sec' | 'q', y: number): DragPos => {
    const secs = [...document.querySelectorAll<HTMLElement>('[data-drag-group="sec"]')]
    if (kind === 'sec') return { list: 0, slot: slotIn(secs, y) }
    let list = secs.findIndex((el) => y < el.getBoundingClientRect().bottom)
    if (list < 0) list = secs.length - 1
    return { list, slot: slotIn([...secs[list].querySelectorAll<HTMLElement>('[data-drag-group="q"]')], y) }
  }
  const start = (kind: 'sec' | 'q', from: DragPos) => (e: React.PointerEvent) => {
    if (e.button !== 0) return
    e.preventDefault()
    let to = from
    setDrag({ kind, from, to })
    document.body.classList.add('drag-sorting')
    const onMove = (ev: PointerEvent) => {
      to = target(kind, ev.clientY)
      setDrag({ kind, from, to })
      if (ev.clientY < 70) window.scrollBy(0, -18)
      else if (ev.clientY > window.innerHeight - 70) window.scrollBy(0, 18)
    }
    const end = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', end); window.removeEventListener('pointercancel', end)
      document.body.classList.remove('drag-sorting')
      setDrag(null)
      const same = to.list === from.list
      if (same && (to.slot === from.slot || to.slot === from.slot + 1)) return
      if (ev.type === 'pointerup') onDrop(kind, from, { list: to.list, slot: same && to.slot > from.slot ? to.slot - 1 : to.slot })
    }
    window.addEventListener('pointermove', onMove); window.addEventListener('pointerup', end); window.addEventListener('pointercancel', end)
  }
  /** 끄는 중인 항목·놓일 자리 표시(앞에 선 / 마지막이면 뒤에 선). 제자리면 선 없음 */
  const cls = (kind: 'sec' | 'q', list: number, i: number, n: number) => {
    if (!drag || drag.kind !== kind) return ''
    const { from, to } = drag
    const stay = to.list === from.list && (to.slot === from.slot || to.slot === from.slot + 1)
    const here = !stay && to.list === list
    return [from.list === list && from.slot === i ? 'dragging' : '', here && to.slot === i ? 'drop-before' : '', here && to.slot === n && i === n - 1 ? 'drop-after' : ''].filter(Boolean).join(' ')
  }
  /** 문항이 없는 영역에 놓을 때 그 영역 표시 */
  const into = (list: number) => (drag?.kind === 'q' && drag.to.list === list && drag.from.list !== list ? 'drop-into' : '')
  return { start, cls, into }
}

/**
 * 한 목록 안에서 끌어서 순서 바꾸기(D-238 — 선택지). 영역·문항 끌기(D-158)와 같은 손잡이·선 표시, 놓으면 그 자리로
 */
function useListDrag(group: string, onDrop: (from: number, to: number) => void) {
  const [drag, setDrag] = useState<{ from: number; to: number } | null>(null)
  const start = (from: number) => (e: React.PointerEvent) => {
    if (e.button !== 0) return
    e.preventDefault()
    let to = from
    setDrag({ from, to })
    document.body.classList.add('drag-sorting')
    const els = () => [...document.querySelectorAll<HTMLElement>(`[data-drag-group="${group}"]`)]
    const onMove = (ev: PointerEvent) => {
      const list = els(); const k = list.findIndex((el) => { const r = el.getBoundingClientRect(); return ev.clientY < r.top + r.height / 2 })
      to = k < 0 ? list.length : k
      setDrag({ from, to })
    }
    const end = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', end); window.removeEventListener('pointercancel', end)
      document.body.classList.remove('drag-sorting')
      setDrag(null)
      if (ev.type !== 'pointerup' || to === from || to === from + 1) return
      onDrop(from, to > from ? to - 1 : to)
    }
    window.addEventListener('pointermove', onMove); window.addEventListener('pointerup', end); window.addEventListener('pointercancel', end)
  }
  const cls = (i: number, n: number) => {
    if (!drag) return ''
    const stay = drag.to === drag.from || drag.to === drag.from + 1
    return [drag.from === i ? 'dragging' : '', !stay && drag.to === i ? 'drop-before' : '', !stay && drag.to === n && i === n - 1 ? 'drop-after' : ''].filter(Boolean).join(' ')
  }
  return { start, cls }
}

function DragHandle({ label, onStart, onKey }: { label: string; onStart: (e: React.PointerEvent) => void; onKey: (d: number) => void }) {
  return (
    <button type="button" className="drag-handle" aria-label={label} title="끌어서 순서 바꾸기" onPointerDown={onStart}
      onKeyDown={(e) => { if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); onKey(e.key === 'ArrowUp' ? -1 : 1) } }}>
      <svg width="10" height="16" viewBox="0 0 10 16" aria-hidden="true">{[3, 8, 13].flatMap((y) => [2, 8].map((x) => <circle key={`${x}-${y}`} cx={x} cy={y} r="1.5" />))}</svg>
    </button>
  )
}

type Editing = { sectionId: string; q: Question; isNew: boolean; index?: number }

// D-255: 문항 복사·붙여넣기 — 평가표(탭)를 옮겨 다니며 붙여넣기. 이 브라우저 탭에만 잠시 보관(sessionStorage)
type ClipItem = { q: Question; section: string; secPoints?: number | null; secRu?: string; from: string; fromTid?: string }
const CLIP_KEY = 'daeyang-hr-q-clip'
const readClip = (): ClipItem[] => { try { return JSON.parse(sessionStorage.getItem(CLIP_KEY) ?? '[]') } catch { return [] } }
const writeClip = (x: ClipItem[]) => { try { sessionStorage.setItem(CLIP_KEY, JSON.stringify(x)) } catch { /* 저장 안 돼도 이 화면에서는 동작 */ } }
const qkey = (x: string) => x.replace(/\s+/g, ' ').trim()

export default function EvalQuestions({ cycle }: { cycle: Cycle }) {
  const s = useAppState()
  const versioned = !!s.cycles.find((c) => c.id === cycle.id)?.versions // 평가표 버전 (D-082). 없으면 이전 방식(직무별 문항 세트)
  const sets = versioned ? activeVersions(s.cycles.find((c) => c.id === cycle.id)!).map((v) => v.templateId) : questionSetIds(cycle)
  const [pickedId, setSetId] = useState(sets[0])
  const setId = sets.includes(pickedId) ? pickedId : sets[0]
  const [editing, setEditing] = useState<Editing | null>(null)
  const [picking, setPicking] = useState<{ sectionId: string; index?: number } | null>(null)
  const [preview, setPreview] = useState(false)
  const [importing, setImporting] = useState(false)
  const [msg, setMsg] = useState('')
  const [clip, setClipState] = useState<ClipItem[]>(readClip)
  const setClip = (x: ClipItem[]) => { setClipState(x); writeClip(x) }
  const drop = useDragSort((kind, from, to) => reorder(kind, from, to))
  const live = s.cycles.find((c) => c.id === cycle.id)!
  const t = live.templates[setId]
  if (!t) return <div className="panel pad">이 평가에 연결된 문항이 없습니다.</div>

  const mut = (fn: (t: Template) => void) =>
    update((d) => {
      const x = d.cycles.find((c) => c.id === cycle.id)!.templates[setId]
      fn(x)
      x.version += 1
    })
  const answered = (qid: string) => answeredCount(s, live, qid)
  // D-255: 평가표가 맡은 평가 = 문항의 적용 평가(문항마다 고르지 않음). 화살표 없는 이전 방식이면 null
  const fixedRules = templateRules(live, setId)
  const inClip = (q: Question) => clip.some((c) => c.q.id === q.id && c.fromTid === setId) // 나눈 평가표끼리 문항 ID가 같을 수 있어 평가표까지 봄
  const copyQ = (sec: Template['sections'][number], qs: Question[]) => {
    const add = qs.filter((q) => !inClip(q)).map((q): ClipItem => ({ q: structuredClone(q), section: sec.title, secPoints: sec.points ?? null, secRu: sec.i18n?.ru?.title, from: t.name, fromTid: setId }))
    setClip([...clip, ...add])
    setMsg(`문항 ${add.length}개를 복사했습니다. 붙여넣을 평가표를 고른 뒤 '붙여넣기'를 누르세요.`)
  }
  /** 붙여넣기: 같은 질문이 이미 있으면 넣지 않음. toSection = 그 영역에, 없으면 복사한 영역과 같은 이름의 영역(없으면 새로 만듦) */
  const paste = (toSection?: string) => {
    const have = new Set(t.sections.flatMap((sec) => sec.questions.filter((q) => q.active).map((q) => qkey(q.title))))
    const fresh = clip.filter((c) => !have.has(qkey(c.q.title)) && (have.add(qkey(c.q.title)), true))
    const skipped = clip.length - fresh.length
    if (fresh.length) mut((x) => {
      for (const c of fresh) {
        let sec = toSection ? x.sections.find((y) => y.id === toSection) : x.sections.find((y) => y.title === c.section)
        if (!sec) { sec = newSection(c.section); if (typeof c.secPoints === 'number') sec.points = c.secPoints; if (c.secRu) sec.i18n = { ru: { title: c.secRu, basis: c.section } }; x.sections.push(sec) }
        const q = cloneQuestion(c.q, true)
        q.active = true
        if (fixedRules) { q.rules = [...fixedRules]; q.directions = directionsFromRules(fixedRules) }
        sec.questions.push(q)
      }
    })
    setMsg(`문항 ${fresh.length}개를 붙여넣었습니다.${skipped ? ` 이미 있는 문항 ${skipped}개는 넣지 않았습니다.` : ''}`)
  }
  // 새 문항의 적용 평가: 팀원→팀장평가만 쓰는 평가표(D-114)면 팀원→팀장평가로 시작(그 외는 기본 자기평가)
  const newFor = (ty: QuestionType): Question => {
    const v = live.versions?.find((x) => x.templateId === setId)
    const q = newQuestion(ty)
    if (fixedRules) return { ...q, rules: [...fixedRules], directions: directionsFromRules(fixedRules) }
    return v && v.scope.rules.length === 1 && v.scope.rules[0] === 'upward' ? { ...q, rules: ['upward'], directions: ['up'] } : q
  }
  const closedCycle = live.status === '확정' // 확정 회차의 배점은 바꾸지 않음(과거 결과 보존)
  const total = t.sections.reduce((a, x) => a + x.questions.filter((q) => q.active).length, 0)
  let no = 0
  const setLabel = (id: string) => {
    const jobs = (Object.keys(live.templateByJob) as JobType[]).filter((j) => live.templateByJob[j] === id)
    return `${jobs.map((j) => jobName(s, j)).join('·')} 문항`
  }
  const removeQ = (sid: string, q: Question) => {
    const n = answered(q.id)
    if (n > 0) {
      if (!confirm(`'${q.title}'에는 응답 ${n}건이 있어 삭제하지 않고 사용 중지합니다. 기존 응답은 보존됩니다.`)) return
      mut((x) => { x.sections.find((y) => y.id === sid)!.questions.find((y) => y.id === q.id)!.active = false })
      setMsg('사용 중지했습니다.')
    } else {
      if (!confirm(`'${q.title}' 문항을 삭제할까요?`)) return
      mut((x) => { const sec = x.sections.find((y) => y.id === sid)!; sec.questions = sec.questions.filter((y) => y.id !== q.id) })
      setMsg('삭제했습니다.')
    }
  }
  const removeSection = (si: number) => {
    const sec = t.sections[si]
    if (t.sections.length === 1) return alert('영역이 하나뿐이라 삭제할 수 없습니다.')
    const target = t.sections[si > 0 ? si - 1 : 1]
    const n = sec.questions.length
    if (!confirm(n ? `'${sec.title}' 영역을 삭제합니다. 문항 ${n}개는 '${target.title}' 영역으로 옮겨집니다.` : `'${sec.title}' 영역을 삭제할까요?`)) return
    mut((x) => {
      const [removed] = x.sections.splice(si, 1)
      x.sections.find((y) => y.id === target.id)!.questions.push(...removed.questions)
    })
  }
  const move = <T,>(arr: T[], i: number, d: number) => { const j = i + d; if (j >= 0 && j < arr.length) [arr[i], arr[j]] = [arr[j], arr[i]] }
  // D-158·D-159: 영역·문항 순서는 손잡이(⠿)를 끌어서 바꿈 — 문항은 다른 영역으로도 옮길 수 있음(문항 ID·응답은 그대로)
  const reorder = (kind: 'sec' | 'q', from: DragPos, to: DragPos) => mut((x) => {
    if (kind === 'sec') { const [it] = x.sections.splice(from.slot, 1); x.sections.splice(to.slot, 0, it); return }
    const [q] = x.sections[from.list].questions.splice(from.slot, 1)
    x.sections[to.list].questions.splice(to.slot, 0, q)
  })

  return (
    <>
      {versioned && <VersionBar cycle={live} selected={setId} onSelect={setSetId} />}
      <div className="tab-actions toolbar" role="toolbar" aria-label="문항 도구">
        {!versioned && sets.length > 1 && (
          <div className="seg" role="group" aria-label="문항 세트">
            {sets.map((id) => <button key={id} className={id === setId ? 'on' : ''} onClick={() => setSetId(id)}>{setLabel(id)}</button>)}
          </div>
        )}
        <span className="tool-count">사용 중인 문항 <b>{total}</b>개</span>
        <span className="spacer" />
        <button className="btn" onClick={() => setPreview(true)}>미리보기</button>
        <button className="btn" onClick={() => setImporting(true)}>엑셀·CSV 가져오기</button>
      </div>
      {msg && <p className="feedback ok" role="status">✓ {msg}</p>}
      {clip.length > 0 && (
        <div className="clip-bar" role="region" aria-label="복사한 문항">
          <span>📋 복사한 문항 <b>{clip.length}</b>개 <span className="muted">({[...new Set(clip.map((c) => c.from))].join(', ')}에서)</span></span>
          <span className="spacer" />
          <button className="btn small primary" onClick={() => paste()}>이 평가표에 붙여넣기</button>
          <button className="btn small" onClick={() => { setClip([]); setMsg('복사한 문항을 비웠습니다.') }}>비우기</button>
        </div>
      )}
      <PointsBar t={t} />
      {t.sections.length === 0 && <div className="panel pad empty-start"><p>문항이 없습니다. 아래 '+ 영역 추가'로 영역을 만든 뒤 그 안에서 문항을 추가하거나 엑셀·CSV로 가져오세요.</p></div>}

      {t.sections.map((sec, si) => (
        <section className={`panel q-section ${drop.cls('sec', 0, si, t.sections.length)} ${drop.into(si)}`} key={sec.id} data-sec={sec.id} data-drag-group="sec">
          <div className="q-sec-head">
            <DragHandle label={`${sec.title} 영역 순서 바꾸기 — 끌어서 옮기기(키보드 ↑↓)`} onStart={drop.start('sec', { list: 0, slot: si })} onKey={(d) => mut((x) => move(x.sections, si, d))} />
            <input type="text" className="sec-title" aria-label="영역 이름" value={sec.title} onChange={(e) => mut((x) => { x.sections[si].title = e.target.value })} />
            <span className="muted">{sec.questions.filter((q) => q.active).length}문항</span>
            {/* 영역 배점(D-103) — 비우면 점수에 넣지 않는 영역 */}
            <label className="sec-pts">배점<input type="number" inputMode="decimal" className="no-spin" aria-label={`${sec.title} 영역 배점`} disabled={closedCycle} value={sec.points ?? ''} placeholder="—"
              onWheel={(e) => e.currentTarget.blur()} onChange={(e) => mut((x) => { x.sections[si].points = e.target.value === '' ? null : Number(e.target.value) })} />점</label>
            <span className="spacer" />
            <button className="btn small" disabled={!sec.questions.some((q) => q.active)} onClick={() => copyQ(sec, sec.questions.filter((q) => q.active))}>영역 복사</button>
            <button className="btn small danger" onClick={() => removeSection(si)}>영역 삭제</button>
          </div>
          {/* D-161: 영역 설명(메모) 입력칸은 표시하지 않음 — 저장된 값은 지우지 않고 그대로 둠(평가 화면에는 원래 보이지 않음) */}
          {sec.questions.length === 0 ? <p className="empty-row">문항이 없습니다.</p> : (
            <ol className="q-list">
              {sec.questions.map((q, qi) => {
                const rules = rulesOf(q)
                const scope = [fixedRules ? '' : rules.map((r) => RULE_TEXT[r]).join('·'), q.jobs?.length === 1 ? `${jobName(s, q.jobs[0])}만` : '', q.targetRoles?.length === 1 ? (q.targetRoles[0] === 'lead' ? '팀장 대상' : '사원 대상') : '', q.teams?.length ? `팀 ${q.teams.length}곳만` : '', q.positions?.length ? `직급 ${q.positions.length}개만` : ''].filter(Boolean).join(' · ')
                return (
                  <li key={q.id} className={`q-row ${q.active ? '' : 'off'} ${drop.cls('q', si, qi, sec.questions.length)}`} data-drag-group="q">
                    <DragHandle label={`${q.title || '문항'} 순서 바꾸기 — 끌어서 옮기기(키보드 ↑↓)`} onStart={drop.start('q', { list: si, slot: qi })} onKey={(d) => mut((x) => move(x.sections[si].questions, qi, d))} />
                    <span className="q-no">{q.active ? ++no : '–'}</span>
                    <div className="q-main">
                      <div className="q-title">{q.title || '(제목 없음)'}{!q.active && <span className="chip na tag">사용 중지</span>}</div>
                      <div className="q-meta">
                        <span>{TYPE_TEXT[q.type]}</span>
                        <span>{q.required ? '필수' : '선택'}</span>
                        <span>{scope}</span>
                        {q.purpose === 'score' && <span className="chip info tag">점수 반영</span>}
                      </div>
                    </div>
                    <div className="q-actions">
                      <button className="btn small q-edit" onClick={() => setEditing({ sectionId: sec.id, q: structuredClone(q), isNew: false })}>수정</button>
                      {q.active && <button className={`btn small ${inClip(q) ? 'copied' : ''}`} aria-pressed={inClip(q)} onClick={() => (inClip(q) ? setClip(clip.filter((c) => !(c.q.id === q.id && c.fromTid === setId))) : copyQ(sec, [q]))}>{inClip(q) ? '복사됨 ✓' : '복사'}</button>}
                      {q.active
                        ? <button className="btn small danger" onClick={() => removeQ(sec.id, q)}>삭제</button>
                        : <button className="btn small" onClick={() => mut((x) => { x.sections[si].questions[qi].active = true })}>다시 사용</button>}
                    </div>
                  </li>
                )
              })}
            </ol>
          )}
          <div className="q-sec-foot"><button className="q-add" onClick={() => setPicking({ sectionId: sec.id })}>+ 이 영역에 문항 추가</button>{clip.length > 0 && <button className="q-add" onClick={() => paste(sec.id)}>📋 이 영역에 붙여넣기 ({clip.length})</button>}</div>
        </section>
      ))}
      {/* D-126: 영역 추가는 문항 목록 맨 아래에서 — 새 영역이 생기면 그 영역으로 이동, 영역 안의 '+ 이 영역에 문항 추가'로 문항을 넣음 */}
      <div className="q-add-sec">
        <button className="btn soft" onClick={() => {
          const sec = newSection('새 영역')
          mut((x) => { x.sections.push(sec) })
          requestAnimationFrame(() => { const el = document.querySelector<HTMLElement>(`[data-sec="${sec.id}"]`); el?.scrollIntoView({ behavior: 'smooth', block: 'center' }); el?.querySelector<HTMLInputElement>('input[type=text]')?.select() })
        }}>+ 영역 추가</button>
      </div>

      {picking && (
        <Modal title="문항 유형 선택" onClose={() => setPicking(null)}>
          <div className="type-pick">
            {BASIC_TYPES.map((ty) => (
              <button key={ty} className="btn" onClick={() => { setEditing({ sectionId: picking.sectionId, q: newFor(ty), isNew: true, index: picking.index }); setPicking(null) }}>{TYPE_TEXT[ty]}</button>
            ))}
          </div>
        </Modal>
      )}
      {editing && (
        <QuestionEditor
          t={t} editing={editing} answered={editing.isNew ? 0 : answered(editing.q.id)} fixedRules={fixedRules}
          onClose={() => setEditing(null)}
          onSave={(q, sectionId, secRu) => {
            mut((x) => {
              // D-250: 수정 창에서 고친 영역 이름 러시아어(그 영역 공통)
              const target = x.sections.find((y) => y.id === sectionId)
              if (target && (target.i18n?.ru?.title ?? '') !== secRu) target.i18n = secRu.trim() ? { ...(target.i18n ?? {}), ru: { title: secRu.trim(), basis: target.title } } : undefined
              for (const sec of x.sections) sec.questions = sec.questions.filter((y) => y.id !== q.id || sec.id === sectionId)
              const sec = x.sections.find((y) => y.id === sectionId)!
              const i = sec.questions.findIndex((y) => y.id === q.id)
              if (i >= 0) sec.questions[i] = q
              else sec.questions.push(q)
            })
            setMsg(editing.isNew ? '문항을 추가했습니다.' : '저장했습니다.')
            setEditing(null)
          }}
        />
      )}
      {preview && <Preview t={t} cycle={live} onClose={() => setPreview(false)} />}
      {importing && <Import cycle={live} t={t} onClose={() => setImporting(false)} onDone={(n, tr) => { setImporting(false); setMsg([n ? `문항 ${n}개를 가져왔습니다.` : '', tr ? `번역 ${tr}개를 저장했습니다.` : ''].filter(Boolean).join(' ')) }} mut={mut} />}
    </>
  )
}

/** 평가표 배점 요약(D-103): 영역 배점 합계·등급 환산(A~E)·오류. 배점이 하나도 없으면 이전 방식이라 합계 대신 안내 없이 등급 환산만 */
/** 영역 배점 합계·검증 문구. 등급 환산 입력은 화면에서 뺐다(D-120) — 저장된 환산값(없으면 A=5…E=1)은 점수 계산에 그대로 쓰인다 */
function PointsBar({ t }: { t: Template }) {
  const on = usesPoints(t)
  const sum = t.sections.reduce((a, x) => a + (typeof x.points === 'number' ? x.points : 0), 0)
  const errs = pointsErrors(t)
  if (!on && !errs.length) return null
  return (
    <div className="points-bar">
      {on && <span className={`pb-sum ${errs.some((e) => e.includes('합계')) ? 'bad' : 'good'}`}>영역 배점 합계 <b>{+sum.toFixed(2)}</b>점</span>}
      {errs.length > 0 && <span className="feedback fail pb-err" role="alert">✕ {errs[0]}{errs.length > 1 ? ` 외 ${errs.length - 1}건` : ''}</span>}
    </div>
  )
}

function QuestionEditor({ t, editing, answered, onClose, onSave, fixedRules }: {
  t: Template; editing: Editing; answered: number; onClose: () => void; onSave: (q: Question, sectionId: string, secRu: string) => void; fixedRules: EvaluatorRule[] | null
}) {
  const [q, setQ] = useState<Question>(editing.q)
  const [sectionId, setSectionId] = useState(editing.sectionId)
  // D-250: 번역은 수정 창 안에서 언어 버튼으로 켜고 끔(문항 목록·영역 머리글에는 RU 버튼 없음). 번역이 있으면 켜진 채로 열림
  const secOf = (id: string) => t.sections.find((x) => x.id === id)
  const [secRu, setSecRu] = useState(secOf(editing.sectionId)?.i18n?.ru?.title ?? '')
  const [showRu, setShowRu] = useState(false) // D-253: 처음엔 숨김 — 'RU 러시아어'를 눌러야 보임
  const ru = q.i18n?.ru ?? {}
  const setRu = (patch: Partial<QuestionTr>) => setQ((cur) => ({ ...cur, i18n: { ...(cur.i18n ?? {}), ru: { ...(cur.i18n?.ru ?? {}), ...patch } } }))
  const review = needsReview(q)
  const secReview = !!secOf(sectionId) && sectionNeedsReview(secOf(sectionId)!) && secRu === (secOf(sectionId)?.i18n?.ru?.title ?? '')
  const [errors, setErrors] = useState<string[]>([])
  const original = JSON.stringify(editing.q) + editing.sectionId + (secOf(editing.sectionId)?.i18n?.ru?.title ?? '')
  useDirty(JSON.stringify(q) + sectionId + secRu !== original)
  const locked = answered > 0 // 응답이 있으면 의미가 바뀌는 변경(유형·선택지 삭제·점수)을 막는다
  const set = (patch: Partial<Question>) => setQ({ ...q, ...patch })
  const rules = rulesOf(q)
  const setRules = (r: EvaluatorRule[]) => set({ rules: r, directions: directionsFromRules(r) })
  // 선택지 순서 바꾸기(D-238): 끌어 놓기·키보드 ↑↓ 공통
  const moveOpt = (from: number, to: number) => setQ((cur) => {
    if (to < 0 || to >= cur.options.length || to === from) return cur
    const o2 = [...cur.options]; const [x] = o2.splice(from, 1); o2.splice(to, 0, x)
    return { ...cur, options: o2 }
  })
  const optDrag = useListDrag('opt', moveOpt)
  const typeChoices: QuestionType[] = q.type === 'grade' ? [...BASIC_TYPES, 'grade'] : BASIC_TYPES
  const close = () => { if (JSON.stringify(q) + sectionId + secRu === original || confirm('저장하지 않은 변경이 있습니다. 닫을까요?')) onClose() }
  const save = () => {
    const e = validateQuestion(q)
    setErrors(e)
    if (!e.length) onSave(finishTranslation({ ...q, title: q.title.trim() }, editing.q), sectionId, secRu) // 러시아어가 비어 있어도 저장 가능
  }
  return (
    <Modal title={editing.isNew ? `문항 추가 — ${TYPE_TEXT[q.type]}` : '문항 수정'} onClose={close}>
      {/* D-253: 응답 있는 문항 안내 문구 없앰 — 바꿀 수 없는 칸은 그대로 잠김 */}
      <div className="q-editor">
        {/* D-250: 번역 언어 버튼 — 나중에 언어가 늘면 버튼만 옆에 추가 */}
        <div className="tr-toggle" role="group" aria-label="번역 표시">
          <span className="muted">번역</span>
          <button type="button" className={`btn small ${showRu ? 'on' : ''}`} aria-pressed={showRu} onClick={() => setShowRu(!showRu)}>RU 러시아어{(review || secReview) && <span className="chip draft tag">재확인</span>}</button>
        </div>
        {showRu && review && <p className="save-note">한국어 원문이 번역 이후 바뀌었습니다. 번역을 확인해 고치거나 <button type="button" className="link-btn" onClick={() => setRu({ basis: trBasis(q) })}>그대로 확인</button>하세요.</p>}
        <label className="field">질문<input type="text" value={q.title} autoFocus onChange={(e) => set({ title: e.target.value })} /></label>
        {showRu && <input type="text" className="tr-input" lang="ru" aria-label="질문 (러시아어)" placeholder="러시아어 — 비우면 한국어로 표시" value={ru.title ?? ''} onChange={(e) => setRu({ title: e.target.value })} />}
        <label className="field">도움말 <span className="muted">(선택)</span><input type="text" value={q.help} onChange={(e) => set({ help: e.target.value })} /></label>
        {showRu && (q.help || ru.help) && <input type="text" className="tr-input" lang="ru" aria-label="도움말 (러시아어)" placeholder="러시아어 — 비우면 한국어로 표시" value={ru.help ?? ''} onChange={(e) => setRu({ help: e.target.value })} />}
        <div className="grid form-grid">
          <label className="field">유형
            <select value={q.type} disabled={locked} onChange={(e) => {
              const ty = e.target.value as QuestionType
              set({ type: ty, options: defaultOptions(ty, q.id), purpose: ty === 'scale5' ? 'score' : isChoice(ty) ? q.purpose : 'info' })
            }}>
              {typeChoices.map((ty) => <option key={ty} value={ty}>{TYPE_TEXT[ty]}</option>)}
            </select>
          </label>
          <label className="field">영역
            <select value={sectionId} onChange={(e) => { setSectionId(e.target.value); setSecRu(secOf(e.target.value)?.i18n?.ru?.title ?? '') }}>
              {t.sections.map((x) => <option key={x.id} value={x.id}>{x.title}</option>)}
            </select>
          </label>
        </div>
        {showRu && <label className="field">영역 이름 <span className="muted">(러시아어 · 이 영역 공통)</span><input type="text" className="tr-input" lang="ru" aria-label="영역 이름 (러시아어)" placeholder="러시아어 — 비우면 한국어로 표시" value={secRu} onChange={(e) => setSecRu(e.target.value)} /></label>}
        {showRu && secReview && <span className="muted small">영역 이름이 번역 이후 바뀌었습니다 — 번역을 확인하세요</span>}
        <label className="check"><input type="checkbox" checked={q.required} onChange={(e) => set({ required: e.target.checked })} /> 필수 응답</label>
        {/* 문항 배점(D-103): 영역 안 문항 비중(선택형), 서술형은 채점 범위(0~배점) */}
        <label className="field q-pts">문항 배점 <span className="muted">(선택 · 영역 안 비중, 주관식은 채점 만점)</span>
          <input type="number" inputMode="decimal" className="no-spin" value={q.points ?? ''} placeholder="—" onWheel={(e) => e.currentTarget.blur()}
            onChange={(e) => set({ points: e.target.value === '' ? null : Number(e.target.value), ...(!isChoice(q.type) && e.target.value === '' ? { purpose: 'info' as const } : {}) })} />
        </label>

        {isChoice(q.type) && (
          <fieldset className="sub-settings col">
            <legend>선택지</legend>
            <label className="check">
              <input type="checkbox" disabled={locked || q.type === 'grade'} checked={q.purpose === 'score'} onChange={(e) => set({ purpose: e.target.checked ? 'score' : 'info' })} /> 점수에 반영
            </label>
            {q.options.map((o, i) => (
              <div className={`opt-row ${optDrag.cls(i, q.options.length)}`} key={o.id} data-drag-group="opt">
                {/* D-238: 선택지도 영역·문항처럼 끌어서 순서 바꾸기(키보드 ↑↓) */}
                <DragHandle label={`선택지 ${i + 1} 순서 바꾸기 — 끌어서 옮기기(키보드 ↑↓)`} onStart={optDrag.start(i)} onKey={(d) => moveOpt(i, i + d)} />
                <input type="text" aria-label={`선택지 ${i + 1}`} value={o.label} onChange={(e) => set({ options: q.options.map((x, k) => (k === i ? { ...x, label: e.target.value } : x)) })} />
                {q.purpose === 'score' && q.type !== 'grade' && (
                  <input type="number" className="score" aria-label={`선택지 ${i + 1} 점수`} placeholder="점수" disabled={locked} value={o.value ?? ''}
                    onChange={(e) => set({ options: q.options.map((x, k) => (k === i ? { ...x, value: e.target.value === '' ? null : Number(e.target.value) } : x)) })} />
                )}
                <button className="btn small danger" disabled={locked || q.options.length <= 2} onClick={() => set({ options: q.options.filter((_, k) => k !== i) })}>삭제</button>
                {showRu && <input type="text" className="tr-input opt-tr" lang="ru" aria-label={`선택지 ${i + 1} 러시아어`} placeholder="러시아어 — 비우면 한국어로 표시" value={ru.options?.[o.id] ?? ''} onChange={(e) => setRu({ options: { ...(ru.options ?? {}), [o.id]: e.target.value } })} />}
              </div>
            ))}
            {q.type !== 'ox' && (
              <div className="row">
                <button className="btn small" onClick={() => set({ options: [...q.options, { id: `${q.id}-o${Date.now().toString(36)}`, label: `선택지 ${q.options.length + 1}`, value: null }] })}>+ 선택지 추가</button>
                {q.type === 'single' && q.options.length < 5 && !locked && (
                  <button className="btn small" onClick={() => set({ options: [...q.options, ...Array.from({ length: 5 - q.options.length }, (_, k) => ({ id: `${q.id}-o5${k}${Date.now().toString(36)}`, label: `선택지 ${q.options.length + k + 1}`, value: null }))] })}>5지선다로 채우기</button>
                )}
              </div>
            )}
          </fieldset>
        )}
        {!isChoice(q.type) && (
          <label className="check"><input type="checkbox" disabled={!(typeof q.points === 'number' && q.points > 0)} checked={q.purpose === 'score'} onChange={(e) => set({ purpose: e.target.checked ? 'score' : 'info' })} /> 점수에 반영 <span className="muted">(배점 입력 시 · 관리자 채점, 자동 점수화 없음)</span></label>
        )}

        {/* D-255: 화살표 방식 평가표는 문항별 적용 평가 없음 — 평가표가 맡은 평가에 모두 보임 */}
        {!fixedRules && <fieldset className="sub-settings">
          <legend>적용 평가</legend>
          {RULES.map((r) => (
            <label key={r} className="check"><input type="checkbox" checked={rules.includes(r)} onChange={(e) => setRules(e.target.checked ? [...rules, r] : rules.filter((x) => x !== r))} /> {RULE_TEXT[r]}</label>
          ))}
        </fieldset>}
      </div>
      {errors.length > 0 && <div className="feedback fail" role="alert">{errors.map((e) => <div key={e}>✕ {e}</div>)}</div>}
      <div className="row" style={{ marginTop: 14 }}><span className="spacer" /><button className="btn primary" onClick={save}>{editing.isNew ? '추가' : '저장'}</button></div>
    </Modal>
  )
}

/**
 * 미리보기 (D-061): 직원 응답 화면과 같은 페이지 흐름(ResponsePager)을 그대로 쓴다.
 * 답변·진행 상태는 이 창의 메모리에만 있고 응답 저장소·제출 상태·진행 현황·점수에 쓰지 않는다.
 * 평가 유형·직무·대상을 바꾸면 문항과 화면 구성을 다시 계산하고 처음부터 시작. 화면 폭은 PC 하나(D-152).
 */
function Preview({ t: current, cycle, onClose }: { t: Template; cycle: Cycle; onClose: () => void }) {
  const [rule, setRule] = useState<EvaluatorRule>('self')
  const s = useAppState()
  const [job0, setJob] = useState<JobType>('office')
  const [lead, setLead] = useState(false)
  const mobile = false // D-152: 미리보기는 PC 화면 하나(모바일·PC 전환 제거)
  const frameRef = useRef<HTMLDivElement>(null)
  // 평가표 버전(D-082): 평가 유형·대상 팀·대상 직급으로 실제와 같은 함수(resolveVersion)로 고른 평가표를 보여 준다
  const versioned = !!cycle.versions
  const [team0, setTeam] = useState(activeTeams(s)[0]?.id ?? '')
  const [pos0, setPos] = useState(positionsOf(s).find((p) => p.evalClass === '사원')?.id ?? '')
  // 특정 대상자로 보기(D-087): 직접 선택한 사람 범위도 실제와 같이 직원 ID로 고른다. 그 사람의 팀·직급·직무를 그대로 씀
  const [who, setWho] = useState('')
  const whoT = cycle.targets.find((x) => x.employeeId === who)
  const team = whoT ? whoT.departmentId : team0
  const pos = whoT ? whoT.positionId ?? '' : pos0
  const job: JobType = whoT ? whoT.jobType : job0
  const posLead = positionsOf(s).find((p) => p.id === pos)?.evalClass === '팀장'
  // 적용 전 초안(또는 적용 평가가 빈 버전)을 열고 있으면 그 버전 문항을 그대로 미리보기 — 실제 배정·선택에는 쓰이지 않음 (D-085)
  const curV = cycle.versions?.find((v) => v.templateId === current.id)
  const draftPreview = versioned && !!curV && !liveVersions(cycle).includes(curV)
  const res = versioned && !draftPreview ? resolveVersion(cycle, { rule, teamId: team, positionId: pos, employeeId: who || undefined, jobType: job, tier: positionsOf(s).find((p) => p.id === pos)?.evalClass }) /* 화살표 방식은 평가받는 사람의 직급 구분으로(D-211) */ : null
  const t = versioned && !draftPreview ? (res?.templateId ? cycle.templates[res.templateId] : undefined) : current
  const vName = (id: string) => cycle.versions?.find((v) => v.templateId === id)?.name ?? id
  const isLead = versioned ? posLead : lead
  const sections = t ? visibleSections(t, { direction: rule === 'self' ? 'self' : rule === 'upward' ? 'up' : 'down', rule, jobType: job, isLead, teamId: versioned ? team : undefined, positionId: versioned ? pos : undefined }) : []
  return createPortal( // 문서 맨 위에 그려 헤더까지 덮음 (D-070)
    <div className="modal-bg" onClick={onClose}>
      <div className="modal preview-modal" role="dialog" aria-modal="true" aria-label="문항 미리보기" onClick={(e) => e.stopPropagation()}>
        <div className="row">
          <h2 style={{ margin: 0 }}>미리보기</h2>
          <span className="spacer" />
          <button type="button" className="modal-x" aria-label="닫기" title="닫기" onClick={onClose}>✕</button>
        </div>
        <div className="filters preview-controls">
          <select aria-label="평가 유형" value={rule} onChange={(e) => setRule(e.target.value as EvaluatorRule)}>
            {RULES.map((r) => <option key={r} value={r}>{RULE_TEXT[r]}</option>)}
          </select>
          <select aria-label="직무" value={job} disabled={!!whoT} onChange={(e) => setJob(e.target.value as JobType)}>
            <option value="office">{jobName(s, 'office')}</option><option value="production">{jobName(s, 'production')}</option>
          </select>
          {versioned ? <>
            <select aria-label="대상자" value={who} onChange={(e) => setWho(e.target.value)}>
              <option value="">조건으로 보기</option>
              {[...cycle.targets].sort((a, b) => a.teamName.localeCompare(b.teamName, 'ko') || a.name.localeCompare(b.name, 'ko')).map((x) => <option key={x.employeeId} value={x.employeeId}>{x.teamName} · {x.name}</option>)}
            </select>
            <select aria-label="대상 팀" value={team} disabled={!!whoT} onChange={(e) => setTeam(e.target.value)}>{activeTeams(s).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
            <select aria-label="대상 직급" value={pos} disabled={!!whoT} onChange={(e) => setPos(e.target.value)}>{positionsOf(s).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
          </> : (
            <select aria-label="평가받는 사람" value={lead ? 'lead' : 'member'} onChange={(e) => setLead(e.target.value === 'lead')}>
              <option value="member">사원</option><option value="lead">팀장</option>
            </select>
          )}
          <span className="muted">입력해도 저장되지 않습니다</span>
        </div>
        {draftPreview && <p className="preview-version" role="status">초안 미리보기: <b>{curV!.pending?.name ?? curV!.name}</b> (적용 전)</p>}
        {versioned && !draftPreview && <p className="preview-version" role="status">{res?.conflict ? `⚠ 평가표 충돌: ${res.candidates.map(vName).join(' · ')} — 문항 관리에서 적용 버전을 고르세요` : res?.templateId ? <>적용 평가표: <b>{vName(res.templateId)}</b></> : '⚠ 이 조건에 적용되는 평가표가 없습니다'}</p>}
        <div ref={frameRef} className={`preview-frame ${mobile ? 'preview-phone' : 'preview-pc'}`}>
          {sections.length === 0
            ? <div className="m-body"><p>이 조건에 해당하는 문항이 없습니다.</p></div>
            : <PreviewFlow key={`${rule}|${job}|${isLead}|${team}|${pos}|${who}|${t?.id}`} rule={rule} sections={sections} frameRef={frameRef} />}
        </div>
      </div>
    </div>,
    document.body,
  )
}

function PreviewFlow({ rule, sections, frameRef }: { rule: EvaluatorRule; sections: ReturnType<typeof visibleSections>; frameRef: React.RefObject<HTMLDivElement> }) {
  const [answers, setAnswers] = useState<Record<string, AnswerValue>>({})
  // 미리보기 안에서만 쓰는 언어(직원 브라우저 설정과 무관). 실제 화면과 같은 번역 데이터·같은 표시 컴포넌트 (D-075)
  const [lang, setLang] = useState<Lang>('ko')
  const title = tr(`rule.${rule}`, lang)
  const [note, setNote] = useState('')
  const [finished, setFinished] = useState(false)
  const [round, setRound] = useState(0)
  const restart = () => { setAnswers({}); setNote(''); setFinished(false); setRound(round + 1); if (frameRef.current) frameRef.current.scrollTop = 0 }
  if (finished)
    return (
      <div className="m-wrap contained">
        <MobileHead title={title} />
        <div className="m-body">
          <span className="chip info">미리보기 · 실제로 제출되지 않음</span>
          <h1 style={{ marginTop: 12 }}>✔ {tr('done.title', lang)}</h1>
          <p>{tr('done.body', lang)}</p>
          <button className="m-btn primary" onClick={restart}>처음부터 다시 보기</button>
        </div>
      </div>
    )
  return (
    <ResponsePager
      key={round}
      contained
      scrollRef={frameRef}
      title={title}
      sections={sections}
      answers={answers}
      setAnswer={(qid, v) => { setAnswers((a) => ({ ...a, [qid]: v })); setNote('') }}
      lang={lang}
      onLang={setLang}
      topLeft={<span className="chip info">미리보기 · 저장 안 됨</span>}
      status={note ? <p className="save-state" style={{ color: 'var(--text-sub)' }}>{note}</p> : null}
      onSave={() => setNote('미리보기에서는 저장하지 않습니다. 입력 내용은 이 창을 닫으면 사라집니다.')}
      onSubmit={() => { if (confirm('[미리보기] 최종 제출하면 수정할 수 없습니다. 제출할까요?\n(미리보기라 실제로 제출되지 않습니다)')) setFinished(true) }}
    />
  )
}

type QLoaded = { file: string; sheets: Sheet[]; sheet: number; block: number | null }

/**
 * 문항 일괄 업로드(D-118) — 조직 관리 명단 업로드와 같은 흐름: 파일 선택(.xlsx/.csv, 여러 시트면 시트 선택) → 표 미리보기·행별 검증 →
 * 오류가 하나라도 있으면 아무것도 넣지 않음(부분 등록 없음) → 추가(같은 이름의 영역 뒤, 없으면 새 영역) 또는 교체(응답 없는 평가만)
 */
function Import({ cycle, t, onClose, onDone, mut }: { cycle: Cycle; t: Template; onClose: () => void; onDone: (n: number, tr: number) => void; mut: (fn: (t: Template) => void) => void }) {
  const s = useAppState()
  const [loaded, setLoaded] = useState<QLoaded | null>(null)
  const [readErr, setReadErr] = useState('')
  const [mode, setMode] = useState<'append' | 'replace'>('append')
  const [inputKey, setInputKey] = useState(0)
  const hasResp = cycleHasResponses(s, cycle)
  // 적용평가 칸이 비었을 때 = 이 평가표 버전의 적용 평가(예: 팀원→팀장 평가표 → 팀원→팀장평가, 팀장 자기평가표 → 자기평가). 버전이 없으면 자기평가
  const v = cycle.versions?.find((x) => x.templateId === t.id)
  const fixedRules = templateRules(cycle, t.id)
  const defRules: EvaluatorRule[] = v?.scope.rules.length ? [...v.scope.rules] : ['self']
  // 한 시트에 표가 여러 개면(D-123) 표 제목으로 고름 — 처음엔 이 평가표에 맞는 표(팀원→팀장 → '상향', 팀장 자기평가 → '본인·자기')
  const blocks = loaded ? questionBlocks(loaded.sheets[loaded.sheet]?.rows ?? []) : []
  const guess = () => {
    const want = defRules.includes('upward') ? /상향|팀원|부하/ : /본인|자기/
    const i = blocks.findIndex((b) => want.test(b.title))
    return i >= 0 ? i : 0
  }
  const blockIdx = loaded ? Math.min(loaded.block ?? guess(), Math.max(0, blocks.length - 1)) : 0
  const table = loaded ? blocks[blockIdx]?.table ?? null : null
  const offset = blocks[blockIdx]?.offset ?? 0
  // 이 평가표 버전의 적용 평가와 겹치지 않는 문항은 어디에도 보이지 않으므로 행 오류로(예: 공통 평가표에 팀원→팀장평가 문항)
  const res: QUploadResult | null = table ? (() => {
    const r = parseQuestionTable(table, defRules, offset)
    // D-255: 화살표 방식 평가표면 파일의 적용평가 칸은 쓰지 않고 이 평가표의 평가로
    const fixed = templateRules(cycle, t.id)
    if (fixed) { for (const row of r.rows) { if (row.question) { row.question.rules = [...fixed]; row.question.directions = directionsFromRules(fixed) } row.errors = row.errors.filter((e) => !e.startsWith('적용평가')); if (!row.errors.length && !row.question) row.errors.push('행을 읽을 수 없음') } return r }
    const scope = v?.scope.rules
    if (scope?.length) for (const row of r.rows) {
      const q = row.question
      if (q && !rulesOf(q).some((x) => scope.includes(x))) { row.errors.push(`적용평가: 이 평가표는 ${scope.map((x) => RULE_TEXT[x]).join('·')}용 — 맞는 평가표에 올리세요`); row.question = null }
    }
    return r
  })() : null
  // D-252: 중복 문항(평가표에 이미 있는 질문·파일 안 반복)은 넣지 않음 — 이미 있는 질문에 번역 열이 있으면 번역만 저장
  const dups = res && !res.headerError ? markDuplicates(t, res.rows, mode === 'replace') : []
  const trs = res?.rows.map((r, i) => (dups[i] === 'existing' ? dupTranslation(r) : null)) ?? []
  const trCount = trs.filter(Boolean).length
  const ok = res?.rows.filter((r, i) => r.question && !dups[i]) ?? []
  const bad = res?.rows.filter((r, i) => !r.question && !dups[i]) ?? []
  const dupCount = dups.filter(Boolean).length
  const canApply = !!res && !res.headerError && bad.length === 0 && (ok.length > 0 || trCount > 0) && !(mode === 'replace' && hasResp)
  const pick = async (f: File | undefined) => {
    setReadErr(''); setLoaded(null)
    if (!f) return
    const r = await readRosterFile(f.name, new Uint8Array(await f.arrayBuffer())) // 명단 업로드와 같은 파일 읽기(XLSX 직접 해석·CSV 글자 판별)
    if (!r.ok) return setReadErr(r.error)
    setLoaded({ file: f.name, sheets: r.sheets, sheet: 0, block: null })
  }
  const apply = () => {
    if (!canApply) return
    if (mode === 'replace' && !confirm(`기존 문항을 모두 지우고 ${ok.length}개로 교체할까요?`)) return
    mut((x) => {
      if (mode === 'replace') x.sections = []
      appendImported(x, ok)
      applyTranslations(x, trs.filter((r): r is NonNullable<typeof r> => !!r))
    })
    onDone(ok.length, trCount)
  }
  const reset = () => { setLoaded(null); setReadErr(''); setInputKey((k) => k + 1) }
  return (
    <Modal title="문항 일괄 업로드" onClose={onClose} wide>
      <div className="upload q-upload">
        {/* D-251·D-252: 안내는 최소 — 질문 열 하나면 됨. 번역은 AI로 열을 붙여 같은 파일을 다시 올리면 됨. 중복은 넣지 않음 */}
        {/* D-254: 안내를 '문항'·'번역' 두 묶음으로. 열 목록은 보이지 않음 — 모르는 열은 조용히 무시 */}
        <div className="q-guide">
          <div className="q-guide-grp"><b>문항</b>
            <ul><li><b>질문</b> 열만 있으면 돼요. 객관식이면 <b>선택지</b> 열에 보기를 적어요(예: 매우 우수, 우수, 보통).</li></ul>
          </div>
          <div className="q-guide-grp"><b>번역</b>
            <ul>
              <li>이 파일을 챗GPT나 Claude에 넣고 "러시아어 열 추가해줘" → 받은 파일을 여기에 올리면 번역이 한 번에 들어가요.</li>
              <li>이미 있는 문항은 다시 넣지 않아요(번역만 저장).</li>
            </ul>
          </div>
        </div>
        <div className="row upload-pick">
          <label className="btn primary file-btn">
            파일 선택
            <input key={inputKey} type="file" accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv" onChange={(e) => pick(e.target.files?.[0])} />
          </label>
          <span className="muted">{loaded ? loaded.file : '엑셀(.xlsx) 또는 CSV(.csv)'}</span>
          {loaded && loaded.sheets.length > 1 && (
            <label className="row sheet-pick">시트
              <select value={loaded.sheet} onChange={(e) => setLoaded({ ...loaded, sheet: Number(e.target.value), block: null })}>
                {loaded.sheets.map((sh, i) => <option key={i} value={i}>{sh.name}</option>)}
              </select>
            </label>
          )}
          {blocks.length > 1 && (
            <label className="row sheet-pick">표
              <select aria-label="가져올 표" value={blockIdx} onChange={(e) => setLoaded({ ...loaded!, block: Number(e.target.value) })}>
                {blocks.map((b, i) => <option key={i} value={i}>{b.title}</option>)}
              </select>
            </label>
          )}
        </div>
        {readErr && <p className="feedback fail" role="alert">✕ {readErr}</p>}
        {res?.headerError && <p className="feedback fail" role="alert">✕ {res.headerError}</p>}
        {res && !res.headerError && (
          <>
            <div className="row upload-sum" aria-live="polite">
              <span>전체 <b>{res.rows.length}</b>행</span>
              <span>새 문항 <b>{ok.length}</b></span>
              {dupCount > 0 && <span>중복(넣지 않음) <b>{dupCount}</b>{trCount > 0 && <> · 번역 저장 <b>{trCount}</b></>}</span>}
              <span className={bad.length ? 'err' : ''}>오류 <b>{bad.length}</b>행</span>
            </div>
            {res.notes?.map((n, i) => <p key={i} className="muted small q-note">{n}</p>)}
            <ModePick mode={mode} setMode={setMode} hasResp={hasResp} />
            <div className="table-wrap upload-preview" tabIndex={0}>
              <table className="tbl">
                <thead><tr><th className="num">행</th><th>영역</th><th>질문</th><th>유형</th>{!fixedRules && <th>적용평가</th>}<th>확인</th></tr></thead>
                <tbody>
                  {res.rows.length === 0 ? <tr><td colSpan={6} className="empty-row">머리글 아래에 문항 행이 없습니다.</td></tr> : res.rows.map((r, ri) => (
                    <tr key={r.line} className={dups[ri] ? 'row-dup' : r.errors.length ? 'row-err' : ''}>
                      <td className="num">{r.line}</td>
                      <td>{dups[ri] ? '—' : r.section || <span className="muted">(빈 칸)</span>}</td>
                      <td>{r.question?.title ?? r.title ?? <span className="muted">—</span>}{r.question?.i18n?.ru?.title && <div className="muted small" lang="ru">{r.question.i18n.ru.title}</div>}</td>
                      <td>{r.question && !dups[ri] ? TYPE_TEXT[r.question.type] : '—'}</td>
                      {!fixedRules && <td>{r.question && !dups[ri] ? rulesOf(r.question).map((x) => RULE_TEXT[x]).join('·') : '—'}</td>}
                      <td>{dups[ri] ? <><span className="chip na">중복</span><div className="muted small">{dups[ri] === 'existing' ? (trs[ri] ? '이미 있는 문항 — 번역만 저장' : '이미 있는 문항 — 넣지 않음') : '파일 안에서 반복 — 넣지 않음'}</div></> : r.errors.length ? r.errors.map((e, i) => <div key={i} className="err-msg">{e}</div>) : <><span className="chip submitted">✓</span>{r.notes?.map((n, i) => <div key={i} className="muted small">{n}</div>)}</>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="row" style={{ marginTop: 12 }}>
              <button className="btn primary" disabled={!canApply} onClick={apply}>{ok.length > 0 ? `${ok.length}개 ${mode === 'replace' ? '교체' : '추가'}${trCount ? ` · 번역 ${trCount}개 저장` : ''}` : trCount > 0 ? `번역 ${trCount}개 저장` : '넣을 새 문항 없음'}</button>
              <button className="btn" onClick={reset}>다른 파일</button>
              {bad.length > 0 && <span className="feedback fail">오류가 있어 등록할 수 없습니다.</span>}
            </div>
          </>
        )}
      </div>
    </Modal>
  )
}

function ModePick({ mode, setMode, hasResp }: { mode: string; setMode: (m: 'append' | 'replace') => void; hasResp: boolean }) {
  return (
    <fieldset className="sub-settings">
      <legend>가져오기 방식</legend>
      <label className="check"><input type="radio" name="qmode" checked={mode === 'append'} onChange={() => setMode('append')} /> 추가 (기존 문항 뒤에, 같은 이름의 영역에 넣음 · 이미 있는 문항은 넣지 않음)</label>
      <label className="check"><input type="radio" name="qmode" disabled={hasResp} checked={mode === 'replace'} onChange={() => setMode('replace')} /> 교체 (기존 문항 모두 삭제)</label>
      {hasResp && <span className="muted">응답이 있는 평가라 교체할 수 없습니다.</span>}
    </fieldset>
  )
}

// ── 러시아어 번역 편집 (D-075) ─────────────────────────
// 저장해 둔 번역문을 관리자가 직접 입력·수정한다. 자동 번역하지 않는다. 선택지 번역은 선택지 ID로 연결.
// basis = 번역할 때의 한국어 원문 — 한국어를 고치면 이 편집 영역에만 "번역 재확인 필요" 표시(번역은 지우지 않음).

const koBasis = (q: Question): NonNullable<QuestionTr['basis']> => ({ title: q.title, help: q.help, options: Object.fromEntries(q.options.map((o) => [o.id, o.label])) })
const sameTr = (a?: QuestionTr, b?: QuestionTr) => JSON.stringify({ t: a?.title ?? '', h: a?.help ?? '', o: a?.options ?? {} }) === JSON.stringify({ t: b?.title ?? '', h: b?.help ?? '', o: b?.options ?? {} })

/** 저장 직전 정리: 없는 선택지 번역 제거, 빈 값 제거. 번역을 고쳤으면 지금 한국어를 기준(basis)으로 삼는다 */
function finishTranslation(q: Question, before: Question): Question {
  const ru = q.i18n?.ru
  if (!ru) return q
  const ids = new Set(q.options.map((o) => o.id))
  const options = Object.fromEntries(Object.entries(ru.options ?? {}).filter(([k, v]) => ids.has(k) && v.trim()))
  const clean: QuestionTr = { ...(ru.title?.trim() ? { title: ru.title.trim() } : {}), ...(ru.help?.trim() ? { help: ru.help.trim() } : {}), options, basis: ru.basis }
  if (!clean.title && !clean.help && Object.keys(options).length === 0) { const { ru: _drop, ...rest } = q.i18n ?? {}; return { ...q, i18n: Object.keys(rest).length ? rest : undefined } }
  if (!sameTr(clean, before.i18n?.ru) || !clean.basis) clean.basis = koBasis(q) // 번역을 새로 쓰거나 고침 → 지금 원문 기준
  return { ...q, i18n: { ...(q.i18n ?? {}), ru: clean } }
}



/**
 * 평가표 버전 탭과 적용 범위 (D-082). 엑셀 시트처럼 용도별 평가표를 만들고 전환한다.
 * 범위는 버전 단위: 적용 평가 + 평가받는 대상자의 팀(사람)·직급을 체크(D-210 — 이전 '모두에게 동일 적용'은 전체 체크). 전체 체크는 평가 유형별 하나, 좁게 고른 평가표가 먼저.
 * 겹치면 임의로 고르지 않고 충돌 대상·버전을 보여 주고 적용 버전을 고르게 한다. 응답 있는 배정의 평가표는 바꾸지 않는다
 */
function VersionBar({ cycle, selected, onSelect }: { cycle: Cycle; selected: string; onSelect: (id: string) => void }) {
  const s = useAppState()
  const list = activeVersions(cycle)
  const cur = list.find((v) => v.templateId === selected)
  const qCount = (id: string) => cycle.templates[id]?.sections.reduce((n, x) => n + x.questions.filter((q) => q.active).length, 0) ?? 0
  const [msg, setMsg] = useState('')
  const mutC = (fn: (c: Cycle) => void) => update((d) => { const c = d.cycles.find((x) => x.id === cycle.id)!; fn(c); applyVersions(d, c) })
  const uniqueName = (base: string) => { let n = base, i = 2; while (list.some((v) => v.name === n)) n = `${base} ${i++}`; return n }
  const add = () => {
    const t = blankTemplate(uniqueName('새 평가표'))
    mutC((c) => addVersion(c, t, t.name, slotMode(c) ? slotScope([]) : { mode: 'custom', rules: [], teams: 'all', positions: 'all' }))
    onSelect(t.id); setMsg('빈 평가표를 초안으로 만들었습니다.')
  }
  const dup = () => {
    if (!cur) return
    const t = cloneTemplate(cycle.templates[cur.templateId], uniqueName(`${cur.name} 복사`))
    mutC((c) => addVersion(c, t, t.name, slotMode(c) ? slotScope([]) : { mode: 'custom', rules: [], teams: 'all', positions: 'all' })) // 복제본은 범위를 정하기 전까지 적용 안 됨
    onSelect(t.id); setMsg(`'${cur.name}'을(를) 초안으로 복제했습니다.`)
  }
  const remove = () => {
    if (!cur) return
    if (list.length <= 1) return alert('평가표는 하나 이상 있어야 합니다.')
    const used = versionUsed(s, cycle, cur.templateId)
    if (!confirm(used ? `'${cur.name}'은(는) 응답이 있어 목록에서만 숨깁니다(기존 응답·결과용 문항은 보존). 계속할까요?` : `'${cur.name}' 평가표를 삭제할까요?`)) return
    let r = ''
    update((d) => { r = deleteVersion(d, d.cycles.find((x) => x.id === cycle.id)!, cur.templateId) })
    onSelect(list.find((v) => v.templateId !== cur.templateId)!.templateId)
    setMsg(r === 'archived' ? `'${cur.name}'을(를) 목록에서 숨겼습니다.` : `'${cur.name}'을(를) 삭제했습니다.`)
  }
  return (
    <section className="panel version-bar" aria-label="평가표 버전">
      <div className="row version-head">
        <div className="version-tabs" role="tablist" aria-label="평가표 버전">
          {list.map((v) => (
            <button key={v.templateId} role="tab" aria-selected={v.templateId === selected} className={v.templateId === selected ? 'on' : ''} onClick={() => { if (confirmLeaveVersion()) onSelect(v.templateId) }}>
              {v.pending?.name ?? v.name} <span className="v-count">{qCount(v.templateId)}</span>{(v.draft || v.pending) && <span className="v-draft">초안</span>}
            </button>
          ))}
          <button className="v-add" onClick={add}>+ 버전 추가</button>
        </div>
      </div>
      {cur && <ScopeEditor key={cur.templateId} cycle={cycle} v={cur} onDup={dup} onRemove={remove} msg={msg} setMsg={setMsg} />}
      <Problems cycle={cycle} />
    </section>
  )
}
const confirmLeaveVersion = () => true

function ScopeEditor({ cycle, v, onDup, onRemove, msg, setMsg }: { cycle: Cycle; v: TemplateVersion; onDup: () => void; onRemove: () => void; msg: string; setMsg: (m: string) => void }) {
  const s = useAppState()
  // 편집 값 = 저장해 둔 초안(pending) → 없으면 지금 설정 (D-085)
  const stored = v.pending ?? { name: v.name, scope: v.scope }
  const [name, setName] = useState(stored.name)
  // D-210: 모든 평가표는 체크 방식 — 이전 '모두에게 동일 적용'(마감·확정 회차 등)은 전체 체크로 보여 줌
  const [scope, setScope] = useState<VersionScope>(() => { const sc = structuredClone(stored.scope); return sc.mode === 'all' ? { mode: 'custom', rules: sc.rules, teams: 'all', positions: 'all' } : sc })
  const [picks, setPicks] = useState<Record<string, string>>({ ...(cycle.versionPicks ?? {}) })
  const [err, setErr] = useState<string[]>([])
  const [conf, setConf] = useState<VersionProblem[]>([]) // 적용을 눌렀을 때만 계산·표시
  const dirty = name !== stored.name || JSON.stringify(scope) !== JSON.stringify(stored.scope)
  const live = !v.draft
  const arrows = !!scope.slots // D-211: 화살표(평가자 → 평가대상) 방식 회차
  const positions = positionsOf(s)
  const vName = (id: string) => cycle.versions?.find((x) => x.templateId === id)?.name ?? id
  const groups = new Map<string, { ids: string[]; n: number; who: string[] }>()
  for (const p of conf) {
    const k = pickKey(p.candidates); const g = groups.get(k) ?? { ids: [...p.candidates].sort(), n: 0, who: [] }
    g.n++; const t = cycle.targets.find((x) => x.employeeId === p.a.targetId); if (t && g.who.length < 3 && !g.who.includes(t.name)) g.who.push(t.name)
    groups.set(k, g)
  }
  const toggle = <T,>(arr: T[], x: T, on: boolean) => (on ? [...new Set([...arr, x])] : arr.filter((y) => y !== x))
  // D-125: 적용 전에 미리 — 지금 고른 조건대로 적용하면 평가표가 없어지는(또는 겹치는) 평가. 지금 상태에 이미 있는 문제는 빼고 새로 생기는 것만
  const before = applyVersions(s, structuredClone(cycle)).map((p) => `${p.kind}|${p.a.id}`)
  const preview = (() => {
    if (!dirty || (!scope.slots && !scope.rules.length)) return [] as VersionProblem[]
    const trial = withScope(cycle, v.templateId, name.trim() || v.name, scope) // 화살표는 다른 평가표에서 옮겨 옴(D-211)
    trial.versionPicks = picks
    return applyVersions(s, trial).filter((p) => (p.kind === 'none' || p.kind === 'conflict') && !before.includes(`${p.kind}|${p.a.id}`))
  })()
  const saveDraft = (quiet = false) => {
    update((d) => saveVersionDraft(d.cycles.find((x) => x.id === cycle.id)!, v.templateId, name.trim() || v.name, scope))
    if (!quiet) { setErr([]); setConf([]); setMsg('초안을 저장했습니다.') }
  }
  const apply = () => {
    let r: { errors: string[]; conflicts: VersionProblem[] } = { errors: [], conflicts: [] }
    update((d) => { r = applyVersion(d, d.cycles.find((x) => x.id === cycle.id)!, v.templateId, name, scope, picks) })
    if (r.errors.length) {
      saveDraft(true) // 적용에 실패해도 작성 내용은 초안으로 보관
      setErr(r.errors); setConf(r.conflicts); setMsg('')
      return
    }
    setErr([]); setConf([]); setMsg('적용했습니다.')
  }
  return (
    <div className="scope-editor">
      <div className="row scope-row">
        <label className="row scope-name">이름 <input type="text" aria-label="버전 이름" value={name} onChange={(e) => setName(e.target.value)} /></label>
        {/* D-210: '모두에게 동일 적용 / 직접 선택하기' 구분 없앰 — 아래 적용 평가·팀(사람)·직급을 체크 */}
        <span className="spacer" />
        <button className="btn small" onClick={onDup}>복제</button>
        <button className="btn small danger" onClick={onRemove}>삭제</button>
      </div>
      {arrows ? <SlotPicker cycle={cycle} v={v} scope={scope} setScope={setScope} /> : <div className="scope-grid">
        <fieldset className="scope-set"><legend>적용 평가</legend>
          {RULES.map((r) => <label key={r} className="check"><input type="checkbox" checked={scope.rules.includes(r)} onChange={(e) => setScope({ ...scope, rules: RULES.filter((x) => (x === r ? e.target.checked : scope.rules.includes(x))) })} /> {RULE_TEXT[r]}</label>)}
        </fieldset>
        {<>
          <PeoplePicker scope={scope} setScope={setScope} />
          <fieldset className="scope-set"><legend>적용 직급 <span className="muted small">(평가받는 사람)</span></legend>
            <label className="check"><input type="checkbox" checked={scope.positions === 'all'} onChange={(e) => setScope({ ...scope, positions: e.target.checked ? 'all' : [] })} /> 전체 직급</label>
            {positions.map((p) => <label key={p.id} className="check"><input type="checkbox" disabled={scope.positions === 'all'} checked={scope.positions === 'all' || scope.positions.includes(p.id)} onChange={(e) => setScope({ ...scope, positions: toggle(scope.positions === 'all' ? [] : scope.positions, p.id, e.target.checked) })} /> {p.name}</label>)}
          </fieldset>
        </>}
      </div>}
      {/* D-155: 공통 기본 평가표의 '이 평가표는 적용 평가 중 …' 안내는 표시하지 않음 */}
      {/* D-122: 팀·직급·사람 조건은 평가받는 사람 기준 — 팀원→팀장평가는 평가받는 사람이 팀장(평가하는 팀원이 아님) */}
      {!arrows && scope.rules.includes('upward') && <p className="muted small scope-hint">팀·직급·사람은 <b>평가받는 사람</b> 기준이에요. 상향평가는 평가받는 사람이 <b>팀장·임원</b>이라, 직급을 고를 때 '팀장'·'임원'을 넣어야 해요.</p>}
      {preview.length > 0 && (
        <div className="feedback fail scope-preview" role="status">
          ⚠ 이대로 적용하면 — {problemText(cycle, preview, s)}
          <div className="muted small">{arrows ? "이대로면 위 평가는 어느 평가표도 맡지 않아 '평가 미배치'가 돼요. 그 화살표·팀을 이 평가표나 다른 평가표에서 골라 주세요." : "이대로면 위 평가는 어느 평가표에도 체크되지 않아 '평가 미배치'가 돼요. 이 평가표에 다시 체크하거나, 그 평가를 맡을 다른 평가표에서 체크하세요(팀·직급·사람은 평가받는 사람 기준)."}</div>
        </div>
      )}
      {(
        <p className="scope-summary" role="status">
          <b>적용 대상 {scopeTargets(cycle, scope).filter((t) => arrows ? s.employees.find((e) => e.id === t.employeeId)?.active : true).length}명</b>{/* D-214: 재직 중인 사람만 */}
          {!arrows && <span className="muted"> · 이번 회차 참여자 중 {scope.employees ? `직접 선택 ${scope.employees.length}명` : scope.teams === 'all' ? '전체 팀' : `팀 ${scope.teams.length}개`}{scope.positions === 'all' ? '' : ` · 직급 ${scope.positions.length}개`} 조건을 모두 충족 · 적용 평가 {scope.rules.map((r) => RULE_TEXT[r]).join('·') || '없음'}</span>}
        </p>
      )}
      {groups.size > 0 && (
        <div className="scope-conflicts" role="alert">
          {[...groups.entries()].map(([k, g]) => (
            <div key={k} className="row">
              <span>⚠ 겹침 {g.n}건({g.who.join(', ')}{g.n > g.who.length ? ' 등' : ''}): {g.ids.map(vName).join(' · ')}</span>
              <select aria-label="적용할 버전" value={picks[k] ?? ''} onChange={(e) => setPicks({ ...picks, [k]: e.target.value })}>
                <option value="">적용 버전 선택</option>
                {g.ids.map((id) => <option key={id} value={id}>{id === v.templateId ? name || vName(id) : vName(id)}</option>)}
              </select>
            </div>
          ))}
        </div>
      )}
      {err.length > 0 && <div className="feedback fail" role="alert">{err.map((x) => <div key={x}>✕ {x}</div>)}</div>}
      <div className="row scope-actions">
        {msg && <span className="feedback ok" role="status">✓ {msg}</span>}
        {live && v.pending && !msg && <span className="muted">적용 전 초안이 있습니다 — 지금은 이전 설정으로 쓰는 중</span>}
        <span className="spacer" />
        <button className="btn small" disabled={!dirty} onClick={() => { setName(stored.name); setScope(structuredClone(stored.scope)); setErr([]); setConf([]) }}>되돌리기</button>
        <button className="btn small" disabled={!dirty} onClick={() => saveDraft()}>초안 저장</button>
        <button className="btn small primary" onClick={apply}>적용</button>
      </div>
    </div>
  )
}

/**
 * 적용 팀(D-087): 조직 관리의 팀별로 펼쳐 평가받는 사람을 직접 체크(직원 ID로 저장). 팀 머리글의 펼치기와 팀 전체 선택은 따로,
 * 접어도 선택 유지. 임원은 별도 묶음. '전체 팀'은 고정 명단이 아닌 동적 조건(새 직원 포함).
 * 이전 팀 단위 범위는 그대로 보여 주고, 사람을 바꾸는 순간 그때의 팀원 명단으로 바뀐다(그 전까지 저장값 그대로)
 */
function PeoplePicker({ scope, setScope }: { scope: VersionScope; setScope: (x: VersionScope) => void }) {
  const s = useAppState()
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const isExec = (e: (typeof s.employees)[number]) => !!(e.isExecutive || e.isCeo)
  const people = s.employees.filter((e) => e.active && (isExec(e) || !e.evalExcluded)) // 임원은 별도 묶음(평가 제외 표시와 무관하게 고를 수 있음)
  const teams = activeTeams(s)
  const leadOf = new Map(teams.map((t) => [t.id, t.leadId]))
  const order = (list: typeof people, teamId?: string) => [...list].sort((a, b) => Number(b.id === leadOf.get(teamId ?? '')) - Number(a.id === leadOf.get(teamId ?? '')) || a.name.localeCompare(b.name, 'ko'))
  const groups = [
    ...teams.map((t) => ({ key: t.id, name: t.name, list: order(people.filter((e) => !isExec(e) && e.teamId === t.id), t.id) })),
    { key: '__exec', name: '임원', list: order(people.filter(isExec)) },
  ].filter((g) => g.list.length)
  const all = scope.teams === 'all' && !scope.employees
  const legacy = !scope.employees && scope.teams !== 'all'
  const picked = (id: string) => {
    if (all) return true
    if (scope.employees) return scope.employees.includes(id)
    const e = s.employees.find((x) => x.id === id)
    return !!e && (scope.teams as string[]).includes(e.teamId)
  }
  const current = () => people.filter((e) => picked(e.id)).map((e) => e.id)
  const setPeople = (ids: string[], on: boolean) => {
    const base = scope.employees ?? current()
    const next = on ? [...new Set([...base, ...ids])] : base.filter((x) => !ids.includes(x))
    const every = people.every((e) => next.includes(e.id)) // 모두 고르면 다시 '전체 팀'으로(D-173)
    setScope({ ...scope, teams: 'all', employees: every ? undefined : next })
  }
  return (
    <fieldset className="scope-set scope-people"><legend>적용 팀</legend>
      <label className="check"><input type="checkbox" checked={all} onChange={(e) => setScope(e.target.checked ? { ...scope, teams: 'all', employees: undefined } : { ...scope, teams: 'all', employees: [] })} /> 전체 팀</label>
      {legacy && <p className="muted small scope-legacy">팀 단위로 선택된 범위입니다. 사람을 바꾸면 그때 팀원으로 직접 선택이 됩니다.</p>}
      {/* D-173: '전체 팀'이 켜져 있어도 팀별 목록을 보여 줘 팀·사람 단위로 바로 뺄 수 있게 */}
      <div className="pick-teams">
        {groups.map((g) => {
          const n = g.list.filter((e) => picked(e.id)).length
          const isOpen = !!open[g.key]
          return (
            <div key={g.key} className={`pick-team ${isOpen ? 'open' : ''} ${g.key === '__exec' ? 'exec' : ''}`}>
              <div className="pick-team-head">
                <input type="checkbox" aria-label={`${g.name} 전체 선택`} checked={n === g.list.length} ref={(el) => { if (el) el.indeterminate = n > 0 && n < g.list.length }}
                  onChange={(e) => setPeople(g.list.map((x) => x.id), e.target.checked)} />
                <button type="button" className="pick-team-toggle" aria-expanded={isOpen} onClick={() => setOpen((o) => ({ ...o, [g.key]: !o[g.key] }))}>
                  <span>{g.name}</span><span className="pick-n">{n}/{g.list.length}명</span><span className="caret" aria-hidden>▾</span>
                </button>
              </div>
              {isOpen && (
                <ul className="pick-people">
                  {g.list.map((e) => (
                    <li key={e.id}><label>
                      <input type="checkbox" checked={picked(e.id)} aria-label={`${g.name} ${e.name}`} onChange={(ev) => setPeople([e.id], ev.target.checked)} />
                      <b>{e.name}</b><span className="muted">{positionName(s, e)}</span>
                    </label></li>
                  ))}
                </ul>
              )}
            </div>
          )
        })}
      </div>
    </fieldset>
  )
}

/** 지금 회차에서 평가표를 연결할 수 없는 배정 — 충돌·평가표 없음·표시 문항 0개 (빈 평가는 제출 완료로 처리되지 않음) */
// D-122: 어떤 평가(자기·팀원→팀장·팀장·임원)에서 생겼는지와 평가받는 사람을 함께 — 고칠 평가표를 바로 알 수 있게
type Emps = Pick<AppState, 'employees'>
function problemPart(cycle: Cycle, ps: VersionProblem[], st?: Emps) {
  const names = (list: VersionProblem[]) => [...new Set(list.map((p) => st?.employees.find((e) => e.id === p.a.targetId)?.name ?? cycle.targets.find((t) => t.employeeId === p.a.targetId)?.name ?? '?'))]
  return RULES.map((r) => ({ r, list: ps.filter((p) => ctxFor(cycle, p.a).rule === r) })).filter((x) => x.list.length)
    .map(({ r, list }) => `${RULE_TEXT[r]} ${list.length}건 — 평가받는 사람 ${names(list).slice(0, 3).join(', ')}${names(list).length > 3 ? ' 등' : ''}`).join(' / ')
}
function problemText(cycle: Cycle, ps: VersionProblem[], st?: Emps) {
  const none = ps.filter((p) => p.kind === 'none'), conf = ps.filter((p) => p.kind === 'conflict')
  return [none.length ? `평가 미배치: ${problemPart(cycle, none, st)}` : '', conf.length ? `평가표 겹침: ${problemPart(cycle, conf, st)}` : ''].filter(Boolean).join(' · ')
}

function Problems({ cycle }: { cycle: Cycle }) {
  const s = useAppState()
  const probs: VersionProblem[] = applyVersions(s, structuredClone(cycle))
  if (!probs.length) return null
  const label = { conflict: '평가표 겹침(버전 선택 필요)', none: '평가 미배치', empty: '표시할 문항 0개' } // D-210: 어느 평가표에도 체크되지 않은 평가 = 평가 미배치
  const by = (k: VersionProblem['kind']) => probs.filter((p) => p.kind === k)
  const part = (ps: VersionProblem[]) => problemPart(cycle, ps, s)
  return (
    <div className="feedback fail version-problems" role="alert">
      <div>⚠ 평가표 확인 필요 — {(['conflict', 'none', 'empty'] as const).filter((k) => by(k).length).map((k) => `${label[k]}: ${part(by(k))}`).join(' · ')}</div>
      {by('none').length > 0 && <div className="muted small">평가 미배치 = 어느 평가표에도 체크되지 않은 평가예요. 그 평가를 맡을 평가표에서 적용 평가·팀(사람)·직급에 그 사람을 체크하고 적용하면 사라져요 — 팀·직급·사람은 평가받는 사람 기준(예: 상향평가는 팀장·임원).</div>}
    </div>
  )
}

/**
 * 평가자 → 평가대상 화살표(D-211): 이 평가표가 맡을 평가를 누른다. 한 화살표는 평가표 하나만 —
 * 다른 평가표가 맡은 화살표(회색, 글자 없음 — D-213)를 누르면 적용할 때 이 평가표로 옮겨 오고, 아무 평가표도 맡지 않은 화살표는 '평가 미배치'
 */
const SLOT_GROUPS: { title: React.ReactNode; keys: SlotKey[] }[] = [
  { title: <><span className="stage-no">1단계</span> 자기평가</>, keys: ['self-member', 'self-lead', 'self-exec'] },
  { title: <><span className="stage-no">2단계</span> 팀장평가</>, keys: ['lead-member'] },
  { title: <><span className="stage-no">3단계</span> 임원평가</>, keys: ['exec-member', 'exec-lead'] },
  { title: <>상향평가</>, keys: ['up-lead', 'up-exec'] },
]
function SlotPicker({ cycle, v, scope, setScope }: { cycle: Cycle; v: TemplateVersion; scope: VersionScope; setScope: (x: VersionScope) => void }) {
  const s = useAppState()
  const mine = scope.slots ?? []
  const other = (k: SlotKey) => liveVersions(cycle).find((x) => x.templateId !== v.templateId && x.scope.slots?.includes(k))
  const flip = (k: SlotKey) => setScope(slotScope(mine.includes(k) ? mine.filter((x) => x !== k) : [...mine, k], scope.teams))
  // D-256: 적용 팀(평가받는 사람의 팀) — 체크박스 중복 선택, 모두 체크 = 전체 팀
  const teams = activeTeams(s)
  const picked = (id: string) => scope.teams === 'all' || scope.teams.includes(id)
  const setTeam = (id: string, on: boolean) => {
    const cur = scope.teams === 'all' ? teams.map((x) => x.id) : scope.teams
    const next = on ? [...new Set([...cur, id])] : cur.filter((x) => x !== id)
    setScope(slotScope(mine, teams.every((x) => next.includes(x.id)) ? 'all' : next))
  }
  return (
    <>
    <fieldset className="scope-set slot-set"><legend>평가자 → 평가대상</legend>
      {SLOT_GROUPS.map((g, i) => (
        <div key={i} className="slot-row">
          <div className="slot-row-title">{g.title}</div>
          <div className="slot-btns">
            {g.keys.map((k) => {
              const sl = SLOTS.find((x) => x.key === k)!
              const on = mine.includes(k)
              const o = other(k)
              return (
                <button key={k} type="button" className={`slot-btn ${on ? 'on' : o ? 'taken' : 'free'}`} aria-pressed={on} onClick={() => flip(k)} title={`${sl.from}이(가) ${sl.to === '본인' ? '본인을' : `${sl.to}을(를)`} 평가`}>
                  <span className="slot-arrow"><b>{sl.from}</b> → <b>{sl.to}</b></span>
                  {/* D-213·D-214: 글자는 가운데, 이 평가표가 맡은 화살표는 오른쪽에 ✓만. 다른 평가표 화살표는 글자 없음, 아무도 안 맡으면 '평가 미배치' */}
                  {on && <span className="slot-check" aria-hidden>✓</span>}
                  {!on && !o && <span className="slot-state">평가 미배치</span>}
                </button>
              )
            })}
          </div>
        </div>
      ))}
    </fieldset>
    <fieldset className="scope-set team-set"><legend>적용 팀</legend>
      <div className="team-checks">
        {teams.map((tm) => <label key={tm.id} className="check"><input type="checkbox" checked={picked(tm.id)} onChange={(e) => setTeam(tm.id, e.target.checked)} /> {tm.name}</label>)}
      </div>
    </fieldset>
    </>
  )
}
