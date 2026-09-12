# P2-B11 — 그룹재단 (재단 배치 편집기와 원판별 장비용 DXF)

> 상태: `READY` — 2026-09-12 사용자 결정 `A~H` 완료, 상세 설계(4절) 작성. 착수 조건: MFC 실제 DXF 파일 확보(`D2-B11-B`, 4.11)
>
> 우선순위: `P2` — **주력 기능.** `P2-B07`~`B10` 출력 묶음보다 먼저 한다(`D2-B11-D`)
>
> 계획 작성일: 2026-09-12
>
> 상위 작업계획: [P2 실행계획](./P2-execution-plan.md)
>
> MFC 참조 루트: `/Users/kyhoon/Library/Mobile Documents/com~apple~CloudDocs/회사/hicomtech/도면`

## 1. 목표

MFC 의 `그룹재단` 을 웹 재단 작업 위에 다시 세운다. **재단 결과를 한 화면에서 손으로 편집한다** — 원판별 부품 배치를 직접 옮기고, 새 원판을 추가하고, 부품을 원판 사이에서 이동하고, 레이저 그룹·가로 절단선·필름을 지정한다. 편집한 배치는 재단 개정으로 저장되고, **원판마다 하나씩** 화면에 배치된 모습 그대로 장비용 DXF 로 나간다.

## 2. 그룹재단의 정의 — 사용자 확인 (2026-09-12)

> 그룹재단은 현재 구현된 재단과 유사하게 원판별 부품 배치를 편집하고 새원판추가·원판이동 등을 한 화면에서 할 수 있는 편집 기능이다. DXF 는 원판별로 나가고, 형태는 원판에 배치된 부품들 화면 그대로 DXF 로 나가면 된다.

이것이 정의다. 아래 3절의 MFC 소스 확인은 이 정의를 뒷받침하는 근거이지 정의 자체가 아니다.

두 가지 오해를 이 문서로 닫는다.

| 오해 | 어디에 있었나 | 실제 |
|---|---|---|
| 그룹재단 = 여러 수주를 묶어 한 판에 재단 | `D2-B05-I` (나), `D2-B06-I` | 수주를 묶지 않는다. 수주 1건의 재단 결과를 편집한다 |
| 그룹재단 = 레이저 그룹 지정 + DXF (이 문서 첫 판) | 2026-09-12 소스 검토 첫 결론 | 레이저 그룹·가로선·필름은 편집기 **안의 부속 기능**이다. 본체는 배치 편집기다 |

## 3. MFC 소스 확인

### 3.1 진입과 흐름

| 단계 | MFC 근거 | 내용 |
|---|---|---|
| 진입 | `MainDlg.cpp` `OnToolBarAddGroupCut` → `Work03Dlg.cpp` `OnBnClickedWork03BtnCutting(true)` | 메인 툴바 `그룹재단`. **현재 열린 수주 1건**으로 `재단` 과 같은 대화상자를 `m_bGroupCutMode=true` 로 연다 |
| 라이선스 | `MainDlg.cpp` 738행, `DrawingDataStd.h` `IsProg1()` | `Prog1` 에서만 버튼이 보인다 |
| 배치 | `CuttingDlg.cpp` `MakeSheet` (`m_bGroupMode` 분기), 2665행 | 같은 배치의 원판을 장수로 합치지 않고(`MergeSheet` 건너뜀) **낱장**으로 만든다. 편집기가 원판 한 장 한 장을 다루기 때문이다 |
| 화면 | `CuttingDlg.cpp` `OnInitDialog` 359행 → `OnTimer` → `OnGroupEditDlg` | 일반 재단 화면을 즉시 숨기고 `그룹편집`(`CuttingGroupDlg`) 전체 화면 편집기를 연다 |
| 확정 | `OnGroupEditDlg` | 편집 결과를 `SheetManager` 에 되돌려 넣고 원가·사용량을 다시 계산한다 |

### 3.2 편집기가 하는 일

툴바(`CuttingGroupDlg.cpp` `InitToolBar`): `새원판추가` · `삭제`(빈 원판) · `기초 계산` · `선택 병합` · `자동 병합` · `확인` · `취소` · `DXF 출력옵션` · `DXF 출력` · `전체 선택`.

| 기능 | 근거 | 내용 |
|---|---|---|
| 부품 이동 | `CommandGroupEdit.cpp` (`CCommandMove` 상속), `FoldDrawListView.cpp` | 부품을 끌어 원판 안에서 옮기고 원판 사이로 옮긴다 |
| 새 원판 추가 | `OnBtnNew`, `AddTempEditView` | 원판 규격을 골라 빈 원판을 붙인다 |
| 빈 원판 삭제 | `OnBtnDelete`, `DeleteEmptySheet` | 부품이 없는 원판을 지운다. 마지막 한 장은 못 지운다 |
| 레이저선따내기 | `CommandGroupEdit.cpp` `OnLButtonUp`, `RazorCutManager` | 끌어 선택한 부품을 한 그룹으로 묶는다. **같은 종류**(`IsSamePiece`: 폭·높이·절곡 데이터 동일)만 허용 |
| 가로절단 | `RazorCutManager::SelectCutLine` | 선택 영역을 지나는 가로 절단선 |
| 필름 | `CHiSheet::SetFilm` | 원판 단위 필름 여부. DXF 레이어·파일명이 바뀐다 |
| 손실 병합·기초 계산 | `DoLossCombine` · `RegenLossSpace` · `InitLossCalc` | 손실 사각형 표시를 합치거나 다시 만든다 |

편집 결과는 DB 에 저장하지 않는다. 그 자리에서 DXF 를 내고 끝난다(레거시 DB 에 재단 결과가 없는 이유, [P0-03](./P0-03-legacy-postgresql-reference.md)).

### 3.3 DXF 출력

`CuttingGroupDlg::OnBtnExport` → `CHiExportDxf`.

| 항목 | 내용 | 근거 |
|---|---|---|
| 파일 | 원판마다 하나. `{yymmdd}-{당일 순번:02}-{A,B,C…}.dxf`. 필름이면 `F` 접두 | `Start(path, TRUE)`, `ToAlphaIndex` |
| 부품 내용 | 외곽 절단선과 **부품 안의 절곡선(V-cut)** 을 함께 그린다 | `Export` `vcutLine`, `InShape` |
| 그룹별 부품 파일 | 레이저 그룹마다 `…-{A}-{번호}.dxf` 에 그룹 첫 부품의 전개도 | `ExportPiece` |
| 레이어 — 원판 외곽 | `-b-{두께:.2f}-{색상}` | `Export` |
| 레이어 — 절단선 | 세로 `-L-`, 가로 `-X-`. 필름이면 `-L1-` / `-X1-` | `SetPieceLine` |
| 레이어 — V-cut | `-V-{깊이×100}`, `-V1-{깊이×100}`. A 타입 깊이도 같은 규칙 | `OnBtnExport` |
| 레이저 그룹 | 그룹 사각형 안쪽 절단선은 레이어 `- -` 로 빼 기계가 자르지 않게 한다 | `SetPieceLine` `IsLineInsideRect` |
| 옵션 | 중복 라인 제거(0)/유지(1)/V-cut 연장(2), trim 제거 | `CDxfFileOptionDlg` |

## 4. 상세 설계

2026-09-12 사용자 결정 `A~H` 위에서 쓴 확정안이다. 구현은 이 절을 따른다. 갈림길이 남은 항목은 4.11 에 모았다.

### 4.1 지금 웹에 있는 것과 없는 것

| 있는 것 | 위치 |
|---|---|
| 재단 작업(`CuttingPlan`)·개정(`CuttingPlanRevision`) — 입력 스냅샷·결과 JSON·승인·잠금·`lockVersion` | [P2-B05](./P2-B05-cutting-plan-editing.md), `src/server/cutting` |
| 원판이 이미 낱장 (`sheets[]` 에 count 없음) | `src/domain/cutting/schema.ts` |
| 부품 ID = 수주 항목 ID → 절곡 스냅샷 → 제작 geometry(`CUT`·`V_CUT`·`A_CUT`·`BEND` 레이어) | `cutting-input-builder.ts`, `src/domain/manufacturing-geometry.ts` |
| DXF writer(R2000, 레이어 테이블·LINE·ARC)와 전개도 DXF 출력·`FileAsset` 보관 | `src/server/dxf`, [P1-16](./P1-16-dxf-export.md) |
| 저장 전 검증(`validateCuttingResult`: guillotine·겹침·kerf·수량·경계·잔재) | `src/domain/cutting/validate.ts` |
| 원판별 배치 그림(SVG, 보기 전용, 고정 토글) | `src/components/cutting/cutting-plan-detail-panel.tsx` |
| 작업 큐와 `cutting.optimize`·`dxf.export` 작업 | `src/server/jobs` |

| 없는 것 | 만드는 곳 |
|---|---|
| 배치를 손으로 옮기는 편집기 | 4.6 |
| 새 원판 추가·빈 원판 삭제·원판 간 이동 | 4.6 |
| 레이저 그룹·가로선·필름 지정과 저장 | 4.2·4.4·4.6 |
| 재단 결과 원판 DXF | 4.7 |
| 편집 개정의 구분과 검증 완화 | 4.2·4.4 |

`D2-B05-J` 는 2026-08-23 에 "(가) 고정하고 다시 돌린다" 로 확정하면서 "(다) 좌표를 직접 끌어 옮긴다" 를 뺐고, *"좌표까지 지정해야 할 일이 실제로 생기면 그때 (다)를 다시 연다"* 고 적었다. **이 작업이 그 (다)를 연다.** 고정 후 재실행은 그대로 남고, 그 위에 직접 편집을 더한다.

### 4.2 데이터 모델

`CuttingPlanRevision` 에 컬럼 셋을 더한다. 배치 자체는 기존 `result`(`cuttingResult`)에 그대로 쓴다. 계약(`cutting-contract-v1`)은 바꾸지 않는다.

| 컬럼 | 타입 | 뜻 |
|---|---|---|
| `source` | `enum CuttingRevisionSource { SOLVER, MANUAL_EDIT }` 기본 `SOLVER` | 개정을 누가 만들었나. 편집 개정은 큐를 타지 않고 즉시 `SUCCEEDED` 로 생긴다 |
| `baseRevisionId` | `uuid?` | 편집의 출발점이 된 개정. 이력 화면에서 "r3 을 고쳐 r4" 로 보여 준다 |
| `annotations` | `jsonb?` | 4.3 의 `cuttingAnnotations`. `SOLVER` 개정은 `null` |
| `warnings` | `jsonb?` | 저장을 허용한 경고(`NOT_GUILLOTINE`·`KERF_NOT_KEPT`). 승인 화면에서 다시 보여 준다 |

migration 하나. 기존 행은 `source = SOLVER`, 나머지 `null`.

`CuttingPlanRevisionStatus` 는 그대로 쓴다. 편집 개정은 `QUEUED` 를 거치지 않는다.

### 4.3 annotations 스키마

`src/domain/cutting/annotations.ts`. zod `strictObject`.

```
cuttingAnnotations = {
  version: "cutting-annotations-v1",
  laserGroups: [{
    id: string,                       // 화면·DXF 파일명에 쓰는 안정 ID
    sheetIndex: number,
    placementKeys: string[],          // `${partId}#${n}` — 같은 부품 n번째 배치
    boundsMm: { xMm, yMm, widthMm, lengthMm },   // 저장 시 계산해 넣는다. 검증·DXF 가 다시 계산하지 않는다
  }],
  horizontalCutLines: [{ id, sheetIndex, yMm }],
  sheets: [{ sheetIndex, film: boolean }],
}
```

`placementKeys` 를 두는 이유 — `cuttingPlacement` 에는 ID 가 없고 같은 부품이 여러 장 놓인다. 배열 순서(`placements[i]`)는 편집으로 바뀌므로 인덱스로 가리키면 어긋난다. 저장 시 편집기가 `sheets[].placements` 를 `partId` 별로 정렬해 `#n` 을 붙이고, 읽을 때도 같은 규칙으로 붙인다. 이 규칙은 `annotations.ts` 한 곳에 둔다.

### 4.4 검증 규칙

`validateCuttingResult` 는 손대지 않는다. 그 위에 `validateManualEdit(input, result, annotations)` 를 둔다.

| 검사 | 편집 개정 | solver·고정 재실행 |
|---|---|---|
| `OVERLAP`·`OUT_OF_USABLE_AREA`·`UNKNOWN_PART`·`UNKNOWN_SHEET`·`ROTATION_NOT_ALLOWED`·`GRAIN_CONFLICT`·`SHEET_LIMIT_EXCEEDED`·`CONTRACT_VERSION_MISMATCH` | **거부** | 거부 |
| `QUANTITY_MISMATCH` | **거부** — 부품을 수량보다 많이 놓았을 때. 미배치는 허용하며 서버가 `입력 수량 − 배치 수` 로 센다 | 거부 |
| `NOT_GUILLOTINE`·`KERF_NOT_KEPT` | **경고** — `warnings` 에 남기고 저장 (`D2-B11-G`) | 거부(`D2-B05-F`) |
| `REMNANT_*`·`AREA_MISMATCH` | 서버가 잔재·요약을 **다시 계산해 채우므로** 검사 대상이 아니다 | 거부 |

annotations 검사(전부 거부):

| 코드 | 규칙 |
|---|---|
| `LASER_GROUP_MIXED_PART` | 그룹의 모든 배치가 같은 `partId`·같은 `rotated` 여야 한다 (MFC `IsSamePiece`) |
| `LASER_GROUP_NOT_RECTANGLE` | 그룹 배치들의 합집합이 사각형 하나를 이루고 그 안에 다른 배치가 없어야 한다. 격자(행×열)로 놓인 것만 통과 |
| `LASER_GROUP_OVERLAP` | 한 배치가 두 그룹에 속할 수 없다 |
| `CUT_LINE_CROSSES_PART` | 가로선이 어떤 배치의 내부를 지나면 안 된다. 경계에 닿는 것은 된다 |
| `CUT_LINE_OUT_OF_SHEET` | 원판 사용 영역(trim 안) 밖의 y |
| `ANNOTATION_UNKNOWN_SHEET`·`ANNOTATION_UNKNOWN_PLACEMENT` | 가리키는 원판·배치가 결과에 없다 |

요약·미배치는 서버가 채운다(`buildManualEditResult`). 편집기는 원판별 `placements` 만 보낸다. **편집 개정은 잔재 사각형을 보고하지 않는다** — 자유 배치에서 잔재 사각형을 구하는 것은 별개 문제이고, `P2-B06` 은 남은 조각을 손실로 세므로 면적 차만 있으면 된다. 레이저 그룹의 `boundsMm` 도 서버가 배치에서 다시 계산해 덮어쓴다.

### 4.5 API

모두 `cutting.optimize` 권한. 변경은 `expectedLockVersion` 으로 낙관적 잠금(기존 `rerun` 과 같은 규칙).

| 메서드·경로 | 요청 | 응답 | 규칙 |
|---|---|---|---|
| `POST /api/v1/cutting-plans/{planId}/manual-revisions` | `{ expectedLockVersion, baseRevisionId, sheets: [{ sheetItemId, placements[] }], annotations }` | `201 { plan, revision, warnings[] }` | 4.4 검증. 거부면 `400 INVALID_REQUEST` 에 `details.violations[]`. 승인된 작업이면 `409`. 새 개정이 `currentRevision` 이 되고 `lockVersion` +1. 감사 `cutting.revision_edited` |
| `POST /api/v1/cutting-plans/{planId}/manual-revisions/validate` | 위와 같음(`expectedLockVersion` 없음) | `200 { violations[], warnings[], summary, annotations }` | 저장 없이 검증만. 편집기가 이동할 때마다 부른다(디바운스) |
| `POST /api/v1/cutting-plans/{planId}/revisions/{revisionId}/dxf` | `{}` | `202 { jobId }` | `cutting.dxf` 작업을 큐에 넣는다. `SUCCEEDED` 개정만. idempotency `cutting-dxf-{revisionId}-{annotationsChecksum}` — 같은 개정·같은 지정이면 다시 만들지 않는다 |
| `GET /api/v1/cutting-plans/{planId}/revisions/{revisionId}/dxf` | — | `200 { files: [{ sheetIndex, fileName, assetId, kind: "SHEET" \| "LASER_GROUP" }], zipAssetId }` | 만들어진 파일 목록. 내려받기는 기존 `GET /files/{fileId}/downloads` |
| `GET /api/v1/cutting-plans/{planId}` | (기존) | DTO 에 `revisions[].source`·`baseRevisionId`·`warnings`, `annotations` 추가 | — |

원판 규격 후보는 별도 API 없이 `input.sheets`(입력 스냅샷) 를 그대로 쓴다. 새 원판 추가는 결과의 `sheets[]` 에 `{ sheetItemId, placements: [] }` 를 붙이는 것이라 스냅샷 밖 규격이 들어올 수 없다(`D2-B05-D`). `availableCount` 를 넘으면 `SHEET_LIMIT_EXCEEDED`.

### 4.6 편집기 — 화면과 상호작용

위치: `/cutting/[planId]/edit`. 상세 화면의 `편집` 버튼으로 들어간다. 승인된 작업은 버튼이 잠긴다(잠금 해제 후).

**한 화면 구성**

```
┌ 도구 막대: [부품 이동] [레이저 그룹] [가로선] [필름]  |  새 원판 추가 ▾  빈 원판 삭제  |  실행취소 다시실행  |  검증 상태  저장  취소 ┐
├──────────────────────────────────────────┬───────────────────┤
│ 원판 1  ───────────────  원판 2  ───────  │ 미배치 부품         │
│ (SVG, 긴 쪽 가로, 좌상단 원점 — D2-B05-L) │ 부품명 × 남은 수량   │
│  세로로 이어서 스크롤                     │ 끌어서 원판에 놓음   │
│                                          ├───────────────────┤
│                                          │ 선택 정보·경고 목록  │
└──────────────────────────────────────────┴───────────────────┘
```

**모드별 동작**

| 모드 | 동작 |
|---|---|
| 부품 이동 | 배치를 끌어 같은 원판 안·다른 원판으로 옮긴다. 놓을 때 kerf 만큼 띄운 자리로 **스냅**(다른 배치 변·원판 사용 영역 변). `R` 키 또는 버튼으로 90° 회전(부품·원판이 허용할 때만). 겹치거나 경계를 넘으면 빨간 표시, 놓을 수 없다. 미배치 목록으로 되돌리기(`Delete`) |
| 미배치 투입 | 오른쪽 목록에서 원판으로 끌어 놓는다. 수량이 남은 만큼만 |
| 레이저 그룹 | 배치 여러 개를 끌어 선택(사각형 선택) → `묶기`. 4.4 규칙에 어긋나면 이유를 보여 주고 묶지 않는다. 그룹은 외곽선 강조로 표시. 그룹 클릭 → `풀기` |
| 가로선 | 원판 위에서 클릭한 y 에 선. 배치 내부를 지나면 놓을 수 없다. 선 클릭 → 삭제 |
| 필름 | 원판 머리글의 토글 |
| 새 원판 추가 | 드롭다운에서 `input.sheets` 후보를 고르면 빈 원판이 맨 뒤에 붙는다 |
| 빈 원판 삭제 | 배치가 없는 원판만. 마지막 한 장은 남긴다. 지우면 뒤 원판의 `sheetIndex` 가 당겨지고 annotations 도 같이 당긴다 |
| 실행취소 | 편집기 안 상태 스택. 저장 전까지만 |
| 검증 상태 | 이동이 멈추면 `validate` API 를 부른다(300ms 디바운스). 거부 항목이 있으면 저장 버튼이 잠기고, 경고만 있으면 노란 표시와 함께 저장 가능 |
| 저장 | 4.5 `manual-revisions`. 성공하면 상세 화면으로 돌아가 새 개정을 보여 준다. `409` 면 "다른 화면에서 바뀌었습니다" 와 함께 다시 불러오기 |

좌표 — 편집기는 화면 좌표(긴 쪽 가로, 좌상단 원점)로 그리고 저장 직전에 계약 좌표(왼쪽 아래 원점)로 되돌린다. 변환은 `SheetFigure` 의 `toScreen` 을 역함수와 함께 `src/domain/cutting/screen-transform.ts` 로 꺼내 공유한다. 숫자는 계약대로 문자열 십진수, 편집 중에는 `bigint` 단위(`units.ts`)로 다뤄 오차를 없앤다.

그리기 — 기존 SVG 를 그대로 키운다. 부품 수백 개까지는 SVG 로 충분하고, 절곡 편집기의 Konva 를 끌어오면 두 편집기의 상호작용이 갈라진다. 드래그는 배치에서 `pointerdown` 으로 들고 `window` 의 `pointermove/up` 으로 놓는다 — 원판 SVG 가 여러 개라 요소 밖으로 나가도 추적해야 한다.

편집 중 지정은 저장 형식(`sheetIndex`·`partId#n`)이 아니라 **편집기 키**로 든다(`editor-state.ts`). 배치를 하나 빼거나 원판을 지우면 뒤 번호가 밀려 저장 키가 다른 배치를 가리키게 되기 때문이다. `toSaveAnnotations` 가 저장 직전에 한 번 변환한다.

E2E 는 worker 가 있어야 재단 결과가 나오므로 `e2e/global-setup.ts` 가 테스트 DB 를 보는 worker 를 함께 띄운다. `P2-B10` 생산 E2E 도 이 기반을 쓴다.

### 4.7 DXF 생성

`src/server/cutting/cutting-dxf-service.ts`. 큐 작업 `cutting.dxf` 로 돈다(원판 수십 장 × 부품 절곡선이라 동기 응답보다 큐가 맞다. `P2-B01` 기반 그대로).

**파일 단위** — 원판 하나 = 파일 하나 + 레이저 그룹마다 파일 하나 + 전체 zip. 모두 `FileAsset(kind: DXF)` 로 보관하고 개정에 매단다(`FileAsset` 에 `cuttingPlanRevisionId` 컬럼 추가 — 4.2 migration 에 같이).

**파일명** — MFC 규칙(`D2-B11-B`).

| 파일 | 이름 |
|---|---|
| 원판 | `{yymmdd}-{순번:02}-{A..Z,AA..}.dxf`. 필름이면 `F` 접두: `F{yymmdd}-…` |
| 레이저 그룹 | `{yymmdd}-{순번:02}-{A}-{그룹 순번}.dxf` |
| zip | `{수주번호}-{재질코드}-r{개정}.zip` |

`{순번}` 은 조직·날짜 기준 일련번호. `CuttingDxfSequence(organizationId, dateKey, next)` 표 하나로 센다. MFC 가 PC 레지스트리로 세던 것을 서버로 옮긴 것이다.

**좌표** — 계약 좌표 그대로(왼쪽 아래 원점, x 폭, y 길이, mm). `nBaseDraw` 회전 옵션은 넣지 않는다 — 실제 DXF 파일과 대조해 필요하면 연다(4.11).

**레이어와 내용**

| 레이어 | 내용 | 색 |
|---|---|---|
| `-b-{두께:.2f}-{색상}` | 원판 외곽 사각형(trim 포함 전체) | 8 |
| `-L-` / `-X-` (필름 `-L1-` / `-X1-`) | 부품 외곽의 세로선 / 가로선. 이웃 부품과 겹치는 선은 **한 번만**(MFC 옵션 0 "중복 라인 제거" 고정). 같은 직선 위 이어진 선분은 합친다(`MergeLine`) | 7 |
| `-V-{깊이×100}` / `-V1-{깊이×100}` | 부품 안 V-cut 선. 부품 제작 geometry 의 `V_CUT` 을 배치 좌표·회전으로 옮긴다. `A_CUT` 도 같은 규칙으로 `-V-{A깊이×100}` | 140 / 40 |
| `- -` | 레이저 그룹 사각형 **안쪽**에 완전히 들어가는 절단선. 기계가 무시한다 | 9 |
| 가로선 | annotations `horizontalCutLines` 를 `-X-` 로 | 7 |

`BEND`·`PROFILE_REFERENCE` 레이어는 원판 DXF 에 넣지 않는다(장비용이다). 레이저 그룹 파일은 기존 `exportFoldRevisionDxf` 의 geometry 를 그대로 쓴다 — 그룹 첫 부품의 전개도 한 장.

`{색상}` — MFC 는 원판 기준정보의 색상 문자열이다. 웹 `MaterialVariant` 에는 색상이 없으므로 **변형 `code`** 를 넣는다. 실제 파일 대조 후 바꿀 수 있다(4.11).

**dxf-writer 확장** — 지금 writer 는 `ManufacturingLayer` 고정 6종이다. 임의 레이어 이름·색을 받는 `createDxfDocumentFromLayers(entities: { layer: string; color: number; … }[])` 를 추가하고 기존 함수는 그 위의 얇은 껍데기로 바꾼다. 출력 포맷(R2000, LINE/ARC)은 그대로다.

### 4.8 승인·사용량·감사

- 승인은 편집 개정도 똑같이 한다(`approveCuttingPlan`). `warnings` 가 있으면 승인 화면에 "guillotine 위반 n건이 있는 편집 결과" 를 보여 주고 승인자가 확인한다.
- 원판 사용 실적(`P2-B06`)은 `result.sheets[].sheetItemId` 로 세므로 편집 개정에서도 그대로 동작한다. 새 원판을 추가하면 실적도 늘어난다.
- 감사: `cutting.revision_edited`(개정 번호·기준 개정·경고 수·그룹 수), `cutting.dxf_exported`(개정·파일 수·zip asset).
- 권한: 편집·검증·DXF 는 `cutting.optimize`. 새 권한을 만들지 않는다.

### 4.9 테스트와 검수

| 층 | 내용 |
|---|---|
| 단위 | `annotations.ts` 스키마·`placementKeys` 부여, `validateManualEdit` 전 코드, 화면↔계약 좌표 변환 왕복, DXF 레이어 이름·중복선 제거·`- -` 처리·파일명 순번 |
| 통합 | `manual-revisions` 저장(거부·경고·성공)·`409`·승인·사용 실적, `cutting.dxf` 작업이 `FileAsset` 을 만들고 zip 을 남기는 것 |
| E2E | 편집기 진입 → 부품 이동 → 새 원판 추가 → 레이저 그룹 → 저장 → 상세에서 새 개정 확인 → DXF 생성 → 파일 목록 |
| 대조 | MFC 실제 DXF 와 좌표·레이어·파일 구성 비교. 합격 기준 |
| 화면 검수 가이드 | `docs/P2-B11-screen-test-guide.md` |

### 4.10 구현 순서

한 작업 안의 순서다(`D2-B11-H` (다)). 각 단계가 끝날 때마다 검증·커밋한다.

| 순서 | 내용 | 산출 |
|---|---|---|
| B11-1 | migration(4.2), `annotations.ts`, `validateManualEdit`, `manual-revisions`·`validate` API, DTO 확장 — **2026-09-12 완료** | 단위 7건·통합 3건 |
| B11-2 | 편집기 — 부품 이동·미배치 투입·회전·새 원판·빈 원판 삭제·실행취소·검증 표시·저장 — **2026-09-12 완료** | 단위 6건·E2E 1건 |
| B11-3 | 편집기 — 레이저 그룹·가로선·필름 — **2026-09-12 완료** | 단위 3건·E2E(같은 흐름) |
| B11-4 | DXF — writer 확장, `cutting-dxf-service`, `cutting.dxf` 작업, 순번, zip, 파일 목록 API·화면, 레이저 그룹 안쪽 선 제외·그룹 파일·필름 반영 | 통합 테스트 + MFC 대조 |
| B11-5 | 검수 가이드, 상태 문서 갱신, 사용자 검수 | — |

### 4.11 열린 질문 — 실제 DXF 파일을 받은 뒤 정한다

| 질문 | 지금 가정 | 파일에서 확인할 것 |
|---|---|---|
| 좌표 원점·회전 | 계약 좌표 그대로, 회전 없음 | 원점이 어느 모서리인지, `nBaseDraw` 기본값 |
| `{색상}` | 재질 변형 `code` | 실제 문자열 형식(`WHITE`, `W/H`→`WH` 등) |
| V-cut 깊이 표기 | `깊이×100` 정수 | `-V-150` 이 1.5mm 인지 |
| 필름 파일명 | `F` 접두 | `F` 위치와 그룹 파일에도 붙는지 |
| 원판 외곽에 trim 포함 여부 | 전체 원판 | 외곽 사각형 크기 |
| 중복선 제거 | 항상 제거(옵션 0) | 현장이 옵션 1·2 를 쓰는지 |

### 4.12 넣지 않는 것

- **손실 사각형 편집(`선택 병합`·`자동 병합`·`기초 계산`)** — 웹은 손실을 배치에서 계산한다(`P2-B06`). 표시만 있으면 된다
- **인쇄 4종** — `P2-B07`
- **여러 수주를 묶는 재단** — `D2-B05-I` (나). 별개 논점
- **박스(`CutPro`) 부품 별도 파일** — 웹 제작 geometry 의 `PANEL_CUT` 이 이미 박스 패널을 담는다. 원판 DXF 에 `PANEL_CUT` 도 `-L-`/`-X-` 로 넣고 별도 파일은 만들지 않는다
- **DXF 옵션 화면(중복선·V-cut 연장·경로)** — 4.11 대조 결과 필요하면 연다
- **이전 개정 지정 가져오기** — `D2-B11-C` 에 적은 대로 나중에

## 5. 사용자 결정

### `D2-B11-A` 이 기능을 쓰는가 — **확정: (가) 진행. 그룹재단이 주력이다**

MFC 에서 `Prog1` 라이선스에만 열려 있어 부가 기능일 가능성을 물었다. **2026-09-12 사용자: 그룹재단이 메인이다.**

### `D2-B11-B` DXF 레이어·파일명 규칙 — **확정: (가) MFC 규칙 그대로**

| 안 | 결과 |
|---|---|
| **(가) MFC 규칙 그대로** | 현장 장비 설정을 바꾸지 않는다 |
| (나) 웹에서 새로 정한다 | 장비 쪽 매핑을 같이 바꿔야 하고 검증할 실물이 필요하다 |

착수 조건: **MFC 로 낸 실제 DXF 파일 한 벌**. 소스만으로는 좌표 원점·회전(`nBaseDraw` 0~3)·오프셋을 확신할 수 없다. 현장 PC 의 `export_dxf` 폴더에서 받는다. 없으면 시작은 해도 합격 판정을 못 한다.

### `D2-B11-C` 지정을 어느 개정에 붙이는가 — **확정: (가) 재단 개정에 붙이고 함께 잠근다**

| 안 | 결과 |
|---|---|
| **(가) 재단 개정에** | 승인된 배치·지정·DXF 가 1:1. 재실행하면 지정은 넘어오지 않는다 |
| (나) 재단 작업 단위로 유지 | 배치가 바뀐 뒤 살아남은 지정이 위험하다 |

### `D2-B11-D` 순서 — **확정: (가) `P2-B11` 을 출력 묶음보다 먼저**

주력 기능이고, `P2-B07` 은 용지·프린터 기준 미결정으로 막혀 있다. B11-2 원판 DXF 는 `P2-B09` 대량 DXF 의 단건 기반이 된다.

### `D2-B11-E` 정의 정정 — **확정: 편집기가 본체다**

소스 검토 첫 결론(레이저 그룹 지정 + DXF)을 사용자가 정정했다. 2절 참조. 이에 따라 `D2-B05-J` (다)를 다시 연다.

### `D2-B11-F` DXF 안의 부품은 무엇까지 그리는가 — **확정: (나) 절곡선까지**

| 안 | 결과 |
|---|---|
| (가) 부품 외곽 절단선만 | 지금 웹 배치 그림과 같다. 단순하다 |
| **(나) 부품 안 절곡선(V-cut 깊이 레이어)까지** | MFC 원판 DXF 와 같다. 부품 ID → 제작 geometry 로 만들 수 있다 |

### `D2-B11-G` 손으로 옮긴 배치의 저장 검증 — **확정: (가) guillotine 은 경고**

| 안 | 결과 |
|---|---|
| **(가) 겹침·경계 이탈만 거부, guillotine 은 경고** | 자유 배치가 된다. 레이저가 있으므로 직선 관통이 필수가 아니다 |
| (나) 지금처럼 전부 거부 | 재단기가 guillotine 만 가능할 때 |

`D2-B05-F` 는 solver 결과와 고정 재실행에는 그대로 적용한다. 완화는 편집 개정에만이다.

### `D2-B11-H` 레이저 그룹·가로선·필름을 언제 넣는가 — **확정: (다) 처음부터 같이**

| 안 | 결과 |
|---|---|
| (가) 이번 범위에서 뺀다 | 편집기와 DXF 만 |
| (나) 편집기 위에 나중에 얹는다 | 별도 작업 |
| **(다) 처음부터 같이** | 한 작업. 순서만 4.5 로 나눈다 |

## 6. 착수 전 남은 것

| 항목 | 내용 |
|---|---|
| MFC 실제 DXF 파일 | 원판 파일·그룹 파일 한 벌. 필름 on/off, V-cut 있는 것을 섞어서 |
| ~~상세 설계~~ | 2026-09-12 4절에 썼다. 실제 DXF 파일을 받으면 4.11 을 닫고 착수한다 |

## 7. 문서 정정

| 문서 | 잘못된 기록 | 정정 |
|---|---|---|
| [P0-02](./P0-02-mfc-feature-inventory.md) `F-15a` | 그룹재단 = 레이저 그룹 지정 + DXF | 그룹재단 = 재단 배치 편집기 + 원판별 DXF. 레이저 그룹은 부속 |
| [P2-B05](./P2-B05-cutting-plan-editing.md) `D2-B05-I` | "MFC 에는 그룹 재단이 있었다" 를 여러 수주 묶음의 근거로 인용 | 수주를 묶지 않는다 |
| [P2-B05](./P2-B05-cutting-plan-editing.md) `D2-B05-J` | (다) 좌표 직접 편집은 "필요가 생기면 다시 연다" | `P2-B11` 이 연다 |
| [P2-B06](./P2-B06-sheet-usage-remnant.md) `D2-B06-I` | "그룹 재단이 열리면 원가 배분을 (나)로" | 그룹재단은 원가 배분과 무관 |

## 8. 검토 방법

2026-09-12. MFC 소스를 `iconv -f CP949` 로 변환해 읽었다(일부는 UTF-8 원본). 코드를 실행하거나 실물 DXF 를 보지는 않았다. 정의는 사용자 확인(2절)이 우선이다.

`MainDlg.cpp` 툴바·`OnToolBarAddGroupCut` · `Work03Dlg.cpp` `OnBnClickedWork03BtnCutting` · `HCuttingDlg.cpp` 1736행 · `CuttingDlg.cpp` `OnInitDialog`·`OnTimer`·`MakeSheet`·`SeperateSheetByPattern`·`OnGroupEditDlg`·`OnBnClickedBtnEdit` · `CuttingGroupDlg.cpp` 전체 · `CutGroupEditDlg.h`·`IDD_DLG_GROUP_MENU` · `CommandGroupEdit.cpp` `OnLButtonUp` · `RazorCutManager.h` · `HiExportDxf.cpp` `Export`·`ExportPiece`·`SetPieceLine` · `HiRectPiece.cpp` `IsSamePiece`

## 9. 관련 문서

- [P2-B03 재단 계약](./P2-B03-cutting-contract.md)
- [P2-B05 재단 작업 편집](./P2-B05-cutting-plan-editing.md)
- [P2-B06 원판 사용량·잔재](./P2-B06-sheet-usage-remnant.md)
- [P1-16 DXF 출력](./P1-16-dxf-export.md)
- [P2 실행계획](./P2-execution-plan.md)

## 10. 변경 기록

| 날짜 | 변경 내용 | 작성자 |
|---|---|---|
| 2026-09-12 | MFC 소스 확인으로 검토 문서 최초 작성. 그룹재단 = 레이저 그룹 지정 + 장비용 DXF 로 결론 | Claude |
| 2026-09-12 | `D2-B11-A~D` 사용자 결정. 주력(A), MFC DXF 규칙(B), 개정에 붙여 잠금(C), 출력 묶음보다 먼저(D). `READY` | 사용자·Claude |
| 2026-09-12 | **정의 정정(`E`).** 사용자가 그룹재단을 "재단 배치 편집기 + 원판별 DXF" 로 확인. 레이저 그룹은 부속. `F`(절곡선 포함)·`G`(guillotine 경고)·`H`(처음부터 같이) 결정. `D2-B05-J` (다) 재개방. 문서 전면 재작성 | 사용자·Claude |
| 2026-09-12 | 상세 설계(4절). 데이터 모델·annotations 스키마·검증 규칙·API·편집기 상호작용·DXF 생성·순서. 실제 DXF 로 닫을 질문은 4.11 | Claude |
| 2026-09-12 | B11-1 구현. `CuttingPlanRevision` 에 `source`·`baseRevisionId`·`annotations`·`warnings`, `annotations.ts`·`manual-edit.ts`, `createManualRevision`·`validateManualRevision`, API 둘, 감사 `cutting.revision_edited`. 설계와 달라진 것: 미배치는 서버가 세고 편집 개정은 잔재를 보고하지 않는다 | Claude |
| 2026-09-12 | B11-2 구현. `editor-state.ts`(순수 상태·스냅·판정·저장 변환), `screen-transform.ts`, `/cutting/[planId]/edit` 편집기(이동·원판 간 이동·미배치 투입·회전·원판 추가/삭제·실행취소·디바운스 검증·저장), 상세 화면 `배치 편집` 진입과 개정 출처 열. E2E 에 worker 를 띄우는 global setup 추가 | Claude |
| 2026-09-12 | B11-3 구현. 편집기에 도구 모드(부품 이동·레이저 그룹·절단선), 사각형 선택으로 묶기·누르면 풀기, 클릭으로 절단선 두기·지우기, 원판 필름 토글. 즉시 판정은 서버 규칙과 같은 `laserGroupIssue`·`cutLineIssue`. 서버 위반에 `placementKey` 를 실어 문제인 장만 표시. 상세 화면에 그룹·절단선·필름 표시 | Claude |
