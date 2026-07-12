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
- 단일 `app` 서비스의 Docker Compose 구성

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
APP_IMAGE=organization/fold-web:v1.0.0 docker compose pull app
APP_IMAGE=organization/fold-web:v1.0.0 docker compose up -d --no-build app
```

포트는 `127.0.0.1`에만 바인딩하며, 외부 HTTPS 요청은 기존 리버스 프록시가 전달한다.
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
