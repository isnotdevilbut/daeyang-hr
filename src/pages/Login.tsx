import { useRef, useState } from 'react'
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { getState, update, useAppState } from '../data/store'
import { accountText, ADMIN_ACCOUNTS, canSignIn, checkLogin, homeFor, sessionFor, setLoggedIn, useAccount } from '../data/auth'
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
  const cur = account ? sessionFor(s, account) : null
  if (cur) return <Navigate to={homeFor(cur.role)} replace />
  const fill = (a: string, b: string) => { setId(a); setPw(b); setErr('') }

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (busyRef.current) return // 처리 중 중복 클릭 방지
    const r = checkLogin(getState(), id, pw)
    if (typeof r === 'string') { setErr(r); return }
    busyRef.current = true
    setBusy(true)
    setErr('')
    setTimeout(() => {
      const ses = sessionFor(getState(), r)!
      update((d) => { d.session = ses })
      setLoggedIn(r.key)
      nav(homeFor(ses.role), { replace: true })
    }, 350)
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
        <details className="demo-accounts">
          <summary>{t('login.demo', lang)}</summary>
          <p>{t('login.demoHint', lang, { name: t('login.demoName', lang), no: t('login.demoNo', lang), pw: lang === 'ru' ? '(ваш пароль)' : '(직접 정한 비밀번호)' })}</p>{/* 빈 상태 버전: 관리자 비밀번호는 각자 정하므로 화면에 보이지 않음 */}
          <div className="acc-list">
            <table className="tbl">
              <tbody>
                {ADMIN_ACCOUNTS.map((a) => (
                  <tr key={a.key}>
                    <td><button type="button" className="link-btn" onClick={() => fill(a.adminId!, '')}>{a.adminId}</button></td>
                    <td className="muted">••••••</td>
                    <td>운영담당자</td>
                  </tr>
                ))}
                {/* 현재 조직 관리 데이터의 재직 직원 (가상 데이터) */}
                {s.employees.filter(canSignIn).map((e) => (
                  <tr key={e.id}>
                    <td><button type="button" className="link-btn" onClick={() => fill(e.name, e.empNo)}>{e.name}</button></td>
                    <td className="muted">{e.empNo}</td>
                    <td>{lang === 'ko' ? accountText(s, e) : accountText(s, e).replace(/^[^·]+?(?= ·|$)/, (m) => tierText(m, lang))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </form>
    </main>
  )
}
