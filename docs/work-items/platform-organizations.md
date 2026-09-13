# 플랫폼 관리자 — 회사(조직) 등록·관리

> 상태: `VERIFYING` — 구현 완료(2026-09-13). [화면 테스트 가이드](../platform-organizations-screen-test-guide.md)로 사용자 검수 대기
>
> 우선순위: `P2` — 회사를 추가로 받기 위한 전제. 기존 실행계획 항목 밖에서 요청받아 별도 문서로 둔다
>
> 계획 작성일: 2026-09-13

## 1. 목표

서비스를 사용할 회사(= `Organization`)를 화면에서 등록하고, 이름과 사용 상태(사용/정지)를 관리한다. 이 화면은 **플랫폼 관리자** 에게만 메뉴에 나타나고, 그 외 계정은 주소로 직접 들어가도 404 다.

## 2. 결정

### 2.1 "회사" 는 조직(테넌트)이다

기존 `기준정보 > 회사·사업장`(`/admin/company`)은 로그인한 사용자가 속한 조직 하나의 회사 정보·사업장을 다룬다. 이번 화면은 그 위 단계 — 조직 자체를 만든다. 지금까지 조직을 만드는 수단은 seed 뿐이었다.

### 2.2 플랫폼 관리자는 조직 권한이 아니라 `User.platformAdmin` 플래그다

`admin.manage` 는 조직 안의 관리자 권한이다. 이 권한으로 회사 등록을 열면 **모든 조직의 관리자가 다른 회사를 만들고 정지할 수 있게 된다.** 그래서 조직 경계를 넘는 작업은 사용자 단위 플래그로만 연다.

- 플래그는 화면에서 줄 수 없다. 서버 운영자가 CLI 로만 바꾼다 — `npm run auth:set-platform-admin -- --email <이메일> --platform-admin true|false`
- `npm run auth:bootstrap-admin` 에 `--platform-admin true` 를 주면 처음부터 플랫폼 관리자로 만든다
- 로컬 화면 테스트 계정(`auth:ensure-local-screen-test-account`)은 플랫폼 관리자로 보장한다
- 대안이었던 "환경변수로 지정한 조직의 관리자만 허용" 은 조직 코드 하나에 운영 보안을 거는 셈이라 택하지 않았다

### 2.3 등록 시 함께 만드는 것

회사 코드·이름만 받고 나머지는 seed 와 같은 기본값으로 채운다. 이것들이 없으면 조직에 관리자를 붙일 수 없다.

| 항목 | 값 |
|---|---|
| `CompanyProfile` | 빈 프로필 |
| `BusinessSite` | `MAIN` 본사(`HEAD_OFFICE`, 기본 사업장) |
| `Role` | `systemRoleDefinitions` 의 시스템 역할 4개(관리자·설계자·승인자·조회자)와 권한 |

권한(`Permission`) row 는 전역이라 seed 되어 있어야 한다. 빠져 있으면 등록을 실패시킨다.

### 2.4 정지의 뜻과 제한

`SUSPENDED` 조직의 소속은 로그인·세션 조회에서 걸러지므로 **정지 즉시 그 회사 사용자는 로그인할 수 없고 기존 세션도 끊긴다.** 화면에서 정지 전에 소속 사용자 수를 보여 주고 확인을 받는다.

**자기 조직은 정지할 수 없다.** 정지하면 플랫폼 관리자 자신도 잠겨 되돌릴 사람이 없어진다. 서버(`canChangeOrganizationStatus`)와 화면(상태 select 비활성) 양쪽에서 막는다.

### 2.5 회사 관리자 발급 (2026-09-13 추가)

회사 행에서 이메일·이름을 받아 **그 회사의 시스템 역할 `ADMINISTRATOR`** 로 사용자를 초대한다. 조직 관리자의 사용자 초대와 같은 흐름 — `INVITED` 상태로 만들고 일회용 비밀번호 설정 주소를 한 번만 보여 준다. 이 계정으로 로그인하면 그 회사 소속 관리자라 사용자·부서·역할을 스스로 관리하고, 플랫폼 화면·API 는 열리지 않는다(`platformAdmin = false`).

- 역할은 `ADMINISTRATOR` 고정. 다른 역할이 필요하면 회사 관리자가 자기 화면에서 한다
- 이미 있는 이메일은 거절한다. 로그인은 활성 소속이 정확히 하나일 때만 되므로, 다른 회사 사용자를 붙이면 그 사람의 로그인이 막힌다
- 정지된 회사에는 발급할 수 없다
- 감사 이력은 두 곳에 남긴다 — 플랫폼 관리자의 조직에 `platform.organization_admin_invited`, 그 회사에 `admin.user_invited`. 회사 관리자가 나중에 자기 회사의 시작을 볼 수 있어야 한다
- 회사 행에는 현재 관리자(활성 소속 + `ADMINISTRATOR`) 목록과 상태를 함께 보인다. 관리자가 없는 회사는 경고로 표시한다

CLI(`auth:bootstrap-admin -- --organization <코드>`)는 화면 없이 서버에서만 해야 할 때의 예비 수단으로 남긴다.

## 3. 구현

| 층 | 위치 |
|---|---|
| 스키마 | `User.platformAdmin`, migration `20260913090000_user_platform_admin` |
| 인증 컨텍스트 | `AuthenticatedContext.platformAdmin` — 로그인·세션·worker 주체 모두 채운다 |
| 가드 | `requirePlatformAdmin` / `isPlatformAdmin` (`src/server/authorization`), `requirePlatformAdminPage` (`auth-dal`) |
| 서비스 | `src/server/organizations/organization-service.ts` — 목록·등록·변경(낙관적 잠금 `expectedUpdatedAt`) |
| API | `GET/POST /api/v1/platform/organizations`, `PATCH /api/v1/platform/organizations/:id`, `POST /api/v1/platform/organizations/:id/administrators` — `authorizePlatformAdminRequest` |
| 화면 | `/admin/organizations`, `OrganizationAdminPanel` |
| 메뉴 | `NavigationItem.platformAdmin` — `visibleModules(permissions, platformAdmin)` |
| 감사 | `platform.organization_created` / `platform.organization_updated` — **만든 사람의 조직** 에 남긴다. 새 조직에는 아직 볼 사람이 없다. 거절은 `authorization.permission_denied` 에 `reason: MISSING_PLATFORM_ADMIN` |

## 4. 검증

- 단위: `organization-policy.test.ts`, `navigation-model.test.ts`(플랫폼 관리자 메뉴 노출)
- 통합: `organization.integration.test.ts` — 플래그 없는 조직 관리자 거절, 등록 시 프로필·사업장·역할 생성, 코드 형식·중복, 관리자 발급 → 비밀번호 설정 → 로그인하면 그 회사 `ADMINISTRATOR`(플랫폼 작업 불가), 정지 회사 발급 거부, 낙관적 잠금, 자기 조직 정지 거부
- 화면(2026-09-13, 로컬): 메뉴 노출 → 등록(`demo-co` → `DEMO-CO`) → 정지 확인 팝업 → 정지. 플래그를 내리면 `admin.manage` 가 있어도 메뉴가 사라지고 `/admin/organizations` 는 404. `TEST` 회사에 관리자 발급 → 주소로 비밀번호 설정 → 로그인하면 `TEST` 소속 관리자, `/admin/users` 200 · `/admin/organizations` 404 · 플랫폼 API 403
