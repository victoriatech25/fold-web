# P0-08 — PostgreSQL 환경 기준

> 상태: `DONE_WITH_DEFERRED_OPERATION_HOSTING`
>
> 우선순위: `P0`
>
> 담당자: 사용자 본인
>
> 검수자: 사용자 본인
>
> 관련 게이트: `G0`, `D0-08`
>
> 계획 작성일: 2026-07-19
>
> 착수일: 2026-07-19
>
> 기준선 확정일: 2026-07-19
>
> 상위 계획: [fold_web 전체 프로젝트 작업계획서](../project-work-plan.md)
>
> P0 실행계획: [P0 실행계획](./P0-execution-plan.md)
>
> 비기능 기준: [P0-07 비기능 요구사항과 허용 오차](./P0-07-nfr-and-tolerance.md)

## 1. 목표

개발·테스트·CI·운영에서 사용할 PostgreSQL의 버전, 구동 방식, DB·role 경계, 문자·시간·Decimal 기준, 연결·secret, migration과 백업 책임을 확정한다.

웹 운영 데이터베이스는 레거시 MFC 참조 DB와 완전히 분리한다. 레거시 DB는 읽기 전용 조사·offline importer 입력일 뿐이며 웹 런타임 fallback으로 사용하지 않는다.

## 2. 확정된 원칙

- 웹의 업무 단일 원본은 별도 PostgreSQL이다.
- 개발·테스트도 PostgreSQL을 사용한다.
- SQLite와 브라우저 저장소를 업무 데이터 원본으로 사용하지 않는다.
- DB 모델·migration·접근 코드는 Prisma를 통해 작성한다.
- 운영 자격증명과 실제 endpoint를 저장소·문서·로그에 기록하지 않는다.
- 초기 서비스는 한국어·대한민국 업무를 대상으로 한다.
- 입면도 모델은 만들지 않는다.
- 기계 연동은 1단계에서 placeholder만 둔다.
- P0-07 기준은 가용성 99.5%, DB RPO 15분, 서비스 RTO 4시간이다.

## 3. 로컬 환경 조사 결과

조사일: 2026-07-19

| 항목 | 확인 결과 | 판정 |
|---|---|---|
| 설치 방식 | Homebrew `postgresql@16` | 사용 가능 |
| 클라이언트·서버 버전 | PostgreSQL `16.11` | 운영 major와 정렬 가능 |
| 데이터 디렉터리 | `/opt/homebrew/var/postgresql@16` | 초기화됨 |
| 클러스터 상태 | 정상 종료 상태, 서버 미실행 | P0-10에서 명시적으로 시작 필요 |
| Homebrew service | 미실행·미등록 | 자동 시작 정책 결정 필요 |
| 셸 PATH | `psql`, `pg_isready`가 기본 PATH에 없음 | 환경 설정 또는 절대 경로 필요 |
| 포트 | 설정 기본값 5432, 현재 응답 없음 | 다른 서비스와 충돌 없음 |
| 최대 연결 | 100 | 로컬 개발에 충분 |
| DB 시간대 | `Asia/Seoul`로 초기화 | 공식 기준 UTC로 변경 검토 |
| locale | `en_US.UTF-8` 계열 | 한국어 저장 가능, 정렬 의존 금지 |
| 로컬 인증 | loopback 포함 `trust` | 로컬 전용만 허용, 운영에 복제 금지 |
| page checksum | 비활성 | 로컬 허용, 운영은 관리 서비스 검증 사용 |

현재 서버는 시작하지 않았고 DB·role·설정도 변경하지 않았다.

## 4. 환경별 기준 제안

| 환경 | PostgreSQL | 구동·호스팅 | 데이터 수명 | 목적 |
|---|---|---|---|---|
| 개발 | local PostgreSQL 16 | 기존 Homebrew 설치 | 개발자가 명시적으로 관리 | 개발·수동 확인 |
| 테스트 | local PostgreSQL 16 | 별도 DB, test runner가 초기화 | 테스트 단위 폐기 | 통합·migration 테스트 |
| CI | PostgreSQL 16 service container | workflow 단위 생성·폐기 | 일회성 | 깨끗한 migration 검증 |
| staging | 운영과 같은 major 16 | 운영 후보와 같은 방식 | 운영 정책에 따른 보존 | 배포·복구·성능 검증 |
| production | PostgreSQL 16 | RDS 또는 별도 운영 서버 | P0-07 보존 정책 | 업무 단일 원본 |
| legacy reference | 레거시 버전 그대로 | 기존 외부 서버, read-only | 원본 정책 | 조사·offline importer |

major version은 모든 신규 환경에서 PostgreSQL 16으로 고정한다. minor version은 보안·버그 수정을 위해 최신 지원 버전을 사용하되, staging 검증 후 운영에 적용한다.

## 5. 로컬 DB·role 구조

### 5.1 데이터베이스

| 이름 | 용도 | 초기화 정책 |
|---|---|---|
| `fold_web_dev` | 개발 데이터 | migration과 명시적 seed |
| `fold_web_test` | 통합 테스트 | 테스트 실행 전 schema 초기화 |

CI는 실행별 임시 DB 또는 고유 schema를 사용하고 작업 종료 시 폐기한다. 개발 DB와 테스트 DB를 공유하지 않는다.

### 5.2 role

| role | 권한 | 사용처 |
|---|---|---|
| `fold_web_owner` | 객체 소유, 일반 로그인 금지 | schema 소유 |
| `fold_web_migrator` | migration에 필요한 DDL | 배포·CI migration |
| `fold_web_app` | 필요한 테이블 DML과 sequence 사용 | 애플리케이션 런타임 |
| `fold_web_readonly` | 승인된 테이블 SELECT | 운영 지원·보고 |

- 애플리케이션 role에는 DB 생성, role 생성, superuser 권한을 주지 않는다.
- migration role과 runtime role의 연결 문자열을 분리한다.
- 사람은 애플리케이션 공용 계정을 직접 사용하지 않는다.
- 로컬에서는 같은 구조를 재현하되 secret 값은 `.env.local` 등 git 제외 파일에 둔다.

## 6. 문자·시간·숫자 기준

| 항목 | 기준 |
|---|---|
| encoding | `UTF8` |
| 서버·DB session timezone | `UTC` |
| 업무 표시 timezone | `Asia/Seoul` |
| 시각 필드 | PostgreSQL `timestamptz`, Prisma `DateTime` |
| 업무 일자 | 시각과 구분된 `date` 의미로 설계 |
| 정렬 | locale 암묵 정렬을 업무 규칙으로 사용하지 않음 |
| Decimal | PostgreSQL `numeric`, Prisma `Decimal` |
| geometry 문서 | PostgreSQL `jsonb`, 내부 Decimal은 정규화 문자열 |
| 문자열 비교 | 검색·정렬용 정규화 필드를 명시 |

한국어 저장에는 `UTF8`이면 충분하지만 회사명·거래처명 정렬과 검색을 OS locale 결과에 맡기지 않는다. 필요한 경우 정규화 검색 필드와 명시적 정렬 키를 둔다.

초기 필수 extension은 두지 않는다. `pg_trgm`, `citext`, `pgcrypto` 등은 실제 사용처·RDS 지원 여부·migration 전략이 승인될 때 추가한다.

## 7. 연결과 secret 계약

| 변수 이름 | 대상 | 권한 |
|---|---|---|
| `DATABASE_URL` | 앱 runtime DB | `fold_web_app` |
| `MIGRATION_DATABASE_URL` | Prisma migration | `fold_web_migrator` |
| `TEST_DATABASE_URL` | 로컬·CI 테스트 DB | 테스트 전용 |
| `LEGACY_REFERENCE_DATABASE_URL` | offline importer·읽기 전용 조사 | 레거시 SELECT 전용 |

- 실제 값은 저장소에 넣지 않는다.
- `.env.example`에는 형식과 변수 이름만 기록한다.
- 운영 secret은 배포 플랫폼 secret manager에서 주입한다.
- 로그에는 endpoint, 사용자명, 비밀번호와 전체 연결 문자열을 출력하지 않는다.
- 운영 연결은 TLS를 강제하고 인증서 검증을 사용한다.
- 운영 DB는 public access를 기본적으로 금지하고 앱 네트워크에서만 접근한다.
- migration은 일반 앱 시작 때 자동 실행하지 않고 승인된 배포 단계에서 한 번 실행한다.

## 8. 연결 수와 transaction 기준

초기 제안:

| 항목 | 기준 |
|---|---:|
| 앱 인스턴스당 Prisma 연결 상한 | 10 |
| migration 동시 실행 | 1 |
| 일반 transaction | 5초 이내 |
| statement timeout | 일반 API 5초, batch 별도 |
| idle transaction timeout | 10초 |
| 재시도 | serialization·일시 연결 오류만 제한적으로 수행 |

긴 계산·DXF·재단 작업은 DB transaction 안에서 실행하지 않는다. transaction은 상태 확인과 원자적 저장에만 사용하고, worker 작업은 멱등 키와 상태 전이로 관리한다.

운영 앱 인스턴스 수가 늘어 DB 연결 예산을 넘기기 전 RDS Proxy 또는 별도 pooler 도입을 검토한다.

## 9. 운영 호스팅 대안

### 대안 A — Amazon RDS for PostgreSQL 16, 서울 리전 — 권장

구성 제안:

- PostgreSQL major 16, 생성 시점의 최신 승인 minor
- Asia Pacific (Seoul)
- Multi-AZ DB **인스턴스** 1 writer + 1 standby
- private subnet, public access 비활성
- 저장 암호화, TLS 연결
- 자동 백업과 point-in-time recovery
- deletion protection
- staging 복구 시험 후 minor update

2026-07-19 기준 AWS 문서상 서울 리전은 PostgreSQL 16 Multi-AZ DB cluster를 지원하며, RDS PostgreSQL 16.14가 제공된다. 이 프로젝트는 초기 read replica 용량이 필요하지 않으므로 3개 인스턴스인 Multi-AZ DB cluster보다 단일 standby가 있는 Multi-AZ DB 인스턴스를 우선 제안한다. RDS Multi-AZ 인스턴스는 다른 가용 영역에 동기식 standby를 유지하고 failover를 제공한다. [서울 리전 지원 버전](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/Concepts.RDS_Fea_Regions_DB-eng.Feature.MultiAZDBClusters.html), [RDS PostgreSQL 16 버전](https://docs.aws.amazon.com/AmazonRDS/latest/PostgreSQLReleaseNotes/postgresql-versions.html), [Multi-AZ 인스턴스](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/Concepts.MultiAZSingleStandby.html)

RDS 자동 백업은 지정된 보존 기간 안에서 point-in-time restore를 지원하므로 P0-07의 RPO 15분 기준을 구현하기 유리하다. 실제 RTO 4시간 충족 여부는 staging 복구 훈련으로 검증한다. [RDS 자동 백업과 PITR](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_WorkingWithAutomatedBackups.html)

전제:

- 앱도 같은 VPC에 배포하거나, 기존 운영 서버에서 VPC로 VPN·전용 사설 연결을 구성해야 한다.
- AWS 비용, 계정, VPC와 운영 권한을 사용자가 관리한다.

### 대안 B — 별도 운영 서버 PostgreSQL 16

구성 제안:

- 애플리케이션과 분리된 DB 서버
- 방화벽 allowlist와 TLS
- 매 15분 이하 WAL 보관 또는 동등한 PITR
- standby 또는 4시간 이내 복구 가능한 대체 서버
- 일일 backup, 월간 backup과 분기 복구 훈련
- OS·PostgreSQL patch, monitoring, storage, 장애조치를 사용자가 직접 관리

초기 비용을 줄일 수 있지만 P0-07의 가용성·RPO·RTO를 만족하는 운영 책임이 커진다. 단일 서버와 일일 dump만으로는 승인 기준을 충족한 것으로 보지 않는다.

## 10. 조직 경계 제안

초기 운영은 단일 회사로 시작한다. 다만 모든 업무 aggregate에는 `organizationId`를 포함해 다음을 보장한다.

- 사용자·role·기준정보·템플릿·주문·파일·감사 로그의 회사 경계
- 모든 unique key와 주요 조회의 조직 범위
- 서버에서 조직 조건을 강제하고 클라이언트 값만 신뢰하지 않음
- 첫 조직은 seed로 생성하되 이름·식별자는 환경 설정으로 주입
- 다중 회사 UI와 과금은 초기 범위에서 구현하지 않음

이는 초기 단일 회사 사용성을 유지하면서 데이터 모델을 다시 깨지 않고 향후 조직을 추가하기 위한 경계다.

## 11. 백업·migration 책임

| 작업 | 실행 주체 | 승인·검증 |
|---|---|---|
| Prisma migration 작성 | 사용자 본인 | schema review와 CI |
| staging migration | 배포 pipeline | 사용자 본인 결과 확인 |
| production migration | 승인된 배포 job | 사용자 본인 승인 |
| 자동 백업 | RDS 또는 운영 backup job | 매일 성공 확인 |
| 복구 훈련 | 운영 runbook | 사용자 본인 분기 승인 |
| legacy import | offline importer | checksum·건수·예외 보고 |

파괴적 migration은 expand → backfill → switch → contract 순서로 나눈다. 운영 rollback은 이미 삭제된 데이터의 자동 복구를 가정하지 않고 배포 rollback과 DB 복구 조건을 별도로 기록한다.

## 12. 상세 실행 결과

| 단계 ID | 상태 | 작업 내용 | 산출물·검증 |
|---|---|---|---|
| `01` | `DONE` | 로컬 PostgreSQL 설치·버전 확인 | 16.11 Homebrew 확인 |
| `02` | `DONE` | 로컬 cluster·service·인증 상태 확인 | 미실행·trust·PATH 미등록 확인 |
| `03` | `DONE` | 기존 배포·환경변수 계약 확인 | 앱 전용 compose, DB 변수 없음 |
| `04` | `DONE` | 환경별 DB와 role 경계 제안 | dev/test/CI/staging/prod 표 |
| `05` | `DONE` | UTF8·UTC·Decimal·JSONB 기준 제안 | 데이터 표현 기준 |
| `06` | `DONE` | secret·connection·migration 기준 제안 | 변수와 권한 계약 |
| `07` | `DONE` | RDS와 운영 서버 대안 비교 | 운영 후보 2개 |
| `08` | `DONE` | 초기 단일 회사와 조직 경계 제안 | `organizationId` 기준 |
| `09` | `DONE` | 운영 호스팅·연결 방식 사용자 결정 | 운영 서버·DB 결정과 설정을 후속으로 유예 |
| `10` | `DONE` | 결정 결과를 종합 문서에 반영 | 비차단 개발 기준 확정 |

## 13. 사용자 승인 요청

| 결정 ID | 결정 항목 | 권장안 |
|---|---|---|
| `D0-08-A` | 신규 PostgreSQL major | 개발·CI·운영 모두 major 16 |
| `D0-08-B` | 로컬 구동 | 기존 Homebrew PostgreSQL 16 사용 |
| `D0-08-C` | 운영 호스팅 | 서울 리전 RDS PostgreSQL 16 Multi-AZ 인스턴스 |
| `D0-08-D` | 앱과 RDS 연결 | 앱을 같은 VPC에 배치하거나 VPN 사설 연결, DB public access 금지 |
| `D0-08-E` | 조직 경계 | 초기 단일 회사 + 모든 업무 데이터 `organizationId` |
| `D0-08-F` | DB 운영·migration·복구 승인 책임 | 사용자 본인 |

`D0-08-C`와 `D0-08-D`는 비용과 앱 배포 위치에 직접 영향을 준다. 전체 권장안을 승인하거나, 운영 DB를 **별도 운영 서버 PostgreSQL 16**으로 선택하고 서버 위치·관리 방식을 지정해야 한다.

### 13.1 사용자 결정 결과

- `D0-08-A`: PostgreSQL major 16 개발 기준 채택
- `D0-08-B`: 기존 Homebrew PostgreSQL 16을 로컬 기준으로 채택
- `D0-08-C`: 운영 호스팅은 추후 결정·설정
- `D0-08-D`: 운영 네트워크 연결은 호스팅 결정과 함께 추후 확정
- `D0-08-E`: 초기 단일 회사와 `organizationId` 경계 채택
- `D0-08-F`: 사용자 본인이 운영·migration·복구 승인 역할 담당

`D0-08-C`와 `D0-08-D`는 운영 배포를 차단하지만 Prisma Schema, 로컬 migration, seed와 테스트 DB 작업은 차단하지 않는다. 운영 환경을 만들기 전에는 반드시 이 문서를 다시 열어 호스팅·네트워크·backup 구현을 승인한다.

## 14. 변경 기록

| 날짜 | 변경 내용 | 작성자 |
|---|---|---|
| 2026-07-19 | 로컬 PostgreSQL과 배포 상태 조사, 환경·role·RDS/운영 서버·조직 경계 권장안 작성 | 사용자 본인 |
| 2026-07-19 | 운영 서버·DB 호스팅과 연결은 추후로 유예하고 PostgreSQL 16·로컬·조직 경계를 개발 기준으로 확정 | 사용자 본인 |
