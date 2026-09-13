-- 플랫폼 관리자 플래그. 조직(회사) 등록·상태 변경은 이 플래그가 있는 사용자만 할 수 있다.
ALTER TABLE "User" ADD COLUMN "platformAdmin" BOOLEAN NOT NULL DEFAULT false;
