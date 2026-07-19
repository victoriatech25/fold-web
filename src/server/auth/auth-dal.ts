import "server-only";

import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { readAuthRuntimeConfig, sessionCookieName } from "@/server/auth/auth-config";
import { getAuthenticatedContext } from "@/server/auth/auth-service";
import type { AuthenticatedContext } from "@/server/auth/auth-types";
import { getPrisma } from "@/server/db/prisma";

export const getCurrentAuthContext = cache(
  async (): Promise<AuthenticatedContext | null> => {
    const config = readAuthRuntimeConfig();
    const token = (await cookies()).get(sessionCookieName(config))?.value ?? null;
    return getAuthenticatedContext(getPrisma(), {
      token,
      config,
    });
  },
);

export async function requireAuthenticatedPage(): Promise<AuthenticatedContext> {
  const context = await getCurrentAuthContext();
  if (!context) redirect("/login");
  return context;
}
