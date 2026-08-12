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

test("서버 Decimal 계산 정책과 발행 값을 읽기 전용으로 표시한다", async ({ page }) => {
  await login(page);

  await page.getByRole("button", { name: "연신율 설정" }).click();
  await expect(page.getByRole("note", { name: "Decimal 계산 정책" })).toContainText(
    "decimal-v1",
  );
  await expect(page.getByRole("note", { name: "Decimal 계산 정책" })).toContainText(
    "각 구간의 최종 길이에만 적용",
  );

  await expect(page.getByText("연신율 V/A/N").locator("..")).toContainText("1.2 / 0.8 / 2");
  await expect(page.getByLabel("계산 소수점")).toBeDisabled();
  await expect(page.getByLabel("처리 방식")).toBeDisabled();
});
