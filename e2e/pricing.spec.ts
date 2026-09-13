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
  await page.getByRole("navigation", { name: "주요 메뉴" }).getByRole("link", { name: "기준정보" }).click();
  await page.getByRole("navigation", { name: "주요 메뉴" }).getByRole("link", { name: "가격 관리" }).click();
  await expect(page).toHaveURL(/\/pricing$/);
  await expect(page.getByRole("heading", { name: "가격 관리", level: 1 })).toBeVisible();
  await expect(page.getByText("활성 가격등급").locator("..")).toContainText("2개");
  await expect(page.getByText("사용 중 가격표").locator("..")).toContainText("3개");

  await page.getByRole("tab", { name: "가격 계산기" }).click();
  await page.locator('select[name="customerId"]').selectOption({ label: "SCREEN-PRICE · 화면검수 가격 거래처" });
  await page.locator('select[name="materialVariantId"]').selectOption({ label: "알루미늄 · 알루미늄 1T" });
  await page.getByRole("button", { name: "가격 계산" }).click();
  await expect(page.getByText("22,230원", { exact: true })).toBeVisible();
  await expect(page.getByText(/적용 출처: 거래처 전용/)).toBeVisible();
  await expect(page.getByText(/최소 절곡 할증 적용/)).toBeVisible();

  await page.getByRole("tab", { name: /가격표/ }).click();
  await page.getByRole("link", { name: /화면검수 거래처 전용 가격표/ }).click();
  await expect(page.getByRole("heading", { name: "화면검수 거래처 전용 가격표" })).toBeVisible();
  await expect(page.getByText("17000", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "새 개정 만들기" }).click();
  // 새 개정은 알림 없이 바로 편집 상태로 열린다.
  await expect(page.getByRole("heading", { name: "가격표 r2" })).toBeVisible();
  await expect(page.getByRole("button", { name: "저장하고 게시" })).toBeVisible();
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

test("처음 쓰는 회사도 가격표를 등록·게시해 수주 계산까지 간다", async ({ page }) => {
  await login(page);
  await page.goto("/pricing");
  await page.getByRole("button", { name: "가격표" }).first().click();
  const dialog = page.getByRole("dialog", { name: "새 가격표" });
  // 기본값은 조직 기본이라 등급이 없어도 바로 등록된다. seed 조직에는 조직 기본이 이미 있어 등급용으로 만든다.
  await expect(dialog.getByLabel("적용 범위")).toHaveValue("STANDARD");
  await dialog.getByLabel("적용 범위").selectOption("TIER");
  await dialog.getByLabel("적용 대상").selectOption({ label: "BASIC · 기본" });
  await dialog.getByLabel("가격표 코드").fill("E2E-TIER-BASIC");
  await dialog.getByLabel("가격표명").fill("E2E 기본 등급 가격표");
  await dialog.getByRole("button", { name: "등록" }).click();
  // 등록하면 알림 없이 첫 초안이 열린 상세로 간다.
  await expect(page).toHaveURL(/\/pricing\/[0-9a-f-]+$/);
  await expect(page.getByRole("heading", { name: "가격표 r1" })).toBeVisible();
  const priceInputs = page.getByPlaceholder("미설정");
  await priceInputs.nth(0).fill("20000");
  await priceInputs.nth(1).fill("1000");
  await priceInputs.nth(2).fill("500");
  // 변경 요약을 비워 둬도 게시된다.
  await page.getByRole("button", { name: "저장하고 게시" }).click();
  await page.getByRole("alertdialog", { name: "가격표 저장하고 게시" }).getByRole("button", { name: "게시" }).click();
  await closeAlert(page, "가격표를 게시했습니다.");
  await expect(page.getByText("사용 중", { exact: true }).first()).toBeVisible();
});
