# P2-B01 작업 queue·worker 상세계획

> 상태: `DONE` — 2026-08-17 구현·자동 검증 완료, 2026-08-22 사용자 화면 검수 완료
>
> 우선순위: `P2-B01`
>
> 담당자·검수자: 사용자 본인
>
> 계획 작성일: 2026-08-17
>
> 선행 작업: `P2-A11 수주 목록·이력` 완료로 P2-A 묶음 종료
>
> 상위 계획: [P2 실행계획](./P2-execution-plan.md)
>
> 관련 결정 게이트: `D2-B01-*` (queue 제품과 worker 배포 방식)

## 1. 목표

오래 걸리는 작업을 요청과 분리해 서버에서 실행하고, worker가 죽거나 재시작해도 작업이 유실·중복되지 않게 만든다. 사용자는 작업을 요청한 뒤 진행 상태를 확인하고 실패한 작업을 다시 실행할 수 있다.

이 작업 자체는 사용자에게 새 업무 기능을 주지 않는다. 재단 solver(`P2-B04`), PDF·라벨(`P2-B07`~`B08`), 대량 DXF(`P2-B09`), 데이터 이전(`P2-C02`~`C05`)이 모두 올라탈 기반을 만든다.

## 2. 계승하는 확정 기준

[MFC 도면Pro 웹 재구축 종합 설계](../web-rebuild-architecture.md)에 적힌 출발점을 기본값으로 삼는다.

| 근거 위치 | 내용 |
|---|---|
| 6.2 권장 배포 단위 | `queue`는 "초기에는 PostgreSQL 기반 큐도 가능", `worker`는 web과 분리된 배포 단위 |
| 20. 아직 결정해야 할 사항 | "큐: 초기 PostgreSQL queue, 부하 증가 시 Redis 계열 검토" |
| 6.2 | 웹과 worker는 같은 TypeScript 도메인 패키지와 Prisma 기반 DB 코드를 공유한다 |

아래 결정안은 이 기준을 뒤집지 않는 범위에서 세부를 채운 것이다.

## 3. 확정안

2026-08-17 `A~N` 전체를 사용자가 승인했다.

| ID | 결정 | 확정안 | 근거 |
|---|---|---|---|
| `D2-B01-A` | queue 제품 | PostgreSQL `JobQueue` 테이블과 `FOR UPDATE SKIP LOCKED`로 구현한다. Redis·SQS 같은 별도 제품을 도입하지 않는다. | 설계 문서의 출발점이다. 새 제품을 들이면 비용·백업·모니터링·장애 대상이 함께 늘고 그 부담은 운영 쪽이 진다. 현재는 단일 조직·단일 서버 부하이며, 작업 상태를 업무 데이터와 같은 transaction에서 다룰 수 있는 이점도 크다. 처리량이 실제로 부족해지면 그때 Redis 계열을 재검토한다. |
| `D2-B01-B` | worker 배포 단위 | 지금 쓰는 Docker 이미지를 그대로 쓰고 진입점만 다른 컨테이너를 `compose.yaml`에 하나 추가한다. 새 이미지·새 저장소·새 서버를 만들지 않는다. | web과 도메인·Prisma 코드를 공유해야 계산 결과가 갈라지지 않는다. 이미지를 하나로 유지하면 배포·rollback 절차도 지금 것을 그대로 쓴다. |
| `D2-B01-C` | 작업 계약 | `type`(작업 종류), `payload`(JSONB 입력), `result`(JSONB 출력), `status`, `attempt`, `progressPercent`를 가진 단일 `JobQueue` 모델을 쓴다. 작업 종류별 payload는 Zod strict schema로 서버에서 검증한다. | 작업 종류마다 테이블을 만들면 재시도·취소·관측 로직이 갈라진다. 계약은 한 곳에 두고 종류별 차이는 schema로 좁힌다. |
| `D2-B01-D` | 중복 방지 | 요청자가 `idempotencyKey`를 주고 `[organizationId, type, idempotencyKey]`에 unique를 건다. 같은 키 재요청은 새 작업을 만들지 않고 기존 작업을 그대로 반환한다. | 새로고침·이중 클릭·네트워크 재시도로 같은 작업이 두 번 도는 것을 DB 제약으로 막는다. 응답 코드로 신규(201)와 기존(200)을 구분한다. |
| `D2-B01-E` | 재시도 | 실패 시 지수 backoff로 다시 큐에 넣는다. `availableAt = now + min(10초 × 2^attempt, 10분)`이고 기본 `maxAttempts`는 5다. 초과하면 `FAILED`로 고정하고 감사 이벤트를 남긴다. | 일시적 실패(DB 연결, 외부 자원)는 자동으로 넘기고, 입력 자체가 잘못된 작업은 무한 재시도로 큐를 막지 않게 한다. |
| `D2-B01-F` | timeout·좀비 회수 | lease 방식을 쓴다. worker가 작업을 잡을 때 `leaseExpiresAt`을 잡고 실행 중 주기적으로 갱신한다. lease가 만료된 `RUNNING` 작업은 회수해 `attempt`를 올리고 다시 큐에 넣는다. | worker가 강제 종료되거나 서버가 재부팅돼도 작업이 `RUNNING`에 갇히지 않는다. "worker 재시작에도 결과 일관성 유지"라는 완료 기준의 핵심이다. |
| `D2-B01-G` | 취소 | `QUEUED`는 즉시 `CANCELLED`로 바꾼다. `RUNNING`은 취소 요청 표시만 남기고 worker가 정해진 확인 지점에서 스스로 멈춘다. 강제 종료하지 않는다. | 실행 중 작업을 밖에서 끊으면 절반만 쓴 결과가 남는다. 멈추는 지점은 작업 종류가 정한다. |
| `D2-B01-H` | 진행 상태 전달 | 우선 폴링(2초 간격)으로 시작하고 SSE는 도입하지 않는다. | 전체 작업계획서 `P2-B01` 행에는 SSE가 적혀 있으나, 지금은 진행률을 실시간으로 봐야 할 만큼 긴 작업이 없다. SSE는 reverse proxy 연결 유지·타임아웃 설정이 함께 붙는다. 재단 solver(`P2-B04`)나 대량 DXF(`P2-B09`)에서 실제 소요 시간을 본 뒤 도입한다. 상위 계획서를 미루는 항목이라 2026-08-17 사용자 승인을 별도로 받았다. |
| `D2-B01-I` | 첫 실제 작업 | `dxf.export` 한 종류를 queue 경로로 만들어 계약을 실증한다. 현재 동기 생성 경로는 그대로 두고 병행한다. 생성한 바이트의 보관은 `P2-B02` 범위이므로 B01에서는 checksum·크기까지만 결과에 남긴다. | 소비자 없는 queue를 먼저 만들면 계약이 맞는지 확인할 방법이 없다. 이미 있는 DXF 생성이 가장 싼 실증 대상이다. |
| `D2-B01-J` | 권한 | 작업 생성은 그 작업이 속한 업무 권한을 그대로 요구한다(예: `dxf.export`는 `output.print`). 작업 목록·상태 조회는 조직 범위 안에서 본인이 만든 작업만, `admin.manage`는 조직 전체를 본다. | queue가 권한 우회 통로가 되지 않게 한다. 작업 payload에는 업무 데이터가 들어간다. |
| `D2-B01-K` | 조직 경계 | 모든 조회·전이·worker의 작업 선택에 `organizationId`를 건다. worker도 작업에 실린 조직 범위 밖 데이터를 읽지 않는다. | 기존 모든 서비스와 같은 규칙이다. |
| `D2-B01-L` | 감사 | `job.enqueued`, `job.succeeded`, `job.failed`, `job.cancelled`를 기존 append-only `AuditEvent`에 남긴다. payload 원문은 남기지 않고 `type`·`idempotencyKey`·`attempt`·오류 요약만 남긴다. | 감사 로그에 업무 입력 전체가 복제되면 보존·개인정보 범위가 커진다. |
| `D2-B01-M` | 보관 | 종료된 작업은 90일 뒤 정리한다. 정리도 queue 자신의 정기 작업으로 돌린다. | 큐 테이블이 무한히 커지면 선택 쿼리가 느려진다. 기간은 운영하며 조정한다. |
| `D2-B01-N` | 관측 | 구조화 로그와 함께 큐 깊이·최고 대기시간·실패율을 읽는 관리 화면용 조회를 둔다. 외부 모니터링 제품은 `P2-C10`에서 결정한다. | 작업이 밀리는 것을 사용자가 알 방법이 있어야 한다. 지금 단계에서 제품을 고르지는 않는다. |

## 4. 범위

### 포함

- `JobQueue` Prisma 모델과 migration
- 작업 등록·조회·취소·재실행 API와 Zod 계약
- `SKIP LOCKED` 기반 작업 선택, lease 갱신, 좀비 회수
- 지수 backoff 재시도와 `maxAttempts` 초과 처리
- worker 진입점과 `compose.yaml` 서비스 추가, graceful shutdown
- `dxf.export` 작업 종류 하나와 실증 경로
- 작업 목록·상태 화면과 실패 작업 다시 실행
- 감사 이벤트와 종료 작업 정리 작업

### 제외

- object storage와 산출물 바이트 보관 (`P2-B02`)
- 재단 solver, PDF, 라벨, 대량 DXF 작업 종류 (`P2-B04`~`B09`)
- SSE 실시간 진행률 (`D2-B01-H` 승인 시 후속)
- 외부 모니터링·알림 제품 (`P2-C10`)
- 운영 서버 구성 변경 (`P2-C08`)

## 5. API 계약

```text
POST   /api/v1/jobs                 작업 등록 (idempotencyKey 필수)
GET    /api/v1/jobs?type=&status=&cursor=&limit=   작업 목록
GET    /api/v1/jobs/:jobId          작업 상세와 진행 상태
POST   /api/v1/jobs/:jobId/cancel   취소 요청
POST   /api/v1/jobs/:jobId/retries  실패 작업 다시 실행
```

- 등록은 새 작업이면 `201`, 같은 `idempotencyKey`의 기존 작업이면 `200`으로 같은 DTO를 반환한다.
- 목록은 `{ items, nextCursor }`이며 기존 수주 목록과 같은 opaque cursor 규칙을 쓴다.
- 응답에 `payload` 원문은 넣지 않는다. 작업 종류가 정한 안전한 요약만 넣는다.
- 오류는 기존 `apiErrorResponse` envelope를 그대로 쓴다.

## 6. 상태 전이

```text
QUEUED ──(worker 선택)──> RUNNING ──> SUCCEEDED
  ↑                          │
  │                          ├──> FAILED (attempt >= maxAttempts)
  └──(재시도 backoff)────────┤
  │                          └──> CANCELLED (취소 요청 확인)
  └──(lease 만료 회수)───────┘

QUEUED ──(즉시 취소)──> CANCELLED
FAILED ──(사용자 다시 실행)──> QUEUED
```

## 7. 완료 기준

- [x] 같은 `idempotencyKey`로 동시에 여러 번 등록해도 작업이 하나만 생긴다.
- [x] worker를 여러 개 띄워도 한 작업을 두 worker가 잡지 않는다.
- [x] 실행 중 worker를 강제 종료하면 lease 만료 후 작업이 회수되어 다시 실행된다.
- [x] 실패 작업이 backoff 간격으로 재시도되고 `maxAttempts` 초과 시 `FAILED`로 멈춘다.
- [x] `QUEUED` 취소는 즉시, `RUNNING` 취소는 확인 지점에서 반영된다.
- [x] 조직 경계와 권한을 서버에서 검사하고 payload 원문이 응답·감사에 노출되지 않는다.
- [x] `dxf.export` 작업이 동기 경로와 같은 checksum을 만든다.
- [x] 화면에서 작업 목록·진행·실패 사유를 보고 다시 실행할 수 있다.
- [x] 단위·PostgreSQL 통합·API·Playwright·lint·typecheck·migration·build를 통과한다.
- [x] [배포 가이드](../deployment-guide.md)에 worker 서비스와 환경변수를 반영했다.
- [ ] 컨테이너 이미지로 worker를 띄우는 배포·rollback을 실제 서버에서 검증한다. (잔여)

## 8. 구현 순서

| 단계 | 작업 | 상태 |
|---|---|---|
| `B01-01` | 결정안 승인과 작업 계약·payload schema 확정 | `DONE` |
| `B01-02` | `JobQueue` Prisma 모델과 migration | `DONE` — 빈 test DB 적용과 dev DB upgrade 모두 확인 |
| `B01-03` | 등록·조회·취소·재실행 application service와 API | `DONE` |
| `B01-04` | `SKIP LOCKED` 선택, lease 갱신, 좀비 회수 | `DONE` |
| `B01-05` | 재시도 backoff와 `maxAttempts` 처리 | `DONE` |
| `B01-06` | worker 진입점, graceful shutdown, `compose.yaml` | `DONE` — 컨테이너 이미지 실행은 아래 잔여 항목 참고 |
| `B01-07` | `dxf.export` 작업 종류와 동기 경로 대조 | `DONE` — checksum·크기·entity 수 일치 확인 |
| `B01-08` | 작업 목록·진행·취소·재실행 화면 | `DONE` |
| `B01-09` | 감사·정리 작업 | `DONE` — 관측 조회 화면은 잔여 항목 |
| `B01-10` | 화면 테스트 가이드와 사용자 검수 | `DONE` — 2026-08-22 [가이드](../P2-B01-screen-test-guide.md) 전 항목 사용자 검수 통과 |

## 9. 위험과 대응

| 위험 | 대응 |
|---|---|
| PostgreSQL queue의 폴링이 DB에 부담을 준다 | 폴링 간격을 `WORKER_IDLE_POLL_MS`로 두고 claim 쿼리에 `(status, priority, availableAt, id)` 인덱스를 걸었다. Prisma schema로는 부분 인덱스를 표현할 수 없어 일반 인덱스를 썼다. 부하가 실제로 문제되면 raw migration으로 부분 인덱스를 검토한다. |
| worker와 web이 같은 DB 연결 풀을 두고 경쟁한다 | worker의 `DATABASE_CONNECTION_LIMIT`를 별도로 낮게 잡고 배포 후 실측한다. |
| 작업이 오래 걸려 lease 갱신이 밀린다 | 갱신 주기를 lease 길이의 1/3로 잡고, 갱신 실패 시 작업을 스스로 중단해 중복 실행을 막는다. |
| 소비자 없는 기반을 과설계한다 | `dxf.export` 하나로 계약을 실증하고, 나머지 작업 종류는 각자의 작업 항목에서 붙인다. |
| `statement_timeout` 5초가 긴 worker 작업을 끊는다 | worker 연결은 별도 timeout 설정을 쓰고 `P0-08` 환경 기준 문서에 반영한다. |

## 10. 변경 기록

| 날짜 | 변경 내용 | 작성자 |
|---|---|---|
| 2026-08-17 | `D2-B01-A~N` 결정안 최초 작성. 설계 문서의 PostgreSQL queue 출발점을 유지하고 SSE 연기와 첫 실증 작업 범위를 사용자 결정 항목으로 올림 | Claude |
| 2026-08-17 | `A~N` 전체 승인. queue는 PostgreSQL, 진행 전달은 폴링(SSE 연기), 첫 실증은 `dxf.export`로 확정하고 상태를 `READY`로 변경 | 사용자·Claude |
| 2026-08-17 | `B01-02`~`B01-10` 구현과 자동 검증 완료. 화면 테스트 가이드 작성 후 상태를 `VERIFYING`으로 변경 | Claude |
| 2026-08-22 | 사용자 화면 검수 통과. 상태를 `DONE`으로 변경. 실서버 컨테이너 배포 검증은 `P2-C08`로, 큐 관측 화면과 `dxf.export` 진입 버튼은 후속 작업으로 남긴다 | 사용자·Claude |

## 11. 검증 결과

| 검증 | 명령 | 결과 |
|---|---|---|
| 단위 | `npm test` | 성공 — 319건 (backoff 경계 3건 추가) |
| PostgreSQL 통합 | `npm run test:integration` | 성공 — 72건 (작업 큐 10건 추가) |
| E2E | `npm run test:e2e` | 성공 — 28개 시나리오 (작업 큐 1건 추가) |
| lint·typecheck | `npm run lint`, `npm run typecheck` | 성공 |
| migration | `npm run db:migrate:check` | 차이 없음. 빈 test DB와 기존 dev DB 양쪽에 적용 확인 |
| build | `npm run build` | 성공 — Next.js standalone과 `worker.mjs` 번들 생성 |
| worker 실행 | standalone 출력만 복사한 격리 디렉터리에서 `NODE_ENV=production node worker.mjs` | 성공 — 기동·작업 처리·`SIGTERM` graceful 종료 확인 |

통합 테스트가 확인하는 것은 다음과 같다.

- 같은 멱등키 동시 등록 5건에서 작업이 하나만 생성됨
- 동시 claim 3건에서 한 worker만 작업을 가져감
- lease 만료 회수 뒤 다른 worker가 이어받아 완료하고, 죽은 worker의 lease 갱신은 거부됨
- 재시도 불가 오류가 `maxAttempts`를 기다리지 않고 즉시 `FAILED`로 확정됨
- queue 경로 DXF의 checksum·크기·entity 수가 동기 경로와 일치
- 조직 경계와 본인 작업 범위, DTO·감사에 payload 원문 미노출

## 12. 잔여 항목

- **컨테이너 배포 검증.** worker 번들을 standalone 출력만 있는 격리 환경에서 실행해 확인했지만, 실제 `linux/amd64` 이미지를 빌드해 서버에서 띄우는 검증은 아직 하지 않았다. 운영 배포 시점(`P2-C08`)과 함께 처리한다.
- **관측 조회 화면.** `D2-B01-N`의 큐 깊이·대기시간·실패율 조회는 구조화 로그까지만 구현했다. 관리 화면 노출은 실제로 작업이 밀리는 종류가 생긴 뒤에 붙인다.
- **`dxf.export` 진입 버튼.** 계약 실증용이라 화면 버튼을 두지 않았다. 사용자용 진입점은 `P2-B09` 대량 DXF에서 만든다.
