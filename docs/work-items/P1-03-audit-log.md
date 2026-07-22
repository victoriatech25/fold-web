# P1-03 — 감사 로그

> 상태: `VERIFYING`
>
> 우선순위: `P1`
>
> 담당자: 사용자 본인
>
> 검수자: 사용자 본인
>
> 관련 게이트: `D1-03`
>
> 계획일: 2026-07-20
>
> 상위 계획: [P1 실행계획](./P1-execution-plan.md)
>
> 선행 작업: [P1-01 독자 인증·세션](./P1-01-authentication-session.md), [P1-02 조직·사용자·RBAC](./P1-02-organization-user-rbac.md)
>
> MFC 참조 루트: `/Users/kyhoon/Library/Mobile Documents/com~apple~CloudDocs/회사/hicomtech/도면`

## 1. 목표

인증과 조직 관리에서 이미 생성하는 `AuditEvent`를 공통 감사 계약으로 통합하고, 누가·언제·무엇을·어떻게 변경했는지 조직 범위 안에서 추적할 수 있게 한다.

P1-03 완료 시 다음 경계가 보장돼야 한다.

```text
인증·관리·향후 업무 mutation
→ 승인된 audit action과 안전한 before/after 구성
→ 업무 transaction과 원자적으로 INSERT
→ PostgreSQL에서 UPDATE·DELETE 거부
→ audit.read 권한과 session organizationId로 조회
→ 한국어 목록·상세·변경 비교
```

감사 로그는 애플리케이션 오류 로그나 성능 관측 로그를 대체하지 않는다. 업무·보안 행위의 불변 이력에 집중하고 metrics·trace·알림은 P2-C10 관측성에서 다룬다.

## 2. 포함·제외 범위

### 포함

- `AuditEvent` 계약 v2와 기존 행 안전한 backfill
- 공통 action catalog·한국어 label·category·outcome
- actor 시점 snapshot과 entity·request 연결
- 허용 필드 기반 `before`·`after`·`metadata`
- password·token·cookie·secret 등 민감정보 방지
- 성공 mutation과 audit INSERT의 transaction 원자성
- PostgreSQL UPDATE·DELETE 차단과 application role 권한 축소
- 인증·P1-02 관리 이벤트의 공통 writer 전환
- 조직 범위 cursor 목록·상세·필터 API
- `/admin/audit-logs` 목록·상세·변경 비교 UI
- 감사 조회 자체의 접근 이벤트
- 단위·PostgreSQL·API·Playwright·Chrome·Edge 검증

### 제외

- 아직 존재하지 않는 승인·출력·기계 전송 기능의 실제 이벤트 생성
- 외부 SIEM·로그 수집기·WORM object storage 전송
- 암호학적 per-organization hash chain
- 감사 로그 CSV·Excel·PDF export
- 운영 보존 기간 만료 삭제·archive batch
- PostgreSQL RLS
- 일반 사용자의 자기 활동 조회
- 관리자용 감사 이벤트 수정·삭제 기능

승인·출력·기계 전송은 action category와 writer 계약만 마련한다. 실제 서비스가 구현되는 P1-08, P1-16, P2, P3 단계에서 같은 계약으로 이벤트를 추가한다.

## 3. 현재 기반과 문제점

### 현재 모델

`AuditEvent`에는 다음 필드가 있다.

```text
id
organizationId
actorUserId?
action
entityType
entityId?
requestId?
occurredAt
metadata?
```

현재 기록 action:

- `auth.admin_bootstrapped`
- `auth.login_failed`
- `auth.login_succeeded`
- `auth.logout`
- `auth.password_reset_issued`
- `auth.password_reset_completed`
- `admin.user_invited`
- `admin.user_updated`
- `admin.user_status_changed`
- `admin.user_roles_changed`
- `admin.password_reset_issued`
- `admin.department_created`
- `admin.department_updated`
- `admin.role_created`
- `admin.role_updated`
- 내부 시험용 `platform.database_smoke`

### 보완할 점

- auth와 admin writer가 중복돼 action·metadata 계약을 강제하지 못한다.
- category·outcome·source·schema version이 없다.
- actor 이름이 변경되면 사건 당시 표시값을 복원할 수 없다.
- 이전값과 이후값이 flat metadata에 섞여 일관된 비교가 어렵다.
- Prisma application role이 `AuditEvent`를 UPDATE·DELETE할 수 있다.
- action과 metadata가 임의 문자열·JSON이라 secret 혼입을 구조적으로 막지 못한다.
- 조직 범위 조회 API와 관리자 UI가 없다.
- 기존 행과 신규 v2 행의 렌더링 호환 기준이 없다.

MFC 로그 구조는 이전하지 않는다. 웹 감사는 독자 인증·PostgreSQL 조직 모델과 향후 웹 업무 흐름을 기준으로 재설계한다.

## 4. 권장 감사 모델 v2

### 4.1 필드

| 필드 | 용도 |
|---|---|
| `id` | UUID event 식별자 |
| `organizationId` | 조회·보존의 강제 조직 경계 |
| `category` | `AUTHENTICATION`, `ADMINISTRATION`, `DATA_CHANGE`, `APPROVAL`, `OUTPUT`, `MACHINE`, `SYSTEM` |
| `outcome` | `SUCCESS`, `DENIED`, `FAILURE` |
| `source` | `WEB`, `CLI`, `SYSTEM` |
| `schemaVersion` | metadata renderer 호환 버전, 신규 행은 `2` |
| `actorUserId` | 알려진 사용자 FK, 없으면 null |
| `actorDisplayName` | 사건 당시 표시명 snapshot |
| `actorEmail` | 사건 당시 계정 snapshot |
| `subjectFingerprint` | 미확인 계정 입력을 상관 분석하는 HMAC fingerprint |
| `sourceFingerprint` | 신뢰된 요청 원본을 상관 분석하는 HMAC fingerprint |
| `action` | 안정적인 영문 dotted action key |
| `entityType` | 대상 종류 |
| `entityId` | 대상 식별자 |
| `requestId` | API·서버 로그 연결 ID |
| `occurredAt` | DB가 기록한 사건 시각 |
| `before` | 변경 전 허용 필드 JSON |
| `after` | 변경 후 허용 필드 JSON |
| `metadata` | action별 추가 허용 정보 |

`actorEmail`과 `subjectFingerprint`는 감사 관리자에게만 노출한다. 로그인 입력 이메일·IP·User-Agent 원문은 저장하지 않는다.

### 4.2 index

- `(organizationId, occurredAt DESC, id DESC)` — 기본 cursor
- `(organizationId, category, occurredAt DESC, id DESC)`
- `(organizationId, action, occurredAt DESC, id DESC)`
- `(organizationId, actorUserId, occurredAt DESC, id DESC)`
- `(organizationId, entityType, entityId, occurredAt DESC, id DESC)`
- `requestId`

cursor는 `occurredAt + id`를 함께 사용해 같은 microsecond의 이벤트도 누락·중복 없이 이동한다.

### 4.3 기존 행 backfill

- 기존 행은 `schemaVersion=1`로 보존한다.
- action prefix로 category와 source를 결정한다.
- `auth.login_failed`는 `DENIED`, 나머지 기존 성공 기록은 `SUCCESS`로 backfill한다.
- actor FK가 있으면 현재 user에서 snapshot을 채운다.
- 기존 metadata는 수정·삭제하지 않고 v1 renderer에서 표시한다.
- 신규 writer 전환 이후의 행만 구조화된 `before`·`after`를 사용한다.

## 5. action catalog

공통 catalog는 action key, category, outcome 기본값, entity type, 한국어 label과 허용 payload type을 정의한다.

### P1-03에서 실제 기록

| category | action |
|---|---|
| 인증 | `auth.admin_bootstrapped`, `auth.login_failed`, `auth.login_succeeded`, `auth.logout`, `auth.password_reset_issued`, `auth.password_reset_completed` |
| 조직 관리 | `admin.user_invited`, `admin.user_updated`, `admin.user_status_changed`, `admin.user_roles_changed`, `admin.password_reset_issued`, `admin.department_created`, `admin.department_updated`, `admin.role_created`, `admin.role_updated` |
| 감사 접근 | `audit.events_viewed`, `audit.event_viewed` |
| 시스템 | `platform.database_smoke` |

### 후속 단계 예약 category

- `DATA_CHANGE`: 거래처·재질·절곡 문서·템플릿 변경
- `APPROVAL`: 게시·승인·승인 취소
- `OUTPUT`: DXF·PDF·인쇄 생성·다운로드 요청
- `MACHINE`: 기계 전송·재시도·취소

예약 category는 문자열 자리만 만들고 존재하지 않는 업무 이벤트를 미리 생성하지 않는다.

## 6. 민감정보와 payload 규칙

### 금지

- 비밀번호와 password hash
- session·reset·초대 token과 token hash
- cookie·Authorization header
- DB·API·기계 secret
- 전체 request body·response body
- IP 주소와 User-Agent 원문
- 파일 원문과 대용량 geometry

### 허용

- 상태·role key·department ID·active 값
- 변경된 표시명 등 업무 추적에 필요한 최소 필드
- entity ID·revision·checksum
- route template·HTTP method·result count
- 민감 원문을 복원할 수 없는 HMAC fingerprint

writer는 action별 payload type을 사용하고, 공통 runtime guard가 key 이름과 최대 JSON 크기를 다시 검사한다. `password`, `token`, `cookie`, `authorization`, `secret`, `credential`을 포함한 key는 대소문자와 중첩 위치에 관계없이 거부한다.

`before`·`after`는 전체 Prisma row를 자동 직렬화하지 않는다. 각 application service가 승인된 변경 필드만 명시적으로 구성한다.

## 7. 불변성과 실패 정책

### PostgreSQL

- `AuditEvent`에 `BEFORE UPDATE OR DELETE` trigger를 설치해 예외를 발생시킨다.
- `fold_web_app` role에서 `UPDATE`, `DELETE` 권한을 회수한다.
- role이 아직 없는 shadow·설치 환경에서도 migration이 동작하도록 조건부 권한 SQL을 사용한다.
- migration owner만 schema migration으로 trigger를 교체할 수 있다.
- DB 최고 관리자의 악의적 변경까지 탐지하는 WORM·hash chain은 운영 감사 인프라가 정해질 때 별도 도입한다.

### application

- 성공 인증과 성공 mutation은 같은 transaction에서 업무 변경과 audit INSERT를 완료한다.
- audit INSERT 실패 시 성공 mutation도 rollback한다.
- 로그인 실패·권한 거부처럼 원래 거부되는 요청은 audit 저장 실패가 접근 허용으로 바뀌지 않으며, 거부 응답을 유지하고 서버 보안 로그에 audit 저장 장애를 남긴다.
- validation `400`, 존재를 숨기는 `404`, 낙관적 충돌 `409`는 기본적으로 감사하지 않는다.
- 인증된 사용자의 permission `403`과 rate-limit 차단은 감사한다.

## 8. permission과 조회 경계

- 신규 permission `audit.read`를 추가한다.
- P1에서는 `ADMINISTRATOR` system role만 `audit.read`를 가진다.
- `audit.read`는 `admin.manage`와 함께 reserved permission으로 두고 custom role에 부여하지 않는다.
- 모든 query는 session의 `organizationId`를 사용하며 URL·query의 조직 ID를 받지 않는다.
- audit API와 service가 `audit.read`를 각각 검사한다.
- actor 이메일과 변경 JSON은 safe DTO로만 전달한다.

향후 독립 감사 담당자가 필요해지면 별도 `AUDITOR` system role과 개인정보 마스킹 수준을 새 결정 게이트로 추가한다.

## 9. API 계획

| method | endpoint | permission | 용도 |
|---|---|---|---|
| `GET` | `/api/v1/admin/audit-events` | `audit.read` | 조직 범위 cursor 목록·필터 |
| `GET` | `/api/v1/admin/audit-events/:auditEventId` | `audit.read` | event 상세·before/after |

목록 조건:

- 기본 최근 7일, 최대 90일 범위
- 기본 25건, 최대 100건
- category·outcome·action·actor·entity type·entity ID·request ID
- `occurredAt + id` opaque cursor
- 최신순
- `no-store`, request ID, 표준 오류 envelope

action은 catalog 값만 허용하고 자유 SQL 검색은 제공하지 않는다. actor 검색은 표시명·이메일의 trim된 부분 일치이며 최대 100자다.

감사 목록·상세 조회는 `audit.events_viewed` 또는 `audit.event_viewed`를 남긴다. 조회 audit에는 filter 종류·result count·대상 event ID만 기록하고 검색어 원문은 넣지 않는다.

## 10. 관리자 UI

### 경로

- `/admin/audit-logs`
- 기존 조직 관리 navigation에 `감사 로그` 추가

### 목록

- 기간·category·outcome·action·행위자·대상 필터
- 최신순 cursor 더보기
- 발생 시각, 행위자, 한국어 action, 대상, 결과 요약
- 기본 표시는 `Asia/Seoul`, 상세에 UTC 원본 병기
- actor가 없으면 `시스템` 또는 `확인되지 않은 사용자`로 표시

### 상세

- event·request ID
- 사건 당시 actor snapshot
- entity type·ID
- before/after key별 비교
- v1 legacy metadata
- source·outcome·schema version

수정·삭제·재실행·export 버튼은 제공하지 않는다. 좁은 화면에서는 표를 카드로 바꾸고 JSON 원문 대신 key별 읽기 전용 값을 표시한다.

## 11. 보존·운영 기준

- P1에서는 자동 삭제를 구현하지 않고 운영 DB에 보존한다.
- 감사 table의 hard delete API·repository를 만들지 않는다.
- 운영 PostgreSQL과 백업 위치가 확정된 뒤 P2-C에서 archive·보존 기간·복구 절차를 결정한다.
- backup에서 복구한 감사 로그도 동일 trigger를 가진 migration 상태여야 한다.
- 장기 용량은 category별 건수와 월별 증가량을 측정하되 P1에서 partition을 선행 구현하지 않는다.

이 기준은 법정 보존 기간을 선언하는 것이 아니라 현재 프로젝트의 기술 정책이다. 법률·계약상 기간이 확정되면 더 긴 기준을 우선한다.

## 12. 테스트 계획

| 종류 | 핵심 사례 |
|---|---|
| 단위 | action catalog, permission, payload redaction, v1/v2 renderer |
| migration | 기존 행 backfill, 빈 DB, upgrade, app role 권한 |
| PostgreSQL | UPDATE·DELETE trigger 거부, INSERT 허용, mutation rollback 원자성 |
| 보안 | 타 조직 IDOR, `audit.read` 없는 API, reserved permission, secret key 거부 |
| 조회 | 복합 cursor, 기간·category·actor·entity·request filter |
| actor | 이름 변경 뒤 snapshot 유지, null actor·CLI·SYSTEM 표시 |
| E2E 관리자 | 필터→목록→상세→before/after 비교 |
| E2E 일반 사용자 | navigation 미표시·페이지 404·API 403 |
| 사용자 | Chrome·Edge 1366×768 이상 한국어 목록·상세 검수 |

테스트용 조직별 이벤트는 서로 다른 organization fixture를 사용해 병렬 실행 간섭을 막는다.

## 13. 상세 실행 단계

| 단계 | 상태 | 작업 | 종료 검증 |
|---|---|---|---|
| `01` | `DONE` | 현재 schema·auth·admin audit 분석 | 본 문서 3장 |
| `02` | `DONE` | D1-03-A~L 결정 승인 | 2026-07-20 전체 승인 |
| `03` | `DONE` | Prisma v2와 append-only migration | 빈 DB·v1 upgrade·권한 시험 통과 |
| `04` | `DONE` | typed action catalog·payload guard·writer | 단위 시험 통과 |
| `05` | `DONE` | 기존 auth·admin writer 전환 | transaction·secret 비노출 검증 |
| `06` | `DONE` | 조직 범위 repository·service·API | permission·IDOR·cursor 통과 |
| `07` | `DONE` | 감사 관리자 UI·navigation | 빌드·Playwright 통과 |
| `08` | `DONE` | PostgreSQL 통합·migration 회귀 | app role·owner update/delete 거부 |
| `09` | `DONE` | Playwright·필수 로컬 CI | 관리자·일반 사용자 흐름 통과 |
| `10` | `IN_PROGRESS` | 문서·Chrome·Edge 사용자 검수 | 자동 검증 완료, 사용자 직접 검수 대기 |

## 14. D1-03 권장 결정안

2026-07-20 사용자가 `D1-03-A~L` 권장안을 전체 승인했다.

| ID | 권장안 |
|---|---|
| `D1-03-A` | 별도 `audit.read` permission을 추가하고 P1에서는 ADMINISTRATOR 전용 reserved 권한으로 유지 |
| `D1-03-B` | category·outcome·source·schemaVersion·actor snapshot·before/after를 갖는 AuditEvent v2 |
| `D1-03-C` | 기존 행은 schemaVersion 1로 보존하고 action prefix·actor 관계를 안전하게 backfill |
| `D1-03-D` | DB trigger + application role 권한 회수로 UPDATE·DELETE를 차단하고 hash chain은 보류 |
| `D1-03-E` | 성공 mutation·로그인은 audit과 원자 처리, 거부 요청은 audit 장애와 관계없이 계속 거부 |
| `D1-03-F` | action별 허용 payload와 공통 secret-key runtime 거부를 함께 적용 |
| `D1-03-G` | IP·이메일 입력·User-Agent 원문 없이 알려진 actor snapshot과 HMAC fingerprint만 저장 |
| `D1-03-H` | 현재 auth·admin 이벤트를 통합하고 승인·출력·기계 category는 후속 writer 계약만 예약 |
| `D1-03-I` | 최근 7일·최대 90일, 25/100건 cursor와 조직 범위 목록·상세 API |
| `D1-03-J` | `/admin/audit-logs` 한국어 목록·필터·상세 before/after 비교, 수정·삭제·export 없음 |
| `D1-03-K` | 감사 목록·상세 접근도 filter 종류·result count·대상 ID만 별도 감사 |
| `D1-03-L` | P1 자동 삭제 없이 보존하고 archive·법률/계약 보존 기간·partition은 운영 결정 후 확정 |

## 15. 완료 기준

- [x] 기존 audit 행을 손실 없이 v2 schema로 upgrade한다.
- [x] application role과 Prisma에서 audit UPDATE·DELETE가 모두 거부된다.
- [x] 성공 mutation과 audit이 함께 commit 또는 rollback된다.
- [x] action·before·after·metadata에 password·token·secret이 들어갈 수 없다.
- [x] 사건 당시 actor와 대상·이전/이후·시각·request ID를 조회할 수 있다.
- [x] 타 조직 event와 `audit.read` 없는 사용자는 목록·상세에 접근할 수 없다.
- [x] system role·reserved audit permission을 custom role로 우회할 수 없다.
- [x] v1과 v2 event를 한국어 UI에서 안전하게 표시한다.
- [x] 단위·migration·PostgreSQL·Playwright·필수 로컬 CI가 통과한다.
- [ ] Chrome·Edge 사용자 직접 검수가 승인된다.

## 16. 사용자 결정 게이트

`D1-03-A~L`은 2026-07-20 전체 승인됐다. 이후 권장안을 변경하면 모델·보안·조회 계약과 테스트 영향을 먼저 수정하고 사용자에게 다시 확인받는다.

## 17. 구현·자동 검증 기록

2026-07-22 기준 다음 구현과 자동 검증을 완료했다.

- Prisma `AuditEvent` v2 migration, 기존 v1 행 backfill, append-only trigger와 application role 권한 회수
- action별 TypeScript payload 계약, 16KiB 제한과 중첩 민감 key runtime 차단 공통 writer
- 인증·관리·내부 DB 검증·권한 거부 이벤트의 공통 writer 전환
- `audit.read` reserved permission, 조직 범위 목록·상세 API, 7일 기본·90일 제한·25/100건 복합 cursor
- `/admin/audit-logs` 한국어 필터·목록·상세, 한국 시각과 UTC 원본, before·after·metadata 표시
- 감사 목록·상세 조회 자체의 최소 접근 감사

검증 결과:

- TypeScript, ESLint, 단위 테스트 `118`건 통과
- PostgreSQL 통합 테스트 `22`건 통과
- 별도 임시 schema에서 v1→v2 실제 migration과 backfill·trigger 통과
- Next.js production build 통과
- Playwright Chromium `4`개 사용자 흐름 통과

남은 종료 게이트는 사용자가 Chrome·Edge에서 목록·필터·상세를 직접 확인하고 승인하는 것이다.
