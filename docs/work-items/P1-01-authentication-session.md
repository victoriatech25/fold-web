# P1-01 — 독자 인증·세션

> 상태: `DONE`
>
> 우선순위: `P1`
>
> 담당자: 사용자 본인
>
> 검수자: 사용자 본인
>
> 관련 게이트: `D1-01`
>
> 착수일: 2026-07-19
>
> 상위 계획: [P1 실행계획](./P1-execution-plan.md)
>
> MFC 참조 루트: `/Users/kyhoon/Library/Mobile Documents/com~apple~CloudDocs/회사/hicomtech/도면`

## 1. 목표

MFC 실행·로그인 방식과 완전히 분리된 웹 계정으로 로그인하고 PostgreSQL DB session을 발급하며, 로그아웃·만료·계정 상태·로그인 제한을 서버에서 검증해 편집 화면의 미인증 접근을 차단한다.

## 2. 포함·제외 범위

### 포함

- 관리자 bootstrap 계정
- 정규화 이메일·비밀번호 로그인
- Argon2id hash·verify
- DB-backed opaque session
- 로그인·현재 session·로그아웃 API
- 로그인 UI와 편집 화면 보호
- 절대·idle 만료와 touch
- 계정·신뢰 source 로그인 제한
- 일회성 비밀번호 reset token 발급 기반
- 최소 인증 보안 감사
- 단위·PostgreSQL 통합·Playwright E2E

### 제외

- 공개 회원가입
- MFC 계정·비밀번호 이전
- OAuth·소셜 로그인·SSO·MFA
- 이메일 발송 서비스
- 사용자·부서·역할 관리 UI
- 전체 RBAC와 일반 감사 조회 UI
- 운영 서버·DB·reverse proxy 설정

사용자 관리와 RBAC는 P1-02, 일반 감사는 P1-03에서 확장한다.

## 3. 근거와 현재 상태

- P0-09 Prisma Schema에 `User`, `PasswordCredential`, `AuthSession`, `PasswordResetToken`, membership·role이 존재한다.
- P0-11에 Prisma singleton, application·repository 경계, 표준 오류와 request ID가 있다.
- seed에는 사용자와 비밀번호가 없으며 이 정책을 유지한다.
- 현재 `/` 편집 화면은 공개 상태이고 로그인 화면이 없다.
- Next.js 16.2.10 로컬 인증·cookie·form·data security·Route Handler 문서를 기준으로 한다.

MFC 인증 코드는 업무 참고 대상이 아니며 자격증명과 실행 mechanism을 사용하지 않는다.

## 4. 승인된 보안 정책

### 4.1 비밀번호

- 길이: 15~128 Unicode 문자
- 공백을 포함한 passphrase 허용
- 대문자·소문자·숫자·특수문자 조합 강제 없음
- 정규화된 이메일을 로그인 ID로 사용
- 일반·서비스명 기반 취약 비밀번호를 offline blocklist로 차단
- Argon2id 시작값: memory 19,456 KiB, time 2, parallelism 1
- 실제 서버에서 hash p95를 측정하고 1초 이하 범위에서 상향 조정 가능
- hash 문자열에 salt·parameter를 포함하며 plaintext·복호화 가능한 비밀번호를 저장하지 않음

### 4.2 session

- Node CSPRNG로 32 byte(256-bit) token 생성
- 브라우저에는 base64url 원본 token만 전달
- PostgreSQL에는 SHA-256 hex hash만 저장
- 절대 만료: 발급 후 8시간
- idle 만료: 마지막 사용 후 2시간
- `lastSeenAt` 갱신 최소 간격: 5분
- 로그아웃·비밀번호 변경·계정 정지 시 서버 session revoke
- production cookie: `__Host-fw.sid`
- local/test cookie: `fw.sid`
- `HttpOnly`, `SameSite=Lax`, `Path=/`, production `Secure`
- session 응답과 인증 화면은 `Cache-Control: no-store`

### 4.3 로그인 제한

- 계정 key: 정규화 이메일의 HMAC-SHA-256
- source key: 신뢰 reverse proxy가 제공하는 원본 주소의 HMAC-SHA-256
- 계정: 15분 window에 실패 5회부터 차단
- source: 15분 window에 실패 20회부터 차단
- reverse proxy 신뢰 설정이 없으면 조작 가능한 forwarded header를 사용하지 않음
- 존재하지 않는 사용자도 dummy Argon2id hash를 검증
- 이메일 존재·계정 상태·비밀번호 오류를 동일한 `401` 메시지로 반환
- 차단 응답은 `429`와 `Retry-After`를 반환하되 계정 존재 여부는 공개하지 않음

## 5. 데이터베이스·Prisma

기존 모델 사용:

| 모델 | 사용 |
|---|---|
| `User` | 이메일·상태·마지막 로그인 |
| `PasswordCredential` | algorithm·hash·변경 시각 |
| `AuthSession` | token hash·절대 만료·last seen·revoke |
| `PasswordResetToken` | 일회성 reset token hash·만료·사용 |
| `OrganizationMembership` | 최초 관리자 조직 연결 |
| `MembershipRole` | seed 관리자 role 할당 |
| `AuditEvent` | 인증 성공·실패·logout·reset |

추가 모델:

```text
AuthThrottle
  scope              ACCOUNT | SOURCE
  keyHash            HMAC-SHA-256
  windowStartedAt
  failureCount
  blockedUntil
  updatedAt
  primary key(scope, keyHash)
  index(blockedUntil)
```

`AuthThrottle`는 동시 실패 증가를 원자적으로 처리해야 한다. Prisma upsert만으로 lost update가 발생할 수 있으면 parameterized PostgreSQL `INSERT ... ON CONFLICT DO UPDATE`를 repository 안에서 제한적으로 사용하고 통합 테스트로 증명한다.

빈 DB 전체 migration과 기존 P0 DB upgrade를 모두 검증한다.

## 6. 서버 구조

```text
Route Handler
  → Auth Application Service
    → Auth Repository
      → Prisma
        → PostgreSQL

Page / Server Component
  → Auth DAL
    → Session Service
      → Auth Repository
```

책임:

| 영역 | 책임 |
|---|---|
| `server/auth/password` | 정책, Argon2id hash·verify |
| `server/auth/token` | session/reset token·hash·HMAC key |
| `server/auth/config` | origin·cookie·timeout·rate limit 환경 검증 |
| `server/auth/repository` | 사용자·session·throttle·audit DB 접근 |
| `server/auth/service` | login·logout·session·reset use case |
| `server/auth/dal` | 현재 request의 안전한 인증 context |
| Route Handler | 입력·Origin·cookie·DTO·표준 오류 |

Client에는 `userId`, `displayName`과 현재 조직 표시 정보만 필요한 DTO로 전달한다. credential·token hash·membership 전체 row는 반환하지 않는다.

## 7. API 계약

| method | endpoint | 용도 |
|---|---|---|
| `POST` | `/api/v1/auth/sessions` | 이메일·비밀번호 로그인 |
| `GET` | `/api/v1/auth/session` | 현재 session DTO |
| `DELETE` | `/api/v1/auth/session` | 현재 session revoke·cookie 삭제 |
| `POST` | `/api/v1/auth/password-resets/complete` | 일회성 token으로 비밀번호 설정 |

공통:

- JSON body 최대 4 KiB
- request ID와 `no-store`
- 상태 변경 요청은 허용 origin을 검증
- login·reset 응답에 session token을 JSON으로 포함하지 않음
- cookie는 Route Handler response에서만 설정·삭제

오류:

| status | code | 의미 |
|---:|---|---|
| 400 | `INVALID_REQUEST` | schema·token·비밀번호 정책 오류 |
| 401 | `UNAUTHENTICATED` | 동일 로그인 실패 응답 |
| 403 | `FORBIDDEN` | session은 있으나 접근 불가 |
| 429 | `RATE_LIMITED` | 로그인 제한 |
| 500 | `INTERNAL_ERROR` | 내부 오류 비노출 |

## 8. UI·사용자 흐름

### 로그인

1. 사용자가 `/login`에서 이메일·비밀번호를 입력한다.
2. HTML 기본 검증 후 API에 JSON으로 제출한다.
3. 성공 시 cookie를 받은 뒤 원래 요청 경로 또는 `/`로 이동한다.
4. 실패 시 이메일 존재 여부와 관계없이 같은 한국어 오류를 표시한다.
5. 제출 중 버튼을 비활성화하고 오류 영역은 `aria-live`로 알린다.

### 편집 화면 보호

1. `/` Server Component가 DAL에서 DB session을 확인한다.
2. session이 없거나 만료·revoke·계정 비활성이면 `/login`으로 redirect한다.
3. 정상 session이면 최소 사용자 DTO와 편집기를 렌더한다.
4. UI 표시만으로 보안을 대체하지 않고 향후 모든 API가 동일 DAL·permission 검사를 사용한다.

### 로그아웃

1. 사용자가 header의 로그아웃을 선택한다.
2. 서버 session을 revoke하고 cookie를 만료시킨다.
3. `/login`으로 이동한다.
4. 이미 만료됐어도 멱등 성공으로 처리한다.

## 9. bootstrap·reset

### 최초 관리자

`npm run auth:bootstrap-admin -- --email ... --name ...`

- password는 command argument·환경변수·로그에 넣지 않고 stdin으로 받는다.
- 기본 조직과 seed `ADMINISTRATOR` role을 찾아 user·credential·membership을 transaction으로 생성한다.
- 이미 존재하면 임의 overwrite하지 않고 중단한다.
- 실행 결과에 password·hash·session token을 출력하지 않는다.

### reset token

- CLI가 사용자를 찾아 256-bit token을 발급하고 hash만 DB에 저장한다.
- 원본 reset URL은 한 번만 표시한다.
- 유효기간 30분, 한 번 사용 후 `usedAt` 기록
- 완료 시 credential 갱신, 기존 session 전부 revoke
- 이메일 발송은 운영 서비스 결정 후 CLI 발급을 교체한다.

## 10. 환경변수

| 변수 | 기준 |
|---|---|
| `APP_ORIGIN` | browser 상태 변경을 허용하는 정확한 origin |
| `AUTH_RATE_LIMIT_SECRET` | HMAC용 32자 이상 secret |
| `AUTH_TRUST_PROXY` | 기본 `false`, 승인 proxy에서만 `true` |
| `AUTH_SESSION_ABSOLUTE_MINUTES` | 기본 480 |
| `AUTH_SESSION_IDLE_MINUTES` | 기본 120 |
| `AUTH_SESSION_TOUCH_MINUTES` | 기본 5 |

production secret은 저장소에 넣지 않는다. 로컬·CI에는 운영과 무관한 명시적 시험값만 사용한다.

## 11. 테스트 계획

| 종류 | 핵심 사례 |
|---|---|
| 단위 | 이메일 정규화, 비밀번호 길이·blocklist, hash·verify, token entropy·hash, cookie option |
| PostgreSQL | bootstrap, 정상·오류 로그인, session 발급·조회·touch·idle·absolute·revoke |
| 동시성 | throttle 원자 증가와 제한 경계 |
| 보안 | dummy hash, 동일 오류, Origin 거부, forwarded header 비신뢰, token 원본 미저장 |
| API | status·오류 envelope·request ID·cookie flags·본문 제한 |
| E2E | 미인증 redirect, 로그인, 새로고침 유지, 로그아웃, 만료 후 재로그인 |
| CI | PostgreSQL 16 + production build + Playwright Chromium |
| 사용자 | Chrome·Edge 로그인·새로고침·로그아웃 |

## 12. 상세 실행 단계

| 단계 | 상태 | 작업 | 검증 |
|---|---|---|---|
| `01` | `DONE` | Next.js 인증·cookie·form·보안·Playwright 문서 확인 | 설치 버전 로컬 문서 |
| `02` | `DONE` | D1-01-A~L 승인·계약 작성 | 본 문서 |
| `03` | `DONE` | dependency·환경·Prisma throttle migration | validate·diff·빈 DB·upgrade |
| `04` | `DONE` | password·token·config 도메인 | 단위 테스트 |
| `05` | `DONE` | repository·application·DAL | PostgreSQL 통합 |
| `06` | `DONE` | auth API·cookie·오류 | Route Handler 통합 |
| `07` | `DONE` | bootstrap·reset CLI | 재실행 거부·비밀 비노출 |
| `08` | `DONE` | 로그인·reset·로그아웃 UI·편집 보호 | Playwright |
| `09` | `DONE` | CI E2E·보안 실패 시험 | GitHub Actions workflow |
| `10` | `DONE` | 사용자 검수·문서·잔여 위험 | 2026-07-19 사용자 직접 검수 승인 |

## 13. 구현 결과

### 13.1 소스 구성

| 경로 | 구현 |
|---|---|
| `prisma/schema.prisma`, `prisma/migrations/20260719134355_auth_throttle` | 계정·source 로그인 제한 상태 |
| `src/server/auth/*` | 환경 검증, 비밀번호, token, repository, login·session·reset service, DAL |
| `src/app/api/v1/auth/*` | 로그인, 현재 session, 로그아웃, 비밀번호 reset 완료 API |
| `src/app/login`, `src/app/reset-password`, `src/components/auth` | 한국어 인증 화면과 상태 처리 |
| `scripts/bootstrap-admin.ts` | stdin 비밀번호 기반 최초 관리자 생성 |
| `scripts/issue-password-reset.ts` | 원문을 한 번만 표시하는 reset URL 발급 |
| `scripts/verify-auth-cli.mjs` | 중복 bootstrap 거부와 token hash 저장 검증 |
| `src/server/auth/auth.integration.test.ts` | 실제 PostgreSQL 인증 수명주기·보안 검증 |
| `e2e/auth.spec.ts`, `playwright.config.ts` | Chromium 브라우저 수직 흐름 |
| `.github/workflows/ci.yml` | PostgreSQL 16, production build, Chromium E2E |

인증 구현은 MFC 코드·계정·Windows 실행 mechanism을 참조하거나 이전하지 않았다. MFC 참조 루트는 프로젝트 전체 경계 확인을 위해 문서에만 유지한다.

### 13.2 관리자·reset 운영 명령

seed 완료 후 최초 관리자를 한 번 생성한다.

```bash
npm run auth:bootstrap-admin -- \
  --email admin@example.com \
  --name "관리자"
```

비밀번호는 TTY에서 화면에 표시하지 않고 두 번 입력한다. pipe를 쓰는 자동화에서도 stdin만 사용한다. 기존 이메일은 overwrite하지 않고 실패한다.

비밀번호 설정·재설정 링크는 다음과 같이 발급한다.

```bash
npm run auth:issue-password-reset -- --email admin@example.com
```

`APP_ORIGIN` 기준 URL이 한 번만 출력되고 PostgreSQL에는 SHA-256 hash만 남는다. 이메일 발송 서비스 도입 전까지 관리자가 안전한 별도 채널로 URL을 전달한다.

### 13.3 자동 검증 결과

2026-07-19 로컬 격리 test DB에서 확인한 결과다.

| 검증 | 결과 |
|---|---|
| Prisma validate·migration diff | 통과, 빈 `fold_web_test`에 init→auth migration 적용 |
| TypeScript·ESLint | 통과 |
| Vitest 단위·기존 회귀 | 104건 통과, DB 전용 11건은 일반 실행에서 의도적으로 제외 |
| PostgreSQL 통합 | 11건 통과 |
| Playwright Chromium | 3건 통과 |
| Next.js production build | 통과 |
| production dependency high·critical gate | 통과 |
| GitHub 필수 CI | `Quality and PostgreSQL integration` 통과, 2분 42초 |
| Argon2id 로컬 표본 | 20회, median 17ms, p95 19ms, max 19ms |

Argon2id 수치는 Apple Silicon 로컬 개발 환경의 참고값일 뿐이다. 운영 서버·DB가 결정되면 동일 parameter로 p95를 다시 측정하고 1초 미만 범위에서 상향 여부를 별도 승인한다.

PostgreSQL 통합 검증에는 다음이 포함된다.

- CLI bootstrap 성공·중복 거부·출력 비밀 비노출
- reset 원문 token 미저장과 SHA-256 hash 일치
- 허용되지 않은 Origin·Host 거부
- 미존재 계정과 잘못된 비밀번호의 동일 `401` 공개 응답
- 정상 login·safe DTO·cookie·현재 session·logout
- 동시 실패 5건의 원자 증가와 15분 차단
- 5분 touch, 2시간 idle, 8시간 절대 만료와 revoke
- reset token 일회 사용, 비밀번호 변경, 기존 session 전체 revoke

### 13.4 사용자 직접 검수

사용자가 2026-07-19 Chrome와 Edge에서 아래 항목의 직접 검수를 완료하고 P1-01 종료를 승인했다.

1. cookie가 없는 상태에서 `/` 접근 시 `/login`으로 이동한다.
2. 잘못된 이메일과 잘못된 비밀번호가 같은 안내 문구를 보인다.
3. bootstrap 계정으로 로그인하면 편집 화면에 사용자·조직명이 표시된다.
4. 새로고침 후에도 로그인 상태와 편집 화면이 유지된다.
5. 로그아웃 후 `/` 재접근과 뒤로가기로 보호 화면에 들어갈 수 없다.
6. reset URL에서 15자 이상 비밀번호를 설정하고 같은 URL 재사용이 거부된다.
7. 변경 전 비밀번호는 실패하고 변경 후 비밀번호로 로그인된다.

브라우저 개발자 도구에서는 session cookie 값이나 reset token을 문서·화면 캡처에 남기지 않는다.

## 14. 완료 기준

- [x] 공개 가입·MFC credential 경로가 없다.
- [x] Argon2id hash와 비밀번호 정책이 검증된다.
- [x] token 원본이 DB·로그·JSON에 저장·노출되지 않는다.
- [x] 절대·idle 만료, touch와 revoke가 동작한다.
- [x] 계정·신뢰 source throttle이 동시 요청에서도 정확하다.
- [x] 계정 존재·상태·비밀번호 오류가 동일 응답이다.
- [x] Origin·Host·cookie·no-store 보안 기준을 충족한다.
- [x] 최초 관리자 bootstrap과 reset token이 비밀을 남기지 않는다.
- [x] 미인증 사용자가 편집 화면과 보호 API에 접근할 수 없다.
- [x] 단위·PostgreSQL·API·Playwright·원격 CI가 통과한다.
- [x] Chrome·Edge 사용자 직접 검수가 승인됐다.
- [x] P1-02·P1-03 후속 경계가 기록된다.

## 15. 잔여 위험과 후속 경계

- 운영 reverse proxy가 public Host를 보존하고 HTTPS를 종료하도록 운영 확정 시 검증한다.
- `AUTH_TRUST_PROXY=true`는 신뢰 proxy가 외부 `X-Forwarded-For`를 제거·재작성하는 구성이 확인된 뒤에만 사용한다.
- 운영 secret, 운영 PostgreSQL, RDS 또는 운영 서버 DB는 운영 인프라 결정 때 설정한다.
- 2026-07-19 `npm audit`의 high·critical 항목은 0건이다. Prisma 개발 의존성과 Next.js 내장 PostCSS에서 보고된 moderate 5건은 upstream 호환 수정이 나오면 갱신하고 강제 downgrade는 하지 않는다.
- 사용자 초대·정지·역할 관리 UI는 P1-02, 일반 감사 조회와 actor 정책 정교화는 P1-03에서 구현한다.
- 이메일 reset 전달, MFA·SSO는 P1-01 범위 밖이며 별도 우선순위 승인 전에는 추가하지 않는다.
