import { expect, test, type Page } from "@playwright/test";

const email = "e2e-admin@example.test";
const password = "Browser verification phrase 2026!";

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("이메일").fill(email);
  await page.getByLabel("비밀번호").fill(password);
  await page.getByRole("button", { name: "로그인" }).click();
  await expect(page).toHaveURL("/");
  await page.goto("/fold-editor");
}

test("원호 계산과 패널 연결을 편집하고 공통 팝업으로 직선 전환한다", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page);

  await page.getByRole("button", { name: "원호", exact: true }).click();
  await page.getByLabel("곡 깊이 (mm)").fill("50");
  await expect(page.getByText("호 길이").locator("strong")).toHaveText("157.079633 mm");
  await page.getByRole("button", { name: "진행 방향 오른쪽" }).click();
  await expect(page.getByRole("button", { name: "진행 방향 오른쪽" })).toHaveClass(/bg-slate-900/);

  await page.getByRole("button", { name: "패널 연결" }).click();
  await page.getByLabel("패널 최대 현 길이 (mm)").fill("320");
  await page.getByLabel("계산 역할").selectOption("secondary-product-dimension");
  await expect(page.getByText("패널 두 번째 치수", { exact: true }).locator("..").locator("p").nth(1)).toHaveText("320 mm");

  await page.getByRole("button", { name: "직선", exact: true }).click();
  await expect(page.getByText("원호를 직선으로 전환", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "직선으로 전환" }).click();
  await expect(page.getByLabel("곡 깊이 (mm)")).toHaveCount(0);
});

test("박스는 수동 기준선 없이 교차 직선 자동 판정을 안내한다", async ({ page }) => {
  await login(page);
  await page.getByRole("button", { name: "박스", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "서로 교차하는 바닥 직선" })).toBeVisible();
  await expect(page.getByRole("button", { name: "기준선 지정" })).toHaveCount(0);
});

test("제품 길이가 0인 박스도 교차 직선만으로 3D를 만든다", async ({ page }) => {
  test.setTimeout(60_000);
  await login(page);
  await page.getByRole("button", { name: "새 초안" }).click();
  await page.getByLabel("새 초안 이름").fill("E2E 자동 박스 3D");
  await page.getByLabel("새 초안 도면 타입").selectOption("box");
  await page.getByRole("button", { name: "생성", exact: true }).click();
  await page.getByLabel("길이 (mm)", { exact: true }).fill("0");
  await expect(page.getByLabel("길이 (mm)", { exact: true })).toHaveValue("0");

  await page.getByRole("button", { name: "연속 선 그리기" }).click();
  const canvas = page.getByTestId("fold-canvas");
  await canvas.click({ position: { x: 180, y: 130 } });
  await canvas.click({ position: { x: 400, y: 130 } });
  await page.getByRole("button", { name: "두 번째 시작점" }).click();
  await canvas.click({ position: { x: 290, y: 40 } });
  await canvas.click({ position: { x: 290, y: 220 } });

  await expect(page.getByRole("alert").filter({ hasText: "서로 교차하는 바닥 직선" })).toHaveCount(0);
  await page.getByRole("button", { name: "3D", exact: true }).click();
  await expect(page.getByLabel("3D 미리보기").locator("canvas")).toBeVisible();
  await expect(page.getByText("3D 모델에는 0보다 큰 제품 길이가 필요합니다.")).toHaveCount(0);
});
