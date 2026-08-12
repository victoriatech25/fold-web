# P2-A05 원판 품목 상세계획

> 상태: `COMPLETED` — 구현·자동 검증·사용자 화면 검수 완료
>
> 우선순위: `P2-A3`
>
> 담당자·검수자: 사용자 본인
>
> 계획 작성일: 2026-08-01
>
> 결정 승인일: 2026-08-01
>
> 사용자 화면 검수 승인일: 2026-08-01
>
> 선행 작업: `P2-A03 재질·두께`, `P2-A04 연신·컷 계산 규칙` 사용자 화면 검수 완료
>
> MFC 참조 루트: `/Users/kyhoon/Library/Mobile Documents/com~apple~CloudDocs/회사/hicomtech/도면`
>
> 레거시 참조 DB: `hicomtech.biz:55021/krsteelfold2`, PostgreSQL 읽기 전용 조사. 접속 비밀번호는 문서와 소스에 기록하지 않는다.

## 1. 목표

재질·두께별 원판 품목의 물리 규격, 표면·방향성, 유효 가공 영역, 이론 중량, 재고 단위와 잔재 판정 기본값을 PostgreSQL 기준정보로 관리한다. 도면 설계는 활성 원판을 선택해 불변 물리 snapshot을 저장하고, 원판 기준 면적·중량과 제품 면적 환산을 확인할 수 있게 한다.

```text
재질·두께
→ 원판 품목 등록
→ 물리 규격·표면·결 방향·trim 설정
→ 면적·중량 미리보기
→ 기본 원판 지정
→ 도면 설계에서 원판 선택
→ 도면 문서에 물리 기준 snapshot 저장
→ 이후 가격·수주·재단·재고에서 같은 품목 ID 사용
```

MFC의 문자열 규격과 화면 구성을 복제하지 않는다. 웹에서는 mm·m²·kg 단위를 명시하고, 물리 규격·판매 가격·실재고·잔재 인스턴스를 서로 다른 책임으로 분리한다.

## 2. 현재 웹 기준선

### 이미 구현된 기반

- `Material → MaterialVariant → MaterialRuleRevision` 관계와 조직 격리가 구현돼 있다.
- 재질 밀도는 `Material.densityKgPerM3`, 두께는 `MaterialVariant.thicknessMm` Decimal로 관리한다.
- 도면은 서버 발행 재질·계산 규칙을 불변 snapshot으로 저장한다.
- `material.read/write/approve`, 감사 이벤트, 낙관적 잠금, 공통 팝업과 반응형 기준정보 화면 패턴이 있다.
- 면적·치수는 명시 단위를 사용하고 중량 허용오차 기준은 `0.001 kg`이다.

### 이번 작업의 보완점

1. 원판의 가로·세로와 품목 식별자, 표면·방향성, 기본 품목을 저장할 모델이 없다.
2. 밀도·두께·규격으로 원판 면적과 이론 중량을 계산하는 서버 기준 함수가 없다.
3. edge trim과 재사용 잔재의 최소 기준을 표현할 계약이 없다.
4. 도면 문서가 선택 원판의 물리 snapshot을 보존하지 않는다.
5. 원판 판매가·매입원가·가공비, 재고 수량, 재단 결과가 MFC에서는 혼합돼 있어 웹 책임 경계를 확정해야 한다.

## 3. MFC와 레거시 조사 결과

### 3.1 MFC 참조

| 파일 | 확인 내용 | 웹 판단 |
|---|---|---|
| `ItemDlg2.h/.cpp` | 원판을 재질·두께·`sizee/sizeexp`, 헤어라인, 판매가·가공비로 한 그리드에서 관리 | 규격을 숫자형으로 분리하고 가격은 A06으로 분리 |
| `DBApi.cpp` | `item` 문자열 필드와 수주 참조 여부를 직접 조회·삭제 | UUID 참조, 비활성화, snapshot으로 대체 |
| `HCuttingDlg.cpp` | `sizee`를 `*`로 나눠 재단 원판 크기로 사용 | 폭·길이를 별도 Decimal 필드로 저장 |
| `CuttingDlg.cpp`, `CuttingOrgDlg.cpp` | 방향성·원판 수·손실·수율·잔재 계산이 재단 실행과 결합 | A05는 기준정보만, solver·실사용·잔재 인스턴스는 P2-B로 분리 |
| `ItemcateEntry2Dlg.cpp`, `_define.h` | kg/m²·밀도·원가·연신·컷 값이 같은 원자재 행에 혼합 | 밀도는 Material, 계산값은 A04, 원판은 A05, 판매 가격은 A06 |

MFC 최신 코드가 기대하는 `item.sizeexp`는 현재 참조 DB에 없고, 참조 DB에는 사용처가 불명확한 `sizeraw`가 있다. 둘 중 어느 것도 웹 핵심 규격 필드로 자동 승격하지 않는다.

### 3.2 레거시 DB 비식별 집계

2026-08-01 `postgres` schema를 transaction `READ ONLY`로 조사했다. 서버는 PostgreSQL 9.2.24이며 전체 이전은 실행하지 않았다.

| 항목 | 결과 | 적용 판단 |
|---|---:|---|
| `item`의 `SHEET` 행 | 59건 | A05 importer의 원판 후보 |
| 재질·두께 조합 | 9개 재질, 23조합 | 현재 MaterialVariant와 매핑 후 이전 |
| 물리 조합 | 55조합 | 코드가 다른 동일 규격은 표면·품목 의미를 검토 |
| 파싱 가능한 `가로*세로` | 56건 | 숫자형 mm로 변환 가능 |
| 오류·미입력 규격 | 3건 | 자동 보정하지 않고 이전 오류 보고 |
| 방향성 `hline=Y` | 14건 | 방향 유지 정책 후보 |
| 다른 레거시 테이블에서 참조 | 59건 중 58건 | 물리 삭제 금지 근거 |
| `rawcate`와 재질·두께 일치 | 59건 중 52건 | 7건은 사용자 매핑 검토 필요 |
| 원판 판매가/가공비 존재 | 40건/52건 | A05 물리 모델에 섞지 않고 A06 가격 staging으로 전달 |
| 매입가/원가 필드 사용 | `costbuy`, `perkg` 모두 0건 | 레거시 0을 웹 매입원가로 간주하지 않음 |
| 재고 단위 표본 | `장` | A05 기본 재고 단위 `SHEET` |

`1220*2440`, `1000*3000`, `1000*4000` 등이 주 규격이다. `1220-2440`, `111111`, 빈 값은 자동 변환하지 않는다. `sizeraw`의 `304*912`, `1216*1216` 등은 물리 trim과 의미가 같다고 단정할 수 없어 원본 payload에만 보존한다.

## 4. 범위

### 포함

- 재질·두께별 원판 품목 목록·검색·등록·수정·비활성·재활성
- 품목 코드·이름, 폭·길이, 표면 마감, 방향 유지 정책
- 네 방향 edge trim과 유효 폭·길이·유효 면적
- 원판 면적, 밀도·두께 기반 이론 중량, 선택적 실측/공급사 중량
- 기준 재고 단위 `SHEET`, 기본 원판 단일성
- 참고 표준 매입원가와 잔재 재사용 최소 기준
- 조직 경계, 권한, 낙관적 잠금, 감사, 중복 경고
- 도면 선택 API·문서 물리 snapshot·제품 면적 환산 표시
- 단위·PostgreSQL 통합·E2E·반응형 화면 검수

### 제외

- 고객·등급별 판매가, 절곡비, V-CUT비와 할증: `P2-A06`
- 실제 창고 재고 수불·실사·예약·가용 수량: `P2-B06`
- 재단 배치, 필요한 실제 원판 수, 회전·칼날·수율 계산: `P2-B03~B05`
- 잔재 실물 개체 생성·위치·사용 이력: `P2-B06`
- 수주 금액·중량 불변 결과 snapshot: `P2-A09`
- 레거시 전체 importer 실행: `P2-C02`
- 입면도와 실제 기계 통신

## 5. 데이터 계약

### 5.1 `SheetItem`

| 묶음 | 필드 | 규칙 |
|---|---|---|
| 식별 | `organizationId`, `materialVariantId`, `code`, `name` | 조직 내 코드 유일, variant는 생성 후 변경 불가 |
| 물리 규격 | `widthMm`, `lengthMm` | 0보다 큰 Decimal(18,6), 생성 후 변경 불가 |
| 표면 | `finishName`, `normalizedFinishName` | 자유 입력 마감명, 공백·대소문자 정규화 |
| 방향 | `rotationPolicy`, `grainAxis` | `FREE/NONE` 또는 `KEEP_GRAIN/WIDTH|LENGTH` 조합 |
| trim | `trimTopMm`, `trimRightMm`, `trimBottomMm`, `trimLeftMm` | 각각 0 이상, 합계가 해당 폭·길이보다 작아야 함 |
| 중량 | `weightOverrideKg`, `weightOverrideReason` | 선택 입력; override가 있으면 사유 필수 |
| 원가 | `standardPurchaseCostKrw` | 선택적 내부 참고 매입원가, 고객 판매가 계산에는 직접 사용하지 않음 |
| 잔재 기본값 | `minRemnantWidthMm`, `minRemnantLengthMm`, `minRemnantAreaM2` | 선택 입력; B06에서 잔재 판정 기본값으로 사용 |
| 운영 | `inventoryUnit`, `isDefault`, `active`, `sortOrder`, `memo` | 1차 단위는 `SHEET`; variant별 활성 기본 품목 최대 한 건 |
| 동시성 | `lockVersion`, `createdAt`, `updatedAt`, `deletedAt` | 물리 삭제 없이 활성 상태와 감사로 관리 |

같은 규격이라도 평판·체크판처럼 마감이 다를 수 있고 향후 공급사 품목이 추가될 수 있으므로 물리 조합의 중복은 경고하되 DB unique로 차단하지 않는다. 코드만 조직 내 강제 유일하다.

### 5.2 파생 계산

파생값은 저장값과 분리해 서버 Decimal 함수로 계산하고 DTO와 snapshot에 canonical 문자열로 제공한다.

```text
nominalAreaM2 = widthMm × lengthMm ÷ 1,000,000
usableWidthMm = widthMm - trimLeftMm - trimRightMm
usableLengthMm = lengthMm - trimTopMm - trimBottomMm
usableAreaM2 = usableWidthMm × usableLengthMm ÷ 1,000,000
calculatedWeightKg = nominalAreaM2 × thicknessMm ÷ 1,000 × densityKgPerM3
effectiveWeightKg = weightOverrideKg ?? calculatedWeightKg
productAreaRatio = productTotalAreaM2 ÷ usableAreaM2
```

- 면적은 m² 소수 6자리, 중량은 kg 소수 3자리 표시를 기본으로 하되 canonical 계산값은 6자리까지 보존한다.
- 밀도가 없고 override도 없으면 중량을 0으로 만들지 않고 `중량 계산 필요`로 반환한다.
- `productAreaRatio`는 면적 환산 참고값이다. 올림한 값을 실제 필요 원판 수나 재단 결과로 표현하지 않는다.
- trim은 물리 유효 영역이며 레거시 `sizeraw`를 자동 변환한 값이 아니다.

## 6. 변경·기본값·비활성 정책

- 품목 코드, variant, 폭·길이는 생성 후 불변이다. 오류 수정은 새 품목 생성 후 기존 품목 비활성으로 처리한다.
- 이름·마감·방향·trim·중량 override·참고 매입원가·잔재 기준·정렬·메모는 낙관적 잠금으로 수정한다.
- 물리 설정 변경 후 기존 도면은 저장된 snapshot을 유지하고 새 선택만 최신 값을 사용한다.
- variant별 활성 기본 원판은 최대 한 건이다. 기본 원판을 바꾸는 transaction에서 이전 기본값을 해제한다.
- 기본 품목을 비활성화하면 기본값을 함께 해제하고, 새 설계는 명시적으로 다른 품목을 선택해야 한다.
- 비활성 품목은 기존 snapshot 재열기에는 허용하지만 새 도면 선택 목록에서는 제외한다.
- 직접 삭제 API는 제공하지 않는다. 참조 여부와 관계없이 비활성·재활성으로 관리한다.

## 7. 가격·재고·잔재 책임 경계

### A05가 보유하는 값

- 물리 규격과 가공 가능 영역
- 실측/공급사 명목 중량 override
- `SHEET(장)` 기준 단위
- 내부 참고용 표준 매입원가 1개
- 향후 잔재 판정을 위한 최소 폭·길이·면적 기본값

### 후속 작업이 보유하는 값

- A06: 고객·등급·유효기간별 판매 가격과 가공비·할증
- B03~B05: kerf, 회전, 실제 배치, 필요 원판 수와 수율
- B06: 사업장·창고·lot별 수불, 가용 수량, 잔재 개체와 사용 이력
- A09: 수주 시점의 실제 중량·원가·판매가 계산 결과 snapshot

참고 매입원가 변경은 감사되지만 A06 판매 가격을 자동 변경하지 않는다. 가격 규칙이 해당 값을 사용하려면 A06에서 명시적 source와 승인된 개정을 정의한다.

## 8. 도면 설계 적용

- `/api/v1/fold-material-options`에 variant별 활성 원판 목록과 기본 원판을 포함한다.
- 재질·두께를 선택하면 활성 기본 원판을 제안하되 사용자가 다른 원판 또는 `원판 미지정`을 선택할 수 있다.
- 도면 문서에 선택적 `sheetItemSnapshot`을 추가하고 schema migration을 제공한다.
- snapshot에는 ID·코드·이름·폭·길이·마감·방향·trim·명목/유효 면적·유효 중량과 계산 근거를 저장한다.
- 참고 매입원가와 재고 수량은 도면 물리 snapshot에 넣지 않는다.
- 원판을 바꾸면 새 snapshot을 만들지만 선 형상과 계산 규칙은 자동 변경하지 않는다.
- 계산 요약에는 원판 명목/유효 면적, 유효 중량과 제품 총면적 대비 면적 환산만 표시한다.

## 9. 권한·감사·API

### 권한

| 권한 | 허용 작업 |
|---|---|
| `material.read` | 원판 목록·상세·파생 계산 조회 |
| `material.write` | 등록·수정·비활성·재활성·기본 지정 |
| `material.approve` | A05에서는 별도 상태 전이에 사용하지 않음; A06 가격 승인에서 사용 |

감사 action은 `material.sheet_created`, `material.sheet_updated`, `material.sheet_default_set`, `material.sheet_deactivated`, `material.sheet_reactivated`를 추가한다. 변경 전후 물리·운영 값을 기록하되 민감한 연결 정보는 남기지 않는다.

### Route Handler

```text
GET  /api/v1/materials/:materialId/variants/:variantId/sheet-items
POST /api/v1/materials/:materialId/variants/:variantId/sheet-items
POST /api/v1/materials/:materialId/variants/:variantId/sheet-items/preview
GET  /api/v1/materials/:materialId/variants/:variantId/sheet-items/:sheetItemId
PATCH /api/v1/materials/:materialId/variants/:variantId/sheet-items/:sheetItemId
POST /api/v1/materials/:materialId/variants/:variantId/sheet-items/:sheetItemId/transitions
```

`transitions` action은 `set_default/deactivate/reactivate`이며 `expectedLockVersion`을 검증한다. 모든 변경은 인증, Origin, 조직·상위 material/variant 일치, 권한, request ID, 표준 오류 envelope와 감사 기록을 적용한다.

## 10. 화면 구성

- 재질 상세의 각 두께 행에 `계산 기준` 옆 `원판 품목` 진입 링크를 제공한다.
- 원판 화면 상단에는 활성 수, 기본 원판, 중량 계산 필요 수를 요약한다.
- 카드/표에는 코드·이름, `폭 × 길이`, 마감·방향, 명목/유효 면적, 유효 중량, 기본·활성 상태를 표시한다.
- 등록 대화상자는 물리 규격 → 마감·방향 → trim → 중량·원가·잔재 기준 순서로 구성한다.
- 입력 중 서버 미리보기로 명목/유효 면적과 계산/override 중량을 보여준다.
- 물리 규격은 생성 후 읽기 전용이고 오류 수정 안내와 `새 품목으로 복사`를 제공한다.
- 비활성·기본 변경·완료·오류는 공통 팝업을 사용한다.
- 모바일은 카드 1열, 입력 그룹 1열과 고정 하단 작업 버튼으로 전환한다.

## 11. 권장 결정안

| ID | 결정 | 권장안 |
|---|---|---|
| `D2-A05-A` | 작업 경계 | 물리 원판 기준정보·계산·설계 snapshot까지; 판매 가격·실재고·재단·잔재 인스턴스 제외 |
| `D2-A05-B` | aggregate | `MaterialVariant 1:N SheetItem`, 별도 개정 테이블 없이 불변 물리 식별과 snapshot 사용 |
| `D2-A05-C` | 식별·중복 | 조직 내 코드만 유일, 같은 규격은 마감·공급 의미가 다를 수 있어 경고만 제공 |
| `D2-A05-D` | 규격 | 폭·길이를 mm Decimal 양수로 저장하고 문자열 규격을 핵심 데이터로 사용하지 않음 |
| `D2-A05-E` | 변경 | 코드·variant·폭·길이는 생성 후 불변, 오류는 복사 생성 후 이전 품목 비활성 |
| `D2-A05-F` | 표면·방향 | 자유 마감명과 `FREE` 또는 결 축을 유지하는 방향 정책 저장 |
| `D2-A05-G` | trim | 상·우·하·좌 trim을 별도 저장하고 유효 폭·길이·면적을 서버 계산 |
| `D2-A05-H` | 잔재 기준 | 최소 폭·길이·면적은 nullable 기본값만 A05에 저장, 실제 잔재 수명주기는 B06 |
| `D2-A05-I` | 재고 단위 | 1차 기준 단위는 `SHEET(장)` 고정, 창고 수량·lot·예약은 B06 |
| `D2-A05-J` | 중량 | 면적×두께×밀도를 Decimal 계산하고 선택 override+필수 사유, 둘 다 화면에 표시 |
| `D2-A05-K` | 원가·가격 | 참고 표준 매입원가만 선택 저장; 판매가·가공비·등급 가격은 A06, 레거시 0은 미입력 |
| `D2-A05-L` | 기본·비활성 | variant별 활성 기본 한 건, 비활성 시 기본 해제, 삭제 없이 재활성 허용 |
| `D2-A05-M` | 설계 적용 | 활성 원판 선택과 기본 제안, 물리 snapshot 저장, 기존 문서 불변 |
| `D2-A05-N` | 계산 표시 | 원판 면적·중량·제품 면적 환산만 표시하고 실제 필요 장수·수율로 표현하지 않음 |
| `D2-A05-O` | 권한·감사 | 기존 material read/write 재사용, 모든 변경 감사·잠금·조직 경계 적용 |
| `D2-A05-P` | 레거시 | `item.sizee` 정상 56건만 자동 파싱 후보, 3건 오류 격리, `sizeraw/sizeexp` 자동 승격 금지 |
| `D2-A05-Q` | 초기 자료 | AL 1T·2T·3T에 비식별 1220×2440 기본 원판 seed를 두어 로컬 화면 검수 가능하게 함 |
| `D2-A05-R` | 화면 | 두께 상세 진입, 목록·편집·미리보기·기본/활성 상태와 설계 선택을 반응형 서비스 UI로 제공 |

## 12. 승인 후 구현 순서

| 단계 | 세부 작업 | 완료 기준 |
|---|---|---|
| `A05-01` | 결정·계약 확정 | `D2-A05-A~R` 승인과 문서 상태 변경 |
| `A05-02` | Prisma·migration | SheetItem, enum, check·partial unique·FK·index가 빈/기존 PostgreSQL에 적용 |
| `A05-03` | Decimal 계산 정책 | 면적·trim·중량·override·잔재 입력 단위 테스트 |
| `A05-04` | 조회·변경 서비스 | 조직 격리, 코드 중복, 잠금, 불변 필드, 활성·기본 transaction 통합 테스트 |
| `A05-05` | Route Handler | 인증·Origin·권한·상위 경로 일치·오류 envelope·감사 검증 |
| `A05-06` | 원판 관리 화면 | 목록·등록·복사·수정·비활성·기본 지정, 공통 팝업·반응형 UI |
| `A05-07` | 문서 계약 보강 | 선택적 sheet snapshot, 기존 문서 migration·checksum·DB 왕복 |
| `A05-08` | 설계 적용 | material options·원판 선택·기본 제안·읽기 전용 물리 정보 |
| `A05-09` | 계산 요약 | 원판 명목/유효 면적·중량·제품 면적 환산 표시 |
| `A05-10` | seed·레거시 매핑 | 비식별 AL 기본 원판, importer 필드·오류 사유 계약 기록 |
| `A05-11` | 회귀·화면 검수 준비 | 단위·통합·E2E·lint·typecheck·build·migration drift와 검수 가이드 |

## 13. 테스트 기준

- 조직 밖 material/variant/sheet item을 조회·변경할 수 없다.
- 폭·길이·trim·중량·원가의 0/음수/상한과 Decimal 자릿수를 검증한다.
- trim 합이 물리 규격 이상이면 저장하지 않는다.
- 밀도 없음, 계산 중량 있음, override 있음의 세 상태를 구분한다.
- 같은 코드 생성과 stale 수정은 `409`, 잘못된 수치는 `400`이다.
- 물리 불변 필드 PATCH는 권한과 관계없이 차단한다.
- 기본 품목 동시 지정은 DB transaction과 partial unique로 한 건만 남는다.
- 비활성 기본 품목은 새 선택에서 사라지고 기존 문서는 snapshot으로 재열린다.
- 선택 원판 변경 전후 도면 선·연신 계산값은 바뀌지 않는다.
- 제품 면적 환산은 표시하되 실제 원판 장수로 오인할 표현이 없다.
- 판매가·가공비·재고 수량 입력이 A05 화면에 섞이지 않는다.
- 모든 알림·확인은 공통 팝업이며 390px~1,920px에서 가로 넘침이 없다.
- 전체 P1, P2-A01~A04 자동 회귀가 계속 통과한다.

## 14. 사용자 승인 게이트

`D2-A05-A~R`은 2026-08-01 사용자에 의해 전체 승인됐다. `A05-01~A05-11` 구현과 자동 검증을 완료했고, 같은 날 [P2-A05 화면 테스트 가이드](../P2-A05-screen-test-guide.md)의 사용자 검수를 승인받아 작업을 완료 처리했다.

## 15. 구현 결과

- `SheetItem` Prisma 모델, enum, check constraint, variant별 활성 기본 원판 partial unique index와 migration을 적용했다.
- 원판 규격·trim·면적·밀도/두께 중량·override를 BigInt 기반 canonical Decimal로 계산한다.
- 원판 등록·복사·수정·기본 지정·비활성·재활성 API와 반응형 관리 화면을 구현했다.
- 코드·폭·길이 불변, 조직 격리, 낙관적 잠금, Origin·권한, 감사 이벤트를 적용했다.
- 절곡 서버 문서를 v3로 올리고 선택 원판의 물리 snapshot을 저장하며 v1·v2 문서를 자동 migration한다.
- 설계 화면에서 재질별 활성 원판과 기본값을 선택하고 유효 면적·중량·제품 면적 환산을 표시한다. 실제 필요 장수로 표현하지 않는다.
- AL 1T·2T·3T의 1220×2440 비식별 기본 원판을 로컬 seed에 포함했다.
- 단위 309건, PostgreSQL 통합 49건, Chromium E2E 24건과 lint·typecheck·build·migration drift 검증을 통과했다.
- 사용자가 `A05-T01~T13` 화면 검수를 완료하고 2026-08-01 승인했다.
