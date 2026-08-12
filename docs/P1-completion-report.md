# P1 완료 보고서 — 웹 기반과 절곡 핵심 업무

> 완료 기준일: 2026-07-26
>
> 상태: `DONE` — P1 구현 기준선·자동 점검 완료
>
> 담당자·검수자: 사용자 본인
>
> MFC 참조 프로젝트: `/Users/kyhoon/Library/Mobile Documents/com~apple~CloudDocs/회사/hicomtech/도면`
>
> 레거시 참조 DB: `hicomtech.biz:55021/krsteelfold2` (읽기 전용 참고, 자격증명 미기록)

## 1. 완료 요약

MFC 소스는 이식하지 않고 업무 의미와 확인 가능한 계산 규칙을 근거로 Next.js·PostgreSQL·Prisma 기반 웹서비스를 독립 재구현했다. 로그인부터 초안 저장, 계산, 템플릿 개정·게시, 제작 geometry, 3D 검토, DXF 다운로드와 감사 이력까지 P1 수직 흐름을 연결했다.

입면도는 구현하지 않았고, 기계 연동은 `기계 연동 · 예정` 비활성 항목과 DB planned 계약 자리만 둔다. SQLite는 사용하지 않는다. 운영 DB와 서버는 P2 운영 기반 작업에서 실제로 필요해지는 시점에 별도 PostgreSQL/RDS 후보를 결정한다.

## 2. 구현된 항목

| 작업 | 결과 |
|---|---|
| P1-01 | 독자 인증, Argon2id, DB session, 로그인 제한, reset/관리 CLI |
| P1-02 | 조직 경계, 사용자·부서·역할·permission, 관리자 UI/API |
| P1-03 | append-only 감사 v2, 조회·필터, 인증·관리·초안·출력 이벤트 |
| P1-04 | 기계 연동 planned Prisma 자리와 비활성 UI 항목; 실제 통신 없음 |
| P1-05~06 | MFC/웹 필드 매핑, strict 버전 문서, Decimal 문자열, migration·checksum |
| P1-07 | PostgreSQL 초안 CRUD, 자동 저장, 낙관적 잠금, 오프라인 복구 |
| P1-08 | 분류·검색·복사·개정·검토·게시·폐기·비교 라이브러리 |
| P1-09~10 | 고정 소수점 계산, FIX/RATIO, 16 각 타입, 컷·연신·양쪽 계산 제외 |
| P1-11 | 안전 수식 parser, 변수 의존성·순환 오류, 제품·구간 수식 |
| P1-12 | 원호, 교차 직선 자동 판정 박스, 연결 패널, 게시 패널 snapshot·provenance |
| P1-13 | 50단계 Undo/Redo, 단축키, 다중 화면 충돌·복구, 장시간 편집 시험 |
| P1-14 | 화면과 분리된 `manufacturing-geometry-v1`, 폐합·좌표·layer 검증 |
| P1-15 | 원호 3D, 두께·반경 제한, 선택 동기화, 자기 교차 경고 |
| P1-16 | 독립 DXF R2000 writer, mm/layer/checksum/FileAsset/감사/다운로드 |
| P1-17 | 승인 20건 유지 + 비식별 파생 100건, 합계 120건 회귀 기준선 |

모든 사용자 알림·확인·문자 입력은 공통 팝업을 사용한다. 한국어 국내 업무를 1차 범위로 하며 다국어는 후속 단계다.

## 3. 테스트 케이스와 결과

최종 명령별 수치는 전체 검증 완료 후 본 표를 기준으로 관리한다.

| 구분 | 결과 | 주요 사례 |
|---|---|---|
| Unit | `290 passed`, DB integration `32 skipped` | 계산 120 회귀, 문서 v1/v2, store, 3D, 제조 geometry, DXF, 박스 자동 바닥 판정 |
| PostgreSQL integration | `32 passed` | migration/seed, 인증, 조직 격리, 감사, 초안 잠금, 템플릿 상태 전이·패널 copy |
| TypeScript | 성공 | `tsc --noEmit` |
| ESLint | 성공 | 오류 없음 |
| Prisma | 성공 | schema valid, migration/schema 차이 없음 |
| Production build | 성공 | Prisma generate + Next.js 16.2.10 build, DXF route 포함 |
| Playwright Chromium | `17 passed` | 인증, 관리자, 저장·복구, 라이브러리, 계산, 박스 길이 0의 3D, 반응형, 단축키, DXF |

대표 사용자 테스트는 [P1 화면 테스트 가이드](./P1-screen-test-guide.md)를 따른다.

## 4. 완료 판정과 남은 수동 검증

P1 코드·DB 계약·자동 검증 기준선은 완료했다. 다음 두 항목은 개발 환경에서 거짓 완료 처리하지 않고 사용자 직접 검수로 남긴다.

1. Windows 현장 프로그램에서 대표 DXF를 열어 mm, 좌표, 원점, 외곽 폐합, 레이어를 확인한다.
2. Chrome/Edge 실제 화면에서 원호·박스·패널·3D WebGL의 시인성과 업무 의미를 최종 확인한다.

이 수동 검증에서 차이가 나오면 `PARITY_REQUIRED`, `LEGACY_DEFECT`, `WEB_IMPROVEMENT`, `RULE_CHANGE`로 분류하고 P2의 첫 보정 작업으로 등록한다. MFC 일치 자체를 합격 기준으로 삼지 않는다.

## 5. 다음 계획

P2는 운영 가능성과 실제 제작 연결을 우선한다.

1. 회사·사업장, 거래처·현장, 재질·두께·규칙·원판·가격 기준정보
2. 수주와 절곡 문서 연결, 불변 계산 스냅샷, 승인·생산 상태 흐름
3. 작업 queue와 DXF/PDF binary용 object storage, 재다운로드·보존 정책
4. 독립 재단 solver, 생산 편집, PDF·라벨·대량 DXF
5. 실제 제작 표본 기반 공차·차이 회귀군 확대
6. 레거시 데이터 이전·대조와 운영 배포·보안·관측·복구 훈련
7. 운영 서버·PostgreSQL/RDS 등은 필요한 작업 착수 직전에 결정
8. 실제 기계 Agent·통신은 P3에서 구현하고 P2에서는 planned 상태 유지
9. 국내 완료 후 문자열 catalog와 다국어 지원 검토

입면도는 계속 제외 범위이며, 별도 사용자 결정 없이는 P2에도 넣지 않는다.
