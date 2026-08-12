# P2-A06 가격 규칙 상세계획

> 상태: `COMPLETED` — 1차 화면 구현·자동 검증 및 사용자 화면 검수 완료
>
> 우선순위: `P2-A4`
>
> 담당자·검수자: 사용자 본인
>
> 계획 작성일: 2026-08-01
>
> 결정 승인일: 2026-08-01
>
> 화면 검수 완료일: 2026-08-12
>
> 선행 작업: `P2-A02 거래처`, `P2-A03 재질·두께`, `P2-A04 계산 규칙`, `P2-A05 원판 품목` 사용자 검수 완료
>
> MFC 참조 루트: `/Users/kyhoon/Library/Mobile Documents/com~apple~CloudDocs/회사/hicomtech/도면`
>
> 레거시 참조 DB: `hicomtech.biz:55021/krsteelfold2`, PostgreSQL `postgres` schema 읽기 전용 조사. 접속 비밀번호는 문서와 소스에 기록하지 않는다.

## 1. 목표

조직별 기본·가격등급·거래처 전용 가격표를 개정·검토·게시하고, 재질비·절곡비·V-CUT비·할증을 재현 가능한 Decimal 계산으로 산출하는 서버 가격 엔진과 관리 화면을 구현한다.

```text
가격등급 생성·거래처 배정
→ 기본/등급/거래처 가격표 초안 작성
→ 재질·두께별 단가와 할증 규칙 입력
→ 변경 비교·대표 금액 미리보기
→ 검토·게시
→ 거래처와 계산 시점으로 적용 가격 해석
→ 항목별 금액·가격 출처·개정 checksum 반환
→ P2-A09 수주 금액 snapshot의 입력으로 사용
```

MFC 화면과 실행 순서를 복제하지 않는다. MFC 가격식은 업무 의미를 확인하는 근거로만 사용하고, 현재 참조 DB의 빈 가격표·0 단가·버전 불일치와 MFC의 불합리한 일괄 할증을 웹의 승인된 계약으로 교정한다.

## 2. 현재 웹 기준선과 보완점

### 2.1 이미 구현된 기반

- 조직·사용자·역할·권한, PostgreSQL 세션, Origin 검증과 감사 이벤트가 구현돼 있다.
- `Customer`, `MaterialVariant`, `SheetItem`, 게시 `MaterialRuleRevision`과 조직 격리가 구현돼 있다.
- 절곡 문서는 재질·계산 규칙·원판 물리값을 불변 snapshot으로 보존한다.
- 일반·박스 전개 형상, 패널, 수량, 면적과 V/A/NO-CUT 정보가 서버 계산에 필요한 구조로 존재한다.
- BigInt 기반 canonical Decimal과 PostgreSQL `Decimal` 사용 패턴, 개정 검토·게시·예약·낙관적 잠금 패턴이 있다.
- 공통 팝업, 반응형 기준정보 화면, 로컬 전용 비식별 seed와 화면 검수 계정이 있다.

### 2.2 이번 작업의 보완점

1. 가격등급과 거래처 가격등급 배정 모델이 없다.
2. 기본·등급·거래처 전용 가격표와 유효기간 개정이 없다.
3. 재질비·절곡비·V-CUT비·할증의 단위, 적용 순서와 반올림 계약이 없다.
4. 가격이 없거나 여러 범위가 겹칠 때 차단하고 원인을 설명하는 해석기가 없다.
5. 일반·박스·패널 도면에서 가격 입력 지표를 뽑는 공통 계약이 없다.
6. 가격표 변경 비교, 누락 범위, 대표 계산 미리보기와 승인 화면이 없다.
7. 가격 전용 권한이 없어 자재 승인 권한과 영업 가격 권한을 분리할 수 없다.

## 3. MFC와 레거시 조사 결과

### 3.1 MFC 참조

| 파일 | 확인 내용 | 웹 판단 |
|---|---|---|
| `UnitPriceCustomerDlg.cpp/.h` | 거래처별 재질·두께의 ㎡/평 단가, 절곡비, V-CUT비 조회·수정과 금액/비율 일괄 조정 | 거래처 전용 가격표와 선택 행 일괄 조정은 유지하되 개정·감사·미리보기를 추가 |
| `CVCutPriceByGradeDlg.cpp/.h` | 등급별 재질·두께 가격을 `costgraderaw`에 저장하고 표준 가격으로 덮어쓰기 | 가격등급 개념은 유지하되 게시본 직접 덮어쓰기를 금지 |
| `CSheetPriceByGradeDlg.cpp/.h` | 등급별 원판 재료비·가공비 관리 | 절곡 가격과 원판 판매 가격의 목적을 분리하고, 잘못된 컬럼 별칭 가능성은 계승하지 않음 |
| `Work03Dlg.cpp` | `절곡수×절곡단가 + V-CUT길이×V-CUT단가 + 면적×㎡단가` 후 할증, 수량 곱셈 | 항목별 계산 근거는 사용하되 할증 범위·반올림·출처를 명시적으로 재설계 |
| `Work03Dlg.cpp` | 절곡 수가 최소 절곡 수 미만이면 자동 할증, 사용자가 전체/선택 할증 수정 | 자동 정책만 A06 가격표에 포함하고 수주별 수동 가격 조정은 A09에서 사유·권한과 함께 처리 |

MFC 최신 코드에는 `costgrade`, `costgraderaw`, `costgradesheet`, `v_costgradraw`가 등장하지만 현재 참조 DB에는 존재하지 않는다. `CSheetPriceByGradeDlg.cpp`의 표준 가격 덮어쓰기 SQL은 선택 컬럼과 갱신 컬럼 별칭이 일치하지 않아 오류 가능성이 있으므로 웹의 정답으로 사용하지 않는다.

### 3.2 레거시 DB 비식별 집계

2026-08-01 `postgres` schema를 transaction `READ ONLY`로 조사했다. 전체 데이터 이전이나 쓰기는 수행하지 않았다.

| 대상 | 결과 | 적용 판단 |
|---|---:|---|
| `costcust` | 0건 | 거래처별 원판 가격 golden master 없음 |
| `costcustraw` | 0건 | 거래처별 절곡 가격 golden master 없음 |
| `custgrade` | 8건, 4개 레거시 등급명 | 등급 존재 근거로만 사용하고 고객 식별 명칭은 계획 문서에 복제하지 않음 |
| `itemgradecost` | 863건, `item`과 863건 모두 연결 | 원판 등급 가격 staging 후보 |
| `itemgradecost` 유효값 | 재료비 후보 215건, 가공비 후보 262건 | 0은 미입력과 실제 0을 구분할 수 없어 자동 게시 금지 |
| `itemgradecost` 중 `장` 단위 | 455건 | 원판 판매 가격 후보이나 같은 품목의 기본 가격과 불일치가 많아 검토 필요 |
| `rawcate` | 30건 | 재질·두께 매핑 근거 |
| `rawcate` 가격 4종 | 절곡·V-CUT·㎡·평 단가 모두 0 | 활성 절곡 가격 기준으로 사용할 수 없음 |
| 최신 가격 table/view | 참조 DB에 없음 | MFC 코드와 DB의 버전 불일치를 명시하고 importer에서 탐지 |

`usegrade`의 3건은 관리자·입력자·조회자 권한 역할이며 가격등급이 아니다. 웹 `Role`이나 `PriceTier`로 중복 이전하지 않는다.

### 3.3 조사 결론

- 레거시 DB만으로 실제 운영 절곡 가격을 복원할 수 없다.
- `itemgradecost`는 P2-C importer의 검토 staging 자료로 보존하되 A06 게시 가격을 자동 생성하지 않는다.
- A06의 계산 golden master는 기존 `WEB-REFERENCE` 도면을 바탕으로 만든 비식별 가격 표본 20건과 사용자가 승인한 기대 금액으로 확정한다.
- 운영 전 실제 가격표는 사용자가 웹에서 작성·검토·게시하거나 승인된 importer 결과를 게시해야 한다.

## 4. 범위

### 포함

- 가격등급 등록·수정·비활성·기본 등급 지정과 거래처 배정
- 조직별 `기본`, `등급`, `거래처 전용` 가격표와 개정 이력
- 재질·두께별 ㎡ 재질단가, 절곡 1회 단가, V-CUT 1m 단가
- 원판 품목별 1장 재료 판매가·가공 판매가의 선택적 가격 행
- 최소 절곡수 조건과 가공 소계 할증률
- 초안→검토→게시→사용 종료, 즉시·미래 효력, 게시본 불변
- 가격표 복사, 선택 행 금액/비율 일괄 조정, 변경 전후 비교
- 적용 가격 해석, 누락 탐지, 가격 출처 trace와 계산 미리보기
- 일반·박스·패널의 가격 입력 지표 추출 계약
- 가격 전용 권한, 조직 경계, 낙관적 잠금, 감사, 공통 팝업
- 단위·PostgreSQL 통합·E2E와 화면 검수 가이드

### 제외

- 수주별 할인·수동 금액 조정·견적 유효기간·결제조건: `P2-A07~A09`
- 수주 합계 VAT·세금계산서·청구·수금: `P2-A09` 이후
- 실제 원판 소요 장수·재단 수율·재고 원가: `P2-B03~B06`
- 레거시 전체 가격 importer 실행·대조: `P2-C02`
- 운영 가격 확정과 운영 DB 배포: 운영 환경 결정 이후
- 입면도, SQLite, 실제 기계 통신과 다국어

## 5. 용어와 가격 단위

| 용어 | 정의 |
|---|---|
| 가격등급 `PriceTier` | 여러 거래처가 공유하는 가격 정책 묶음. 인증 역할과 무관하다. |
| 가격표 `PriceBook` | `기본/등급/거래처` 중 하나의 적용 범위를 소유하는 개정 컨테이너다. |
| 가격표 개정 | 특정 효력기간에 게시되는 불변 가격 행·할증 규칙 집합이다. |
| 절곡 가격 행 | 한 `MaterialVariant`의 ㎡ 재질단가·절곡 1회 단가·V-CUT 1m 단가 전체다. |
| 원판 가격 행 | 한 `SheetItem`의 1장 재료 판매가와 선택적 가공 판매가 전체다. |
| 적용 trace | 실제로 선택된 가격표·개정·범위·가격 행·checksum을 항목별로 남긴 결과다. |

- 통화는 1차 범위에서 `KRW` 고정이다.
- 면적 기준 단위는 `m²`, V-CUT 길이는 `m`, 치수 원본은 `mm`, 절곡은 물리 작업 횟수다.
- MFC의 `평` 단가는 저장하지 않는다. 필요 시 `1평 = 3.305785m²`로 조회 화면에서만 참고 환산하며 계산 입력으로 사용하지 않는다.
- 모든 가격 단가는 부가세 별도다.

## 6. 데이터 계약

### 6.1 `PriceTier`와 거래처 배정

| 필드 | 규칙 |
|---|---|
| `organizationId`, `code`, `name` | 조직 내 code 유일, 한글 이름과 설명 제공 |
| `isDefault` | 조직별 활성 기본 등급 한 건 |
| `active`, `lockVersion`, audit timestamps | 물리 삭제 없이 비활성·재활성, 낙관적 잠금 |
| `Customer.priceTierId` | nullable FK. 미지정 시 조직 기본 등급 사용 |

거래처 등급 변경은 앞으로 생성하는 가격 계산에만 영향을 준다. 이미 생성된 수주 금액은 A09의 가격 trace·입력·결과 snapshot으로 유지한다.

### 6.2 `PriceBook`

| 필드 | 규칙 |
|---|---|
| `scopeType` | `STANDARD`, `TIER`, `CUSTOMER` |
| `priceTierId`, `customerId` | scope에 해당하는 하나만 설정, STANDARD는 둘 다 null |
| `code`, `name`, `active` | 조직 내 code 유일, 비활성은 새 개정·새 계산에서 제외 |

- 조직별 활성 `STANDARD` 가격표는 한 건만 허용한다.
- 같은 등급 또는 거래처에는 활성 가격표 한 건만 허용한다.
- `CUSTOMER` 가격표는 거래처 전체를 복제하지 않고 예외 가격 행만 둘 수 있다.

### 6.3 `PriceBookRevision`

| 묶음 | 필드·규칙 |
|---|---|
| 개정 | `revisionNo`, `status`, `changeSummary`, `contentChecksumSha256` |
| 효력 | `effectiveFrom`, 서버 관리 `effectiveTo` |
| 통화·세금 | `currency=KRW`, `taxIncluded=false` 고정 |
| 상태·감사 | 작성·수정·상태변경·게시 사용자/시각, `lockVersion` |

상태는 `DRAFT → REVIEW → PUBLISHED → RETIRED`, 반려는 `REVIEW → DRAFT`, 초안 폐기를 지원한다. 같은 가격표의 진행 개정은 한 건, 미래 예약 게시본은 한 건만 허용하고 게시 유효기간 겹침을 DB·transaction으로 차단한다.

### 6.4 가격 행과 할증 규칙

`FoldPriceRate`는 `PriceBookRevision + MaterialVariant`별 한 행이며 다음 필드를 한 묶음으로 저장한다.

| 필드 | 의미 | 저장 기준 |
|---|---|---|
| `materialRatePerM2Krw` | 제품 전개 면적 1㎡ 재질 판매단가 | Decimal(20,4), 0 이상 |
| `bendRatePerOperationKrw` | 물리 절곡 작업 1회 단가 | Decimal(20,4), 0 이상 |
| `vCutRatePerMeterKrw` | 유효 V-CUT 선 1m 단가 | Decimal(20,4), 0 이상 |

가격 행은 세 값을 모두 필수로 저장한다. 상위 가격표의 일부 필드만 섞는 field-level fallback은 허용하지 않는다.

`SheetPriceRate`는 `PriceBookRevision + SheetItem`별 선택 행이다.

| 필드 | 의미 |
|---|---|
| `materialPricePerSheetKrw` | 원판 1장 재료 판매가, 0 이상 필수 |
| `processingPricePerSheetKrw` | 원판 1장 가공 판매가, nullable·0 이상 |

`SurchargePolicy`는 가격표 개정별 선택 항목이다.

| 필드 | 규칙 |
|---|---|
| `minimumBendOperations` | 0~999 정수. 제품 1개의 절곡 횟수가 이 값 미만일 때 적용 |
| `ratePercent` | Decimal(9,4), 0~100 |
| `baseType` | 1차는 `PROCESSING_ONLY` 고정 |

정책이 없으면 다음 우선순위 가격표의 할증 정책을 찾고, 끝까지 없으면 0%다.

## 7. 가격 적용 우선순위와 누락 처리

### 7.1 해석 순서

```text
1. 거래처 CUSTOMER 가격표의 해당 행
2. 거래처에 배정된 PriceTier 가격표의 해당 행
3. 조직 STANDARD 가격표의 해당 행
4. 없으면 PRICE_NOT_CONFIGURED로 계산 차단
```

- 각 scope에서 계산 시각에 유효한 `PUBLISHED` 개정만 사용한다.
- 절곡 가격 행, 원판 가격 행, 할증 정책은 각각 위 순서로 찾는다.
- 한 가격 행을 선택한 뒤 행 내부 세 단가를 다른 scope와 섞지 않는다.
- 거래처 전용 행을 삭제하는 대신 새 개정에서 제외하면 다음 scope로 fallback된다.
- 비활성 거래처·등급·가격표는 새 계산에 사용할 수 없다.
- 결과에는 scope, 가격표·개정 ID, 가격 행 ID, 효력시각과 checksum을 항목별 trace로 반환한다.

### 7.2 게시 전 완성도 검사

- STANDARD 게시 시 모든 활성 `MaterialVariant`의 절곡 가격 누락 목록을 보여주되, 사용하지 않는 재질이 있을 수 있으므로 게시 자체는 승인자의 명시 확인 후 허용한다.
- TIER/CUSTOMER는 일부 행만 게시할 수 있으며 fallback 예상 결과를 미리 보여준다.
- 활성 기본 등급과 STANDARD 가격표가 없으면 가격 계산을 차단하고 설정 화면으로 안내한다.
- 단가 0은 명시적인 무료 가격으로 인정하되 `0원 행` 경고와 게시 확인을 요구한다. 누락과 0을 혼동하지 않는다.

## 8. 가격 계산 계약

### 8.1 입력 지표

가격 엔진은 형상에서 다음 canonical 값을 추출하거나 같은 schema의 명시 입력을 받는다.

| 값 | 산출 기준 |
|---|---|
| `areaEachM2` | 일반은 전개폭×제품길이, 박스는 전개 패널 면적 합, 부착 패널은 제조 형상 면적을 중복 없이 합산 |
| `bendOperationsEach` | 실제 junction의 `operations.length` 합. 연신 계산 제외 여부와 가격 제외는 동일 의미가 아니므로 절곡은 계속 계상 |
| `vCutLengthEachM` | V-CUT 활성이고 유효 cut type이 `v-cut`인 고유 절곡선 길이 합. 일반은 제품 길이, 박스·패널은 실제 전개 절곡선 길이 사용 |
| `quantity` | 1 이상 정수 |

- A-CUT과 NO-CUT은 V-CUT 길이에 포함하지 않는다.
- compound bend의 절곡비는 작업 수만큼 계상하지만 같은 junction의 V-CUT 선은 한 번만 계상한다.
- 박스는 제품 길이 입력에 의존하지 않고 합의된 교차 직선 바닥 가로·세로와 전개 형상으로 면적·V-CUT 길이를 계산한다.
- 형상 지표를 만들 수 없거나 식 오류가 있으면 가격을 0으로 추정하지 않고 계산을 차단한다.

### 8.2 계산식

```text
재질비 원시값 = areaEachM2 × materialRatePerM2Krw × quantity
절곡비 원시값 = bendOperationsEach × bendRatePerOperationKrw × quantity
V-CUT비 원시값 = vCutLengthEachM × vCutRatePerMeterKrw × quantity

가공 소계 원시값 = 절곡비 원시값 + V-CUT비 원시값
할증 원시값 = 조건 충족 시 가공 소계 원시값 × ratePercent ÷ 100, 아니면 0

공급가액 = ROUND_HALF_UP(재질비) + ROUND_HALF_UP(절곡비)
         + ROUND_HALF_UP(V-CUT비) + ROUND_HALF_UP(할증)
```

- 계산 중간값은 최소 소수 6자리 canonical Decimal로 유지하고 JavaScript `number` 부동소수점에 의존하지 않는다.
- 각 line 항목을 수량 반영 후 원 단위 `ROUND_HALF_UP`하고, 표시 합계는 반올림된 항목의 합과 항상 일치시킨다.
- 단가·지표·중간값·반올림 전후·가격 trace·엔진 버전을 결과 DTO에 포함한다.
- 부가세는 가격표에 포함하지 않는다. A06은 공급가액까지만 확정하고, A09가 수주 line 공급가액 합계에 10% VAT를 원 단위 반올림해 저장한다.
- MFC처럼 재질비까지 할증하지 않고 절곡비+V-CUT비인 가공 소계에만 할증한다.

### 8.3 원판 가격 계산

```text
원판 재료 금액 = ROUND_HALF_UP(materialPricePerSheetKrw × sheetQuantity)
원판 가공 금액 = ROUND_HALF_UP((processingPricePerSheetKrw 또는 0) × sheetQuantity)
원판 공급가액 = 두 항목의 합
```

원판 가격은 독립 판매/견적용 계약이다. 절곡 제품 재질비를 원판 장수나 재단 수율로 환산하는 데 사용하지 않는다.

## 9. API·Application 계약

### 9.1 주요 endpoint

```text
GET/POST  /api/v1/pricing/tiers
GET/PATCH /api/v1/pricing/tiers/:tierId
POST      /api/v1/pricing/tiers/:tierId/transitions
POST      /api/v1/customers/:customerId/pricing-tier

GET/POST  /api/v1/pricing/books
GET        /api/v1/pricing/books/:bookId
POST       /api/v1/pricing/books/:bookId/revisions
GET/PATCH  /api/v1/pricing/books/:bookId/revisions/:revisionId
POST       /api/v1/pricing/books/:bookId/revisions/:revisionId/transitions
POST       /api/v1/pricing/books/:bookId/revisions/:revisionId/bulk-adjust
POST       /api/v1/pricing/books/:bookId/revisions/:revisionId/preview

POST       /api/v1/pricing/resolve
POST       /api/v1/pricing/calculate-fold
POST       /api/v1/pricing/calculate-sheet
```

- 변경 endpoint는 Origin, 권한, request ID, strict schema, 조직·상위 ID 일치, `expectedLockVersion`과 감사 기록을 적용한다.
- 상태 전이와 거래처 등급 배정은 DB transaction으로 처리한다.
- 같은 transition 재시도는 멱등 결과를 반환하고 다른 동시 변경은 `409 CONFLICT`다.
- 계산 endpoint는 서버에서 고객·재질·가격표를 다시 조회한다. 클라이언트가 보낸 단가를 신뢰하지 않는다.
- 미리보기는 DRAFT의 입력 가격으로 계산할 수 있으나 결과에 `preview=true`, `notForOrder=true`를 표시한다.

### 9.2 오류 계약

| 코드 | 조건 |
|---|---|
| `PRICE_NOT_CONFIGURED` | 우선순위 전체에 대상 가격 행이 없음 |
| `PRICE_REVISION_NOT_EFFECTIVE` | 요청 시점에 유효 게시본이 없음 |
| `PRICE_TIER_NOT_ASSIGNED` | 거래처 등급과 조직 기본 등급이 모두 없음 |
| `PRICE_SCOPE_CONFLICT` | 같은 scope 활성 가격표 또는 유효기간이 겹침 |
| `PRICE_INPUT_INVALID` | 면적·횟수·길이·수량 또는 Decimal 범위 오류 |
| `PRICE_REVISION_LOCKED` | DRAFT 외 계산 내용을 수정하려 함 |
| `CONFLICT` | stale lockVersion 또는 동시 상태 전이 |

사용자 오류는 필드 가까이 표시하고, 완료·확인·충돌·게시 영향·0원 경고는 공통 팝업으로 처리한다.

## 10. 화면·사용자 흐름

### 10.1 내비게이션과 화면

- 서비스 셸 `관리`에 `가격 관리` 메뉴를 `pricing.read` 권한으로 표시한다.
- 가격 관리 홈은 기본 등급, 활성 가격표, 게시/예약 상태, 단가 누락 수를 요약한다.
- `가격등급` 화면에서 등급 CRUD·기본 지정·거래처 수를 확인한다.
- 거래처 상세에서 현재 가격등급을 배정하고 거래처 전용 가격표로 이동한다.
- 가격표 상세에서 재질·두께별 절곡 가격과 원판 품목별 판매 가격을 탭으로 구분한다.
- 초안 편집 화면은 검색·필터·인라인 숫자 편집, 선택 행 금액/비율 일괄 조정, 변경 비교를 제공한다.
- 미리보기는 거래처·재질·면적·절곡수·V-CUT 길이·수량을 입력해 항목별 금액과 적용 출처를 확인한다.
- 게시 확인 팝업은 효력 시작, 이전 게시본 종료, 0원·누락, fallback 결과와 대표 표본 변화량을 보여준다.
- 390px~1,920px에서 데스크톱 표는 카드/가로 스크롤 최소화 구조로 전환하며 저장·전이 버튼은 접근 가능한 위치에 둔다.

### 10.2 정상 업무 흐름

1. 기본 가격등급과 STANDARD 가격표를 만든다.
2. 게시본을 복사해 가격 행과 할증을 입력한다.
3. 누락·0원·변경률과 대표 계산 결과를 확인한다.
4. 검토 요청 후 즉시 또는 미래 시각으로 게시한다.
5. 필요한 등급을 만들고 STANDARD를 복사하거나 예외 행만 작성한다.
6. 거래처에 등급을 배정하고 필요한 경우 거래처 전용 예외 가격표를 게시한다.
7. 계산 미리보기에서 실제 적용 scope·개정·항목별 금액을 확인한다.

## 11. 권한·감사

| 권한 | 기본 부여 역할 | 허용 작업 |
|---|---|---|
| `pricing.read` | 관리자·설계자·승인자 | 등급·가격표·게시본·출처·미리보기 조회 |
| `pricing.write` | 관리자·승인자 | 등급·배정·초안 작성·수정·폐기·검토 요청 |
| `pricing.approve` | 관리자·승인자 | 반려·게시·예약 취소·사용 종료 |

조회자 역할에는 가격 기준정보 권한을 기본 부여하지 않는다. 향후 수주 조회 화면의 확정 금액 열람은 `order.read` 정책으로 별도 처리한다. 초기에는 담당자와 검수자가 사용자 본인이므로 자기 검토·게시를 허용한다.

감사에는 등급 생성·수정·기본/활성 변경, 거래처 등급 배정, 가격표·개정 생성, 단건/일괄 수정, 검토·반려·게시·예약 취소·종료와 계산 실패를 남긴다. 가격 변경 감사 payload에는 전체 가격표 대신 대상 행 수, 변경 항목, 이전/새 checksum과 사유를 기록한다.

## 12. 로컬 seed와 레거시 이전 경계

- 로컬 화면 검수용으로 `기본` 등급, STANDARD 가격표와 AL 1T·2T·3T의 명시적 테스트 단가를 게시한다.
- 테스트 단가는 각각 `재질 20,000/30,000/40,000원·㎡`, `절곡 1,000/1,200/1,500원·회`, `V-CUT 500/600/800원·m`로 하며 최소 절곡수 3회, 가공 할증 10%를 사용한다.
- 위 값에는 `LOCAL TEST ONLY / 운영 사용 금지` 표시를 화면·seed 설명에 노출하고 운영 seed에는 포함하지 않는다.
- 비식별 화면 검수 등급 1개와 거래처 1개를 추가해 STANDARD→TIER→CUSTOMER 우선순위를 시험한다.
- `itemgradecost`는 legacy key, 원본 값, 매핑 상태와 오류 사유를 staging에 보존한다. 0값은 자동으로 무료 가격으로 게시하지 않는다.
- 레거시 개별 거래처 가격표가 0건이므로 빈 가격표를 생성하지 않는다.
- 실제 importer와 합계 대조는 P2-C02에서 실행한다.

## 13. 권장 결정안

| ID | 결정 | 권장안 |
|---|---|---|
| `D2-A06-A` | 작업 경계 | 가격등급·가격표 개정·가격 엔진·관리/미리보기 UI까지; 수주 할인·VAT snapshot·재단 원가는 제외 |
| `D2-A06-B` | 적용 범위 | `STANDARD/TIER/CUSTOMER` 세 scope와 거래처의 nullable 가격등급 배정 |
| `D2-A06-C` | 우선순위 | 거래처 전용 → 배정 등급 → 조직 기본, 대상 행이 없으면 다음 scope로 fallback |
| `D2-A06-D` | 혼합 금지 | 절곡 가격 행의 ㎡·절곡·V-CUT 세 필드는 한 scope의 한 행에서만 가져오고 field-level fallback 금지 |
| `D2-A06-E` | 가격표 개정 | DRAFT→REVIEW→PUBLISHED→RETIRED, 게시본 불변, 즉시·미래 효력과 중복 구간 차단 |
| `D2-A06-F` | 통화·단위 | KRW·㎡·m·절곡 작업 횟수 고정, 평 단가는 저장하지 않고 참고 환산만 제공 |
| `D2-A06-G` | 절곡 가격 항목 | 재질비=면적×㎡단가, 절곡비=작업수×단가, V-CUT비=유효 길이×m단가 |
| `D2-A06-H` | 원판 가격 항목 | SheetItem별 1장 재료 판매가와 nullable 가공 판매가를 별도 행으로 지원 |
| `D2-A06-I` | 절곡수 | junction의 물리 operation 수를 계상하며 연신 계산 제외와 가격 제외를 연결하지 않음 |
| `D2-A06-J` | V-CUT 길이 | V-CUT 활성+실제 v-cut junction만, compound junction은 선 1개; 일반·박스·패널 실제 전개선 길이 사용 |
| `D2-A06-K` | 박스 가격 지표 | 제품 길이 없이 교차 직선 바닥과 박스 전개 형상에서 면적·절곡수·V-CUT 길이 산출 |
| `D2-A06-L` | 할증 조건 | 제품 1개 절곡수가 최소값 미만일 때 적용, 정책 없으면 상위 fallback 후 0% |
| `D2-A06-M` | 할증 대상 | MFC 전체 금액 할증 대신 절곡비+V-CUT비 가공 소계에만 적용 |
| `D2-A06-N` | 반올림 | Decimal 중간값 유지, 수량 반영 항목별 원 단위 HALF_UP 후 반올림 항목 합계가 공급가액 |
| `D2-A06-O` | 부가세 | 모든 가격은 VAT 별도, A06 공급가액까지만 확정하고 A09에서 수주 합계의 10% 계산 |
| `D2-A06-P` | 가격 출처 | 계산 결과에 scope·가격표·개정·행·checksum·효력시각을 항목별 trace로 반환 |
| `D2-A06-Q` | 0과 누락 | 0은 명시 무료값, null/행 없음은 누락; 0원 게시 경고, 누락은 계산 차단 |
| `D2-A06-R` | 권한 | `pricing.read/write/approve` 신설, 설계자는 조회, 승인자는 작성·게시, 조회자는 기본 미부여 |
| `D2-A06-S` | 일괄 변경 | 선택 행의 선택 항목을 금액/비율로 조정하고 적용 전 diff·오류·0원 결과를 확인 |
| `D2-A06-T` | 레거시 | 코드/DB 버전 불일치와 0/빈 가격을 자동 게시하지 않고 `itemgradecost`만 staging 후보로 보존 |
| `D2-A06-U` | 검증 표본 | 기존 WEB-REFERENCE 기반 가격 20건을 사용자 승인 기대 금액으로 확정, 허용오차 1원 |
| `D2-A06-V` | 로컬 자료·화면 | 운영과 분리된 명시적 테스트 단가·등급·거래처 seed, 반응형 가격 관리와 공통 팝업 적용 |

## 14. 승인 후 상세 실행 단계

| 단계 | 세부 작업 | 완료 기준 |
|---|---|---|
| `A06-01` | 결정·계약 확정 | `D2-A06-A~V` 사용자 승인, 문서 상태 `APPROVED` |
| `A06-02` | 가격 지표 계약 | 일반·박스·패널의 면적·절곡수·V-CUT 길이 추출, canonical fixture 단위 테스트 |
| `A06-03` | 가격 엔진 | 우선순위 해석, 할증·반올림·trace·오류를 순수 도메인 함수로 구현 |
| `A06-04` | Prisma·migration | Tier/Book/Revision/Rate/Surcharge, Customer FK, enum·check·partial unique·index |
| `A06-05` | 권한·seed | pricing 3권한과 역할 매핑, 로컬 전용 테스트 가격·등급·거래처 보장 |
| `A06-06` | 등급·배정 서비스 | 조직 격리, 기본 단일성, 비활성, 거래처 배정, 잠금·감사 통합 테스트 |
| `A06-07` | 가격표 작성 서비스 | scope 단일성, 초안 복사, 단건/일괄 편집, checksum·coverage·diff |
| `A06-08` | 게시 transaction | 검토·반려·즉시/예약 게시·취소·종료, 기간 충돌·멱등성 검증 |
| `A06-09` | 해석·계산 API | 서버 단가 재조회, 게시/초안 preview, trace·표준 오류 envelope |
| `A06-10` | 가격등급·거래처 UI | 등급 관리, 거래처 배정, 권한별 조회/작성, 공통 팝업·반응형 |
| `A06-11` | 가격표 UI | 상태·이력, 검색형 단가 표, 원판 탭, 일괄 조정, 누락·0원·diff 표시 |
| `A06-12` | 계산 미리보기 UI | 거래처·재질·입력 지표, 항목별 금액·할증·출처 trace와 오류 안내 |
| `A06-13` | WEB-REFERENCE 20건 | 비식별 입력·기대 금액 문서화, 사용자 승인 전 provisional→승인 후 고정 |
| `A06-14` | 회귀·검수 준비 | 단위·통합·E2E·lint·typecheck·build·migration drift, 화면 테스트 가이드 |

각 단계에서 계산 계약이나 사용자 결과를 바꿀 추가 판단이 생기면 멈추고 사용자의 승인을 받는다. 구현 완료 뒤 자동 검증을 먼저 통과하고, 가격 관리와 대표 계산을 화면 테스트할 수 있는 시점에 사용자 검수 가이드를 제공한다.

## 15. 테스트 계획

| 종류 | 핵심 사례 | 완료 기준 |
|---|---|---|
| 단위 | Decimal 곱셈·HALF_UP, 0/누락, 우선순위, 할증 경계, 일반/박스/패널 지표 | 모든 경계·오류 code 통과 |
| 속성 기반 | 금액 음수 없음, 수량 증가 단조성, trace 결정성, 같은 입력·개정의 동일 checksum/결과 | 반복 생성 표본 통과 |
| PostgreSQL 통합 | 조직 격리, scope 단일성, 진행/예약 개정, 기간 충돌, 잠금, 거래처 등급, 감사 | reset·migration·seed와 transaction 통과 |
| API 통합 | 인증·Origin·권한, strict body, 상위 ID, stale version, 멱등 transition | 표준 status·오류 envelope 통과 |
| E2E | 등급→가격표→일괄 조정→검토→게시→거래처 배정→미리보기 | 관리자 전체 흐름과 조회 전용 차단 통과 |
| 반응형·접근성 | 390/768/1280/1920px, 키보드, 초점 복귀, 공통 팝업 | 가로 넘침·시스템 팝업 없음 |
| 가격 기준선 | WEB-REFERENCE 20건, STANDARD/TIER/CUSTOMER, 0/누락, 2/3회 할증 경계 | 승인 기대 공급가액과 ±1원 이내 |
| MFC 대조 | 식의 항목 의미와 대표 단순 표본 비교 | 유지 항목 일치, 변경 항목은 차이 사유 기록 |
| migration | 빈 DB 적용, 기존 로컬 DB upgrade, drift | Prisma validation·migration check 통과 |

## 16. 위험과 대응

| 위험 | 영향 | 대응 |
|---|---|---|
| 레거시 실제 절곡 단가가 모두 0 | MFC 금액을 golden master로 사용할 수 없음 | 운영 단가 자동 추정 금지, 사용자 승인 WEB-REFERENCE와 실제 가격표 게시로 대체 |
| MFC 코드와 DB schema 버전 불일치 | 잘못된 importer·필드 매핑 | schema 탐지·staging·오류 보고 후 명시 승인된 mapping만 적용 |
| partial fallback이 가격 출처를 숨김 | 거래처별 금액 설명 어려움 | 행 단위 fallback과 항목별 trace를 UI·snapshot에 노출 |
| 박스·패널 면적/절곡선 중복 | 가격 과대 계산 | 전개 형상 기반 고유 패널·절곡선 fixture와 시각 검수 |
| 반올림 순서 차이 | 합계 1원 이상 불일치 | 항목별 수량 반영 후 HALF_UP 순서를 버전 계약과 테스트에 고정 |
| 0원을 미입력으로 오인 | 무료/누락 가격 오류 | DB null/행 없음과 명시 0 분리, 게시 경고·계산 차단 분리 |
| 가격 권한 과다 노출 | 민감 정보 노출 | pricing 전용 권한, 서버 필터링, 감사와 조회자 기본 제외 |

## 17. 완료 기준

- `D2-A06-A~V`가 승인되고 계약 변경 이력이 문서에 남는다.
- 가격등급·거래처 배정·세 scope 가격표와 개정 상태가 PostgreSQL/Prisma로 동작한다.
- 일반·박스·패널 가격 지표와 재질·절곡·V-CUT·가공 할증 계산이 재현된다.
- 가격 누락은 차단되고 0원은 명시값으로 구분되며 적용 trace가 설명 가능하다.
- 게시본은 불변이고 즉시·예약·반려·취소·종료·동시성 경로가 검증된다.
- 권한·조직 격리·Origin·감사·공통 팝업·반응형 기준을 충족한다.
- WEB-REFERENCE 가격 20건이 사용자 승인 기대 금액과 1원 이내로 일치한다.
- 단위·통합·E2E·lint·typecheck·build·Prisma migration 검증이 통과한다.
- 화면 테스트 가이드에 따라 사용자가 검수 승인한다.
- A09가 가격 입력·결과·trace를 불변 수주 snapshot으로 저장할 수 있는 DTO가 확정된다.

## 18. 승인·검수 게이트

`D2-A06-A~V` 권장안은 2026-08-01 사용자에 의해 전체 승인됐다. 승인된 계약을 기준으로 가격 지표·엔진·PostgreSQL 모델·권한·seed·서비스/API·관리 화면과 자동 검증을 구현했고, [P2-A06 화면 테스트 가이드](../P2-A06-screen-test-guide.md)의 사용자 화면 검수는 2026-08-12 완료됐다.

## 19. 1차 구현 결과와 잔여 게이트

2026-08-01 기준 다음 범위를 구현했다.

- `pricing-metrics-v1`: 일반·박스·부착 패널 면적, 물리 절곡 작업 수와 유효 V-CUT 길이를 canonical Decimal로 추출한다.
- `pricing-engine-v1`: 재질·절곡·V-CUT·가공 할증을 수량 반영 후 원 단위 HALF_UP하고 항목 합계가 공급가액과 일치한다.
- `PriceTier`, `PriceBook`, `PriceBookRevision`, `FoldPriceRate`, `SheetPriceRate`, `SurchargePolicy`와 거래처 등급 FK를 Prisma/PostgreSQL migration으로 추가했다.
- 활성 기본·등급·거래처 가격표 단일성, 진행 개정 단일성, 금액 범위와 조직 FK를 DB constraint로 보호한다.
- `pricing.read/write/approve`, 감사 이벤트, 낙관적 잠금, Origin 검증과 표준 오류 envelope를 적용했다.
- 로컬 전용 기본·우대 등급, 화면 검수 거래처, STANDARD/TIER/CUSTOMER 게시 가격표와 `LOCAL TEST ONLY` 단가를 seed한다.
- 가격 관리 홈, 거래처 등급 배정, 가격표 생성, 개정 복사·편집·일괄 조정·검토·반려·게시·종료·폐기, 원판 단가 편집과 게시 가격 미리보기를 제공한다.
- 완료·확인·오류·상태 전이는 공통 팝업으로 표시하며 브라우저 시스템 `alert/confirm/prompt`를 사용하지 않는다.
- 수동 브라우저 검증에서 로컬 관리자 로그인, 22,230원 고객 전용 가격 계산, 개정 생성·폐기와 390px 무가로넘침을 확인했다.
- 단위 테스트 316건, PostgreSQL 통합 테스트 52건, 전체 E2E 25건, lint·typecheck·build·Prisma validation·migration drift 검증을 통과했다.

사용자 검수가 완료된 `A06-01~A06-12`, `A06-14`의 핵심 화면 흐름을 P2-A06 완료 기준으로 삼는다. 다음 항목은 수주 구현과 병행하는 후속 품질 보강으로 관리한다.

1. `A06-13`의 WEB-REFERENCE 가격 20건 기대 금액을 고정 회귀 자료로 추가한다.
2. 화면에 노출하지 않은 서버 전용 bulk/resolve/calculate-sheet 및 DRAFT preview 계약, 게시 전 coverage·diff 상세를 구현하고 API 회귀를 보강한다.

위 보강 항목은 가격 관리 화면의 검수 완료 상태를 되돌리지 않으며, 수주 가격 snapshot을 구현하는 `P2-A09` 이전에 완료한다.
