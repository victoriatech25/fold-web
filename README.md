# FOLD WEB

MFC `도면Pro`(절곡·재단 업무 프로그램)를 Next.js·PostgreSQL·Prisma 로 다시 세운 웹 서비스다. 절곡 도면 설계·전개 계산·수주·재단 배치·장비용 DXF 출력까지를 한 곳에서 다룬다.

## 실행

PostgreSQL 16 이 호스트(`127.0.0.1:5432`)에 떠 있어야 한다. 역할·DB 구성은 [P0-08](./docs/work-items/P0-08-postgresql-environment.md)을 따른다.

```bash
cp .env.example .env.local     # 값을 채운다
npm ci
npm run db:migrate:deploy
npm run db:seed
docker compose up -d storage   # 파일 저장소(MinIO)
npm run dev                    # http://localhost:8000
npm run worker                 # 작업 큐 처리기. 없으면 재단 계산·DXF 생성이 끝나지 않는다
```

로컬 화면 검수 계정은 [local-screen-test-account.md](./docs/local-screen-test-account.md)에 있다.

## 검증

```bash
npm run typecheck
npm run lint
npm test                    # 단위
npm run test:integration    # PostgreSQL 통합. 테스트 DB 를 초기화한다
npm run test:e2e            # Playwright. 개발 서버를 내리고 돌린다
npm run build
```

## 문서

- [현재 구현 현황](./docs/current-implementation-status.md) — 무엇이 되고 무엇이 안 되는지
- [P2 실행계획](./docs/work-items/P2-execution-plan.md) — 진행 순서와 다음 작업
- [Docker 및 배포 가이드](./docs/deployment-guide.md) — 이미지·compose·배포 절차·마이그레이션
- [웹 재구축 종합 설계](./docs/web-rebuild-architecture.md) — 확정 기준
- [작업 항목](./docs/work-items/) — 항목별 결정과 근거. 문서는 반말로, 화면 문구는 존댓말로 쓴다

## 구조

```
src/domain/        순수 계산·계약 (절곡 계산, 재단 solver·검증, DXF 조립)
src/server/        서비스·권한·감사·큐·저장소 (server-only)
src/app/           Next.js App Router 화면과 /api/v1 라우트
src/components/    화면 컴포넌트
src/worker/        작업 큐 worker 진입점
prisma/            스키마·마이그레이션·시드
e2e/               Playwright
deploy/            운영 compose·배포 스크립트
```
