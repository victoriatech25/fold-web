# 로컬 화면 테스트 계정

> 적용 범위: 개발자 PC의 `fold_web_dev` PostgreSQL과 `localhost` 화면 검수 전용
>
> 운영 사용: 금지
>
> 작성일: 2026-07-25

## 계정 정보

| 항목 | 값 |
|---|---|
| 접속 주소 | `http://localhost:8000` |
| 이메일 | `screen-test-admin@local.test` |
| 비밀번호 | `Browser verification phrase 2026!` |
| 표시 이름 | `로컬 화면 테스트 관리자` |
| 조직 | `LOCAL_DEV` |
| 역할 | `ADMINISTRATOR` |

이 계정은 로컬 화면 기능을 반복 검수하기 위한 고정 테스트 계정이다. 실제 사용자·운영 데이터·운영 자격증명으로 사용하지 않는다. 비밀번호는 공개된 테스트 값이므로 외부 접근이 가능한 환경에서 절대 사용하지 않는다.

## 최초 생성과 상태 복구

`.env.local`을 적용한 프로젝트 루트에서 다음 명령을 실행한다.

```bash
npm run auth:ensure-local-screen-test-account
```

명령은 다음 상태를 멱등하게 보장한다.

- 계정이 없으면 생성한다.
- 계정을 `ACTIVE`로 복구한다.
- `LOCAL_DEV` 조직 membership과 `ADMINISTRATOR` 역할을 보장한다.
- 비밀번호를 `.env.local`의 고정 테스트 값으로 다시 설정한다.
- 기존 session과 사용하지 않은 비밀번호 재설정 token을 폐기한다.
- 생성 또는 비밀번호 복구 이력을 감사 로그에 남긴다.

DB를 초기화한 경우에는 migration과 기준정보 seed를 적용한 뒤 계정을 다시 보장한다.

```bash
npm run db:migrate:deploy
npm run db:seed
npm run auth:ensure-local-screen-test-account
```

## 안전장치

계정 보장 명령은 아래 조건을 모두 만족할 때만 실행된다.

- `LOCAL_SCREEN_TEST_ACCOUNT_ENABLED=true`
- `NODE_ENV`가 `production`이 아님
- PostgreSQL host가 `localhost`, `127.0.0.1` 또는 `::1`
- database 이름이 `_dev`로 끝남
- `APP_ORIGIN`이 loopback 주소
- 계정 이메일이 예약된 `.test` 도메인

기준정보 `prisma/seed.ts`에는 사용자를 추가하지 않는다. 따라서 운영·테스트 DB에 이 계정이 일반 seed로 유입되지 않으며, 로컬 전용 명령을 명시적으로 실행해야 한다.

## 화면 검수 원칙

1. 반드시 `http://localhost:8000`으로 접속한다. 현재 `APP_ORIGIN`이 이 주소와 정확히 일치해야 mutation이 허용된다.
2. 화면 검수 시작 시 위 계정으로 로그인한다.
3. 권한 없는 화면 검수가 필요하면 별도 조회 전용 fixture를 사용하고 이 관리자 계정의 역할을 변경하지 않는다.
4. 로그인 실패가 반복되어 제한된 경우 15분을 기다리거나 로컬 개발 DB의 인증 throttle 상태를 점검한다.

## 로그인 문제 해결

### `허용되지 않은 요청 출처입니다.`

이 오류는 계정·비밀번호 오류가 아니라 브라우저 주소와 `APP_ORIGIN`이 다를 때 발생하는 보안 차단이다.

- 주소 표시줄이 `http://127.0.0.1:3000`이면 해당 탭을 닫는다.
- 새 탭에서 `http://localhost:8000`을 직접 연다.
- 주소가 `localhost:8000/login`인지 확인한 뒤 다시 로그인한다.
- `127.0.0.1` 화면에서 새로고침만 해서는 주소가 바뀌지 않는다.

현재 로컬 기준선은 `APP_ORIGIN=http://localhost:8000`이다. 로그인과 초안 저장 같은 mutation 요청은 이 origin과 정확히 일치해야 한다.
