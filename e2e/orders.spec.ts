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

async function confirmStatusAction(page: import("@playwright/test").Page, name: string) {
  await page.getByRole("button", { name, exact: true }).click();
  const confirm = page.getByRole("alertdialog", { name });
  await confirm.getByRole("button", { name, exact: true }).click();
  const completed = page.getByRole("alertdialog", { name: "상태 변경 완료" });
  await completed.getByRole("button", { name: "확인" }).click();
}

test("수주 헤더를 생성·자동 저장·복사·취소하고 다시 조회한다", async ({ page }) => {
  await login(page);
  await page.getByRole("link", { name: "수주·작업" }).click();
  await expect(page).toHaveURL(/\/orders$/);
  await expect(page.getByRole("heading", { name: "수주 목록" })).toBeVisible();

  await page.getByLabel("새 수주 거래처").selectOption({
    label: "SCREEN-PRICE · 화면검수 가격 거래처",
  });
  await page.getByRole("button", { name: "새 수주" }).click();
  await expect(page).toHaveURL(/\/orders\/[0-9a-f-]+$/);
  const originalUrl = page.url();
  const originalNumber = await page.getByRole("heading", { level: 1 }).textContent();
  expect(originalNumber).toMatch(/^SO-\d{4}-\d{6}$/);

  await page.getByLabel("납기").fill("2026-08-31");
  await page.getByLabel("외부 참조").fill("E2E-PO-0815");
  await page.getByLabel("내부 비고").fill("수주 자동 저장 E2E");
  await expect(page.getByRole("status")).toContainText("저장됨", { timeout: 10_000 });
  await page.reload();
  await expect(page.getByLabel("납기")).toHaveValue("2026-08-31");
  await expect(page.getByLabel("외부 참조")).toHaveValue("E2E-PO-0815");
  await expect(page.getByLabel("내부 비고")).toHaveValue("수주 자동 저장 E2E");

  await page.getByRole("button", { name: "복사" }).click();
  const copyDialog = page.getByRole("alertdialog", { name: "수주 복사" });
  await copyDialog.getByRole("button", { name: "복사" }).click();
  await expect(page).not.toHaveURL(originalUrl);
  const copiedNumber = await page.getByRole("heading", { level: 1 }).textContent();
  expect(copiedNumber).toMatch(/^SO-\d{4}-\d{6}$/);
  expect(copiedNumber).not.toBe(originalNumber);
  await expect(page.getByLabel("내부 비고")).toHaveValue("수주 자동 저장 E2E");

  await page.getByRole("button", { name: "취소" }).click();
  const cancelDialog = page.getByRole("dialog", { name: "수주 취소" });
  await cancelDialog.getByLabel("취소 사유").fill("E2E 고객 요청");
  await cancelDialog.getByRole("button", { name: "취소" }).click();
  const completed = page.getByRole("alertdialog", { name: "수주 취소 완료" });
  await completed.getByRole("button", { name: "확인" }).click();
  await expect(page.getByText("취소 사유: E2E 고객 요청")).toBeVisible();
  await expect(page.getByLabel("납기")).toBeDisabled();

  await page.getByRole("link", { name: "수주 목록" }).click();
  await page.getByLabel("수주 검색").fill(copiedNumber ?? "");
  await page.getByLabel("수주일 시작").fill("2026-01-01");
  await page.getByLabel("수주일 종료").fill("2026-12-31");
  await page.getByLabel("수주 상태").selectOption("CANCELLED");
  await page.getByRole("button", { name: "조회" }).click();
  await expect(page.getByText(copiedNumber ?? "", { exact: true })).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(page.getByRole("heading", { name: "수주 목록" })).toBeVisible();
  const viewport = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(viewport.scrollWidth).toBe(viewport.clientWidth);
});

test("게시 절곡 개정을 수주 snapshot으로 추가하고 입력·복사·정렬·제거한다", async ({ page }) => {
  await login(page);
  await page.getByRole("link", { name: "수주·작업" }).click();
  await page.getByLabel("새 수주 거래처").selectOption({ label: "SCREEN-PRICE · 화면검수 가격 거래처" });
  await page.getByRole("button", { name: "새 수주" }).click();

  await expect(page.getByRole("heading", { name: "절곡 작업" })).toBeVisible();
  await page.getByRole("button", { name: "절곡 작업 추가" }).click();
  await page.getByLabel("게시 템플릿 검색").fill("SCREEN-FOLD-L");
  await page.getByText("SCREEN-FOLD-L · 화면검수 ㄱ자 절곡", { exact: true }).click();
  await page.getByRole("button", { name: "선택 작업 추가" }).click();

  await expect(page.getByText("작업 1 · SCREEN-FOLD-L · 개정 1")).toBeVisible();
  await expect(page.getByText(/수량 2 · 알루미늄 1T/)).toBeVisible();
  await expect(page.getByText(/고객정보가 고정되었습니다/)).toBeVisible();
  await expect(page.locator("select.field-control").nth(0)).toBeDisabled();
  await expect(page.locator("select.field-control").nth(1)).toBeDisabled();
  await expect(page.locator("select.field-control").nth(2)).toBeDisabled();

  await page.getByLabel("수량").fill("5");
  await page.getByRole("textbox", { name: "A", exact: true }).fill("250");
  const materialSelect = page.getByLabel("재질·두께");
  const twoTRuleId = await materialSelect.locator("option").filter({ hasText: "알루미늄 2T" }).first().getAttribute("value");
  expect(twoTRuleId).not.toBeNull();
  await materialSelect.selectOption(twoTRuleId!);
  await expect(page.getByLabel("원판")).not.toHaveValue("");
  await page.getByRole("button", { name: "작업 입력 저장" }).click();
  await expect(page.getByText(/수량 5 · 알루미늄 2T/)).toBeVisible();

  const firstCard = page.locator("article").filter({ hasText: "작업 1 · SCREEN-FOLD-L" });
  await firstCard.getByRole("button", { name: "복사" }).click();
  await expect(page.getByText("작업 2 · SCREEN-FOLD-L · 개정 1")).toBeVisible();
  const secondCard = page.locator("article").filter({ hasText: "작업 2 · SCREEN-FOLD-L" });
  await secondCard.getByRole("button", { name: /위로/ }).click();
  await expect(page.locator("article").first()).toContainText("작업 2");

  await secondCard.getByRole("button", { name: "제거" }).click();
  const removeDialog = page.getByRole("alertdialog", { name: "절곡 작업 제거" });
  await removeDialog.getByRole("button", { name: "제거" }).click();
  await expect(page.getByText("작업 2 · SCREEN-FOLD-L · 개정 1")).toHaveCount(0);
  await expect(page.getByText("작업 1 · SCREEN-FOLD-L · 개정 1")).toBeVisible();

  await page.reload();
  await expect(page.getByText(/수량 5 · 알루미늄 2T/)).toBeVisible();
  await expect(page.getByRole("textbox", { name: "A", exact: true })).toHaveValue("250");

  await expect(page.getByRole("heading", { name: "계산·가격" })).toBeVisible();
  await expect(page.getByText("계산 전", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "수주 계산" }).click();
  const calculatedDialog = page.getByRole("alertdialog", { name: "수주 계산 완료" });
  await calculatedDialog.getByRole("button", { name: "확인" }).click();
  const calculationSection = page.locator("section").filter({ has: page.getByRole("heading", { name: "계산·가격" }) });
  await expect(calculationSection.getByText("계산 완료", { exact: true })).toBeVisible();
  await expect(page.getByText("계산 버전 1", { exact: false })).toBeVisible();
  await expect(page.getByText("거래처 전용").or(page.getByText("가격등급")).or(page.getByText("조직 기본"))).toBeVisible();

  await page.getByLabel("수량").fill("6");
  await page.getByRole("button", { name: "작업 입력 저장" }).click();
  await expect(page.getByText("재계산 필요", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "다시 계산" }).click();
  const recalculatedDialog = page.getByRole("alertdialog", { name: "수주 재계산 완료" });
  await recalculatedDialog.getByRole("button", { name: "확인" }).click();
  await expect(page.getByText("계산 버전 2", { exact: false })).toBeVisible();

  await confirmStatusAction(page, "수주 승인");
  await expect(page.getByText("고정 계산 버전")).toContainText("2");
  await expect(page.getByLabel("수량")).toBeDisabled();
  await expect(page.getByLabel("수량")).toHaveCSS("background-color", "rgb(247, 243, 234)");
  await expect(page.getByLabel("수량")).toHaveCSS("cursor", "not-allowed");

  await page.getByRole("button", { name: "승인 취소" }).click();
  const approvalCancel = page.getByRole("dialog", { name: "승인 취소" });
  await approvalCancel.getByLabel("승인 취소 사유").fill("E2E 입력 재검토");
  await approvalCancel.getByRole("button", { name: "승인 취소" }).click();
  await page.getByRole("alertdialog", { name: "상태 변경 완료" }).getByRole("button", { name: "확인" }).click();
  await expect(page.getByLabel("수량")).toBeEnabled();

  await confirmStatusAction(page, "수주 승인");
  await confirmStatusAction(page, "생산 요청");
  await confirmStatusAction(page, "생산 시작");
  await confirmStatusAction(page, "생산 완료");
  await confirmStatusAction(page, "수주 마감");
  await expect(page.getByText("현재 단계:")).toContainText("마감");
  await expect(page.getByRole("heading", { name: "수주 이력" })).toBeVisible();
  await expect(page.getByText("수주 승인·생산 상태 전이").first()).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(page.getByRole("heading", { name: "절곡 작업" })).toBeVisible();
  const viewport = await page.evaluate(() => ({ clientWidth: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth }));
  expect(viewport.scrollWidth).toBe(viewport.clientWidth);
});
