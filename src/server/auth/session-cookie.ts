import "server-only";

import type { AuthRuntimeConfig } from "@/server/auth/auth-config";
import { sessionCookieName } from "@/server/auth/auth-config";

export function readSessionCookie(
  cookieHeader: string | null,
  config: AuthRuntimeConfig,
): string | null {
  if (!cookieHeader) return null;
  const name = sessionCookieName(config);

  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() !== name) continue;
    return part.slice(separator + 1).trim() || null;
  }
  return null;
}

export function createSessionCookie(
  token: string,
  config: AuthRuntimeConfig,
): string {
  const attributes = [
    `${sessionCookieName(config)}=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${config.sessionAbsoluteMinutes * 60}`,
    "Priority=High",
  ];
  if (config.production) attributes.push("Secure");
  return attributes.join("; ");
}

export function clearSessionCookie(config: AuthRuntimeConfig): string {
  const attributes = [
    `${sessionCookieName(config)}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
    "Expires=Thu, 01 Jan 1970 00:00:00 GMT",
    "Priority=High",
  ];
  if (config.production) attributes.push("Secure");
  return attributes.join("; ");
}
