# P2-B11 — 그룹재단 (재단 그룹 편집과 장비용 DXF)

> 상태: `BACKLOG` — 검토 단계. 착수 전 4절 결정이 필요하다
>
> 우선순위: `P2`
>
> 계획 작성일: 2026-09-12
>
> 상위 작업계획: [P2 실행계획](./P2-execution-plan.md)
>
> MFC 참조 루트: `/Users/kyhoon/Library/Mobile Documents/com~apple~CloudDocs/회사/hicomtech/도면`

## 1. 목표

MFC 의 `그룹재단` 을 웹 재단 작업 위에 다시 세운다. 사용자가 재단 결과 위에서 **레이저로 한 덩어리로 딸 부품 묶음·가로 절단선·필름 여부**를 지정하고, 그 지정이 반영된 **원판별 장비용 DXF** 를 내려받을 수 있게 한다.

## 2. MFC 의 그룹재단은 무엇인가 — 소스 확인 결과

지금까지 웹 문서는 그룹재단을 **"여러 수주를 묶어 한 판에 재단하는 것"** 으로 적어 왔다(`D2-B05-I` (나), [P2-B05](./P2-B05-cutting-plan-editing.md) 4절, [P2-B06](./P2-B06-sheet-usage-remnant.md) `D2-B06-I`). 2026-09-12 에 MFC 소스를 직접 읽은 결과 **그 이해는 틀렸다.** MFC 그룹재단은 수주를 묶지 않는다.

### 2.1 진입과 흐름

| 단계 | MFC 근거 | 내용 |
|---|---|---|
| 진입 | `MainDlg.cpp` `OnToolBarAddGroupCut` → `Work03Dlg.cpp` `OnBnClickedWork03BtnCutting(true)` | 메인 툴바 `그룹재단` 버튼. **현재 열려 있는 수주 1건**의 절곡 데이터로 `재단` 버튼과 같은 대화상자(`CHCuttingDlg`)를 `m_bGroupCutMode=true` 로 연다 |
| 라이선스 | `MainDlg.cpp` 738행, `DrawingDataStd.h` `IsProg1()` | `Prog1` 이 아니면 버튼을 숨긴다. 모든 고객이 쓰는 기능이 아니다 |
| 배치 | `CuttingDlg.cpp` `MakeSheet` / `MakeSheet_CutExType` (`m_bGroupMode` 분기), 2665행 | 같은 배치의 원판을 장수로 합치지 않고(`MergeSheet` 건너뜀) **원판 한 장 한 장을 따로** 만든 뒤 `SeperateSheetByPattern` 으로 같은 패턴만 묶어 패턴 번호를 매긴다 |
| 화면 | `CuttingDlg.cpp` `OnInitDialog` 359행 → `OnTimer` → `OnGroupEditDlg` | 일반 재단 화면을 즉시 숨기고 `그룹편집`(`CuttingGroupDlg`) 전체 화면을 연다 |
| 확정 | `OnGroupEditDlg` | 편집 결과를 `SheetManager` 에 되돌려 넣고 원가·사용량을 다시 계산한다 |

### 2.2 그룹편집 화면에서 하는 일

툴바(`CuttingGroupDlg.cpp` `InitToolBar`): `새원판추가` · `삭제`(빈 원판) · `기초 계산` · `선택 병합` · `자동 병합` · `확인` · `취소` · `DXF 출력옵션` · `DXF 출력` · `전체 선택`.

그룹 메뉴(`IDD_DLG_GROUP_MENU`, `CutGroupEditDlg`):

| 버튼 | 동작 | 근거 |
|---|---|---|
| **레이저선따내기 선택/취소** | 마우스로 부품을 끌어 선택하면 그 부품들을 **하나의 레이저 그룹**으로 묶는다. 선택한 부품이 **모두 같은 종류**(`IsSamePiece`: 폭·높이·절곡 데이터 동일)여야 하고 아니면 "같은 종류의 조각이 아닙니다" 로 거부한다. 손실(loss) 조각도 따로 묶을 수 있다 | `CommandGroupEdit.cpp` `OnLButtonUp`, `RazorCutManager.h` |
| **가로절단 선택/취소** | 선택 영역을 지나는 **가로 절단선**을 추가한다 | `RazorCutManager::SelectCutLine` |
| **필름 선택/취소** | 원판 단위로 필름 여부를 켠다. DXF 레이어 이름과 파일 이름이 바뀐다 | `CHiSheet::SetFilm`, `HiExportDxf.cpp` 799·1117행 |
| 선택 병합 / 자동 병합 / 기초 계산 | 손실 사각형을 합치거나 다시 만든다 | `DoLossCombine` · `RegenLossSpace` · `InitLossCalc` |
| 재단도면인쇄 · 절곡재단통합인쇄 · 데이터인쇄 · 현재도면인쇄 | 인쇄 | — |

지정은 화면 세션 안에만 있다. **DB 에 저장하지 않는다**(레거시 DB 에 재단 결과가 없는 것과 같은 이유, [P0-03](./P0-03-legacy-postgresql-reference.md)).

### 2.3 DXF 출력 — 그룹재단의 실제 산출물

`CuttingGroupDlg::OnBtnExport` → `CHiExportDxf`. 일반 재단 화면(`CuttingDlg.cpp` 8257행, `CuttingEditDlg.cpp` 494행)에도 같은 DXF 출력이 있지만 **레이저 그룹·가로선·필름은 그룹편집에서만** 붙는다.

| 항목 | 내용 | 근거 |
|---|---|---|
| 파일 | 원판마다 파일 하나. `{yymmdd}-{당일 순번:02}-{A,B,C…}.dxf`. 필름이면 `F` 접두 | `Start(path, TRUE)` split 모드, `ToAlphaIndex` |
| 그룹별 부품 파일 | 레이저 그룹마다 `…-{A}-{그룹번호}.dxf` 를 추가로 낸다. 그룹의 **첫 부품 전개도**(V-cut 선 포함)를 담는다 | `ExportPiece(group[j].m_pPieceGroup[0], …)` |
| 박스 부품 파일 | `CutPro` 박스 형상 부품은 `ExportBox` 로 따로 낸다 | `OnBtnExport` 하단 |
| 레이어 — 원판 외곽 | `-b-{두께:.2f}-{색상}` | `Export` 외각 라인 |
| 레이어 — 절단선 | 세로 `-L-`, 가로 `-X-`. 필름이면 `-L1-` / `-X1-` | `SetPieceLine` |
| 레이어 — V-cut | `-V-{깊이×100}` (V), `-V1-{깊이×100}`. A 타입 깊이도 같은 규칙 | `OnBtnExport` `vcutLayer` |
| 레이저 그룹 처리 | 그룹 사각형 **안쪽** 절단선은 레이어 `- -` 로 빼내 기계가 자르지 않게 한다. 그룹 외곽만 절단선으로 남고 안쪽은 그룹별 부품 DXF 로 레이저가 딴다 | `SetPieceLine` `IsLineInsideRect` |
| 가로선 | 별도 절단선으로 추가 | `Export` 927행 |
| 옵션 | 중복 라인 제거(0) / 유지(1) / V-cut 연장(2), trim 제거, 저장 경로 | `CDxfFileOptionDlg` |

즉 MFC 그룹재단의 본질은 **"guillotine 재단 결과 위에 레이저 가공 구간을 표시하고, 그 표시가 반영된 장비용 DXF 를 원판별로 내는 것"** 이다. 수율·원가 배분과는 무관하다.

## 3. 웹에 어떻게 올리는가 — 제안

### 3.1 지금 웹에 있는 것

| 있는 것 | 위치 |
|---|---|
| 재단 작업(`CuttingPlan`) — 입력 스냅샷·결과 JSON·개정·승인 | [P2-B05](./P2-B05-cutting-plan-editing.md), `src/server/cutting` |
| 원판이 **이미 한 장씩** 개별 (`sheets[]` 에 count 없음) | `src/domain/cutting/schema.ts` `cuttingSheetResultSchema` |
| 원판별 배치 그림·부품 목록·잔재 | `/cutting/[planId]` |
| 부품 고정 후 재실행(`D2-B05-J` (가)) | `cutting-plan-service.ts` |
| 전개도 DXF 출력 (절곡 개정 단위) | `src/server/dxf/dxf-export-service.ts`, [P1-16](./P1-16-dxf-export.md) |
| 원판 사용량·잔재·원가 | [P2-B06](./P2-B06-sheet-usage-remnant.md) |

MFC 가 그룹 모드에서 원판을 장수로 합치지 않고 낱장으로 두는 것은 웹의 결과 모델과 이미 같다. 따라서 solver 나 배치 모델을 바꿀 필요는 없다.

### 3.2 나눠서 올린다

| 묶음 | 내용 | 규모 |
|---|---|---|
| **B11-1 재단 DXF** | 재단 결과 원판 한 장을 MFC 와 같은 레이어 규칙(`-b-`, `-L-`/`-X-`, `-V-`)으로 DXF 로 낸다. 원판마다 파일 하나, `P2-B02` 저장소에 `FileAsset` 으로 남긴다 | 중간. `dxf-writer.ts` 재사용. 그룹 지정이 없어도 그 자체로 쓸모가 있다 |
| **B11-2 그룹 지정** | 재단 개정에 `annotations` 를 붙인다: `laserGroups[]`(부품 ID 묶음 → 사각형), `horizontalCutLines[]`, `sheets[].film`. 저장 전 검증: 같은 종류 부품만, 인접해 하나의 사각형을 이룰 것. 승인되면 잠긴다(`D2-B05-G` 와 같은 규칙) | 중간. 결과 JSON 옆에 두면 migration 이 가볍다(`D2-B05-K` (가)) |
| **B11-3 그룹 반영 출력** | B11-1 이 annotations 를 읽어 그룹 안쪽 선을 빼고, 그룹별 부품 전개도 DXF 를 기존 전개도 출력으로 함께 낸다. 필름은 레이어·파일명에 반영 | 작음. B11-1·B11-2 위에 얹는다 |
| **B11-4 화면** | `/cutting/[planId]` 배치 그림에 선택 모드(레이저 그룹 / 가로선 / 필름)를 넣는다 | 중간. 드래그 선택은 절곡 편집기에 있는 패턴을 쓴다 |

### 3.3 넣지 않는 것

- **`새원판추가`·`선택 병합`·`자동 병합`** — 손실 사각형을 손으로 만지는 기능이다. 웹은 잔재를 solver 결과에서 계산하고(`P2-B06`) 수동 보정은 고정 후 재실행으로 대신한다(`D2-B05-J`). 열면 잔재 집계와 어긋난다
- **인쇄 4종** — `P2-B07` PDF·작업표 범위다
- **여러 수주를 묶는 재단** — MFC 에 없다. `D2-B05-I` (나)·`D2-B06-I` 는 이 작업과 무관한 별개 논점으로 남긴다. 필요하면 따로 연다
- **박스(`CutPro`) 부품 DXF** — 웹 절곡 문서의 박스 패널(`P1-12`)이 재단 부품으로 어떻게 내려오는지 먼저 확인해야 한다. 이번 범위에서 뺀다

## 4. 사용자 결정이 필요한 항목

### `D2-B11-A` 이 기능을 실제로 쓰는 고객이 있는가

MFC 에서 `Prog1` 라이선스에만 열려 있다. 레이저 장비를 함께 쓰는 현장에서만 의미가 있다.

| 안 | 결과 |
|---|---|
| (가) 쓰는 고객이 있다 → 진행 | 3.2 순서로 착수한다 |
| (나) 지금은 없다 → 보류 | B11-1 재단 DXF 만 `P2-B09` 대량 DXF 안에 넣고 그룹 지정은 닫는다 |

**어느 고객이 레이저 장비를 쓰는지 알아야 한다.** 이것이 정해지지 않으면 다른 항목은 의미가 없다.

### `D2-B11-B` 장비용 DXF 의 레이어·파일명 규칙을 MFC 그대로 따를 것인가

| 안 | 결과 |
|---|---|
| **(가) MFC 규칙 그대로** (권장) | 현장 장비 설정을 바꾸지 않아도 된다. `-b-1.20-WHITE`, `-L-`, `-X-`, `-V-150` 같은 이름이 그대로 나간다 |
| (나) 웹에서 새로 정한다 | 이름은 깔끔해지지만 장비 쪽 설정을 같이 바꿔야 하고 검증할 실물이 필요하다 |

(가)를 권한다. 단 **MFC 로 낸 실제 DXF 파일 한 벌**이 필요하다. 소스만으로는 좌표 원점·회전(`nBaseDraw` 0~3)·오프셋을 확신할 수 없다. 레거시 DB 에는 없으므로 현장 PC 의 `export_dxf` 폴더에서 받아야 한다.

### `D2-B11-C` 그룹 지정을 어느 개정에 붙이는가

| 안 | 결과 |
|---|---|
| **(가) 재단 개정에 붙이고 개정과 함께 잠근다** (권장) | 승인된 재단 결과와 DXF 가 1:1 로 남는다. 재실행하면 지정은 새 개정으로 옮겨 오지 않는다(부품 배치가 바뀌므로) |
| (나) 재단 작업 단위로 두고 개정과 무관하게 유지 | 재실행 뒤에도 지정이 남지만 배치가 바뀐 뒤엔 사각형이 어긋나 검증에서 대부분 걸린다 |

### `D2-B11-D` 순서 — `P2-B07`~`B10` 앞인가 뒤인가

| 안 | 결과 |
|---|---|
| (가) `P2-B09` 대량 DXF 와 합친다 | B11-1 이 B09 의 재단 DXF 가 된다. 그룹 지정(B11-2~4)은 B09 뒤에 |
| (나) 별도 작업으로 B10 뒤에 | 출력 묶음을 먼저 닫는다. 레이저 고객이 급하지 않을 때 |

`D2-B11-A` 가 (가)면 (가)를 권한다. 재단 DXF 는 어차피 B09 에 필요하고, 그룹 지정은 그 위에 얹는 작은 층이다.

## 5. 문서 정정

이 검토로 아래 기록의 전제가 틀린 것이 확인됐다. 이 작업 착수와 무관하게 바로잡아야 한다.

| 문서 | 잘못된 기록 | 정정 |
|---|---|---|
| [P0-02](./P0-02-mfc-feature-inventory.md) `F-15` | "그룹 재단" 을 재단 기능 나열에 포함 | 그룹재단 = 레이저 그룹 지정 + 장비용 DXF 라고 명시 |
| [P2-B05](./P2-B05-cutting-plan-editing.md) `D2-B05-I` | "MFC 에는 그룹 재단이 있었다" 를 여러 수주 묶음의 근거로 인용 | MFC 그룹재단은 수주를 묶지 않는다. (나)는 MFC 근거 없는 새 논점 |
| [P2-B06](./P2-B06-sheet-usage-remnant.md) `D2-B06-I` | "그룹 재단이 열리면 원가 배분을 (나)로" | 그룹재단은 원가 배분과 무관. 여러 수주 묶음이 열릴 때만 해당 |

## 6. 검토 방법

2026-09-12. MFC 소스를 `iconv -f CP949` 로 변환해 다음을 읽었다. 코드를 실행하거나 실물 DXF 를 보지는 않았다.

- `MainDlg.cpp` 툴바 구성·`OnToolBarAddGroupCut`
- `Work03Dlg.cpp` `OnBnClickedWork03BtnCutting`
- `HCuttingDlg.cpp` 1736행
- `CuttingDlg.cpp` `OnInitDialog`·`OnTimer`·`MakeSheet`·`SeperateSheetByPattern`·`GroupNumbering`·`OnGroupEditDlg`·`OnBnClickedBtnEdit`
- `CuttingGroupDlg.cpp` 전체, `CutGroupEditDlg.h`, `IDD_DLG_GROUP_MENU` 리소스
- `CommandGroupEdit.cpp` `OnLButtonUp`
- `RazorCutManager.h`
- `HiExportDxf.cpp` `Export`·`ExportPiece`·`SetPieceLine`
- `HiRectPiece.cpp` `IsSamePiece`

## 7. 관련 문서

- [P2-B03 재단 계약](./P2-B03-cutting-contract.md)
- [P2-B05 재단 작업 편집](./P2-B05-cutting-plan-editing.md)
- [P2-B06 원판 사용량·잔재](./P2-B06-sheet-usage-remnant.md)
- [P1-16 DXF 출력](./P1-16-dxf-export.md)
- [P2 실행계획](./P2-execution-plan.md)
