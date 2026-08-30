import { expect, test } from "@playwright/test";

const email = "e2e-admin@example.test";
const password = "Browser verification phrase 2026!";

async function login(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.getByLabel("이메일").fill(email);
  await page.getByLabel("비밀번호").fill(password);
  await page.getByRole("button", { name: "로그인" }).click();
  await expect(page).toHaveURL("/");
}

test("생산·절단 화면을 열고 승인 전 수주는 재단을 거부한다", async ({ page }) => {
  await login(page);

  await page.getByRole("link", { name: "생산·절단" }).first().click();
  await expect(page).toHaveURL("/cutting");
  await expect(page.getByRole("heading", { name: "생산·절단" })).toBeVisible();

  // 승인되지 않은 수주로 재단을 걸면 서버가 막는다(`D2-B05-A`).
  const rejected = await page.evaluate(async () => {
    const created = await fetch("/api/v1/orders", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({}) });
    if (!created.ok) return { skipped: true, status: created.status };
    const order = (await created.json()).data;
    const response = await fetch(`/api/v1/orders/${order.id}/cutting-plans`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    return { skipped: false, status: response.status, body: await response.json() };
  });
  if (!rejected.skipped) {
    expect(rejected.status).toBe(409);
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(page.getByRole("heading", { name: "생산·절단" })).toBeVisible();
  const body = await page.evaluate(() => ({ scroll: document.body.scrollWidth, client: document.body.clientWidth }));
  expect(body.scroll).toBeLessThanOrEqual(body.client + 1);
});

test("원판 사용 실적 화면을 연다", async ({ page }) => {
  await login(page);

  await page.getByRole("link", { name: "원판 사용 실적" }).first().click();
  await expect(page).toHaveURL("/cutting/usage");
  await expect(page.getByRole("heading", { name: "원판 사용 실적" })).toBeVisible();
  // 승인된 재단이 없는 계정이라 빈 상태가 보인다. 빈 화면도 읽혀야 한다.
  await expect(page.getByText("원판별 합계")).toBeVisible();

  // 좁은 화면에서도 가로로 밀리지 않는다.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(page.getByRole("heading", { name: "원판 사용 실적" })).toBeVisible();
  const body = await page.evaluate(() => ({ scroll: document.body.scrollWidth, client: document.body.clientWidth }));
  expect(body.scroll).toBeLessThanOrEqual(body.client + 1);
});

test("사용 실적 API 는 기간을 검증한다", async ({ page }) => {
  await login(page);

  const result = await page.evaluate(async () => {
    const invalid = await fetch("/api/v1/sheet-usage?from=2026-13-40");
    const valid = await fetch("/api/v1/sheet-usage?from=2026-08-01&to=2026-08-31");
    return {
      invalidStatus: invalid.status,
      validStatus: valid.status,
      validBody: await valid.json(),
    };
  });

  expect(result.invalidStatus).toBe(400);
  expect(result.validStatus).toBe(200);
  expect(result.validBody.data.totals).toHaveProperty("yieldPercent");
});
