# P2-A10 수주 승인·생산 상태 상세계획

> 상태: `COMPLETED` — 2026-08-17 구현·자동 검증·사용자 전체 화면 검수 완료
>
> 우선순위: `P2-A10`
>
> 담당자·검수자: 사용자 본인
>
> 계획·결정일: 2026-08-17
>
> 선행 작업: `P2-A09 계산·가격 스냅샷` 완료
>
> 후속 작업: `P2-A11 수주 목록·이력`

## 1. 목표

최신 계산 결과가 현재 수주 입력과 일치할 때만 수주를 승인하고, 승인 시점의 계산 스냅샷을 고정한다. 승인 이후 입력·계산 변경을 차단하며 생산 요청부터 마감까지 명시적 상태 전이와 감사 이력으로 추적한다.

```text
작성 중(DRAFT)
→ 계산 완료(CALCULATED)
→ 승인(APPROVED)
→ 생산 요청(PRODUCTION_REQUESTED)
→ 생산 중(IN_PRODUCTION)
→ 생산 완료(PRODUCED)
→ 마감(CLOSED)
```

## 2. 결정안

| ID | 결정 | 확정안 |
|---|---|---|
| `D2-A10-A` | 상태 | `DRAFT`, `CALCULATED`, `APPROVED`, `PRODUCTION_REQUESTED`, `IN_PRODUCTION`, `PRODUCED`, `CLOSED`, `CANCELLED`를 사용한다. |
| `D2-A10-B` | 계산 상태 | 현재 입력과 일치하는 새 계산을 저장하면 `DRAFT→CALCULATED`로 전환한다. 계산에 영향을 주는 입력 변경은 `CALCULATED→DRAFT`로 되돌린다. |
| `D2-A10-C` | 승인 조건 | 활성 절곡 작업과 최신 비-stale 계산 스냅샷이 있어야 하며 `CALCULATED→APPROVED`만 허용한다. |
| `D2-A10-D` | 승인 고정 | 승인 시 계산 스냅샷 ID·번호·checksum, 승인자·승인 시각을 수주에 고정한다. 승인 후 계산 스냅샷을 자동 교체하지 않는다. |
| `D2-A10-E` | 변경 차단 | `APPROVED` 이후 헤더 수정, 절곡 추가·수정·복사·정렬·제거, 계산·재계산, 일반 취소를 모두 서버에서 거부한다. |
| `D2-A10-F` | 승인 취소 | 생산 요청 전 `APPROVED→CALCULATED`만 허용한다. 사유 1~500자가 필수이며 승인 고정 필드는 해제하되 계산 스냅샷은 보존한다. |
| `D2-A10-G` | 생산 흐름 | `APPROVED→PRODUCTION_REQUESTED→IN_PRODUCTION→PRODUCED→CLOSED` 단방향 전이만 허용한다. 실제 queue·재단·파일 생성은 P2-B 범위다. |
| `D2-A10-H` | 권한 | 조회는 `order.read`, 계산은 `order.calculate`, 초안 변경은 `order.edit`, 승인·승인 취소·생산 상태 전이는 `order.approve`를 요구한다. |
| `D2-A10-I` | 자기 승인 | 현재 단일 운영자 구조에서는 작성자와 승인자가 같아도 허용하며 실제 행위자를 감사에 남긴다. |
| `D2-A10-J` | 동시성 | 모든 전이는 `expectedLockVersion`으로 상태와 lock을 함께 비교하고 한 transaction에서 처리한다. stale 요청은 `409`로 거부한다. |
| `D2-A10-K` | 취소 | `DRAFT`와 `CALCULATED`만 일반 취소할 수 있다. 승인 이후에는 승인 취소가 선행되어야 하며 생산 요청 이후에는 취소하지 않는다. |
| `D2-A10-L` | 복사 | 기존 A07의 `DRAFT` 헤더 복사 범위를 유지한다. 승인본 전체 복제는 A11의 수주 이력·복사 범위에서 다룬다. |
| `D2-A10-M` | 화면 | 주문 상세에 현재 단계, 승인 고정 계산, 가능한 주 행동 하나와 상태 이력을 표시한다. 확인·사유·완료·충돌은 공통 팝업을 사용한다. |
| `D2-A10-N` | 감사 | 계산 완료, 입력 변경에 따른 상태 복귀, 승인, 승인 취소, 생산 요청, 생산 시작, 생산 완료, 마감을 `APPROVAL` 감사 이벤트로 기록한다. |

## 3. 상태 전이표

| 현재 | 행동 | 다음 | 추가 조건 |
|---|---|---|---|
| `DRAFT` | 계산 | `CALCULATED` | 활성 작업 전체 계산 성공 |
| `CALCULATED` | 입력 변경 | `DRAFT` | 계산 입력에 영향을 주는 변경 |
| `CALCULATED` | 재계산 | `CALCULATED` | 새 불변 계산 버전 저장 |
| `CALCULATED` | 승인 | `APPROVED` | 최신 계산 비-stale, `order.approve` |
| `APPROVED` | 승인 취소 | `CALCULATED` | 사유 필수, 생산 요청 전 |
| `APPROVED` | 생산 요청 | `PRODUCTION_REQUESTED` | 승인 계산 고정 유지 |
| `PRODUCTION_REQUESTED` | 생산 시작 | `IN_PRODUCTION` | `order.approve` |
| `IN_PRODUCTION` | 생산 완료 | `PRODUCED` | `order.approve` |
| `PRODUCED` | 마감 | `CLOSED` | `order.approve` |
| `DRAFT`, `CALCULATED` | 취소 | `CANCELLED` | 사유 필수 |

그 외 전이는 모두 거부한다. 생산 상태의 역전·마감 해제·취소 복구는 이번 범위에 포함하지 않는다.

## 4. 데이터·API 계약

`SalesOrder`에 승인 계산 참조, 승인자·승인 시각과 생산 단계별 행위자·시각을 추가한다. DB CHECK 제약으로 상태별 필수/금지 필드 조합을 검증한다.

```text
POST /api/v1/orders/:orderId/transitions
```

요청은 `action`, `expectedLockVersion`, 사유가 필요한 경우 `reason`을 받는다. 응답은 최신 수주 DTO이며 조직 경계·Origin·권한·strict schema·표준 오류 envelope를 적용한다.

## 5. 완료 기준

- [x] 계산 성공과 입력 변경이 `DRAFT/CALCULATED` 상태에 정확히 반영된다.
- [x] stale 계산·작업 없음·권한 없음 상태에서 승인할 수 없다.
- [x] 승인 계산 스냅샷이 고정되고 승인 이후 모든 입력 변경이 차단된다.
- [x] 승인 취소와 생산 단계 전이가 허용표대로만 동작한다.
- [x] 상태·행위자·시각·사유가 감사 이력에 남는다.
- [x] 조직 격리와 stale lock 동시성 충돌을 검증한다.
- [x] 단위·PostgreSQL 통합·API·Playwright·lint·typecheck·migration·build를 통과한다.
- [x] 데스크톱과 390px에서 사용자 화면 검수를 완료한다.

## 6. 구현 순서

| 단계 | 작업 |
|---|---|
| `A10-01` | 상세 결정안·상태 전이표 확정 |
| `A10-02` | Prisma enum·승인/생산 필드·migration 제약 |
| `A10-03` | 계산/입력 변경 상태 연결과 전이 서비스 |
| `A10-04` | 전이 API·권한·동시성·감사 |
| `A10-05` | 주문 상세 상태·승인·생산 UI |
| `A10-06` | 단위·통합·E2E·회귀 검증 |
| `A10-07` | 화면 테스트 데이터·가이드와 사용자 검수 |

## 7. 변경 기록

| 날짜 | 변경 내용 | 작성자 |
|---|---|---|
| 2026-08-17 | A09 계약과 프로젝트 상태 기준을 연결한 `D2-A10-A~N` 확정 및 구현 착수 | 사용자·Codex |
| 2026-08-17 | 상태 DB 계약·승인 계산 고정·전이 API/UI·감사·변경 차단 구현, 자동 검증과 화면 검수 환경 준비 | Codex |
| 2026-08-17 | 전체 화면 검수 통과 승인 및 P2-A10 `COMPLETED` 처리 | 사용자 |
