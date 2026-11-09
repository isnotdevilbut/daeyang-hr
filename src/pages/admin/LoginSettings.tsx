// 조직 관리 → 로그인 설정(프로토타입): 직원 로그인 규칙 안내, 관리자 아이디·비밀번호 바꾸기, 전체 데이터 초기화
import { useEffect, useState } from 'react'
import { resetDemo, useAppState } from '../../data/store'
import { adminLoginId, saveAdminLogin } from '../../data/auth'
import { DEMO_ADMIN_PW } from '../../data/remote'
import { Modal } from '../../components/ui'

export default function LoginSettings() {
  const s = useAppState()
  const demo = !!s.demo
  const [curId, setCurId] = useState('')
  const [id, setId] = useState('')
  const [pw1, setPw1] = useState('')
  const [pw2, setPw2] = useState('')
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [wiping, setWiping] = useState(false)
  useEffect(() => { adminLoginId().then((v) => { setCurId(v); setId(v) }).catch(() => {}) }, [demo])

  const save = async () => {
    const nextId = id.trim()
    if (!nextId) return setMsg({ ok: false, text: '아이디를 입력하세요.' })
    if (pw1 || pw2) {
      if (pw1.length < 8) return setMsg({ ok: false, text: '새 비밀번호는 8자 이상으로 정해 주세요.' })
      if (pw1 !== pw2) return setMsg({ ok: false, text: '두 칸의 비밀번호가 다릅니다.' })
    }
    if (nextId === curId && !pw1) return setMsg({ ok: false, text: '바뀐 내용이 없습니다.' })
    setBusy(true)
    const err = await saveAdminLogin(nextId === curId ? null : nextId, pw1 || null)
    setBusy(false)
    if (err) return setMsg({ ok: false, text: err })
    setCurId(nextId); setPw1(''); setPw2('')
    setMsg({ ok: true, text: '저장했습니다. 다음 로그인부터 새 아이디·비밀번호를 쓰세요.' })
  }

  return (
    <>
      <section className="panel pad login-settings">
        <h2 className="org-sub">직원 로그인</h2>
        <p>아이디 = <b>이름</b>, 비밀번호 = <b>사번</b> (모든 직원 공통, 바꿀 수 없음)</p>
        <p className="muted small">직원 목록에서 이름·사번을 고치면 다음 로그인부터 고친 값으로 들어가요. 직원을 삭제하면 그 직원은 바로 로그인할 수 없어요.</p>
      </section>

      <section className="panel pad login-settings">
        <h2 className="org-sub">관리자 로그인</h2>
        {demo ? (
          <p className="muted">시연 데이터 상태에서는 관리자 계정이 <b>admin · {DEMO_ADMIN_PW}</b>로 고정이에요(로그인 화면에 공개). 평가 관리 → 평가 설정 → [평가 삭제]로 시연 데이터를 지우면서 새 비밀번호를 정한 뒤, 여기서 아이디·비밀번호를 바꿀 수 있어요.</p>
        ) : (
          <>
            <div className="grid form-grid">
              <label className="field">관리자 아이디<input type="text" value={id} maxLength={30} onChange={(e) => { setId(e.target.value); setMsg(null) }} /></label>
              <span />
              <label className="field">새 비밀번호 <span className="muted small">(바꿀 때만, 8자 이상)</span><input type="password" autoComplete="new-password" value={pw1} onChange={(e) => { setPw1(e.target.value); setMsg(null) }} /></label>
              <label className="field">새 비밀번호 확인<input type="password" autoComplete="new-password" value={pw2} onChange={(e) => { setPw2(e.target.value); setMsg(null) }} /></label>
            </div>
            {msg && <p className={`feedback ${msg.ok ? 'ok' : 'fail'}`} role={msg.ok ? 'status' : 'alert'}>{msg.ok ? '✓' : '✕'} {msg.text}</p>}
            <div className="row" style={{ marginTop: 10 }}><span className="spacer" /><button className="btn primary" disabled={busy} onClick={save}>{busy ? '저장하는 중…' : '저장'}</button></div>
          </>
        )}
      </section>

      {!demo && (
        <section className="panel pad login-settings">
          <h2 className="org-sub">전체 데이터 초기화</h2>
          <p>직원·팀·평가·문항·응답·점수·KPI와 직원 로그인 계정을 모두 지우고 빈 상태로 돌려요. <b>관리자 아이디·비밀번호는 그대로</b>예요.</p>
          <p className="muted small">가상 CSV로 연습한 뒤 실제 직원 명단·문항을 올리기 전에 써요. 되돌릴 수 없어요.</p>
          <div className="row" style={{ marginTop: 10 }}><span className="spacer" /><button className="btn danger" onClick={() => setWiping(true)}>전체 데이터 초기화</button></div>
        </section>
      )}
      {wiping && <WipeModal onClose={() => setWiping(false)} />}
    </>
  )
}

/** 전체 데이터 초기화 확인: '초기화'를 직접 입력해야 버튼이 켜짐 */
function WipeModal({ onClose }: { onClose: () => void }) {
  const [word, setWord] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const go = async () => {
    setBusy(true); setErr('')
    try { await resetDemo(); onClose() } catch (e) { setErr(`초기화하지 못했습니다: ${(e as Error).message}`); setBusy(false) }
  }
  return (
    <Modal title="전체 데이터 초기화" onClose={busy ? () => {} : onClose}>
      <p><b>모든 데이터가 지워지고 빈 상태가 됩니다.</b> 직원 로그인 계정도 지워져요. 관리자 아이디·비밀번호는 남아요.</p>
      <label className="field" style={{ marginTop: 12 }}>확인을 위해 <b>초기화</b>라고 입력하세요<input type="text" value={word} disabled={busy} onChange={(e) => setWord(e.target.value)} /></label>
      {err && <p className="feedback fail" role="alert">✕ {err}</p>}
      <div className="row" style={{ marginTop: 14 }}><span className="spacer" /><button className="btn" disabled={busy} onClick={onClose}>취소</button><button className="btn danger" disabled={busy || word.trim() !== '초기화'} onClick={go}>{busy ? '초기화하는 중…' : '전체 초기화'}</button></div>
    </Modal>
  )
}
