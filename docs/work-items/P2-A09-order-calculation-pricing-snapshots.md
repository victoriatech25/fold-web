# P2-A09 계산·가격 스냅샷 상세계획

> 상태: `COMPLETED` — 2026-08-17 구현·자동 검증·사용자 전체 화면 검수 완료
>
> 우선순위: `P2-A09`
>
> 담당자·검수자: 사용자 본인
>
> 계획·결정일: 2026-08-17
>
> 선행 작업: `P2-A04 계산 규칙`, `P2-A06 가격 규칙`, `P2-A08 절곡 작업 스냅샷` 완료
>
> 후속 작업: `P2-A10 승인·생산 상태`, `P2-A11 수주 검색·이력`

## 1. 목표

A08의 불변 절곡 작업 문서에서 면적·절곡 횟수·V-CUT 길이를 계산하고, 계산 시점에 유효한 A06 가격표를 적용해 작업별 금액과 수주 합계를 불변 스냅샷으로 저장한다.

```text
현재 활성 절곡 작업 수집
→ 문서 checksum·고객 snapshot으로 주문 입력 hash 생성
→ 형상 가격 지표 계산
→ 고객 전용→가격등급→조직 기본 가격 해석
→ 작업별 재질비·절곡비·V-CUT비·할증 계산
→ 공급가·VAT·합계 집계
→ trace·엔진 버전·checksum과 함께 새 계산 버전 저장
```

## 2. 결정안

| ID | 결정 | 확정안 |
|---|---|---|
| `D2-A09-A` | 계산 단위 | 수주의 모든 활성 절곡 작업을 한 transaction에서 전부 계산한다. 일부 성공은 저장하지 않는다. |
| `D2-A09-B` | 버전 | 계산할 때마다 `snapshotNumber`가 증가하는 새 불변 버전을 추가한다. 기존 계산은 수정·삭제하지 않는다. |
| `D2-A09-C` | 현재성 | 현재 활성 작업의 ID·line number·문서 checksum·고객 snapshot checksum으로 입력 hash를 만든다. 최신 계산 hash와 다르면 `재계산 필요`다. 표시 순서만 바꾸는 작업은 hash에 영향을 주지 않는다. |
| `D2-A09-D` | 형상 계산 | 저장된 A08 문서를 브라우저 FoldProfile로 무손실 변환한 뒤 A06 `extractFoldPricingMetrics`를 사용한다. 계산 불가 형상은 0원 처리하지 않고 전체 계산을 거부한다. |
| `D2-A09-E` | 가격 적용 | 계산 서버 시각에 유효한 CUSTOMER→TIER→STANDARD 게시 가격을 적용한다. 가격 행과 할증은 독립적으로 fallback하며 단가 필드는 scope 사이에서 혼합하지 않는다. |
| `D2-A09-F` | 가격 변경 | 게시 가격표 변경은 기존 계산을 바꾸거나 자동 무효화하지 않는다. 명시적으로 다시 계산할 때 새 가격 trace가 새 버전에 고정된다. |
| `D2-A09-G` | VAT | 통화는 KRW, 공급가액 합계의 10%를 원 단위 `ROUND_HALF_UP`해 VAT로 저장하고 총액은 공급가+VAT로 저장한다. |
| `D2-A09-H` | 재현성 | 작업별 metrics, 단가, 원시 금액, 반올림 금액, 가격표·개정·행 ID와 checksum, 엔진 버전을 JSONB와 조회 열에 함께 저장한다. |
| `D2-A09-I` | 권한·상태 | 조회는 `order.read`, 계산은 `order.edit`; 1차 계산은 `DRAFT` 수주에서만 허용한다. `CANCELLED`는 기존 snapshot 조회만 가능하다. |
| `D2-A09-J` | 동시성 | 계산 요청은 `expectedOrderLockVersion`을 요구한다. 계산 저장과 주문 lock 증가는 같은 transaction에서 처리한다. |
| `D2-A09-K` | 오류 | 작업 없음, 가격표/가격 행 누락, 형상 오류, stale lock은 설명 가능한 409/400 envelope로 반환하고 snapshot을 남기지 않는다. |
| `D2-A09-L` | 수동 조정 | 할인·임의 단가·수동 금액 조정은 승인 정책과 함께 후속 범위로 둔다. A09 1차 snapshot은 승인된 가격표 계산값만 저장한다. |
| `D2-A09-M` | 화면 | 주문 상세에서 계산 상태, 작업별 지표·금액·가격 출처, 공급가·VAT·총액, 계산 시각·버전과 `계산/다시 계산`을 제공한다. |
| `D2-A09-N` | 감사 | 계산 생성 이벤트에는 주문 ID, snapshot 번호, 입력·결과 checksum, 합계, 작업 수를 기록하고 작업 문서·전체 결과 JSON은 감사 payload에 넣지 않는다. |

## 3. 데이터 계약

### `SalesOrderCalculationSnapshot`

- 주문별 단조 증가 `snapshotNumber`
- `inputChecksumSha256`, `resultChecksumSha256`
- 계산·가격 지표 엔진 버전, 가격 적용 시각
- 통화, VAT율, 공급가·VAT·총액, 작업 수
- 생성자·생성 시각

### `SalesOrderFoldCalculationSnapshot`

- 계산 snapshot과 원본 주문 절곡 작업 연결
- 당시 line number·이름·수량·재질 규칙·문서 checksum
- 작업 입력 checksum과 결과 checksum
- metrics·가격 결과 전체 JSONB
- 재질비·절곡비·V-CUT비·할증·공급가 조회 열

## 4. API

```text
GET  /api/v1/orders/:orderId/calculations/current
POST /api/v1/orders/:orderId/calculations
```

- GET은 최신 snapshot과 현재 입력 hash를 비교한 `stale` 상태를 반환한다.
- POST body는 `expectedOrderLockVersion`만 받는다.
- 계산 성공 시 새 주문 lock, 최신 snapshot과 작업별 결과를 반환한다.

## 5. 완료 기준

- [x] 여러 작업의 형상 지표와 가격이 한 번에 계산된다.
- [x] CUSTOMER→TIER→STANDARD 가격 trace가 snapshot에 고정된다.
- [x] 공급가, VAT 10%, 총액과 작업 합계가 일치한다.
- [x] 수량·변수·재질·작업 추가·복사·제거 후 `재계산 필요`가 표시된다.
- [x] 가격표 변경 뒤 기존 snapshot이 유지되고 재계산 시 새 버전이 생성된다.
- [x] 가격 누락·형상 오류·취소 주문·stale lock에 부분 snapshot이 남지 않는다.
- [x] 감사 이벤트와 조직 격리가 검증된다.
- [x] 단위·PostgreSQL 통합·API·Playwright·lint·typecheck·migration·build를 통과한다.
- [x] 데스크톱과 390px에서 사용자 화면 검수를 완료한다.

## 6. 구현 순서

| 단계 | 작업 |
|---|---|
| `A09-01` | 상세 결정안·데이터/API 계약 확정 |
| `A09-02` | Prisma 모델·migration·DB 제약 |
| `A09-03` | 주문 입력 hash·계산·가격 snapshot 서비스 |
| `A09-04` | API·권한·동시성·감사 |
| `A09-05` | 주문 상세 계산·합계 UI |
| `A09-06` | 단위·통합·E2E·회귀 검증 |
| `A09-07` | 화면 테스트 데이터·가이드와 사용자 검수 |

## 7. 변경 기록

| 날짜 | 변경 내용 | 작성자 |
|---|---|---|
| 2026-08-17 | A04·A06·A08 계약을 연결한 결정안 `D2-A09-A~N` 확정 및 구현 착수 | 사용자·Codex |
| 2026-08-17 | DB·계산/가격 snapshot 서비스·API·주문 상세 UI·감사·자동 검증 완료, 사용자 화면 검수 준비 | Codex |
| 2026-08-17 | 전체 화면 검수 통과 승인 및 P2-A09 `COMPLETED` 처리 | 사용자 |
