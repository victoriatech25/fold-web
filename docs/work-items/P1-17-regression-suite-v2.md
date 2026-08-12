# P1-17 — 확대 회귀 세트

> 상태: `DONE` — 자동 기준선 확정 (2026-07-26)
>
> 담당·검수: 사용자 본인
>
> MFC 참조 프로젝트: `/Users/kyhoon/Library/Mobile Documents/com~apple~CloudDocs/회사/hicomtech/도면`

## 구성

기존 사용자 승인 `WEB-REFERENCE-V1` 20건을 변경하지 않고, `WEB-REFERENCE-V2 derived regression` 100건을 추가해 합계 120건으로 확대했다.

| 회귀군 | 수 | 독립 기대값 |
|---|---:|---|
| 기존 승인 fixture | 20 | 사용자 승인 구간값·총폭·면적 |
| 직선 Decimal 분포 | 40 | 입력합=계산폭, 독립 면적식 |
| FIX V-CUT 양쪽 보정 | 30 | 총 보정 2.4 mm, 계산폭=입력합-2.4 |
| 양쪽 계산 제외 | 30 | 총 보정 0, 계산폭=입력합 |

100개 파생 사례는 `PARITY_REQUIRED`, `LEGACY_DEFECT`, `WEB_IMPROVEMENT`, `RULE_CHANGE` 네 분류를 모두 포함하고 `UNRESOLVED`를 허용하지 않는다. ID는 `WR2-*`이며 고객명·전화·주소·비밀번호 등 식별 정보를 포함하지 않는지 자동 검사한다.

원호, 박스, 패널, 제조 geometry, DXF, 3D 반경·교차는 해당 도메인 시험에서 별도로 검증한다. 파생 100건은 MFC 실행 관측값이라고 주장하지 않으며 승인된 웹 수학 규칙의 경계·분포 회귀군이다.

## 종료 판단

- 기존 20건 결과 불변
- 신규 100건 전부 통과, ID 유일, 차이 분류 완료
- 전체 unit suite에서 계산·문서·geometry·3D·DXF 회귀 동시 통과
- 실제 제작 결과와 다른 사례가 나오면 무조건 MFC에 맞추지 않고 네 분류 중 하나로 판정해 새 승인 기대값을 추가
