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

async function waitForSaved(page: import("@playwright/test").Page) {
  await expect(page.getByRole("status")).toHaveText("저장됨", {
    timeout: 10_000,
  });
}

test("초안 자동 저장, 새로고침, 충돌과 로컬 복구를 완료한다", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await login(page);

  await page.getByRole("button", { name: "새 초안" }).click();
  await expect(
    page.getByRole("heading", { name: "새 절곡 초안" }),
  ).toBeVisible();
  await page.getByLabel("새 초안 이름").fill("E2E 자동 저장 초안");
  await page.getByRole("button", { name: "생성", exact: true }).click();
  await expect(page).toHaveURL(/\?draft=[0-9a-f-]+$/);
  await expect(page.getByLabel("초안 이름")).toHaveValue("E2E 자동 저장 초안");

  const productLength = page.getByLabel("길이 (mm)", { exact: true });
  await productLength.fill("1234");
  await expect(page.getByRole("status")).toHaveText(/저장 대기|저장 중/);
  await waitForSaved(page);
  await page.reload();
  await expect(productLength).toHaveValue("1234");

  const draftUrl = page.url();
  const secondPage = await page.context().newPage();
  await secondPage.goto(draftUrl);
  await expect(secondPage.getByLabel("초안 이름")).toHaveValue(
    "E2E 자동 저장 초안",
  );

  await page.getByLabel("초안 이름").fill("E2E 첫 번째 탭 저장");
  await expect(page.getByRole("status")).toHaveText(/저장 대기|저장 중/);
  await waitForSaved(page);

  await secondPage.getByLabel("초안 이름").fill("E2E 충돌 로컬본");
  await expect(
    secondPage.getByText("다른 화면의 저장과 충돌했습니다."),
  ).toBeVisible({ timeout: 10_000 });
  await secondPage.getByRole("button", { name: "새 초안으로 복사" }).click();
  await expect(secondPage).not.toHaveURL(draftUrl);
  await waitForSaved(secondPage);
  await expect(secondPage.getByLabel("초안 이름")).toHaveValue(
    "E2E 충돌 로컬본",
  );

  await secondPage.route("**/api/v1/fold-drafts/**", async (route) => {
    if (route.request().method() === "PUT") {
      await route.abort("failed");
    } else {
      await route.continue();
    }
  });
  await secondPage.getByLabel("초안 이름").fill("E2E 장애 복구본");
  await expect(secondPage.getByRole("status")).toContainText("오프라인", {
    timeout: 10_000,
  });
  secondPage.once("dialog", (dialog) => void dialog.accept());
  await secondPage.reload();
  await expect(
    secondPage.getByText(/미저장 복구본이 있습니다/),
  ).toBeVisible({ timeout: 10_000 });
  await secondPage.unroute("**/api/v1/fold-drafts/**");
  await secondPage.getByRole("button", { name: "복구", exact: true }).click();
  await waitForSaved(secondPage);
  await secondPage.reload();
  await expect(secondPage.getByLabel("초안 이름")).toHaveValue(
    "E2E 장애 복구본",
  );

  await secondPage.getByRole("button", { name: "현재 초안 삭제" }).click();
  const deleteDialog = secondPage.getByRole("alertdialog", { name: "초안 삭제" });
  await expect(deleteDialog).toBeVisible();
  await deleteDialog.getByRole("button", { name: "삭제" }).click();
  await expect(secondPage).toHaveURL("/fold-editor");
  await expect(secondPage.getByText("현재 예제는 서버에 저장되지 않습니다.")).toBeVisible();
  await secondPage.close();
});
