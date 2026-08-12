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

test("회사정보와 복수 사업장의 기본·비활성 수명주기를 관리한다", async ({ page }) => {
  await login(page);
  await page.goto("/admin/company");
  await expect(page.getByRole("heading", { name: "회사·사업장" })).toBeVisible();

  await page.getByLabel("전화번호").fill("02-2026-0726");
  await page.getByLabel("기본 주소").fill("서울특별시 웹구");
  await page.getByRole("button", { name: "회사정보 저장" }).click();
  await expect(page.getByRole("alertdialog").getByText("회사 정보를 저장했습니다.")).toBeVisible();
  await page.getByRole("alertdialog").getByRole("button", { name: "확인" }).click();

  await page.getByRole("button", { name: "사업장 추가" }).click();
  const createDialog = page.getByRole("dialog", { name: "사업장 추가" });
  await createDialog.getByLabel("사업장 코드").fill("E2E-FACTORY");
  await createDialog.getByLabel("사업장명").fill("E2E 제1공장");
  await createDialog.getByLabel("유형").selectOption("FACTORY");
  await createDialog.getByLabel("전화번호").fill("031-2026-0726");
  await createDialog.getByRole("button", { name: "저장" }).click();
  await expect(page.getByRole("alertdialog").getByText("사업장 정보를 저장했습니다.")).toBeVisible();
  await page.getByRole("alertdialog").getByRole("button", { name: "확인" }).click();

  const factory = page.getByRole("article").filter({ hasText: "E2E-FACTORY" });
  await expect(factory).toContainText("E2E 제1공장");
  await factory.getByRole("button", { name: "기본 지정" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "기본으로 지정" }).click();
  await expect(page.getByRole("alertdialog").getByText("기본 사업장을 변경했습니다.")).toBeVisible();
  await page.getByRole("alertdialog").getByRole("button", { name: "확인" }).click();
  await expect(factory).toContainText("기본 사업장");

  const oldMain = page.getByRole("article").filter({ hasText: "MAIN" });
  await oldMain.getByRole("button", { name: "수정" }).click();
  const editDialog = page.getByRole("dialog", { name: "사업장 수정" });
  await editDialog.getByLabel("사용 중").uncheck();
  await editDialog.getByRole("button", { name: "저장" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "비활성화" }).click();
  await expect(page.getByRole("alertdialog").getByText("사업장 정보를 저장했습니다.")).toBeVisible();
  await page.getByRole("alertdialog").getByRole("button", { name: "확인" }).click();

  await page.getByLabel("비활성 포함").check();
  await expect(oldMain).toContainText("비활성");

  const viewport = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(viewport.scrollWidth).toBe(viewport.clientWidth);
});
