import { useEffect, useRef, useState } from 'react'
import { simulatedSave, update, useAppState } from '../data/store'
import { currentAccount, sessionFor } from '../data/auth'
import type { AnswerValue, AppState, Lang } from '../domain/types'
import { cycleClosed } from '../domain/progress'

export type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error'

/** 아무것도 입력하지 않은 답(빈 글·선택 없음) — 이때 임시저장은 '작성 중'을 만들지 않는다(D-222) */
const isBlank = (answers: Record<string, AnswerValue>) => Object.values(answers).every((v) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '') || (Array.isArray(v) && v.length === 0))
/** 입력이 멈추고 이만큼 지나면 자동 저장(D-222) */
const AUTOSAVE_MS = 800

/**
 * 응답 작성 상태. 목업은 지연 후 localStorage에 저장한다.
 * "저장됨"은 저장 함수가 성공한 뒤에만 표시한다 (실서비스: 서버 응답 성공 시).
 * D-222: 입력하면 잠시 뒤 자동 임시저장, 화면을 나가거나 닫을 때도 바로 저장. 아무것도 입력하지 않았으면 저장해도 '작성 중'이 되지 않고 기본 상태 그대로
 */
export function useResponseEditor(assignmentId: string, lang: Lang = 'ko') {
  const s = useAppState()
  const existing = s.responses[assignmentId]
  const [answers, setAnswers] = useState<Record<string, AnswerValue>>(() => ({ ...(existing?.answers ?? {}) }))
  const [saveState, setSaveState] = useState<SaveState>(existing ? 'saved' : 'idle')
  const busy = useRef(false)
  const submitted = existing?.status === 'submitted'
  // 마감·확정 회차(D-093): 저장된 회차 상태 기준. 열어 둔 화면에서도 상태가 바뀌면 바로 반영(저장소 구독)
  const closed = cycleClosed(s.cycles.find((c) => c.assignments.some((a) => a.id === assignmentId)))
  const latest = useRef({ answers, dirty: false })
  latest.current = { answers, dirty: saveState === 'dirty' }

  const setAnswer = (qid: string, v: AnswerValue) => {
    if (submitted || closed) return
    setAnswers((a) => ({ ...a, [qid]: v }))
    setSaveState('dirty')
  }

  /** 저장 내용 반영(저장 직전 확인 포함) — 지연 저장·즉시 저장 공통 */
  const apply = (d: AppState, ans: Record<string, AnswerValue>, status: 'draft' | 'submitted') => {
    // 저장·제출 직전에 최신 조직 데이터로 다시 확인: 로그인한 직원이 삭제됐거나 이 배정의 평가자가 아니면 막는다
    const acc = currentAccount()
    const ses = acc ? sessionFor(d, acc) : null
    const a = d.cycles.flatMap((c) => c.assignments).find((x) => x.id === assignmentId)
    if (!ses || !a || a.evaluatorId !== ses.personaId || a.excluded) throw new Error('blocked')
    // 저장 직전 최신 저장 상태로 마감 확인 — 직접 주소·열어 둔 화면·자동 저장 모두 막음(기존 임시저장·제출 응답은 그대로)
    if (cycleClosed(d.cycles.find((c) => c.assignments.some((x) => x.id === assignmentId)))) throw new Error('closed')
    const cur = d.responses[assignmentId]
    if (cur?.status === 'submitted') return // 이미 제출된 응답은 덮어쓰지 않음
    if (status === 'draft' && isBlank(ans)) { if (cur) delete d.responses[assignmentId]; return } // 입력 없음 → 기본 상태(미완료) 그대로
    const now = new Date().toISOString()
    d.responses[assignmentId] = { assignmentId, answers: ans, status, savedAt: now, submittedAt: status === 'submitted' ? now : null, lang }
  }

  const write = async (status: 'draft' | 'submitted', failRate = 0) => {
    if (closed) return false // 마감 회차: 저장·제출 시도 자체를 하지 않음
    if (busy.current) return false // 중복 클릭 방지 (실서비스: 서버 멱등 처리·DB 유일성 제약)
    busy.current = true
    const ans = latest.current.answers
    setSaveState('saving')
    try {
      await simulatedSave((d) => apply(d, ans, status), failRate)
      // 저장 중에 더 입력했으면 다시 저장할 수 있게 '변경 있음'으로, 빈 임시저장은 기본 상태로
      setSaveState(latest.current.answers !== ans ? 'dirty' : status === 'draft' && isBlank(ans) ? 'idle' : 'saved')
      return true
    } catch {
      setSaveState('error')
      return false
    } finally {
      busy.current = false
    }
  }

  // 자동 임시저장: 입력이 멈추면 잠시 뒤
  useEffect(() => {
    if (saveState !== 'dirty' || submitted || closed) return
    const id = window.setTimeout(() => { void write('draft') }, AUTOSAVE_MS)
    return () => window.clearTimeout(id)
  }, [answers, saveState]) // eslint-disable-line react-hooks/exhaustive-deps

  // 화면을 나가거나(다른 화면으로 이동) 창을 닫을 때: 저장 안 된 입력이 있으면 바로 저장
  useEffect(() => {
    const flush = () => {
      if (!latest.current.dirty || submitted || closed) return
      try { update((d) => apply(d, latest.current.answers, 'draft')) } catch { /* 막힌 저장은 무시 */ }
      latest.current.dirty = false
    }
    window.addEventListener('beforeunload', flush)
    window.addEventListener('pagehide', flush)
    return () => { window.removeEventListener('beforeunload', flush); window.removeEventListener('pagehide', flush); flush() }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return { answers, setAnswer, saveState, submitted, closed, existing, saveDraft: (failRate = 0) => write('draft', failRate), submit: () => write('submitted') }
}
