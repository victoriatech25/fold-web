import "server-only";

import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { notFound } from "next/navigation";

import type { PermissionKey } from "@/domain/permission";
import { readAuthRuntimeConfig, sessionCookieName } from "@/server/auth/auth-config";
import { getAuthenticatedContext } from "@/server/auth/auth-service";
import type { AuthenticatedContext } from "@/server/auth/auth-types";
import { hasPermission } from "@/server/authorization/authorization";
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

export async function requirePermissionPage(
  permission: PermissionKey,
): Promise<AuthenticatedContext> {
  const context = await requireAuthenticatedPage();
  if (!hasPermission(context, permission)) notFound();
  return context;
}
