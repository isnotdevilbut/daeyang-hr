import { useEffect, useMemo, useRef, useState } from 'react'
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { getState, loadRemote, update, useAppState } from '../data/store'
import { accountText, canSignIn, homeFor, participantAccount, remoteLogin, sessionFor, setLoggedIn, useAccount } from '../data/auth'
import { DEMO_ADMIN_PW, rpc } from '../data/remote'
import { createSeed } from '../domain/seed'
import logoKo from '../assets/logo-ko.png'
import { loginError, t, tierText, useLang } from '../i18n'
import { LangSelect } from './employee/mobile'
import { LoginBackdrop } from '../components/LoginBackdrop'

export default function Login() {
  const s = useAppState()
  const account = useAccount()
  const nav = useNavigate()
  const [params] = useSearchParams()
  const fromLink = params.get('from') === 'link' // 이전 개인 링크 주소로 들어온 경우
  const [id, setId] = useState('')
  const [pw, setPw] = useState('')
  const [show, setShow] = useState(false)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const [lang, setLang] = useLang() // 직원 로그인 화면 언어 (선택은 이 브라우저에 기억 — 로그인 후 평가 화면에도 적용)
  // 프로토타입: 서버에 시연 데이터가 들어 있을 때만 시연 계정 목록(원본 시연 사이트와 같은 가상 직원). 평가 삭제로 초기화하면 사라짐
  const demo = useMemo(() => createSeed(), [])
  const demoPeople = demo.employees.filter(canSignIn)
  const [demoOn, setDemoOn] = useState(false)
  useEffect(() => {
    const probe = demoPeople.find((e) => !e.isExecutive)?.name
    if (!probe) return
    rpc<{ email: string }[]>('dy_login_candidates', { p_name: probe }).then((r) => setDemoOn(r.length > 0)).catch(() => setDemoOn(false))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const fill = (a: string, b: string) => { setId(a); setPw(b); setErr('') }
  const cur = account ? sessionFor(s, account) : null
  if (cur) return <Navigate to={homeFor(cur.role)} replace />
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (busyRef.current) return // 처리 중 중복 클릭 방지
    busyRef.current = true
    setBusy(true)
    setErr('')
    // 프로토타입: 서버에서 로그인 확인(첫 로그인이면 계정 생성) → 서버 데이터 불러오기 → 역할에 맞는 첫 화면
    const r = await remoteLogin(id, pw)
    try {
      if (typeof r === 'string') { setErr(r); return }
      const who = await loadRemote()
      const acc = who.isAdmin ? r : who.employeeId ? participantAccount(who.employeeId) : null
      const ses = acc ? sessionFor(getState(), acc) : null
      if (!acc || !ses) { setErr('아이디 또는 비밀번호가 올바르지 않습니다.'); return }
      update((d) => { d.session = ses })
      setLoggedIn(acc.key, false)
      nav(homeFor(ses.role), { replace: true })
    } catch (x) {
      setErr(`서버에서 데이터를 불러오지 못했습니다: ${(x as Error).message}`)
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  return (
    <main className="login-wrap">
      <LoginBackdrop />
      <form className="login-card" onSubmit={submit} noValidate>
        <div className="login-lang"><LangSelect lang={lang} onChange={setLang} /></div>
        <img className="login-logo" src={logoKo} alt="ROLLENT 대양롤랜트(주)" />
        <h1>{t('login.title', lang)}</h1>
        <span className="chip info login-tag">{t('login.tag', lang)}</span>
        {fromLink && <p className="feedback info" role="status">{t('login.linkGone', lang)}</p>}
        <label className="field">{t('login.id', lang)}
          <input type="text" autoComplete="username" value={id} onChange={(e) => { setId(e.target.value); setErr('') }} autoFocus />
        </label>
        <label className="field">{t('login.pw', lang)}
          <span className="pw-row">
            <input type={show ? 'text' : 'password'} autoComplete="current-password" value={pw} onChange={(e) => { setPw(e.target.value); setErr('') }} />
            <button type="button" className="btn small" aria-pressed={show} onClick={() => setShow(!show)}>{show ? t('login.hide', lang) : t('login.show', lang)}</button>
          </span>
        </label>
        {err && <p className="feedback fail" role="alert">✕ {loginError(err, lang)}</p>}
        <button type="submit" className="btn primary login-btn" disabled={busy}>{busy ? t('login.busy', lang) : t('login.submit', lang)}</button>
        {demoOn && (
          <details className="demo-accounts">
            <summary>{t('login.demo', lang)}</summary>
            <p>{t('login.demoHint', lang, { name: t('login.demoName', lang), no: t('login.demoNo', lang), pw: DEMO_ADMIN_PW })}</p>
            <div className="acc-list">
              <table className="tbl">
                <tbody>
                  <tr><td><button type="button" className="link-btn" onClick={() => fill('admin', DEMO_ADMIN_PW)}>admin</button></td><td className="muted">{DEMO_ADMIN_PW}</td><td>운영담당자</td></tr>
                  {demoPeople.map((e) => (
                    <tr key={e.id}>
                      <td><button type="button" className="link-btn" onClick={() => fill(e.name, e.empNo)}>{e.name}</button></td>
                      <td className="muted">{e.empNo}</td>
                      <td>{lang === 'ko' ? accountText(demo, e) : accountText(demo, e).replace(/^[^·]+?(?= ·|$)/, (m) => tierText(m, lang))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        )}
        <p className="muted small login-first">{lang === 'ru' ? 'Первый вход: логин — ваше имя, пароль — табельный номер. Потом пароль можно сменить.' : '처음 로그인: 아이디 = 이름, 비밀번호 = 사번. 로그인한 뒤 비밀번호를 바꿀 수 있어요.'}</p>
      </form>
    </main>
  )
}
