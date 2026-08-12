# P1-09 — Decimal 계산 정책과 화면 검증

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
> 선행 기준선: [P0-07 비기능 요구사항과 허용 오차](./P0-07-nfr-and-tolerance.md)
>
> MFC 참조 프로젝트: `/Users/kyhoon/Library/Mobile Documents/com~apple~CloudDocs/회사/hicomtech/도면`

## 1. 목표와 종료 조건

JavaScript `number`의 이진 부동소수점 오차를 승인 계산 경계에서 제거하고, 길이·보정·면적의 단위와 처리 시점을 하나의 공용 계산 모듈로 고정한다. 브라우저 preview와 향후 서버 승인 계산은 같은 `decimal-v1` 모듈을 사용한다.

종료 조건은 다음과 같다.

- 길이·보정은 mm 소수 6자리까지 정확히 유지한다.
- 면적은 m² 소수 8자리의 canonical Decimal 결과를 만든다.
- half 값은 부호와 관계없이 0에서 먼 방향으로 반올림한다.
- FIX 중간 보정값은 반올림하지 않고 최종 구간 길이에만 사용자 처리를 적용한다.
- `floor`/`ceil` wire 값의 실제 의미를 화면과 코드에서 오해 없이 구분한다.
- 기존 WEB-REFERENCE 20건과 신규 경계값 자동 시험을 모두 통과한다.
- 사용자가 로컬 화면에서 처리 방식별 결과 차이를 재현할 수 있다.

## 2. MFC 조사와 웹 재구현 판단

| 근거 | 확인 내용 | 웹 판단 |
|---|---|---|
| `_common.cpp::Gn_MathRound` | half 값을 0에서 먼 방향으로 처리 | 같은 업무 규칙을 정확한 Decimal로 유지 |
| `_common.cpp::Gn_MathFloor` | 음수에는 `ceil`을 사용해 0 방향으로 버림 | 저장 wire 값 `floor` 유지, 화면은 `버림 (0 방향)`으로 명시 |
| `_common.cpp::Gn_MathCeil` | 음수도 절댓값이 커지는 방향으로 올림 | 저장 wire 값 `ceil` 유지, 화면은 `올림 (0에서 먼 방향)`으로 명시 |
| `Work03Dlg.cpp::Fn_CalcLenW_SellFold` | 각 구간 계산 후 설정 소수점 처리 | 구간 최종 길이에만 적용하는 경계 유지 |
| `Work03Dlg.cpp::Fn_CalcLenW_SellFold_Count` | 역방향 집계에도 동일 처리 | 공용 helper로 방향과 무관하게 같은 정책 적용 |

MFC의 실행 순서·전역 설정·`double` 구현은 복제하지 않는다. 레거시 함수의 업무 의미만 참고하고, 웹에서 경계값이 재현 가능하도록 BigInt 기반 고정 소수점 연산으로 독립 구현한다.

## 3. D1-09 확정 기준

새 사용자 선택이 필요한 정책은 없다. 아래 항목은 이미 승인된 P0-07, FIX 소수 보존, 양쪽 계산 제외, `angle < cutAngle` 기준을 구현 수준으로 구체화한 것이다.

| ID | 확정 기준 |
|---|---|
| `D1-09-A` | 문서·API Decimal은 canonical 10진 문자열 |
| `D1-09-B` | 계산 core는 BigInt 계수+scale 고정 소수점 |
| `D1-09-C` | 길이 scale 6, 각도 scale 4, 면적 scale 8 |
| `D1-09-D` | half away from zero |
| `D1-09-E` | `floor` wire = 0 방향 버림 |
| `D1-09-F` | `ceil` wire = 0에서 먼 방향 올림 |
| `D1-09-G` | 사용자 소수 처리는 각 구간 최종 길이에만 적용 |
| `D1-09-H` | 합계는 처리된 구간 Decimal을 정확히 합산 |
| `D1-09-I` | FIX 중간 보정값 소수 6자리 보존 |
| `D1-09-J` | 계산 제외는 절곡 양쪽, RATIO는 `angle < cutAngle` 유지 |
| `D1-09-K` | 결과에 엔진 버전 `decimal-v1` 포함 |
| `D1-09-L` | 자동 시험과 사용자 화면 검수를 분리 |

## 4. 구현 구성

| 위치 | 역할 |
|---|---|
| `src/domain/calculation-decimal.ts` | parse·정규화·사칙 연산·처리 방식·면적 단위 변환·표시 helper |
| `src/domain/fold-calculation.ts` | FIX/RATIO 계산을 Decimal helper에 연결하고 숫자 호환값과 canonical 문자열을 함께 반환 |
| `src/components/canvas-workspace.tsx` | 0~6자리 설정, 명확한 처리 방식 명칭, 엔진 정책 안내, 설정과 일치하는 결과 표시 |
| `src/stores/fold-editor-store.ts` | 문서 계약과 같은 0~6자리 편집 허용 |

`number` 결과 필드는 현재 geometry·UI 호환을 위해 유지한다. 운영 승인값의 기준은 같은 결과 객체의 `*Decimal` 문자열이며, 향후 서버 승인 snapshot도 이 값을 저장한다.

## 5. 처리 순서

```text
입력 number → scale 검증된 canonical Decimal
→ 이전/다음 절곡 보정 Decimal 합산
→ 수동 보정 또는 자동 보정 선택
→ 입력 길이에서 정확히 차감
→ 구간 최종 길이에만 round/truncate/expand 적용
→ 처리된 구간 결과를 Decimal 합산
→ mm²를 m²로 변환
→ 면적 scale 8에서 half-away 반올림
```

## 6. 자동 검증 범위

- `0.1 + 0.2 = 0.3` 정확 일치
- `±1.005`를 2자리에서 `±1.01`로 반올림
- 음수 `floor`가 0 방향, 음수 `ceil`이 0에서 먼 방향임을 확인
- FIX 6자리 보정이 최종 구간 처리 전까지 보존됨을 확인
- 면적 mm²→m²와 수량 합계 canonical 결과 확인
- WEB-REFERENCE 20건 결과 유지
- TypeScript, ESLint, 전체 단위·통합·Playwright·production build

### 6.1 2026-07-25 자체 검증 결과

| 검증 | 결과 |
|---|---|
| 단위 시험 | `146 passed`, 기존 WEB-REFERENCE 20건 포함 |
| PostgreSQL 통합 시험 | `32 passed` |
| Playwright Chromium | `7 passed`, Decimal 화면 경계값 1건 포함 |
| 정적 검증 | ESLint 경고·오류 없음, TypeScript 통과 |
| production build | Next.js 16.2.10 build 통과 |
| Prisma migration drift | 차이 없음 |
| 실제 로컬 브라우저 | 고정 계정 로그인, `230.00 / 229.99 / 230.01 mm` 확인 |
| 브라우저 오류 | console error 0건, 활성 native dialog 없음 |

## 7. 사용자 화면 테스트 케이스

로컬 서버와 고정 계정은 [로컬 화면 테스트 계정](../local-screen-test-account.md)을 사용한다.

### TC-P1-09-01 정책 표시와 선택 범위

1. 로그인 후 저장된 초안이 아닌 첫 예제 화면을 연다.
2. 오른쪽 `연신율 설정`을 누른다.
3. `계산 소수점`에 0~6자리가 모두 있는지 확인한다.
4. `처리 방식`에 처리 안 함, 반올림, 버림(0 방향), 올림(0에서 먼 방향)이 있는지 확인한다.
5. 하단에 `정확한 Decimal 계산 · decimal-v1`과 최종 구간 적용 안내가 표시되는지 확인한다.

### TC-P1-09-02 경계값 처리 비교

1. 같은 화면의 `V-CUT` 연신율을 `1.005001`로 입력한다.
2. `계산 소수점`을 `2자리`로 선택한다.
3. 처리 방식을 바꾸며 `최종 전개 폭`을 확인한다.

| 처리 방식 | 기대값 |
|---|---:|
| 반올림 | `230.00 mm` |
| 버림 (0 방향) | `229.99 mm` |
| 올림 (0에서 먼 방향) | `230.01 mm` |

### TC-P1-09-03 중간값 보존

1. 첫 번째 선을 선택하고 `연신율 설정`에서 `V-CUT=1.005001`을 유지한다.
2. `선 속성`으로 돌아간다.
3. `자동 계산`이 `1.005001 mm`로 표시되는지 확인한다.
4. 소수점 설정을 바꿔도 자동 보정 원본은 유지되고 최종 전개 폭만 정책에 따라 바뀌는지 확인한다.

## 8. 완료 판정

- 자체 자동·브라우저 검증과 사용자 화면 검수를 통과했다.
- 2026-07-25 사용자 승인에 따라 `DONE`으로 확정했다.
- 후속 작업은 [P1-10 전체 각 타입·연신](./P1-10-bend-types-and-elongation.md)이다.
