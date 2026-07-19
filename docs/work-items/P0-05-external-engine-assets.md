# P0-05 — 외부 엔진·라이선스 자산 조사

> 상태: `DONE`
>
> 우선순위: `P0`
>
> 담당자: 사용자 본인
>
> 검수자: 사용자 본인
>
> 관련 게이트: `G0`, `D0-05`
>
> 계획 작성일: 2026-07-18
>
> 착수일: 2026-07-18
>
> 완료일: 2026-07-19
>
> 상위 계획: [fold_web 전체 프로젝트 작업계획서](../project-work-plan.md)
>
> P0 실행계획: [P0 실행계획](./P0-execution-plan.md)

## 1. 목표

MFC 프로젝트가 의존하는 재단, DB, 출력, DXF, 기계 통신 자산의 소스·바이너리·문서·권리 상태를 확인하고 웹에서의 재사용 또는 대체 전략을 확정한다.

단순히 DLL이 존재한다는 이유만으로 웹 서버에 포함하지 않는다. 운영 OS·아키텍처·라이선스·유지보수 가능성을 모두 통과한 자산만 사용할 수 있다.

## 2. 조사 기준 경로

MFC 프로젝트:

```text
/Users/kyhoon/Library/Mobile Documents/com~apple~CloudDocs/회사/hicomtech/도면
```

Visual Studio solution:

```text
/Users/kyhoon/Library/Mobile Documents/com~apple~CloudDocs/회사/hicomtech/도면/Drawing.sln
```

솔루션이 기대하는 공용 Engine:

```text
/Users/kyhoon/Library/Mobile Documents/com~apple~CloudDocs/회사/Engine
```

마지막 경로는 현재 존재하지 않는다.

## 3. Visual Studio 참조 조사

`Drawing.sln`과 `Drawing.vcxproj`가 참조하는 주요 프로젝트의 현재 상태는 다음과 같다.

| 프로젝트 | 기대 상대 경로 | 현재 상태 | 용도 |
|---|---|---|---|
| `HiCommon_2022` | `../../Engine/Src/HiCommon` | 소스 없음 | 공통 유틸리티 |
| `HiCuttingSolver_2022` | `../../Engine/Src/HiCuttingSolver` | 소스 없음, DLL/LIB 있음 | 재단 최적화 |
| `HiGrid2022` | `../../Engine/Src/HiGrid` | 소스 없음, DLL/LIB 있음 | MFC Grid UI |
| `HiDB2022` | `../../Engine/Src/HiDB` | 소스 없음, DLL/LIB 있음 | 레거시 DB 연결 |
| `HiDBData2022` | `../../Engine/Src/HiDBData` | 소스 없음, DLL/LIB 있음 | 레거시 DB 데이터 구조 |
| `HiFTPClient2022` | `../../Engine/Src/HiFTPClient` | 소스 없음 | 레거시 파일 전송 |
| `HiSerialComm2022` | `../../Engine/Src/HiSerialComm` | 소스 없음, DLL/LIB 있음 | 기계 serial 통신 |
| `HiCuttingSovlerExtend_2022` | `../../Engine/Src/HiCuttingSovlerExtend_2022` | 소스·동명 바이너리 없음 | solver 확장 |
| `HiDrawingReport2022` | `InDll/HiDrawingReport` | 소스·프로젝트·DLL 있음 | Windows 보고서 bridge |
| `HiReportChild` | `InDll/HiReportChild` | C# 소스·프로젝트·DLL 있음 | DevExpress 보고서 UI |

솔루션의 공용 Engine 프로젝트 8개가 현재 기준 경로에서 누락돼 있다. 빌드 산출물만으로는 수정·이식·Linux 서버 운영이 불가능하다.

## 4. 자산별 판정과 웹 전략

| 자산 | 확인된 근거 | 현재 판정 | 권장 웹 전략 |
|---|---|---|---|
| HiCuttingSolver | Release DLL/LIB, Debug DLL/LIB/PDB 존재. 소스 프로젝트는 누락 | `BEHAVIOR_REFERENCE_ONLY` | P2 전까지 중립 재단 계약과 golden master를 만들고 서버용 solver를 독립 재구현 |
| HiCuttingSolverExtend | solution 참조만 있고 현재 소스·바이너리 미발견 | `MISSING` | 호출 기능을 MFC 코드·표본으로 식별해 신규 solver 요구사항에 포함 |
| HiDB/HiDBData | Windows DLL/LIB 존재, 공용 Engine 소스 누락 | `DO_NOT_REUSE` | PostgreSQL·Prisma repository로 완전 대체 |
| HiGrid | Windows UI 라이브러리 | `DO_NOT_REUSE` | 웹 table/editor 컴포넌트로 대체 |
| HiFTPClient | 프로젝트 참조만 있고 소스 미확인 | `DO_NOT_REUSE` | 필요 시 object storage/HTTPS 전송으로 대체 |
| HiSerialComm | Windows DLL/LIB 존재, 소스 누락 | `DEFER_TO_P3` | 1단계 placeholder만 제공. P3에서 현장 Windows Agent와 계약 재설계 |
| HiDrawingReport/HiReportChild | 로컬 소스 존재, DevExpress 18.1 의존, Windows/.NET bridge | `REPLACE` | 서버 HTML/PDF/인쇄 템플릿으로 재구현 |
| MFC DXF 코드 | `HiExportDxf`, `Mydxf`, `DxfFormat` 소스와 출력 표본 존재 | `BEHAVIOR_REFERENCE` | geometry와 분리된 서버 DXF writer를 새로 작성하고 표본으로 검증 |
| dxflib 3.26.4 | 소스 header에 GPL v2+ 또는 Professional commercial license 조건 명시 | `LICENSE_CONFIRMATION_REQUIRED` | 기본안은 웹 코드에 복사하지 않고 필요한 ASCII DXF writer를 독립 구현 |
| Cut_Pro | Windows x64 .NET 실행 파일과 다수 상용/제3자 DLL 존재 | `REFERENCE_ONLY` | 웹 서버에 포함하지 않음. 결과·입출력 표본이 필요할 때만 별도 실행 환경에서 비교 |

## 5. 바이너리 호환성 증거

| 파일 | 형식 | SHA-256 |
|---|---|---|
| `Release/HiCuttingSolver.dll` | PE32, Intel 80386, Windows DLL | `45f3ba081c3727b02f0f1fb60279f5d1180e7b5e11c65e5ac02f36da7fbe887a` |
| `Release/HiDB.dll` | PE32, Intel 80386, Windows DLL | `2fba900b480dd886d976bdc79407d468514cb520d533dfea507c5c10cc2a78dd` |
| `Release/HiDBData.dll` | PE32, Intel 80386, Windows DLL | `6796195265b61292fe5649bc77a400e3161cda71e9a7c1121aea58143023b098` |
| `Release/HiSerialComm.dll` | PE32, Intel 80386, Windows DLL | `bc93aaf98f2bfd52137abe8d8bdad60f1c9121702a41d39b30b1ba76c99c3607` |
| `Release/HiDrawingReport.dll` | PE32, Intel 80386, Windows .NET DLL | `c3f0c3d8bf4abb5db26094e376133fa77749c9090a521e535051c3ec4580527f` |
| `Debug/CutPro/Cut_Pro.exe` | PE32+, x86-64, Windows .NET executable | `cb6de7fe6d62fdb620ae94b470693b686c8ffd0f688da56d43cd76c8091031d4` |

이 파일들은 macOS 개발 환경이나 일반적인 Linux 웹 서버 프로세스에서 직접 실행할 수 없다. 또한 32비트 DLL을 64비트 프로세스에 직접 적재할 수 없다.

## 6. 라이선스 조사 결과

### 6.1 자체 프로그램 약관

`install2015/InstallPackage/LicenseKor.txt`는 프로그램 소유권, 복제·수정·역공학 제한을 포함한다. 이 약관이 고객 배포용인지, 현재 웹 재개발 주체가 원저작권자로서 별도 권리를 갖는지는 파일만으로 확정할 수 없다.

따라서 기존 MFC 소스와 자체 Engine을 웹 프로젝트에 재사용·수정·재배포할 권리가 현재 개발 주체에 있는지 사용자 확인이 필요하다.

### 6.2 dxflib

`dxflib/dl_dxf.h`와 `dl_dxf.cpp`에는 다음 선택 라이선스가 명시돼 있다.

- GNU GPL version 2 or later
- 유효한 dxflib Professional Edition 보유자를 위한 별도 commercial license

상용 웹서비스의 배포 정책과 호환되는 상용 라이선스 증빙이 확인되지 않았다. P0에서는 dxflib 소스를 신규 웹 저장소에 복사하지 않는다.

### 6.3 DevExpress·Cut_Pro 의존성

배포 폴더에 DevExpress 18.1/21.2, Eyeshot, ODA 계열 DLL이 존재하지만 계약서·구매증빙·서버 재배포 권리는 확인되지 않았다. 웹에서는 이 바이너리들을 재사용하지 않는 것을 기본안으로 한다.

## 7. 권장 아키텍처 결정안

### 7.1 즉시 확정 가능한 항목

- HiDB, HiDBData, HiGrid, HiFTPClient는 웹에서 사용하지 않는다.
- 보고서·인쇄는 웹 서버용 템플릿으로 새로 구현한다.
- DXF는 geometry 결과를 입력받는 독립 writer로 새로 구현한다.
- 기계 통신은 1단계에 placeholder만 두고 실제 DLL/Agent 결정은 P3로 미룬다.
- 레거시 바이너리와 제3자 DLL은 웹 애플리케이션 artifact나 container에 포함하지 않는다.

### 7.2 재단 solver 권장안

기본 권장안은 `CLEAN_REIMPLEMENTATION`이다.

1. MFC/Cut_Pro에서 입력·제약·결과를 golden master로 수집한다.
2. 원판, 부품, 회전, 결 방향, trim, blade, 잔재를 표현하는 중립 계약을 만든다.
3. 기존 DLL 내부 구조가 아닌 승인된 업무 규칙과 결과 특성을 기준으로 서버 solver를 구현한다.
4. 결과는 단일 배치 일치만 요구하지 않고 원판 수, 사용 면적, 수율, 제약 위반, 실행시간을 검증한다.
5. 레거시의 비합리적 결과는 `LEGACY_DEFECT` 또는 `WEB_IMPROVEMENT`로 승인 후 개선한다.

Engine 소스는 제공되지 않으며 기존 알고리즘의 포팅이나 binary wrapper는 채택하지 않는다. Windows 32비트 DLL을 웹 서버 프로세스에 직접 결합하지 않고, 승인된 업무 계약과 관찰 가능한 입출력 표본을 기준으로 독립 구현한다.

## 8. P1~P3 영향

| 후속 작업 | 영향 |
|---|---|
| P1 절곡 계산·DXF | solver와 독립적으로 진행 가능. DXF는 신규 writer 사용 |
| P2 재단 계약·worker | solver 결정 전에도 계약·queue·표본 수집 진행 가능 |
| P2 신규 재단 solver | 중립 계약과 승인 표본을 기준으로 서버 worker에서 독립 구현 |
| P2 출력 | DevExpress 없이 서버 템플릿으로 구현 |
| P3 기계 연동 | HiSerialComm을 직접 웹 서버에 탑재하지 않고 현장 Agent 대안 검토 |

## 9. 상세 실행 결과

| 단계 ID | 상태 | 작업 내용 | 검증 |
|---|---|---|---|
| `01` | `DONE` | solution·vcxproj 외부 참조 추출 | 프로젝트 참조·link 설정 대조 |
| `02` | `DONE` | 소스·LIB·DLL·문서 존재 확인 | 기대 경로 실재 여부와 file 형식 확인 |
| `03` | `DONE` | 호출 기능과 P1~P3 연결 | 코드 call site와 작업계획 대조 |
| `04` | `DONE` | 재사용·wrapper·재구현 비교 | 운영 OS·아키텍처·유지보수성 비교 |
| `05` | `DONE` | 라이선스 확인 필요 자산 분류 | 로컬 약관·source header 확인 |
| `06` | `DONE` | 누락 Engine의 확보 가능 여부 확인 | 소스 없음, 재사용하지 않음 |
| `07` | `DONE` | 최종 solver 전략 확정 | 독립 재구현 승인 |

## 10. 사용자 결정 결과

- 공용 `Engine/Src`와 재단 Engine 소스는 제공되지 않는다.
- 기존 Engine 소스와 DLL을 웹 구현에 재사용하거나 포팅하지 않는다.
- 재단·DXF·출력·DB·기계 연동은 웹 아키텍처에 맞는 계약으로 독립 재구현한다.
- 기존 실행 결과는 정답 코드가 아니라 비교 증거로만 사용한다.
- 독립 구현 결과는 레거시 오류·비합리성·웹 개선점을 별도 판정해 승인한다.

## 11. 완료 기준

- [x] 주요 외부 프로젝트와 바이너리 존재 상태가 기록됐다.
- [x] 운영 OS·아키텍처 부적합성이 기록됐다.
- [x] 웹에서 즉시 제외·대체할 구성요소가 분류됐다.
- [x] dxflib과 배포 약관의 확인 필요성이 기록됐다.
- [x] 기존 소스·Engine을 재사용하지 않기로 확정됐다.
- [x] 공용 Engine 소스가 제공되지 않음을 확인했다.
- [x] 재단 solver의 독립 재구현 전략이 승인됐다.

## 12. 변경 기록

| 날짜 | 변경 내용 | 작성자 |
|---|---|---|
| 2026-07-18 | 프로젝트 참조, 소스·바이너리, 라이선스 파일 조사 및 권장 대체 전략 작성 | 사용자 본인 |
| 2026-07-19 | Engine 소스 없음과 독립 재구현 방식을 승인하고 P0-05 완료 | 사용자 본인 |
