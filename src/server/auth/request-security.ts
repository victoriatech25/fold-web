import "server-only";

import { isIP } from "node:net";

import type { AuthRuntimeConfig } from "@/server/auth/auth-config";

export function hasAllowedMutationOrigin(
  request: Request,
  config: AuthRuntimeConfig,
): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;

  try {
    const expected = new URL(config.appOrigin);
    const forwardedHost = config.trustProxy
      ? request.headers.get("x-forwarded-host")?.split(",", 1)[0]?.trim()
      : null;
    const requestHost =
      forwardedHost ??
      request.headers.get("host")?.trim() ??
      new URL(request.url).host;
    return (
      new URL(origin).origin === config.appOrigin &&
      origin === config.appOrigin &&
      requestHost === expected.host
    );
  } catch {
    return false;
  }
}

export function readTrustedSource(
  request: Request,
  config: AuthRuntimeConfig,
): string | null {
  if (!config.trustProxy) return null;

  const forwarded = request.headers.get("x-forwarded-for");
  const candidate =
    forwarded?.split(",", 1)[0]?.trim() ??
    request.headers.get("x-real-ip")?.trim() ??
    "";

  return isIP(candidate) ? candidate : null;
}
