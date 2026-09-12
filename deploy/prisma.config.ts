// 운영 이미지 안에서 `prisma migrate deploy` 만 돌릴 때 쓰는 설정이다.
// 루트의 prisma.config.ts 는 dotenv 와 로컬 기본값에 기대므로 이미지에 그대로
// 넣지 않는다. 마이그레이션은 DDL 권한이 있는 MIGRATION_DATABASE_URL 을 우선 쓰고,
// 없으면 DATABASE_URL 을 쓴다.

import { defineConfig } from "prisma/config";

const url = process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL;
if (!url) {
  throw new Error("MIGRATION_DATABASE_URL 또는 DATABASE_URL 이 필요하다.");
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: { url },
});
