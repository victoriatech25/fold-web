import { describe, expect, it } from "vitest";

import { currentModule, isCurrentPath, visibleModules } from "./navigation-model";

const allPermissions = [
  "order.read",
  "cutting.optimize",
  "customer.read",
  "material.read",
  "pricing.read",
  "master_data.read",
  "admin.manage",
  "audit.read",
] as const;

describe("isCurrentPath", () => {
  it("목록 화면은 자기 상세 경로에서도 현재다", () => {
    expect(isCurrentPath("/orders/abc", "/orders")).toBe(true);
    expect(isCurrentPath("/cutting/abc", "/cutting")).toBe(true);
  });

  it("형제 화면에 있을 때 상위 경로까지 현재로 켜지 않는다", () => {
    // `/cutting` 과 `/cutting/usage` 는 나란한 화면이다. 둘 다 켜면 지금 어디인지 흐려진다.
    expect(isCurrentPath("/cutting/usage", "/cutting/usage")).toBe(true);
    expect(isCurrentPath("/cutting/usage", "/cutting")).toBe(false);
  });

  it("업무 홈은 정확히 `/` 일 때만 현재다", () => {
    expect(isCurrentPath("/", "/")).toBe(true);
    expect(isCurrentPath("/orders", "/")).toBe(false);
  });
});

describe("currentModule", () => {
  it("형제 화면도 같은 모듈에 남는다", () => {
    const modules = visibleModules([...allPermissions]);
    expect(currentModule("/cutting/usage", modules).id).toBe("production");
    expect(currentModule("/orders/abc", modules).id).toBe("sales");
  });
});

describe("visibleModules", () => {
  it("권한이 없으면 화면과 빈 모듈을 감춘다", () => {
    const modules = visibleModules([]);
    expect(modules.find((module) => module.id === "system")).toBeUndefined();
    expect(modules.find((module) => module.id === "master")).toBeUndefined();
    // 권한이 필요 없는 설계 화면과 업무 홈은 남는다.
    expect(modules.map((module) => module.id)).toContain("design");
    expect(modules.map((module) => module.id)).toContain("home");
  });
});
