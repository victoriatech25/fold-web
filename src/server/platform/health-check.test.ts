import { describe, expect, it } from "vitest";

import { compareMigrations } from "@/server/platform/health-check";

const at = new Date("2026-09-01T00:00:00Z");

describe("compareMigrations", () => {
  it("is ok when every local migration is applied", () => {
    const result = compareMigrations(
      ["20260801000000_a", "20260802000000_b"],
      [
        { migration_name: "20260801000000_a", finished_at: at, rolled_back_at: null },
        { migration_name: "20260802000000_b", finished_at: at, rolled_back_at: null },
      ],
    );

    expect(result).toMatchObject({
      status: "ok",
      expected: 2,
      applied: 2,
      pending: 0,
      failed: 0,
      pendingNames: [],
      failedNames: [],
    });
    expect(result.message).toBeUndefined();
  });

  it("reports local migrations the database has not applied", () => {
    const result = compareMigrations(
      ["20260801000000_a", "20260802000000_b"],
      [{ migration_name: "20260801000000_a", finished_at: at, rolled_back_at: null }],
    );

    expect(result).toMatchObject({
      status: "error",
      expected: 2,
      applied: 1,
      pending: 1,
      pendingNames: ["20260802000000_b"],
    });
    expect(result.message).toContain("prisma migrate deploy");
  });

  it("treats an unfinished migration as failed and a rolled-back one as pending", () => {
    const result = compareMigrations(
      ["20260801000000_a", "20260802000000_b"],
      [
        { migration_name: "20260801000000_a", finished_at: null, rolled_back_at: null },
        { migration_name: "20260802000000_b", finished_at: at, rolled_back_at: at },
      ],
    );

    expect(result).toMatchObject({
      status: "error",
      applied: 0,
      pending: 2,
      failed: 1,
      failedNames: ["20260801000000_a"],
      pendingNames: ["20260801000000_a", "20260802000000_b"],
    });
  });

  it("ignores database rows the image does not know about", () => {
    const result = compareMigrations(
      ["20260801000000_a"],
      [
        { migration_name: "20260801000000_a", finished_at: at, rolled_back_at: null },
        { migration_name: "20260901000000_newer", finished_at: at, rolled_back_at: null },
      ],
    );

    expect(result.status).toBe("ok");
    expect(result.applied).toBe(1);
  });
});
