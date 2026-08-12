# P1-07 — 절곡 초안 저장

> 상태: `DONE`
>
> 우선순위: `P1`
>
> 담당자: 사용자 본인
>
> 검수자: 사용자 본인
>
> 관련 게이트: `D1-07`
>
> 계획 작성일: 2026-07-25
>
> 착수일: 2026-07-25
>
> D1-07 승인일: 2026-07-25
>
> 완료일: 2026-07-25
>
> 상위 계획: [P1 실행계획](./P1-execution-plan.md)
>
> 선행 기준선: [P1-06 절곡 문서 계약 v1](./P1-06-fold-document-contract-v1.md)
>
> MFC 참조 루트: `/Users/kyhoon/Library/Mobile Documents/com~apple~CloudDocs/회사/hicomtech/도면`

## 1. 목표와 사용자 결과

로그인 사용자가 절곡 초안을 PostgreSQL에 생성·조회·편집·삭제하고, 편집 내용이 자동 저장되며, 새로고침·네트워크 장애·동시 편집에서도 조용히 덮어쓰거나 작업을 잃지 않게 한다.

P1-07 완료 시 다음 흐름이 실제 화면에서 연결돼야 한다.

```text
로그인
→ 새 절곡 초안 생성 또는 최근 초안 열기
→ 2D 편집
→ 변경 후 1초 debounce 자동 저장
→ 저장 상태·오류 확인
→ 새로고침 후 동일 문서 복원
→ 다른 탭 변경은 충돌로 중단
→ 서버본 다시 불러오기 또는 내 작업을 새 초안으로 복사
```

P1-07은 템플릿 라이브러리의 저장 기반만 완성한다. 분류·검색·복사·검토·게시·폐기와 개정 비교는 P1-08에서 확장한다.

## 2. 배경과 조사 결과

### 현재 웹 기반

| 대상 | 현재 상태 | P1-07 판단 |
|---|---|---|
| `FoldEditorStore` | module singleton, 예제 `FoldProfile v3`, Undo/Redo는 메모리 | 서버 초안 교체·읽기 전용·저장 상태 연결을 추가하되 다중 문서 동시 편집은 P1-13으로 보류 |
| `CanvasWorkspace` | `/`에서 편집, 저장 버튼·초안 목록 없음 | 기존 `/`를 유지하고 초안 도구막대·목록 dialog·URL query를 추가 |
| browser/server adapter | v3↔server v1 구현 | 모든 저장·복원 경계에서 사용 |
| `FoldTemplate` | 조직·code·name·type·soft delete | 초안의 mutable root로 사용 |
| `FoldRevision` | DRAFT 상태, JSONB·schema version·checksum | P1-07에서 revision 1의 mutable DRAFT로 사용 |
| material seed | AL-1T/2T/3T 게시 revision | 최소 읽기 endpoint로 선택지를 제공 |
| RBAC | `template.fold.read/edit/publish` 존재 | read와 edit를 서버에서 각각 강제 |
| audit v2 | typed action catalog·append-only·원자 transaction | 초안 생성·내용 저장·soft delete action 추가 |

### MFC·레거시 적용 원칙

- `foldd`, `foldxy`는 템플릿과 좌표 데이터의 의미를 확인하는 참고 자료다.
- MFC의 저장 handler·실행 parameter·로컬 파일·ODBC 메커니즘은 따르지 않는다.
- PostgreSQL·Prisma·HTTP·브라우저 복구 기능으로 독립 재구현한다.
- 저장 기능은 계산 결과를 바꾸지 않으므로 WEB-REFERENCE 결과 대조 대상이 아니다. 문서 checksum·복원 동등성과 사용자 업무 흐름으로 검증한다.
- 입면도 데이터와 API는 만들지 않는다.

## 3. 포함·제외 범위

### 포함

- 조직 범위 절곡 초안 최근 목록·상세·생성·전체 문서 저장·soft delete
- 게시 material rule revision의 최소 선택 목록
- Prisma `FoldRevision.lockVersion`과 마지막 수정자 관계
- server document v1 검증, 서버 material snapshot 재구성, checksum
- 정수 lock version 기반 낙관적 동시성 제어
- 손실된 응답 재시도에 대한 동일 checksum 멱등 처리
- 1초 debounce 자동 저장과 명시적 저장
- 저장 중·완료·실패·오프라인·충돌 상태 표시
- IndexedDB 미저장 복구본과 새로고침 복구 안내
- 충돌 시 서버본 다시 불러오기 또는 로컬본을 새 초안으로 복사
- 초안 생성·변경·삭제 감사
- 단위·PostgreSQL·API·Playwright·사용자 화면 검증

### 제외

- 분류·검색·정렬 설정·즐겨찾기·썸네일
- REVIEW/PUBLISHED/RETIRED 상태 전이와 게시 불변 개정
- revision 비교·복원·게시본에서 새 개정 생성
- 여러 문서를 탭으로 동시에 여는 편집기
- 여러 사용자의 실시간 공동 편집·CRDT·자동 병합
- 완전한 오프라인 업무와 서비스 워커 동기화
- material·rule 생성·수정·게시 UI
- 계산 preview 서버 API와 결과 snapshot
- MFC/레거시 초안 importer
- 입면도와 기계 통신

## 4. 선행 조건과 의존성

| 구분 | 대상 | 상태 | 확인 방법 |
|---|---|---|---|
| 선행 작업 | P1-01 인증·session | 완료 | 보호 page/API·세션 수명주기 시험 |
| 선행 작업 | P1-02 조직·RBAC | 완료 | 조직 경계·permission 통합 시험 |
| 선행 작업 | P1-03 감사 v2 | 자동 구현 완료 | typed writer·append-only transaction 시험 |
| 선행 작업 | P1-06 문서 계약 v1 | 완료 | 2026-07-25 사용자 승인 |
| 환경 | 로컬 PostgreSQL·Prisma Migrate | 완료 | test DB reset·migration·seed |
| 자료 | 게시 material rule | seed 제공 | 조직별 AL-1T/2T/3T 확인 |
| 사용자 결정 | D1-07-A~L | 전체 승인 | 2026-07-25 사용자 승인 |

## 5. 도메인·상태 설계

### 5.1 저장 aggregate

P1-07의 초안 하나는 다음 관계다.

```text
FoldTemplate (mutable root, soft delete)
└─ FoldRevision revisionNumber=1, status=DRAFT (mutable draft)
   └─ server document v1 JSONB + checksum + lockVersion
```

- `FoldTemplate`은 초안의 조직·숨은 code·이름·문서 타입·삭제 상태를 관리한다.
- `FoldRevision`은 편집 문서와 동시성 version을 관리한다.
- P1-07에서는 template당 활성 DRAFT를 하나만 만든다.
- DRAFT만 내용을 수정할 수 있다.
- P1-08에서 REVIEW/PUBLISHED와 새 revision을 도입하되 P1-07 API의 draft ID는 `FoldRevision.id`로 유지한다.
- category는 P1-07 생성 시 `null`이며 P1-08에서 지정한다.
- template code는 화면 입력을 요구하지 않고 `DRAFT-<template UUID>` 형태로 서버가 생성한다.

### 5.2 저장 상태

클라이언트 저장 상태는 서버 개정 상태와 분리한다.

```text
clean → dirty → saving → clean
                  ├─ retrying → saving
                  ├─ offline → saving
                  ├─ invalid
                  └─ conflict
```

- `clean`: 현재 편집 문서 checksum과 마지막 서버 응답 checksum이 같다.
- `dirty`: 저장 이후 편집 변경이 있다.
- `saving`: 한 요청만 전송 중이다.
- `retrying/offline`: 로컬 복구본을 유지하고 서버 재시도를 기다린다.
- `invalid`: adapter/schema 오류이며 오류 path를 표시하고 자동 저장을 멈춘다.
- `conflict`: 다른 요청이 lock version을 증가시켰으며 자동 저장을 멈춘다.

## 6. 데이터베이스·Prisma

### 변경

`FoldRevision`에 다음을 추가한다.

| 필드 | 타입 | 목적 |
|---|---|---|
| `lockVersion` | `Int @default(1)` | 자동 저장 낙관적 잠금; 저장 성공 시 1 증가 |
| `updatedByUserId` | nullable UUID | 마지막 서버 변경 사용자 |
| `updatedBy` | `User?` relation | 목록·상세 표시와 추적 |

`User.updatedFoldRevisions` 역관계와 `FoldRevision.updatedByUserId` index를 추가한다. migration SQL에는 `lockVersion > 0` CHECK를 둔다.

### migration

- 기존 row는 `lockVersion=1`로 backfill한다.
- `updatedByUserId`는 기존 `createdByUserId`로 backfill하되 원래 null이면 null을 유지한다.
- JSONB와 checksum은 변경하지 않는다.
- 빈 DB 적용, 현재 schema upgrade, seed, downgrade SQL 검토를 수행한다.
- rollback은 신규 코드 배포 전이면 column·FK·index·check 제거가 가능하다. 신규 코드로 저장을 시작한 뒤에는 DB backup 복원 없이 lock version 정보를 버리지 않는다.

### 불변조건

- 모든 query/mutation은 session `organizationId`를 조건에 포함한다.
- revision·template·material rule은 같은 조직이어야 한다.
- DRAFT가 아니거나 template가 삭제된 revision은 P1-07 변경 대상이 아니다.
- document name/type, `FoldRevision.name`, `FoldTemplate.name/documentType`을 transaction 안에서 동기화한다.
- row schema version·material ID·checksum은 P1-06 계약과 일치해야 한다.
- UPDATE는 `id + organizationId + status=DRAFT + lockVersion` 조건의 단일 원자 변경이다.

## 7. API·Application 계약

### 7.1 endpoint

| method | endpoint | permission | 용도 |
|---|---|---|---|
| `GET` | `/api/v1/fold-drafts?cursor&limit` | `template.fold.read` | 최근 DRAFT 목록 |
| `POST` | `/api/v1/fold-drafts` | `template.fold.edit` | template+revision 1 생성 |
| `GET` | `/api/v1/fold-drafts/:draftId` | `template.fold.read` | 문서 상세·checksum·lock version |
| `PUT` | `/api/v1/fold-drafts/:draftId` | `template.fold.edit` | 전체 server document 교체 |
| `DELETE` | `/api/v1/fold-drafts/:draftId` | `template.fold.edit` | template soft delete |
| `GET` | `/api/v1/fold-material-options` | `material.read` | 조직 내 사용 가능한 게시 material rule 목록 |

목록은 `(updatedAt DESC, id DESC)` 복합 cursor와 기본 25개·최대 100개를 사용한다. 검색·분류 filter는 P1-08 범위다.

### 7.2 생성

요청:

```json
{
  "draftId": "클라이언트가 생성한 UUID",
  "document": { "schemaVersion": 1 }
}
```

- 클라이언트 UUID는 재시도 key이며 `FoldRevision.id`로 사용한다.
- 같은 조직에 같은 draft ID와 checksum이 이미 있으면 기존 결과를 성공으로 반환한다.
- 같은 ID에 다른 내용이 있거나 다른 조직 row와 충돌하면 `409 CONFLICT`다.
- template·revision·audit은 하나의 transaction으로 생성한다.

### 7.3 저장

요청:

```json
{
  "expectedLockVersion": 4,
  "document": { "schemaVersion": 1 }
}
```

응답에는 `draftId`, `templateId`, `lockVersion`, `checksumSha256`, `updatedAt`, `updatedBy`, canonical document를 포함한다.
- full document replacement만 허용하고 JSON Patch는 사용하지 않는다.
- request body 한도는 JSON overhead를 고려해 `2 MiB + 64 KiB`로 두며 canonical document 자체는 P1-06의 2 MiB를 넘을 수 없다.
- 클라이언트 material snapshot을 권위값으로 사용하지 않는다. document의 `ruleRevisionId`로 같은 조직의 게시 revision을 찾고 snapshot 전체를 서버값으로 교체한 뒤 최종 validation/checksum을 수행한다.
- 예상 version이 현재 version과 다르지만 checksum이 이미 같다면 직전 응답 유실 재시도로 보고 현재 row를 성공 반환한다.
- version과 checksum이 모두 다르면 `409 CONFLICT`와 현재 `lockVersion`, `checksumSha256`, `updatedAt`, 수정자 표시명만 반환한다. 서버 문서 전체는 별도 GET으로 확인한다.

### 7.4 삭제

- DRAFT template만 `active=false`, `deletedAt=now()`로 soft delete한다.
- 삭제도 현재 `expectedLockVersion`을 요구해 열린 옛 화면의 삭제를 막는다.
- 삭제된 초안은 일반 목록·상세·저장에 `404`로 응답해 존재를 숨긴다.
- 복구·휴지통 UI는 P1-08에서 결정한다.

### 7.5 표준 오류

| 상황 | status/code | UI 처리 |
|---|---|---|
| 미인증·권한 없음 | `401/403` | 로그인 또는 읽기 전용 안내 |
| 타 조직·삭제·없는 ID | `404 NOT_FOUND` | 목록으로 이동 안내 |
| 문서·Decimal 검증 실패 | `400 INVALID_REQUEST` | path별 한국어 오류 표시 |
| 요청 크기 초과 | `413 PAYLOAD_TOO_LARGE` | 자동 저장 중단·문서 축소 안내 |
| lock/version 충돌 | `409 CONFLICT` | 충돌 dialog, 자동 저장 정지 |
| DB checksum 불일치 | `500 INTERNAL_ERROR` | 문서 미노출, request ID와 운영 확인 안내 |
| 네트워크·5xx | 재시도 대상 | 로컬 복구본 유지, backoff |

## 8. 권한·보안·감사

### 권한

- `template.fold.read`: 목록과 상세 조회만 가능하다.
- `template.fold.edit`: 생성·저장·삭제가 가능하다.
- 조직 안에서는 작성자 개인 소유가 아닌 공동 초안으로 본다.
- 조회 전용 사용자는 편집 도구와 저장·삭제 버튼을 disabled 처리하지만 서버 permission 검사가 최종 기준이다.
- mutation은 기존 Origin/Host 검사를 동일하게 적용한다.

### 감사 action

| action | 시점 | 허용 payload |
|---|---|---|
| `fold.draft_created` | 최초 transaction commit | after: name, documentType, lockVersion; metadata: schemaVersion, checksum |
| `fold.draft_saved` | checksum이 실제 변경된 저장 | before/after: name, documentType, lockVersion; metadata: schemaVersion, checksum |
| `fold.draft_deleted` | soft delete | before/after: active, deleted; metadata: lockVersion, checksum |

- autosave라도 checksum이 바뀌어 DB가 갱신되면 감사한다.
- 동일 checksum 재시도는 row와 audit event를 추가하지 않는다.
- geometry·수식 원문·문서 전체·material 값 전체는 audit payload와 application log에 넣지 않는다.
- 성공 mutation과 audit insert는 같은 transaction에서 commit/rollback한다.

## 9. UI·자동 저장·복구

### 9.1 화면 구조

기존 `/` 편집기와 로그인 후 이동 경로를 유지한다.

- 상단에 초안 이름, 저장 상태, `지금 저장`, `최근 초안`, `새 초안`을 표시한다.
- 열린 초안은 `/fold-editor?draft=<revision UUID>`로 표현해 새로고침과 링크 복원이 가능하다.
- 최근 초안 dialog는 이름·타입·수정시각·수정자를 표시한다.
- P1-07에는 검색·분류·게시 UI를 넣지 않는다.
- 기존 “새 도면”은 선만 지우는 의미가 불명확하므로 `내용 초기화`로 이름을 바꾸고, 별도 `새 초안` 명령을 둔다.

### 9.2 자동 저장 scheduler

- 편집 변경을 감지하면 즉시 IndexedDB 복구본을 갱신한다.
- 마지막 변경 후 `1초` debounce해 저장을 시작한다.
- 동시에 PUT을 둘 이상 보내지 않고 단일 순차 queue를 사용한다.
- 저장 중 추가 변경은 dirty로 유지하고 현재 요청 종료 후 최신 snapshot만 다시 저장한다.
- 정상 네트워크에서 마지막 변경 후 2초 이내 서버 반영이라는 P0-07 목표를 적용한다.
- 명시적 저장은 debounce를 취소하고 최신 문서를 즉시 queue에 넣는다.
- 페이지 이탈 시 저장 중·dirty이면 경고하되 `sendBeacon`으로 무조건 덮어쓰지 않는다.

### 9.3 실패 재시도

- network/5xx는 1초, 2초, 4초, 최대 30초 capped exponential backoff와 online event로 재시도한다.
- validation, 401/403/404/409/413은 자동 재시도하지 않는다.
- 새 변경이 생겨도 실패한 옛 snapshot 대신 가장 최신 snapshot 하나만 유지한다.
- 재로그인 뒤에는 서버 GET과 lock version을 다시 확인한 후 재개한다.

### 9.4 IndexedDB 복구본

key는 `organizationId + userId + draftId`이며 다음만 저장한다.

```text
document
baseLockVersion
baseChecksum
localChecksum
savedAt
```

- session token·사용자 개인정보·서버 material master는 저장하지 않는다.
- 서버 저장 성공 후 동일 local checksum 복구본은 삭제한다.
- 새로고침 시 서버본보다 새로운 미저장 복구본이 있으면 자동 적용하지 않고 `복구/버리기`를 묻는다.
- 복구 후에도 원래 base version으로 저장해 서버가 바뀌었으면 반드시 conflict가 발생하게 한다.
- 로그아웃할 때 복구본을 삭제하지 않는다. 동일 사용자·동일 조직 재로그인 시에만 제안한다.
- 완전 오프라인 신규 생성과 여러 기기 동기화는 지원하지 않는다.

### 9.5 충돌 UX

충돌 발생 시 편집 내용과 IndexedDB 복구본은 그대로 유지하고 자동 저장을 멈춘다.

선택지는 두 개다.

1. `서버 버전 다시 불러오기`: 현재 로컬 변경을 버리기 전에 확인하고 GET 최신본으로 교체한다.
2. `내 작업을 새 초안으로 복사`: 새 UUID로 POST해 로컬 문서를 별도 DRAFT로 보존한다.

강제 덮어쓰기와 자동 merge는 제공하지 않는다. 두 브라우저 탭으로 충돌·복사·복원을 검증한다.

## 10. 편집 정밀도와 material 정책

### 편집 number 정규화

현재 캔버스 drag와 `Math.hypot` 결과는 6자리를 넘는 부동소수일 수 있어 P1-06 adapter가 저장을 거부할 수 있다. adapter에서 몰래 반올림하지 않고 편집 명령의 결과를 다음 저장 해상도로 명시적으로 정규화한다.

- 좌표·길이·반경·연신·컷 깊이: `0.000001 mm`
- 각도: `0.0001°`
- `-0`은 `0`
- UI 입력과 drag 명령 완료 경계에서 적용하고 Undo에는 정규화된 값을 기록한다.
- P1-09 계산 Decimal 반올림 정책과 혼동하지 않는다. 이는 문서 저장 해상도 정규화이며 계산 결과 처리 규칙이 아니다.

### material

- 서버 초안은 게시된 동일 조직 material rule revision만 참조한다.
- material option 선택 시 서버 snapshot을 browser profile에 반영한다.
- 현재 localStorage 프리셋은 개인 편집 보조로 남길 수 있지만 서버 저장 권위값이 아니다.
- 프리셋으로 material 수치를 바꾼 뒤 저장하려면 대응 게시 rule을 선택해야 하며, 저장 성공 응답의 서버 snapshot으로 화면을 다시 동기화한다.
- material master 작성·수정·게시 UI는 P2-A03 범위다.

## 11. 상세 실행 단계

| 단계 | 상태 | 작업 | 종료 검증 |
|---|---|---|---|
| `01` | `DONE` | 현재 editor·Prisma·RBAC·audit·P1-06 계약 조사 | 본 문서 2~10장 |
| `02` | `DONE` | D1-07-A~L 승인 | 2026-07-25 사용자 전체 승인 |
| `03` | `DONE` | Prisma lock version·수정자 migration | test DB reset·전체 migration·seed·schema diff 통과 |
| `04` | `DONE` | draft DTO·오류·cursor·repository | 조직·상태·불변조건 구현 |
| `05` | `DONE` | create/read/update/delete service와 감사 | transaction·멱등·충돌 PostgreSQL 시험 통과 |
| `06` | `DONE` | draft·material option API | 인증·permission·body limit·조직 경계 시험 통과 |
| `07` | `DONE` | editor 저장 정밀도와 profile 교체 | 좌표·길이 6자리, 각도 4자리 회귀 시험 통과 |
| `08` | `DONE` | 자동 저장 controller·IndexedDB 복구 | debounce·queue·retry·복구 단위/E2E 통과 |
| `09` | `DONE` | 초안 toolbar·목록·상태·충돌 UI | 생성·저장·목록·삭제·충돌 복사 UI 구현 |
| `10` | `DONE` | PostgreSQL·Playwright·빌드 전체 검증 | 단위 141·통합 29·Playwright 5 및 build 통과 |
| `11` | `DONE` | migration·운영·사용자 문서 갱신 | migration diff·검수 절차·현황 문서 갱신 |
| `12` | `DONE` | Chrome·Edge 사용자 검수 | 2026-07-25 사용자 완료 승인 |

## 12. 테스트 계획

| 종류 | 핵심 사례 | 완료 기준 |
|---|---|---|
| 단위: repository/domain | cursor, status, DTO, version, same-checksum idempotency | 경계별 안정 code |
| 단위: editor precision | drag·길이·각도·-0·6/4자리 경계 | adapter 저장 가능, 허용 범위 초과 없음 |
| 단위: autosave | debounce, 단일 queue, dirty-during-save, retry, terminal error | fake timer로 결정적 상태 전이 |
| 단위: local recovery | key 격리, 저장 성공 삭제, 복구/폐기 | 타 사용자·타 조직 복구본 미노출 |
| PostgreSQL | migration, create/update/delete, 감사 원자성, checksum | transaction·row invariant 통과 |
| 보안 | 미인증, read-only mutation, cross-org UUID/material ID | 401/403/404와 데이터 무변경 |
| API | body limit, strict request, cursor, conflict detail | 표준 envelope·request ID |
| E2E | 생성→편집→자동 저장→새로고침, 명시 저장, 삭제 | 서버 복원과 UI 상태 일치 |
| E2E 충돌 | 두 탭에서 같은 version 수정, 새 초안 복사 | 마지막 저장 자동 덮어쓰기 없음 |
| E2E 장애 | route 응답 차단 후 편집·새로고침 복구 | 로컬 변경 보존·재연결 저장 |
| 회귀 | 기존 인증·관리·감사·편집·계산 | 전체 suite 통과 |
| 성능 | 100 segment 저장 반복과 1,000 segment 상한 | 로컬 참고 측정, 운영 유사 p95 800ms는 P2-C12 재검증 |
| MFC golden master | 해당 없음 | 저장 인프라 독립 구현, 계산 변경 없음 |
| 시각·현장 | 화면 상태·dialog 사용자 검수 | Chrome·Edge 승인 |

## 13. 배포·운영

- 신규 환경변수나 외부 저장소는 없다. 로컬·운영 모두 PostgreSQL을 사용한다.
- 배포 순서는 backup 확인 → Prisma migration → application 배포 → health/API smoke다.
- 새 코드 배포 전에 구 코드가 신규 nullable column과 default column을 무시할 수 있어 migration-first가 가능하다.
- API 오류 log에는 request ID, draft/revision ID, 오류 종류만 남기며 document 원문은 남기지 않는다.
- 관측 대상은 저장 latency, 성공/충돌/validation/5xx 수, retry 횟수, document bytes다. 사용자명과 geometry는 metric label로 사용하지 않는다.
- P0-07의 미승인 임시 초안 1년 보존 정책은 기록만 계승한다. 실제 정리 batch는 운영 정책·알림 UI와 함께 후속 구현한다.
- migration 실패 또는 checksum 이상이 확인되면 application 배포를 중단한다. 이미 저장된 문서를 자동 보정하지 않는다.

## 14. 위험과 대응

| 위험 | 영향 | 대응 |
|---|---|---|
| 현재 number 좌표가 Decimal scale 초과 | 자동 저장 반복 실패 | 편집 명령 경계 6/4자리 정규화와 adapter 회귀 시험 |
| 두 탭 저장 경합 | 사용자 작업 덮어쓰기 | 정수 lock version·원자 update·강제 overwrite 금지 |
| 응답 유실 후 같은 요청 재전송 | 가짜 충돌·중복 감사 | checksum 동일이면 현재 성공 결과 반환 |
| autosave 감사 이벤트 증가 | DB 증가·조회 잡음 | checksum 변경 시에만 기록, payload 최소화; 보존/집계는 운영 측정 후 조정 |
| localStorage 프리셋과 서버 material 불일치 | 저장 후 계산값 변화 | 서버 게시 snapshot 강제·응답 재동기화·상태 안내 |
| IndexedDB 복구본이 오래 남음 | 공용 PC 로컬 노출 | 동일 user/org key, 문서만 저장, 성공 시 삭제; 공용 PC 정책은 운영 안내 |
| soft delete 중 열린 탭 | 재생성·유령 저장 | 이후 PUT 404, 로컬본을 새 초안으로만 복사 |
| P1-08 개정 기능과 API 충돌 | 재설계 비용 | draft ID를 FoldRevision ID로 고정하고 DRAFT-only service 분리 |

## 15. D1-07 결정 게이트 — 승인 기준선

2026-07-25 사용자가 `D1-07-A~L` 권장안 전체를 승인했다. 아래 항목을 P1-07 공식 구현·검증 기준선으로 사용한다.

| ID | 권장안 | 영향 |
|---|---|---|
| `D1-07-A` | `FoldTemplate + revisionNumber=1인 mutable DRAFT FoldRevision`을 P1-07 저장 aggregate로 사용 | 기존 모델을 계승하고 P1-08 개정·게시로 자연스럽게 확장 |
| `D1-07-B` | `FoldRevision.lockVersion Int`와 `updatedByUserId`를 Prisma migration으로 추가 | timestamp 정밀도와 의미상 revision number를 동시성 잠금과 분리 |
| `D1-07-C` | 초안은 조직 공동 자료로 두고 read/edit permission을 서버에서 분리 | 작성자 개인 소유 예외 없이 현재 RBAC 표 유지 |
| `D1-07-D` | revision ID 기반 REST CRUD, full document PUT, 복합 cursor, client UUID 생성 멱등성을 사용 | 단순하고 검증 가능한 저장 계약 |
| `D1-07-E` | 같은 조직의 게시 material rule만 허용하고 snapshot은 매 저장 서버값으로 재구성 | 클라이언트 재질값 위조·오래된 snapshot 방지 |
| `D1-07-F` | expected lock version 불일치는 409, 단 checksum 동일 재시도는 성공 처리 | 덮어쓰기 방지와 응답 유실 재시도 양립 |
| `D1-07-G` | 1초 debounce·단일 순차 queue·명시 저장·2초 정상 반영 목표 | 요청 폭주 없이 P0 NFR 충족 |
| `D1-07-H` | IndexedDB에 사용자·조직·초안별 미저장 문서만 보관하고 복구를 묻되 완전 오프라인은 제외 | 새로고침·단기 장애 데이터 손실 완화 |
| `D1-07-I` | 충돌 시 자동 저장을 멈추고 서버본 다시 읽기 또는 로컬본 새 초안 복사만 제공 | 자동 merge·강제 덮어쓰기에서 오는 의미 손실 방지 |
| `D1-07-J` | 편집 명령 경계에서 길이 6자리·각도 4자리로 명시 정규화하고 adapter는 계속 엄격하게 유지 | 캔버스 부동소수를 저장 가능하게 하면서 조용한 adapter 반올림 방지 |
| `D1-07-K` | 실제 checksum 변경이 있는 생성·저장·삭제를 최소 metadata로 같은 transaction에서 감사 | 변경 추적과 문서 원문 비노출 보장 |
| `D1-07-L` | 기존 `/` 편집기를 유지해 최근 목록·새 초안·저장 상태를 추가하고 Chrome·Edge에서 새로고침·장애·두 탭 충돌을 사용자 검수 | P1-08 라이브러리 UI와 범위를 구분하면서 즉시 화면 검증 가능 |

기준선 변경 시 영향받는 schema·API·자동 저장·복구·E2E 항목을 먼저 갱신하고 사용자 확인을 받는다.

## 16. 완료 기준

- [x] `D1-07-A~L`을 사용자가 승인했다.
- [x] Prisma migration이 빈 DB와 현재 DB upgrade에서 통과한다.
- [x] 같은 조직의 DRAFT만 조회·변경하고 타 조직·권한 없는 요청을 거부한다.
- [x] server material snapshot과 문서·row version·ID·checksum 불변조건을 유지한다.
- [x] create retry와 same-checksum save retry가 중복 row·audit을 만들지 않는다.
- [x] 변경 후 자동 저장되고 새로고침 후 canonical 동등 문서가 복원된다.
- [x] network/5xx와 새로고침에서 IndexedDB 복구본으로 미저장 작업을 보존한다.
- [x] 두 탭의 stale save가 409로 중단되고 강제 덮어쓰지 않는다.
- [x] 조회 전용 사용자와 타 조직 UUID의 mutation이 차단된다.
- [x] 초안 생성·변경·삭제와 감사가 함께 commit 또는 rollback된다.
- [x] lint·typecheck·unit·integration·E2E·build·migration 검사가 통과한다.
- [x] Chrome·Edge 사용자 검수와 P1-07 완료 승인을 받는다.

## 17. 구현·검증 결과

### 주요 구현 위치

| 영역 | 경로 |
|---|---|
| Prisma·migration | `prisma/schema.prisma`, `prisma/migrations/20260725090000_fold_draft_locking/` |
| 초안 application | `src/server/fold-draft/` |
| 초안·재질 API | `src/app/api/v1/fold-drafts/`, `src/app/api/v1/fold-material-options/` |
| 자동 저장·로컬 복구 | `src/client/fold-draft/` |
| 편집 화면 | `src/components/fold-draft-workspace.tsx`, `src/components/canvas-workspace.tsx` |
| 통합·브라우저 시험 | `src/server/fold-draft/fold-draft.integration.test.ts`, `e2e/fold-draft.spec.ts` |

### 자동 검증

| 명령 | 결과 |
|---|---|
| `npm test` | 22개 파일, 단위 141건 통과; PostgreSQL 통합 29건은 기본 실행에서 제외 |
| `npm run test:integration` | 전체 migration·seed 후 6개 파일, PostgreSQL 29건 통과 |
| `npm run test:e2e` | Playwright Chromium 5개 시나리오 통과 |
| `npm run lint` | 오류 없음 |
| `npm run typecheck` | TypeScript 오류 없음 |
| `npm run build` | Next.js production build 통과 |
| `npm run db:validate` | Prisma schema 유효 |
| `npm run db:migrate:check` | Prisma schema와 migration 차이 없음 |

### 사용자 화면 검수 절차

검수 계정과 복구 명령은 [로컬 화면 테스트 계정](../local-screen-test-account.md)을 기준으로 한다.

1. Chrome에서 로컬 화면 테스트 계정으로 로그인하고 `/`의 `새 초안`으로 초안을 생성한다.
2. 이름·재질·선 길이를 변경하고 `저장됨` 표시 뒤 새로고침하여 같은 내용인지 확인한다.
3. 같은 초안 URL을 두 탭에서 열고 첫 탭 저장 뒤 둘째 탭에서 변경하여 충돌 안내가 나타나는지 확인한다.
4. 충돌 화면에서 `서버 버전 다시 불러오기`와 `내 작업을 새 초안으로 복사`를 각각 확인한다.
5. 개발자 도구에서 네트워크를 차단하고 편집·새로고침한 뒤 복구 안내와 재연결 저장을 확인한다.
6. 최근 초안 목록에서 다시 열기와 삭제를 확인한다.
7. Edge에서도 1~6을 반복한 뒤 P1-07 완료 여부를 승인한다.

## 18. 변경 기록

| 날짜 | 변경 내용 | 작성자 |
|---|---|---|
| 2026-07-25 | P1-06 승인 후 현재 editor·Prisma·RBAC·감사 기반을 조사하고 P1-07 상세 계획과 D1-07-A~L 작성 | 사용자 본인 |
| 2026-07-25 | D1-07-A~L 전체 승인, 공식 구현 기준선 확정 | 사용자 본인 |
| 2026-07-25 | PostgreSQL 초안 CRUD·감사·자동 저장·IndexedDB 복구·충돌 UI 구현 및 전체 자동 검증 완료, `VERIFYING` 전환 | 사용자 본인 |
| 2026-07-25 | 로컬 화면 테스트 관리자 계정·멱등 복구 명령·사용 문서 추가 및 실제 로그인 검증 | 사용자 본인 |
| 2026-07-25 | 사용자 화면 검수 완료 승인, P1-07 `DONE` 확정 | 사용자 본인 |
