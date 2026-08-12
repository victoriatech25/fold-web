# P1-10 — 전체 각 타입·연신 계산

> 상태: `DONE`
>
> 우선순위: `P1`
>
> 담당자: 사용자 본인
>
> 검수자: 사용자 본인
>
> 착수일: 2026-07-25
>
> 완료일: 2026-07-25
>
> 상위 계획: [P1 실행계획](./P1-execution-plan.md)
>
> 선행 작업: [P1-09 Decimal 계산 정책](./P1-09-decimal-policy.md)
>
> MFC 참조 프로젝트: `/Users/kyhoon/Library/Mobile Documents/com~apple~CloudDocs/회사/hicomtech/도면`

## 1. 목표와 범위

P1-05에서 보존만 하던 MFC 각 타입 3~18과 FIX/RATIO, V-CUT 전환, 연신 옵션, 절곡별 계산 제외를 웹 계산과 편집 화면에서 실제 사용 가능하게 만든다.

- 포함: 앞각·뒷각, 표준·A·ZERO·U, 앞→뒤·뒤→앞 복합 절곡
- 포함: FIX/RATIO, 컷 타입, V-CUT 사용 여부, 제한각, 네 가지 연신 옵션
- 포함: 절곡별 계산 제외가 해당 절곡 양쪽 구간에 반영되는 규칙
- 포함: 서버 문서 저장·재열기와 계산/publish capability
- 제외: 특수·복합 절곡의 제작 geometry와 DXF 출력(P1-14·16)
- 제외: MFC 입면도와 MFC 실행 메커니즘

## 2. MFC 근거와 웹 재구현 판단

| 근거 | MFC 동작 | 웹 판단 |
|---|---|---|
| `_define.h::Henum_AngleType` | 3~18에 단일·A·ZERO·U·복합 타입 | 서버 문서의 순서 있는 `operations[]`로 표현 |
| `_common.cpp::Gn_Elongation_GetFixNA` | 앞각은 감산, 뒷각은 가산하나 일부 타입 누락·정수 절삭 | 모든 form은 방향 부호를 따르고 Decimal 소수를 보존 |
| `_common.cpp::Gn_Elongation_GetRatioOCW` | 앞각 `두께-깊이`, 뒷각 `-깊이`, 일부 타입 누락 | 모든 form·복합 operation에 같은 방향 규칙 적용 |
| `Work03Dlg.cpp::Fn_ConvertTo_ATZERO` | V-CUT 해제 시 ZERO 타입으로 강제 변환 | 절곡 form은 보존하고 계산 컷 값만 NO-CUT으로 전환 |
| `Fn_Compute_Elongation_crr1/3/4/ext1` | 고정 계산의 네 적용 옵션 | 업무 의미를 유지하되 잔여 소수 정수 보정은 제거 |

MFC가 A/U/복합 타입을 분기에서 누락한 부분과 FIX 소수를 정수화한 부분은 웹에 계승하지 않는다. form은 제작 형상 의미, direction은 길이 보정 부호, cutType은 재질값 선택으로 분리한다.

## 3. D1-10 구현 기준

이 기준은 승인된 P1-05 매핑, P1-09 Decimal 정책과 사용자의 독립 재구현 지시에 따른 구체화다.

| ID | 확정 기준 |
|---|---|
| `D1-10-A` | START/END는 segment 구조로 표현하고 절곡 operation으로 만들지 않음 |
| `D1-10-B` | 단일 8종과 복합 8종을 순서 있는 최대 2개 operation으로 표현 |
| `D1-10-C` | 표준/A/ZERO/U는 제작 형태이며 계산 부호는 direction으로 결정 |
| `D1-10-D` | 복합 절곡 보정은 각 operation 기여값을 Decimal로 합산 |
| `D1-10-E` | FIX 앞각은 `+연신값`, 뒷각은 `-연신값` |
| `D1-10-F` | RATIO 앞각은 `두께-컷깊이`, 뒷각은 `-컷깊이` |
| `D1-10-G` | RATIO는 `angle < cutAngle`일 때만 적용 |
| `D1-10-H` | V-CUT 해제 시 form을 바꾸지 않고 NO-CUT 재질값 사용 |
| `D1-10-I` | 계산 제외는 해당 junction 기여를 양쪽 segment에서 제거 |
| `D1-10-J` | FIX 옵션은 표준·2선·대각선·확장1, RATIO는 옵션 무관 |
| `D1-10-K` | 계산·게시에는 전체 타입을 허용하고 DXF는 P1-16까지 명시 차단 |
| `D1-10-L` | 16타입 왕복, 수치 회귀, 저장·화면 E2E를 종료 게이트로 사용 |

## 4. MFC 각 타입 매핑

| MFC | 이름 | 웹 operation |
|---:|---|---|
| 3 | FRONT | `front/standard` |
| 4 | BACK | `back/standard` |
| 5 | FRONT_A | `front/a` |
| 6 | BACK_A | `back/a` |
| 7 | FRONT_ZERO | `front/zero` |
| 8 | BACK_ZERO | `back/zero` |
| 9 | FRONT_U | `front/u` |
| 10 | BACK_U | `back/u` |
| 11~14 | BACK_FRONT 계열 | `back/form → front/form` |
| 15~18 | FRONT_BACK 계열 | `front/form → back/form` |

MFC 0(NONE), 1(START), 2(END)는 도형 구조로 판단한다.

## 5. 연신 옵션 규칙

| 옵션 | 웹 FIX 규칙 |
|---|---|
| 표준 | 각도와 무관하게 모든 유효 junction 적용 |
| 2선 | junction 각도가 제한각 미만일 때 적용 |
| 대각선 | 현재 segment가 대각이면 항상, 수평·수직이면 제한각 미만 적용 |
| 확장1 | 인접 junction에 앞각이 있으면 모든 operation을 앞각 부호로 적용; 양쪽 junction이 모두 뒷각뿐이면 미적용 |

RATIO는 모든 옵션에서 동일하며 제한각 미만 조건을 사용한다. MFC 2선의 정수 잔여 보정은 P1-09의 Decimal 정책과 충돌하므로 제거한다.

## 6. 구현 구성

| 위치 | 역할 |
|---|---|
| `src/domain/fold-profile.ts` | BendForm·BendOperation·ElongationOption과 operation helper |
| `src/domain/fold-calculation.ts` | operation 합산, 네 FIX 옵션, RATIO, 양쪽 제외 |
| `src/domain/fold-document/adapter.ts` | 전체 타입과 연신 옵션 서버 문서 왕복 |
| `src/domain/fold-document/capabilities.ts` | 계산·게시 허용, DXF 제작 형상만 차단 |
| `src/stores/fold-editor-store.ts` | 타입·옵션·제외 편집과 Undo/자동 저장 변경 감지 |
| `src/components/canvas-workspace.tsx` | 전체 설정과 계산 설명 UI |

## 7. 검증 범위

- 16개 MFC 타입의 브라우저 profile ↔ 서버 문서 무손실 왕복
- form별 FIX 수치 동일성과 복합 FIX 상쇄
- 복합 RATIO operation 합산
- V-CUT on/off와 cutType 분리
- 제한각 경계 `미만/같음/초과`
- 네 FIX 옵션과 대각 geometry 판정
- 절곡 계산 제외의 양쪽 segment 반영
- 화면에서 타입·옵션 변경 직후 결과 반영
- 서버 초안 자동 저장 후 재열기
- 전체 단위·PostgreSQL 통합·Playwright·lint·typecheck·build·migration drift

### 7.1 2026-07-25 자체 검증 결과

| 검증 | 결과 |
|---|---|
| 단위 시험 | `157 passed`, WEB-REFERENCE 20건과 16타입 왕복·구버전 호환 포함 |
| PostgreSQL 통합 시험 | `32 passed` |
| Playwright Chromium | `8 passed`, 전체 타입·연신 화면 시나리오 포함 |
| 정적 검증 | ESLint 경고·오류 없음, TypeScript 통과 |
| production build | Next.js 16.2.10 build 통과 |
| Prisma migration drift | 차이 없음 |
| 실제 로컬 브라우저 | RATIO `228.0 mm`, U형 앞→뒤 `229.0 mm` 확인 |
| 브라우저 오류 | console error 0건, 활성 native dialog 없음 |

## 8. 화면 테스트

로컬 고정 계정은 [로컬 화면 테스트 계정](../local-screen-test-account.md)을 사용한다. URL은 Origin 설정과 일치하는 `http://localhost:3000`을 사용한다.

### TC-P1-10-01 FIX/RATIO와 V-CUT

1. 로그인 후 `저장되지 않은 예제`에서 `연신율 설정`을 연다.
2. `계산 소수점=1자리`, `RATIO 비율`, `V-CUT 사용=켬`으로 설정한다.
3. 최종 전개 폭 `228.0 mm`를 확인한다.
4. V-CUT 사용을 끄면 `226.0 mm`, 다시 켜면 `228.0 mm`인지 확인한다.

### TC-P1-10-02 특수·복합 각 타입

1. `선 속성`에서 선 1을 선택한다.
2. 절곡 형태를 표준/A/ZERO/U로 바꿔도 같은 방향의 RATIO 결과가 유지되는지 확인한다.
3. `U형`, `앞각 → 뒷각`을 선택한다.
4. 최종 전개 폭이 `229.0 mm`인지 확인한다.
5. `뒷각 → 앞각`도 선택·표시되고 결과가 `229.0 mm`인지 확인한다.
6. FIX로 바꾸면 반대 방향 operation이 상쇄돼 `232.4 mm`인지 확인한다.

### TC-P1-10-03 절곡별 계산 제외

1. RATIO·V-CUT 켬 상태에서 선 1의 `연신 계산 적용`을 해제한다.
2. 해당 절곡이 양쪽 구간에서 빠져 최종 전개 폭이 `231.0 mm`인지 확인한다.
3. 다시 체크하면 이전 계산값으로 복원되는지 확인한다.

### TC-P1-10-04 네 FIX 옵션

1. 선 1을 `앞각`, `단일 절곡`, 각도 `140°`로 설정한다.
2. `연신율 설정`에서 FIX와 다음 옵션을 순서대로 선택한다.

| 옵션 | 기대 최종 전개 폭 |
|---|---:|
| 표준 · 항상 적용 | `230.0 mm` |
| 2선 · 제한각 미만 | `232.4 mm` |
| 대각선 우선 | `232.4 mm` |
| 확장1 · 앞각 우선 | `227.6 mm` |

현재 선 1은 수평이므로 대각선 옵션에서 제한각 규칙을 사용한다.

### TC-P1-10-05 서버 저장·재열기

1. 새 초안을 만들고 두 번 이상 꺾인 선을 그린다.
2. 첫 절곡에 U형 복합 타입과 연신 옵션을 지정한다.
3. 상단 상태가 `저장됨`이 될 때까지 기다린다.
4. 페이지를 새로고침해 타입·구성·연신 옵션·계산 제외 상태가 유지되는지 확인한다.

## 9. 완료 판정

- 자동 검증과 실제 브라우저 자체 검증을 모두 통과했다.
- 2026-07-25 사용자 검수 승인을 받아 `DONE`으로 확정하고 P1-11 변수·수식으로 진행했다.
