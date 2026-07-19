import "server-only";

export type DatabaseRuntimeConfig = {
  connectionString: string;
  connectionLimit: number;
  connectionTimeoutMs: number;
  idleTimeoutMs: number;
  statementTimeoutMs: number;
};

type DatabaseEnvironment = Readonly<Record<string, string | undefined>>;

export class DatabaseEnvironmentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DatabaseEnvironmentError";
  }
}

function readPositiveInteger(
  value: string | undefined,
  fallback: number,
  name: string,
): number {
  if (value === undefined || value === "") return fallback;

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new DatabaseEnvironmentError(`${name} must be a positive integer.`);
  }
  return parsed;
}

export function readDatabaseRuntimeConfig(
  environment: DatabaseEnvironment = process.env,
): DatabaseRuntimeConfig {
  const connectionString = environment.DATABASE_URL;
  if (!connectionString) {
    throw new DatabaseEnvironmentError("DATABASE_URL is required at runtime.");
  }

  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    throw new DatabaseEnvironmentError("DATABASE_URL must be a valid PostgreSQL URL.");
  }

  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new DatabaseEnvironmentError("DATABASE_URL must use PostgreSQL.");
  }
  if (!url.hostname || url.pathname.length <= 1) {
    throw new DatabaseEnvironmentError("DATABASE_URL must include a host and database name.");
  }

  return {
    connectionString,
    connectionLimit: readPositiveInteger(
      environment.DATABASE_CONNECTION_LIMIT,
      10,
      "DATABASE_CONNECTION_LIMIT",
    ),
    connectionTimeoutMs: readPositiveInteger(
      environment.DATABASE_CONNECTION_TIMEOUT_MS,
      5_000,
      "DATABASE_CONNECTION_TIMEOUT_MS",
    ),
    idleTimeoutMs: readPositiveInteger(
      environment.DATABASE_IDLE_TIMEOUT_MS,
      10_000,
      "DATABASE_IDLE_TIMEOUT_MS",
    ),
    statementTimeoutMs: readPositiveInteger(
      environment.DATABASE_STATEMENT_TIMEOUT_MS,
      5_000,
      "DATABASE_STATEMENT_TIMEOUT_MS",
    ),
  };
}
