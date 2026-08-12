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

async function closeAlert(page: import("@playwright/test").Page, message: string) {
  const popup = page.getByRole("alertdialog");
  await expect(popup.getByText(message)).toBeVisible();
  await popup.getByRole("button", { name: "확인" }).click();
}

test("가격 적용 순서를 계산하고 가격표 초안 수명주기를 공통 팝업으로 처리한다", async ({ page }) => {
  await login(page);
  await page.getByRole("link", { name: "가격 관리" }).click();
  await expect(page).toHaveURL(/\/pricing$/);
  await expect(page.getByRole("heading", { name: "가격 관리", level: 1 })).toBeVisible();
  await expect(page.getByText("활성 가격등급").locator("..")).toContainText("2개");
  await expect(page.getByText("사용 중 가격표").locator("..")).toContainText("3개");

  await page.locator('select[name="customerId"]').selectOption({ label: "SCREEN-PRICE · 화면검수 가격 거래처" });
  await page.locator('select[name="materialVariantId"]').selectOption({ label: "알루미늄 · 알루미늄 1T" });
  await page.getByRole("button", { name: "가격 계산" }).click();
  await expect(page.getByText("22,230원", { exact: true })).toBeVisible();
  await expect(page.getByText(/적용 출처: 거래처 전용/)).toBeVisible();
  await expect(page.getByText(/최소 절곡 할증 적용/)).toBeVisible();

  await page.getByRole("link", { name: /화면검수 거래처 전용 가격표/ }).click();
  await expect(page.getByRole("heading", { name: "화면검수 거래처 전용 가격표" })).toBeVisible();
  await expect(page.getByText("17000", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "새 개정 만들기" }).click();
  await closeAlert(page, "현재 게시본을 복사해 새 초안을 만들었습니다.");
  await expect(page.getByRole("heading", { name: "가격표 r2" })).toBeVisible();
  await page.getByRole("button", { name: "폐기" }).click();
  const confirm = page.getByRole("alertdialog", { name: "가격표 초안 폐기" });
  await expect(confirm.getByText("초안을 폐기하시겠습니까?")).toBeVisible();
  await confirm.getByRole("button", { name: "확인" }).click();
  await closeAlert(page, "가격표 개정 상태를 변경했습니다.");
  await expect(page.getByRole("heading", { name: "가격표 r2" })).toHaveCount(0);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(page.getByRole("heading", { name: "화면검수 거래처 전용 가격표" })).toBeVisible();
  const viewport = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(viewport.scrollWidth).toBe(viewport.clientWidth);
});
