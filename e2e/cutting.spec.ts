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
