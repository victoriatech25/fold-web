import {
  createHash,
  createHmac,
  randomBytes,
} from "node:crypto";

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function createOpaqueToken(): string {
  return randomBytes(32).toString("base64url");
}

export function isOpaqueToken(value: string): boolean {
  return TOKEN_PATTERN.test(value);
}

export function hashOpaqueToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function createThrottleKey(
  secret: string,
  scope: "ACCOUNT" | "SOURCE",
  value: string,
): string {
  return createHmac("sha256", secret)
    .update(`${scope}\0${value}`, "utf8")
    .digest("hex");
}
