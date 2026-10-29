import { useRef, useState } from 'react'
import { simulatedSave, useAppState } from '../data/store'
import { currentAccount, sessionFor } from '../data/auth'
import type { AnswerValue, Lang } from '../domain/types'
import { cycleClosed } from '../domain/progress'

export type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error'

/**
 * 응답 작성 상태. 목업은 지연 후 localStorage에 가상 저장한다.
 * "저장됨"은 저장 함수가 성공한 뒤에만 표시한다 (실서비스: 서버 응답 성공 시).
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

  const setAnswer = (qid: string, v: AnswerValue) => {
    if (submitted || closed) return
    setAnswers((a) => ({ ...a, [qid]: v }))
    setSaveState('dirty')
  }

  const write = async (status: 'draft' | 'submitted', failRate = 0) => {
    if (closed) return false // 마감 회차: 저장·제출 시도 자체를 하지 않음
    if (busy.current) return false // 중복 클릭 방지 (실서비스: 서버 멱등 처리·DB 유일성 제약)
    busy.current = true
    setSaveState('saving')
    try {
      await simulatedSave((d) => {
        // 저장·제출 직전에 최신 조직 데이터로 다시 확인: 로그인한 직원이 삭제됐거나 이 배정의 평가자가 아니면 막는다
        const acc = currentAccount()
        const ses = acc ? sessionFor(d, acc) : null
        const a = d.cycles.flatMap((c) => c.assignments).find((x) => x.id === assignmentId)
        if (!ses || !a || a.evaluatorId !== ses.personaId || a.excluded) throw new Error('blocked')
        // 저장 직전 최신 저장 상태로 마감 확인 — 직접 주소·열어 둔 화면·자동 저장 모두 막음(기존 임시저장·제출 응답은 그대로)
        if (cycleClosed(d.cycles.find((c) => c.assignments.some((x) => x.id === assignmentId)))) throw new Error('closed')
        const cur = d.responses[assignmentId]
        if (cur?.status === 'submitted') return // 이미 제출된 응답은 덮어쓰지 않음
        const now = new Date().toISOString()
        d.responses[assignmentId] = { assignmentId, answers, status, savedAt: now, submittedAt: status === 'submitted' ? now : null, lang }
      }, failRate)
      setSaveState('saved')
      return true
    } catch {
      setSaveState('error')
      return false
    } finally {
      busy.current = false
    }
  }

  return { answers, setAnswer, saveState, submitted, closed, existing, saveDraft: (failRate = 0) => write('draft', failRate), submit: () => write('submitted') }
}
