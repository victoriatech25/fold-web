# P2-A01 — 회사·사업장 기준정보

> 상태: `VERIFYING` — 구현·자동 검증 완료, 사용자 화면 검수 대기
>
> 우선순위: `P2`
>
> 담당자: 사용자 본인
>
> 검수자: 사용자 본인
>
> 관련 게이트: `G2-1`
>
> 계획 작성일: 2026-07-26
>
> 착수일: 2026-07-26
>
> 상위 실행계획: [P2 실행계획](./P2-execution-plan.md)
>
> MFC 참조 루트: `/Users/kyhoon/Library/Mobile Documents/com~apple~CloudDocs/회사/hicomtech/도면`

## 1. 목표

로그인한 관리자가 회사 기본정보와 하나 이상의 사업장을 서버에서 관리하고, 이후 거래처·수주·출력의 기준 사업장을 일관되게 선택할 수 있게 한다.

## 2. 현재 상태와 설계 방향

- 현재 `Organization`은 로그인·권한의 회사 경계로 이미 사용 중이다.
- `CompanyProfile`은 회사 부가정보 자리만 있으며 관리 API와 화면이 없다.
- 고객의 공사 현장을 뜻하는 기존 `Site`는 회사 사업장과 의미가 다르므로 재사용하지 않는다.
- 새 `BusinessSite`를 회사의 사업장·공장·영업소 단위로 둔다.
- 운영 서버와 운영 DB 결정은 이 작업 범위가 아니다. 로컬 PostgreSQL에서 Prisma migration을 검증한다.
- 레거시 DB는 필드 의미와 표본 확인에만 사용하고 현재 schema를 그대로 복제하지 않는다.

## 3. 포함·제외

### 포함

- 회사명, 사업자등록번호, 대표자, 연락처, 이메일과 주소 관리
- 사업장 코드·명칭·유형·연락처·주소·기본 사업장 관리
- 조직별 조회·수정 권한, 낙관적 잠금, 감사 이벤트
- 관리자 화면의 목록·추가·수정·비활성화와 공통 팝업
- 로컬 PostgreSQL migration, API 통합 테스트와 화면 E2E

### 제외

- 거래처·고객 현장: `P2-A02`
- 사업장별 재고·창고·가격: `P2-A05` 이후
- 세금계산서·회계·전자문서 연동
- 운영 인프라와 외부 주소 검색 서비스
- 실제 기계·장비 연결

## 4. 권장 결정안

2026-07-26 사용자가 `D2-A01-A~L` 권장안 전체를 승인했다.

| ID | 권장안 | 이유 |
|---|---|---|
| `D2-A01-A` | `Organization`을 회사·tenant 경계로 유지한다. | 기존 인증·권한·감사 구조를 보존한다. |
| `D2-A01-B` | 회사 상세는 조직당 하나의 `CompanyProfile`로 관리한다. | 이미 준비된 1:1 계약을 활용한다. |
| `D2-A01-C` | 회사 사업장은 별도 `BusinessSite` 모델로 만든다. | 고객 현장 `Site`와 의미·수명이 다르다. |
| `D2-A01-D` | 조직에는 활성 기본 사업장이 정확히 하나 존재하게 한다. | 수주·출력 기본값을 결정적으로 선택한다. 최초 seed 사업장을 만든다. |
| `D2-A01-E` | 사업장 유형은 `HEAD_OFFICE`, `FACTORY`, `BRANCH`, `OTHER`로 시작한다. | 국내 업무에 필요한 최소 구분이며 표시명은 한국어로 제공한다. |
| `D2-A01-F` | 회사·사업장 코드는 조직 내 고유, 앞뒤 공백 제거·대문자 정규화한다. | 검색·이전·외부 식별자의 중복을 방지한다. |
| `D2-A01-G` | 참조된 사업장은 삭제하지 않고 비활성화한다. 기본 사업장은 먼저 다른 곳으로 변경해야 한다. | 수주·출력 이력의 참조를 보존한다. |
| `D2-A01-H` | `master_data.read`, `master_data.manage` permission을 사용한다. | 조회와 변경 권한을 분리한다. 시스템 관리자 역할에는 둘 다 부여한다. |
| `D2-A01-I` | `lockVersion` 기반 낙관적 잠금과 `409 CONFLICT`를 적용한다. | 여러 관리자 편집의 덮어쓰기를 막는다. |
| `D2-A01-J` | 모든 변경은 `DATA_CHANGE` 감사 이벤트에 전후 값을 기록한다. | P1 감사 기준선을 그대로 확장한다. |
| `D2-A01-K` | 비밀번호·DB 접속정보 등 secret은 회사 설정에 저장하지 않는다. | 기준정보와 운영 secret의 책임을 분리한다. |
| `D2-A01-L` | 주소는 우선 직접 입력하고 우편번호 검색 연동은 별도 후속 작업으로 둔다. | 외부 서비스 결정을 막지 않고 핵심 흐름을 완성한다. |

## 5. 데이터베이스·Prisma 계획

### 기존 모델 보완

- `Organization`: `lockVersion` 추가 검토
- `CompanyProfile`: 회사 표시명 외 부가정보, `lockVersion` 추가
- 빈 조직에 대해 `CompanyProfile`을 upsert할 수 있게 한다.

### 신규 모델 `BusinessSite`

예정 필드:

- `id`, `organizationId`
- `code`, `name`, `type`
- `businessRegistrationNumber` 선택값
- `representativeName`, `phone`, `email` 선택값
- `postalCode`, `addressLine1`, `addressLine2` 선택값
- `isDefault`, `active`, `lockVersion`
- `createdAt`, `updatedAt`, `deletedAt`

핵심 제약:

- `(organizationId, code)` unique
- 조직·활성·명칭 조회 index
- 기본 사업장 단일성은 PostgreSQL partial unique index로 보장하고 application transaction에서도 검증
- 기본 사업장 전환은 한 transaction에서 기존 기본값 해제와 새 기본값 지정을 수행
- 참조 데이터는 `onDelete: Restrict`

## 6. API·권한·감사 계획

| 용도 | API |
|---|---|
| 회사정보 조회·수정 | `GET/PATCH /api/v1/company-profile` |
| 사업장 목록·생성 | `GET/POST /api/v1/business-sites` |
| 사업장 조회·수정 | `GET/PATCH /api/v1/business-sites/{id}` |
| 기본 사업장 지정 | `POST /api/v1/business-sites/{id}/default` |

- 모든 endpoint는 로그인, 활성 membership과 조직 경계를 검증한다.
- 조회는 `master_data.read`, 변경은 `master_data.manage`가 필요하다.
- 생성·수정·기본 사업장 전환·비활성화에 감사 이벤트를 남긴다.
- validation 오류는 공통 API 오류 계약으로 반환하고, 동시성 충돌은 최신 데이터 재조회 동작을 제공한다.

## 7. UI 계획

- 관리자 영역에 `회사·사업장` 메뉴 추가
- 상단 회사정보 카드와 하단 사업장 목록으로 구성
- 사업장 검색, 활성 상태 filter, 기본 사업장 badge 제공
- 추가·수정은 반응형 편집 패널 또는 공통 팝업을 사용
- 비활성화·기본 사업장 변경 확인은 공통 팝업 사용
- loading·empty·error·권한 없음·동시 수정 충돌 상태 제공
- 390px~1920px에서 가로 넘침 없이 동작

## 8. 상세 실행 단계

| 단계 | 상태 | 작업 | 검증 |
|---|---|---|---|
| `A01-01` | `DONE` | 현재 Prisma·permission·관리자 UI 패턴 재확인 | 설계 대조 |
| `A01-02` | `DONE` | 레거시 DB 회사·사업장 관련 표본을 비식별 조사 | `company` 1건, `sitee` 2,264건과 필드 의미 확인 |
| `A01-03` | `DONE` | runtime schema·API 오류·permission 계약 테스트 작성 | 단위 테스트 통과 |
| `A01-04` | `DONE` | Prisma 모델·migration·seed 작성 | 빈 DB reset·기존 DB upgrade·diff 통과 |
| `A01-05` | `DONE` | repository·service·API·감사 구현 | PostgreSQL 통합 36건 통과 |
| `A01-06` | `DONE` | 회사·사업장 관리자 화면 구현 | 공통 팝업·권한별 탐색 확인 |
| `A01-07` | `DONE` | 기본 사업장·비활성·충돌·타 조직 거부 보완 | 실패 시나리오 통과 |
| `A01-08` | `DONE` | Playwright 수직 흐름과 반응형 테스트 | 전체 Chromium 18건 통과 |
| `A01-09` | `READY` | 자동 검증 완료 후 사용자 화면 테스트 가이드 제공 | [화면 테스트 가이드](../P2-A01-screen-test-guide.md) |
| `A01-10` | `TODO` | 승인 결과·잔여 위험·다음 A02 계획 반영 | 완료 문서 |

## 9. 테스트 계획

| 종류 | 핵심 사례 | 완료 기준 |
|---|---|---|
| 단위 | 코드 정규화, 필드 validation, 상태 규칙 | 경계값·한국어 입력 통과 |
| PostgreSQL 통합 | 조직 격리, unique, 기본 사업장 단일성, 동시 수정, 감사 | transaction 불변조건 통과 |
| API | 인증·permission·404 은닉·409 충돌·오류 계약 | 허용/거부 사례 통과 |
| E2E | 회사 수정, 사업장 생성·수정·기본 변경·비활성 | 새로고침 후 유지와 공통 팝업 확인 |
| 반응형·접근성 | 390/768/1440/1920px, 키보드와 focus | 가로 넘침·focus 손실 없음 |
| 레거시 표본 | 회사·사업장 후보 필드의 의미 비교 | 복제하지 않을 필드까지 분류 |

## 10. 완료 기준

- 승인된 `D2-A01-A~L`이 코드·DB·화면·문서에 일치한다.
- 회사정보와 복수 사업장이 로컬 PostgreSQL에 저장되고 재로그인 후 복원된다.
- 활성 기본 사업장이 정확히 하나이며 동시 요청에서도 불변조건이 유지된다.
- 권한 없는 사용자와 타 조직 접근이 차단되고 변경 감사가 남는다.
- lint, typecheck, 단위·통합·E2E, Prisma validate와 migration 검사가 통과한다.
- 사용자 화면 검수 후 작업을 `DONE`으로 변경하고 `P2-A02` 상세계획을 작성한다.
