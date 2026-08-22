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

test("작업을 등록하고 목록에서 확인·취소한다", async ({ page }) => {
  await login(page);

  // 서버가 요청 출처를 검사하므로 브라우저 안에서 fetch로 등록한다.
  const enqueue = (idempotencyKey: string) =>
    page.evaluate(async (key) => {
      const response = await fetch("/api/v1/jobs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "dxf.export",
          payload: { revisionId: crypto.randomUUID() },
          idempotencyKey: key,
        }),
      });
      return { status: response.status, body: await response.json() };
    }, idempotencyKey);

  const idempotencyKey = `e2e-${Date.now()}`;
  const enqueued = await enqueue(idempotencyKey);
  expect(enqueued.status).toBe(201);
  const created = enqueued.body.data;
  expect(created.status).toBe("QUEUED");
  // payload 원문은 응답에 담기지 않는다.
  expect(created).not.toHaveProperty("payload");

  // 같은 멱등키로 다시 등록해도 새 작업이 생기지 않는다.
  const repeated = await enqueue(idempotencyKey);
  expect(repeated.status).toBe(200);
  expect(repeated.body.data.id).toBe(created.id);

  await page.getByRole("link", { name: "작업 큐" }).click();
  await expect(page).toHaveURL("/jobs");
  await expect(page.getByRole("heading", { name: "작업 큐" })).toBeVisible();

  const card = page.locator("article").filter({ hasText: "제작 DXF 생성" }).first();
  await expect(card).toBeVisible();
  await expect(card.getByText("대기 중", { exact: true })).toBeVisible();

  await card.getByRole("button", { name: "취소" }).click();
  const confirm = page.getByRole("alertdialog", { name: "작업 취소" });
  await confirm.getByRole("button", { name: "작업 취소" }).click();
  await page.getByRole("alertdialog", { name: "작업 취소 완료" }).getByRole("button", { name: "확인" }).click();
  await expect(card.getByText("취소", { exact: true })).toBeVisible();

  // 상태 필터가 동작한다.
  await page.getByRole("group", { name: "작업 상태" }).getByRole("button", { name: "취소", exact: true }).click();
  await page.getByRole("button", { name: "조회" }).click();
  await expect(page.locator("article").filter({ hasText: "제작 DXF 생성" }).first()).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(page.getByRole("heading", { name: "작업 큐" })).toBeVisible();
  const body = await page.evaluate(() => ({ scroll: document.body.scrollWidth, client: document.body.clientWidth }));
  expect(body.scroll).toBeLessThanOrEqual(body.client + 1);
});
