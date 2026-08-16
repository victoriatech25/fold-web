# P2-A08 절곡 작업 스냅샷 상세계획

> 상태: `VERIFYING` — 구현·자동 검증 완료, 사용자 화면 검수 대기
>
> 우선순위: `P2-A08`
>
> 담당자·검수자: 사용자 본인
>
> 계획 작성일: 2026-08-15
>
> 결정 승인일: 2026-08-17
>
> 선행 작업: `P1-08 절곡 템플릿 라이브러리`, `P2-A07 수주 기본정보` 완료
>
> 후속 작업: `P2-A09 계산·가격 스냅샷`, `P2-A10 승인·생산 상태`, `P2-A11 수주 검색·이력`

## 1. 목표

게시된 절곡 템플릿 개정을 작성 중 수주에 깊은 복사하고, 주문별 수량·변수·재질·원판 입력을 관리한다. 추가 당시 문서와 고객 표시정보를 불변 스냅샷으로 보존하여 템플릿이나 기준정보가 나중에 변경·중지되어도 기존 수주가 달라지지 않게 한다.

```text
게시 절곡 개정 선택
→ 서버가 정규화 문서와 출처를 검증
→ 수주 절곡 작업으로 깊은 복사
→ 고객 표시정보 최초 1회 고정
→ 수량·직접 입력 변수·재질·원판 조정
→ 복사·순서 변경·제거
→ P2-A09에서 계산·금액 스냅샷 생성
```

## 2. 근거와 범위

- 범위 기준은 작업 스냅샷을 “수주에 추가한 시점의 절곡 geometry, 변수, 규칙 참조를 보존한 불변 입력”으로 정의한다.
- 레거시 `sellfold`, `sellfoldxy`, `SFvari`는 주문별 형상·수량·변수 사본을 두었으며, 웹은 이를 `SalesOrderFoldItem`의 정규화 JSON 스냅샷으로 재설계한다.
- P1의 `FoldRevision.document`는 geometry, 변수·수식, 재질 규칙, 원판과 계산 설정을 포함하며 게시 후 수정되지 않는다.
- 레거시 화면의 임의 geometry 편집·병합 동작은 그대로 복제하지 않는다. 웹에서는 게시 개정 선택과 주문 입력 조정에 집중한다.

포함:

- 게시 개정 검색·미리보기·추가
- 수주별 절곡 작업 목록과 상세
- 수량, 직접 입력 변수, 재질 규칙 개정, 원판 지정
- 작업 사본 만들기, 순서 변경, soft remove
- 고객·현장·고객 담당자 표시정보 최초 스냅샷
- 조직·권한·동시 수정·감사·무결성 검증

제외:

- 계산 결과, 면적·중량, 단가·할증·VAT·합계(A09)
- 검토·승인·생산 상태와 승인 후 입력 동결(A10)
- 고급 주문 검색·작업 이력 UI·생산 요청(A11)
- 주문 안에서 geometry·절곡선·계산식 구조 편집
- 재단 배치, PDF·라벨·대량 DXF, 기계 통신

## 3. 권장 결정안

| ID | 결정 | 권장안 |
|---|---|---|
| `D2-A08-A` | 도메인 명칭 | DB aggregate child는 `SalesOrderFoldItem`, UI는 `절곡 작업`으로 표기한다. 한 수주에 여러 작업을 둔다. |
| `D2-A08-B` | 선택 가능한 원본 | 신규 추가는 같은 조직의 활성 템플릿에 속한 현재 `PUBLISHED` 개정만 허용한다. `DRAFT`, `REVIEW`, `RETIRED`, 삭제 개정은 신규 선택에서 제외하되 이미 복사한 주문은 계속 읽는다. |
| `D2-A08-C` | 스냅샷 방식 | 검증·정규화된 `FoldRevision.document` 전체를 JSONB로 깊은 복사한다. 주문 조회·편집·계산은 복사본만 사용하고 원본 개정을 다시 결합하지 않는다. |
| `D2-A08-D` | 출처 추적 | 원본 template/revision UUID, 템플릿 코드·이름, 개정 번호, 원본 checksum을 함께 보존한다. UUID는 추적용이며 원본 삭제·변경이 주문 표시를 바꾸지 않는다. |
| `D2-A08-E` | 중복 저장 무결성 | 행의 이름·수량·schema version·material rule revision·sheet item·checksum과 문서 내부 값을 함께 저장하되 서버가 일치 여부를 검증한다. checksum은 정규 JSON 전체로 다시 계산한다. |
| `D2-A08-F` | 고객 snapshot | 첫 활성 작업 추가 transaction에서 거래처·현장·고객 담당자의 코드·이름·주소·연락처를 schema version과 checksum이 있는 JSON으로 한 번만 저장한다. 내부 수주 담당자는 snapshot에 넣지 않는다. |
| `D2-A08-G` | 헤더 잠금 | 고객 snapshot 생성 후에는 거래처·현장·고객 담당자를 바꾸지 못한다. 작업을 모두 제거해도 snapshot과 잠금은 유지하며, 고객을 바꾸려면 새 수주를 만든다. 내부 담당자·납기·외부 참조·비고는 계속 수정할 수 있다. |
| `D2-A08-H` | 입력 편집 | 수량, 수식이 없는 변수 값, 게시된 활성 재질 규칙 개정과 그 재질에 속한 활성 원판만 수정할 수 있다. 수식 변수와 geometry·계산 설정은 읽기 전용이다. 클라이언트가 보낸 material/sheet snapshot은 신뢰하지 않고 서버가 기준정보에서 재구성한다. |
| `D2-A08-I` | 교체·복사 | 다른 템플릿 개정으로의 교체는 기존 행을 덮어쓰지 않고 새 작업 추가 후 기존 작업 제거로 처리한다. 작업 복사는 현재 주문 snapshot과 주문별 입력을 복사하며 최신 템플릿을 다시 읽지 않는다. A07의 수주 헤더 복사는 계속 절곡 작업을 복사하지 않는다. |
| `D2-A08-J` | 제거·순서 | 작업은 soft remove하고 line number를 재사용하지 않는다. 화면 순서는 별도 `sortOrder`로 관리하며 제거된 작업은 일반 조회에서 제외한다. |
| `D2-A08-K` | 상태 경계 | A08의 모든 작업 변경은 `DRAFT` 수주에서만 허용한다. `CANCELLED`는 읽기 전용이고 A10 상태 추가 후 동일 정책을 전이표로 확장한다. |
| `D2-A08-L` | 동시 수정 | 모든 mutation은 `expectedOrderLockVersion`, 개별 작업 변경은 추가로 `expectedItemLockVersion`을 요구한다. transaction에서 주문과 작업 lock을 함께 증가시키며 stale 요청은 최신 요약을 포함한 `409`를 반환한다. |
| `D2-A08-M` | 권한 | 조회·게시 개정 선택 목록은 `order.read`, 추가·변경·복사·순서 변경·제거는 `order.edit`로 검사한다. 주문 업무용 선택 API는 게시 개정의 제한된 정보만 노출하므로 별도 `template.fold.read`를 요구하지 않는다. |
| `D2-A08-N` | 규모·목록 | 한 수주에 활성 작업 최대 1,000개, 작업 문서 최대 2MB를 허용한다. 목록은 50개 cursor pagination을 사용하고 순서 변경은 현재 활성 항목의 완전한 ID 배열을 최대 1,000개까지 받는다. |
| `D2-A08-O` | 감사 | 추가·변경·복사·제거·순서 변경·고객 snapshot 생성을 typed audit event로 기록한다. 감사 payload에는 문서 본문을 넣지 않고 출처, checksum, 변경 필드와 before/after 요약만 둔다. |
| `D2-A08-P` | 계산 경계 | A08은 입력 문서의 구조와 참조를 검증하지만 계산 결과를 저장하거나 금액을 산출하지 않는다. 입력 변경은 이후 A09 계산 snapshot을 무효화할 수 있는 계약만 마련한다. |
| `D2-A08-Q` | 화면 | 주문 상세 아래 `절곡 작업` 영역을 추가한다. 게시 템플릿 선택 drawer, 미리보기, 작업 카드/표, 수량·변수·재질·원판 편집, 복사·제거·순서 변경과 저장/충돌 상태를 제공한다. |

## 4. 데이터 계약

### 4.1 `SalesOrder` 확장

| 필드 | 규칙 |
|---|---|
| `partySnapshotSchemaVersion` | snapshot이 없으면 null, 최초 버전은 `1` |
| `partySnapshot` | 거래처·현장·고객 담당자의 당시 표시정보 JSONB |
| `partySnapshotChecksumSha256` | 정규화 snapshot SHA-256 |
| `partySnapshotCapturedAt` | 첫 작업 추가 transaction의 서버 시각 |

네 필드는 모두 null이거나 모두 값이 있어야 한다. snapshot 생성 뒤 직접 수정·삭제하지 않는다.

### 4.2 `SalesOrderFoldItem`

| 필드군 | 필드와 규칙 |
|---|---|
| 식별·소속 | `id`, `organizationId`, `salesOrderId`; 모든 참조는 같은 조직이어야 한다. |
| 순서 | `lineNumber`는 주문별 단조 증가·불변, `sortOrder`는 활성 작업 표시 순서다. |
| 출처 | `sourceFoldTemplateId`, `sourceFoldRevisionId`, `sourceTemplateCode`, `sourceTemplateName`, `sourceRevisionNumber`, `sourceDocumentChecksumSha256` |
| 주문 입력 | `name`, `quantity`, `materialRuleRevisionId`, `sheetItemId`; 문서 내부 snapshot과 일치해야 한다. |
| 문서 | `documentSchemaVersion`, `document` JSONB, `documentChecksumSha256`; 현재 서버 문서 스키마와 2MB 제한을 적용한다. |
| 동시성·수명주기 | `lockVersion`, `removedAt`, `removedByMembershipId`, `createdAt`, `updatedAt`, `createdByMembershipId`, `updatedByMembershipId` |

- `@@unique([salesOrderId, lineNumber])`와 조직·주문·활성 순서 조회 index를 둔다.
- 출처 revision은 감사 추적을 위해 `Restrict` 참조하되, 화면·계산의 권위 있는 데이터는 주문 문서다.
- 주문별 다음 line number는 주문 row를 transaction에서 잠그고 발급한다. 별도 counter 모델은 만들지 않는다.
- removed 행은 일반 API에서 숨기며 복구 API는 이번 범위에 두지 않는다.

### 4.3 스냅샷 생성과 수정 불변식

1. 주문·템플릿·개정·재질·원판의 조직과 활성/게시 상태를 서버에서 검사한다.
2. 저장된 개정을 checksum까지 읽어 현재 문서 스키마로 정규화한다.
3. 주문용 새 UUID와 주문 입력을 적용하고 문서 전체 checksum을 계산한다.
4. 첫 작업이면 같은 transaction에서 고객 표시정보를 캡처한다.
5. 작업 생성, 주문 lock 증가와 감사 기록을 한 transaction으로 commit한다.
6. 이후 원본 개정의 retire, 템플릿 비활성화, 고객 기준정보 수정은 주문 snapshot에 영향을 주지 않는다.

## 5. API 계약

```text
GET  /api/v1/orders/:orderId/fold-options?query=&categoryId=&cursor=
GET  /api/v1/orders/:orderId/fold-items?cursor=
POST /api/v1/orders/:orderId/fold-items
GET  /api/v1/orders/:orderId/fold-items/:itemId
PATCH /api/v1/orders/:orderId/fold-items/:itemId
POST /api/v1/orders/:orderId/fold-items/:itemId/copy
POST /api/v1/orders/:orderId/fold-items/:itemId/remove
POST /api/v1/orders/:orderId/fold-items/reorder
```

- 추가 요청은 `sourceFoldRevisionId`, `expectedOrderLockVersion`만 필수로 받으며 수량·변수·재질·원판 override는 선택이다.
- 수정은 허용된 주문 입력만 받는 strict schema를 사용하고 문서 전체 교체 요청은 거부한다.
- 모든 쓰기는 세션, organization, permission, Origin, 상태, optimistic lock, request ID와 typed audit를 적용한다.
- `409`는 주문/작업 최신 lock과 요약을, 문서 크기 초과는 `413`, 관계·입력 오류는 표준 `400` envelope를 반환한다.
- 목록 응답은 카드에 필요한 미리보기 요약을 포함하되 2MB 문서 전체는 상세 API에서만 반환한다.

## 6. 화면과 예외 흐름

1. 작성 중 주문 상세의 `절곡 작업 추가`를 누른다.
2. drawer에서 분류·코드·이름으로 게시 템플릿을 찾고 형상 미리보기와 개정 번호를 확인한다.
3. 추가하면 작업 번호, 수량, 변수, 재질/두께, 원판과 `계산 전` 상태가 나타난다.
4. 허용 입력은 debounce 자동 저장과 명시 저장을 지원한다.
5. 작업 복사·순서 변경·제거는 공통 확인 팝업과 충돌 복구를 사용한다.

- 게시 개정이 선택 직전에 retire되면 추가를 거부하고 목록을 새로 읽는다.
- 기존 작업의 원본이나 기준정보가 비활성화되어도 주문 snapshot으로 정상 표시하고 출처 상태만 경고한다.
- 고객 snapshot 후 헤더 고객 변경을 시도하면 어떤 필드가 잠겼는지 안내하고 새 수주 만들기를 제안한다.
- 390px에서는 카드형 목록과 전체 화면 drawer를 사용하고, 데스크톱에서는 목록·상세를 나란히 배치할 수 있다.
- 계산 결과와 금액은 A08에서 `계산 전`으로만 표시한다.

## 7. 구현 순서와 검증

| 단계 | 작업 | 완료 기준 |
|---|---|---|
| `A08-01` | `D2-A08-A~Q` 승인 | snapshot·헤더 잠금·편집 범위·API 확정 |
| `A08-02` | Prisma 모델·제약·migration | 빈 DB/upgrade DB, JSON 동시 null, 순번·조직 index 검증 |
| `A08-03` | 문서·고객 snapshot 도메인 | canonical checksum, 깊은 복사, 허용 override 단위 테스트 |
| `A08-04` | 서비스·권한·감사 | 조직 격리, 게시 상태, atomic 첫 snapshot, lock 통합 테스트 |
| `A08-05` | Route Handler·API client | strict 입력, pagination, 오류 envelope와 413 검증 |
| `A08-06` | 주문 상세 UI | 선택·추가·수정·복사·순서·제거와 반응형 E2E |
| `A08-07` | 불변성·회귀 검증 | 원본/기준정보 변경 후 기존 주문 checksum·표시·재접속 동일 |
| `A08-08` | 화면 테스트 가이드 | 실제 게시 템플릿과 고객으로 사용자 검수 |

2026-08-17 사용자의 화면 테스트 가능 시점까지 진행 요청을 `D2-A08-A~Q` 일괄 승인으로 기록했다. `A08-02~07` 구현과 자동 검증을 완료했으며 `A08-08`은 [P2-A08 화면 테스트 가이드](../P2-A08-screen-test-guide.md)에 따라 사용자가 최종 확인한다.

## 8. 완료 기준

- [x] 같은 조직의 게시 개정만 새 작업으로 추가할 수 있다.
- [x] 원본 개정·템플릿·재질·고객을 변경·중지해도 기존 주문 문서와 표시가 변하지 않는다.
- [x] 첫 작업과 고객 snapshot이 하나의 transaction으로 저장되고 이후 고객 참조 변경이 차단된다.
- [x] 수량·직접 변수·재질·원판만 수정되고 geometry·수식 구조·계산 설정은 변경되지 않는다.
- [x] 추가·수정·복사·순서 변경·제거가 권한·감사·낙관적 잠금과 함께 동작한다.
- [x] 취소 주문, 타 조직 UUID, stale lock, 변조된 JSON/material snapshot이 거부된다.
- [x] 단위·PostgreSQL 통합·API·Playwright·lint·typecheck·migration·build를 통과한다.
- [ ] 390px와 데스크톱 화면에서 사용자 검수를 완료한다.
- [x] 계산 결과·가격·VAT·승인 상태가 A08 모델에 섞이지 않았음을 검토한다.

## 9. 위험과 후속 경계

| 위험 | 대응 |
|---|---|
| 원본 revision을 매번 join해 과거 주문이 달라짐 | 주문 JSON과 표시정보를 깊은 복사하고 checksum 불변성 회귀 테스트를 둔다. |
| JSON과 조회용 열이 불일치 | 서버만 snapshot을 만들고 읽기·쓰기마다 핵심 중복 필드와 checksum을 검증한다. |
| 고객 기준정보와 주문 이력 혼재 | 최초 작업 시 고객 snapshot을 고정하고 이후 고객 참조 변경을 막는다. |
| 주문 화면에서 설계 편집기까지 확장 | A08은 주문 입력만 허용하고 형상 변경은 새 게시 개정과 새 작업으로 처리한다. |
| A09 계산 결과를 조기 저장 | A08에는 계산 결과·가격 열을 추가하지 않고 입력 계약만 확정한다. |
| 큰 주문의 응답·충돌 증가 | cursor pagination, 상세 문서 지연 로드, 주문·항목 이중 lock과 1,000개 상한을 적용한다. |

## 10. 승인 결과

2026-08-17 `D2-A08-A~Q` 권장안을 일괄 승인했다. 특히 다음 세 항목을 DB와 업무 흐름에 반영했다.

1. 첫 작업 추가 후 거래처·현장·고객 담당자를 영구 잠금한다.
2. 주문에서는 geometry를 편집하지 않고 게시 개정의 새 snapshot으로 교체한다.
3. 한 주문의 활성 절곡 작업 상한을 1,000개로 둔다.

## 11. 변경 기록

| 날짜 | 변경 내용 | 작성자 |
|---|---|---|
| 2026-08-15 | 레거시 기능·현행 FoldDocument·A07 헤더 계약을 대조해 최초 결정안 `A~Q` 작성 | Codex |
| 2026-08-17 | 권장안 승인, Prisma·DB 제약·snapshot 서비스/API·주문 상세 UI·감사·자동 검증 완료 및 사용자 화면 검수 대기 | 사용자·Codex |
