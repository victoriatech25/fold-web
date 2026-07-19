import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { disconnectPrisma } from "@/server/db/prisma";

const runIntegration = process.env.RUN_DB_INTEGRATION === "1";
const integration = runIntegration ? describe : describe.skip;
const token = "integration-smoke-token-000000000000";

integration("database smoke Route Handler", () => {
  beforeAll(() => {
    process.env.INTERNAL_SMOKE_TOKEN = token;
  });

  afterAll(async () => {
    delete process.env.INTERNAL_SMOKE_TOKEN;
    await disconnectPrisma();
  });

  it("commits a write and returns only the smoke DTO", async () => {
    const { POST } = await import("@/app/api/internal/database-smoke/route");
    const response = await POST(
      new Request("http://localhost/api/internal/database-smoke", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-internal-smoke-token": token,
          "x-request-id": "integration-commit",
        },
        body: JSON.stringify({ mode: "commit" }),
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("x-request-id")).toBe("integration-commit");
    await expect(response.json()).resolves.toEqual({
      data: {
        mode: "commit",
        transaction: "committed",
        persistedAuditEvents: 1,
      },
    });
  });

  it("rolls a transaction back without persisting the audit event", async () => {
    const { POST } = await import("@/app/api/internal/database-smoke/route");
    const response = await POST(
      new Request("http://localhost/api/internal/database-smoke", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-internal-smoke-token": token,
          "x-request-id": "integration-rollback",
        },
        body: JSON.stringify({ mode: "rollback" }),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: {
        mode: "rollback",
        transaction: "rolled-back",
        persistedAuditEvents: 0,
      },
    });
  });

  it("does not reveal whether the disabled internal endpoint exists", async () => {
    const { POST } = await import("@/app/api/internal/database-smoke/route");
    const response = await POST(
      new Request("http://localhost/api/internal/database-smoke", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-internal-smoke-token": "wrong-token",
        },
        body: JSON.stringify({ mode: "commit" }),
      }),
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "NOT_FOUND",
      },
    });
  });

  it("rejects malformed JSON before accessing the database", async () => {
    const { POST } = await import("@/app/api/internal/database-smoke/route");
    const response = await POST(
      new Request("http://localhost/api/internal/database-smoke", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-internal-smoke-token": token,
        },
        body: "{",
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "INVALID_REQUEST",
      },
    });
  });

  it("rejects a payload larger than the internal endpoint limit", async () => {
    const { POST } = await import("@/app/api/internal/database-smoke/route");
    const response = await POST(
      new Request("http://localhost/api/internal/database-smoke", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-internal-smoke-token": token,
        },
        body: JSON.stringify({ mode: "commit", padding: "가".repeat(400) }),
      }),
    );

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "PAYLOAD_TOO_LARGE",
      },
    });
  });
});
