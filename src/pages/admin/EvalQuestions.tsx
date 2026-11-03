import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { update, useAppState } from '../../data/store'
import { useDirty } from '../../data/dirty'
import {
  answeredCount, appendImported, BASIC_TYPES, ctxFor, cycleHasResponses, defaultOptions, directionsFromRules, isChoice,
  newQuestion, newSection, parseQuestionTable, canImportQuestions, Q_COLUMNS, Q_REQUIRED, questionSetIds, RULE_TEXT, RULES, rulesOf, TYPE_TEXT, validateQuestion,
  type QUploadResult,
} from '../../domain/questions'
import { type AnswerValue, type Cycle, type EvaluatorRule, type JobType, type Lang, type Question, type QuestionTr, type QuestionType, type Section, type Template } from '../../domain/types'
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
import { activeVersions, liveVersions, addVersion, applyVersion, applyVersions, blankTemplate, cloneTemplate, deleteVersion, pickKey, resolveVersion, saveVersionDraft, scopeTargets, versionUsed, type VersionProblem } from '../../domain/versions'
import type { TemplateVersion, VersionScope } from '../../domain/types'

type Editing = { sectionId: string; q: Question; isNew: boolean; index?: number }

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
  // 새 문항의 적용 평가: 팀원→팀장평가만 쓰는 평가표(D-114)면 팀원→팀장평가로 시작(그 외는 기본 자기평가)
  const newFor = (ty: QuestionType): Question => {
    const v = live.versions?.find((x) => x.templateId === setId)
    const q = newQuestion(ty)
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
        <button className="btn" onClick={() => mut((x) => { x.sections.push(newSection('새 영역')) })}>+ 영역 추가</button>
        <button className="btn primary" disabled={t.sections.length === 0} onClick={() => setPicking({ sectionId: t.sections[t.sections.length - 1].id })}>+ 문항 추가</button>
      </div>
      {msg && <p className="feedback ok" role="status">✓ {msg}</p>}
      <PointsBar t={t} />
      {t.sections.length === 0 && <div className="panel pad empty-start"><p>문항이 없습니다. 영역을 추가한 뒤 문항을 넣거나 엑셀·CSV로 가져오세요.</p></div>}

      {t.sections.map((sec, si) => (
        <section className="panel q-section" key={sec.id}>
          <div className="q-sec-head">
            <input type="text" className="sec-title" aria-label="영역 이름" value={sec.title} onChange={(e) => mut((x) => { x.sections[si].title = e.target.value })} />
            <span className="muted">{sec.questions.filter((q) => q.active).length}문항</span>
            {/* 영역 배점(D-103) — 비우면 점수에 넣지 않는 영역 */}
            <label className="sec-pts">배점<input type="number" inputMode="decimal" className="no-spin" aria-label={`${sec.title} 영역 배점`} disabled={closedCycle} value={sec.points ?? ''} placeholder="—"
              onWheel={(e) => e.currentTarget.blur()} onChange={(e) => mut((x) => { x.sections[si].points = e.target.value === '' ? null : Number(e.target.value) })} />점</label>
            <SectionRu sec={sec} onChange={(fn) => mut((x) => fn(x.sections[si]))} />
            <span className="spacer" />
            {si > 0 && <button className="btn small" aria-label={`${sec.title} 영역 위로`} onClick={() => mut((x) => move(x.sections, si, -1))}>↑</button>}
            {si < t.sections.length - 1 && <button className="btn small" aria-label={`${sec.title} 영역 아래로`} onClick={() => mut((x) => move(x.sections, si, 1))}>↓</button>}
            <button className="btn small danger" onClick={() => removeSection(si)}>영역 삭제</button>
          </div>
          {(typeof sec.points === 'number' || sec.desc) && (
            <div className="sec-desc"><input type="text" aria-label={`${sec.title} 영역 설명`} placeholder="영역 설명 (예: 근태·업무집중도 등)" value={sec.desc ?? ''} onChange={(e) => mut((x) => { x.sections[si].desc = e.target.value })} /></div>
          )}
          {sec.questions.length === 0 ? <p className="empty-row">문항이 없습니다.</p> : (
            <ol className="q-list">
              {sec.questions.map((q, qi) => {
                const rules = rulesOf(q)
                const scope = [rules.map((r) => RULE_TEXT[r]).join('·'), q.jobs?.length === 1 ? `${jobName(s, q.jobs[0])}만` : '', q.targetRoles?.length === 1 ? (q.targetRoles[0] === 'lead' ? '팀장 대상' : '사원 대상') : '', q.teams?.length ? `팀 ${q.teams.length}곳만` : '', q.positions?.length ? `직급 ${q.positions.length}개만` : ''].filter(Boolean).join(' · ')
                return (
                  <li key={q.id} className={`q-row ${q.active ? '' : 'off'}`}>
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
                      {qi > 0 && <button className="btn small" aria-label="위로" onClick={() => mut((x) => move(x.sections[si].questions, qi, -1))}>↑</button>}
                      {qi < sec.questions.length - 1 && <button className="btn small" aria-label="아래로" onClick={() => mut((x) => move(x.sections[si].questions, qi, 1))}>↓</button>}
                      <button className="btn small q-edit" onClick={() => setEditing({ sectionId: sec.id, q: structuredClone(q), isNew: false })}>수정</button>
                      {q.active
                        ? <button className="btn small danger" onClick={() => removeQ(sec.id, q)}>삭제</button>
                        : <button className="btn small" onClick={() => mut((x) => { x.sections[si].questions[qi].active = true })}>다시 사용</button>}
                    </div>
                  </li>
                )
              })}
            </ol>
          )}
          <div className="q-sec-foot"><button className="q-add" onClick={() => setPicking({ sectionId: sec.id })}>+ 이 영역에 문항 추가</button></div>
        </section>
      ))}

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
          t={t} editing={editing} answered={editing.isNew ? 0 : answered(editing.q.id)}
          onClose={() => setEditing(null)}
          onSave={(q, sectionId) => {
            mut((x) => {
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
      {importing && <Import cycle={live} t={t} onClose={() => setImporting(false)} onDone={(n) => { setImporting(false); setMsg(`문항 ${n}개를 가져왔습니다.`) }} mut={mut} />}
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

function QuestionEditor({ t, editing, answered, onClose, onSave }: {
  t: Template; editing: Editing; answered: number; onClose: () => void; onSave: (q: Question, sectionId: string) => void
}) {
  const [q, setQ] = useState<Question>(editing.q)
  const [sectionId, setSectionId] = useState(editing.sectionId)
  const s = useAppState()
  const [errors, setErrors] = useState<string[]>([])
  const original = JSON.stringify(editing.q) + editing.sectionId
  useDirty(JSON.stringify(q) + sectionId !== original)
  const locked = answered > 0 // 응답이 있으면 의미가 바뀌는 변경(유형·선택지 삭제·점수)을 막는다
  const set = (patch: Partial<Question>) => setQ({ ...q, ...patch })
  const rules = rulesOf(q)
  const setRules = (r: EvaluatorRule[]) => set({ rules: r, directions: directionsFromRules(r) })
  const jobs = q.jobs?.length ? q.jobs : (['office', 'production'] as JobType[])
  const roles = q.targetRoles?.length ? q.targetRoles : (['member', 'lead'] as ('member' | 'lead')[])
  const typeChoices: QuestionType[] = q.type === 'grade' ? [...BASIC_TYPES, 'grade'] : BASIC_TYPES
  const close = () => { if (JSON.stringify(q) + sectionId === original || confirm('저장하지 않은 변경이 있습니다. 닫을까요?')) onClose() }
  const save = () => {
    const e = validateQuestion(q)
    setErrors(e)
    if (!e.length) onSave(finishTranslation({ ...q, title: q.title.trim() }, editing.q), sectionId) // 러시아어가 비어 있어도 저장 가능
  }
  return (
    <Modal title={editing.isNew ? `문항 추가 — ${TYPE_TEXT[q.type]}` : '문항 수정'} onClose={close}>
      {locked && <p className="save-note">응답 {answered}건이 있는 문항이라 유형·선택지 삭제·점수는 바꿀 수 없습니다. 문구 수정과 선택지 추가는 가능합니다.</p>}
      <div className="q-editor">
        <label className="field">질문<input type="text" value={q.title} autoFocus onChange={(e) => set({ title: e.target.value })} /></label>
        <label className="field">도움말 <span className="muted">(선택)</span><input type="text" value={q.help} onChange={(e) => set({ help: e.target.value })} /></label>
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
            <select value={sectionId} onChange={(e) => setSectionId(e.target.value)}>
              {t.sections.map((x) => <option key={x.id} value={x.id}>{x.title}</option>)}
            </select>
          </label>
        </div>
        <label className="check"><input type="checkbox" checked={q.required} onChange={(e) => set({ required: e.target.checked })} /> 필수 응답</label>
        {/* 문항 배점(D-103): 영역 안 문항 비중(선택형), 서술형은 채점 범위(0~배점) */}
        <label className="field q-pts">문항 배점 <span className="muted">(선택 · 영역 안 비중, 서술형은 채점 만점)</span>
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
              <div className="opt-row" key={o.id}>
                <input type="text" aria-label={`선택지 ${i + 1}`} value={o.label} onChange={(e) => set({ options: q.options.map((x, k) => (k === i ? { ...x, label: e.target.value } : x)) })} />
                {q.purpose === 'score' && q.type !== 'grade' && (
                  <input type="number" className="score" aria-label={`선택지 ${i + 1} 점수`} placeholder="점수" disabled={locked} value={o.value ?? ''}
                    onChange={(e) => set({ options: q.options.map((x, k) => (k === i ? { ...x, value: e.target.value === '' ? null : Number(e.target.value) } : x)) })} />
                )}
                <button className="btn small" aria-label="선택지 위로" disabled={i === 0} onClick={() => { const o2 = [...q.options]; [o2[i - 1], o2[i]] = [o2[i], o2[i - 1]]; set({ options: o2 }) }}>↑</button>
                <button className="btn small danger" disabled={locked || q.options.length <= 2} onClick={() => set({ options: q.options.filter((_, k) => k !== i) })}>삭제</button>
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

        <RuEditor q={q} onChange={(ru) => set({ i18n: ru ? { ...(q.i18n ?? {}), ru } : undefined })} />

        <fieldset className="sub-settings">
          <legend>적용 평가</legend>
          {RULES.map((r) => (
            <label key={r} className="check"><input type="checkbox" checked={rules.includes(r)} onChange={(e) => setRules(e.target.checked ? [...rules, r] : rules.filter((x) => x !== r))} /> {RULE_TEXT[r]}</label>
          ))}
        </fieldset>
        {/* 기본 적용 범위는 평가표 버전 단위(D-082). 아래는 꼭 필요할 때만 쓰는 문항별 추가 제한 — 버전 범위와 함께 둘 다 만족해야 보임 */}
        <details className="q-extra" open={!!(q.jobs?.length || q.targetRoles?.length || q.teams?.length || q.positions?.length)}>
        <summary>추가 설정 <span className="muted">선택 · 문항별 제한</span></summary>
        <div className="grid form-grid">
          <fieldset className="sub-settings">
            <legend>직무</legend>
            {(['office', 'production'] as JobType[]).map((j) => (
              <label key={j} className="check"><input type="checkbox" checked={jobs.includes(j)} onChange={(e) => {
                const next = e.target.checked ? [...jobs, j] : jobs.filter((x) => x !== j)
                set({ jobs: next.length === 2 ? [] : next })
              }} /> {jobName(s, j)}</label>
            ))}
          </fieldset>
          <fieldset className="sub-settings">
            <legend>평가받는 사람</legend>
            {(['member', 'lead'] as const).map((r) => (
              <label key={r} className="check"><input type="checkbox" checked={roles.includes(r)} onChange={(e) => {
                const next = e.target.checked ? [...roles, r] : roles.filter((x) => x !== r)
                set({ targetRoles: next.length === 2 ? [] : next })
              }} /> {r === 'lead' ? '팀장' : '사원'}</label>
            ))}
          </fieldset>
          <fieldset className="sub-settings">
            <legend>적용 팀 <span className="muted">평가받는 사람</span></legend>
            {activeTeams(s).map((tm) => (
              <label key={tm.id} className="check"><input type="checkbox" checked={!!q.teams?.includes(tm.id)} onChange={(e) => {
                const next = e.target.checked ? [...(q.teams ?? []), tm.id] : (q.teams ?? []).filter((x) => x !== tm.id)
                set({ teams: next.length ? next : undefined })
              }} /> {tm.name}</label>
            ))}
            <span className="muted">비우면 버전 범위 그대로</span>
          </fieldset>
          <fieldset className="sub-settings">
            <legend>적용 직급 <span className="muted">평가받는 사람</span></legend>
            {positionsOf(s).map((p) => (
              <label key={p.id} className="check"><input type="checkbox" checked={!!q.positions?.includes(p.id)} onChange={(e) => {
                const next = e.target.checked ? [...(q.positions ?? []), p.id] : (q.positions ?? []).filter((x) => x !== p.id)
                set({ positions: next.length ? next : undefined })
              }} /> {p.name}</label>
            ))}
            <span className="muted">비우면 버전 범위 그대로</span>
          </fieldset>
        </div>
        </details>
      </div>
      {errors.length > 0 && <div className="feedback fail" role="alert">{errors.map((e) => <div key={e}>✕ {e}</div>)}</div>}
      <div className="row" style={{ marginTop: 14 }}><span className="spacer" /><button className="btn primary" onClick={save}>{editing.isNew ? '추가' : '저장'}</button></div>
    </Modal>
  )
}

/**
 * 미리보기 (D-061): 직원 응답 화면과 같은 페이지 흐름(ResponsePager)을 그대로 쓴다.
 * 답변·진행 상태는 이 창의 메모리에만 있고 응답 저장소·제출 상태·진행 현황·점수에 쓰지 않는다.
 * 평가 유형·직무·대상을 바꾸면 문항과 화면 구성을 다시 계산하고 처음부터 시작, 모바일·PC 전환은 폭만 바꾼다.
 */
function Preview({ t: current, cycle, onClose }: { t: Template; cycle: Cycle; onClose: () => void }) {
  const [rule, setRule] = useState<EvaluatorRule>('self')
  const s = useAppState()
  const [job0, setJob] = useState<JobType>('office')
  const [lead, setLead] = useState(false)
  const [mobile, setMobile] = useState(true)
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
  const res = versioned && !draftPreview ? resolveVersion(cycle, { rule, teamId: team, positionId: pos, employeeId: who || undefined, jobType: job }) : null
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
          <div className="seg" role="group" aria-label="화면 폭">
            <button className={mobile ? 'on' : ''} onClick={() => setMobile(true)}>모바일</button>
            <button className={!mobile ? 'on' : ''} onClick={() => setMobile(false)}>PC</button>
          </div>
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

type QLoaded = { file: string; sheets: Sheet[]; sheet: number }

/**
 * 문항 일괄 업로드(D-118) — 조직 관리 명단 업로드와 같은 흐름: 파일 선택(.xlsx/.csv, 여러 시트면 시트 선택) → 표 미리보기·행별 검증 →
 * 오류가 하나라도 있으면 아무것도 넣지 않음(부분 등록 없음) → 추가(같은 이름의 영역 뒤, 없으면 새 영역) 또는 교체(응답 없는 평가만)
 */
function Import({ cycle, t, onClose, onDone, mut }: { cycle: Cycle; t: Template; onClose: () => void; onDone: (n: number) => void; mut: (fn: (t: Template) => void) => void }) {
  const s = useAppState()
  const [loaded, setLoaded] = useState<QLoaded | null>(null)
  const [readErr, setReadErr] = useState('')
  const [mode, setMode] = useState<'append' | 'replace'>('append')
  const [inputKey, setInputKey] = useState(0)
  const hasResp = cycleHasResponses(s, cycle)
  // 적용평가 칸이 비었을 때: 팀원→팀장평가만 쓰는 평가표면 팀원→팀장평가, 그 외 자기평가(문항 추가와 같은 기본값)
  const v = cycle.versions?.find((x) => x.templateId === t.id)
  const defRules: EvaluatorRule[] = v && v.scope.rules.length === 1 && v.scope.rules[0] === 'upward' ? ['upward'] : ['self']
  const table = loaded?.sheets[loaded.sheet]?.rows ?? null
  // 이 평가표 버전의 적용 평가와 겹치지 않는 문항은 어디에도 보이지 않으므로 행 오류로(예: 공통 평가표에 팀원→팀장평가 문항)
  const res: QUploadResult | null = table ? (() => {
    const r = parseQuestionTable(table, defRules)
    const scope = v?.scope.rules
    if (scope?.length) for (const row of r.rows) {
      const q = row.question
      if (q && !rulesOf(q).some((x) => scope.includes(x))) { row.errors.push(`적용평가: 이 평가표는 ${scope.map((x) => RULE_TEXT[x]).join('·')}용 — 맞는 평가표에 올리세요`); row.question = null }
    }
    return r
  })() : null
  const ok = res?.rows.filter((r) => r.question) ?? []
  const bad = res?.rows.filter((r) => !r.question) ?? []
  const pick = async (f: File | undefined) => {
    setReadErr(''); setLoaded(null)
    if (!f) return
    const r = await readRosterFile(f.name, new Uint8Array(await f.arrayBuffer())) // 명단 업로드와 같은 파일 읽기(XLSX 직접 해석·CSV 글자 판별)
    if (!r.ok) return setReadErr(r.error)
    setLoaded({ file: f.name, sheets: r.sheets, sheet: 0 })
  }
  const apply = () => {
    if (!res || !canImportQuestions(res)) return
    if (mode === 'replace' && !confirm(`기존 문항을 모두 지우고 ${ok.length}개로 교체할까요?`)) return
    mut((x) => {
      if (mode === 'replace') x.sections = []
      appendImported(x, ok)
    })
    onDone(ok.length)
  }
  const reset = () => { setLoaded(null); setReadErr(''); setInputKey((k) => k + 1) }
  return (
    <Modal title="문항 일괄 업로드" onClose={onClose} wide>
      <div className="upload q-upload">
        <p className="muted upload-cols">필수 열: {Q_REQUIRED.join(' · ')} · 선택 열: {Q_COLUMNS.filter((c) => !(Q_REQUIRED as readonly string[]).includes(c)).join(' · ')} · 여러 값은 | 로 구분</p>
        <div className="row upload-pick">
          <label className="btn primary file-btn">
            파일 선택
            <input key={inputKey} type="file" accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv" onChange={(e) => pick(e.target.files?.[0])} />
          </label>
          <span className="muted">{loaded ? loaded.file : '엑셀(.xlsx) 또는 CSV(.csv)'}</span>
          {loaded && loaded.sheets.length > 1 && (
            <label className="row sheet-pick">시트
              <select value={loaded.sheet} onChange={(e) => setLoaded({ ...loaded, sheet: Number(e.target.value) })}>
                {loaded.sheets.map((sh, i) => <option key={i} value={i}>{sh.name}</option>)}
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
              <span>등록 가능 <b>{ok.length}</b></span>
              <span className={bad.length ? 'err' : ''}>오류 <b>{bad.length}</b>행</span>
              {res.ignored.length > 0 && <span className="muted">쓰지 않는 열(등록 안 함): {res.ignored.join(', ')}</span>}
            </div>
            <fieldset className="sub-settings">
              <legend>가져오기 방식</legend>
              <label className="check"><input type="radio" name="qmode" checked={mode === 'append'} onChange={() => setMode('append')} /> 추가 (기존 문항 뒤에, 같은 이름의 영역에 넣음)</label>
              <label className="check"><input type="radio" name="qmode" disabled={hasResp} checked={mode === 'replace'} onChange={() => setMode('replace')} /> 교체 (기존 문항 모두 삭제)</label>
              {hasResp && <span className="muted">응답이 있는 평가라 교체할 수 없습니다.</span>}
            </fieldset>
            <div className="table-wrap upload-preview" tabIndex={0}>
              <table className="tbl">
                <thead><tr><th className="num">행</th><th>영역</th><th>질문</th><th>유형</th><th>적용평가</th><th>확인</th></tr></thead>
                <tbody>
                  {res.rows.length === 0 ? <tr><td colSpan={6} className="empty-row">머리글 아래에 문항 행이 없습니다.</td></tr> : res.rows.map((r) => (
                    <tr key={r.line} className={r.errors.length ? 'row-err' : ''}>
                      <td className="num">{r.line}</td>
                      <td>{r.section || <span className="muted">(빈 칸)</span>}</td>
                      <td>{r.question?.title ?? <span className="muted">—</span>}</td>
                      <td>{r.question ? TYPE_TEXT[r.question.type] : '—'}</td>
                      <td>{r.question ? rulesOf(r.question).map((x) => RULE_TEXT[x]).join('·') : '—'}</td>
                      <td>{r.errors.length ? r.errors.map((e, i) => <div key={i} className="err-msg">{e}</div>) : <><span className="chip submitted">✓</span>{r.notes?.map((n, i) => <div key={i} className="muted small">{n}</div>)}</>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="row" style={{ marginTop: 12 }}>
              <button className="btn primary" disabled={!canImportQuestions(res) || (mode === 'replace' && hasResp)} onClick={apply}>{ok.length}개 {mode === 'replace' ? '교체' : '추가'}</button>
              <button className="btn" onClick={reset}>다른 파일</button>
              {bad.length > 0 && <span className="feedback fail">오류가 있어 등록할 수 없습니다.</span>}
            </div>
          </>
        )}
      </div>
    </Modal>
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

function RuEditor({ q, onChange }: { q: Question; onChange: (ru: QuestionTr | undefined) => void }) {
  const ru = q.i18n?.ru ?? {}
  const review = needsReview(q)
  const filledCount = (ru.title?.trim() ? 1 : 0) + Object.values(ru.options ?? {}).filter((v) => v.trim()).length
  const setRu = (patch: Partial<QuestionTr>) => onChange({ ...ru, ...patch })
  return (
    <details className="sub-settings q-tr" open={review || undefined}>
      <summary>
        러시아어 번역
        {review ? <span className="chip draft tag">번역 재확인 필요</span> : !ru.title?.trim() ? <span className="muted"> · 미입력 (한국어로 표시)</span> : <span className="muted"> · 입력됨</span>}
      </summary>
      {review && (
        <p className="save-note">한국어 원문이 번역 이후 바뀌었습니다. 번역을 확인해 고치거나 <button type="button" className="link-btn" onClick={() => setRu({ basis: koBasis(q) })}>그대로 확인</button>하세요.</p>
      )}
      <label className="field">질문 (러시아어)<input type="text" lang="ru" value={ru.title ?? ''} placeholder="비우면 한국어로 표시" onChange={(e) => setRu({ title: e.target.value })} /></label>
      {(q.help || ru.help) && <label className="field">도움말 (러시아어)<input type="text" lang="ru" value={ru.help ?? ''} placeholder="비우면 한국어로 표시" onChange={(e) => setRu({ help: e.target.value })} /></label>}
      {q.options.length > 0 && (
        <div className="tr-opts">
          {q.options.map((o, i) => (
            <label key={o.id} className="field tr-opt">
              <span>선택지 {i + 1} <span className="muted">· {o.label}</span></span>
              <input type="text" lang="ru" aria-label={`선택지 ${i + 1} 러시아어`} value={ru.options?.[o.id] ?? ''} placeholder="비우면 한국어로 표시"
                onChange={(e) => setRu({ options: { ...(ru.options ?? {}), [o.id]: e.target.value } })} />
            </label>
          ))}
        </div>
      )}
      <p className="muted tr-count">입력 {filledCount}개 · 저장해 둔 번역문만 표시합니다(자동 번역 없음)</p>
    </details>
  )
}

/** 평가영역 이름의 러시아어 — 영역 머리글에서 펼쳐 입력 */
function SectionRu({ sec, onChange }: { sec: Section; onChange: (fn: (s: Section) => void) => void }) {
  const [open, setOpen] = useState(false)
  const v = sec.i18n?.ru?.title ?? ''
  const review = sectionNeedsReview(sec)
  return (
    <span className="sec-ru">
      <button type="button" className={`btn small ${v ? '' : 'ghost'}`} aria-expanded={open} aria-label={`${sec.title} 영역 러시아어 이름`} onClick={() => setOpen(!open)}>
        RU{review && <span className="chip draft tag">재확인</span>}
      </button>
      {open && (
        <span className="sec-ru-edit">
          <input type="text" lang="ru" aria-label={`${sec.title} 영역 이름 (러시아어)`} placeholder="러시아어 이름 (비우면 한국어)" value={v}
            onChange={(e) => onChange((x) => { const t = e.target.value; x.i18n = t.trim() ? { ...(x.i18n ?? {}), ru: { title: t, basis: x.title } } : undefined })} />
          {review && <button type="button" className="btn small" onClick={() => onChange((x) => { if (x.i18n?.ru) x.i18n.ru.basis = x.title })}>그대로 확인</button>}
        </span>
      )}
    </span>
  )
}

/**
 * 평가표 버전 탭과 적용 범위 (D-082). 엑셀 시트처럼 용도별 평가표를 만들고 전환한다.
 * 범위는 버전 단위: 모두에게 동일 적용(공통 기본, 평가 유형별 하나) / 직접 선택(평가받는 대상자의 팀·직급 + 평가 유형).
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
    mutC((c) => addVersion(c, t, t.name, { mode: 'custom', rules: [], teams: 'all', positions: 'all' }))
    onSelect(t.id); setMsg('빈 평가표를 초안으로 만들었습니다.')
  }
  const dup = () => {
    if (!cur) return
    const t = cloneTemplate(cycle.templates[cur.templateId], uniqueName(`${cur.name} 복사`))
    mutC((c) => addVersion(c, t, t.name, { mode: 'custom', rules: [], teams: 'all', positions: 'all' })) // 복제본은 범위를 정하기 전까지 적용 안 됨
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
  const [scope, setScope] = useState<VersionScope>(structuredClone(stored.scope))
  const [picks, setPicks] = useState<Record<string, string>>({ ...(cycle.versionPicks ?? {}) })
  const [err, setErr] = useState<string[]>([])
  const [conf, setConf] = useState<VersionProblem[]>([]) // 적용을 눌렀을 때만 계산·표시
  const dirty = name !== stored.name || JSON.stringify(scope) !== JSON.stringify(stored.scope)
  const live = !v.draft
  const positions = positionsOf(s)
  const vName = (id: string) => cycle.versions?.find((x) => x.templateId === id)?.name ?? id
  const groups = new Map<string, { ids: string[]; n: number; who: string[] }>()
  for (const p of conf) {
    const k = pickKey(p.candidates); const g = groups.get(k) ?? { ids: [...p.candidates].sort(), n: 0, who: [] }
    g.n++; const t = cycle.targets.find((x) => x.employeeId === p.a.targetId); if (t && g.who.length < 3 && !g.who.includes(t.name)) g.who.push(t.name)
    groups.set(k, g)
  }
  const toggle = <T,>(arr: T[], x: T, on: boolean) => (on ? [...new Set([...arr, x])] : arr.filter((y) => y !== x))
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
        <fieldset className="row scope-mode">
          <legend className="sr-only">적용 방식</legend>
          <label className="check"><input type="radio" name="scope-mode" checked={scope.mode === 'all'} onChange={() => setScope({ ...scope, mode: 'all', teams: 'all', positions: 'all', employees: undefined })} /> 모두에게 동일 적용</label>
          <label className="check"><input type="radio" name="scope-mode" checked={scope.mode === 'custom'} onChange={() => setScope({ ...scope, mode: 'custom' })} /> 직접 선택하기</label>
        </fieldset>
        <span className="spacer" />
        <button className="btn small" onClick={onDup}>복제</button>
        <button className="btn small danger" onClick={onRemove}>삭제</button>
      </div>
      <div className="scope-grid">
        <fieldset className="scope-set"><legend>적용 평가</legend>
          {RULES.map((r) => <label key={r} className="check"><input type="checkbox" checked={scope.rules.includes(r)} onChange={(e) => setScope({ ...scope, rules: RULES.filter((x) => (x === r ? e.target.checked : scope.rules.includes(x))) })} /> {RULE_TEXT[r]}</label>)}
        </fieldset>
        {scope.mode === 'custom' && <>
          <PeoplePicker scope={scope} setScope={setScope} />
          <fieldset className="scope-set"><legend>적용 직급 <span className="muted small">(평가받는 사람)</span></legend>
            <label className="check"><input type="checkbox" checked={scope.positions === 'all'} onChange={(e) => setScope({ ...scope, positions: e.target.checked ? 'all' : [] })} /> 전체 직급</label>
            {positions.map((p) => <label key={p.id} className="check"><input type="checkbox" disabled={scope.positions === 'all'} checked={scope.positions === 'all' || scope.positions.includes(p.id)} onChange={(e) => setScope({ ...scope, positions: toggle(scope.positions === 'all' ? [] : scope.positions, p.id, e.target.checked) })} /> {p.name}</label>)}
          </fieldset>
        </>}
      </div>
      {/* D-122: 팀·직급·사람 조건은 평가받는 사람 기준 — 팀원→팀장평가는 평가받는 사람이 팀장(평가하는 팀원이 아님) */}
      {scope.mode === 'custom' && scope.rules.includes('upward') && <p className="muted small scope-hint">팀·직급·사람은 <b>평가받는 사람</b> 기준이에요. 팀원→팀장평가는 평가받는 사람이 <b>팀장</b>이라, 직급을 고를 때 '팀장'을 넣어야 해요.</p>}
      {scope.mode === 'custom' && (
        <p className="scope-summary" role="status">
          <b>적용 대상(평가받는 사람) {scopeTargets(cycle, scope).length}명</b>
          <span className="muted"> · 이번 회차 참여자 중 {scope.employees ? `직접 선택 ${scope.employees.length}명` : scope.teams === 'all' ? '전체 팀' : `팀 ${scope.teams.length}개`}{scope.positions === 'all' ? '' : ` · 직급 ${scope.positions.length}개`} 조건을 모두 충족 · 적용 평가 {scope.rules.map((r) => RULE_TEXT[r]).join('·') || '없음'}</span>
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
    setScope({ ...scope, teams: 'all', employees: next })
  }
  return (
    <fieldset className="scope-set scope-people"><legend>적용 팀</legend>
      <label className="check"><input type="checkbox" checked={all} onChange={(e) => setScope(e.target.checked ? { ...scope, teams: 'all', employees: undefined } : { ...scope, teams: 'all', employees: [] })} /> 전체 팀</label>
      {legacy && <p className="muted small scope-legacy">팀 단위로 선택된 범위입니다. 사람을 바꾸면 그때 팀원으로 직접 선택이 됩니다.</p>}
      {!all && (
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
      )}
    </fieldset>
  )
}

/** 지금 회차에서 평가표를 연결할 수 없는 배정 — 충돌·평가표 없음·표시 문항 0개 (빈 평가는 제출 완료로 처리되지 않음) */
function Problems({ cycle }: { cycle: Cycle }) {
  const s = useAppState()
  const probs: VersionProblem[] = applyVersions(s, structuredClone(cycle))
  if (!probs.length) return null
  const label = { conflict: '평가표 겹침(버전 선택 필요)', none: '적용할 평가표 없음', empty: '표시할 문항 0개' }
  const by = (k: VersionProblem['kind']) => probs.filter((p) => p.kind === k)
  const names = (ps: VersionProblem[]) => [...new Set(ps.map((p) => cycle.targets.find((t) => t.employeeId === p.a.targetId)?.name ?? '?'))]
  // D-122: 어떤 평가(자기·팀원→팀장·팀장·임원)에서 생겼는지와 평가받는 사람을 함께 — 고칠 평가표를 바로 알 수 있게
  const part = (ps: VersionProblem[]) => RULES.map((r) => ({ r, list: ps.filter((p) => ctxFor(cycle, p.a).rule === r) })).filter((x) => x.list.length)
    .map(({ r, list }) => `${RULE_TEXT[r]} ${list.length}건 — 평가받는 사람 ${names(list).slice(0, 3).join(', ')}${names(list).length > 3 ? ' 등' : ''}`).join(' / ')
  return (
    <div className="feedback fail version-problems" role="alert">
      <div>⚠ 평가표 확인 필요 — {(['conflict', 'none', 'empty'] as const).filter((k) => by(k).length).map((k) => `${label[k]}: ${part(by(k))}`).join(' · ')}</div>
      {by('none').length > 0 && <div className="muted small">해당 평가에 쓸 평가표의 적용 범위를 확인하세요 — 팀·직급·사람 조건은 평가받는 사람 기준입니다(예: 팀원→팀장평가는 팀장). '모두에게 동일 적용'으로 두거나 조건에 그 사람을 넣고 적용하면 사라집니다.</div>}
    </div>
  )
}
