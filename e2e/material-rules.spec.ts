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

test("계산 규칙을 복사·검토·게시하고 계산 영향을 비교한다", async ({ page }) => {
  await login(page);
  await page.getByRole("link", { name: "재질·두께" }).click();
  await page.getByRole("link", { name: "알루미늄", exact: true }).click();
  await page.getByRole("tab", { name: /두께 항목/ }).click();
  await page.getByRole("link", { name: "계산 기준" }).first().click();
  await expect(page.getByRole("heading", { name: /계산 기준/ })).toBeVisible();
  await expect(page.getByText("r1").first()).toBeVisible();

  await page.getByRole("button", { name: "새 개정 만들기" }).click();
  let dialog = page.getByRole("dialog", { name: "게시본에서 새 개정 만들기" });
  await expect(dialog.locator('[name="cutAngleDeg"]')).toHaveValue("135");
  await dialog.locator('[name="elongationOption"]').selectOption("TWO_LINE");
  await dialog.locator('[name="elongationVCutMm"]').fill("0.75");
  await dialog.locator('[name="changeSummary"]').fill("E2E 제한각 및 FIX 값 변경");
  await dialog.getByRole("button", { name: "초안 저장" }).click();
  await closeAlert(page, "새 계산 규칙 초안을 만들었습니다.");

  let revision = page.getByRole("article").filter({ hasText: "r2" });
  await expect(revision).toContainText("초안");
  await revision.getByRole("button", { name: "미리보기" }).click();
  dialog = page.getByRole("dialog", { name: "계산 영향 미리보기" });
  await expect(dialog.getByText("134° 제한각 미만")).toBeVisible();
  await expect(dialog.getByText("135° 제한각 동일")).toBeVisible();
  await dialog.getByRole("button", { name: "확인" }).click();

  await revision.getByRole("button", { name: "검토 요청" }).click();
  dialog = page.getByRole("dialog", { name: "검토 요청" });
  await dialog.getByRole("button", { name: "검토 요청" }).click();
  await closeAlert(page, "검토를 요청했습니다.");
  revision = page.getByRole("article").filter({ hasText: "r2" });
  await expect(revision).toContainText("검토 중");

  await revision.getByRole("button", { name: "게시" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "게시" }).click();
  await closeAlert(page, "계산 규칙을 게시했습니다.");
  await expect(page.getByText("현재 적용").locator("..")).toContainText("r2");
  await expect(revision).toContainText("사용 중");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(page.getByRole("heading", { name: /계산 기준/ })).toBeVisible();
  const viewport = await page.evaluate(() => ({ clientWidth: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth }));
  expect(viewport.scrollWidth).toBe(viewport.clientWidth);
});
