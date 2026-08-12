# P1-16 — 제작용 DXF 출력

> 상태: `DONE` — 웹 구현·자동 검증 완료, Windows 현장 프로그램 열기 검수는 사용자 수행
>
> 담당·검수: 사용자 본인
>
> MFC 참조 프로젝트: `/Users/kyhoon/Library/Mobile Documents/com~apple~CloudDocs/회사/hicomtech/도면`

## MFC 근거와 웹 결정

MFC `HiExportDxf.cpp::NewDxfFile`은 dxflib의 `DL_Codes::AC1015`를 사용한다. 웹은 라이선스와 실행 구조가 다른 dxflib 코드를 복사하지 않고 ASCII DXF writer를 독립 구현했다.

| 항목 | P1 기준 |
|---|---|
| 버전 | DXF R2000, `$ACADVER=AC1015` |
| 단위 | mm, `$INSUNITS=4`, `$MEASUREMENT=1` |
| 문자 코드 선언 | `$DWGCODEPAGE=ANSI_949`; entity와 메타 주석은 ASCII 안전 범위 |
| entity | `LINE`, `ARC` |
| 레이어 | `CUT`, `PANEL_CUT`, `V_CUT`, `A_CUT`, `BEND`, `PROFILE_REFERENCE` |
| 무결성 | UTF-8 byte 기준 SHA-256, byte size, entity count |

`POST /api/v1/fold-exports/dxf`는 로그인·`output.print` 권한·허용 Origin을 검사하고, 조직 범위의 저장 revision을 다시 읽어 checksum을 검증한 후 제작 geometry와 DXF를 생성한다. 응답은 바로 다운로드하며 `FileAsset(kind=DXF, status=READY)`에는 checksum·크기·버전·레이어·원본 revision 메타데이터를 기록한다. `fold.dxf_exported` 감사 이벤트도 남긴다.

P1에서는 object storage를 두지 않으므로 `FileAsset.metadata.delivery=DIRECT_RESPONSE`이다. 재다운로드 가능한 binary 보관과 lifecycle은 P2 object storage 작업에서 구현한다.

## 사용자 현장 검수

1. 일반, V-CUT/A-CUT 혼합, 박스, 패널 대표 초안을 각각 저장한다.
2. `DXF 출력`을 눌러 공통 성공 팝업의 SHA-256과 파일명을 확인한다.
3. Windows 현장 프로그램에서 열어 단위가 mm인지, 외곽이 닫혔는지, 레이어와 원점·좌표가 맞는지 확인한다.
4. 장비별 색상·레이어명·원점 규칙이 다르면 실제 전송을 구현하지 말고 P2 장비 adapter 요구사항으로 기록한다.

Windows 실행 환경이 현재 개발 환경에 없다는 기존 합의에 따라 3번은 자동 완료로 기록하지 않는다.
