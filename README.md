# 업무 비서 관제실 (secretary-web)

업무 비서에게 일을 맡기고, 결재하고, 기록을 보는 웹앱. Next.js + Supabase, Vercel 배포.

이 앱은 DB에 `dashboard_ui` 역할로만 접속한다. 승인·반려와 킬스위치는 이 역할만 실행할 수 있는 DB 함수로만 가능하므로, 에이전트(커널)는 자기 요청을 스스로 승인할 수 없다.

## 1. Supabase 준비

1. SQL Editor에서 `db/agent_kernel_schema_v0_2.sql` 전체 실행
2. 두 역할 비밀번호 설정 (각각 길고 무작위로)
   ```sql
   alter role dashboard_ui password '...';
   alter role agent_kernel password '...';
   ```
3. Settings → API → Exposed schemas에 `agent`를 **추가하지 않는다**
4. Authentication
   - Users → Add user로 본인 이메일 계정 생성 (가입은 막혀 있음)
   - Sign In / Providers에서 새 가입 비활성화 권장
   - Email Templates → Magic Link 템플릿에 6자리 코드가 보이도록 `{{ .Token }}` 추가
     (예: `로그인 코드: {{ .Token }}`)

## 2. 환경 변수

`.env.example`을 참고해 Vercel 프로젝트 설정에 넣는다.

| 이름 | 내용 |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | 프로젝트 URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon(publishable) 키 |
| `DATABASE_URL` | `dashboard_ui` 역할 접속 문자열, 트랜잭션 풀러(6543) |
| `ALLOWED_EMAIL` | 관제실에 들어올 수 있는 유일한 이메일 |

`DATABASE_URL`의 사용자 이름은 풀러 기준 `dashboard_ui.프로젝트REF` 형식이다.
Supabase 대시보드의 Connect 화면에서 풀러 주소를 복사한 뒤 사용자 이름과 비밀번호만 바꾸면 된다.
접속이 안 되면 Supabase 문서에서 커스텀 역할의 풀러 접속 방식을 확인할 것.

## 3. 배포

```bash
npm install
npm run dev        # 로컬 확인 (.env.local 필요)
```

GitHub에 올린 뒤 Vercel에서 Import → 환경 변수 입력 → Deploy.

## 4. 폰에 설치

- 아이폰: Safari로 접속 → 공유 → 홈 화면에 추가
- 안드로이드: Chrome으로 접속 → 메뉴 → 앱 설치(홈 화면에 추가)

ntfy 알림의 `Click` 주소(`DASHBOARD_URL`)를 Vercel 주소로 바꾸면 알림을 누를 때 바로 결재 화면이 열린다.

## 구조

```
app/page.tsx            결재 대기, 업무 목록, 최근 기록, 업무 중/멈춤 스위치
app/tasks/new           새 업무 맡기기
app/tasks/[id]          업무 상세 (예산, 보고서, 기록, 취소)
app/login               이메일 6자리 코드 로그인
app/actions.ts          서버 액션 (모두 requireUser로 재확인)
middleware.ts           세션 갱신, 허용된 이메일 외 접근 차단
lib/db.ts               dashboard_ui 역할 DB 연결 (서버 전용)
db/                     커널 스키마
```
