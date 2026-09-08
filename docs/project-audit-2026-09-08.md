# 전체 점검 — 2026-09-08

> 작성일: 2026-09-08
>
> 대상: 다음 작업 세션
>
> 범위: 저장소 전체 코드 검토, 자동 검증 8종 재실행, 브라우저 실화면 확인. 결함 10건을 찾았고 이 문서에 근거와 함께 남긴다
>
> 기준 커밋: `a032eab` (`main`)
>
> 운영 배포본: `v0.1.11` (`fold.victoria-tech.com`)
>
> 이전 인계: [2026-09-06 작업 인계](./handover-2026-09-06.md)

## 1. 요약

코드 품질은 좋다. 도메인 로직·권한·감사·낙관적 잠금이 일관되게 설계돼 있고, 테스트가 실제로 그 계약을 지키고 있으며, 소스 50,390줄에 `TODO`·`FIXME`가 하나도 없다. 자동 검증도 기능 회귀가 한 건도 없었다.

결함은 대부분 **애플리케이션이 아니라 그 바깥**에 있다. 배포 파이프라인, 컨테이너 환경, 의존성, 개발 환경 이식성이다. 2026-09-06 첫 운영 배포에서 인프라 결함 6건을 걷어냈지만 같은 성격의 문제가 아직 남아 있다.

가장 시급한 것은 **배포 절차에 DB 마이그레이션 단계가 아예 없다**는 점이다. 다음 스키마 변경 배포에서 그대로 사고가 된다.

| 구분 | 건수 |
|---|---|
| 자동 검증 명령 통과 | 6/6 (감사 게이트 제외) |
| 테스트 통과 | 517건 |
| 높음 결함 | 4건 |
| 중간 결함 | 3건 |
| 낮음 결함 | 3건 |
| 운영 의존성 취약점 | 14건 (high 9) |

## 2. 자동 검증 재실행 결과

의존성이 설치돼 있지 않은 상태였다. `npm ci` 후 전 항목을 직접 실행했다. 통합·E2E는 일회용 PostgreSQL 16 / MinIO 컨테이너로 검증한 뒤 정리했다(7절).

| 명령 | 결과 | 이번 측정값 | 문서 기재값 |
|---|---|---|---|
| `npm run typecheck` | 통과 | 오류 0 | 일치 |
| `npm run lint` | 통과 | 오류 0 | 일치 |
| `npm test` | 통과 | 375건 | 319건 |
| `npm run test:integration` | 통과 | 105건 | 72건 |
| `npm run test:e2e` | 통과 | 37건 | 25건 |
| `npm run build` | 통과 | standalone + worker | 일치 |
| `prisma migrate diff` | 통과 | 차이 없음 | 일치 |
| `npm audit --omit=dev` | **실패** | 14건 (high 9) | 14건 |

통합 105건은 일반 묶음 83건과 작업 큐·재단 묶음 22건의 합이다. 단위 테스트는 375건 통과·105건 skip이며, skip은 DB 통합 테스트가 기본 실행에서 제외되기 때문이다.

`test:integration`·`test:e2e`는 Windows에서 그대로는 실행되지 않는다(M1). 같은 단계를 수동으로 재구성해 돌린 결과다.

## 3. 진행 상황

P0 기반부터 P2-A01~A11, P2-B01~B06까지 구현·자동 검증·사용자 검수를 마쳤다. 마이그레이션 23개가 운영 DB에 적용됐고 첫 실배포가 완료됐다.

- **동작하는 것** — 절곡 2D/3D/전개도 편집, BigInt 고정소수점 계산 엔진, 변수·수식 파서, 재질·연신 규칙 개정 관리, 거래처·원판·가격, 수주 스냅샷·계산 고정·승인·생산 상태 전이, PostgreSQL 작업 큐와 worker, S3 파일 저장소, 재단 솔버, DXF 출력
- **다음 단계** — `P2-B07`~`P2-B10` 출력 묶음. `P2-B07`(PDF·작업표)은 용지·템플릿·프린터 기준이 미결정이라 실물 확인이 선행돼야 한다
- **범위 제외 확정** — 입면도, 기계 실통신(P3), 다국어

기능 진행은 계획대로다. 리스크는 운영 성숙도 쪽에 몰려 있다.

## 4. 발견한 결함

모두 이번 점검에서 직접 재현하거나 코드로 확인한 것이다.

### 4.1 높음

#### H1. 배포 절차에 DB 마이그레이션 단계가 없다

CI/CD 어디에도 `prisma migrate deploy`가 없다. CI는 스키마 차이(`db:migrate:check`)와 적용 상태(`db:migrate:status`)만 확인할 뿐, 운영 DB에 실제로 적용하는 단계가 빠져 있다.

첫 배포 때는 사람이 손으로 적용해 넘어갔지만, 다음 스키마 변경 배포는 새 코드가 없는 컬럼을 읽으면서 런타임 오류로 터진다. 더 나쁜 것은 `/api/health`가 DB를 보지 않아(H4) 헬스체크가 통과하고 자동 롤백도 발동하지 않는다는 점이다.

| 근거 | 내용 |
|---|---|
| `deploy/deploy.sh` | pull → up → health 대기. 마이그레이션 없음 |
| `.github/workflows/ci.yml` deploy job | `deploy.sh "$IMAGE"` 한 줄 |
| `docs/deployment-guide.md` | "prisma"·"마이그레이션" 언급 0회 |

#### H2. 운영 컨테이너가 UTC라 모든 시각이 9시간 어긋난다

`node:22-alpine`의 기본 시간대는 UTC이고, `Dockerfile`·`compose.yaml`·`deploy/compose.yaml` 어디에도 `TZ`를 지정하지 않는다. 날짜 포맷 호출 27곳 중 `timeZone: "Asia/Seoul"`을 고정한 곳은 4곳뿐이다.

나머지는 서버에서 UTC로 렌더되고 브라우저에서 KST로 다시 렌더돼 React hydration 오류가 발생한다. 서버 컴포넌트인 업무 홈([`src/app/page.tsx:20`](../src/app/page.tsx))은 클라이언트 재렌더가 없어 **계속 틀린 시각이 보인다**.

여기에 Node ICU와 Chrome CLDR의 ko-KR 오전/오후 표기가 달라 텍스트까지 어긋난다. 실제로 업무 홈의 최근 초안이 `9월 8일 AM 09:35`로 표시됐다. `오전 9:35`여야 한다.

| 근거 | 내용 |
|---|---|
| 컨테이너 시간대 | `docker run node:22-alpine` → resolved timeZone `UTC` |
| ICU 차이 | Node `Intl` ko-KR → `AM 12:00` / Chrome → `오전 9:00` |
| 브라우저 콘솔 | `Hydration failed because the server rendered text…` (여러 화면에서 재현) |
| 범위 | `timeZone` 미고정 23곳 / 고정 4곳 |

`timeZone`을 이미 고정한 4곳은 [`src/app/cutting/usage/page.tsx`](../src/app/cutting/usage/page.tsx), [`src/components/admin/audit-log-panel.tsx`](../src/components/admin/audit-log-panel.tsx)(2곳), [`src/server/orders/order-service.ts`](../src/server/orders/order-service.ts)다. 특히 수주번호 채번은 KST 기준을 이미 지키고 있으므로, 나머지를 여기에 맞추면 된다.

#### H3. 운영 의존성 취약점 14건이 열린 채 배포돼 있다

공개 도메인에 서비스 중인 상태에서 `next`에 SSRF, 응답 본문 캐시 혼동, **미인증 상태의 내부 Server Function 엔드포인트 노출**, Server Actions DoS가 열려 있다.

CI의 차단 게이트는 `a05094e`에서 "이번 배포 한 번만" 경고로 낮춰졌고 아직 되돌려지지 않았다. 지금은 새 취약점이 추가돼도 배포가 막히지 않는다.

| 패키지 | 내용 |
|---|---|
| `next` 16.2.10 | → 16.3.4 필요. high 9건 중 다수 |
| `prisma` 7.8.0 | `mysql2`·`valibot` 경유 moderate |
| `postcss`·`sharp` | `next` 하위 의존성 |

#### H4. `/api/health`가 DB를 보지 않아 배포 게이트가 무력하다

헬스 라우트는 `{ "status": "ok" }`를 무조건 반환한다. DB에 전혀 닿지 않는다([`src/app/api/health/route.ts`](../src/app/api/health/route.ts)).

그래서 Docker 헬스체크도, `deploy.sh`의 150초 `healthy` 대기도 DB 접속 실패·마이그레이션 미적용·권한 오류를 하나도 잡아내지 못하고 자동 롤백을 발동시키지 않는다. 2026-09-06 배포에서 실제로 이 시나리오가 발생했다. 컨테이너에 `DATABASE_URL`이 전달되지 않았는데도 app은 정상으로 판정됐다.

H1의 마이그레이션 누락도 이 때문에 조용히 통과한다.

### 4.2 중간

#### M1. Windows에서 개발·검증 명령이 실행되지 않는다

`npm run dev`가 바로 실패한다. `PORT=8000 next dev`는 POSIX 셸 문법이라 cmd에서 파싱되지 않는다.

검증 스크립트 4개는 `spawnSync("npm", …)`을 `shell` 옵션 없이 호출해 Windows에서 `ENOENT`로 죽는다. 즉 통합·E2E 테스트를 로컬에서 돌릴 방법이 없다. Playwright의 `webServer`도 같은 `dev` 스크립트를 쓰므로 함께 막힌다.

| 항목 | 내용 |
|---|---|
| 재현 | `npm run dev` → `'PORT' is not recognized…` |
| 재현 | `npm run test:integration` → `Error: spawnSync npm ENOENT` |
| 대상 | `run-integration-tests.mjs`·`reset-test-db.mjs`·`prepare-e2e.mjs`·`verify-auth-cli.mjs` |
| 수정 | `dev`는 `next dev --port 8000`, spawn은 `shell: true` |

로컬에서 통합·E2E를 못 돌리는 상태가 지금까지의 검증 노후화 원인이었다. 2026-09-06에 E2E 4건이 깨져 있던 것도 같은 뿌리다.

#### M2. IP 기준 로그인 제한이 운영에서 항상 꺼져 있다

`readTrustedSource()`는 `AUTH_TRUST_PROXY`가 false면 무조건 `null`을 반환하고([`src/server/auth/request-security.ts:37`](../src/server/auth/request-security.ts)), `recordLoginFailure()`는 source가 null이면 `SOURCE` 스코프 스로틀을 아예 건너뛴다([`src/server/auth/auth-service.ts:71`](../src/server/auth/auth-service.ts)).

`deploy/compose.yaml`은 이 값을 전달하지 않으므로 기본값 false다. 즉 `AUTH_SOURCE_FAILURE_LIMIT=20` 설정이 운영에서 한 번도 작동하지 않았다. 계정 단위 제한(5회)은 살아 있으므로, 한 IP에서 여러 계정을 훑는 방식만 제한 없이 통과한다.

켤 때는 리버스 프록시가 `X-Forwarded-For`를 신뢰 가능하게 덮어써야 한다. 그렇지 않으면 헤더 위조로 스로틀을 우회할 수 있다.

#### M3. worker는 영구 장애 상태에서도 정상으로 보인다

worker 루프는 모든 예외를 잡아 로그만 남기고 계속 돈다([`src/worker/main.ts`](../src/worker/main.ts)). 컨테이너가 죽지 않으므로 `restart` 정책이 발동하지 않고, 이미지 헬스체크는 `disable: true`로 꺼져 있다.

DB가 영구히 안 닿아도 `docker ps`에는 계속 `Up`으로 보인다. 사용자에게는 재단 작업이 "계산 중"에서 멈춘 것으로만 나타나고, 화면은 그 이유를 알려주지 않는다.

연속 실패 N회 후 `process.exit(1)`로 내려가게 하거나, worker 전용 헬스체크를 두는 편이 낫다.

### 4.3 낮음

#### L1. 문서의 검증 수치가 실제와 다르다

[`docs/current-implementation-status.md`](./current-implementation-status.md) 8절은 2026-08-17 기준 319/72/25를 그대로 두고 있고, 같은 문서 1절 요약 표는 또 다른 값(319/72/28)을 적고 있다. 실제는 375/105/37이다. 한 문서 안에서 두 숫자가 다른 것부터 정리해야 한다.

루트 `README.md`도 여전히 create-next-app 기본 문서다.

#### L2. 초안 식별자로 원본 UUID가 그대로 노출된다

업무 홈의 최근 초안이 `FOLD-00b7e2f5-d5ee-4928-9b9e-16956e588949 · r1` 형태로 표시된다. 사람이 읽거나 구두로 전달할 수 없는 식별자다.

수주에는 이미 `SO-2026-000004`라는 사람용 번호 체계가 있으므로 초안·개정에도 같은 방식을 적용할 수 있다.

#### L3. 미사용 코드 `src/stores/canvas-store.ts`

초기 MobX/Konva 예제의 사각형 상태가 남아 있고 어디서도 import되지 않는다. 상태 문서에도 잔여 코드로 기록돼 있으니 삭제하면 된다.

## 5. 사용성 점검

관리자 계정으로 실제 화면을 돌아본 결과다. 업무 도구로서 완성도가 높다. 특히 "모르는 것을 지어내지 않는" 태도가 화면 전반에 일관된다.

**잘 되어 있는 것**

- 상단 모듈 탭·서브탭·사이드 메뉴 3단 구조가 예측 가능하고, 화면마다 공통 조회조건 바가 같은 위치에 있다
- 업무 홈 통계는 "실제 서버 데이터만 집계합니다"라고 명시하고 미구현 항목은 `준비 중` 배지로 구분한다
- 빈 상태 문구가 다음 행동을 지시한다 — "재단 작업이 없습니다. 승인된 수주 상세에서 재단을 시작해 주세요."
- 절곡 편집기는 계산 요약을 편집 도구 바로 아래 가로형으로 배치해 스크롤 없이 폭·면적·수량을 동시에 본다

**고칠 것**

- 업무 홈 시각 표기(H2)가 가장 눈에 띈다. 사용자가 첫 화면에서 보는 값이 틀렸다는 인상을 준다
- worker가 떠 있지 않으면 재단이 "계산 중"에서 끝나지 않는데(M3) 화면에는 그 이유가 표시되지 않는다. 큐 대기가 길어지면 "작업 처리기 응답 없음"을 알려줘야 한다

**이미 기록된 한계**

제품 길이·수량 변경이 Undo 체크포인트를 만들지 않고, 여러 도면을 동시에 열 수 없으며(전역 싱글턴), 컷 깊이 UI가 세 컷 타입에 같은 값을 쓴다. 모두 상태 문서에 한계로 기록돼 있어 의도된 상태다.

## 6. 권장 조치 순서

앞의 세 가지는 다음 배포 전에 처리하는 편이 좋다.

| 순서 | 항목 | 내용 |
|---|---|---|
| 1 | 배포에 마이그레이션 단계를 넣는다 | H1. `deploy.sh`가 새 이미지로 `prisma migrate deploy`를 먼저 돌리고, 실패하면 컨테이너를 교체하지 않도록 한다. 배포 가이드에도 절차를 남긴다 |
| 2 | 헬스체크가 DB를 확인하게 한다 | H4. `SELECT 1`과 적용된 마이그레이션 수를 확인한다. 이게 있어야 H1의 자동 롤백이 실제로 작동한다 |
| 3 | 시간대를 고정한다 | H2. 컨테이너에 `TZ=Asia/Seoul`을 주고, 날짜 포맷터를 공용 함수 하나로 모아 `timeZone`을 강제한다. 23곳을 개별 수정하는 것보다 안전하다 |
| 4 | `next`·`prisma`를 올리고 감사 게이트를 되돌린다 | H3. 별도 작업으로 잡되, 미인증 엔드포인트 노출이 포함돼 있으므로 오래 미루지 않는다 |
| 5 | Windows 실행을 복구한다 | M1. `dev` 스크립트와 spawn 4곳 |
| 6 | 운영 설정과 문서를 맞춘다 | M2·M3·L1. `AUTH_TRUST_PROXY`, worker 실패 종료, 검증 수치 갱신, README 재작성 |

이전 인계에 남겨 둔 세 가지 — 의존성 게이트 복구, 운영 서버 루트 파티션(9.8G) 정리, 관리자 임시 비밀번호 교체 — 도 그대로 유효하다. 비밀번호는 대화 중 평문으로 오갔으므로 가장 먼저 바꾸는 편이 좋다.

## 7. 점검 방법과 재현

다음 세션이 같은 검증을 다시 돌릴 수 있도록 이번에 쓴 구성을 남긴다. 저장소 작업 트리는 변경하지 않았고, 띄운 컨테이너는 모두 제거했다.

```bash
# 일회용 PostgreSQL 16 (호스트 5432 와 충돌하지 않도록 55433 사용)
docker run -d --name fold-check-pg \
  -e POSTGRES_PASSWORD=checkpw -e POSTGRES_USER=postgres -e POSTGRES_DB=fold_web_test \
  -p 55433:5432 postgres:16

# 저장소 통합 테스트용 MinIO (compose 기본 9000 과 충돌하지 않도록 9100 사용)
docker run -d --name fold-check-minio -p 9100:9000 \
  -e MINIO_ROOT_USER=fold-web-local -e MINIO_ROOT_PASSWORD=fold-web-local-secret \
  minio/minio:RELEASE.2025-04-22T22-12-26Z server /data
```

역할 `fold_web_app`·`fold_web_migrator`·`fold_web_readonly`와 `fold_web_shadow` 데이터베이스를 만든 뒤, `prisma migrate deploy` → 권한 GRANT → `prisma db seed` 순으로 준비한다. 그다음 `RUN_DB_INTEGRATION=1`로 통합 테스트를, `scripts/bootstrap-admin.ts`로 계정을 만들고 Playwright를 실행한다.

M1 때문에 `npm run test:integration`·`npm run test:e2e`를 그대로 쓸 수 없어 각 단계를 직접 실행했다. M1을 고치면 이 우회는 필요 없다.

E2E 실행 시에는 `package.json`의 `dev` 스크립트를 `next dev`로 임시 변경해야 했다. 검증 후 원상 복구했다.

## 8. 관련 문서

- [현재 구현 현황](./current-implementation-status.md)
- [2026-09-06 작업 인계](./handover-2026-09-06.md)
- [Docker 및 배포 가이드](./deployment-guide.md)
- [로컬 화면 테스트 계정](./local-screen-test-account.md)
- [P2 실행계획](./work-items/P2-execution-plan.md)
