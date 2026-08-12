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

async function closeSuccessPopup(
  page: import("@playwright/test").Page,
  message: string | RegExp,
) {
  const popup = page.getByRole("alertdialog");
  await expect(popup.getByText(message)).toBeVisible();
  await popup.getByRole("button", { name: "확인" }).click();
}

test("거래처와 담당자·고객 현장의 기본 수명주기를 관리한다", async ({ page }) => {
  await login(page);
  await page.getByRole("link", { name: "거래처·현장" }).click();
  await expect(page).toHaveURL(/\/customers$/);
  await expect(page.getByRole("heading", { name: "거래처·고객 현장" })).toBeVisible();

  await page.getByRole("button", { name: "새 거래처" }).click();
  const createCustomer = page.getByRole("dialog", { name: "새 거래처" });
  await createCustomer.getByLabel("거래처명").fill("E2E 빅토리아 거래처");
  await createCustomer.getByLabel("사업자등록번호").fill("123-45-67890");
  await createCustomer.getByLabel("대표자").fill("김테스트");
  await createCustomer.getByLabel("대표 전화").fill("02-2026-0726");
  await createCustomer.getByRole("button", { name: "거래처 등록" }).click();
  await closeSuccessPopup(page, /C\d{6} 거래처를 등록했습니다\./);
  await expect(page).toHaveURL(/\/customers\/[0-9a-f-]+$/);
  await expect(page.getByRole("heading", { name: "E2E 빅토리아 거래처" })).toBeVisible();

  await page.getByRole("button", { name: "현장 추가" }).click();
  let siteDialog = page.getByRole("dialog", { name: "고객 현장 추가" });
  await siteDialog.getByLabel("현장 코드").fill("MAIN");
  await siteDialog.getByLabel("현장명").fill("E2E 본 현장");
  await siteDialog.getByLabel("기본 주소").fill("서울특별시 웹구");
  await siteDialog.getByRole("button", { name: "저장" }).click();
  await closeSuccessPopup(page, "고객 현장 정보를 저장했습니다.");
  await expect(page.getByRole("article").filter({ hasText: "E2E 본 현장" })).toContainText("기본");

  await page.getByRole("button", { name: "현장 추가" }).click();
  siteDialog = page.getByRole("dialog", { name: "고객 현장 추가" });
  await siteDialog.getByLabel("현장 코드").fill("SITE-02");
  await siteDialog.getByLabel("현장명").fill("E2E 제2현장");
  await siteDialog.getByRole("button", { name: "저장" }).click();
  await closeSuccessPopup(page, "고객 현장 정보를 저장했습니다.");
  await page.getByRole("button", { name: "E2E 제2현장 기본 고객 현장 지정" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "기본 지정" }).click();
  await closeSuccessPopup(page, "기본 고객 현장을 변경했습니다.");
  await expect(page.getByRole("article").filter({ hasText: "E2E 제2현장" })).toContainText("기본");

  await page.getByRole("button", { name: "담당자 추가" }).click();
  let contactDialog = page.getByRole("dialog", { name: "담당자 추가" });
  await contactDialog.getByLabel("담당자명").fill("E2E 첫 담당자");
  await contactDialog.getByLabel("연결 고객 현장").selectOption({ label: "E2E 본 현장" });
  await contactDialog.getByLabel("휴대전화").fill("010-1111-2222");
  await contactDialog.getByRole("button", { name: "저장" }).click();
  await closeSuccessPopup(page, "담당자 정보를 저장했습니다.");
  await expect(page.getByRole("article").filter({ hasText: "E2E 첫 담당자" })).toContainText("기본");

  await page.getByRole("button", { name: "담당자 추가" }).click();
  contactDialog = page.getByRole("dialog", { name: "담당자 추가" });
  await contactDialog.getByLabel("담당자명").fill("E2E 두 번째 담당자");
  await contactDialog.getByRole("button", { name: "저장" }).click();
  await closeSuccessPopup(page, "담당자 정보를 저장했습니다.");
  await page.getByRole("button", { name: "E2E 두 번째 담당자 기본 담당자 지정" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "기본 지정" }).click();
  await closeSuccessPopup(page, "기본 담당자를 변경했습니다.");
  await expect(page.getByRole("article").filter({ hasText: "E2E 두 번째 담당자" })).toContainText("기본");

  await page.getByRole("link", { name: "거래처 목록" }).click();
  await page.getByLabel("통합 검색").fill("1234567890");
  await page.getByRole("button", { name: "조회" }).click();
  await expect(page.getByText("E2E 빅토리아 거래처", { exact: true })).toBeVisible();

  const viewport = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(viewport.scrollWidth).toBe(viewport.clientWidth);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(page.getByRole("heading", { name: "거래처·고객 현장" })).toBeVisible();
  const mobileViewport = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(mobileViewport.scrollWidth).toBe(mobileViewport.clientWidth);
});
