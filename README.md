# 대양롤랜트 인사평가 — 동작 목업 (가상 데이터)

로컬 검토용 목업입니다. 외부 배포·유료 서비스·서버 저장·실제 로그인이 없습니다.

## 실행

```bash
npm install      # 처음 한 번
npm run dev      # → 브라우저에서 http://127.0.0.1:5173 열기 (로그인 화면의 "시연 계정 보기" 참고, 비밀번호 demo1234)
npm test         # 핵심 로직 자동 테스트
```

## 무엇이 실제로 동작하고, 무엇이 시연인가

| 구분 | 내용 |
|---|---|
| 동작함 (이 브라우저 안에서) | 화면 이동, 조직 관리(직원·팀 편집), 평가 관리(평가 설정·문항 관리·평가자·가중치), 직원 명단 업로드(엑셀 .xlsx·CSV 읽기·표 미리보기·검증·등록), 평가표 문항 추가·수정·삭제·순서 변경, 회차 생성·배정, 단계 잠금, 임시저장·새로고침 복원·제출·중복 클릭 방지, 진행현황 집계, 보정·대표 지정 기록, 리포트 미리보기·브라우저 인쇄 |
| 시연용 | 목업 로그인 — 운영담당자 `admin`·`admin-final` / 비밀번호 demo1234, 직원·팀장·임원은 **아이디 = 이름, 비밀번호 = 사번**(조직 관리 데이터 그대로, 예: 최유진 / 0005 · 이준호 / 0004 · 김도현 / 0002) (브라우저에서 대조 — 실제 보안 인증 아님) |
| 미구현 | 서버·DB 저장, 실제 인증(계정 발급·비밀번호 초기화·세션), 결과 엑셀·PDF 파일 다운로드, 번역(한국어 외) |

이전 버전에서 쓰던 브라우저 데이터는 자동으로 새 기준(상향평가 제외)으로 변환되며 다른 편집 내용은 유지됩니다. 데이터를 처음 상태로 되돌리려면 개발용 주소 `#/dev`의 "시연 데이터 초기화"를 쓰세요.

직원·조직은 모두 가상 데이터입니다(실제 인물·회사 명단 아님). 기본 조직은 목업용 네 팀(경영기획팀·설계팀·생산팀·현장팀)이며 회사 공식 조직도가 아닙니다 — `docs/organization.md`.

## 문서

`docs/` — requirements(요구사항·상태), analysis(자료 분석), screens(화면 목록), permissions(권한 초안), data-model(데이터 구조), scoring(개발용 가정 산식), open-questions(미정 정책), decisions(결정 기록), tech-stack(스택 선정 이유), organization(목업 조직·가상 직원·전환).

## 시연용 공개 배포 (GitHub + Render, hr-evaluation과 같은 방식)

- 코드: Private GitHub 저장소 `isnotdevilbut/daeyang-hr-mockup` (`main` 브랜치)
- 호스팅: Render Static Site(무료) — 루트의 `render.yaml` Blueprint로 생성. 빌드 `npm ci && npm run build`, 게시 폴더 `dist`, Node 버전 `.node-version`
- 업데이트: 코드 수정 → `git add` → `git commit` → `git push` → Render가 `main`을 다시 빌드해 같은 주소에 반영(Render의 Auto-Deploy가 켜져 있을 때)
- 올리지 않는 것: 원본 인사 자료(`대양롤랜트_ClaudeCode_전달자료/`), `node_modules`, `dist`, `.env*`, Netlify 연결 정보(`.netlify/`) — `.gitignore` 참고
- 데이터: 서버·DB 없음. 방문자마다 자기 브라우저(localStorage)에 따로 저장 — 다른 사람·다른 기기와 공유되지 않음. 새 방문자는 가상 시연 데이터로 시작하고, 재배포해도 기존 방문자의 저장 데이터는 저장 구조 변환(migrate) 규칙대로 유지된다
- 로그인은 시연용(이름 + 사번, 관리자 admin / demo1234)이며 실제 인사 자료 보호용 인증이 아니다
- (참고) 이전에 만든 Netlify 사이트 `daeyang-hr-mockup.netlify.app`은 삭제하지 않았다. `netlify.toml`·`npm run deploy`는 그 사이트용
