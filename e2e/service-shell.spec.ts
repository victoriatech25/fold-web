import { expect, test, type Page } from "@playwright/test";

const email = "e2e-admin@example.test";
const password = "Browser verification phrase 2026!";

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("이메일").fill(email);
  await page.getByLabel("비밀번호").fill(password);
  await page.getByRole("button", { name: "로그인" }).click();
  await expect(page).toHaveURL("/");
}

test("업무 홈에서 실제 기능과 준비 중 기능을 구분하고 설계로 이동한다", async ({
  page,
}) => {
  await login(page);

  await expect(page.getByRole("heading", { name: "업무 홈" })).toBeVisible();
  await expect(page.getByRole("link", { name: /새 도면 설계/ })).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "주요 메뉴" }).getByRole("link", { name: "수주 등록/조회" }),
  ).toBeVisible();
  await expect(page.getByText("진행 중 수주").first()).toBeVisible();
  await expect(page.getByText("실제 서버 데이터만 집계합니다.")).toBeVisible();

  await page.getByRole("link", { name: /새 도면 설계/ }).click();
  await expect(page).toHaveURL("/fold-editor");
  await expect(page.getByRole("heading", { name: "절곡 단면 편집기" })).toBeVisible();

  await page.getByRole("link", { name: "업무 홈으로 이동" }).click();
  await expect(page).toHaveURL("/");
});

test("모바일 메뉴에서 현재 업무와 관리 화면을 탐색한다", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);

  await page.getByRole("button", { name: "메뉴 열기" }).click();
  const navigation = page.getByRole("navigation", { name: "주요 메뉴" });
  await expect(navigation.getByRole("link", { name: "홈" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(navigation.getByText("생산·절단")).toBeVisible();
  await navigation.getByRole("link", { name: "회사·사업장" }).click();
  await expect(page).toHaveURL("/admin/company");
  await expect(page.getByRole("heading", { name: "회사·사업장" })).toBeVisible();

  const documentWidth = await page.evaluate(
    () => document.documentElement.scrollWidth,
  );
  expect(documentWidth).toBeLessThanOrEqual(390);
});
