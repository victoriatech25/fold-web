# P1-06 — 절곡 문서 계약 v1

> 상태: `DONE`
>
> 우선순위: `P1`
>
> 담당자: 사용자 본인
>
> 검수자: 사용자 본인
>
> 관련 게이트: `D1-06`
>
> 계획 작성일: 2026-07-24
>
> 착수일: 2026-07-24
>
> 완료일: 2026-07-25
>
> 상위 계획: [P1 실행계획](./P1-execution-plan.md)
>
> 선행 기준선: [P1-05 절곡 필드·enum·단위 매핑](./P1-05-fold-field-mapping.md)
>
> MFC 참조 루트: `/Users/kyhoon/Library/Mobile Documents/com~apple~CloudDocs/회사/hicomtech/도면`

## 1. 목표와 사용자 결과

절곡 문서를 PostgreSQL JSONB에 저장하고 다시 읽을 때 의미·정밀도·checksum이 변하지 않는 서버 문서 계약 v1을 구현한다.

P1-06 완료 시 다음이 가능해야 한다.

```text
현재 브라우저 FoldProfile v3
→ 명시적 v3-to-server-v1 adapter
→ strict runtime validation
→ Decimal 문자열 정규화
→ canonical JSON + SHA-256
→ PostgreSQL JSONB 저장·복원 대조
→ 지원 기능과 예약 기능을 구분한 capability 판정
```

이 작업은 초안 CRUD와 자동 저장 UI를 만들지 않는다. P1-07이 이 계약을 사용해 서버 저장·복원·충돌 처리를 구현한다.

## 2. 승인된 선행 기준

- 현재 브라우저 `FoldProfile` schema v3과 서버 문서 schema v1은 별도 버전 축이다.
- 길이·좌표·각·연신 등 계산 Decimal은 JSON number가 아닌 canonical 문자열이다.
- START/END는 block 구조이며 geometry segment가 아니다.
- geometry는 line/arc이고 방향과 곡 깊이를 보존한다.
- 절곡은 ordered `operations[]`로 표현한다.
- 계산 제외는 junction 소유이며 절곡 양쪽 인접 구간에 적용한다.
- material rule revision과 당시 snapshot을 함께 보존한다.
- 편집 입력과 계산·제작 결과는 분리한다.
- A/ZERO/U·복합·패널·제작 annotation은 표현 가능하되 해당 기능 구현 전 실행을 차단한다.
- 알 수 없는 레거시 의미를 추측 변환하지 않는다.

## 3. 포함·제외 범위

### 포함

- TypeScript 문서 타입과 Zod v4 strict runtime schema
- Decimal 문자열 parser·canonicalizer·범위·scale 검증
- line/arc discriminated geometry와 junction operation 계약
- 구조 검증과 현재 지원 기능 판정의 분리
- project canonical JSON v1과 SHA-256 checksum
- 현재 브라우저 `FoldProfile` v3 → 서버 문서 v1 adapter
- 서버 문서 v1 → 현재 편집기 adapter의 무손실 가능 여부 검사
- 구조화된 오류 code·path·한국어 message
- schema version dispatch와 향후 migration chain 자리
- `FoldRevision` JSONB 왕복·schema version·checksum 통합 검증

### 제외

- 템플릿·초안 CRUD API와 repository
- 자동 저장, 낙관적 잠금, 오프라인 복구
- material rule 관리 UI
- A/ZERO/U·복합 절곡 계산
- 변수식 실행과 parser
- 곡선·패널 편집과 계산
- 계산 result snapshot Prisma 모델
- 레거시 PostgreSQL importer
- 입면도 문서 타입·필드·변환
- 기계 통신·전송과 제작 DXF

## 4. 현재 기반과 변경 판단

### 현재 코드

| 대상 | 현재 상태 | P1-06 처리 |
|---|---|---|
| `FoldProfile` | number 기반 schema v3 | 편집기 모델로 유지, 서버 계약과 adapter로 분리 |
| serialization | v1/v2→v3, shape 수동 검사 | 기존 로컬 호환 유지, 서버 문서에는 Zod schema 사용 |
| calculation | number 기반 FIX/RATIO | 이번 작업에서 계산 엔진을 Decimal로 재작성하지 않음 |
| Prisma | `FoldRevision.document`, version, checksum 보유 | schema 변경 없음 |
| material | revision Decimal 컬럼과 seed 존재 | snapshot 생성·row/document ID 일치 검증 입력 |
| Zod | v4.4.3 설치됨 | 새 계약의 단일 runtime source로 사용 |

### Prisma migration

`FoldRevision`에는 이미 다음 필드가 있다.

```text
materialRuleRevisionId
documentSchemaVersion
document JsonB
documentChecksumSha256 Char(64)
```

따라서 P1-06에서는 Prisma schema와 migration을 변경하지 않는다. 대신 통합 테스트에서 다음 불변조건을 검증한다.

- row `documentSchemaVersion`은 JSON root `schemaVersion`과 같다.
- row `materialRuleRevisionId`는 document material의 `ruleRevisionId`와 같다.
- row checksum은 복원 문서를 다시 canonicalize한 SHA-256과 같다.
- 다른 조직의 material rule revision을 결합할 수 없다.

## 5. 서버 문서 v1 구조

아래는 필드 이름과 중첩 구조의 기준이다. 실제 TypeScript type은 Zod schema에서 추론한다.

```json
{
  "schemaVersion": 1,
  "documentType": "normal",
  "name": "새 절곡 단면",
  "product": {
    "lengthMm": "1000",
    "quantity": 1
  },
  "material": {
    "ruleRevisionId": "00000000-0000-4000-8000-000000000000",
    "name": "기본 재질 1.0T",
    "thicknessMm": "1",
    "insideBendRadiusMm": "1",
    "cutAngleDeg": "135",
    "elongationMm": {
      "vCut": "1",
      "aCut": "1",
      "noCut": "1"
    },
    "cutDepthMm": {
      "vCut": "0",
      "aCut": "0",
      "noCut": "0"
    }
  },
  "calculation": {
    "mode": "fixed",
    "elongationOption": "standard",
    "vCutEnabled": true,
    "decimalPlaces": 0,
    "decimalOperation": "round"
  },
  "variables": [],
  "blocks": [
    {
      "id": "block-1",
      "name": "면 1",
      "order": 1,
      "segments": [
        {
          "id": "segment-1",
          "order": 1,
          "geometry": {
            "kind": "line",
            "start": { "xMm": "0", "yMm": "0" },
            "end": { "xMm": "100", "yMm": "0" },
            "direction": "e"
          },
          "nominalLengthMm": "100"
        }
      ]
    }
  ]
}
```

선택 필드는 존재할 때만 직렬화한다. `null`, 빈 문자열, 0 sentinel과 빈 placeholder 객체를 의미 없는 기본값으로 넣지 않는다.

## 6. 필드 계약

### 6.1 root·제품·재질

| 경로 | 형식 | 규칙 |
|---|---|---|
| `schemaVersion` | literal `1` | row version과 일치 |
| `documentType` | `normal/box/panel` | panel은 capability 차단 |
| `name` | string | trim 후 1~200자 |
| `product.lengthMm` | Decimal string | `>=0`; 완료·게시 검증에서는 `>0` |
| `product.quantity` | integer | `1..1,000,000` |
| `material.ruleRevisionId` | UUID | row FK와 일치 |
| `material.name` | string | snapshot 표시명 1~200자 |
| `thicknessMm` | Decimal string | `>0`, scale 최대 6 |
| `insideBendRadiusMm` | Decimal string | `>=0`, scale 최대 6 |
| `cutAngleDeg` | Decimal string | `0..180`, scale 최대 4 |
| `elongationMm.*` | Decimal string | 음수 허용, scale 최대 6 |
| `cutDepthMm.*` | Decimal string | `>=0`, scale 최대 6 |

snapshot 이름은 표시와 export를 위한 값이며 조직·재질 master를 대체하지 않는다. 서버 저장 시 material revision에서 snapshot을 생성하고 클라이언트가 보낸 이름·규칙값을 신뢰하지 않는다.

### 6.2 계산·변수·수식

| 경로 | 형식 | 규칙 |
|---|---|---|
| `calculation.mode` | `fixed/ratio` | 필수 |
| `elongationOption` | `standard/two-line/diagonal/ext1` | standard 외 capability 차단 |
| `vCutEnabled` | boolean | 필수 |
| `decimalPlaces` | integer | `0..6` |
| `decimalOperation` | `none/round/floor/ceil` | 필수 |
| `variables[]` | `{name,valueMm}` | 이름 trim 1~64자, exact duplicate 금지, 최대 256개 |
| `productExpression` | 선택 객체 | `enabled`, `grammarVersion`, `source`; P1-11 전 실행 금지 |
| `lengthExpression` | 선택 객체 | `grammarVersion`, `source`; P1-11 전 실행 금지 |

표현식 source는 1~512자, grammar version은 안정적인 영문 key 1~32자로 제한한다. 계약은 원문을 저장할 뿐 P1-11 전에는 계산하지 않는다.

### 6.3 block·segment·geometry

| 경로 | 형식 | 규칙 |
|---|---|---|
| `blocks` | array | 1~64개, order 1부터 연속, ID unique |
| `block.id` | local ID | 1~80자 영문·숫자·`-`·`_`, document 전체 unique |
| `block.name` | string | trim 후 1~100자 |
| `block.refNum` | 선택 positive integer | panel 예약 기능 |
| `segments` | array | block별 0~1,000개, 문서 총합 최대 1,000개 |
| `segment.id/order` | local ID/integer | document 전체 unique, block 안 order 연속 |
| `geometry.kind` | `line/arc` | discriminated union |
| `start/end.xMm/yMm` | Decimal string | 음수 허용, scale 최대 6 |
| `direction` | 9종 enum | `none,n,ne,e,se,s,sw,w,nw` |
| `arc.side` | `left/right` | arc 필수 |
| `arc.sagittaMm` | Decimal string | `>0`; arc 필수 |
| `nominalLengthMm` | Decimal string | `>0` |
| `segmentCorrectionOverrideMm` | 선택 Decimal string | 음수 허용 |
| `manufacturingAnnotation` | 선택 예약 객체 | P1-16 전 capability 차단 |

인접 segment의 이전 `end`와 다음 `start`가 exact Decimal 기준으로 같지 않으면 구조 오류로 처리한다. geometry 허용 오차에 따른 자동 접합은 편집 명령의 책임이며 parser가 입력을 수정하지 않는다.

### 6.4 junction

| 경로 | 형식 | 규칙 |
|---|---|---|
| `junctionAfter.angleDeg` | Decimal string | `0..180`, scale 최대 4 |
| `calculateElongation` | boolean | 누락 금지, adapter가 기존 누락을 `true`로 명시 |
| `cutType` | `v-cut/a-cut/no-cut` | 계산 컷 정책, operation form과 별도 |
| `operations` | array | 1~2개, 순서 보존 |
| `operation.direction` | `front/back` | 필수 |
| `operation.form` | `standard/a/zero/u` | standard만 현재 계산 가능 |

마지막 segment에는 `junctionAfter`가 없어야 한다. 같은 junction의 두 operation은 동일한 `direction+form` 조합을 중복할 수 없다. `cutType`은 현재 웹 계산의 V/A/NO-CUT 정책이고 `form`은 MFC 각 타입에서 분리한 절곡 형태이므로 서로 자동 변환하지 않는다.

## 7. Decimal 문자열 정책

### canonical 형식

- 선택적 `-`, 정수부, 선택적 소수부만 허용한다.
- 입력 parser는 선행 0·후행 소수 0·`-0`을 받을 수 있지만 반환 객체에는 각각 제거된 canonical 값만 남긴다.
- `+`, 지수 표기와 숫자 뒤의 소수점은 거부한다.
- 예를 들어 `-0.0`은 `0`, `1.2300`은 `1.23`, `001`은 `1`로 정규화한다.
- 허용 scale을 넘는 값은 반올림하지 않고 오류로 거부한다.
- 길이 계열은 PostgreSQL `numeric(18,6)`, 각도는 `numeric(9,4)` 범위와 일치시킨다.

### number adapter

현재 편집기는 number 기반이므로 adapter에서만 변환한다.

- number가 finite가 아니면 거부한다.
- 과학 표기와 binary 부동소수 흔적을 canonical Decimal로 조용히 저장하지 않는다.
- 서버 Decimal을 number로 바꾼 뒤 canonical 문자열로 되돌렸을 때 원문과 달라지는 값은 `LOSSY_NUMBER_CONVERSION`으로 거부한다.
- 운영 승인 계산과 저장 원본은 string Decimal이며 number는 화면 편집용 표현이다.

정확한 Decimal 산술과 반올림 helper는 P1-09에서 구현한다.

## 8. runtime schema와 오류 계약

### Zod v4

- 모든 object는 strict schema로 정의해 오타·미승인 필드를 거부한다.
- line/arc는 `kind` discriminated union이다.
- TypeScript type은 `z.infer`로 생성해 수동 type과 runtime schema 불일치를 막는다.
- parser는 입력 객체를 mutate하지 않고 새 canonical 객체를 반환한다.
- schema version을 먼저 판독한 뒤 해당 version parser로 dispatch한다.
- 알 수 없는 미래 version은 `UNSUPPORTED_SCHEMA_VERSION`으로 거부한다.

### 오류 형식

```ts
type FoldDocumentIssue = {
  code: string;
  path: Array<string | number>;
  message: string;
  severity: "error" | "warning";
};
```

대표 code:

- `INVALID_DOCUMENT`
- `UNSUPPORTED_SCHEMA_VERSION`
- `UNKNOWN_FIELD`
- `INVALID_DECIMAL`
- `DECIMAL_SCALE_EXCEEDED`
- `DUPLICATE_ID`
- `NON_SEQUENTIAL_ORDER`
- `DISCONNECTED_SEGMENT`
- `INVALID_LAST_JUNCTION`
- `UNSUPPORTED_CAPABILITY`
- `LOSSY_NUMBER_CONVERSION`
- `DOCUMENT_TOO_LARGE`
- `CHECKSUM_MISMATCH`

오류에는 raw document, 수식 전체, 개인정보와 서버 내부 stack을 넣지 않는다.

## 9. 구조 검증과 capability 검증

두 검증을 분리한다.

### 구조 검증

저장·복원·향후 migration이 가능한지를 판정한다.

- strict field와 enum
- Decimal·범위·scale
- ID·order·연결성
- block 수·segment 수·canonical byte 크기
- material snapshot과 필수 설정

### capability 검증

현재 실행하려는 행위가 구현돼 있는지를 판정한다.

| capability | P1-06 판정 |
|---|---|
| normal + line + standard single bend + 현재 cut type | `supported` |
| box + line + standard single bend + 현재 cut type | 현재 계산·전개 범위에서 `supported` |
| arc | `reserved`, P1-12 전 계산·게시·DXF 차단 |
| panel/refNum | `reserved`, P1-12 전 차단 |
| A/ZERO/U 또는 복합 operation | `reserved`, P1-10 전 계산·게시 차단 |
| two-line/diagonal/ext1 | `reserved`, P1-10 전 차단 |
| expression 존재 | `reserved`, P1-11 전 평가·게시 차단 |
| manufacturing annotation | `reserved`, P1-16 전 출력 차단 |

예약 기능을 포함한 문서는 초안으로 parse·보존할 수 있지만 현재 엔진으로 계산 완료됐다고 표시할 수 없다.

## 10. canonical JSON과 checksum

### project canonical JSON v1

- object key는 Unicode code point 기준 오름차순으로 정렬한다.
- array 순서는 업무 의미이므로 유지한다.
- string, boolean, null과 정수 JSON number만 JSON 규칙으로 직렬화한다.
- 계산 Decimal은 모두 string이므로 JSON number 정밀도에 의존하지 않는다.
- `undefined`, `NaN`, `Infinity`, 함수, symbol과 sparse array는 거부한다.
- 공백·개행 없이 UTF-8 bytes를 생성한다.
- 원본 key 입력 순서와 PostgreSQL JSONB key 순서에 영향을 받지 않는다.

전체 server document root를 canonicalize하며 `schemaVersion`, 이름, material rule ID·snapshot과 geometry가 checksum에 포함된다. 조직, `FoldRevision` row ID·상태·작성자·시각은 문서 밖이므로 포함되지 않는다.

### checksum

```text
SHA-256(UTF-8(projectCanonicalJsonV1(document)))
```

결과는 소문자 64자리 hex다. 저장 전에 계산하고 복원 후 다시 계산해 row 값과 비교한다. checksum 불일치는 자동 수정하지 않고 읽기 실패·운영 오류로 처리한다.

## 11. migration과 adapter

### 서버 문서 version

- v1 parser와 canonicalizer를 구현한다.
- `migrateFoldDocumentToCurrent(input)` dispatch를 마련한다.
- 현재는 v1→v1 identity만 지원한다.
- 미래 v2가 생기면 원문을 mutate하지 않는 v1→v2 순차 migration과 fixture를 추가한다.
- 지원 종료 version도 원본 checksum과 migration 결과 checksum을 각각 기록할 수 있게 한다.

### 브라우저 v3 adapter

`FoldProfile` v3은 서버 schema v1의 과거 version이 아니므로 server migration chain에 넣지 않는다.

- `browserFoldProfileV3ToServerDocumentV1(profile, materialRuleRevisionId)`
- `serverDocumentV1ToBrowserFoldProfileV3(document)`

변환 원칙:

- `normal/box`, line, 단일 front/back bend를 변환한다.
- 현재 `v-cut/a-cut/no-cut`은 `junctionAfter.cutType`에 그대로 보존하고, 단일 `front/back` 방향은 `operations[0].direction`으로, `form`은 `standard`로 변환한다. cut type과 bend form은 자동 동일시하지 않는다.
- 현재 `calculateElongation` 누락은 `true`로 명시한다.
- `elongationOverride`는 `segmentCorrectionOverrideMm`으로 변환한다.
- 현재 profile·block·segment local ID는 허용 문자·길이 검증 후 보존한다.
- `createdAt/updatedAt/profile.id`는 server document에 넣지 않는다.
- 서버 문서의 arc·panel·복합·수식 등 현재 편집기가 무손실 표현하지 못하는 기능은 역변환을 거부한다.

## 12. 보안·운영 영향

- P1-06은 route가 없으므로 인증·권한 변화가 없다.
- parser는 최대 canonical document `2 MiB`, block 64개, 총 segment 1,000개를 넘으면 거부한다.
- 수식은 저장만 하고 실행하지 않는다.
- checksum 비교는 손상 탐지 목적이며 전자서명·사용자 인증을 대체하지 않는다.
- 문서 원문 전체를 application log나 audit payload에 기록하지 않는다.
- P1-07은 저장 성공 시 checksum·schema version·revision ID만 감사 payload에 기록한다.
- SQLite·레거시 PostgreSQL 연결은 runtime 계약에 없다.

## 13. 테스트 계획

| 종류 | 핵심 사례 | 완료 기준 |
|---|---|---|
| 단위: Decimal | 정수·소수·음수·-0·leading/trailing zero·지수·scale·범위 | canonical 결과와 오류 code 일치 |
| 단위: schema | line/arc, junction, strict unknown, duplicate ID/order, 연결성 | 경로가 있는 구조 오류 |
| 단위: capability | normal/box와 모든 예약 기능 조합 | parse와 실행 가능 판정 분리 |
| 단위: canonical | key 순서·공백·JSONB 순서가 다른 동치 문서 | 동일 canonical bytes/checksum |
| 단위: checksum | 한 글자·Decimal·배열 순서 변경 | checksum 변경, 고정 fixture 재현 |
| adapter | 현재 v3 normal/box, 계산 제외, override, material snapshot | 허용 입력 무손실, 손실 입력 명시 거부 |
| migration | v1 identity, 미지·누락 version | 원문 불변·명시 오류 |
| PostgreSQL·Prisma | JSONB insert/read, row version·material ID·checksum | 로컬 PostgreSQL 왕복 일치 |
| 회귀 | 기존 `FoldProfile`·WEB-REFERENCE 테스트 | 기존 동작 변화 없음 |
| 보안 | 2 MiB·1,000 segment·긴 수식·unknown field | 제한 초과 조기 거부 |
| E2E·시각 | 해당 없음 | P1-06은 route/UI 없음 |

## 14. 상세 실행 단계

| 단계 | 상태 | 작업 | 종료 검증 |
|---|---|---|---|
| `01` | `DONE` | P1-05 승인 기준·현재 코드·Prisma 확인 | 본 문서 2~4장 |
| `02` | `DONE` | D1-06-A~L 상세 계약과 결정 | 2026-07-24 사용자 전체 승인 |
| `03` | `DONE` | Decimal parser·normalizer·테스트 | scale·range·canonical 시험 통과 |
| `04` | `DONE` | Zod v1 schema·교차 필드 validation | 구조·limit·오류 path 시험 통과 |
| `05` | `DONE` | capability validator | 예약 기능 조합 시험 통과 |
| `06` | `DONE` | canonical JSON·SHA-256 | deterministic fixture 시험 통과 |
| `07` | `DONE` | server version dispatch·migration 자리 | v1·미지 version 시험 통과 |
| `08` | `DONE` | browser v3 양방향 adapter | normal/box·손실 거부 시험 통과 |
| `09` | `DONE` | Prisma JSONB 왕복 통합 시험 | version·material ID·checksum 일치 |
| `10` | `DONE` | lint·typecheck·unit·integration·build | 필수 로컬 CI 통과 |
| `11` | `DONE` | 문서·사용자 검수 | 2026-07-25 사용자 완료 승인 |

## 15. D1-06 결정 게이트 — 승인 결과

2026-07-24 사용자가 `D1-06-A~L` 권장안 전체를 승인했다.

| ID | 권장안 | 영향 |
|---|---|---|
| `D1-06-A` | Zod v4 strict schema를 runtime 계약의 단일 source로 사용하고 TypeScript type을 추론 | type/schema 불일치와 unknown field 방지 |
| `D1-06-B` | 본 문서 5~6장의 server document v1 구조와 이름을 채택 | P1-07 이후 영속 계약 고정 |
| `D1-06-C` | Decimal은 canonical 문자열, 길이 scale 6·각도 scale 4로 하고 초과 정밀도는 반올림 없이 거부 | P0 정밀도 기준 계승 |
| `D1-06-D` | strict 구조 검증과 capability 검증을 분리해 예약 기능은 초안 보존하되 계산·게시·출력을 차단 | 미래 데이터 보존과 현재 안전성 양립 |
| `D1-06-E` | project canonical JSON v1의 정렬·UTF-8 규칙과 전체 문서 SHA-256을 사용 | JSONB key 순서와 무관한 checksum |
| `D1-06-F` | 현재 브라우저 v3은 server migration이 아닌 명시적 양방향 adapter로 연결 | 서로 다른 version 축 혼동 방지 |
| `D1-06-G` | junction의 계산 `cutType(v-cut/a-cut/no-cut)`과 operation의 절곡 `form(standard/a/zero/u)`을 별도 필드로 두고, 현재 v3은 cutType을 그대로 보존하며 form은 standard로 변환 | D1-05-F 준수와 의미 추정 없는 adapter |
| `D1-06-H` | 역 adapter가 arc·panel·복합·수식 등 현재 UI 미표현 의미를 만나면 손실 변환하지 않고 거부 | 저장 후 기능 유실 방지 |
| `D1-06-I` | row schema version·material rule ID·checksum과 JSON document 일치를 application service 불변조건으로 강제 | 중복 참조 불일치 방지 |
| `D1-06-J` | 2 MiB, block 64개, 총 segment 1,000개, 수식 512자 제한 | 성능 기준과 자원 고갈 방어 |
| `D1-06-K` | 오류는 code·path·한국어 message로 반환하고 raw 문서·수식 전체를 로그·감사에 남기지 않음 | UI 표시·보안·관측성 일관성 |
| `D1-06-L` | 기존 Prisma 필드로 충분하므로 migration 없이 코드·단위·PostgreSQL 왕복 시험으로 완료 | 불필요한 DB 변경 회피 |

`D1-06-G`에 따라 기존 UI의 `no-cut`과 레거시 `ZERO`는 서로 다른 의미로 유지한다. A/ZERO/U·복합 form의 계산·제작 의미는 P1-10에서 실제 표본과 함께 승인한다.

## 16. 완료 기준

- [x] `D1-06-A~L`을 사용자가 승인했다.
- [x] server document v1 type과 strict runtime schema가 한 source에서 생성된다.
- [x] Decimal canonical·scale·범위·오류 정책이 테스트된다.
- [x] 구조 검증과 capability 검증이 분리된다.
- [x] canonical JSON과 SHA-256이 순서·환경과 무관하게 재현된다.
- [x] 현재 browser v3의 허용 범위가 adapter로 변환되고 손실 입력은 거부된다.
- [x] unknown schema와 미래 기능을 조용히 제거하지 않는다.
- [x] Prisma JSONB 왕복에서 version·material ID·checksum이 일치한다.
- [x] 기존 FoldProfile·WEB-REFERENCE 회귀가 유지된다.
- [x] lint·typecheck·unit·integration·build가 통과한다.
- [x] 관련 구현·검증 문서가 갱신됐다.
- [x] 사용자가 P1-06 완료를 승인했다.

## 17. 구현 산출물과 검증 결과

### 구현 산출물

| 영역 | 위치 | 결과 |
|---|---|---|
| 문서 오류·Decimal·canonical JSON | `src/domain/fold-document/errors.ts`, `decimal.ts`, `canonical.ts` | 구조화 오류, 무반올림 Decimal 정규화, 결정적 직렬화 |
| strict schema·capability | `src/domain/fold-document/schema.ts`, `capabilities.ts` | server document v1 parse와 현재 실행 가능 범위 분리 |
| browser v3 adapter | `src/domain/fold-document/adapter.ts` | normal/box 양방향 변환과 손실 가능 입력 거부 |
| checksum | `src/server/fold-document/checksum.ts` | project canonical JSON v1 기반 SHA-256 생성·비교 |
| material snapshot | `src/server/fold-document/material-snapshot.ts` | 동일 조직의 게시된 material rule revision만 서버 snapshot으로 해석 |
| row/document 불변조건 | `src/server/fold-document/revision-contract.ts` | schema version·material rule ID·checksum 일치 강제 |
| 자동 시험 | `src/domain/fold-document/fold-document.test.ts`, `src/server/fold-document/*.test.ts` | 단위·PostgreSQL JSONB 왕복·변조 거부 시험 |

### 2026-07-25 자동 검증

| 명령 | 결과 |
|---|---|
| `npm run typecheck` | 통과 |
| `npm run lint` | 통과 |
| `npm test` | 20개 파일 통과, 단위 135건 통과·DB 통합 24건 기본 실행 제외 |
| `npm run test:integration` | 5개 파일, PostgreSQL 통합 24건 통과 |
| `npm run build` | Next.js production build 통과 |
| `npm run db:validate` | Prisma schema 검증 통과 |
| `npm run db:migrate:check` | schema 차이 없음 |
| `git diff --check` | 공백 오류 없음 |

P1-06은 route와 UI를 추가하지 않으므로 별도 화면 검수 항목은 없다. 사용자는 본 문서의 계약·제외 범위·검증 결과를 확인해 완료 여부를 승인한다. 화면에서 저장·복원·충돌을 직접 검수하는 단계는 P1-07이다.

## 18. 변경 기록

| 날짜 | 변경 내용 | 작성자 |
|---|---|---|
| 2026-07-24 | D1-05 승인 기준을 이어 server document v1 구조·Decimal·canonical JSON·adapter·검증 계획 작성 | 사용자 본인 |
| 2026-07-24 | D1-06-A~L 권장안 전체 승인 | 사용자 본인 |
| 2026-07-25 | server document v1 계약·adapter·checksum·JSONB 불변조건 구현과 자동 검증 완료, 사용자 완료 검수로 전환 | 사용자 본인 |
| 2026-07-25 | 사용자 완료 승인, P1-06 `DONE` 확정과 P1-07 착수 | 사용자 본인 |
