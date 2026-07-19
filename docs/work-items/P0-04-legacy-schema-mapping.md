# P0-04 — 레거시 스키마·키 참고 매핑

> 상태: `DONE`
>
> 우선순위: `P0`
>
> 담당자: 사용자 본인
>
> 검수자: 사용자 본인
>
> 관련 게이트: `G0`, `D0-04`
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

## 1. 목표와 적용 원칙

`folddraw3.db`의 116개 테이블을 빠짐없이 분류하고, 향후 PostgreSQL·Prisma 모델을 설계할 때 참고할 업무 개념과 레거시 키를 정리한다.

이 문서는 SQLite 스키마를 웹 DB로 복제하거나 SQLite를 실행 기반으로 채택하기 위한 문서가 아니다.

- 웹의 유일한 업무 원본은 별도 PostgreSQL이다.
- 개발·테스트·운영 런타임에서 SQLite를 사용하지 않는다.
- 레거시 테이블은 업무 개념과 선택적 데이터 이관을 위한 참고 자료다.
- 웹 모델은 MFC 실행 메커니즘, 물리 테이블 구조, 화면 단위 SQL을 계승하지 않는다.
- 입면도 데이터는 활성 웹 모델로 이관하지 않고 보관 대상으로만 취급한다.
- 회계·세무·DM 등 확정 범위 밖 기능은 구현 대상에서 제외한다.

## 2. 조사 원본

### 2.1 MFC 프로젝트

```text
/Users/kyhoon/Library/Mobile Documents/com~apple~CloudDocs/회사/hicomtech/도면
```

### 2.2 분석 SQLite

```text
/Users/kyhoon/Library/Mobile Documents/com~apple~CloudDocs/회사/hicomtech/도면/Doc/folddraw3.db
```

동일 checksum이 확인된 배포 복사본:

- `Release/folddraw3.db`
- `Debug/folddraw3.db`

```text
SHA-256: 45ac63d020b36465c41f7593bd6ee60469004c7b352f333d672782d10bcbb229
table: 116
view: 2
index: 211
```

조사는 `sqlite3 -readonly`로 수행했다. 원본 파일은 변경하지 않았다.

## 3. 분류 정의

| 분류 | 의미 | 웹 처리 |
|---|---|---|
| `DOMAIN_REFERENCE` | 대상 업무의 개념·필드·코드·표본을 제공 | Prisma 도메인을 새로 설계하고, 필요 시 offline importer에서 변환 |
| `ARCHIVE_ONLY` | 입면도 또는 과거 백업 | 활성 Prisma 모델로 적재하지 않고 원본·건수·checksum만 보관 |
| `OUT_OF_SCOPE` | 회계·세무·DM·집계 등 1차 웹 범위 밖 | 구현·이관하지 않음. 향후 별도 범위 승인 시 재평가 |
| `TECHNICAL_LEGACY` | MFC/PowerBuilder/PC 인증용 기술 데이터 | 웹에서 재사용하지 않음 |

실제 MFC 참조 PostgreSQL의 109개 테이블과 분포는 [MFC 참조 PostgreSQL 조사](./P0-03-legacy-postgresql-reference.md)를 함께 적용한다. 아래 116개 분류는 SQLite 스키마의 전수 분류이며, 실제 서버 고유 테이블 `count`는 `TECHNICAL_LEGACY`, `itemcutdefault`는 `DOMAIN_REFERENCE`로 추가 판정한다.

## 4. 전체 116개 테이블 분류

### 4.1 `DOMAIN_REFERENCE` — 49개

| 업무군 | 테이블 | 웹 적용 |
|---|---|---|
| 회사·사용자·기존 권한 참고 | `company`, `dept`, `emp`, `usegrade`, `rolemaster`, `roleuser`, `roleform`, `formmaster`, `gradmenu`, `pgmenu` | 웹 독자 인증·RBAC로 재설계. `emp.pwd`는 이전하지 않음 |
| 거래처·현장 | `customer`, `custcharge`, `custgrade`, `custmaster`, `custrelate`, `empcustmanage`, `sitee` | Customer·Contact·Site와 담당 관계의 참고 자료 |
| 재질·품목·공통 코드 | `rawcate`, `itemcate`, `item`, `itemsize`, `refer` | Material·Product·SheetSpec·CodeSet으로 정규화 |
| 가격·계산 기준 | `calcucust`, `costcust`, `costcustraw`, `costgrade`, `costgraderaw`, `costgradesheet`, `itemgradecost`, `itemcutinfo`, `avcutinfo` | 가격표·반올림·재단 보정 규칙을 버전이 있는 정책으로 재설계 |
| 절곡 템플릿 | `drawcate`, `foldd`, `foldxy` | FoldCategory·FoldTemplateRevision·FoldSegment 참고 |
| 수주·작업 스냅샷 | `sellsum`, `sellfold`, `sellfoldxy`, `sellplaninfo`, `sellrawuse`, `sellitem`, `sellsumdraw` | Order·OrderItem·FoldSnapshot·MaterialUsage 참고 |
| 출력·후속 연동 참고 | `printconfig`, `nettime`, `netunit`, `softcomp`, `softmate` | 출력 설정은 서버 템플릿으로 재설계. 기계 통신은 1단계 placeholder만 구성 |
| 레거시 공통 코드 | `codetb`, `syst1000`, `syst1100` | 실제 사용 코드만 명시적 enum 또는 CodeSet으로 선별 |

`DOMAIN_REFERENCE`는 모두 자동 이관한다는 뜻이 아니다. 실제 이관 대상은 운영 데이터 확보 후 P2의 staging/importer 작업에서 건수·사용 여부·품질을 다시 확인한다.

### 4.2 `ARCHIVE_ONLY` — 20개

| 구분 | 테이블 | 처리 |
|---|---|---|
| 날짜가 붙은 과거 사본 | `_customer_old_20250213`, `_item_old_20241223`, `_item_old_20241223_1`, `_sellfold_old_20250213`, `_sellfoldxy_old_20250213` | 원본 manifest에만 기록 |
| 입면도 정의·수주 | `draww`, `drawxy`, `drawvari`, `drawfold`, `selldraw`, `selldrawvari`, `selldrawxy` | 입면도 미구현 원칙에 따라 활성 모델에서 제외 |
| 입면도 계열 과거/보조 구조 | `hdrawcate`, `hdrawfold`, `hdrawtype`, `hdrawvari`, `hdraww`, `hdrawxy`, `hfoldd`, `hfoldxy` | 원본 보관·스키마 참고만 수행 |

### 4.3 `OUT_OF_SCOPE` — 39개

| 업무군 | 테이블 | 제외 근거 |
|---|---|---|
| 계정·자금·수납 | `a000t`, `a100t`, `a200t`, `a250t`, `a300t`, `a400t`, `a500t`, `a600t`, `z100t`, `accountmain`, `accountsub`, `cashinout`, `creditcard`, `payment`, `collection` | 회계·자금 기능은 확정 업무 범위 밖 |
| 매입 | `buyitem`, `buysum` | 매입·매입 집계 기능은 1차 범위 밖 |
| 기간 집계 | `busisumday`, `busisummon`, `itemsumday`, `itemsummon`, `sitesumday`, `sitesummon` | 원천 업무 데이터에서 웹 조회로 재계산하며 레거시 집계는 이관하지 않음 |
| 견적 | `estimain`, `estisub` | 별도 견적 기능은 현재 확정 흐름 밖 |
| 세무 | `taxaddfile`, `taxbuy`, `taxbuydetail`, `taxerror`, `taxsell`, `taxselldetail` | 세금계산서·세무 연동은 범위 밖 |
| DM·상담 | `dmconsult`, `dmcustitem`, `dmitem`, `dmsendcust`, `dmsendinfo`, `note` | CRM/DM 기능은 범위 밖 |
| 보조 정적 데이터 | `calendar`, `zipcode` | 서버 날짜·외부 주소 체계로 대체하며 레거시 정적 데이터를 이관하지 않음 |

### 4.4 `TECHNICAL_LEGACY` — 8개

| 구분 | 테이블 | 웹 처리 |
|---|---|---|
| PC·프로그램 인증·접속 | `auth`, `connectinfo`, `sysinfo` | 장치 serial, PC 사용자, MFC 인증 정보를 사용하지 않음 |
| PowerBuilder catalog | `pbcatcol`, `pbcatedt`, `pbcatfmt`, `pbcattbl`, `pbcatvld` | Prisma/PostgreSQL 업무 모델과 무관하므로 제외 |

분류 합계는 `49 + 20 + 39 + 8 = 116`으로 SQLite의 전체 사용자 테이블 수와 일치한다.

## 5. 핵심 레거시 구조와 웹 개념 매핑

| 레거시 구조 | 주요 키·관계 | 웹 도메인 후보 | 재설계 원칙 |
|---|---|---|---|
| `company` | `compcode` | Organization | 1차 단일 회사 운영, 모든 업무 데이터에 조직 경계 포함 |
| `emp` | `empid`, `deptcode`, `compcode` | User, Membership, Department | 독자 인증 사용. 평문 `pwd` 폐기, 계정은 초대/재설정으로 생성 |
| `rolemaster/roleuser/roleform` | `roleid`, `empid`, 화면명 | Role, Permission, UserRole | 화면명이 아니라 업무 행위 기반 권한으로 재설계 |
| `customer` | 숫자형 `custcode` | Customer | UUID 기본키와 조직 내 고객 코드 분리 |
| `custcharge` | `custcode + chager` | CustomerContact | 표시 이름을 키로 사용하지 않고 UUID 부여 |
| `sitee` | `custcode + sitecode` | Site | Customer 하위 관계와 조직 내 unique 정책 적용 |
| `rawcate` | 숫자형 `rawcode` | Material, SheetSpec | 재질·두께·원판 크기·절단 조건 분리 |
| `item/itemsize` | 숫자형 `itemcode` | Product, ProductVariant, PriceRule | 이름·규격·가격·계산식을 분리하고 개정 추적 |
| `drawcate` | 숫자형 `catecode` | FoldCategory | 입면도 `draww` 분류와 혼동하지 않도록 명시적 명명 |
| `foldd` | 숫자형 `fcode`, `varivalue` | FoldTemplate, FoldTemplateRevision | 템플릿 본체와 변경 불가능한 게시 개정 분리 |
| `foldxy` | `fcode + lineno` | FoldSegment | 순서, 선/호, 방향, 각, 길이, 연산을 명시적 타입으로 변환 |
| `sellsum` | `sellday + sellno` | Order | 날짜 결합키 대신 UUID·주문번호·상태·감사 필드 사용 |
| `sellfold` | 수주 복합키 + `sellno3` | OrderFoldItem, FoldSnapshot | 주문 당시 계산 입력·규칙 버전·결과를 snapshot으로 보존 |
| `sellfoldxy` | 수주 복합키 + `linenof` | FoldSegmentSnapshot | 계산 결과와 원본 입력을 구분하고 Decimal·단위를 명시 |
| `sellplaninfo` | 수주 항목 복합키 | CuttingPlanRequest/Result | 재단 작업은 비동기 job 계약으로 분리 |
| `sellrawuse` | 수주 + 품목 키 | MaterialUsage | 사용량·잔재·원가를 별도 aggregate로 관리 |
| `printconfig` | 출력종류 + 컬럼번호 | PrintTemplate | 서버 템플릿 개정과 출력 이력으로 재설계 |
| `netunit/nettime` | 장치 ID·통신 설정 | Machine placeholder | 1단계에는 상태·권한·계약 버전 항목만 존재 |

## 6. 키·형식 변환 정책

| 레거시 특성 | 웹 정책 |
|---|---|
| `REAL` 형식의 식별자 | PostgreSQL UUID를 기본키로 사용하고, 필요한 경우 `LegacyMapping(source, table, legacyKey)`에 원문 보존 |
| 날짜를 `TEXT(8/14/20)`로 저장 | `date`, `timestamp with time zone`으로 의미에 맞게 변환하고 서울 시간 해석 규칙 기록 |
| 금액·길이·중량을 `REAL`로 저장 | Prisma `Decimal`과 PostgreSQL `numeric(p,s)` 사용. 단위와 반올림 위치를 필드 사전에 기록 |
| 복합 자연키 | UUID 기본키와 별도의 업무 unique constraint로 분리 |
| 이름을 PK 일부로 사용 | UUID 관계키를 사용하고 이름은 변경 가능한 속성으로 취급 |
| `Y/N`, 자유 문자열 코드 | 명시적 boolean/enum 또는 관리형 CodeSet으로 변환 |
| `varivalue`, `formulaa` 문자열 | 버전이 있는 FoldDocument와 안전한 수식 AST/검증 규칙으로 변환 |
| 평문 `emp.pwd` | 절대 이관하지 않음. 웹 계정 초대 또는 비밀번호 재설정으로 전환 |
| PC serial·MAC 기반 인증 | 폐기. 웹 세션과 서버 권한 검사로 대체 |

모든 importer는 원본 키를 부동소수점으로 계산하지 않고 SQLite가 반환한 원문 표현을 canonical string으로 보존해야 한다.

## 7. 데이터 품질·이관 시 확인 항목

1. SQLite 분석 파일은 표본·기초 DB 성격이며 `sellsum`, `sellfold`, `sellfoldxy`가 모두 0건이다.
2. 실제 MFC 참조 PostgreSQL에는 `sellsum` 19,238건, `sellfold` 140,761건, `sellfoldxy` 1,060,688건이 있어 검증·선택적 이관 원본으로 사용한다.
3. 기준정보도 실제 사용 여부, 중복, 비활성 코드, 문자 인코딩을 staging에서 검사한다.
4. 입면도와 범위 밖 테이블은 활성 모델에 섞지 않고 manifest로만 건수·checksum을 대조한다.
5. 레거시 계산값은 정답으로 고정하지 않는다. `PARITY_REQUIRED`, `LEGACY_DEFECT`, `WEB_IMPROVEMENT`, `RULE_CHANGE`, `UNRESOLVED` 판정 후 승인된 기대값으로 검증한다.

## 8. 상세 실행 결과

| 단계 ID | 상태 | 작업 내용 | 검증 |
|---|---|---|---|
| `01` | `DONE` | 전체 사용자 테이블 116개 목록·건수 확인 | SQLite metadata와 대조 |
| `02` | `DONE` | 핵심 테이블 컬럼·복합 PK 확인 | `pragma_table_info`로 확인 |
| `03` | `DONE` | 데이터가 있는 불명확 테이블 구조 확인 | 회계·시스템·코드 용도 판정 |
| `04` | `DONE` | 대상·보관·제외·기술 분류 | 네 분류 합계 116개 |
| `05` | `DONE` | 핵심 키와 웹 도메인 후보 매핑 | UUID·LegacyMapping 정책 반영 |
| `06` | `DONE` | 입면도·SQLite·평문 비밀번호 제외 명시 | 공식 범위 기준선과 대조 |

## 9. 결정 결과

- `folddraw3.db`는 PostgreSQL/Prisma 설계의 참고 자료로만 사용한다.
- 모든 116개 테이블의 처리 분류를 확정했다.
- 실제 MFC 참조 PostgreSQL 109개 테이블은 SQLite 분류에 겹쳐 적용하고 서버 고유 2개 테이블을 추가 판정했다.
- 범위 밖 기능은 현재 이관하지 않으며, 향후 요청 시 별도 작업으로 재평가한다.
- 웹의 신규 데이터 모델은 레거시 물리 스키마를 복제하지 않는다.
- 실제 운영 데이터가 필요한 시점에는 별도 staging/importer와 대조 보고서를 사용한다.

## 10. 완료 기준

- [x] 116개 테이블이 중복·누락 없이 분류됐다.
- [x] 입면도 테이블이 활성 대상에서 제외됐다.
- [x] 사용자·거래처·재질·품목·절곡·수주 후보가 구분됐다.
- [x] 레거시 복합키와 웹 키 변환 원칙이 정의됐다.
- [x] SQLite가 웹 런타임·테스트 의존성이 아님을 명시했다.
- [x] P0-09 Prisma Schema v1 설계의 입력 자료가 마련됐다.

## 11. 변경 기록

| 날짜 | 변경 내용 | 작성자 |
|---|---|---|
| 2026-07-18 | 116개 테이블 전수 분류, 핵심 키·도메인·제외 정책 확정 | 사용자 본인 |
| 2026-07-19 | 실제 MFC 참조 PostgreSQL 109개 테이블과 서버 고유 테이블 판정 추가 | 사용자 본인 |
