# P2-B02 파일 저장소 상세계획

> 상태: `VERIFYING` — `B02-02`~`B02-07` 완료, `B02-08` 화면 테스트 가이드와 사용자 검수 대기
>
> 우선순위: `P2-B02`
>
> 담당자·검수자: 사용자 본인
>
> 계획 작성일: 2026-08-22
>
> 선행 작업: `P2-B01 작업 queue·worker` 검수 완료
>
> 상위 계획: [P2 실행계획](./P2-execution-plan.md)
>
> 관련 결정 게이트: `D2-B02-*` (object storage 제품과 보존·삭제 정책)

## 1. 목표

서버가 만든 파일과 사용자가 올린 파일의 **바이트를 실제로 보관**하고, 조직 경계와 권한을 지킨 채 다시 내려받을 수 있게 한다.

지금은 `FileAsset` 행만 남고 바이트는 어디에도 없다. DXF는 만들자마자 응답으로 흘려보내고(`delivery: "DIRECT_RESPONSE"`), `P2-B01`의 `dxf.export` 작업도 checksum·크기·entity 수만 남긴 채 `contentRetained: false`로 끝난다. 같은 파일을 다시 받으려면 매번 다시 생성해야 하고, worker가 만든 파일은 사용자에게 전달할 방법 자체가 없다.

## 2. 계승하는 확정 기준

| 근거 위치 | 내용 |
|---|---|
| [설계 문서](../web-rebuild-architecture.md) 20. 아직 결정해야 할 사항 | 파일 저장의 권장 출발점은 `S3 호환 object storage` |
| 설계 문서 6.2 배포 단위 | `object-storage`는 DXF, PDF, 미리보기, 가져오기 원본, 결과 파일을 담는다 |
| `prisma/schema.prisma` | `FileAsset(kind, status, storageKey, fileName, mediaType, sizeBytes, checksumSha256, metadata, deletedAt)` 모델이 이미 있다 |
| `P1-16` DXF 출력 | `generated/{organizationId}/dxf/{checksum}.dxf` 키 규칙과 checksum 기반 중복 제거가 이미 동작한다 |

**S3 호환 API를 쓴다는 출발점은 뒤집지 않는다.** 아래 제품 선택은 그 API를 무엇이 제공하느냐의 문제다.

## 3. 결정이 필요한 항목

### `D2-B02-A` 저장 제품 — **확정: (가) MinIO 자가 호스팅**

| 안 | 내용 | 월 비용 | 관리 부담 | 되돌리기 |
|---|---|---|---|---|
| **(가) MinIO 자가 호스팅** (권장) | 지금 쓰는 `compose.yaml`에 MinIO 컨테이너 하나와 데이터 볼륨 하나를 추가한다. S3 호환 API를 그대로 쓴다 | **0원** (기존 서버 디스크만 사용) | 백업 대상 1개 추가, 버전 업그레이드 직접 | 데이터 볼륨을 S3로 복사하면 코드 변경 없이 이전 |
| (나) AWS S3 | AWS 계정에 버킷을 만들고 IAM 자격증명을 배포에 넣는다 | 사용량 과금 (저장 GB·요청·전송). DXF는 수십 KB 수준이라 초기엔 월 1달러 미만으로 예상되나 **새 클라우드 자원과 청구가 생긴다** | 내구성·백업을 AWS가 맡음. 계정·권한·비용 관리가 새로 생김 | 버킷 삭제 |
| (다) 서버 로컬 파일시스템 | Docker volume에 직접 쓴다. S3 API를 쓰지 않는다 | 0원 | 가장 적음 | **설계 문서의 S3 호환 출발점을 벗어난다.** 나중에 옮길 때 저장 계층 코드를 다시 씀 |

**2026-08-22 사용자가 (가)를 확정했다.** 이유는 셋이다.

1. 설계 문서가 정한 `S3 호환` 출발점을 지키므로, 나중에 (나)로 옮길 때 코드가 아니라 접속 정보만 바뀐다.
2. 새 클라우드 자원과 청구가 생기지 않는다. 지금은 단일 조직·단일 서버 부하이고 파일도 작다.
3. worker와 web이 이미 같은 `compose.yaml`에 있으므로 배포·rollback 절차를 그대로 쓴다.

(가)를 골랐으므로 **서버에 컨테이너 1개와 이름 있는 볼륨 1개가 새로 생긴다.** 디스크를 쓰고 백업 대상이 하나 늘어난다는 것을 사용자가 승인했다. 실제 운영 서버 적용은 `P2-C08` 배포 작업에서 함께 한다.

### `D2-B02-B` ~ `D2-B02-L` 나머지 확정안

`D2-B02-A`가 S3 호환 저장소라는 전제 위의 안이다. MinIO와 AWS S3 어느 쪽에서도 그대로 성립한다.

| ID | 결정 | 안 | 근거 |
|---|---|---|---|
| `D2-B02-B` | 저장 계층 경계 | `FileStorage` 인터페이스(`put`, `get`, `head`, `delete`, `signDownloadUrl`) 하나를 두고 S3 호환 구현 하나만 만든다. 업무 코드는 인터페이스만 본다 | 제품을 바꿔도 업무 코드가 흔들리지 않는다. 인터페이스가 없으면 SDK 호출이 서비스마다 퍼진다 |
| `D2-B02-C` | 키 규칙 | 기존 `generated/{organizationId}/{kind}/{checksum}.{ext}`를 유지하고, 사용자 업로드는 `uploads/{organizationId}/{yyyy}/{mm}/{uuid}.{ext}`를 쓴다 | 생성물은 checksum이 같으면 같은 파일이므로 중복 저장을 막는다. 업로드본은 내용이 같아도 별개 문서일 수 있어 UUID로 구분한다 |
| `D2-B02-D` | 조직 경계 | 키 첫 구간에 `organizationId`를 넣고, 모든 조회·서명 발급에서 `FileAsset.organizationId`를 대조한다 | 키를 알아도 다른 조직 파일을 받을 수 없게 한다 |
| `D2-B02-E` | 다운로드 방식 | 서버가 권한을 검사하고 저장소에 객체가 실제로 있는지 확인한 뒤 **5분짜리 presigned URL**을 발급한다. 바이트가 앱 서버를 거치지 않는다 | 큰 파일이 Node 프로세스를 오래 붙잡지 않는다. 만료를 짧게 둬 URL 유출 피해를 줄인다 |
| `D2-B02-F` | 업로드 방식 | 서버가 `PENDING` `FileAsset`을 만들고 presigned PUT URL을 준다. 업로드가 끝나면 클라이언트가 완료를 알리고, 서버가 크기·checksum을 확인한 뒤 `READY`로 바꾼다 | 미완성 업로드가 `READY`로 남지 않는다. 검증을 서버가 한다 |
| `D2-B02-G` | 상한 | 단일 파일 100MB, 허용 media type을 `kind`별로 정한다 | 무제한 업로드는 디스크와 백업을 예고 없이 늘린다 |
| `D2-B02-H` | 무결성 | 저장 시 checksum을 계산해 `FileAsset.checksumSha256`과 대조하고, 다르면 `READY`로 올리지 않는다 | DXF는 장비로 가는 파일이다. 깨진 바이트를 내려보내지 않는다 |
| `D2-B02-I` | 삭제 | 화면 삭제는 `deletedAt`만 찍는 soft delete다. 30일 유예 뒤 정기 작업이 실제 객체를 지운다 | 실수로 지운 도면을 되돌릴 시간을 준다. 즉시 삭제는 되돌릴 수 없다 |
| `D2-B02-J` | 보존 | 생성물(`DXF`, `PDF`, 라벨)은 90일 뒤 정리하고 원본에서 다시 만들 수 있게 한다. 사용자 업로드본과 수주에 연결된 산출물은 자동 정리하지 않는다 | 다시 만들 수 있는 것과 원본밖에 없는 것을 다르게 다룬다 |
| `D2-B02-K` | 정리 작업 | `storage.cleanup` 작업 종류를 `P2-B01` queue에 얹어 유예 만료분과 고아 객체를 처리한다 | queue가 이미 재시도·감사·관측을 갖고 있다. 별도 cron을 만들지 않는다 |
| `D2-B02-L` | 감사 | `file.uploaded`, `file.download_url_issued`, `file.deleted`, `file.purged`를 append-only `AuditEvent`에 남긴다. 파일 내용은 남기지 않는다 | 누가 언제 어떤 파일을 받아 갔는지가 도면 유출 추적의 근거다 |

## 4. 범위

### 포함

- `FileStorage` 인터페이스와 S3 호환 구현, 로컬·테스트 환경 구성
- 업로드·다운로드·삭제 API와 권한·조직 경계 검사
- `FileAsset` 상태 흐름(`PENDING` → `READY` → soft delete → 실제 삭제)
- `dxf.export` 작업이 만든 바이트를 실제로 보관하고 `contentRetained: true`로 바꾸기
- 기존 동기 DXF 경로에서도 같은 저장소를 쓰도록 연결
- `storage.cleanup` 정기 작업과 감사 이벤트
- 백업 대상과 복구 절차를 [배포 가이드](../deployment-guide.md)에 반영

### 제외

- 대량 DXF 묶음 생성과 화면 진입 버튼 (`P2-B09`)
- PDF·라벨 생성 (`P2-B07`, `P2-B08`)
- 데이터 이전에서 오는 기존 파일 연결 (`P2-C05`)
- 운영 서버 구성 변경과 실제 배포 (`P2-C08`)
- 바이러스 검사, 외부 공유 링크

## 4.1 파일 종류별 정책

`src/server/files/file-kind.ts` 한 곳에서 정한다. 화면과 라우트가 각자 판단하면 규칙이 갈라진다.

| 종류 | 업로드 권한 | 다운로드 권한 | 허용 형식 | 상한 | 사용자 업로드 | 재생성 가능 |
|---|---|---|---|---|---|---|
| `DXF` | `output.print` | `output.print` | dxf | 20MB | 불가(서버 생성물) | 가능 |
| `PDF` | `output.print` | `output.print` | pdf | 50MB | 불가 | 가능 |
| `PREVIEW` | `template.fold.edit` | `template.fold.read` | png, jpg, webp | 10MB | 불가 | 가능 |
| `FOLD_DOCUMENT` | `template.fold.edit` | `template.fold.read` | json | 10MB | 가능 | 불가 |
| `IMPORT_SOURCE` | `admin.manage` | `admin.manage` | csv, json, xls, xlsx, zip | 100MB | 가능 | 불가 |
| `OTHER` | `order.edit` | `order.read` | pdf, png, jpg, txt | 20MB | 가능 | 불가 |

`재생성 가능`이 `가능`인 종류만 보존 기간이 지나면 정리한다(`D2-B02-J`).

## 5. API 계약(안)

```text
POST   /api/v1/files/uploads          업로드 시작 (kind, fileName, mediaType, sizeBytes)
POST   /api/v1/files/:fileId/complete 업로드 완료 확인과 검증
GET    /api/v1/files/:fileId          metadata 조회
POST   /api/v1/files/:fileId/downloads 다운로드 URL 발급 (5분 만료)
DELETE /api/v1/files/:fileId          soft delete
```

## 6. 완료 기준

- [x] 업로드한 파일을 다시 내려받으면 checksum이 같다.
- [x] 다른 조직의 `fileId`와 storageKey로는 metadata도 다운로드 URL도 얻을 수 없다.
- [x] 권한이 없는 사용자가 다운로드 URL을 요청하면 거부된다.
- [x] 업로드를 중간에 끊으면 `PENDING`으로 남고 `READY`가 되지 않는다.
- [x] `dxf.export` 작업 결과로 실제 파일을 내려받을 수 있고 동기 경로와 checksum이 같다.
- [x] soft delete한 파일은 목록에서 사라지지만 유예 기간 안에는 객체가 남아 있다.
- [x] 만료된 URL로는 받을 수 없다.
- [x] 단위·PostgreSQL 통합·API·Playwright·lint·typecheck·migration·build를 통과한다.
- [x] 백업 대상과 복구 절차가 배포 가이드에 적혀 있다.

## 7. 구현 순서(안)

| 단계 | 작업 |
|---|---|
| `B02-01` | 결정안 승인과 저장 제품 확정 (`DONE` — 2026-08-22) |
| `B02-02` | `FileStorage` 인터페이스와 S3 호환 구현, 로컬·테스트 환경 (`DONE` — 2026-08-22) |
| `B02-03` | 업로드 시작·완료 API와 검증 (`DONE` — 2026-08-22) |
| `B02-04` | 다운로드 URL 발급과 권한·조직 경계 (`DONE` — 2026-08-22) |
| `B02-05` | soft delete와 `storage.cleanup` 정기 작업 (`DONE` — 2026-08-22) |
| `B02-06` | `dxf.export`와 동기 DXF 경로를 저장소에 연결 (`DONE` — 2026-08-22) |
| `B02-07` | 감사 이벤트와 배포·백업 문서 (`DONE` — 2026-08-22) |
| `B02-08` | 화면 테스트 가이드와 사용자 검수 (`IN_PROGRESS` — [가이드](../P2-B02-screen-test-guide.md) 작성 완료, 사용자 검수 대기) |

## 7.1 검증 결과

| 검증 | 명령 | 결과 |
|---|---|---|
| 단위 | `npm test` | 성공 — 329건 (저장소 키·환경설정 9건, DXF 보관 성공·실패 2건 추가) |
| PostgreSQL·저장소 통합 | `npm run test:integration` | 성공 — 93건 (파일 9건, 저장소 8건 추가) |
| 저장소 단독 | `npm run test:storage` | 성공 — 실제 MinIO 상대 |
| E2E | `npm run test:e2e` | 성공 — 33개 시나리오 (파일 API 5건 추가) |
| lint·typecheck | `npm run lint`, `npm run typecheck` | 성공 |
| migration | `npm run db:migrate:check` | 차이 없음. 기존 `FileAsset` 모델을 쓴다 |
| build | `npm run build` | 성공 |

통합 테스트가 확인하는 것은 다음과 같다.

- 저장·재읽기 checksum 일치, checksum 불일치 저장 거부, presigned 업로드·다운로드 왕복, 만료된 URL 거부
- 업로드 시작→완료 전이와 감사, 중단 시 `PENDING` 유지, 내용 불일치 시 `FAILED`와 객체 삭제
- 다른 조직·권한 없는 사용자 차단, 서버 생성물 종류와 허용하지 않는 형식 거부
- soft delete 후 유예 기간 객체 유지, 유예 만료 뒤 정리 작업의 실제 삭제, 업로드본 자동 정리 제외
- queue 경로 DXF 보관과 다운로드 URL 왕복

E2E가 확인하는 것은 다음과 같다. 실제 브라우저 session 과 presigned URL 왕복을 거친다.

- 업로드 시작 → presigned PUT → 완료 → `READY` 전이와 다운로드 URL 왕복, 내용 일치
- 완료 전 다운로드 요청 거절, 삭제 후 조회·발급 차단, 유예 기간 안 객체 유지
- 내용 불일치 완료 거절과 `FAILED` 전이
- 서버 생성물 종류·허용하지 않는 확장자·잘못된 checksum 형식 거절
- 없는 파일(`404`)과 잘못된 식별자(`400`) 구분

## 8. 위험과 대응

| 위험 | 대응 |
|---|---|
| 저장소가 죽으면 DXF 출력이 멈춘다 | 동기 DXF 경로는 저장 실패 시에도 응답으로 바이트를 내보내 업무가 멈추지 않게 한다. 저장 실패는 감사와 로그에 남긴다 |
| 디스크가 조용히 찬다 | 파일 총량·건수 조회를 두고, 보존 기간과 상한으로 상한선을 만든다 |
| presigned URL이 유출된다 | 만료 5분, 발급 감사, 조직·권한 검사를 발급 시점에 한다 |
| 백업에서 파일만 빠진다 | DB와 저장소를 같은 절차에서 함께 백업하도록 배포 가이드에 못 박는다 |
| 저장소에만 있고 DB에 없는 고아 객체 | `B02-05`에서는 DB 기준으로만 정리한다. 저장소 목록 조회 기반 고아 정리는 실제로 고아가 생기는 경로(`P2-B09` 대량 생성)가 붙은 뒤에 만든다 |

## 9. 변경 기록

| 날짜 | 변경 내용 | 작성자 |
|---|---|---|
| 2026-08-22 | 결정안 최초 작성. `D2-B02-A` 저장 제품을 사용자 결정 항목으로 올리고 나머지 `B~L`은 그 전제 위의 안으로 정리 | Claude |
| 2026-08-22 | `D2-B02-A`를 MinIO 자가 호스팅으로 확정. 새 클라우드 자원과 청구를 만들지 않고 설계 문서의 S3 호환 출발점을 지킨다. 상태를 `READY`로 변경 | 사용자·Claude |
| 2026-08-22 | `B02-02` 완료. `FileStorage` 인터페이스와 S3 호환 구현, 키 규칙, 로컬 `compose.yaml`의 MinIO 서비스와 통합 테스트를 만들었다 | Claude |
| 2026-08-22 | `B02-03` 완료. 업로드 시작·완료 API, 파일 종류별 권한·형식·크기 정책, checksum·크기 검증과 감사 이벤트를 만들었다 | Claude |
| 2026-08-22 | `B02-04` 완료. 다운로드 URL 발급에 권한·조직 경계·상태 검사와 발급 감사를 붙였다. 감사 분류는 schema 에 `DATA_ACCESS`가 없어 기존 DXF 출력과 같은 `OUTPUT`을 쓴다 | Claude |
| 2026-08-22 | `B02-05` 완료. soft delete 와 `storage.cleanup` 작업 종류를 만들었다. 고아 객체 정리는 저장소 목록 조회가 필요해 후속으로 남긴다 | Claude |
| 2026-08-22 | `B02-06` 완료. 동기·queue 양쪽 DXF 경로가 바이트를 저장소에 보관하고 `contentRetained`가 `true`가 된다. 저장 실패는 출력 자체를 막지 않고 `PENDING`과 감사로 남긴다 | Claude |
| 2026-08-22 | `B02-07` 완료. 배포 가이드에 저장소 서비스·환경변수·백업 대상과 복구 순서·정리 정책을 적었다 | Claude |
| 2026-08-22 | 검수 중 발견: `READY`인데 바이트가 없는 행(저장소 도입 전 생성분)에 URL을 발급해 사용자가 저장소의 XML 오류를 보게 됐다. 발급 전에 객체 존재를 확인하고 없으면 `PENDING`으로 되돌리도록 고쳤다 | 사용자·Claude |
| 2026-08-22 | 화면 테스트 가이드 작성. 파일 기능을 쓰는 화면이 아직 없어 `P2-B01`과 같이 콘솔 API 검수로 한다. 사용자용 진입점은 `P2-B09`에서 만든다 | 사용자·Claude |
