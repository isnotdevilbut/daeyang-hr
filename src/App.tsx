import { useEffect, useLayoutEffect, useState, type ReactNode } from 'react'
import { HashRouter, Navigate, NavLink, Outlet, Route, Routes, useNavigate, useParams } from 'react-router-dom'
import { getState, update, useAppState, useSyncStatus } from './data/store'
import { changePassword, homeFor, restoreLogin, sessionFor, setLoggedIn, useAccount, type DemoAccount } from './data/auth'
import { remoteConfigured } from './data/remote'
import { Modal } from './components/ui'
import { ADMIN_NAV, can } from './domain/permissions'
import { ROLE_LABEL, type DemoRole } from './domain/types'
import logoKo from './assets/logo-ko.png'
import { Aurora, PaintNav, PointerGlow } from './components/PaintNav'
import { t as tr, tierText, useLang } from './i18n'
import { LangSelect } from './pages/employee/mobile'
import Login from './pages/Login'
import DevTools from './pages/DevTools'
import Progress from './pages/admin/Progress'
import People from './pages/admin/People'
import Evaluation from './pages/admin/Evaluation'
import Kpi from './pages/admin/Kpi'
import Results from './pages/admin/Results'
import PersonResultPage from './pages/admin/PersonResult'
import Report from './pages/admin/Report'
import MyTasks from './pages/evaluator/MyTasks'
import EvaluateForm from './pages/evaluator/EvaluateForm'
import SelfForm from './pages/employee/SelfForm'
import { positionName } from './domain/catalog'

/**
 * 목업 접근 제어(브라우저 화면 수준 — 실제 보안 아님).
 * 로그인하지 않았으면 로그인 화면으로, 허용되지 않은 역할이면 그 역할의 첫 화면으로 보낸다.
 * 화면이 쓰는 역할 정보(state.session)는 로그인 계정에 맞춰 둔다.
 */
function RequireAuth({ allow, children }: { allow: DemoRole[]; children: ReactNode }) {
  const account = useAccount()
  const s = useAppState()
  // 역할은 계정에 연결된 직원의 현재 조직 정보로 정한다 (로그인 화면에서 고르지 않음)
  const want = account ? sessionFor(s, account) : null
  const synced = !!want && JSON.stringify(s.session) === JSON.stringify(want)
  useLayoutEffect(() => {
    if (want && !synced) update((d) => { d.session = want })
  }, [want, synced])
  // 연결 직원이 삭제되는 등 계정이 무효가 되면 로그인 상태를 지운다 (다른 탭에서 바뀐 경우 포함)
  useLayoutEffect(() => {
    if (account && !want) setLoggedIn(null)
  }, [account, want])
  if (!account || !want) return <Navigate to="/login" replace />
  if (!allow.includes(want.role)) return <Navigate to={homeFor(want.role)} replace />
  if (!synced) return null
  return <>{children}</>
}

const PARTICIPANT: DemoRole[] = ['member', 'lead', 'exec']

/**
 * 계정 표시 (D-067): 원형 아바타 + 표시명·역할 + 로그아웃.
 * 기존 로그인 정보만 쓴다 — 참여자는 이름 첫 글자, 운영담당자는 사람 아이콘. 계정 메뉴는 없으므로 클릭할 수 있는 모양으로 만들지 않는다.
 */
function UserArea({ account, name, role, logout = '로그아웃', extra }: { account: DemoAccount; name: string; role: string; logout?: string; extra?: ReactNode }) {
  const nav = useNavigate()
  const demo = !!useAppState().demo
  const initial = account.kind === 'participant' ? [...name.trim()][0] ?? '' : ''
  return (
    <div className={extra ? 'hdr-user has-extra' : 'hdr-user'}>
      <div className="user-id" title={`계정 ${account.key}`}>
        <span className="avatar" aria-hidden>
          {initial || (
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="12" cy="8.5" r="3.6" /><path d="M5 19.5c1.3-3.3 4-5 7-5s5.7 1.7 7 5" /></svg>
          )}
        </span>
        {/* 이름 · 역할 (텍스트 순서 그대로 읽힘) */}
        <span className="role-pill"><span className="u-name">{name}</span>{role && <><span className="sr-only"> · </span><span className="u-role">{role}</span></>}</span>
      </div>
      {extra}
      <SyncBadge />
      {/* 시연 계정으로 쓰는 동안은 비밀번호를 바꾸지 않음 — 관리자는 항상(로그인 화면에 비밀번호 표시), 직원은 시연 데이터일 때 */}
      {account.kind === 'participant' && !demo && <PasswordButton />}
      <button className="btn small" onClick={() => { setLoggedIn(null); nav('/login', { replace: true }) }}>{logout}</button>
    </div>
  )
}

/** 서버 저장 상태(프로토타입): 저장 중·저장 실패만 작게 표시 */
function SyncBadge() {
  const st = useSyncStatus()
  if (st.error) return <span className="chip draft sync-badge" role="alert" title={st.error}>저장 실패 — 새로고침해 주세요</span>
  if (st.saving) return <span className="chip info sync-badge" role="status">저장 중…</span>
  return null
}

/** 비밀번호 변경(프로토타입 — 서버 계정) */
function PasswordButton() {
  const [open, setOpen] = useState(false)
  const [a, setA] = useState('')
  const [b, setB] = useState('')
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const save = async () => {
    if (a !== b) return setMsg({ ok: false, text: '두 칸의 비밀번호가 다릅니다.' })
    setBusy(true)
    const err = await changePassword(a)
    setBusy(false)
    if (err) return setMsg({ ok: false, text: err })
    setMsg({ ok: true, text: '비밀번호를 바꿨습니다. 다음 로그인부터 새 비밀번호를 쓰세요.' }); setA(''); setB('')
  }
  return (
    <>
      <button className="btn small" onClick={() => { setOpen(true); setMsg(null) }}>비밀번호 변경</button>
      {open && (
        <Modal title="비밀번호 변경" onClose={() => setOpen(false)}>
          <label className="field">새 비밀번호<input type="password" autoComplete="new-password" value={a} onChange={(e) => setA(e.target.value)} /></label>
          <label className="field">새 비밀번호 확인<input type="password" autoComplete="new-password" value={b} onChange={(e) => setB(e.target.value)} /></label>
          {msg && <p className={`feedback ${msg.ok ? 'ok' : 'fail'}`} role={msg.ok ? 'status' : 'alert'}>{msg.ok ? '✓' : '✕'} {msg.text}</p>}
          <div className="row" style={{ marginTop: 12 }}><span className="spacer" /><button className="btn primary" disabled={busy || !a} onClick={save}>{busy ? '바꾸는 중…' : '바꾸기'}</button></div>
        </Modal>
      )}
    </>
  )
}

function AdminLayout() {
  const s = useAppState()
  const account = useAccount()!
  return (
    <>
      <header className="admin-header no-print">
        <Aurora layer="header" />
        <div className="hdr-inner">
          <NavLink to="/admin/progress" className="brand" aria-label="진행 현황으로"><img src={logoKo} alt="ROLLENT 대양롤랜트(주)" /></NavLink>
          <PaintNav label="관리자 메뉴" items={ADMIN_NAV.filter((n) => can(s.session.role, n.action)).map((n) => ({ to: n.to, label: n.label }))} />
          <UserArea account={account} name={ROLE_LABEL.admin} role="" />
        </div>
      </header>
      <AppPanel><Outlet /></AppPanel>
    </>
  )
}

function EvalLayout() {
  const s = useAppState()
  const account = useAccount()!
  const me = s.employees.find((e) => e.id === s.session.personaId)
  const [lang, setLang] = useLang()
  return (
    <>
      <header className="admin-header no-print">
        <Aurora layer="header" />
        <div className="hdr-inner hdr-participant">
          <NavLink to="/eval" className="brand" aria-label="내 평가로"><img src={logoKo} alt="ROLLENT 대양롤랜트(주)" /></NavLink>
          <PaintNav label="평가 참여자 메뉴" items={[{ to: '/eval', label: tr('nav.myEval', lang), end: true }]} />
          {/* 평가 참여자 화면 언어 (한국어 / Русский, 이 브라우저에 기억) — 이름은 번역하지 않음 */}
          <UserArea account={account} name={me?.name ?? ''} role={tierText(me ? positionName(s, me) : ROLE_LABEL[s.session.role], lang)} logout={tr('nav.logout', lang)} extra={<LangSelect lang={lang} onChange={setLang} />} />
        </div>
      </header>
      <AppPanel><Outlet /></AppPanel>
    </>
  )
}

/** "페이지 안의 페이지": 작업 화면을 감싸는 큰 둥근 패널 (시각적 구조만 — 별도 스크롤 영역·iframe 없음, D-067) */
function AppPanel({ children }: { children: ReactNode }) {
  return <><PointerGlow /><Aurora layer="page" /><main className="app-shell"><div className="app-panel">{children}</div></main></>
}

/** 이전 회차 상세 주소: 그 회차를 선택한 채 평가자·가중치 탭으로 */
function CycleRedirect() {
  const { id = '' } = useParams()
  const nav = useNavigate()
  useEffect(() => {
    try { if (getState().cycles.some((c) => c.id === id)) sessionStorage.setItem('daeyang-hr-selected-cycle', id) } catch { /* 무시 */ }
    nav('/admin/evaluation?tab=assign', { replace: true })
  }, [id, nav])
  return null
}

function Home() {
  const s = useAppState()
  const account = useAccount()
  const ses = account ? sessionFor(s, account) : null
  return <Navigate to={ses ? homeFor(ses.role) : '/login'} replace />
}

/**
 * 이전 개인 링크 주소(#/e/…): 링크에 적힌 직원 정보는 쓰지 않는다.
 * 로그인했으면 로그인한 본인의 첫 화면으로, 아니면 공통 로그인으로 안내한다 (D-049).
 */
function LegacyLink() {
  const s = useAppState()
  const account = useAccount()
  const ses = account ? sessionFor(s, account) : null
  return <Navigate to={ses ? homeFor(ses.role) : '/login?from=link'} replace />
}

/** 프로토타입 시작: 서버 연결 설정 확인 → 남아 있는 로그인(세션)이 있으면 서버 데이터를 불러온 뒤 화면 */
export default function App() {
  const [ready, setReady] = useState(false)
  useEffect(() => { void restoreLogin().finally(() => setReady(true)) }, [])
  if (!remoteConfigured) return <main className="page"><div className="panel pad"><h1>서버 연결 설정이 없습니다</h1><p>배포 설정(환경변수)에 VITE_SUPABASE_URL 과 VITE_SUPABASE_KEY 를 넣고 다시 배포해 주세요.</p></div></main>
  if (!ready) return <main className="page"><p className="muted" role="status" style={{ textAlign: 'center', marginTop: 80 }}>불러오는 중…</p></main>
  return (
    <HashRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/admin" element={<RequireAuth allow={['admin']}><AdminLayout /></RequireAuth>}>
          <Route index element={<Navigate to="/admin/progress" replace />} />
          <Route path="progress" element={<Progress />} />
          <Route path="people" element={<People />} />
          <Route path="evaluation" element={<Evaluation />} />
          {/* 이전 주소 → 평가 관리의 해당 탭 */}
          <Route path="templates/*" element={<Navigate to="/admin/evaluation?tab=questions" replace />} />
          <Route path="cycles" element={<Navigate to="/admin/evaluation?tab=setup" replace />} />
          <Route path="cycles/:id" element={<CycleRedirect />} />
          <Route path="open-questions" element={<Navigate to="/admin/evaluation" replace />} />
          <Route path="kpi" element={<Kpi />} />
          <Route path="results" element={<Results />} />
          <Route path="results/:targetId" element={<PersonResultPage />} />
          <Route path="report/:targetId" element={<Report />} />
          <Route path="*" element={<Navigate to="/admin/progress" replace />} />
        </Route>
        <Route path="/eval/self/:aid" element={<RequireAuth allow={PARTICIPANT}><SelfForm /></RequireAuth>} />
        <Route path="/eval" element={<RequireAuth allow={PARTICIPANT}><EvalLayout /></RequireAuth>}>
          <Route index element={<MyTasks />} />
          <Route path=":aid" element={<EvaluateForm />} />
        </Route>
        {/* 개발용: 화면에 링크하지 않는다 */}
        <Route path="/dev" element={<DevTools />} />
        {/* 이전 개인 링크 주소: 사번 로그인으로 대체 (인증 우회 없음) */}
        <Route path="/e/*" element={<LegacyLink />} />
        <Route path="/links" element={<Home />} />
        <Route path="*" element={<Home />} />
      </Routes>
    </HashRouter>
  )
}
