# P0-03 보충 — MFC 참조 PostgreSQL 조사

> 상태: `DONE`
>
> 조사일: 2026-07-19
>
> 담당자·검수자: 사용자 본인
>
> 상위 작업: [P0-03 운영 데이터 원본 확정](./P0-03-operational-data-source.md)

## 1. 목적과 보안 원칙

사용자가 제공한 MFC 참조 PostgreSQL을 읽기 전용으로 조사해 실제 레거시 스키마와 데이터 규모를 확인한다.

- 접속 host, port, 사용자와 password는 저장소 문서·코드·fixture에 기록하지 않는다.
- 접속정보는 향후 `LEGACY_REFERENCE_DATABASE_URL` secret으로만 관리한다.
- 모든 조사는 `BEGIN TRANSACTION READ ONLY`에서 수행하고 `ROLLBACK`으로 종료한다.
- 고객명, 주소, 연락처, 담당자, 메모와 계정정보를 조회·반출하지 않는다.
- fixture에는 해시된 source key와 형상·계산에 필요한 숫자 데이터만 사용할 수 있다.

## 2. 확인 결과

| 항목 | 결과 |
|---|---|
| 역할 | 실제 MFC 수주·절곡 데이터의 참조 원본 |
| 데이터베이스 | `krsteelfold2` |
| DBMS | PostgreSQL `9.2.24` |
| 업무 스키마 | `postgres` |
| 업무 테이블 | 109개 |
| 읽기 전용 확인 | `transaction_read_only = on` |
| 웹 런타임 사용 | 사용하지 않음 |
| 웹 스키마 복제 | 하지 않음 |

PostgreSQL 9.2는 레거시 참조 원본의 현재 버전일 뿐 신규 웹 운영 버전의 기준이 아니다. 웹은 P0-08에서 정한 현대 PostgreSQL 버전과 Prisma Schema를 사용한다.

## 3. 핵심 데이터 규모

| 테이블 | 건수 | 판정 |
|---|---:|---|
| `company` | 1 | 회사 기준정보 |
| `customer` | 1,813 | 개인정보 포함 가능, 직접 fixture 반출 금지 |
| `sitee` | 2,264 | 현장정보 포함 가능, 직접 fixture 반출 금지 |
| `rawcate` | 30 | 재질·두께·연신 참고 |
| `item` | 253 | 품목 참고 |
| `foldd` | 189 | 절곡 템플릿 |
| `foldxy` | 1,606 | 절곡 템플릿 선 |
| `sellsum` | 19,238 | 수주 헤더 |
| `sellfold` | 140,761 | 수주 절곡 항목 |
| `sellfoldxy` | 1,060,688 | 수주 절곡 선·계산 snapshot |
| `sellplaninfo` | 40 | 재단/DXF 관련 표본 |
| `selldraw` | 98,493 | 입면도 수주 데이터, 보관 전용 |
| `draww` | 46 | 입면도 템플릿, 보관 전용 |
| `drawxy` | 421 | 입면도 형상, 보관 전용 |

SQLite `folddraw3.db`의 수주 관련 테이블이 0건이었던 것과 달리 이 DB에는 실제 비교에 사용할 충분한 수주 절곡 snapshot이 존재한다.

## 4. SQLite 스키마와 차이

SQLite에만 존재:

```text
_customer_old_20250213
_item_old_20241223
_item_old_20241223_1
_sellfold_old_20250213
_sellfoldxy_old_20250213
avcutinfo
costgrade
costgraderaw
costgradesheet
```

레거시 PostgreSQL에만 존재:

```text
count
itemcutdefault
```

- `count`는 bigint 한 컬럼·한 행의 기술성 테이블로 `TECHNICAL_LEGACY` 처리한다.
- `itemcutdefault`는 두께별 재단 기본 보정값 구조지만 현재 0건이다. 기계·재단 계약의 `DOMAIN_REFERENCE`로만 사용한다.
- 두 원본의 물리 스키마 차이는 신규 Prisma 모델을 레거시 table parity로 만들지 않아야 하는 추가 근거다.

## 5. 절곡 데이터 분포

### 5.1 `sellfoldxy`

| 항목 | 결과 |
|---|---:|
| 전체 선 | 1,060,688 |
| 곡선 후보(`arcdepth` 또는 `lengthr`) | 561 |
| 비영(非零) 연신값 | 756,997 |
| 비영 컷 깊이 | 739,919 |
| 비영 계산 길이 보고값 | 2,880 |
| `calcuyn = N` | 518 |

`linetype` 분포:

- `1`: 150,076
- `4`: 910,051
- `5`: 487
- `6`: 74

`angtype` 분포:

- `1`: 150,076 — `AT_START`
- `2`: 149,938 — `AT_END`
- `3`: 624,845 — `AT_FRONT`
- `4`: 135,815 — `AT_BACK`
- `7`: 13 — `AT_FRONT_ZERO`
- `0`: 1 — 비정상 또는 미지정 후보

현재 데이터에는 A/U 계열 각 타입이 보이지 않는다. 웹의 전체 각 타입 지원 여부는 MFC enum과 업무 요구를 기준으로 별도 구현하되, 실제 빈도와 검증 우선순위는 위 분포를 반영한다.

### 5.2 절곡 항목별 선 수

절곡 항목은 최소 2개 선부터 30개 이상 선까지 존재한다. 주요 빈도:

| 선 수 | 절곡 항목 수 |
|---:|---:|
| 2 | 2,402 |
| 3 | 7,312 |
| 4 | 13,048 |
| 5 | 11,498 |
| 6 | 28,077 |
| 8 | 25,375 |
| 10 | 22,043 |
| 12 | 12,291 |
| 16 | 1,031 |
| 20 | 89 |

WEB-REFERENCE는 단순 2~5선뿐 아니라 실제 빈도가 높은 6·8·10·12선과 곡선·계산 제외·ZERO 타입을 확대 표본에 포함해야 한다.

## 6. 데이터 사용 정책

### 6.1 허용

- 스키마, 컬럼, constraint와 건수 조사
- 각 타입·선 수·각도·곡선·연신 분포 집계
- 저장소 밖 secret salt를 사용하는 HMAC-SHA-256으로 source key를 바꾼 표본
- 고객·현장·주문 식별정보를 제거한 숫자 형상·계산 snapshot
- 레거시 결과와 웹 제안 결과의 차이 비교

### 6.2 금지

- 웹 애플리케이션에서 이 DB로 직접 조회·쓰기
- password 또는 연결 문자열의 저장소 기록
- 고객·현장·담당자·주소·전화번호·메모의 fixture 반입
- PostgreSQL 9.2 스키마를 Prisma 모델로 그대로 복제
- 레거시 numeric key를 웹 primary key로 재사용
- 레거시 계산값을 검토 없이 정답으로 승인

## 7. 웹 재구현 결론

1. 신규 웹 운영 DB는 별도 PostgreSQL이며 이 레거시 DB와 물리적으로 분리한다.
2. 신규 Prisma 모델은 주문·절곡·재질·계산 snapshot의 업무 의미만 가져오고 구조는 새로 설계한다.
3. 레거시 연결은 P2 importer 또는 P0/P1 검증 도구의 읽기 전용 입력으로만 사용한다.
4. 데이터 이전 시 PostgreSQL 9.2에서 직접 장기 연결하지 않고 checksum이 있는 staging export를 우선한다.
5. 인증정보와 `emp.pwd`, PC 인증정보는 이전하지 않는다.
6. 입면도 데이터는 원본 보관 manifest에만 포함하고 활성 웹 모델로 적재하지 않는다.
7. 실제 레거시 절곡 snapshot은 WEB-REFERENCE의 커버리지 선정 근거로 활용하되 최종 기대값은 사용자가 직접 검증한다.

## 8. 완료 기준

- [x] 읽기 전용 접속과 DB 버전을 확인했다.
- [x] 업무 스키마와 전체 테이블 수를 확인했다.
- [x] 핵심 테이블 건수와 절곡 분포를 확인했다.
- [x] SQLite와 PostgreSQL 스키마 차이를 확인했다.
- [x] 접속정보·개인정보 비저장 정책을 적용했다.
- [x] 신규 PostgreSQL/Prisma 구조를 독립 재설계하기로 확정했다.
