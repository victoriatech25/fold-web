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

test("변수와 구간·제품 수식을 계산하고 오류를 직접 표시한다", async ({ page }) => {
  await login(page);

  await page.getByRole("button", { name: "변수·수식" }).click();
  await expect(page.getByText("fold-expression-v1")).toBeVisible();

  await page.getByRole("button", { name: "변수 추가" }).click();
  await page.getByLabel("변수 1 이름").fill("W");
  await page.getByLabel("변수 W 값 (mm)").fill("120");

  await page.getByRole("button", { name: "변수 추가" }).click();
  await page.getByLabel("변수 2 이름").fill("D1");
  await page.getByLabel("변수 D1 값 (mm)").fill("20");

  await page.getByRole("button", { name: "선 속성" }).click();
  await page.getByRole("button", { name: "수식 입력" }).click();
  await page.getByLabel("구간 길이 수식").fill("(W-D1)/2");
  await expect(page.getByText("계산 길이:")).toContainText("50 mm");
  await expect(resultValue(page, "최종 전개 폭")).toHaveText("180 mm");

  await page.getByRole("button", { name: "변수·수식" }).click();
  await page.getByLabel("제품 길이 수식 사용").check();
  await page.getByRole("textbox", { name: "제품 길이 수식", exact: true }).fill("W*10");
  await expect(page.getByText("계산 제품 길이:")).toContainText("1200 mm");
  await expect(resultValue(page, "제품 길이")).toHaveText("1200 mm");
  await expect(resultValue(page, "제품 1개 면적")).toHaveText("0.2160 m²");

  await page.getByRole("button", { name: "선 속성" }).click();
  await page.getByLabel("구간 길이 수식").fill("W/0");
  await expect(page.getByText("0으로 나눌 수 없습니다.", { exact: true })).toBeVisible();
  await expect(resultValue(page, "최종 전개 폭")).toHaveText("230 mm");

  await page.getByLabel("구간 길이 수식").fill("(W-D1)/2");
  await expect(resultValue(page, "최종 전개 폭")).toHaveText("180 mm");
});
