# P1-02 — 조직·사용자·RBAC

> 상태: `DONE`
>
> 우선순위: `P1`
>
> 담당자: 사용자 본인
>
> 검수자: 사용자 본인
>
> 관련 게이트: `D1-02`
>
> 계획일: 2026-07-19
>
> 상위 계획: [P1 실행계획](./P1-execution-plan.md)
>
> 선행 작업: [P1-01 독자 인증·세션](./P1-01-authentication-session.md)
>
> MFC 참조 루트: `/Users/kyhoon/Library/Mobile Documents/com~apple~CloudDocs/회사/hicomtech/도면`

## 1. 목표

P1-01의 로그인 사용자에게 조직 membership과 permission을 적용하고, 관리자가 사용자·부서·역할을 웹에서 관리하도록 한다.

완료 시 다음 보안 경계가 서버에서 보장돼야 한다.

```text
인증 session
→ 활성 사용자·활성 조직 membership
→ membership에 할당된 활성 role
→ role의 permission 합집합
→ 조직 범위와 permission을 모두 만족할 때만 업무 실행
```

화면에서 버튼을 숨기는 것은 편의 기능이며 권한 검사의 근거가 아니다. 모든 보호 API와 application service가 현재 session의 `organizationId`와 permission을 직접 검사한다.

## 2. 포함·제외 범위

### 포함

- 현재 session의 permission context
- 서버 공통 `requirePermission`·조직 경계 guard
- 현재 사용자의 화면 capability DTO
- 사용자 목록·검색·초대·상태·부서·역할 관리
- 부서 생성·수정·비활성화
- system role 조회와 custom role 생성·수정·비활성화
- 일회성 초대·비밀번호 재설정 URL
- 마지막 관리자·자기 계정 보호
- 상태 변경 시 session revoke
- 관리 변경의 최소 보안 감사
- PostgreSQL 조직 격리·권한 거부 통합 테스트
- 관리자·일반 사용자 Playwright E2E

### 제외

- 조직 생성·삭제·전환 UI
- 한 사용자의 복수 활성 조직 membership
- 공개 회원가입
- 이메일·SMS 초대 발송
- OAuth·SSO·MFA
- 세분화된 행 단위 소유자 권한
- PostgreSQL RLS
- 일반 감사 로그 검색·보존 UI
- 기계 통신

일반 감사 조회와 append-only 강화는 P1-03, 기계 연동 `planned` 표시는 P1-04에서 진행한다.

## 3. 현재 기반과 차이

### 이미 구현됨

| 기반 | 현재 상태 |
|---|---|
| `Organization` | 상태와 조직별 업무 관계 존재 |
| `Department` | 조직별 code·name·active 존재 |
| `OrganizationMembership` | 사용자·조직·부서·상태 unique 관계 존재 |
| `Role` | 조직별 key·system·active 존재 |
| `Permission` | 전역 permission key 존재 |
| `MembershipRole` | membership-role 다대다 존재 |
| `RolePermission` | role-permission 다대다 존재 |
| seed | permission 17개와 `ADMINISTRATOR` role 존재 |
| P1-01 | 인증 session에서 활성 사용자와 최초 활성 membership 확인 |
| `AuditEvent` | 인증 및 관리 변경의 최소 기록 가능 |

### 추가해야 함

- 인증 context가 role·permission을 읽지 않는다.
- 한 사용자의 복수 활성 membership을 애플리케이션에서 제한하지 않는다.
- API·service 공통 permission guard가 없다.
- 업무 repository의 `organizationId` 강제 계약이 구현되지 않았다.
- 관리자 사용자·부서·역할 API와 UI가 없다.
- 마지막 관리자 제거·자기 정지 방어가 없다.
- 관리자 초대와 reset URL 재발급 흐름이 없다.
- 역할 변경·사용자 정지의 즉시 반영 시험이 없다.

MFC 사용자·권한 구조와 계정은 이전하지 않는다. 본 기능은 현재 웹 업무와 PostgreSQL 모델을 기준으로 독립 설계한다.

## 4. 권장 역할·권한 기준

### 4.1 system role

| 역할 | 용도 | 편집 가능 여부 |
|---|---|---|
| `ADMINISTRATOR` | 사용자·권한 포함 조직 전체 관리 | 이름·권한·비활성화 금지 |
| `DESIGNER` | 거래처·절곡 문서 작성과 계산·출력 | seed 기준 고정 |
| `APPROVER` | 기준정보·템플릿·주문·절단 승인 | seed 기준 고정 |
| `VIEWER` | 업무 자료 읽기 전용 | seed 기준 고정 |

system role은 배포 seed가 동일한 권한표를 유지한다. 조직별 특수 조합은 custom role을 새로 만들어 적용한다.

### 4.2 permission matrix

| permission | 관리자 | 설계자 | 승인자 | 조회자 |
|---|:---:|:---:|:---:|:---:|
| `customer.read` | ✓ | ✓ | ✓ | ✓ |
| `customer.write` | ✓ | ✓ | ✓ |  |
| `material.read` | ✓ | ✓ | ✓ | ✓ |
| `material.write` | ✓ |  | ✓ |  |
| `material.approve` | ✓ |  | ✓ |  |
| `template.fold.read` | ✓ | ✓ | ✓ | ✓ |
| `template.fold.edit` | ✓ | ✓ | ✓ |  |
| `template.fold.publish` | ✓ |  | ✓ |  |
| `order.read` | ✓ | ✓ | ✓ | ✓ |
| `order.edit` | ✓ | ✓ | ✓ |  |
| `order.calculate` | ✓ | ✓ | ✓ |  |
| `order.approve` | ✓ |  | ✓ |  |
| `cutting.optimize` | ✓ | ✓ | ✓ |  |
| `cutting.approve` | ✓ |  | ✓ |  |
| `output.print` | ✓ | ✓ | ✓ |  |
| `machine.transfer` | ✓ |  |  |  |
| `admin.manage` | ✓ |  |  |  |

`machine.transfer`는 P1-04에서도 실제 통신을 허용하지 않고 예정 항목의 권한 자리로만 유지한다.

### 4.3 custom role

- 관리자는 조직 안에서 custom role을 생성할 수 있다.
- role key는 생성 후 변경하지 않고 조직 안에서 unique로 유지한다.
- custom role의 이름·설명·permission은 수정할 수 있다.
- 사용 중인 role은 hard delete하지 않고 `active=false`로 전환한다.
- `admin.manage`는 `ADMINISTRATOR`에만 부여하며 custom role에는 추가할 수 없다.
- 비활성 role은 신규 할당할 수 없지만 기존 이력은 유지한다.

## 5. 조직·membership 기준

- 1차 운영은 단일 회사·단일 조직이다.
- 조직 생성·삭제·switcher는 제공하지 않는다.
- 모든 업무 query와 mutation은 session의 `organizationId`를 조건에 포함한다.
- URL·body의 `organizationId`를 신뢰하지 않는다.
- 한 사용자는 P1 완료 시점까지 활성 membership 하나만 가질 수 있다.
- 사용자 초대는 현재 관리자의 조직에만 membership을 만든다.
- 부서는 선택 항목이며 미지정 사용자를 허용한다.
- 부서 비활성화 시 기존 membership 연결은 유지하되 신규 지정은 금지한다.
- 조직 또는 membership이 정지되면 다음 요청부터 접근을 거부한다.
- PostgreSQL RLS는 운영 복잡도와 migration 위험을 별도 검토할 때까지 적용하지 않는다.

## 6. 사용자 상태와 보호 규칙

### 6.1 상태 전이

```text
초대 생성 → INVITED
비밀번호 설정 완료 → ACTIVE
관리자 일시 정지 → SUSPENDED
관리자 복구 → ACTIVE
장기 사용 중지 → DISABLED
DISABLED 복구 → ACTIVE
```

- `INVITED`는 비밀번호 설정 전이라 로그인할 수 없다.
- `SUSPENDED`와 `DISABLED`는 로그인·보호 API 접근을 거부한다.
- 정지·사용 중지 시 해당 사용자의 모든 session을 같은 transaction에서 revoke한다.
- 복구 시 session을 자동 발급하지 않고 다시 로그인하게 한다.
- 사용자 row는 hard delete하지 않는다.
- 이메일은 생성 후 P1-02에서 변경하지 않는다. 이메일 변경·재검증은 별도 작업으로 둔다.

### 6.2 관리자 안전장치

- 관리자는 자기 계정을 정지·사용 중지할 수 없다.
- 현재 조직의 마지막 활성 `ADMINISTRATOR` membership은 정지하거나 관리자 role을 제거할 수 없다.
- `ADMINISTRATOR` role 자체는 수정·비활성화할 수 없다.
- 대상 사용자와 role은 반드시 현재 session 조직에 속해야 한다.
- 동시 관리자 변경은 transaction 안에서 다시 개수를 확인한다.

## 7. 초대·비밀번호 재설정

### 초대

1. 관리자가 이메일·표시명·선택 부서·role을 입력한다.
2. 서버가 이메일 중복과 현재 조직 membership을 확인한다.
3. `INVITED` user, 활성 membership, role, 30분 reset token을 transaction으로 만든다.
4. DB에는 token hash만 저장한다.
5. 관리자 화면에 원본 초대 URL을 한 번만 표시하고 복사 버튼을 제공한다.
6. 사용자가 비밀번호를 설정하면 P1-01 reset 흐름이 `ACTIVE`로 전환한다.

이메일 서비스 도입 전에는 관리자가 승인된 별도 채널로 URL을 전달한다.

### 재발급

- 만료·분실 시 관리자가 새 URL을 발급한다.
- 기존 미사용 token은 즉시 사용 처리한다.
- 활성 사용자의 reset URL 발급만으로 기존 비밀번호와 session을 폐기하지 않는다.
- 계정 침해가 의심되면 먼저 사용자를 `SUSPENDED`로 전환해 session을 revoke한 뒤 reset을 발급한다.

### 중복 기준

- 같은 조직에 동일 이메일 membership이 있으면 `409 CONFLICT`를 반환한다.
- 다른 조직의 기존 사용자 연결은 P1-02에서 지원하지 않는다.
- 전역 이메일과 다른 조직 membership이 발견되면 일반 오류로 중단하고 운영자가 별도 확인한다.

## 8. 서버 권한 구조

```text
Route Handler
→ 인증 context 확인
→ requirePermission(context, permission)
→ Application Service
→ organizationId를 명시적으로 받는 Repository
→ Prisma
```

### 인증 context

서버 내부 context에 다음을 추가한다.

```text
membershipId
departmentId
roleKeys
permissions
```

- permission은 활성 role의 합집합으로 계산한다.
- 역할 변경은 session 재발급 없이 다음 request부터 반영한다.
- Client DTO에는 화면 제어용 정렬된 `capabilities`만 제공한다.
- DB row·role relation 전체를 Client로 전달하지 않는다.

### guard

- `requireAuthenticatedContext`: 로그인과 활성 membership
- `requirePermission`: permission 없으면 `403`
- `requireSameOrganization`: repository 입력과 session 조직 일치
- 관리자 route 전체: `admin.manage`
- UI 표시 여부와 무관하게 service가 permission을 다시 검사한다.

## 9. API 계획

| method | endpoint | permission | 용도 |
|---|---|---|---|
| `GET` | `/api/v1/admin/users` | `admin.manage` | 사용자 cursor 목록·검색 |
| `POST` | `/api/v1/admin/user-invitations` | `admin.manage` | 사용자 초대·URL 1회 반환 |
| `PATCH` | `/api/v1/admin/users/:userId` | `admin.manage` | 표시명·부서·상태·role 수정 |
| `POST` | `/api/v1/admin/users/:userId/password-resets` | `admin.manage` | reset URL 재발급 |
| `GET` | `/api/v1/admin/departments` | `admin.manage` | 부서 목록 |
| `POST` | `/api/v1/admin/departments` | `admin.manage` | 부서 생성 |
| `PATCH` | `/api/v1/admin/departments/:departmentId` | `admin.manage` | 이름·활성 상태 수정 |
| `GET` | `/api/v1/admin/roles` | `admin.manage` | 역할·permission matrix |
| `POST` | `/api/v1/admin/roles` | `admin.manage` | custom role 생성 |
| `PATCH` | `/api/v1/admin/roles/:roleId` | `admin.manage` | custom role 수정·비활성화 |

공통:

- JSON body 최대 16 KiB
- cursor pagination, 기본 25건·최대 100건
- 검색어 trim·길이 제한
- 허용 Origin·Host와 request ID·`no-store`
- `updatedAt` 기반 낙관적 충돌 검사
- 조직 조건 불일치는 존재 여부를 숨기기 위해 `404`
- 동시 수정은 `409 CONFLICT`
- 목록 DTO는 credential·token·내부 relation을 포함하지 않는다.

## 10. 관리자 UI

### 경로

- `/admin/users`: 사용자 검색·상태·부서·role·초대·reset
- `/admin/departments`: 부서 생성·수정·비활성화
- `/admin/roles`: system role matrix 조회·custom role 관리

### 동작

- `admin.manage`가 없는 사용자는 admin navigation을 볼 수 없다.
- URL 직접 접근도 Server Component에서 `403` 또는 안전한 화면으로 차단한다.
- 목록은 pagination하고 Client 전체 DB를 한 번에 받지 않는다.
- 초대·reset URL은 modal에서 한 번만 표시하고 복사 후 닫으면 다시 조회할 수 없다.
- 위험 변경은 대상·결과를 명확히 표시하고 확인을 한 번 받는다.
- 자기 계정과 마지막 관리자 금지 사유를 UI에 표시하되 서버 거부를 대체하지 않는다.
- 한국어와 국내 업무 사용성을 우선한다.

## 11. 감사 경계

P1-02에서는 보안상 필요한 관리 mutation을 `AuditEvent`에 기록한다.

| action | 대상 |
|---|---|
| `admin.user_invited` | user |
| `admin.user_updated` | user |
| `admin.user_status_changed` | user |
| `admin.user_roles_changed` | membership |
| `admin.password_reset_issued` | user |
| `admin.department_created` | department |
| `admin.department_updated` | department |
| `admin.role_created` | role |
| `admin.role_updated` | role |

metadata에는 비밀번호·token·hash를 넣지 않는다. P1-03에서 전후 비교 형식, 검색 UI, 보존·append-only 강화를 통합한다.

## 12. 테스트 계획

| 종류 | 핵심 사례 |
|---|---|
| 단위 | permission 합집합, guard, 상태 전이, DTO |
| PostgreSQL | 조직 범위 목록·수정, role 즉시 반영, 상태별 session 거부 |
| 보안 | 타 조직 IDOR, permission 없는 API, reserved permission, token 비노출 |
| 동시성 | 마지막 관리자 2건 동시 제거 거부, `updatedAt` 충돌 |
| API | pagination·검색·schema·404·409·403·request ID |
| E2E 관리자 | 초대→비밀번호 설정→로그인, role 변경, 정지 |
| E2E 일반 사용자 | admin 메뉴 미표시·직접 URL·API 거부 |
| 사용자 | Chrome·Edge 사용자·부서·role 관리 검수 |

타 조직 시험용 조직과 사용자는 test DB fixture로만 만들며 seed 운영 데이터에는 포함하지 않는다.

## 13. 상세 실행 단계

| 단계 | 상태 | 작업 | 종료 검증 |
|---|---|---|---|
| `01` | `DONE` | 현재 Prisma·seed·P1-01 경계 분석 | 본 문서 3장 |
| `02` | `DONE` | D1-02-A~L 결정 승인 | 2026-07-19 전체 승인 |
| `03` | `DONE` | 설치 버전 Next.js 권한·Route Handler 문서 재확인 | 로컬 문서 |
| `04` | `DONE` | permission catalog·system role seed | 17 permission·4 system role 멱등 seed |
| `05` | `DONE` | permission context·guard·DAL | permission 합집합·조직 guard 단위 시험 |
| `06` | `DONE` | 관리자 repository·application service | 전용 조직 PostgreSQL 격리 시험 |
| `07` | `DONE` | 사용자 초대·상태·reset API | 30분 hash token·session revoke 통합 시험 |
| `08` | `DONE` | 부서·custom role API | system role·reserved permission·낙관적 충돌 방어 |
| `09` | `DONE` | 관리자 UI·navigation | 3개 관리 화면·cursor 검색·1회 URL·위험 변경 확인 |
| `10` | `DONE` | Playwright·CI·Chrome·Edge 검수 | 2026-07-20 사용자 검수 승인 |

## 14. D1-02 권장 결정안

2026-07-19 사용자가 `D1-02-A~L` 권장안 전체를 승인했다.

| ID | 권장안 |
|---|---|
| `D1-02-A` | 1차는 단일 조직, 조직 생성·삭제·switcher 제외 |
| `D1-02-B` | 사용자당 활성 membership 하나, 복수 조직 연결 제외 |
| `D1-02-C` | system role 4종 `ADMINISTRATOR/DESIGNER/APPROVER/VIEWER` |
| `D1-02-D` | system role은 seed 고정, 조직 특수 권한은 custom role |
| `D1-02-E` | `admin.manage`는 `ADMINISTRATOR` 전용 reserved permission |
| `D1-02-F` | 초대·reset URL은 30분·1회 표시·별도 채널 전달 |
| `D1-02-G` | 사용자 hard delete·이메일 변경 없음, 상태로 관리 |
| `D1-02-H` | 자기 정지와 마지막 관리자 제거 금지 |
| `D1-02-I` | 역할 변경은 다음 request 즉시 반영, 정지는 session revoke |
| `D1-02-J` | 모든 repository에 session `organizationId` 강제, RLS 보류 |
| `D1-02-K` | `updatedAt` 낙관적 충돌과 관리 mutation 최소 감사 |
| `D1-02-L` | 관리자 UI 3개와 PostgreSQL·Playwright·Chrome·Edge 검증 |

## 15. 완료 기준

- [x] 공개 가입·MFC 계정 이전 경로가 없다.
- [x] 인증 context가 활성 role의 permission 합집합을 사용한다.
- [x] UI와 무관하게 모든 관리자 API가 `admin.manage`를 검사한다.
- [x] 타 조직 ID로 조회·변경·role 할당할 수 없다.
- [x] 사용자 초대·비밀번호 설정·로그인 흐름이 연결된다.
- [x] 상태·membership 정지가 기존 session을 폐기한다.
- [x] 마지막 관리자와 자기 계정 보호가 동시 요청에서도 유지된다.
- [x] system role·reserved permission을 임의 변경할 수 없다.
- [x] custom role·부서 변경이 안전하게 반영된다.
- [x] hard delete 없이 상태와 감사 이력을 유지한다.
- [x] 단위·PostgreSQL·API·Playwright·필수 CI가 통과한다.
- [x] Chrome·Edge 사용자 직접 검수가 승인된다.

## 16. 사용자 결정 게이트

`D1-02-A~L`은 2026-07-19 전체 승인됐다. 이후 권장안을 변경하면 영향을 받는 permission matrix·상태 전이·API·테스트를 먼저 수정하고 사용자에게 다시 확인받는다.

## 17. 구현·자동 검증 결과

2026-07-19 기준 다음 수직 흐름을 구현했다.

```text
ADMINISTRATOR 로그인
→ admin.manage 기반 관리 navigation
→ 부서·custom role 생성
→ VIEWER 사용자 초대와 1회 URL
→ 비밀번호 설정·일반 사용자 로그인
→ admin navigation 미표시·페이지 404·API 403
→ 관리자 정지 처리
→ 기존 일반 사용자 session 즉시 폐기
```

자동 검증 결과:

| 검증 | 결과 |
|---|---|
| TypeScript | 통과 |
| ESLint | 통과 |
| 단위 테스트 | 111건 통과 |
| PostgreSQL 통합 테스트 | 17건 통과 |
| Playwright Chromium | 4개 시나리오 통과 |
| Next.js production build | 통과 |
| 인앱 브라우저 기능 확인 | 로그인·초대·부서·role 생성과 콘솔 오류 없음 |

마지막 관리자 동시 변경은 테스트 전용 조직을 사용해 다른 통합 테스트와 격리했다. 사용자 변경 transaction은 조직 row lock 뒤 현재 활성 관리자 수를 재확인하므로, 서로 다른 관리자를 동시에 제거해도 최소 1명이 유지된다.

## 18. 사용자 Chrome·Edge 검수 절차

로컬 서비스를 실행한 뒤 두 브라우저에서 같은 항목을 확인한다.

```bash
npm run dev
```

1. 관리자 계정으로 로그인하고 편집기 상단의 `조직 관리`가 표시되는지 확인한다.
2. `/admin/departments`에서 부서를 추가하고 이름·사용 상태를 변경한다.
3. `/admin/roles`에서 system role 4종이 읽기 전용인지 확인하고 custom role을 추가한다.
4. `/admin/users`에서 사용자 초대 URL을 발급하고 한 번만 표시되는지 확인한다.
5. 초대 계정 비밀번호 설정·로그인 후 `조직 관리`가 보이지 않는지 확인한다.
6. 일반 계정으로 `/admin/users` 직접 접근 시 관리 화면이 열리지 않는지 확인한다.
7. 관리자가 일반 계정을 정지한 뒤 기존 일반 계정 화면을 새로고침하면 로그인으로 이동하는지 확인한다.
8. 1366×768 이상에서 사용자·부서·역할 화면의 입력과 버튼이 겹치지 않는지 확인한다.

2026-07-20 사용자가 검수 완료와 다음 단계 진행을 승인했다. P1-02를 `DONE`으로 종료하고 P1-03 상세계획으로 넘어간다.
