# P2-A04 연신·컷 계산 규칙 상세계획

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
> 선행 작업: `P2-A03 재질·두께` 사용자 화면 검수 완료, `P1-09~P1-10` 계산 기준선 완료
>
> MFC 참조 루트: `/Users/kyhoon/Library/Mobile Documents/com~apple~CloudDocs/회사/hicomtech/도면`
>
> 레거시 참조 DB: `hicomtech.biz:55021/krsteelfold2`, PostgreSQL 읽기 전용 조사. 접속 비밀번호는 문서와 소스에 기록하지 않는다.

## 1. 목표

재질별 두께에 적용하는 연신값·컷 깊이·제한각·계산 방식을 초안부터 검토·게시까지 관리하고, 도면 설계가 게시 시점의 계산 규칙 개정을 불변 snapshot으로 사용하게 한다.

```text
재질·두께 선택
→ 계산 규칙 초안 작성 또는 게시본 복사
→ 계산 영향 미리보기
→ 검토 요청
→ 게시 또는 수정 반려
→ 도면 설계에서 유효 게시 개정 선택
→ 도면 문서에 규칙 ID와 계산값 불변 복사
```

MFC UI와 실행 순서를 복제하거나 MFC 수치를 무조건 정답으로 취급하지 않는다. 승인된 웹 계산 기준, 현재 웹 엔진, 레거시 표본과 이후 실제 제작 검증을 근거로 독립 재구현한다.

## 2. 현재 웹 기준선과 보완점

### 2.1 이미 구현된 기반

- Prisma `MaterialRuleRevision`에 FIX/RATIO, V-CUT, 소수 정책, 제한각, 내부 반경, V/A/NO-CUT 연신·컷 깊이, 상태와 유효기간이 있다.
- 도면 선택 API는 현재 시각에 유효한 `PUBLISHED` 개정만 반환한다.
- 도면 저장 시 규칙 ID와 계산값을 JSONB 문서에 복사하므로 게시본이 바뀌어도 기존 도면 계산은 변하지 않는다.
- `material.read`, `material.write`, `material.approve` 권한이 역할 체계에 이미 존재한다.
- P1 계산 엔진은 FIX 소수 보존, 절곡 양쪽 계산 제외, RATIO의 `angle < cutAngle` 경계를 적용한다.
- 도면 템플릿에는 `DRAFT → REVIEW → PUBLISHED → RETIRED` 개정 흐름, 낙관적 잠금과 감사 기록이 구현돼 있다.

### 2.2 이번 작업의 보완점

1. 계산 규칙 작성·비교·검토·게시 API와 화면이 없다.
2. 규칙 개정에 `lockVersion`, 수정자·상태 변경자·수정 시각과 계산 내용 checksum이 없다.
3. 도면 선택 변환이 FIX 연신 옵션을 항상 `standard`로 고정하므로 게시 설정을 온전히 전달하지 못한다.
4. 동일 두께의 진행 중 개정과 유효 게시 기간 중복을 서버가 차단하지 않는다.
5. 최초 규칙에 근거 없는 0이나 seed 값을 자동 입력하지 않는 작성 흐름이 필요하다.
6. 게시 전에 현재 게시본과 새 값이 계산 결과에 주는 차이를 확인할 수 없다.

## 3. MFC와 레거시 조사 근거

### 3.1 참조 파일

| 파일 | 확인 내용 | 웹 판단 |
|---|---|---|
| `_define.h` | `HDT_RAWCATE`의 연신·컷 깊이·제한각 필드 | 의미가 드러나는 웹 필드명을 유지 |
| `DBApi.cpp` | `rawcate.cutv/cuta/cutno`를 연신값에, `cutv2/cuta2/cutno2`를 컷 깊이에 적재 | 레거시 명칭 역전을 그대로 계승하지 않음 |
| `DrawFx.cpp` | V-CUT은 V/A, V-CUT 해제는 NO-CUT 값을 선택 | 현재 웹의 `vCut/aCut/noCut` 계약 유지 |
| `_common.cpp` | FIX·RATIO 연신 계산과 일부 타입 누락·정수 보정 | 승인된 P1 Decimal·전체 타입 계산을 우선 |
| `Work03Dlg.cpp` | 제한각 비교와 계산 방식 선택 | 승인된 `angle < cutAngle` 경계 유지 |

MFC의 A/U 제작 형상은 같은 A-CUT 계산값을 사용한다. 웹도 제작 형상과 계산 컷 타입을 분리하며 U 전용 수치 필드를 새로 만들지 않는다.

### 3.2 레거시 DB 비식별 집계

| 항목 | 조사 결과 | 적용 판단 |
|---|---:|---|
| `rawcate` | 30행, 재질·두께 25조합, 계산값 조합 13종 | 전체 행 복제 대신 두께별 규칙 개정으로 통합 |
| 중복 재질·두께 | 3조합, 중복 안의 계산값은 동일 | 원판 차이는 A05 품목으로 분리 |
| FIX 원본 `cutv/cuta/cutno` | `0.0~1.6 / 0.0~1.2 / 0.0~3.2` | 0도 유효 값이므로 미입력과 구분 |
| RATIO 원본 `cutv2/cuta2/cutno2` | `0.0~1.6 / 0.0~1.7 / 전부 0.0` | NO-CUT 0을 유효 값으로 허용 |
| `cutangle` | 30행 모두 135° | 초기 참고값일 뿐 웹 고정값으로 강제하지 않음 |
| `refer.ELONGATION_CALC_TYPE` | `FIX` | 현재 설치의 참고값이며 조직별 웹 게시 설정으로 대체 |

레거시 DB는 읽기 전용 참고 자료다. P2-A04는 레거시 전체 이전을 실행하지 않으며 P2-C importer가 사용할 명시적 매핑만 남긴다.

## 4. 범위

### 포함

- 두께별 계산 규칙 개정 목록·상세·작성·수정·폐기
- 게시본 복사와 최초 규칙 작성
- 초안→검토→게시, 검토→수정 반려, 게시본 사용 종료
- FIX/RATIO, V-CUT, 연신 적용 옵션, Decimal 처리, 제한각·반경·V/A/NO-CUT 값
- 현재 게시본과 작성본의 필드·대표 계산 결과 비교
- 즉시 게시와 미래 효력 시작, 유효기간 중복 차단
- 권한·조직 경계·낙관적 잠금·멱등 재시도·감사 기록
- 도면 선택 API와 문서 snapshot에 게시 설정 전체 전달
- 단위·PostgreSQL 통합·E2E·화면 검수 가이드

### 제외

- P1 계산 수식과 제작 geometry의 재설계
- 원판 규격·중량·원가·재고: `P2-A05`
- 가격 계산: `P2-A06`
- 실제 제작 공차 표본 확정: `P2-B10/P2-C13`에서 별도 검증
- 레거시 전체 데이터 이전: `P2-C`
- 입면도와 실제 기계 통신

## 5. 계산 규칙 데이터 계약

### 5.1 계산 내용

| 묶음 | 필드 | 규칙 |
|---|---|---|
| 계산 방식 | `calculationMode` | `FIXED` 또는 `RATIO` |
| 컷 사용 | `vCutEnabled` | 끄면 form을 바꾸지 않고 NO-CUT 값을 사용 |
| FIX 옵션 | `elongationOption` | `STANDARD/TWO_LINE/DIAGONAL/EXT1`; RATIO에서는 보존하되 계산에 영향 없음 |
| Decimal | `decimalPlaces`, `decimalOperation` | 0~6자리, NONE/ROUND/FLOOR/CEIL |
| 형상 기준 | `insideBendRadiusMm`, `cutAngleDeg` | 반경 0 이상, 제한각 0 초과 180 이하 |
| FIX 값 | `elongationVCutMm/ACutMm/NoCutMm` | 0 이상, 소수 최대 6자리, 소수값 보존 |
| RATIO 값 | `cutDepthVCutMm/ACutMm/NoCutMm` | 0 이상, 소수 최대 6자리 |

FIX와 RATIO의 여섯 수치는 계산 방식과 무관하게 한 개정에 모두 저장한다. 방식 변경은 새 개정으로 처리하고, 사용하지 않는 쪽의 값도 명시적으로 보존해 전환 시 임의 기본값이 생기지 않게 한다.

### 5.2 개정·감사 보강

`MaterialRuleRevision`에 다음 계약을 보강한다.

- `elongationOption`: JSON 대신 Prisma enum으로 명시
- `changeSummary`: 작성자가 남기는 변경 목적
- `contentChecksumSha256`: 계산 내용의 canonical SHA-256
- `lockVersion`, `updatedAt`, `updatedByUserId`
- `statusChangedAt`, `statusChangedByUserId`
- 기존 `createdByUserId`, `publishedByUserId`, `publishedAt`, 유효기간 유지

상태 전이의 행위자·전후 상태·반려 사유는 감사 이벤트에 기록하고 규칙 상세에서 조회 가능한 이력 DTO로 제공한다. 별도 중복 이력 테이블은 만들지 않고 기존 불변 `AuditEvent`를 조직·entity 범위로 안전하게 읽는다.

## 6. 상태·개정·유효기간 규칙

### 6.1 상태 전이

```text
DRAFT ──검토 요청──▶ REVIEW ──게시──▶ PUBLISHED ──사용 종료──▶ RETIRED
  ▲                    │
  └────수정 반려───────┘

DRAFT ──폐기──▶ 삭제 표시된 초안
```

- `DRAFT`만 계산 내용을 수정한다.
- `REVIEW` 이후 계산 내용은 잠그고, 수정이 필요하면 사유와 함께 `DRAFT`로 돌린다.
- 게시된 계산 내용은 직접 수정하지 않고 복사한 새 개정을 만든다.
- 두께별 `DRAFT` 또는 `REVIEW` 진행 개정은 합계 한 건만 허용한다.
- 최초 규칙은 작성 화면의 필수값을 모두 입력한 뒤 저장한다. 내부 반경만 두께 기본 반경을 제안하고, 다른 계산값은 자동 생성하지 않는다.
- 기존 게시본이 있으면 새 초안은 해당 값을 전부 복사해 시작한다.

### 6.2 유효기간과 게시

- 검토 요청 전에 `effectiveFrom`을 필수로 정하며 기본 제안은 현재 시각이다.
- `effectiveTo`는 사용자가 직접 입력하지 않는다. 다음 개정 게시나 명시적 사용 종료 시 서버가 관리한다.
- 미래 시작 게시를 허용하고 화면에서는 `예약`, 현재 유효하면 `사용 중`, 종료 시각이 지났으면 `기간 종료`로 파생 표시한다.
- 한 두께에는 현재/미래를 합쳐 겹치는 게시 유효구간이 없어야 하며 미래 예약은 한 건만 허용한다.
- 새 개정 게시 시 직전 게시본의 `effectiveTo`를 새 개정의 `effectiveFrom`으로 닫는다. 계산 내용은 수정하지 않는다.
- 미래 예약본은 효력 시작 전 `material.approve`로 취소할 수 있다. 취소 시 예약 게시 때문에 닫아 둔 직전 게시본의 `effectiveTo`를 복원해 적용 공백을 만들지 않는다. 별도 scheduler 없이 조회 시각과 유효기간으로 적용 대상을 결정한다.
- 같은 요청의 재시도는 동일 결과를 돌려주며, 다른 동시 변경은 `409 CONFLICT`로 차단한다.

## 7. 계산 영향 미리보기

게시 전 물리 제작 정답을 단정하는 대신 현재 계산 엔진으로 변경 영향을 가시화한다.

- 현재 유효 게시본과 작성본의 필드별 이전값/새값/delta
- 90° 앞각 단일, 90° 뒷각 단일, 양쪽 절곡, V/A/NO-CUT, 134°/135°/136° 경계 표본
- FIX는 소수 보존, RATIO는 `angle < cutAngle`, 계산 제외는 양쪽 미적용을 그대로 사용
- 결과에는 원래 길이, 보정 합계, 최종 전개 폭을 Decimal 문자열로 표시
- 미리보기는 저장·게시 결과가 아니며 사용자가 입력한 임시값을 서버 계산 함수로 검증한 응답이다.
- 게시 공통 확인 팝업에는 변경 요약, 효력 시작, 현재 게시본 종료 영향을 표시한다.

## 8. 권한과 업무 처리

| 권한 | 허용 작업 |
|---|---|
| `material.read` | 목록·상세·게시본·이력·미리보기 조회 |
| `material.write` | 초안 작성·수정·폐기·검토 요청 |
| `material.approve` | 수정 반려·게시·예약 취소·사용 종료 |

초기 운영은 담당자와 검수자가 모두 사용자 본인이므로 자기 검토·게시를 허용한다. 모든 상태 전이의 실제 행위자와 시간을 감사에 남기며, 향후 별도 승인자 강제는 조직 정책 기능으로 확장한다.

## 9. API와 화면 계약

### 9.1 Route Handler

```text
GET  /api/v1/materials/:materialId/variants/:variantId/rules
POST /api/v1/materials/:materialId/variants/:variantId/rules
GET  /api/v1/materials/:materialId/variants/:variantId/rules/:ruleId
PATCH /api/v1/materials/:materialId/variants/:variantId/rules/:ruleId

POST /api/v1/materials/:materialId/variants/:variantId/rules/:ruleId/preview
POST /api/v1/materials/:materialId/variants/:variantId/rules/:ruleId/transitions
```

`transitions`는 `review/return/publish/retire/discard` action, `expectedLockVersion`, action별 사유·효력 시작을 검증한다. 모든 변경은 Origin, 조직 경계, request ID와 표준 오류 envelope를 적용한다.

### 9.2 화면

- `/materials/[materialId]` 두께 행에 `계산 기준 관리`와 현재 상태를 제공한다.
- `/materials/[materialId]/variants/[variantId]/rules`에서 개정 이력, 현재/예약 게시본, 초안 비교를 제공한다.
- 편집은 한 화면에서 계산 방식·공통 옵션·V/A/NO-CUT 값을 그룹화하고 우측 또는 하단에 비교·미리보기를 배치한다.
- 데스크톱은 입력과 비교를 2열로, 모바일은 입력→비교→작업 버튼 순의 1열로 전환한다.
- 상태 전이는 페이지 이탈 없이 반영하며, 성공·확인·충돌·반려 사유는 공통 팝업을 사용한다.
- 게시본은 읽기 전용이고 `새 개정 만들기`를 명확한 주 작업으로 둔다.

## 10. 권장 결정안

| ID | 결정 | 권장안 |
|---|---|---|
| `D2-A04-A` | 작업 경계 | 계산 규칙 작성·비교·검토·게시와 설계 적용까지; 계산 수식 재설계·가격·원판은 제외 |
| `D2-A04-B` | 개정 흐름 | `DRAFT→REVIEW→PUBLISHED→RETIRED`, 반려는 REVIEW→DRAFT, 게시 계산 내용 불변 |
| `D2-A04-C` | 진행 개정 수 | 두께별 DRAFT/REVIEW 합계 한 건, 게시본 복사로 새 개정 생성 |
| `D2-A04-D` | 최초 값 | 내부 반경만 variant 값 제안, 연신·깊이·각도는 자동 생성하지 않고 필수 입력 |
| `D2-A04-E` | 저장 필드 | FIX와 RATIO 여섯 값을 모두 명시 저장하고 V/A/NO-CUT으로 구분 |
| `D2-A04-F` | A/U 처리 | A와 U 제작 형상은 같은 A-CUT 값을 사용하며 U 전용 수치는 만들지 않음 |
| `D2-A04-G` | 수치 검증 | 연신·깊이·반경은 0 이상, 제한각은 `0 < angle ≤ 180`, 최대 6자리 Decimal |
| `D2-A04-H` | 승인 계산 기준 | FIX 소수 보존, 계산 제외 양쪽 적용, RATIO는 `angle < cutAngle`만 적용 |
| `D2-A04-I` | FIX 옵션 | `STANDARD/TWO_LINE/DIAGONAL/EXT1`을 명시 enum으로 저장·snapshot 전달 |
| `D2-A04-J` | Decimal 정책 | 0~6자리와 NONE/ROUND/FLOOR/CEIL을 개정에 저장하고 설계가 게시 설정 사용 |
| `D2-A04-K` | 효력 시작 | 즉시·미래 시작 허용, `effectiveTo`는 다음 게시/종료 시 서버가 관리 |
| `D2-A04-L` | 기간 충돌 | 겹치는 게시 구간 차단, 미래 예약 한 건, scheduler 없이 조회 시각으로 파생 상태 결정 |
| `D2-A04-M` | 권한 | write는 작성·검토 요청, approve는 반려·게시·종료; 초기 자기 게시 허용, 행위자 감사 |
| `D2-A04-N` | 동시성·무결성 | `lockVersion`, canonical checksum, DB transaction/row lock, 멱등 재시도 |
| `D2-A04-O` | 영향 미리보기 | 현재 게시본과 값·대표 계산 결과를 비교하고 게시 팝업에 효력 변경 요약 |
| `D2-A04-P` | 기존 도면 | 기존 snapshot은 변경하지 않고 새 선택·재질 재적용 때만 새 유효 개정 사용 |
| `D2-A04-Q` | 레거시 | 읽기 전용 매핑만 기록, 역전된 필드명과 135° 전역값을 웹 계약에 강제하지 않음 |
| `D2-A04-R` | 화면 | 두께 상세에서 규칙 관리 진입, 개정 이력·비교·편집·공통 팝업을 반응형 서비스 UI로 제공 |

## 11. 승인 후 구현 순서

| 단계 | 세부 작업 | 완료 기준 |
|---|---|---|
| `A04-01` | 결정·계약 확정 | `D2-A04-A~R` 승인과 문서 상태 변경 |
| `A04-02` | Prisma·migration | enum·무결성·잠금·checksum·감사 관계, 빈/기존 PostgreSQL 적용 |
| `A04-03` | 입력·checksum·상태 정책 | Decimal·canonical hash·전이·기간 중복 단위 테스트 |
| `A04-04` | 규칙 조회·초안 서비스 | 조직 격리, 최초 입력, 게시본 복사, 한 개 진행 규칙 통합 테스트 |
| `A04-05` | 검토·게시 transaction | 권한, row lock, 즉시/예약 게시, 반려·종료·멱등성 검증 |
| `A04-06` | 미리보기 서비스 | 현재 엔진 재사용, 대표 표본과 현재/작성본 비교 검증 |
| `A04-07` | Route Handler | 인증·Origin·오류 envelope·request ID와 모든 action 계약 |
| `A04-08` | 개정 목록·편집 화면 | 반응형 입력, 상태·이력, 게시본 복사, 조회 전용 권한 |
| `A04-09` | 비교·상태 전이 UX | 계산 영향 비교, 공통 팝업, 충돌 복구·반려 사유 |
| `A04-10` | 설계 적용 | `elongationOption` 포함 게시 설정 전달, snapshot·재열기 불변 검증 |
| `A04-11` | 회귀·화면 검수 준비 | 단위·통합·E2E·lint·typecheck·build·migration drift와 테스트 가이드 |

## 12. 테스트 기준

- 조직 밖 규칙과 이력은 조회·변경할 수 없다.
- write/approve 권한별 버튼과 서버 전이가 일치한다.
- 최초 규칙은 계산값 누락을 허용하지 않고 0 입력은 유효 값으로 구분한다.
- 게시본 복사는 전체 계산값·옵션·반경을 손실 없이 복사한다.
- DRAFT만 수정되며 REVIEW/PUBLISHED 수치 변경은 차단된다.
- stale 저장·중복 게시·기간 겹침은 `409`, 잘못된 수치는 `400`이다.
- 134°에는 RATIO가 적용되고 135°·136°에는 적용되지 않는 경계를 회귀 검증한다.
- FIX 소수와 네 옵션, V-CUT on/off, V/A/NO-CUT 선택을 현재 P1 표본과 대조한다.
- 즉시 게시·미래 예약·예약 취소·사용 종료 후 도면 선택 결과가 정확하다.
- 기존 도면은 게시 교체 후에도 이전 규칙 ID·값으로 같은 결과를 낸다.
- 새 도면은 현재 유효 게시본의 `elongationOption`과 Decimal 설정까지 snapshot으로 받는다.
- 390px·일반 노트북·고해상도에서 입력·비교·작업 버튼이 가려지지 않는다.
- 모든 알림·확인·사유 입력은 공통 팝업이며 native dialog가 없다.
- 전체 P1, P2-A01~A03 자동 회귀가 계속 통과한다.

## 13. 사용자 승인 게이트

`D2-A04-A~R`은 2026-08-01 사용자에 의해 전체 승인됐다. `A04-01~A04-11` 구현과 자동 검증을 완료했고 [P2-A04 화면 테스트 가이드](../P2-A04-screen-test-guide.md)에 따른 사용자 화면 검수도 2026-08-01 승인 완료됐다. 후속 작업은 [P2-A05 원판 품목 상세계획](./P2-A05-sheet-items.md)으로 진행한다.

## 14. 구현·검증 결과

- Prisma enum·잠금·checksum·행위자·유효기간·DB 제약과 upgrade migration을 적용했다.
- 조직·권한·Origin·낙관적 잠금·멱등 재시도·감사를 포함한 조회, 초안, 미리보기와 전체 상태 전이 API를 구현했다.
- 즉시 게시, 미래 예약, 예약 취소 시 직전 게시본 복원과 게시 구간 중복 차단을 transaction으로 처리한다.
- 현재/예약/진행 요약, 개정 목록, 반응형 편집, 대표 표본 미리보기와 공통 팝업 기반 검토·반려·게시·종료 화면을 구현했다.
- 도면 설계가 게시본의 `elongationOption`을 포함한 계산 설정을 snapshot으로 사용하고, 과거 도면의 RETIRED 규칙 snapshot은 그대로 재열 수 있게 했다.
- 단위 302건, PostgreSQL 통합 47건, Chromium E2E 23건, lint, typecheck, production build, Prisma validate와 migration drift 검사를 통과했다.
