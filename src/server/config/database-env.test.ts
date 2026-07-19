import { describe, expect, it } from "vitest";

import {
  DatabaseEnvironmentError,
  readDatabaseRuntimeConfig,
} from "./database-env";

const validEnvironment = {
  DATABASE_URL: "postgresql://app@127.0.0.1:5432/fold_web_test",
};

describe("database runtime environment", () => {
  it("uses the approved pool and timeout defaults", () => {
    expect(readDatabaseRuntimeConfig(validEnvironment)).toEqual({
      connectionString: validEnvironment.DATABASE_URL,
      connectionLimit: 10,
      connectionTimeoutMs: 5_000,
      idleTimeoutMs: 10_000,
      statementTimeoutMs: 5_000,
    });
  });

  it("accepts explicit positive integer limits", () => {
    expect(
      readDatabaseRuntimeConfig({
        ...validEnvironment,
        DATABASE_CONNECTION_LIMIT: "4",
        DATABASE_STATEMENT_TIMEOUT_MS: "2500",
      }),
    ).toMatchObject({
      connectionLimit: 4,
      statementTimeoutMs: 2_500,
    });
  });

  it("rejects missing, non-PostgreSQL and invalid limit values", () => {
    expect(() => readDatabaseRuntimeConfig({})).toThrow(DatabaseEnvironmentError);
    expect(() =>
      readDatabaseRuntimeConfig({ DATABASE_URL: "file:./local.db" }),
    ).toThrow("DATABASE_URL must use PostgreSQL.");
    expect(() =>
      readDatabaseRuntimeConfig({
        ...validEnvironment,
        DATABASE_CONNECTION_LIMIT: "0",
      }),
    ).toThrow("DATABASE_CONNECTION_LIMIT must be a positive integer.");
  });
});
