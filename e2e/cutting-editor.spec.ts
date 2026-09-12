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

async function openTab(page: import("@playwright/test").Page, name: string | RegExp) {
  await page.getByRole("tab", { name }).click();
}

/**
 * 승인된 수주에서 재단을 시작하고 worker 결과를 기다린 뒤, 편집기에서 원판을 더해
 * 부품을 옮겨 저장한다(`P2-B11` B11-2). worker 는 `global-setup.ts` 가 띄운다.
 */
test("재단 배치를 편집기에서 옮겨 저장하면 편집 개정이 쌓인다", async ({ page }) => {
  test.setTimeout(120_000);
  await login(page);

  // 수주 만들기 → 절곡 작업 → 계산 → 승인. orders.spec 과 같은 경로다.
  await page.getByRole("navigation", { name: "주요 메뉴" }).getByRole("link", { name: "수주 등록/조회" }).click();
  await page.getByRole("button", { name: "새 수주" }).click();
  const createDialog = page.getByRole("dialog", { name: "새 수주" });
  await createDialog.getByLabel("새 수주 거래처").selectOption({ label: "SCREEN-PRICE · 화면검수 가격 거래처" });
  await createDialog.getByRole("button", { name: "수주 등록" }).click();

  await openTab(page, /절곡 작업/);
  await page.getByRole("button", { name: "절곡 작업 추가" }).click();
  await page.getByLabel("게시 템플릿 검색").fill("SCREEN-FOLD-L");
  await page.getByText("SCREEN-FOLD-L · 화면검수 ㄱ자 절곡", { exact: true }).click();
  await page.getByRole("button", { name: "선택 작업 추가" }).click();
  await expect(page.getByText("작업 1 · SCREEN-FOLD-L · 개정 1")).toBeVisible();

  await openTab(page, "계산·금액");
  await page.getByRole("button", { name: "수주 계산" }).click();
  await page.getByRole("alertdialog", { name: "수주 계산 완료" }).getByRole("button", { name: "확인" }).click();

  await openTab(page, "승인·생산");
  await page.getByRole("button", { name: "수주 승인", exact: true }).click();
  await page.getByRole("alertdialog", { name: "수주 승인" }).getByRole("button", { name: "수주 승인", exact: true }).click();
  await page.getByRole("alertdialog", { name: "상태 변경 완료" }).getByRole("button", { name: "확인" }).click();

  // 재단 시작. worker 가 결과를 내면 목록에 계산 완료로 뜬다.
  await page.getByRole("button", { name: "재단 시작" }).click();
  await page.getByRole("alertdialog", { name: "재단 시작" }).getByRole("button", { name: "확인" }).click();
  const planLink = page.locator("a[href^='/cutting/']").first();
  await expect(planLink).toBeVisible();
  const planHref = await planLink.getAttribute("href");
  expect(planHref).not.toBeNull();

  await page.goto(planHref!);
  await expect(page.getByText("계산 완료", { exact: true })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("cutting-edit-link")).toBeVisible();

  // 편집기: 원판을 하나 더 붙이고 첫 부품을 새 원판으로 끌어 옮긴다.
  await page.getByTestId("cutting-edit-link").click();
  await expect(page.getByTestId("cutting-editor")).toBeVisible();
  await expect(page.getByTestId("editor-validation-status")).toHaveText("저장 가능");
  await page.getByRole("button", { name: "원판 추가" }).click();
  await expect(page.getByTestId("editor-sheet-1")).toBeVisible();

  const piece = page.getByTestId("editor-sheet-0").locator("[data-testid^='placement-']").first();
  const targetSvg = page.getByTestId("editor-sheet-1").locator("svg");
  const from = await piece.boundingBox();
  const to = await targetSvg.boundingBox();
  expect(from && to).toBeTruthy();
  await page.mouse.move(from!.x + 10, from!.y + 10);
  await page.mouse.down();
  await page.mouse.move(to!.x + 60, to!.y + 60, { steps: 8 });
  await expect(page.getByTestId("editor-ghost")).toBeVisible();
  await page.mouse.up();

  await expect(page.getByTestId("editor-sheet-1").locator("[data-testid^='placement-']")).toHaveCount(1);
  await expect(page.getByTestId("editor-validation-status")).toHaveText("저장 가능");
  await expect(page.getByRole("button", { name: "실행취소" })).toBeEnabled();

  await page.getByTestId("editor-save").click();
  await expect(page).toHaveURL(planHref!);
  await expect(page.getByRole("cell", { name: "편집", exact: true })).toBeVisible();
  await expect(page.getByText("원판 2", { exact: true })).toBeVisible();
});
