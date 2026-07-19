# P0-03 — 운영 데이터 원본 확정

> 상태: `DONE`
>
> 우선순위: `P0`
>
> 담당자: 구현·조사 담당
>
> 검수자: 사용자
>
> 관련 게이트: `G0`, `D0-03`
>
> 계획 작성일: 2026-07-18
>
> 착수일: 2026-07-18
>
> 완료일: 2026-07-18
>
> 상위 계획: [fold_web 전체 프로젝트 작업계획서](../project-work-plan.md)
>
> P0 실행계획: [P0 실행계획](./P0-execution-plan.md)

## 1. 목표

웹서비스가 사용할 권위 있는 운영 데이터 원본을 MFC와 분리해 확정하고, 레거시 데이터는 런타임 연결이 아닌 별도 이전 입력으로만 취급한다.

## 2. 확정 결론

| 항목 | 확정 내용 |
|---|---|
| 웹 운영 원본 | RDS 또는 운영 서버에 새로 구축하는 별도 PostgreSQL |
| 개발·테스트 | 로컬 PostgreSQL |
| DB 코드 | Prisma Schema, Prisma Client, Prisma Migrate |
| 인증 | MFC 실행·로그인과 분리된 웹서비스 독자 인증 |
| 런타임 구조 | 순수 서버 기반. 브라우저 localStorage는 편집 중 임시 UI 상태 외 업무 원본으로 사용하지 않음 |
| SQLite | 업무, 테스트, 인증, 다국어 런타임에서 사용하지 않음 |
| MFC DB 연결 | HiStarter, command line DB parameter, ODBC 연결을 웹에서 사용하지 않음 |
| 레거시 데이터 | 필요 데이터만 offline importer로 PostgreSQL에 변환. 원본 종류와 실제 이전 범위는 P0-04/P2 이전 계획에서 관리 |
| MFC 참조 DB | PostgreSQL 9.2의 실제 수주·절곡 DB를 읽기 전용 참고 원본으로 사용. 웹 런타임에는 연결하지 않음 |
| 언어 | 1차는 대한민국·한국어 단일 언어. MFC `global.db` 언어 기능은 이전하지 않음 |

## 3. 조사 안전 원칙

- 모든 파일과 DB 조사는 읽기 전용으로 수행한다.
- `hicom.ini`와 command line의 자격증명 값은 문서나 출력에 기록하지 않는다.
- 서버 접속은 사용자의 명시적 확인과 읽기 전용 권한을 받은 뒤 수행한다.
- 현재 확인한 SQLite 파일은 수정하거나 복사본으로 교체하지 않는다.

## 4. MFC 정적 코드 조사 결과

### 4.1 MFC 업무 DB 연결 경로

1. Release 실행 시 인자가 없으면 `Drawing.cpp`가 `HiStarter/HiStarter.exe`를 실행한다.
2. 애플리케이션은 첫 번째 command line 인자에서 프로그램·시간 등의 parameter를 읽는다.
3. 로그인 과정의 `CLoginDlg::ConnectUserDB()`가 `g_pCxdb->Connect(NULL)`을 호출한다.
4. `CDBCommon::Connect(NULL)`과 `CDBCon::Connect(NULL)`은 command line의 `dbconnection` 값을 추출한다.
5. `CDBConnInfo::SetDBConnectionFromParameter()`가 host, port, database, schema, user와 password를 연결 정보로 구성한다.
6. `CDBConnector`는 MSSQL 분기를 제외하면 PostgreSQL ODBC connection string을 사용한다.
7. 이후 `Work03`, 기준정보, 재단과 출력 관련 코드는 `g_pCxdb`/`CDBApi`를 통해 이 서버 연결에 SQL을 실행한다.

따라서 MFC 코드의 주 업무 데이터 경로는 실행 디렉터리의 SQLite 파일을 직접 여는 방식이 아니라 HiStarter가 전달하는 서버 DB command line 연결로 판단된다. 이 결과는 레거시 분석 자료이며 웹 런타임 설계에는 사용하지 않는다.

### 4.2 `hicom.ini`

확인된 설정 section:

- `DBLOCAL`
- `DBHICOM`
- `SYSTEM`
- `VERSION`
- `USER`
- `HICOMTECH`
- `ETC`

`DBLOCAL`에는 mode, DBMS/ODBC, DSN, database, server, port와 credential 키가 존재한다. 다만 현재 `CDBCommon::Connect(NULL)`의 `SetFromHicomIni()` 경로는 사용되지 않고 command line 연결을 우선한다. `hicom.ini`는 Starter 또는 보조 도구에서 연결 parameter를 만드는 데 사용될 수 있다.

### 4.3 `folddraw3.db`

확인 파일:

- `Doc/folddraw3.db`
- `Release/folddraw3.db`
- `Debug/folddraw3.db`

세 파일은 크기와 SHA-256 checksum이 동일하다.

```text
size: 6,594,560 bytes
sha256: 45ac63d020b36465c41f7593bd6ee60469004c7b352f333d672782d10bcbb229
```

SQLite 메타데이터:

- table 116개
- view 2개
- index 211개
- SQLite UTF-8

대표 row count:

| 테이블 | 건수 | 해석 |
|---|---:|---|
| `foldd` | 1,546 | 절곡 템플릿 존재 |
| `foldxy` | 13,273 | 절곡 선 데이터 존재 |
| `customer` | 120 | 거래처 표본·기준 데이터 존재 |
| `item` | 165 | 품목 데이터 존재 |
| `draww` | 1,251 | 입면도 레거시 데이터 존재 |
| `drawxy` | 14,306 | 입면도 도형 데이터 존재 |
| `sellsum` | 0 | 수주 헤더 없음 |
| `sellfold` | 0 | 수주 절곡 없음 |
| `sellfoldxy` | 0 | 수주 절곡 선 없음 |

`Drawing.vcxproj`는 빌드 후 `Doc/folddraw3.db`를 target directory로 복사한다. 그러나 C++ 코드 검색에서 `folddraw3.db`를 업무 DB로 `sqlite3_open`하는 경로는 발견되지 않았다.

별도의 `SqliteMgr`는 다국어 처리를 위해 `global.db`의 `language` 테이블을 연다. 이는 `folddraw3.db` 업무 데이터와 다른 용도다.

위 증거로 보면 `folddraw3.db`는 스키마·배포용 표본·백업 성격일 가능성이 높고 현재 실제 수주 운영 원본으로 보기 어렵다.

### 4.4 실제 MFC 참조 PostgreSQL

2026-07-19에 사용자가 제공한 레거시 PostgreSQL을 읽기 전용 트랜잭션으로 확인했다.

- PostgreSQL `9.2.24`
- database `krsteelfold2`
- 업무 schema `postgres`
- table 109개
- `sellsum` 19,238건
- `sellfold` 140,761건
- `sellfoldxy` 1,060,688건

접속 endpoint와 password는 문서·코드에 저장하지 않는다. 상세 결과와 비식별 사용 정책은 [MFC 참조 PostgreSQL 조사](./P0-03-legacy-postgresql-reference.md)에 기록했다.

이 DB는 실제 레거시 비교·선택적 이관 원본이지만 신규 웹 운영 원본은 아니다. 신규 웹 DB는 별도로 구축하고 Prisma에 맞게 재설계한다.

## 5. 레거시 자료 판정

| 후보 | 코드 근거 | 데이터 근거 | 웹에서의 처리 |
|---|---|---|---|
| MFC 참조 PostgreSQL | MFC 로그인 시 command line 연결, ODBC 경로 | 실제 수주·절곡 데이터와 109개 테이블 확인 | 런타임 재사용 안 함. 비식별 검증과 offline import의 읽기 전용 입력 |
| `Doc/folddraw3.db` | 빌드 결과로 복사되나 업무 open 경로 미발견 | 템플릿·기준정보는 있으나 수주 0건 | 런타임 사용 안 함. 스키마 분석·표본·보관 자료 |
| `global.db` | `SqliteMgr`가 직접 사용 | language table 용도 | 사용 안 함. 한국어 UI를 웹 코드·콘텐츠로 제공 |
| `hicom.ini` | MFC 연결 키 존재 | Starter 또는 보조 도구 설정 | 사용 안 함. 웹 secret과 환경변수를 별도 구성 |

실제 MFC 참조 서버가 확인됐지만 신규 웹 운영 기반은 이 서버와 독립적으로 진행한다. 과거 데이터 이전 시에는 장기 직접 연결보다 읽기 전용 staging export와 checksum 대조를 사용한다.

## 6. 웹 운영 원본 구축 절차

1. P0-08에서 로컬과 운영 PostgreSQL 버전·환경 기준을 정한다.
2. P0-09에서 웹 전용 Prisma Schema v1을 설계한다.
3. P0-10에서 로컬 PostgreSQL migration·seed·테스트 DB를 자동화한다.
4. P0-11에서 독립 서버 API와 Prisma transaction을 검증한다.
5. 운영 단계에서 RDS 또는 운영 서버 PostgreSQL을 생성한다.
6. `prisma migrate deploy`로 동일한 스키마를 적용한다.
7. backup·restore, secret, network와 관측 정책을 운영 환경에 적용한다.
8. 레거시 이전이 필요하면 런타임과 분리된 importer를 사용한다.

## 7. 상세 실행 단계

| 단계 ID | 상태 | 작업 내용 | 산출물 | 검증 |
|---|---|---|---|---|
| `01` | `DONE` | Drawing·Login·DBCommon 연결 흐름 조사 | 연결 흐름 | 호출 경로 대조 |
| `02` | `DONE` | DBConnector의 PostgreSQL/MSSQL 분기 조사 | DBMS 후보 | connection 분기 대조 |
| `03` | `DONE` | INI 키를 secret 비노출 방식으로 조사 | 설정 역할 | 키 존재 여부 |
| `04` | `DONE` | SQLite 파일 형식·checksum·schema·row count 조사 | 파일 판정 근거 | 세 복사본 대조 |
| `05` | `DONE` | 업무 SQLite open 경로 검색 | 사용 경로 판정 | source·project 검색 |
| `06` | `DONE` | MFC 실행·DB 연결 비계승 결정 | 런타임 제외 정책 | 사용자 승인 |
| `07` | `DONE` | 별도 PostgreSQL 단일 원본 결정 | 웹 원본 판정 | 사용자 승인 |
| `08` | `DONE` | SQLite 전체 런타임 제외와 한국어 우선 결정 | 데이터·언어 정책 | 사용자 승인 |
| `09` | `DONE` | 실제 MFC 참조 PostgreSQL 읽기 전용 조사 | 109개 테이블·핵심 건수·절곡 분포 | transaction read only |
| `10` | `DONE` | 레거시 스키마 비복제와 효율적 Prisma 재설계 확정 | 데이터 모델 원칙 | 사용자 승인 |

## 8. 사용자 결정 결과

- MFC용 실행 메커니즘을 따르지 않는다.
- 웹서비스 독자 인증 시스템을 구축한다.
- 운영은 RDS 또는 운영 서버의 별도 PostgreSQL을 사용한다.
- SQLite 관련 기능은 사용하지 않고 순수 서버 기반으로 운영한다.
- 1차는 대한민국·한국어 범위로 완료하고 다국어는 후속 지원한다.
- 실제 MFC 참조 PostgreSQL은 검증·선택적 이관 입력으로만 사용한다.
- 레거시 DB 스키마를 그대로 복제하지 않고 웹 업무 구조에 맞게 재설계한다.

## 9. 완료 기준

- [x] 코드상 데이터 연결 후보를 식별했다.
- [x] `folddraw3.db`의 역할에 대한 정적 근거를 확보했다.
- [x] 자격증명 비노출 원칙을 적용했다.
- [x] 웹 운영 DBMS가 별도 PostgreSQL로 확정됐다.
- [x] MFC 실행·인증·DB 연결을 웹에서 재사용하지 않기로 확정됐다.
- [x] SQLite를 웹 런타임에서 사용하지 않기로 확정됐다.
- [x] 레거시 데이터는 별도 importer 입력으로만 취급한다.
- [x] 사용자가 웹 운영 원본 판정을 승인했다.
- [x] 실제 MFC 참조 PostgreSQL의 읽기 전용 구조·규모를 확인했다.
- [x] 레거시 물리 스키마를 신규 Prisma 모델로 복제하지 않기로 확정했다.

## 10. 변경 기록

| 날짜 | 변경 내용 | 작성자 |
|---|---|---|
| 2026-07-18 | 코드·INI·SQLite 읽기 전용 조사, 서버 DB를 주 원본 후보로 판정 | 구현·조사 담당 |
| 2026-07-18 | MFC 런타임 비계승, 별도 PostgreSQL 단일 원본, SQLite 제외, 한국어 단일 언어 결정 후 완료 | 구현·조사 담당 |
| 2026-07-19 | 실제 MFC 참조 PostgreSQL 읽기 전용 조사와 웹 스키마 독립 재설계 원칙 추가 | 사용자 본인 |
