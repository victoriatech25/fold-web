# P1-05 — 절곡 필드·enum·단위 매핑

> 상태: `DONE`
>
> 우선순위: `P1`
>
> 담당자: 사용자 본인
>
> 검수자: 사용자 본인
>
> 관련 게이트: `D1-05`, `D1-06`
>
> 계획 작성일: 2026-07-24
>
> 착수일: 2026-07-24
>
> 완료일: 2026-07-24
>
> 상위 계획: [P1 실행계획](./P1-execution-plan.md)
>
> 후속 작업: [P1-06 절곡 문서 계약 v1](./P1-execution-plan.md#4-작업별-실행-기준)

## 1. 목표와 현재 결론

현재 웹 `FoldProfile`, Prisma 절곡 모델, MFC 구조체와 레거시 `foldd/foldxy/sellfold/sellfoldxy`의 의미를 연결해 P1-06이 구현할 서버용 절곡 문서 계약의 입력 기준을 확정한다.

필드 조사는 완료했다. 다만 현재 웹 모델은 직선과 단일 앞/뒤 절곡만 충분히 표현하고 다음 레거시 의미를 손실 없이 보존하지 못한다.

- 시작·끝 표식과 직선·좌/우 곡선의 구분
- A·ZERO·U 및 앞/뒤 복합 절곡 타입
- 방향, 곡 깊이, 변수식, 패널 참조
- 편집 입력과 계산·제작 결과의 구분
- JavaScript `number`가 아닌 Decimal 문자열 기반 서버 문서

따라서 현재 `FoldProfile` v3 JSON을 서버 계약으로 그대로 고정하지 않는다. 아래 `D1-05-A~L` 권장안은 2026-07-24 사용자가 전체 승인했으며, P1-06에서 버전 1 계약과 변환기를 구현한다.

## 2. 참조 원본과 적용 원칙

### 2.1 MFC 프로젝트

```text
/Users/kyhoon/Library/Mobile Documents/com~apple~CloudDocs/회사/hicomtech/도면
```

확인한 주요 파일:

- `_define.h`: `Henum_WorkType`, `Henum_AngleType`, `Henum_Direction_foldline`, `HDT_FOLDD`, `HDT_DRAWFX`, `HDT_SELLFOLD`, `HDT_SELLFOLDXY`
- `DrawFx.cpp`: 선·호 좌표와 곡 깊이·반경 변환
- `Work03Dlg.cpp`: 변수식 평가, 구간 길이·연신·곡선·박스 계산
- `DBApi.cpp`, `_dbcom/DBCommon.cpp`: `foldxy`, `sellfoldxy` 읽기·쓰기 필드
- `CuttingDlg.cpp`, `NCFileSinSung.cpp`: `operators/operand`의 제작·NC 표기 사용

MFC 코드는 의미 확인용 읽기 전용 근거다. 실행 메커니즘, 화면 상태, SQL 구조와 계산 오류를 웹에 복제하지 않는다.

### 2.2 레거시 데이터

- 참조 원본: 별도 MFC PostgreSQL `krsteelfold2`, 업무 schema `postgres`
- 접속정보: 저장소에 기록하지 않고 secret으로만 관리
- 확인 건수: `foldd` 189, `foldxy` 1,606, `sellfold` 140,761, `sellfoldxy` 1,060,688
- SQLite: 스키마 확인용 읽기 전용 자료일 뿐 웹 개발·테스트·운영 런타임에서는 사용하지 않음

레거시 PostgreSQL도 웹 런타임에서 조회하지 않는다. 향후 P2 importer가 비식별 staging export를 신규 PostgreSQL/Prisma 구조로 변환한다.

### 2.3 현재 웹 코드

- `src/domain/fold-profile.ts`: `FoldProfile` v3, 블록·선·단일 절곡·재질 snapshot
- `src/domain/fold-profile-serialization.ts`: 브라우저 JSON v1→v3 변환
- `src/domain/fold-profile-validation.ts`: 현재 number 기반 검증
- `src/domain/fold-calculation.ts`: FIX/RATIO와 승인된 계산 규칙
- `src/domain/developed-pattern.ts`: 일반·박스 전개도
- `prisma/schema.prisma`: `FoldCategory`, `FoldTemplate`, `FoldRevision`, `MaterialRuleRevision`

현재 브라우저 직렬화 버전 `3`과 P1-06의 서버 문서 계약 버전 `1`은 서로 다른 버전 축으로 관리한다.

## 3. 분류와 단위 정책

| 분류 | 의미 | 처리 |
|---|---|---|
| `AUTHORITATIVE_INPUT` | 사용자가 편집하고 재계산의 원본이 되는 값 | 서버 문서 checksum에 포함 |
| `REFERENCE_SNAPSHOT` | 계산 재현을 위해 당시 기준을 고정한 값 | 개정 ID와 값 snapshot을 함께 보존 |
| `DERIVED_RESULT` | 입력·규칙에서 다시 계산 가능한 값 | 편집 원본과 분리, preview 응답 또는 결과 snapshot에 기록 |
| `SERVER_METADATA` | 조직·소유·개정·상태·시간·checksum | JSON 중복 없이 Prisma row가 관리 |
| `LEGACY_PROVENANCE` | 이관 추적에만 필요한 원본 키·코드 | 별도 매핑/이관 보고서에 보존 |
| `UNSUPPORTED` | 입면도·MFC 실행·미확정 제작 규칙 | 활성 문서에 조용히 변환하지 않고 거부 또는 격리 |

단위와 저장 형식:

| 값 | 문서 형식 | Prisma/PostgreSQL | 규칙 |
|---|---|---|---|
| 길이·좌표·두께·반경·깊이·연신 | canonical Decimal 문자열 | `Decimal` / `numeric` | 단위 `mm`, 지수 표기 금지, `-0` 정규화 |
| 각도 | canonical Decimal 문자열 | `Decimal(9,4)` 후보 | 단위 `degree`, `0..180` 검증 |
| 면적·중량·가격 | 절곡 편집 문서 밖 결과 | 별도 `Decimal` | 각각 `m²`, `kg`, 원(KRW) 명시 |
| 수량·순서 | JSON 정수 | `Int` | 수량 `>=1`, 순서 연속성 검증 |
| 시간 | JSON에 필요할 때 ISO-8601 UTC | `timestamptz` | 서버 metadata를 우선 |
| 좌표계 | 문서 로컬 좌표 | 해당 없음 | `mm`, 화면 pixel·zoom을 저장하지 않음 |

## 4. 문서·헤더 필드 매핑

### 4.1 식별·분류·제품

| 웹 계약 후보 | 현재 웹 | MFC/레거시 | 분류 | 변환·기본값·지원 |
|---|---|---|---|---|
| `documentType` | `profileType` | 시작선 개수, `ref_num` | 입력 | `normal`, `box`; `panel`은 예약 후 P1-12 구현. 입면도 타입 없음 |
| `name` | `name` | `foldd.fname`, `sellfold.fname` | 입력 | 필수, 공백 제거 후 빈 값 금지 |
| `categoryId` | 없음 | `foldd.catecode` | 서버 metadata | Prisma `FoldTemplate.categoryId`; 레거시 숫자는 provenance에만 보존 |
| `product.lengthMm` | `product.length` | `sellfold.lenw`와 MFC `len_h` | 입력 | DB/MFC 명칭 역전 주의. 제품 진행 길이이며 기본 `0`은 초안 UI에서만 허용 |
| `product.quantity` | `product.quantity` | `sellfold.qty` | 입력 | 기본 1, 저장 시 1 이상 정수 |
| `materialRuleRevisionId` | 없음 | `sellfold.rawcode`, 재질·두께 문자열 | 서버 관계 | 조직 내 활성 revision 참조, 레거시 키 직접 사용 금지 |
| `materialSnapshot` | `material` | 재질·두께·연신·cut depth | snapshot | 재질명, 두께, 내부 반경, cut angle, 컷별 값을 저장 당시 고정 |
| `calculation` | `calculation` | 전역 FIX/RATIO, V-CUT, 소수 설정 | 입력/snapshot | mode·옵션·소수 정책을 명시하고 서버 암묵 기본값 금지 |
| `variables` | 부분적으로 `formula`만 존재 | `foldd.varivalue`, `sellfold.varivalue` | 입력 | 이름→Decimal 문자열. parser와 의존성은 P1-11 |
| `productExpression` | 없음 | `foldd.formulaa`, `sellfold.formulaa/formuse` | 입력 | 선택적 표현식과 활성 여부를 분리, 문법 버전 기록 |
| `note` | 없음 | `sellfold.remark` | 주문 metadata | 재사용 템플릿 문서가 아니라 주문 항목에 보존 |

`FoldRevision.id`, `templateId`, `revisionNumber`, `status`, 조직, 작성자, 게시자, 생성·수정 시각과 checksum은 Prisma row가 관리한다. 클라이언트가 JSON 안의 값을 바꿔 소유권이나 개정을 위조할 수 없게 한다.

### 4.2 재질·계산 기준

| 웹 계약 후보 | 현재 웹 | 레거시 | 처리 |
|---|---|---|---|
| `thicknessMm` | `material.thickness` | 재질 두께 | Decimal 문자열, `>0` |
| `insideBendRadiusMm` | `insideBendRadius` | 일부 계산·표시에 산재 | Decimal 문자열, `>=0` |
| `cutAngleDeg` | `cutAngle` | 전역 cut angle | Decimal 문자열; 승인 규칙은 `angle < cutAngle`만 RATIO 적용 |
| `elongationMm.vCut/aCut/noCut` | `elongation[v/a/no-cut]` | 재질별 연신 | FIX 소수 보존. bend form과 별도 계산 정책 |
| `cutDepthMm.vCut/aCut/noCut` | `cutDepth[v/a/no-cut]` | `cutdepth` | RATIO 입력. bend form과 별도 계산 정책 |
| `mode` | `fixed/ratio` | `ELCALC_FIX/RAT` | `fixed`, `ratio` |
| `elongationOption` | 없음 | `NA/LN/DG/EXT1` | `standard`만 P1-06 활성. `two-line/diagonal/ext1`은 보존 가능하되 P1-10 전 계산 차단 |
| `vCutEnabled` | 동일 | `sellfold.vcut` | boolean, 현재 승인 규칙 유지 |
| `decimalPlaces` | 동일 | 전역 설정 | 정수, 허용 범위는 P1-06에서 제한 |
| `decimalOperation` | 동일 | NONE/ROUND/FLOOR/CEIL | 소문자 enum, MFC 숫자 코드 저장 금지 |

현재 코드의 `DEFAULT_MATERIAL`과 `DEFAULT_CALCULATION`은 새 화면을 여는 UI seed다. 서버가 누락 필드를 해당 값으로 보충하지 않으며, 저장 요청에는 선택한 `MaterialRuleRevision`에서 만든 완전한 snapshot이 있어야 한다.

## 5. 블록·선·곡선 매핑

### 5.1 `linetype`

MFC `Henum_WorkType`은 절곡선 외의 일반 그리기 도구까지 한 enum에 포함한다. 실제 `sellfoldxy`에는 다음 네 값만 확인됐다.

| 레거시 값 | MFC 이름 | 확인 건수 | 웹 처리 |
|---:|---|---:|---|
| 1 | `WT_START` | 150,076 | 선이 아니라 새 `block`의 시작 경계로 변환 |
| 4 | `WT_LINE` | 910,051 | `geometry.kind = line` |
| 5 | `WT_CURVE_R` | 487 | `geometry.kind = arc`, `side = right` |
| 6 | `WT_CURVE_L` | 74 | `geometry.kind = arc`, `side = left` |

`WT_EDIT/DRAW/RECT/...`는 절곡 문서의 유효 geometry가 아니다. importer는 이를 임의의 직선으로 바꾸지 않고 오류 행으로 격리한다.

### 5.2 선 필드

| 웹 계약 후보 | 현재 웹 | `foldxy/sellfoldxy` | 분류 | 변환·지원 |
|---|---|---|---|---|
| `block.id/order/name` | `FoldBlock` | `WT_START`, `AT_END`, 순서 | 입력 | UUID·정수. `WT_START` sentinel은 segment로 남기지 않음 |
| `segment.id/order` | `id`, 배열 순서 | `lineno/linenof` | 입력 | UUID + 명시적 order, 레거시 번호는 provenance |
| `geometry.kind` | 직선만 | `linetype` | 입력 | `line/arc`; 현재 UI의 호 편집은 P1-12 |
| `geometry.start/end` | `start/end` number | `x1/y1/x2/y2` | 입력 | Decimal 문자열 mm, 인접점 tolerance 검증 |
| `geometry.direction` | 좌표에서 암묵적 | `linedirect` 0..8 | 입력 | `none,n,ne,e,se,s,sw,w,nw`; 수식 재평가 시 진행 방향 보존 |
| `nominalLengthMm` | `inputLength` | `lengthh` | 입력 | 사용자·수식이 정한 길이. 좌표 chord와 불일치 가능 |
| `displayLengthMm` | 없음 | `length2` | provenance/derived | MFC 화면 스케일 보조값으로 판정; 서버 원본에는 저장하지 않음 |
| `lengthExpression` | `formula?` | `lengthvari` | 입력 | 빈 문자열은 없음. 원문 + `grammarVersion`; 실행은 P1-11 |
| `arc.side` | 없음 | `WT_CURVE_R/L` | 입력 | `right/left`; 웹 좌표계 기준을 P1-12에서 고정 |
| `arc.sagittaMm` | 없음 | `arcdepth` | 입력 | 곡 깊이. `>0`, chord와 함께 유효성 검증 |
| `arc.radiusMm` | 없음 | `lengthr` | derived/provenance | sagitta와 chord에서 재계산; 불일치는 이관 보고서에 기록 |
| `refNum` | 없음 | `ref_num` | 입력(예약) | `0`은 일반 블록, 양수는 패널 연결. P1-12 전 활성 편집·계산 금지 |

좌표는 형상의 기준이고 `nominalLengthMm`은 계산·치수의 기준이다. 둘이 다를 수 있으므로 한 값을 다른 값으로 조용히 덮어쓰지 않고 validation warning과 재생성 명령을 분리한다.

## 6. 절곡 enum 재구성

### 6.1 구조 원칙

MFC `angtype`은 경계, 면 방향, 절곡 형태와 복합 작업 순서를 한 숫자에 합쳤다. 웹 계약은 다음으로 분리한다.

```text
block 경계: 배열 구조로 표현
junctionAfter:
  operations[]:
    direction: front | back
    form: standard | a | zero | u
  angleDeg
  calculateElongation
```

`operations[]` 순서는 제작·표시 순서를 보존한다. 현재 `bendAfter` 단일 객체는 P1-06 변환기의 입력 호환 대상으로만 두고 서버 계약에서는 `junctionAfter`를 사용한다.

### 6.2 전체 `angtype` 매핑

| 값 | MFC 이름 | 웹 의미 |
|---:|---|---|
| 0 | `AT_NONE` | 유효 절곡 없음. 중간 segment에서 발견되면 격리 |
| 1 | `AT_START` | block 시작 경계, operation 없음 |
| 2 | `AT_END` | block 끝 경계, operation 없음 |
| 3 | `AT_FRONT` | `[front/standard]` |
| 4 | `AT_BACK` | `[back/standard]` |
| 5 | `AT_FRONT_A` | `[front/a]` |
| 6 | `AT_BACK_A` | `[back/a]` |
| 7 | `AT_FRONT_ZERO` | `[front/zero]` |
| 8 | `AT_BACK_ZERO` | `[back/zero]` |
| 9 | `AT_FRONT_U` | `[front/u]` |
| 10 | `AT_BACK_U` | `[back/u]` |
| 11 | `AT_BACK_FRONT` | `[back/standard, front/standard]` |
| 12 | `AT_BACK_FRONT_A` | `[back/a, front/a]` |
| 13 | `AT_BACK_FRONT_ZERO` | `[back/zero, front/zero]` |
| 14 | `AT_BACK_FRONT_U` | `[back/u, front/u]` |
| 15 | `AT_FRONT_BACK` | `[front/standard, back/standard]` |
| 16 | `AT_FRONT_BACK_A` | `[front/a, back/a]` |
| 17 | `AT_FRONT_BACK_ZERO` | `[front/zero, back/zero]` |
| 18 | `AT_FRONT_BACK_U` | `[front/u, back/u]` |

실제 참조 데이터는 START 150,076, END 149,938, FRONT 624,845, BACK 135,815, FRONT_ZERO 13, NONE 1건이다. A/U/복합 타입은 실제 빈도가 확인되지 않았어도 MFC enum에 존재하므로 계약에서 표현은 가능하게 하고, 계산은 P1-10의 유형별 승인 회귀가 생길 때까지 `UNSUPPORTED_CALCULATION`으로 차단한다.

`form`은 기존 `CutType(v-cut/a-cut/no-cut)`과 동일 개념으로 간주하지 않는다. 특히 ZERO/U의 계산·제작 의미는 P1-10에서 별도 확정하며, importer가 임의로 `no-cut`에 합치지 않는다.

## 7. 계산 제어·결과 필드 매핑

| 웹 계약 후보 | 현재 웹 | 레거시 | 분류 | 처리 |
|---|---|---|---|---|
| `junctionAfter.calculateElongation` | `segment.calculateElongation` | `calcuyn` | 입력 | 기본 `true`; `false`이면 승인 규칙대로 절곡 양쪽 구간 기여 제외 |
| `segmentCorrectionOverrideMm` | `elongationOverride` | 직접 대응 불명확 | 입력 | 구간 전체 수동 보정. bend 연신값과 분리 |
| `automaticCorrectionMm` | 계산 결과 | `elongation/elongate` | 결과 | 엔진이 계산, 편집 입력으로 신뢰하지 않음 |
| `cutDepthMm` | material rule | `sellfoldxy.cutdepth` | snapshot/result | 당시 적용값 대조용. rule snapshot과 차이는 보고 |
| `calculatedLengthMm` | 계산 결과 | `calclen` | 결과 | preview/결과 snapshot, 문서 입력 아님 |
| `calculatedThroughLengthMm` | 없음 | `calclenthr` | 결과 | 곡선·특수 옵션 결과, P1-10/12에서 정의 |
| `reportedLengthMm` | 없음 | `calclenrepo` | 결과/provenance | 비영 값 2,880건. 의미 확정 전 계산 입력 금지 |
| `resultStart/resultEnd` | 없음 | `rx1/ry1/rx2/ry2` | 결과 | 제작 geometry 결과, P1-14에서 생성 |
| `inputLengthTotalMm` | 계산 결과 | `lenw_org/lenh_org` | 결과 | block별 합계 |
| `developedWidth/HeightMm` | 계산 결과 | `sellfold.lenh/lenw` | 결과 | 레거시 DB와 MFC 구조체 이름 역전 주의 |
| `areaM2/weightKg` | 계산 결과 | `calcum2/calcukg` 등 | 결과 | 주문 계산 snapshot에서 관리, 템플릿 입력에 넣지 않음 |

FIX 소수 보존, 계산 제외의 양쪽 적용, RATIO의 `angle < cutAngle` 경계는 이미 승인된 `WEB-REFERENCE-V1`을 그대로 계승한다.

## 8. 변수·제작·레거시 전용 필드

| 레거시 필드 | 의미 판정 | 웹 처리 |
|---|---|---|
| `varivalue` | 템플릿/주문 변수 값 묶음 | 파싱된 `variables` map으로 변환; 원문은 importer 보고서에만 보존 |
| `lengthvari` | 구간 길이 수식 | `lengthExpression.source`, `grammarVersion`; 안전 parser 전 실행 금지 |
| `formulaa/formuse` | 제품·소요량 수식과 활성 여부 | `productExpression`; 가격·소요량 계산은 별도 도메인 |
| `operators/operand` | NC/재단 파일에 붙는 연산 표기 | `manufacturingAnnotation` 예약. 길이 수식에 합치지 않으며 P1-16 전 비활성 |
| `vprint` | 출력 여부 | 출력 설정/명령으로 분리, 문서 형상 필드가 아님 |
| `dxfdata` | DXF 존재 여부 | `FileAsset`과 checksum으로 대체 |
| `netid/channell` | MFC 기계 대상 | P1-04 기계 연동 placeholder 또는 향후 작업으로 분리 |
| MFC save flag·pointer·temporary flag | 메모리/DB 실행 상태 | 이전하지 않음 |
| 입면도 `draww/drawxy/...` | 입면도 | 활성 모델·API·UI·importer에서 제외, archive manifest만 유지 |

## 9. P1-06이 구현할 경계

### 9.1 서버 문서에 포함

- 문서 타입·이름·제품 입력
- material rule revision 참조와 immutable snapshot
- 계산 방식·옵션·소수 정책
- 변수와 버전이 있는 표현식 원문
- block·segment·line/arc geometry
- 구조화한 junction operations와 계산 제외·수동 구간 보정
- 향후 패널·제작 annotation을 위한 명시적 예약 필드

### 9.2 서버 문서에서 제외

- 조직·권한·개정 상태·작성자·서버 시각·checksum의 중복
- 화면 pixel, zoom, selection, Undo stack
- 재계산 가능한 `calclen`, 합계, 면적, 결과 좌표
- 고객·주문·가격·메모와 기계 접속정보
- MFC 숫자 PK, save flag, pointer, 실행 parameter
- 입면도 데이터

### 9.3 계산 결과 계약

편집 문서는 authoritative input만 저장한다. preview 결과는 `documentChecksum + engineVersion + materialRuleRevisionId`를 식별자로 반환한다. 게시·주문·DXF처럼 재현성이 필요한 시점에는 이 세 값과 계산 출력을 별도의 immutable result snapshot으로 저장한다. 오래된 결과가 최신 입력처럼 보이지 않게 입력과 결과 checksum이 다르면 사용을 거부한다.

## 10. 변환·기본값·오류 정책

| 상황 | 정책 |
|---|---|
| 현재 웹 v3 number 문서 | P1-06 converter가 유한값 확인 후 canonical Decimal 문자열로 변환 |
| 누락된 선택 필드 | `formula`, override, annotation만 `undefined`; 빈 문자열·0 sentinel을 만들지 않음 |
| 누락된 필수 재질·계산 필드 | 서버 기본값으로 보충하지 않고 validation error |
| `calculateElongation` 누락 | 새 문서 생성 시 명시적으로 `true`; 구버전 변환 시 기존 동작과 같게 `true` |
| START/END 레거시 행 | block 경계로 흡수하고 geometry segment를 만들지 않음 |
| 알 수 없는 line/angle/direction code | raw 값과 source key를 오류 보고서에 보존하고 해당 문서 import 거부 |
| 곡선 radius와 sagitta 불일치 | sagitta+chord를 입력 기준으로 재계산하고 차이를 보고; 자동 승인 금지 |
| 좌표와 nominal length 불일치 | 둘 다 보존하고 warning. 사용자가 재생성하기 전 조용히 수정 금지 |
| 지원 전 A/U/복합/패널 | parse·보존은 가능, 계산·게시·DXF는 명시적 오류로 차단 |
| 레거시 계산 결과 차이 | `PARITY_REQUIRED/LEGACY_DEFECT/WEB_IMPROVEMENT/RULE_CHANGE/UNRESOLVED`로 분류 |

## 11. 결정 게이트 — 승인 결과

2026-07-24 사용자가 `D1-05-A~L` 권장안을 전체 승인했다.

| ID | 권장안 | 영향 |
|---|---|---|
| `D1-05-A` | 현재 웹 v3을 서버 계약으로 고정하지 않고 P1-06 서버 문서 v1을 별도 정의 | 브라우저 상태와 영속 계약 분리 |
| `D1-05-B` | 모든 길이·좌표·각·연신 값은 canonical Decimal 문자열로 저장 | 부동소수 오차와 checksum 변동 방지 |
| `D1-05-C` | START/END는 segment가 아닌 block 구조로 변환 | sentinel 제거, 박스 구조 명확화 |
| `D1-05-D` | geometry를 line/arc로 구분하고 direction·sagitta를 입력으로 보존 | 곡선·수식 재생성 가능 |
| `D1-05-E` | `angtype`을 boundary + ordered `operations[]`로 분해 | A/ZERO/U·복합 타입을 손실 없이 표현 |
| `D1-05-F` | bend form과 V/A/NO-CUT 계산 정책을 성급히 동일시하지 않음 | 미확정 의미의 오변환 방지 |
| `D1-05-G` | 계산 제외를 junction 소유로 이동하고 양쪽 인접 구간에 적용 | 기존 승인 규칙과 의미 일치 |
| `D1-05-H` | 문서 입력과 계산·제작 결과를 분리하고 checksum으로 연결 | stale result 차단·재현성 확보 |
| `D1-05-I` | material rule revision ID와 당시 값 snapshot을 함께 보존 | 기준 변경 후에도 과거 계산 재현 |
| `D1-05-J` | 변수·수식은 원문+문법 버전을 보존하되 P1-11 parser 전 실행 금지 | MFC 평가기·임의 코드 실행 비계승 |
| `D1-05-K` | `operators/operand`, 패널은 예약 필드로 보존하되 P1-12/16 전 비활성 | 향후 기능 손실 없이 현재 범위 통제 |
| `D1-05-L` | 알 수 없거나 미지원인 레거시 행은 추측 변환하지 않고 격리·보고 | 이관 데이터 오염 방지 |

이 승인 결과가 P1-06의 공식 입력 기준선이다. 향후 일부 안을 변경하면 관련 필드와 변환 규칙을 수정하고 재승인한다.

## 12. 상세 실행 결과

| 단계 ID | 상태 | 작업 내용 | 산출물·검증 |
|---|---|---|---|
| `01` | `DONE` | 현재 `FoldProfile`·validation·serialization·calculation 조사 | 현재 입력·결과·기본값 표 작성 |
| `02` | `DONE` | Prisma 재질·템플릿·개정 모델 조사 | row metadata와 JSON document 경계 정의 |
| `03` | `DONE` | MFC 구조체·enum·계산·DB API 조사 | WorkType·AngleType 0~18·direction 확인 |
| `04` | `DONE` | 레거시 4개 핵심 테이블 필드·분포 대조 | 실제 line/angle 분포와 미지원 사례 반영 |
| `05` | `DONE` | 필드·enum·단위·기본값·오류 매핑 | 본 문서 3~10절 |
| `06` | `DONE` | 입력과 계산·제작 결과 경계 정의 | checksum 기반 결과 연결 원칙 |
| `07` | `DONE` | `D1-05-A~L` 사용자 결정 | 2026-07-24 전체 승인 |
| `08` | `DONE` | 승인 결과 반영·P1-06 입력 기준선 확정 | 상태 `DONE`, P1-06 착수 |

P1-05는 문서·계약 분석 작업이므로 Prisma migration, API, UI와 배포 변경은 없다.

## 13. 검증 계획과 완료 기준

| 검증 | 현재 결과 | 완료 기준 |
|---|---|---|
| 필드 누락 대조 | 완료 | 4개 레거시 테이블과 현재 웹 필드가 입력·결과·보존·제외로 분류됨 |
| enum 대조 | 완료 | WorkType 4개 실제 값, AngleType 0~18, direction 0~8 매핑 |
| 단위·Decimal | 완료 | mm/degree/m²/kg/KRW와 문자열/Prisma 형식 구분 |
| 범위 대조 | 완료 | 입면도 제외, 기계 연동 실제 통신 제외, 패널·제작 기능 후속 처리 |
| 계산 기준 대조 | 완료 | FIX 소수, 양쪽 제외, cut angle 미만 규칙 계승 |
| 사용자 결정 | 완료 | `D1-05-A~L` 전체 승인 |

- [x] 사용 필드의 출처와 의미가 정리됐다.
- [x] 기본값과 누락값 처리 원칙이 정리됐다.
- [x] 미지원 필드가 조용히 유실되지 않도록 처리 기준을 정했다.
- [x] P1-06이 구현할 계약 경계를 정리했다.
- [x] `D1-05-A~L`을 사용자가 승인했다.
- [x] 승인 결과를 반영해 P1-05를 `DONE`으로 전환했다.

## 14. 위험과 후속 작업

| 위험 | 대응 | 후속 |
|---|---|---|
| A/ZERO/U·복합 타입의 실제 표본 부족 | 표현은 보존하고 계산·게시를 차단 | P1-10 회귀 표본 승인 |
| 곡선 561건의 품질·좌표 일관성 미확인 | sagitta/radius/chord 차이 보고 | P1-12 곡선 계약·검증 |
| 패널 `ref_num` 의미와 편집 UX 미확정 | 예약 필드만 정의 | P1-12 사용자 결정 |
| MFC 수식 문법·오류 동작 불합리 | 원문만 보존, 안전 parser 별도 | P1-11 |
| 계산 결과와 입력 snapshot 혼용 | checksum·engine version으로 연결 | P1-06/07 및 주문 snapshot 작업 |
| 현재 number 기반 편집 코드와 Decimal 계약 차이 | adapter에서만 number 변환, 저장 직전 유효성 검증 | P1-06 |

## 15. 변경 기록

| 날짜 | 변경 내용 | 작성자 |
|---|---|---|
| 2026-07-24 | P1-04 후순위 전환에 따라 P1-05 즉시 착수, 전체 필드·enum·단위 매핑과 D1-05 권장안 작성 | 사용자 본인 |
| 2026-07-24 | D1-05-A~L 전체 승인, P1-05 완료와 P1-06 입력 기준선 확정 | 사용자 본인 |
