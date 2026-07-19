# P0-11 — 애플리케이션 서버 기반

> 상태: `DONE`
>
> 우선순위: `P0`
>
> 담당자: 사용자 본인
>
> 검수자: 사용자 본인
>
> 관련 게이트: `G0`
>
> 착수일: 2026-07-19
>
> 완료일: 2026-07-19
>
> 상위 계획: [fold_web 전체 프로젝트 작업계획서](../project-work-plan.md)
>
> P0 실행계획: [P0 실행계획](./P0-execution-plan.md)
>
> MFC 참조 루트: `/Users/kyhoon/Library/Mobile Documents/com~apple~CloudDocs/회사/hicomtech/도면`

## 1. 목표

Next.js 애플리케이션 서버가 PostgreSQL에 안전하게 연결되고, Prisma transaction을 application·repository 경계에서 실행하며, 표준 오류와 요청 추적 ID를 반환하는 최소 수직 경로를 구축한다.

이 단계는 실제 사용자 인증이나 업무 CRUD를 구현하는 단계가 아니다. MFC 실행 메커니즘을 계승하지 않으며, 향후 독자 인증과 업무 API를 올릴 서버 기반만 검증한다.

## 2. 적용한 Next.js 16 기준

저장소에 설치된 Next.js 16.2.10의 다음 로컬 문서를 구현 전에 확인했다.

- `node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md`
- `node_modules/next/dist/docs/01-app/02-guides/backend-for-frontend.md`
- `node_modules/next/dist/docs/01-app/02-guides/data-security.md`
- `node_modules/next/dist/docs/01-app/02-guides/environment-variables.md`

적용 기준:

- 서버 API는 App Router Route Handler로 구현한다.
- DB 경로는 Node.js runtime으로 고정한다.
- 서버 전용 모듈은 `server-only`로 클라이언트 import를 차단한다.
- 런타임 secret과 DB 환경변수는 서버 코드에서만 읽는다.
- Route Handler는 외부 입력의 형식과 크기를 검증하고 내부 오류를 그대로 노출하지 않는다.
- DB Client는 모듈 import 시 만들지 않고 실제 요청이 필요할 때 지연 생성한다.

## 3. 서버 구조

```text
Route Handler
  → application service
    → repository
      → Prisma Client
        → PostgreSQL
```

| 계층 | 구현 | 책임 |
|---|---|---|
| HTTP | `src/app/api/internal/database-smoke/route.ts` | 인증된 내부 시험 요청, 입력 제한, 응답 변환 |
| HTTP 공통 | `src/server/http/api-response.ts` | JSON 응답, 오류 envelope, request ID |
| application | `src/server/platform/database-smoke.ts` | transaction 흐름과 commit·rollback 정책 |
| repository | `src/server/platform/platform-repository.ts` | 조직 조회와 감사 이벤트 읽기·쓰기 |
| infrastructure | `src/server/db/prisma.ts` | Prisma 수명주기, PostgreSQL adapter와 pool |
| config | `src/server/config/database-env.ts` | DB 환경변수 검증과 안전한 기본값 |

domain 계산 코드는 PostgreSQL이나 Next.js에 의존하지 않는다. 실제 업무 기능도 이 방향을 유지하고 Route Handler에서 Prisma model을 직접 반환하지 않는다.

## 4. 환경변수와 연결 수명주기

필수 변수:

| 변수 | 기준 |
|---|---|
| `DATABASE_URL` | PostgreSQL URL, host와 DB 이름 필수 |

선택 변수와 기본값:

| 변수 | 기본값 |
|---|---:|
| `DATABASE_CONNECTION_LIMIT` | 10 |
| `DATABASE_CONNECTION_TIMEOUT_MS` | 5,000 ms |
| `DATABASE_IDLE_TIMEOUT_MS` | 10,000 ms |
| `DATABASE_STATEMENT_TIMEOUT_MS` | 5,000 ms |

숫자 설정은 양의 정수만 허용한다. URL이 없거나 PostgreSQL이 아니면 첫 DB 사용 시 명확한 환경 오류로 중단한다.

Prisma Client는 `globalThis`에 애플리케이션 전용 키로 하나만 보관한다. 개발 hot reload에서도 pool이 반복 생성되지 않으며, 테스트 종료용 명시적 disconnect 함수를 제공한다. transaction은 대기 2초, 실행 5초를 기본 제한으로 사용한다.

Client를 지연 생성하므로 DB를 사용하지 않는 정적 페이지의 production build는 `DATABASE_URL` 없이도 완료된다. 실제 서버 요청에서 DB를 사용할 때는 반드시 런타임 변수를 주입해야 한다.

## 5. 내부 DB smoke 경로

`POST /api/internal/database-smoke`는 P0 통합 검증 전용이다.

- `INTERNAL_SMOKE_TOKEN`이 없거나 32자 미만이면 항상 `404`를 반환한다.
- 요청 token은 길이 확인 후 timing-safe 비교한다.
- JSON만 허용하고 UTF-8 실제 본문 크기를 1,024 byte로 제한한다.
- `mode`는 `commit` 또는 `rollback`만 허용한다.
- commit은 감사 이벤트 1건을 저장한다.
- rollback은 같은 쓰기를 수행한 뒤 sentinel error로 transaction 전체를 되돌린다.
- 응답은 smoke DTO만 반환하고 Prisma row나 내부 오류를 노출하지 않는다.

이 token은 사용자 인증·세션·RBAC가 아니다. 정상 개발과 운영에서는 변수를 비워 endpoint를 비활성화한다. 실제 독자 인증은 `P1-01`, 조직·권한 강제는 `P1-02`에서 구현한다.

## 6. API 오류와 요청 추적

성공 응답:

```json
{
  "data": {}
}
```

오류 응답:

```json
{
  "error": {
    "code": "INVALID_REQUEST",
    "message": "요청 오류 설명",
    "requestId": "correlation-id"
  }
}
```

유효한 `x-request-id`가 있으면 그대로 사용하고, 없거나 허용 문자·길이 기준을 벗어나면 UUID를 생성한다. 모든 응답은 `Cache-Control: no-store`와 `x-request-id`를 포함한다.

현재 공통 오류 코드는 `INVALID_REQUEST`, `NOT_FOUND`, `PAYLOAD_TOO_LARGE`, `UNSUPPORTED_MEDIA_TYPE`, `INTERNAL_ERROR`다. 인증·권한·충돌 코드는 실제 기능 도입 시 계약 테스트와 함께 확장한다.

## 7. 검증 결과

| 검증 | 결과 |
|---|---|
| TypeScript | `npx tsc --noEmit` 성공 |
| ESLint | `npm run lint` 성공 |
| 기본 단위 테스트 | 12개 파일, 94건 성공 |
| DB 통합 테스트 | 1개 파일, 5건 성공 |
| PostgreSQL commit | 감사 이벤트 정확히 1건 저장 |
| PostgreSQL rollback | 감사 이벤트 0건 유지 |
| 잘못된 내부 token | `404 NOT_FOUND` |
| 잘못된 JSON | `400 INVALID_REQUEST` |
| 1,024 byte 초과 본문 | `413 PAYLOAD_TOO_LARGE` |
| 개발 hot reload | 재로딩 후 rollback 요청 성공 |
| 개발 DB pool | `fold_web` application connection 1개 확인 |
| production build | DB 환경변수 미주입 상태에서 성공 |

기본 `npm test`에서는 DB 초기화를 일으키지 않도록 통합 테스트 5건을 제외한다. `npm run test:integration`이 `fold_web_test`만 reset하고 migration·seed 후 해당 테스트를 실행한다.

## 8. 조직 경계와 후속 구현

이번 smoke repository는 승인된 seed 조직 `LOCAL_DEV`만 조회하는 내부 플랫폼 검증용이다. 사용자가 선택한 조직 ID를 받는 업무 API가 아니므로 tenant 전환이나 cross-organization 접근 경로를 제공하지 않는다.

실제 업무 repository에서는 다음을 별도 완료 기준으로 강제한다.

- 인증 세션에서 `organizationId`를 결정한다.
- 클라이언트가 보낸 조직 ID를 권한 근거로 신뢰하지 않는다.
- 모든 업무 조회·수정 조건에 서버 조직 경계를 포함한다.
- cross-organization 읽기·쓰기 거부 통합 테스트를 `P1-02`부터 각 aggregate에 추가한다.

## 9. 운영 유예 항목

사용자 결정에 따라 운영 애플리케이션 서버와 운영 PostgreSQL 위치는 아직 정하지 않았다. 따라서 다음은 이번 단계에서 수행하지 않았다.

- 운영 DB 연결과 secret 생성
- RDS 또는 운영 서버 network·TLS 설정
- 운영 connection pool 실측 조정
- 운영 endpoint 활성화
- backup·PITR·복구 훈련

운영 구성 확정 시 [P0-08 PostgreSQL 환경 기준](./P0-08-postgresql-environment.md)의 유예 항목을 다시 연다.

## 10. 상세 실행 결과

| 단계 ID | 상태 | 작업 내용 | 산출물·검증 |
|---|---|---|---|
| `01` | `DONE` | Next.js 16 로컬 서버 문서 확인 | Route Handler·BFF·보안·환경 기준 |
| `02` | `DONE` | DB 환경변수 parser 구현 | URL·pool·timeout 단위 테스트 |
| `03` | `DONE` | Prisma singleton과 lifecycle 구현 | 지연 생성·disconnect |
| `04` | `DONE` | HTTP/application/repository 경계 구현 | 내부 수직 경로 |
| `05` | `DONE` | commit·rollback 구현 | 실제 PostgreSQL 검증 |
| `06` | `DONE` | 표준 오류·request ID 구현 | no-store·오류 envelope |
| `07` | `DONE` | 입력 보안 제한 구현 | token·JSON·본문 크기 |
| `08` | `DONE` | dev hot reload·pool 검증 | 재요청 성공·연결 1개 |
| `09` | `DONE` | production build 검증 | DB 변수 없이 build 성공 |
| `10` | `DONE` | 경계·유예·후속 작업 문서화 | 본 문서 |

## 11. 완료 기준

- [x] Next.js 16 Route Handler 기준을 확인했다.
- [x] 서버 전용 Prisma Client가 지연 생성되고 hot reload에서 재사용된다.
- [x] 환경변수와 pool·timeout이 검증된다.
- [x] HTTP·application·repository 경계가 분리됐다.
- [x] 실제 PostgreSQL commit·rollback 통합 테스트가 통과한다.
- [x] 표준 오류와 request ID가 적용됐다.
- [x] 내부 시험 경로가 기본 비활성이고 실제 인증과 구분된다.
- [x] production build가 DB 접속 없이 완료된다.
- [x] 운영 유예 항목과 P1 인증·조직 후속 작업이 분리됐다.
