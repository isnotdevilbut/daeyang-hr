# 대양롤랜트 인사평가 목업 — 작업 안내 (Claude Code용)

이 파일은 이 폴더에서 Claude Code를 켜면 자동으로 읽힌다.

## 무엇인가
- 대양롤랜트(주) 인사평가 **목업**(가상 데이터). Vite + React 18 + TypeScript, 테스트 vitest.
- 이 폴더는 원본 웹앱(https://daeyang-hr-mockup.onrender.com)과 화면·기능이 같고 데이터 없이 시작하는 버전이다. 원본과 같은 결과를 내는 것이 목표이므로, 사용자가 요청하지 않으면 코드·디자인·문구를 바꾸지 않는다.
- 데이터는 방문자 브라우저(localStorage `daeyang-hr-mockup-v1`)에만 저장된다. 서버·DB·유료 서비스 없음.
- 로그인(직원: 아이디 = 이름, 비밀번호 = 사번 / 관리자: `admin` · 비밀번호는 `src/admin-password.ts`에서 각자 정함)은 시연용이며 실제 보안이 아니다.

## 꼭 지킬 것
- 유료 서비스에 가입하지 않는다. 실제 인사 자료(실명·사번·평가 결과)를 넣거나 외부로 보내지 않는다.
- 비밀번호·토큰 같은 비밀값을 화면에 출력하지 않는다.
- 앱을 처음부터 다시 만들거나, 이미 있는 파일을 지우고 새로 쓰지 않는다.

## 명령
- `npm ci` 설치 · `npm run dev` 내 컴퓨터에서 켜기(http://localhost:5173) · `npm test` 자동 테스트 · `npm run build` 배포용 빌드(dist 폴더).
- 배포: GitHub 저장소 → Render Blueprint(`render.yaml`) 정적 사이트(무료).

## 사용자와 대화
- 한국어, 짧고 쉬운 말. 개발 용어는 풀어서 설명한다.
