import "dotenv/config";

import { z } from "zod";

import {
  createCliPrisma,
  readNamedArguments,
  requireArgument,
} from "./auth-cli-support";
import { normalizeEmail } from "../src/server/auth/email-core";

/**
 * 기존 사용자에게 플랫폼 관리자 플래그를 주거나 거둔다.
 * 회사(조직) 등록·정지는 조직 권한이 아니라 이 플래그로만 열리므로 화면에서는 부여할 수 없고
 * 서버 운영자가 CLI 로만 바꾼다.
 *
 *   npm run auth:set-platform-admin -- --email admin@example.com --platform-admin true
 */
const argumentsSchema = z.object({
  email: z.email().max(320),
  platformAdmin: z.enum(["true", "false"]),
});

async function main(): Promise<void> {
  const values = readNamedArguments(process.argv.slice(2), [
    "email",
    "platform-admin",
  ]);
  const input = argumentsSchema.parse({
    email: requireArgument(values, "email"),
    platformAdmin: requireArgument(values, "platform-admin"),
  });
  const prisma = createCliPrisma();
  try {
    const user = await prisma.user.findUnique({
      where: { normalizedEmail: normalizeEmail(input.email) },
      select: { id: true, platformAdmin: true },
    });
    if (!user) throw new Error("A user with this email does not exist.");
    const platformAdmin = input.platformAdmin === "true";
    await prisma.user.update({
      where: { id: user.id },
      data: { platformAdmin },
    });
    process.stdout.write(
      `플랫폼 관리자 플래그를 변경했습니다. userId=${user.id} ${user.platformAdmin} -> ${platformAdmin}\n`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown error";
  process.stderr.write(`플랫폼 관리자 변경 실패: ${message}\n`);
  process.exitCode = 1;
});
