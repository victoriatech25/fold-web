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

async function closeAlert(page: import("@playwright/test").Page, message: string | RegExp) {
  const popup = page.getByRole("alertdialog");
  await expect(popup.getByText(message)).toBeVisible();
  await popup.getByRole("button", { name: "확인" }).click();
}

test("원판 품목을 계산·등록·기본 지정하고 도면 snapshot으로 선택한다", async ({ page }) => {
  await login(page);
  await page.getByRole("link", { name: "재질·두께" }).click();
  await page.getByRole("button", { name: /알루미늄 AL/ }).click();
  await page.getByRole("link", { name: "원판 품목" }).first().click();
  await expect(page.getByRole("heading", { name: "원판 품목" })).toBeVisible();
  await expect(page.getByText("1220 × 2440mm").first()).toBeVisible();

  await page.getByRole("button", { name: "원판 등록" }).click();
  let dialog = page.getByRole("dialog", { name: "원판 품목 등록" });
  await dialog.getByLabel("품목 코드").fill("E2E-SHEET-1000X2000");
  await dialog.getByLabel("품목명").fill("E2E 보조 원판");
  await dialog.getByLabel("폭 (mm)", { exact: true }).fill("1000");
  await dialog.getByLabel("길이 (mm)", { exact: true }).fill("2000");
  await dialog.getByLabel("위 (mm)").fill("10");
  await dialog.getByLabel("아래 (mm)").fill("10");
  await dialog.getByRole("button", { name: "미리 계산" }).click();
  await expect(dialog.getByText("1.98㎡")).toBeVisible();
  await dialog.getByRole("button", { name: "저장" }).click();
  await closeAlert(page, "새 원판 품목을 등록했습니다.");

  let card = page.getByRole("article").filter({ hasText: "E2E 보조 원판" });
  await expect(card).toContainText("1000 × 2000mm");
  await card.getByRole("button", { name: "기본 지정" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "기본 원판 지정" }).click();
  await closeAlert(page, "기본 원판 지정 처리가 완료되었습니다.");
  card = page.getByRole("article").filter({ hasText: "E2E 보조 원판" });
  await expect(card).toContainText("기본");

  await page.getByRole("link", { name: "도면 설계" }).click();
  await page.getByRole("button", { name: "새 초안" }).click();
  dialog = page.getByRole("dialog", { name: "새 절곡 초안" });
  await dialog.getByLabel("새 초안 이름").fill("E2E 원판 snapshot");
  await expect(dialog.getByLabel("새 초안 원판 기준")).toContainText("E2E 보조 원판");
  const sheetValue = await dialog.getByLabel("새 초안 원판 기준").locator("option").filter({ hasText: "E2E 보조 원판" }).getAttribute("value");
  await dialog.getByLabel("새 초안 원판 기준").selectOption(sheetValue!);
  await dialog.getByRole("button", { name: "생성" }).click();
  await expect(page.getByLabel("서버 원판 기준")).toHaveValue(/.+/);
  await expect(page.getByTestId("product-calculation-summary")).toContainText("E2E-SHEET-1000X2000");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(page.url());
  await expect(page.getByLabel("서버 원판 기준")).toBeVisible();
  const viewport = await page.evaluate(() => ({ clientWidth: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth }));
  expect(viewport.scrollWidth).toBe(viewport.clientWidth);
});
