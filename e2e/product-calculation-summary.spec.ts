import { expect, test } from "@playwright/test";

const email = "e2e-admin@example.test";
const password = "Browser verification phrase 2026!";

async function login(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.getByLabel("이메일").fill(email);
  await page.getByLabel("비밀번호").fill(password);
  await page.getByRole("button", { name: "로그인" }).click();
  await expect(page).toHaveURL("/");
  await page.goto("/fold-editor");
}

function resultValue(page: import("@playwright/test").Page, label: string) {
  return page.getByText(label, { exact: true }).locator("..").locator("p").nth(1);
}

test("제품 계산 요약을 스크롤 없이 보여주고 입력 변경을 즉시 반영한다", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await login(page);

  const summary = page.getByTestId("product-calculation-summary");
  await expect(summary).toBeVisible();
  await expect(summary).toHaveAttribute("aria-label", "제품 크기 계산 요약");

  const summaryBox = await summary.boundingBox();
  const viewport = page.viewportSize();
  expect(summaryBox).not.toBeNull();
  expect(viewport).not.toBeNull();
  expect(summaryBox!.y).toBeGreaterThanOrEqual(0);
  expect(summaryBox!.y + summaryBox!.height).toBeLessThanOrEqual(viewport!.height);

  await expect(resultValue(page, "최종 전개 폭")).toHaveText("230 mm");
  await expect(resultValue(page, "제품 길이")).toHaveText("2400 mm");
  await expect(resultValue(page, "수량")).toHaveText("10 개");
  await expect(resultValue(page, "제품 1개 면적")).toHaveText("0.5520 m²");
  await expect(resultValue(page, "총면적")).toHaveText("5.5200 m²");

  await page.getByLabel("길이 (mm)", { exact: true }).fill("1200");
  await page.getByLabel("수량", { exact: true }).fill("5");
  await expect(resultValue(page, "제품 1개 면적")).toHaveText("0.2760 m²");
  await expect(resultValue(page, "총면적")).toHaveText("1.3800 m²");

  await page.getByRole("button", { name: "박스", exact: true }).click();
  await expect(summary).toHaveAttribute("aria-label", "박스 크기 계산 요약");
  await expect(summary.getByText("바닥 크기", { exact: true })).toBeVisible();
  await expect(summary.getByText("가로 단면 전개 폭", { exact: true })).toBeVisible();
  await expect(summary.getByText("세로 단면 전개 폭", { exact: true })).toBeVisible();
});
