# Docker CI/CD 단계별 구성

## 1단계: 운영 Docker 이미지

상태: 완료

- Next.js `standalone` 출력 사용
- Node.js 22 Alpine 멀티스테이지 빌드
- non-root `nextjs` 사용자로 실행
- 컨테이너 내부 애플리케이션 포트 `3000`
- 서버 호스트 기본 포트 `127.0.0.1:10000`
- `/api/health` 상태 확인
- 운영 서버와 동일한 `linux/amd64` 이미지 검증
- 같은 이미지를 쓰는 `app`·`worker` 두 서비스의 Docker Compose 구성

로컬 검증 명령:

```bash
docker build --platform linux/amd64 -t fold-web:local .
docker run --rm -p 127.0.0.1:3100:3000 fold-web:local
curl http://127.0.0.1:3100/api/health
```

Docker Compose 로컬 실행:

```bash
APP_PORT=3100 docker compose up -d --build
docker compose ps
curl http://127.0.0.1:3100/api/health
docker compose down
```

운영 서버에서는 동일한 `compose.yaml`에 Docker Hub 이미지 태그를 전달한다.

```bash
APP_IMAGE=organization/fold-web:v1.0.0 docker compose pull
APP_IMAGE=organization/fold-web:v1.0.0 docker compose up -d --no-build
```

포트는 `127.0.0.1`에만 바인딩하며, 외부 HTTPS 요청은 기존 리버스 프록시가 전달한다.

### worker 서비스

`P2-B01`부터 작업 queue를 처리하는 `worker` 서비스가 같은 이미지로 함께 뜬다. 진입점만 다르다.

- 이미지: `app`과 동일. `npm run build`가 Next.js standalone 출력과 함께 `worker.mjs` 번들을 만든다
- 실행: `node worker.mjs`
- 포트를 열지 않는다. HTTP를 받지 않고 PostgreSQL만 본다
- `stop_grace_period`는 60초다. 종료 신호를 받으면 새 작업을 잡지 않고 실행 중인 작업이 끝나기를 기다린다
- 끝내지 못한 작업은 lease가 만료되면 다른 worker가 회수하므로 강제 종료해도 유실되지 않는다

worker 전용 환경변수는 다음과 같다. DB 접속 정보는 `app`과 같은 값을 쓴다.

| 변수 | 기본값 | 설명 |
|---|---|---|
| `WORKER_DATABASE_STATEMENT_TIMEOUT_MS` | `60000` | 긴 작업이 web용 5초 timeout에 끊기지 않게 따로 잡는다 |
| `WORKER_DATABASE_CONNECTION_LIMIT` | `4` | web과 DB 연결을 두고 경쟁하지 않게 낮게 잡는다 |
| `WORKER_IDLE_POLL_MS` | `2000` | 큐가 비었을 때 다시 확인하는 간격 |
| `WORKER_MAINTENANCE_INTERVAL_MS` | `60000` | lease 회수와 종료 작업 정리 주기 |
| `WORKER_JOB_RETENTION_DAYS` | `90` | 끝난 작업을 큐 테이블에서 지우기까지의 기간 |
| `WORKER_ID` | 호스트명 | 로그와 lease 소유자 표시에 쓴다 |

worker를 여러 개 띄워도 된다. `FOR UPDATE SKIP LOCKED`로 작업을 잡으므로 같은 작업을 두 번 처리하지 않는다.

로컬에서는 컨테이너 없이 다음으로 실행한다.

```bash
npm run worker
```

`server-only`가 일반 Node 실행에서 예외를 던지므로 이 스크립트는 `--conditions=react-server`를 붙인다. 번들(`worker.mjs`)은 빌드 시점에 같은 조건으로 만들어져 별도 플래그가 필요 없다.

배포 스크립트는 `docker compose pull`과 `up -d`로 두 서비스를 함께 교체한다. 상태 확인은 `app` 컨테이너의 `/api/health`로 하며, worker는 헬스체크 대상이 아니다. worker가 뜨지 않아도 웹 기능은 계속 동작하고 작업만 큐에 쌓인다.
운영 리버스 프록시의 upstream은 `http://127.0.0.1:10000`으로 설정한다.

## 2단계: GitHub CI

상태: 완료

태그와 Pull Request에서 다음 항목을 검증한다.

- 의존성 설치
- 테스트
- ESLint
- Next.js production build
- Docker `linux/amd64` 이미지 빌드
- Docker Compose 설정 검사
- Node와 Docker 빌드 캐시 사용

이 단계에는 계정 비밀값이 필요하지 않다.

실행 조건:

- `main` 대상 Pull Request
- `main` 브랜치 push
- `v*` 태그 push
- GitHub Actions 수동 실행

## 3단계: Docker Hub 게시

Git 태그가 `main` 브랜치 커밋을 가리킬 때 이미지를 게시한다.

필요한 결정과 사용자 작업:

- Docker Hub 사용자 또는 조직명
- Docker Hub 저장소명
- GitHub Secrets에 `DOCKERHUB_USERNAME`, `DOCKERHUB_TOKEN` 등록
- 배포 태그 형식 확정 (`v*` 권장)

## 4단계: Naver Cloud 배포

Docker Hub 이미지를 서버에서 가져와 컨테이너를 교체한다.

필요한 결정과 사용자 작업:

- 실제 서비스 도메인 (`app1` 또는 `pp1`) 확정
- SSH 호스트, 사용자, 포트
- 서버 배포 경로
- Nginx 등 리버스 프록시가 연결할 로컬 포트
- GitHub Secrets에 SSH 접속 정보 등록

## 5단계: 상태 검사와 롤백

- 새 컨테이너의 `/api/health` 확인
- 실패 시 직전 이미지 태그로 복원
- 최근 성공 이미지와 배포 기록 유지
- 운영 배포 및 의도적인 실패 롤백 시험
