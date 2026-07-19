import { expect, test } from "@playwright/test";

const email = "e2e-admin@example.test";
const password = "Browser verification phrase 2026!";

test("미인증 사용자를 로그인 화면으로 보낸다", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);
  await expect(
    page.getByRole("heading", { name: "절곡 웹서비스" }),
  ).toBeVisible();
});

test("동일한 로그인 오류를 표시한다", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("이메일").fill("missing@example.test");
  await page.getByLabel("비밀번호").fill("incorrect password");
  await page.getByRole("button", { name: "로그인" }).click();
  await expect(page.getByText("이메일 또는 비밀번호를 확인해 주세요.")).toBeVisible();
  await expect(page).toHaveURL(/\/login$/);
});

test("로그인, 새로고침 유지, 로그아웃 수명주기를 완료한다", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("이메일").fill(email);
  await page.getByLabel("비밀번호").fill(password);
  await page.getByRole("button", { name: "로그인" }).click();

  await expect(page).toHaveURL("/");
  await expect(
    page.getByRole("heading", { name: "절곡 단면 편집기" }),
  ).toBeVisible();
  await expect(page.getByText("브라우저 검증 관리자")).toBeVisible();

  await page.reload();
  await expect(
    page.getByRole("heading", { name: "절곡 단면 편집기" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "로그아웃" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);
});
