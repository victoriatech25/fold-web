# P0-06 — Golden master v1 구축

> 상태: `DONE`
>
> 우선순위: `P0`
>
> 담당자: 사용자 본인
>
> 검수자: 사용자 본인
>
> 관련 게이트: `G0`, `D0-06`
>
> 계획 작성일: 2026-07-19
>
> 착수일: 2026-07-19
>
> 완료일: 2026-07-19
>
> 상위 계획: [fold_web 전체 프로젝트 작업계획서](../project-work-plan.md)
>
> P0 실행계획: [P0 실행계획](./P0-execution-plan.md)

## 1. 목표

Windows MFC 실행 환경 없이 MFC 코드, 실제 참조 PostgreSQL의 비식별 분포, 기존 DXF, 실제 제작 규칙과 현재 웹 구현을 함께 비교할 수 있는 재현 가능한 `WEB-REFERENCE` 표본 20건을 만든다.

Golden master는 MFC 결과를 무조건 복제하기 위한 기준이 아니다. Windows 실행 관찰값이 없으므로 v1은 다음 값을 구분한다.

- `observedLegacy`: v1에서는 `null`. 추후 재현 가능한 관찰값이 생길 때만 기록
- `proposedExpected`: 승인 전 코드 분석과 웹 규칙으로 계산했던 제안 기대값
- `approvedExpected`: 사용자가 직접 검증해 승격한 웹 공식 기대값

현재 fixture와 자동 테스트는 20건 모두 `approvedExpected`를 검증한다.

## 2. 참조 위치와 실행 제약

MFC 프로젝트:

```text
/Users/kyhoon/Library/Mobile Documents/com~apple~CloudDocs/회사/hicomtech/도면
```

실행 파일:

```text
/Users/kyhoon/Library/Mobile Documents/com~apple~CloudDocs/회사/hicomtech/도면/Release/folddraw3.exe
```

`folddraw3.exe`는 Windows Intel 80386용 PE32 실행 파일이다. 현재 macOS 개발 환경에서는 직접 실행할 수 없으며, 로그인과 업무 DB 연결에는 기존 Windows 운영 환경이 필요할 수 있다.

사용자는 Windows 실행 환경이 없음을 확인하고 `WEB-REFERENCE` 20건과 비식별 fixture 저장을 승인했다. 실제 MFC 참조 PostgreSQL 조사 결과는 [MFC 참조 PostgreSQL 조사](./P0-03-legacy-postgresql-reference.md)를 사용한다.

## 3. 현재 확보된 비교 자산

### 3.1 웹 단위 테스트

현재 웹 코드에는 다음 계산·전개 검증이 있다.

| 영역 | 확보된 검증 |
|---|---|
| 레거시 반올림 | 양수·음수 half-away-from-zero, 소수 첫째 자리 |
| FIX 연신 | 직선, 앞각, 뒷각, V-CUT 비활성, 수동 보정 |
| RATIO 연신 | 앞각, cut angle 경계 이상 미적용 |
| 제품 계산 | 전개 폭, 길이, 개당·전체 면적 |
| 일반 전개 | 누적 절곡선, V/A/NO-CUT 표시 |
| 박스 전개 | 두 기준선, 네 측면, 전개 외곽선 |

이는 구현 회귀 테스트이며 MFC 실행 결과로 수집한 golden master는 아니다.

### 3.2 레거시 DXF

`Debug/export_dxf`에서 DXF 35개가 확인됐다.

```text
/Users/kyhoon/Library/Mobile Documents/com~apple~CloudDocs/회사/hicomtech/도면/Debug/export_dxf
```

현재 상태:

- 17개는 로컬에 내려받아져 파일 형식·checksum·entity를 읽을 수 있다.
- 18개는 iCloud `dataless` 상태여서 원문을 읽으려면 다운로드가 필요하다.
- 모두 AutoCAD DXF 계열 파일이며, 확인한 표본은 주로 `LINE` entity와 용도별 layer를 사용한다.
- `250401-03-B-box-1`부터 `box-5`까지 박스형 다중 출력 표본이 존재한다.
- 입력 재질, 두께, 각, 연신, 계산 중간값과 원본 주문이 함께 보존돼 있지 않다.

따라서 이 35개는 DXF writer 호환성의 `OUTPUT_ONLY_REFERENCE`로 분류한다. 계산 golden master로 승격하려면 해당 입력을 다시 확보하거나 MFC에서 같은 입력으로 재실행해야 한다.

읽기 완료한 대표 출력:

| 파일 | 크기 | entity | 확인 용도 |
|---|---:|---|---|
| `20250331-111.dxf` | 11,175 | `LINE` 8 | 단순 형상·layer |
| `20250331-121.dxf` | 11,401 | `LINE` 10 | 단순 형상 변형 |
| `250331-10-A.dxf` | 25,151 | `LINE` 79 | 다중 layer·상세 출력 |
| `250331-10-B.dxf` | 24,451 | `LINE` 76 | 다중 layer·상세 출력 |
| `250331-10-C.dxf` | 19,236 | `LINE` 49 | 다중 layer·상세 출력 |
| `250401-01-A.dxf` | 27,644 | `LINE` 90 | 큰 entity 수 |

원본 파일은 현재 웹 저장소로 복사하지 않았다.

## 4. 구현된 20건 표본 매트릭스

| ID | 필수 시나리오 | 핵심 입력·경계 | 수집 결과 |
|---|---|---|---|
| `WR-001` | 직선 기준 | 절곡 없는 1개 선 | 구간 길이·전개 폭 |
| `WR-002` | FIX 앞각 V | 90도, 앞, V-CUT | 자동 보정·양쪽 구간 |
| `WR-003` | FIX 뒷각 V | 90도, 뒤, V-CUT | 음수 기여·양쪽 구간 |
| `WR-004` | FIX 앞각 A | A 연신 `0.8` | 소수 보존, 폭 `148.4` 승인 |
| `WR-005` | FIX 뒷각 A | A 연신 `0.8` | 소수 보존, 폭 `151.6` 승인 |
| `WR-006` | FIX NO-CUT | V-CUT 비활성 | NO-CUT 값 대체 |
| `WR-007` | FIX 소수 연신 | V 연신 `0.4` | 소수 보존, 폭 `149.2` 승인 |
| `WR-008` | 앞·뒤 혼합 | 3개 선, 방향 교대 | 인접 기여 합산 |
| `WR-009` | RATIO 앞각 | 두께·V 컷깊이 | `두께 - 컷깊이` |
| `WR-010` | RATIO 뒷각 | 두께·컷깊이 | 음수 컷깊이 |
| `WR-011` | cut angle 미만 | `134 < 135` | 보정 적용 |
| `WR-012` | cut angle 동일 | `135 = 135` | 경계 미적용 |
| `WR-013` | cut angle 초과 | `136 > 135` | 미적용 |
| `WR-014` | 수동 연신 | 첫 구간 override `3` | 자동값·적용값 병기 |
| `WR-015` | 계산 제외 | 첫 절곡 계산 제외 | 양쪽 인접 구간 제외 승인 |
| `WR-016` | 정수 반올림 | RATIO `.5` | 구간별 반올림 |
| `WR-017` | 소수 처리 없음 | RATIO 원값 보존 | 중간값 보존 |
| `WR-018` | 정수 버림 | RATIO `.5` | 구간별 버림 |
| `WR-019` | 정수 올림 | V 컷깊이 `0.2` | 구간별 올림 |
| `WR-020` | 박스 합산 | 2개 블록 | 블록 경계 비연결 합산 |

fixture는 [`web-reference-v1.json`](../../src/domain/fixtures/web-reference-v1.json), 자동 테스트는 [`web-reference.test.ts`](../../src/domain/web-reference.test.ts), 업무 검수는 [사용자 검수표](./P0-06-user-validation.md)에서 관리한다.

실제 참조 PostgreSQL 분포상 6·8·10·12선 항목이 많고 곡선 후보 561개, 계산 제외 선 518개가 존재한다. v1 승인 후 이 분포를 HMAC-SHA-256으로 비식별 선별해 100건 확대 세트에 반영한다.

## 5. 표본별 수집 항목

### 5.1 식별·출처

- `caseId`, 제목, 설명
- 원본 시스템과 MFC build 식별자
- 수집 일시와 수집자
- 원본 주문·거래처 대신 비식별 source key
- 입력·출력 파일 SHA-256

### 5.2 입력

- 재질, 두께, 내부 반경, cut angle
- V/A/NO-CUT 연신값과 컷 깊이
- 계산 방식 FIX/RATIO와 옵션
- 소수 자리·반올림 방식
- 제품 길이와 수량
- 블록별 선·호, 길이, 방향, 각 타입, 각도
- 변수, 수식, 계산 제외, 수동 연신

### 5.3 중간값

- 절곡별 자동 기여값
- 이전·다음 절곡의 구간별 기여
- 구간별 자동 보정·수동 보정·적용 보정
- 반올림 전후 구간 길이
- 변수 평가 순서와 수식 결과
- 박스 기준선과 전개 panel

### 5.4 결과

- 입력 길이 합계와 계산 전개 폭
- 제품 길이, 개당·총 면적, 중량과 금액
- 전개 outline·절곡선·layer
- DXF version, 단위, entity, bounding box, checksum
- MFC 오류·경고·수동 보정 여부

## 6. 중립 fixture 계약

```json
{
  "schemaVersion": 1,
  "caseId": "GM-001",
  "source": {
    "kind": "mfc-observation",
    "build": "확인 필요",
    "capturedAt": "ISO-8601",
    "inputSha256": "hex"
  },
  "input": {
    "material": {},
    "calculation": {},
    "product": {},
    "blocks": []
  },
  "observedLegacy": {
    "segments": [],
    "totals": {},
    "artifacts": []
  },
  "approvedExpected": {
    "segments": [],
    "totals": {},
    "artifacts": []
  },
  "difference": {
    "classification": "UNRESOLVED",
    "reason": "",
    "approvedBy": null,
    "approvedAt": null
  }
}
```

실제 fixture에는 거래처명, 담당자, 전화번호, 주소, 메모, 서버 연결 정보와 계정 정보를 넣지 않는다.

## 7. 차이 판정

| 유형 | 의미 | 테스트 기대값 |
|---|---|---|
| `PARITY_REQUIRED` | 레거시 결과가 유효하고 유지 필요 | MFC 결과와 승인 허용 오차 내 일치 |
| `LEGACY_DEFECT` | MFC 계산·구성 오류 | 수정된 `approvedExpected` 검증 |
| `WEB_IMPROVEMENT` | 웹 편의·안전·가시성 개선 | 승인된 웹 동작 검증 |
| `RULE_CHANGE` | 업무 규칙을 의도적으로 변경 | 변경 규칙 버전의 기대값 검증 |
| `UNRESOLVED` | 아직 결론이 없는 차이 | 릴리스 게이트 통과 불가 |

## 8. 수집·비식별화 절차

1. MFC 코드와 실제 참조 PostgreSQL의 타입·선 수·곡선·계산 제외 분포를 읽기 전용으로 조사한다.
2. 고객·현장·주문 식별정보 없이 계산 경계를 표현하는 합성 입력을 만든다.
3. 코드에서 확인된 계산으로 `proposedExpected`를 작성한다.
4. fixture의 개인정보 금지 문자열, 20개 unique ID와 자동 계산 재현을 테스트한다.
5. 사용자가 구간별 계산값·전개 폭·차이 유형을 직접 검증한다.
6. 승인 결과를 `approvedExpected`와 `verification.status=approved`로 반영한다.
7. 실제 레거시 표본을 추가할 때 source key는 저장소 밖 secret salt의 HMAC-SHA-256으로 바꾼다.
8. DXF 원본은 내부 TEXT와 metadata 비식별 검사를 통과하기 전 저장소에 복사하지 않는다.

## 9. 현재 차단 사항과 대체 경로

### 경로 A — Windows MFC 실행 가능

실제 MFC에서 20건을 재실행해 `observedLegacy`를 수집한다. 가장 높은 비교 신뢰도를 제공하므로 우선 권장한다.

### 경로 B — Windows MFC 실행 불가 — `선택됨`

MFC 코드·SQLite 템플릿·기존 DXF를 참고하되 MFC 실행 결과 수집을 강제하지 않는다. 표본 이름을 `WEB-REFERENCE`로 바꾸고, 실제 제작 규칙과 사용자가 승인한 기대값을 기준으로 20건을 구성한다. 기존 DXF는 출력 호환성 참고 자료로만 유지한다.

사용자가 경로 B, 비식별 fixture 저장과 직접 검수를 승인했다. 레거시 코드의 계산 오류를 복제하지 않으며, 이후 현장 제작 결과가 확보되면 비교 증거를 추가한다.

## 10. 상세 실행 결과

| 단계 ID | 상태 | 작업 내용 | 검증 |
|---|---|---|---|
| `01` | `DONE` | 각 타입·연신·경계·곡선·박스 20건 매트릭스 작성 | 미구현 규칙 포함 여부 확인 |
| `02` | `DONE` | 개인정보 비식별화 규칙 작성 | 금지 필드 목록 확인 |
| `03` | `DONE` | WEB-REFERENCE 20건 입력·중간값·승인 결과 작성 | fixture 20건 |
| `04` | `PARTIAL` | 기존 DXF 자산·로컬 상태 확인 | 35개 발견, 17개 읽기 가능 |
| `05` | `DONE` | 차이 분류 형식 정의 | 5개 분류와 릴리스 처리 정의 |
| `06` | `DONE` | MFC 오류 후보 판정 절차 정의 | 승인 기대값 분리 |
| `07` | `DONE` | 재실행·비식별화 절차 정의 | 단계별 기록 항목 확인 |
| `08` | `DONE` | 중립 JSON fixture와 자동 테스트 작성 | 21개 테스트 통과 |
| `09` | `DONE` | 사용자 직접 검수와 승인 기대값 작성 | 20건 전체 승인 |
| `10` | `DONE` | 100건 확대 원칙 기록 | P1 회귀 확대와 연결 |

## 11. 사용자 결정 결과와 남은 검수

- Windows 실행 환경 없음
- `WEB-REFERENCE` 20건으로 진행
- 비식별 테스트 자료 저장 승인
- 관련 업무 검증은 사용자 본인이 직접 수행
- 나머지 표본 전체 승인
- FIX 소수 연신 보존
- 계산 제외 절곡은 양쪽 인접 구간 모두에서 제외
- RATIO 계산은 `angle < cutAngle`일 때만 적용

승인 결과와 표본별 값은 [WEB-REFERENCE v1 사용자 검수표](./P0-06-user-validation.md)에 기록했다.

## 12. 완료 기준

- [x] 20개 표본 매트릭스가 정의됐다.
- [x] 중립 fixture 계약과 비식별화 절차가 정의됐다.
- [x] 기존 DXF의 사용 가능 범위가 판정됐다.
- [x] WEB-REFERENCE 20건의 입력·중간값·승인 결과가 확보됐다.
- [x] 모든 차이가 판정되고 `approvedExpected`가 승인됐다.
- [x] 20건을 자동 재실행할 수 있다.

## 13. 변경 기록

| 날짜 | 변경 내용 | 작성자 |
|---|---|---|
| 2026-07-19 | 웹 테스트·MFC 실행 파일·DXF 자산 조사, 20건 매트릭스와 fixture 계약 작성 | 사용자 본인 |
| 2026-07-19 | Windows 미사용, WEB-REFERENCE·비식별 저장·사용자 직접 검수 결정 반영 | 사용자 본인 |
| 2026-07-19 | 실제 참조 PostgreSQL 분포 반영, fixture 20건과 자동 테스트·검수표 작성 | 사용자 본인 |
| 2026-07-19 | 20건 전체 승인, FIX 소수 보존·절곡 양쪽 계산 제외·cut angle 미만 규칙 반영 | 사용자 본인 |
