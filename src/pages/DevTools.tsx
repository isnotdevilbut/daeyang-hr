import { useState } from 'react'
import { Link } from 'react-router-dom'
import { loadDemo, resetDemo, useAppState } from '../data/store'
import { accountText, ADMIN_ACCOUNTS, canSignIn } from '../data/auth'

/** 개발·시연 준비용 화면 (#/dev). 제품 화면에서는 링크하지 않는다. */
export default function DevTools() {
  const s = useAppState()
  const [done, setDone] = useState('')
  const [progress, setProgress] = useState('')
  return (
    <div className="page" style={{ maxWidth: 820 }}>
      <h1>개발 도구</h1>
      <section className="panel pad">
        <h2>시연 계정</h2>
        <p>직원: 아이디 이름 · 첫 비밀번호 사번(첫 로그인 뒤 바꿀 수 있음) / 관리자: admin · 처음 로그인할 때 정한 비밀번호 · <Link to="/login">로그인 화면</Link></p>
        <p className="muted small">프로토타입: 데이터는 Supabase 서버에 저장되어 모든 사람·기기가 같은 내용을 봅니다. 아래 목록은 관리자로 로그인했을 때만 보입니다.</p>
        <table className="tbl">
          <tbody>
            {ADMIN_ACCOUNTS.map((a) => <tr key={a.key}><td><b>{a.adminId}</b></td><td>••••••</td><td>운영담당자</td></tr>)}
            {s.employees.filter(canSignIn).map((e) => <tr key={e.id}><td><b>{e.name}</b></td><td>{e.empNo}</td><td>{accountText(s, e)}</td></tr>)}
          </tbody>
        </table>
      </section>
      <section className="panel pad">
        <h2>시연 데이터 넣기</h2>
        <p>원본 시연 사이트와 같은 가상 직원 35명·평가·응답·점수·KPI를 서버에 넣습니다(지금 데이터·직원 계정은 지워짐). 관리자로 로그인했을 때만 됩니다.</p>
        <button className="btn primary" disabled={!!progress} onClick={async () => {
          if (!confirm('지금 서버 데이터를 지우고 시연 데이터를 넣을까요? 모든 사람에게 적용됩니다.')) return
          try { await loadDemo((d, t) => setProgress(`응답 ${d}/${t}건 넣는 중…`)); setDone('시연 데이터를 넣었습니다.') } catch (e) { setDone(`넣지 못했습니다(관리자로 로그인했는지 확인): ${(e as Error).message}`) }
          setProgress('')
        }}>{progress || '시연 데이터 넣기'}</button>
      </section>
      <section className="panel pad">
        <h2>시연 데이터 초기화</h2>
        <p>서버의 모든 데이터(조직·평가·문항·응답·KPI)와 직원 계정이 지워지고 빈 상태로 돌아갑니다. 관리자 계정은 남습니다. 관리자로 로그인했을 때만 됩니다.</p>
        <button className="btn danger" onClick={async () => {
          if (!confirm('서버의 모든 데이터를 지우고 빈 상태로 되돌릴까요? 모든 사람에게 적용되고 되돌릴 수 없습니다.')) return
          try { await resetDemo(); setDone('초기화했습니다.') } catch (e) { setDone(`초기화하지 못했습니다(관리자로 로그인했는지 확인): ${(e as Error).message}`) }
        }}>시연 데이터 초기화</button>
        {done && <span className="feedback ok" role="status"> ✓ {done}</span>}
      </section>
    </div>
  )
}
