# P0-10 — Prisma migration·seed·테스트 DB

> 상태: `DONE`
>
> 우선순위: `P0`
>
> 담당자: 사용자 본인
>
> 검수자: 사용자 본인
>
> 관련 게이트: `G0`
>
> 계획 작성일: 2026-07-19
>
> 착수일: 2026-07-19
>
> 완료일: 2026-07-19
>
> 상위 계획: [fold_web 전체 프로젝트 작업계획서](../project-work-plan.md)
>
> P0 실행계획: [P0 실행계획](./P0-execution-plan.md)
>
> 승인 모델: [P0-09 Prisma 데이터 모델 v1](./P0-09-prisma-data-model-v1.md)

## 1. 목표

승인된 Prisma Schema v1을 빈 PostgreSQL 16 DB에 반복 적용하고, 비식별 최소 seed와 격리된 test DB 초기화를 자동화한다.

업무 테이블, enum, relation, unique와 index는 Prisma schema·migration으로만 생성한다. PostgreSQL role·database·schema grant는 Prisma가 관리하는 업무 schema가 아니라 환경 bootstrap으로 분리한다.

## 2. 구현 결과

### 2.1 안전한 package 공급

프로젝트 root [`.npmrc`](../../.npmrc)에 다음 registry를 명시했다.

```text
https://registry.npmjs.org/
```

사용자 전역 npm 설정의 평문 HTTP registry를 프로젝트 범위에서 덮어썼다. 프로젝트 패키지 설치와 lockfile 갱신은 HTTPS registry를 사용한다.

설치한 고정 버전:

| package | version | 용도 |
|---|---:|---|
| `prisma` | 7.8.0 | schema·migration CLI |
| `@prisma/client` | 7.8.0 | 생성 client runtime |
| `@prisma/adapter-pg` | 7.8.0 | Prisma 7 PostgreSQL driver adapter |
| `pg` | 8.22.0 | PostgreSQL driver |
| `dotenv` | 17.4.2 | Prisma CLI 환경변수 |
| `tsx` | 4.23.1 | TypeScript seed 실행 |
| `@types/pg` | 8.20.0 | TypeScript type |

Prisma 관련 버전은 `package.json`과 `package-lock.json`에 고정했다.

### 2.2 Prisma 7 구성

[`prisma.config.ts`](../../prisma.config.ts):

- schema: `prisma/schema.prisma`
- migrations: `prisma/migrations`
- seed: `tsx prisma/seed.ts`
- CLI URL 우선순위: `MIGRATION_DATABASE_URL` → `DATABASE_URL` → 로컬 dev 기본값
- shadow URL: `SHADOW_DATABASE_URL` → 로컬 shadow 기본값

[`prisma/schema.prisma`](../../prisma/schema.prisma):

- PostgreSQL 전용
- `foreignKeys` relation mode
- `prisma-client` generator
- output: `src/generated/prisma`

생성 client는 build artifact이므로 git에서 제외했다. production build 전에 `prisma generate`가 실행되도록 build script를 변경했다.

### 2.3 로컬 PostgreSQL

Homebrew PostgreSQL 16.11 서비스를 시작했다.

로컬 전용 DB:

| DB | owner | 용도 |
|---|---|---|
| `fold_web_dev` | `fold_web_owner` | 개발 |
| `fold_web_test` | `fold_web_owner` | 통합 테스트·reset |
| `fold_web_shadow` | `fold_web_owner` | Prisma migration 비교 |

로컬 전용 role:

| role | 속성·권한 |
|---|---|
| `fold_web_owner` | NOLOGIN, schema object owner |
| `fold_web_migrator` | LOGIN, local CREATEDB, owner role 위임 |
| `fold_web_app` | LOGIN, 업무 table DML |
| `fold_web_readonly` | LOGIN, 업무 table SELECT |

로컬 `pg_hba.conf`의 loopback trust를 이용하므로 비밀번호를 만들거나 저장하지 않았다. 이 인증 방식과 `CREATEDB`는 로컬 전용이며 운영에 복제하지 않는다.

### 2.4 초기 migration

초기 migration:

```text
prisma/migrations/20260719095500_init/migration.sql
```

내용:

- schema 1개
- enum 10개
- model table 25개
- primary·foreign key
- unique constraint
- 조회·관계 index

생성:

```bash
npm exec -- prisma migrate diff \
  --from-empty \
  --to-schema prisma/schema.prisma \
  --script \
  --output prisma/migrations/20260719095500_init/migration.sql
```

적용:

```bash
npm run db:migrate:deploy
```

개발 DB와 테스트 DB 모두 migration 상태가 최신이며 migration directory와 실제 DB 간 차이가 없음을 확인했다.

### 2.5 비식별 seed

[`prisma/seed.ts`](../../prisma/seed.ts)는 다음 최소 데이터를 upsert한다.

| 데이터 | 건수 | 내용 |
|---|---:|---|
| 조직 | 1 | 기본값 `LOCAL_DEV`, 환경변수로 code/name 변경 가능 |
| permission | 17 | 고객·재질·절곡·수주·재단·출력·관리 업무 권한 |
| 관리자 role | 1 | permission 17개 연결 |
| 재질 | 1 | 알루미늄 |
| material variant | 3 | 1T, 2T, 3T |
| 계산 규칙 revision | 3 | 승인 FIX 소수 보존 기준값 |
| 절곡 category | 1 | 기본 |
| 기계 연동 config | 1 | `PLANNED`, `placeholder-v1` |

사용자, 비밀번호, 거래처, 주문과 개인정보는 seed하지 않는다.

seed를 반복 실행해도 건수가 증가하지 않는 멱등 upsert 구조다.

### 2.6 테스트 DB reset

[`scripts/reset-test-db.mjs`](../../scripts/reset-test-db.mjs):

1. migration URL의 DB 이름이 정확히 `fold_web_test`인지 확인한다.
2. 다른 DB이면 실행 전에 중단한다.
3. `prisma migrate reset --force`를 실행한다.
4. 로컬 runtime·readonly role의 schema 권한을 복구한다.
5. Prisma seed를 실행한다.

개발 DB를 reset하는 script는 제공하지 않는다.

## 3. 명령

| 명령 | 역할 |
|---|---|
| `npm run db:validate` | schema 검증 |
| `npm run db:generate` | Prisma Client 생성 |
| `npm run db:migrate:deploy` | 승인 migration 적용 |
| `npm run db:migrate:status` | 적용 상태 확인 |
| `npm run db:seed` | 비식별 최소 seed |
| `npm run db:test:reset` | test DB reset·migration·seed |
| `npm run build` | Prisma generate 후 Next production build |

연결 변수 형식은 [`.env.example`](../../.env.example)에 기록했다. 실제 운영 값은 저장하지 않는다.

## 4. 검증 결과

| 검증 | 결과 |
|---|---|
| `prisma validate` | 성공 |
| `prisma generate` | 7.8.0 client 생성 성공 |
| dev 빈 DB migration | 성공 |
| dev seed | 성공 |
| test DB reset·전체 migration | 성공 |
| test seed | 성공 |
| migration drift | 차이 없음 |
| seed 재실행 | 건수 변화 없음 |
| runtime role 조회 | 성공 |
| readonly role 조회 | 성공 |
| readonly role INSERT | 권한 거부 확인 |
| SQLite 의존 | 없음 |

dev와 test의 seed 결과:

```text
Organization             1
Permission              17
MaterialVariant          3
MaterialRuleRevision     3
MachineIntegrationConfig 1
```

## 5. migration 운영 정책

- schema 변경은 `schema.prisma` 수정과 새 migration으로만 수행한다.
- 이미 공유·적용된 migration SQL은 수정하지 않는다.
- 개발 중에도 `db push`를 공식 변경 경로로 사용하지 않는다.
- 파괴적 변경은 expand → backfill → switch → contract로 나눈다.
- production에서는 `migrate deploy`만 사용한다.
- application 시작 시 여러 instance가 동시에 migration을 실행하지 않는다.
- production role·grant는 운영 호스팅 결정 후 별도 bootstrap과 검증을 만든다.
- 업무 데이터 rollback은 migration 파일 되돌리기가 아니라 forward fix 또는 승인 backup 복구로 수행한다.

## 6. 알려진 보안·운영 항목

`npm audit`에서 moderate 5건이 보고됐다.

- Prisma CLI의 개발 의존성 `@hono/node-server`
- Next 내부 build dependency `postcss`

현재 제안된 자동 수정은 Prisma를 6.x로 낮추거나 Next를 오래된 major로 바꾸는 breaking change이므로 `npm audit fix --force`를 실행하지 않았다. 실제 runtime 노출 여부와 upstream 수정 버전을 P0-12 dependency gate에서 다시 확인한다.

운영 서버·DB가 유예됐으므로 다음 항목은 아직 구현하지 않았다.

- 운영 DB와 role 생성
- TLS·private network
- 운영 secret manager
- backup·PITR·복구 훈련
- production grant

## 7. 상세 실행 결과

| 단계 ID | 상태 | 작업 내용 | 산출물·검증 |
|---|---|---|---|
| `01` | `DONE` | npm registry HTTPS 고정 | project `.npmrc` |
| `02` | `DONE` | Prisma 7.8·pg dependency 설치 | package·lockfile |
| `03` | `DONE` | Prisma config·client output 구성 | config·generate |
| `04` | `DONE` | Homebrew PostgreSQL 시작 | 16.11 응답 |
| `05` | `DONE` | dev/test/shadow DB와 local role 구성 | 소유·권한 확인 |
| `06` | `DONE` | 초기 migration 생성·dev 적용 | migration 1개 |
| `07` | `DONE` | 최소 seed 작성·멱등 검증 | dev/test 동일 건수 |
| `08` | `DONE` | test reset 안전장치·권한 복구 | reset·seed 성공 |
| `09` | `DONE` | drift·runtime·readonly 검증 | 차이 없음·권한 분리 |
| `10` | `DONE` | 실행·복구·위험 문서화 | 본 문서 |

## 8. 완료 기준

- [x] 안전한 registry로 package를 설치했다.
- [x] Prisma 7 config와 generated client 경로가 동작한다.
- [x] 초기 migration이 빈 PostgreSQL dev/test DB에 적용된다.
- [x] seed가 비식별이고 멱등이다.
- [x] test DB만 초기화하는 안전한 명령이 있다.
- [x] migration drift가 없다.
- [x] runtime과 readonly 권한이 구분된다.
- [x] 운영 호스팅 유예 항목이 분리되어 있다.

## 9. 변경 기록

| 날짜 | 변경 내용 | 작성자 |
|---|---|---|
| 2026-07-19 | registry·Prisma 7.8·로컬 PostgreSQL·초기 migration·seed·test reset 구현 및 검증 | 사용자 본인 |
