# P2-B11 — 그룹재단 (재단 배치 편집기와 원판별 장비용 DXF)

> 상태: `READY` — 2026-09-12 사용자 결정 `A~H` 완료. 착수 조건: MFC 실제 DXF 파일 확보(`D2-B11-B`)와 상세 설계
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

## 4. 웹 확정안

### 4.1 지금 웹에 있는 것과 없는 것

| 있는 것 | 위치 |
|---|---|
| 재단 작업(`CuttingPlan`) — 입력 스냅샷·결과 JSON·개정·승인·잠금 | [P2-B05](./P2-B05-cutting-plan-editing.md), `src/server/cutting` |
| 원판이 이미 낱장 (`sheets[]` 에 count 없음) | `src/domain/cutting/schema.ts` |
| 부품 ID = 수주 항목 ID → 절곡 스냅샷 → 제작 geometry(V-cut 레이어 포함) | `cutting-input-builder.ts`, `src/domain/manufacturing-geometry` |
| 전개도 DXF 출력과 DXF writer | `src/server/dxf`, [P1-16](./P1-16-dxf-export.md) |
| 저장 전 검증(guillotine·겹침·kerf·수량) | `src/domain/cutting/validate.ts` |
| 원판별 배치 그림(보기 전용) | `/cutting/[planId]` |

| 없는 것 | 이 작업에서 만든다 |
|---|---|
| 배치를 손으로 옮기는 편집기 | 4.2 |
| 새 원판 추가·빈 원판 삭제·원판 간 이동 | 4.2 |
| 레이저 그룹·가로선·필름 지정과 그 저장 | 4.2·4.3 |
| 재단 결과 원판 DXF | 4.4 |

`D2-B05-J` 는 2026-08-23 에 "(가) 고정하고 다시 돌린다" 로 확정하면서 "(다) 좌표를 직접 끌어 옮긴다" 를 뺐고, *"좌표까지 지정해야 할 일이 실제로 생기면 그때 (다)를 다시 연다"* 고 적었다. **이 작업이 그 (다)를 연다.** 고정 후 재실행은 그대로 남기고, 그 위에 직접 편집을 더한다.

### 4.2 편집기

| 항목 | 확정안 |
|---|---|
| 진입 | `/cutting/[planId]` 의 현재 개정에서 `편집`. 승인된 개정은 잠금 해제 후에만(`D2-B05-G`) |
| 화면 | 한 화면. 원판을 나란히 보여 주고 부품을 끌어 원판 안·원판 사이로 옮긴다. 미배치 부품 목록에서 원판으로 끌어 넣는다. 부품 회전(허용된 경우만) |
| 새 원판 추가 | 입력 스냅샷의 원판 후보(`cuttingInput.sheets`) 중에서 고른다. 스냅샷 밖 규격은 못 넣는다 — 승인된 재단을 그때 입력으로 설명할 수 있어야 한다(`D2-B05-D`) |
| 빈 원판 삭제 | 부품이 없는 원판만. 마지막 한 장은 남긴다 |
| 레이저 그룹 | 부품 여러 개를 선택해 묶는다. 같은 종류(같은 수주 항목, 같은 회전)만 허용하고, 묶음이 하나의 사각형을 이루어야 한다 |
| 가로 절단선 | 원판 위 y 좌표 하나. 부품을 가로지르면 거부 |
| 필름 | 원판 단위 on/off |
| 저장 | 새 개정으로 쌓는다(`D2-B05-H`). 편집 개정은 `source: MANUAL_EDIT` 로 표시해 solver 결과와 구분한다 |
| 검증(`D2-B11-G`) | **겹침·원판 경계 이탈·trim 침범·수량 불일치는 저장 거부.** guillotine(직선 관통)과 kerf 미달은 **경고**로 보여 주되 저장은 허용한다 |
| 재실행 | 편집 개정에서도 고정 후 재실행을 할 수 있다. 그러면 새 solver 개정이 생기고 지정(그룹·선·필름)은 넘어오지 않는다(`D2-B11-C`) |

### 4.3 저장 모델

`CuttingPlan` 개정의 결과 JSON(`cuttingResult`) 옆에 `annotations` 를 둔다(`D2-B05-K` (가), migration 은 컬럼 하나).

```
annotations: {
  version: "cutting-annotations-v1",
  laserGroups: [{ sheetIndex, partPlacementIds[] }],
  horizontalCutLines: [{ sheetIndex, yMm }],
  sheets: [{ sheetIndex, film: boolean }],
}
```

편집으로 바뀐 배치 자체는 `cuttingResult.sheets[].placements` 에 그대로 쓴다. 계약을 바꾸지 않는다. 승인되면 개정과 함께 잠긴다(`D2-B11-C`).

### 4.4 DXF 출력

| 항목 | 확정안 |
|---|---|
| 단위 | 원판 하나 = 파일 하나. 개정 전체를 내려받으면 zip |
| 이름 | `{yymmdd}-{순번:02}-{A,B,…}.dxf`. 순번은 조직·날짜 기준 일련번호. 필름이면 `F` 접두. MFC 규칙 그대로(`D2-B11-B`) |
| 내용 | 원판 외곽, 부품 외곽 절단선, **부품 안 절곡선(V-cut)**(`D2-B11-F`). 절곡선은 부품의 제작 geometry 를 배치 좌표·회전으로 옮겨 그린다 |
| 레이어 | `-b-{두께}-{색상}` · `-L-`/`-X-` (필름 `-L1-`/`-X1-`) · `-V-{깊이×100}`/`-V1-` · 레이저 그룹 안쪽 `- -` |
| 그룹 파일 | 레이저 그룹마다 `…-{A}-{번호}.dxf` 에 첫 부품 전개도. 기존 전개도 DXF 출력을 재사용 |
| 보관 | `P2-B02` 저장소에 `FileAsset` 으로 남기고 감사 기록 |
| 합격 기준 | MFC 로 낸 실제 DXF 와 좌표·레이어·파일 구성이 일치 |

### 4.5 묶음 순서

한 작업 안에서 순서만 나눈다(`D2-B11-H` (다) — 처음부터 같이).

| 순서 | 내용 |
|---|---|
| B11-1 | 편집기 — 배치 이동·원판 추가/삭제·미배치 투입·저장·검증·개정 |
| B11-2 | 원판 DXF — 레이어 규칙·절곡선·파일명·zip·보관 |
| B11-3 | 지정 — 레이저 그룹·가로선·필름의 편집·저장·DXF 반영·그룹 파일 |
| B11-4 | 검수 가이드와 MFC DXF 대조 |

### 4.6 넣지 않는 것

- **손실 사각형 편집(`선택 병합`·`자동 병합`·`기초 계산`)** — 웹은 손실을 배치에서 계산한다(`P2-B06`). 표시만 있으면 된다
- **인쇄 4종** — `P2-B07`
- **여러 수주를 묶는 재단** — `D2-B05-I` (나). 별개 논점
- **박스(`CutPro`) 부품 별도 파일** — 웹 제작 geometry 가 박스 패널을 어떻게 내는지 확인 뒤 판단

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
| 상세 설계 | API(편집 개정 저장·DXF 생성 작업), `annotations` 스키마와 검증, 편집기 상호작용(드래그·스냅·회전·선택), `MANUAL_EDIT` 개정 표시, 화면 검수 항목 |

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
