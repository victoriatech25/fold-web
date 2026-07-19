# P0-12 — 품질·CI 기준선

> 상태: `DONE`
>
> 우선순위: `P0`
>
> 담당자: 사용자 본인
>
> 검수자: 사용자 본인
>
> 관련 게이트: `G0`, `D0-12`
>
> 착수일: 2026-07-19
>
> 완료일: 2026-07-19
>
> 상위 계획: [fold_web 전체 프로젝트 작업계획서](../project-work-plan.md)
>
> P0 실행계획: [P0 실행계획](./P0-execution-plan.md)
>
> MFC 참조 루트: `/Users/kyhoon/Library/Mobile Documents/com~apple~CloudDocs/회사/hicomtech/도면`

## 1. 목표

schema·migration·코드·단위 테스트·실제 PostgreSQL 통합 테스트·production build가 하나의 재현 가능한 품질 체인에서 검증되고, 실패한 변경이 배포로 진행되지 않도록 한다.

로컬 워크플로와 실패 시험, GitHub Actions 실제 실행, `main` 보호 규칙과 병합 차단 검증을 완료했다. 2026-07-19 사용자가 `D0-12-A~H` 전체를 승인했으며 그 승인값을 공식 품질 기준선으로 적용했다.

## 2. 기준 워크플로

대상: `.github/workflows/ci.yml`

실행 조건:

- `main` 대상 pull request
- `main` push
- `v*` tag push
- 수동 실행

`quality` 작업 순서:

1. source checkout
2. Node.js 22와 npm cache 설정
3. `npm ci`
4. PostgreSQL 16 service의 app·readonly role과 shadow DB 준비
5. Prisma schema 검증과 Client 생성
6. schema와 migration directory 차이 검사
7. 기본 단위 테스트
8. ESLint
9. TypeScript
10. test DB reset·migration·seed·PostgreSQL 통합 테스트
11. 적용 migration 상태 검사
12. production build
13. production dependency high·critical 취약점 차단
14. 전체 npm audit JSON artifact 저장

Docker image 작업은 `quality` 성공 후에만 실행되고, 운영 배포는 Docker 작업 성공 후에만 실행되는 기존 의존 관계를 유지한다.

GitHub Actions의 PostgreSQL service container는 Linux runner에서 실행하고 health check 후 사용한다. 전체 audit artifact는 GitHub 공식 `upload-artifact` action을 사용해 14일간 보관한다.

참고:

- [GitHub PostgreSQL service container](https://docs.github.com/en/actions/tutorials/use-containerized-services/create-postgresql-service-containers)
- [GitHub workflow artifact 보관](https://docs.github.com/en/actions/tutorials/store-and-share-data)
- [GitHub protected branch](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches)

## 3. 로컬·CI 명령 계약

| 명령 | 역할 |
|---|---|
| `npm ci` | lockfile 그대로 의존성 설치 |
| `npm run db:validate` | Prisma schema 문법·구조 검증 |
| `npm run db:generate` | Prisma Client 생성 |
| `npm run db:migrate:check` | migration directory와 현재 schema 차이 차단 |
| `npm test` | DB에 접근하지 않는 기본 테스트 |
| `npm run lint` | ESLint |
| `npm run typecheck` | TypeScript no-emit 검사 |
| `npm run test:integration` | test DB reset 후 PostgreSQL 통합 테스트 |
| `npm run db:migrate:status` | 실제 DB migration 적용 상태 |
| `npm run build` | Prisma generate와 production build |
| `npm audit --omit=dev --audit-level=high` | production high·critical 취약점 차단 |

`scripts/run-integration-tests.mjs`가 OS shell의 inline 환경변수 문법에 의존하지 않고 reset과 Vitest 실행을 순서대로 제어한다. `TEST_DATABASE_URL`이 있으면 CI 연결을 사용하고, 없으면 승인된 로컬 test DB를 사용한다.

## 4. PostgreSQL 테스트 격리

CI는 실행마다 새 `postgres:16` service container를 사용한다.

- test DB: `fold_web_test`
- shadow DB: `fold_web_shadow`
- migration: CI 전용 PostgreSQL superuser
- application: CI 실행 중에만 존재하는 `fold_web_app`
- readonly: CI 실행 중에만 존재하는 NOLOGIN role
- seed: 사용자·비밀번호·거래처·주문·개인정보 없음

workflow에 기록된 DB 비밀번호는 폐기되는 service container의 명시적 시험 값이며 운영 secret이 아니다. 운영 DB URL이나 기존 MFC 참조 DB 자격증명은 사용하지 않는다.

통합 테스트는 병렬 shard로 나누지 않는다. 하나의 test DB를 reset하므로 현재는 단일 job에서 순차 실행한다. 향후 테스트 job을 병렬화할 때는 worker별 DB 이름 또는 schema를 분리해야 한다.

## 5. migration 게이트

`db:migrate:check`는 다음을 비교한다.

```text
prisma/migrations → prisma/schema.prisma
```

차이가 없으면 종료 코드 0, 누락 migration이 있으면 종료 코드 2로 CI를 실패시킨다. 그 뒤 실제 빈 test DB reset으로 전체 migration 적용 가능성을 확인하고 `migrate status`로 적용 완료를 다시 검사한다.

이미 공유된 migration 파일을 수정하거나 `db push`로 우회하는 방식은 공식 경로로 인정하지 않는다.

## 6. dependency 보안 게이트

정책:

- production dependency의 `high`, `critical`: CI 실패
- `moderate`: 전체 audit artifact와 작업 문서에 기록하고 수정 가능 버전을 추적
- 자동 수정이 major downgrade나 다른 breaking change를 제안하면 `npm audit fix --force` 금지
- 전체 audit JSON: 성공·실패와 무관하게 14일 보관

2026-07-19 현재 5건의 `moderate`가 존재한다.

- Prisma CLI 하위 개발 도구
- Next.js 내부 PostCSS

자동 수정안은 Prisma 6.x 또는 오래된 Next.js로의 breaking downgrade이므로 적용하지 않았다. upstream의 호환 수정이 제공되면 별도 dependency 갱신 작업에서 해소한다.

## 7. 로컬 검증 결과

| 검증 | 결과 |
|---|---|
| workflow YAML parse | 성공 |
| `db:validate` | 성공 |
| `db:generate` | 성공 |
| `db:migrate:check` | 차이 없음 |
| 기본 테스트 | 12개 파일, 94건 성공 |
| ESLint | 성공 |
| TypeScript | 성공 |
| PostgreSQL 통합 | 1개 파일, 5건 성공 |
| migration status | 최신 |
| production build | 성공 |
| production high·critical audit gate | 성공 |
| 의도적 audit 실패 시험 | moderate 기준으로 실행해 종료 코드 1 확인 |
| 의도적 migration diff 실패 시험 | 빈 schema와 비교해 종료 코드 2 확인 |
| `git diff --check` | 성공 |
| 레거시 endpoint 문자열 검사 | 저장소에 없음 |
| GitHub Actions PR 실행 | run `29669577333`, 1분 23초, 전체 성공 |
| audit artifact | Actions 업로드 성공 |
| 실패 PR 시험 | PR `#2`, 필수 check 실패와 `BLOCKED` 확인 |
| 하위 배포 차단 | 실패 PR에서 Docker·deploy 모두 `SKIPPED` |

실패 시험은 DB나 source를 변경하지 않는 비교·audit 명령으로 수행했다.

## 8. GitHub 저장소 확인

연결된 저장소:

```text
victoriatech25/fold-web
```

- visibility: public
- default branch: `main`
- GitHub CLI: 2.96.0
- 인증 계정: `victoriatech25`
- token scope: `repo`, `workflow`
- Git 전송 방식: HTTPS
- 검증 PR: `#1 Establish P0 web rebuild foundation`
- `main` branch protection: 승인 기준으로 적용 완료

적용 결과:

- 필수 check: `Quality and PostgreSQL integration`
- strict status check: 활성
- 필수 review: 0명
- 관리자 적용: 비활성, 긴급 우회 허용
- force push: 차단
- branch deletion: 차단

임시 PR `#2`에서 품질 작업을 의도적으로 실패시켰다. GitHub의 `mergeStateStatus`가 `BLOCKED`이고 Docker·운영 배포가 실행되지 않음을 확인한 뒤 PR을 닫고 원격·로컬 임시 branch와 worktree를 삭제했다.

## 9. `D0-12` 권장안

2026-07-19 사용자가 다음 공식 기준선 전체를 승인했다.

| 결정 ID | 항목 | 권장안 |
|---|---|---|
| `D0-12-A` | 병합 경로 | `main` 직접 push 대신 pull request 사용 |
| `D0-12-B` | 필수 status check | 고유 job 이름 `Quality and PostgreSQL integration` 성공 필수 |
| `D0-12-C` | 최신 base 반영 | 병합 전 branch를 최신 `main`으로 갱신 |
| `D0-12-D` | 승인 인원 | 1인 개발이므로 필수 review 0명, 사용자가 직접 업무 검수 |
| `D0-12-E` | history 보호 | force push와 branch deletion 차단 |
| `D0-12-F` | 관리자 우회 | 긴급 복구를 위해 허용하되 사후 작업 문서와 검증 필수 |
| `D0-12-G` | dependency 기준 | high·critical 차단, 현재 moderate 5건은 추적 후 호환 수정 시 해소 |
| `D0-12-H` | artifact 보존 | 전체 npm audit JSON 14일 |

GitHub는 필수 status check의 job 이름이 여러 workflow에서 중복되면 병합 판정이 모호해질 수 있다고 안내한다. 따라서 이 job 이름은 다른 workflow에서 재사용하지 않는다.

## 10. 후속 작업

- draft PR `#1`의 사용자 검토와 병합
- upstream 호환 버전이 제공될 때 moderate dependency 5건 재검토
- 운영 서버·DB가 결정되면 실제 운영 network·secret·backup 기준 검증

## 11. 완료 기준

- [x] 로컬 품질 명령 계약이 하나로 정리됐다.
- [x] PostgreSQL 16 service와 Prisma generate·migration 절차가 workflow에 포함됐다.
- [x] schema 변경에 migration이 누락되면 실패한다.
- [x] 단위·통합 테스트의 DB 격리 정책이 기록됐다.
- [x] Docker·배포가 quality 성공에 의존한다.
- [x] 로컬 실패 게이트 시험 후 정상 상태를 확인했다.
- [x] audit artifact와 dependency 차단 기준이 정의됐다.
- [x] `D0-12-A~H` 사용자 승인
- [x] GitHub Actions 실제 실행 성공
- [x] `main` branch rule 적용
- [x] 실패한 필수 check의 병합 차단 확인
