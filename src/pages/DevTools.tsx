import { useState } from 'react'
import { Link } from 'react-router-dom'
import { resetDemo, useAppState } from '../data/store'
import { accountText, ADMIN_ACCOUNTS, canSignIn, setLoggedIn } from '../data/auth'

/** 개발·시연 준비용 화면 (#/dev). 제품 화면에서는 링크하지 않는다. */
export default function DevTools() {
  const s = useAppState()
  const [done, setDone] = useState('')
  return (
    <div className="page" style={{ maxWidth: 820 }}>
      <h1>개발 도구</h1>
      <section className="panel pad">
        <h2>시연 계정</h2>
        <p>직원: 아이디 이름 · 비밀번호 사번 (조직 관리 데이터 그대로) / 운영담당자 비밀번호 <b>(src/admin-password.ts 에서 정한 값)</b> · <Link to="/login">로그인 화면</Link></p>
        <table className="tbl">
          <tbody>
            {ADMIN_ACCOUNTS.map((a) => <tr key={a.key}><td><b>{a.adminId}</b></td><td>••••••</td><td>운영담당자</td></tr>)}
            {s.employees.filter(canSignIn).map((e) => <tr key={e.id}><td><b>{e.name}</b></td><td>{e.empNo}</td><td>{accountText(s, e)}</td></tr>)}
          </tbody>
        </table>
      </section>
      <section className="panel pad">
        <h2>시연 데이터 초기화</h2>
        <p>이 브라우저에 저장된 모든 편집·응답·보정이 처음 상태로 돌아갑니다.</p>
        <button className="btn danger" onClick={() => {
          if (!confirm('이 브라우저의 시연 데이터를 모두 지우고 처음 상태로 되돌릴까요? 되돌릴 수 없습니다.')) return
          resetDemo(); setLoggedIn(null); setDone('초기화했습니다.')
        }}>시연 데이터 초기화</button>
        {done && <span className="feedback ok" role="status"> ✓ {done}</span>}
      </section>
    </div>
  )
}
