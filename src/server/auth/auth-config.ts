import "server-only";

export type AuthRuntimeConfig = {
  appOrigin: string;
  rateLimitSecret: string;
  trustProxy: boolean;
  sessionAbsoluteMinutes: number;
  sessionIdleMinutes: number;
  sessionTouchMinutes: number;
  accountFailureLimit: number;
  sourceFailureLimit: number;
  throttleWindowMinutes: number;
  resetTokenMinutes: number;
  defaultOrganizationCode: string;
  production: boolean;
};

export class AuthEnvironmentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthEnvironmentError";
  }
}

type AuthEnvironment = Readonly<Record<string, string | undefined>>;

function readPositiveInteger(
  environment: AuthEnvironment,
  name: string,
  fallback: number,
): number {
  const value = environment[name];
  if (value === undefined || value === "") return fallback;

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new AuthEnvironmentError(`${name} must be a positive integer.`);
  }
  return parsed;
}

function readBoolean(
  environment: AuthEnvironment,
  name: string,
  fallback: boolean,
): boolean {
  const value = environment[name];
  if (value === undefined || value === "") return fallback;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new AuthEnvironmentError(`${name} must be true or false.`);
}

function readOrigin(
  environment: AuthEnvironment,
  production: boolean,
): string {
  const value = environment.APP_ORIGIN ?? "http://localhost:3000";
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new AuthEnvironmentError("APP_ORIGIN must be a valid absolute URL.");
  }

  if (url.origin !== value || url.username || url.password) {
    throw new AuthEnvironmentError(
      "APP_ORIGIN must contain only scheme, host, and optional port.",
    );
  }
  if (production && url.protocol !== "https:") {
    throw new AuthEnvironmentError("APP_ORIGIN must use HTTPS in production.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new AuthEnvironmentError("APP_ORIGIN must use HTTP or HTTPS.");
  }
  return url.origin;
}

export function readAuthRuntimeConfig(
  environment: AuthEnvironment = process.env,
): AuthRuntimeConfig {
  const production = environment.NODE_ENV === "production";
  const rateLimitSecret = environment.AUTH_RATE_LIMIT_SECRET;
  if (!rateLimitSecret || rateLimitSecret.length < 32) {
    throw new AuthEnvironmentError(
      "AUTH_RATE_LIMIT_SECRET must contain at least 32 characters.",
    );
  }

  const defaultOrganizationCode =
    environment.AUTH_DEFAULT_ORGANIZATION_CODE ?? "LOCAL_DEV";
  if (!/^[A-Z0-9_-]{2,50}$/.test(defaultOrganizationCode)) {
    throw new AuthEnvironmentError(
      "AUTH_DEFAULT_ORGANIZATION_CODE has an invalid format.",
    );
  }

  const sessionAbsoluteMinutes = readPositiveInteger(
    environment,
    "AUTH_SESSION_ABSOLUTE_MINUTES",
    480,
  );
  const sessionIdleMinutes = readPositiveInteger(
    environment,
    "AUTH_SESSION_IDLE_MINUTES",
    120,
  );
  const sessionTouchMinutes = readPositiveInteger(
    environment,
    "AUTH_SESSION_TOUCH_MINUTES",
    5,
  );

  if (sessionIdleMinutes > sessionAbsoluteMinutes) {
    throw new AuthEnvironmentError(
      "AUTH_SESSION_IDLE_MINUTES cannot exceed the absolute session lifetime.",
    );
  }
  if (sessionTouchMinutes >= sessionIdleMinutes) {
    throw new AuthEnvironmentError(
      "AUTH_SESSION_TOUCH_MINUTES must be shorter than the idle session lifetime.",
    );
  }

  return {
    appOrigin: readOrigin(environment, production),
    rateLimitSecret,
    trustProxy: readBoolean(environment, "AUTH_TRUST_PROXY", false),
    sessionAbsoluteMinutes,
    sessionIdleMinutes,
    sessionTouchMinutes,
    accountFailureLimit: readPositiveInteger(
      environment,
      "AUTH_ACCOUNT_FAILURE_LIMIT",
      5,
    ),
    sourceFailureLimit: readPositiveInteger(
      environment,
      "AUTH_SOURCE_FAILURE_LIMIT",
      20,
    ),
    throttleWindowMinutes: readPositiveInteger(
      environment,
      "AUTH_THROTTLE_WINDOW_MINUTES",
      15,
    ),
    resetTokenMinutes: readPositiveInteger(
      environment,
      "AUTH_RESET_TOKEN_MINUTES",
      30,
    ),
    defaultOrganizationCode,
    production,
  };
}

export function sessionCookieName(config: AuthRuntimeConfig): string {
  return config.production ? "__Host-fw.sid" : "fw.sid";
}
