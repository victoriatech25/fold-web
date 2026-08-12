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

test("서버 발행 계산 기준을 읽기 전용으로 적용하고 절곡 형상을 계산한다", async ({ page }) => {
  await login(page);

  await page.getByRole("button", { name: "연신율 설정" }).click();
  await expect(page.getByText("서버에 발행된 재질 계산 기준입니다.", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "FIX 고정값" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "RATIO 비율" })).toBeDisabled();
  await expect(page.getByLabel("연신 적용 옵션")).toBeDisabled();
  const initialWidth = await resultValue(page, "최종 전개 폭").textContent();

  await page.getByRole("button", { name: "선 속성" }).click();
  await page.getByLabel("절곡 형태").selectOption("u");
  await page.getByLabel("절곡 구성").selectOption("front-back");
  await expect(resultValue(page, "최종 전개 폭")).not.toHaveText(initialWidth ?? "");

  await page.getByLabel("이 절곡의 연신 계산 적용").uncheck();
  await expect(page.getByLabel("이 절곡의 연신 계산 적용")).not.toBeChecked();
  await expect(resultValue(page, "최종 전개 폭")).toBeVisible();

  await page.getByLabel("이 절곡의 연신 계산 적용").check();
  await page.getByRole("button", { name: "연신율 설정" }).click();
  await expect(page.getByLabel("V-CUT 사용")).toBeDisabled();
});
