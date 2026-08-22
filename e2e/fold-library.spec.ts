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

test("템플릿을 분류하고 검토·게시·새 개정·비교한다", async ({ page }) => {
  test.setTimeout(90_000);
  await login(page);

  await page.getByRole("button", { name: "새 초안" }).click();
  await page.getByLabel("새 초안 이름").fill("E2E 라이브러리 수직 흐름");
  await page.getByRole("button", { name: "생성", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("저장됨", { timeout: 10_000 });

  await page.getByRole("link", { name: "템플릿 라이브러리" }).click();
  await expect(page).toHaveURL(/\/fold-library$/);
  await expect(page.getByRole("heading", { name: "절곡 템플릿 라이브러리" })).toBeVisible();

  await page.getByRole("button", { name: "분류 추가" }).click();
  const categoryDialog = page.getByRole("dialog", { name: "분류 추가" });
  await expect(categoryDialog).toBeVisible();
  await categoryDialog.getByLabel("분류 이름").fill("E2E 분류");
  await categoryDialog.getByRole("button", { name: "추가" }).click();
  await expect(page.getByRole("status")).toHaveText("분류를 생성했습니다.");

  await page.getByLabel("템플릿 이름 또는 코드").fill("E2E 라이브러리");
  await page.getByRole("button", { name: "조회" }).click();
  await page.getByRole("button", { name: /E2E 라이브러리 수직 흐름/ }).click();
  await expect(page.getByRole("heading", { name: "E2E 라이브러리 수직 흐름" })).toBeVisible();
  await expect(page.getByLabel("선택 개정 형상 미리보기")).toBeVisible();

  await page.getByLabel("템플릿 분류", { exact: true }).selectOption({ label: "E2E 분류" });
  await page.getByRole("button", { name: "정보 저장" }).click();
  await expect(page.getByRole("status")).toHaveText("템플릿 정보를 저장했습니다.");

  await page.getByRole("button", { name: "검토 요청" }).click();
  const reviewDialog = page.getByRole("alertdialog", { name: "검토 요청" });
  await expect(reviewDialog).toBeVisible();
  await reviewDialog.getByRole("button", { name: "검토 요청" }).click();
  await expect(page.getByRole("status")).toHaveText("검토를 요청했습니다.");
  await expect(page.getByText("검토 중 r1")).toBeVisible();

  await page.getByRole("button", { name: "게시", exact: true }).click();
  const publishDialog = page.getByRole("alertdialog", { name: "개정 게시" });
  await expect(publishDialog).toBeVisible();
  await publishDialog.getByRole("button", { name: "게시", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("개정을 게시했습니다.");
  await expect(page.getByText("게시 r1")).toBeVisible();

  await page.getByRole("button", { name: "선택 개정으로 새 초안" }).click();
  await expect(page.getByRole("status")).toHaveText("새 작업 개정을 만들었습니다.");
  await expect(page.getByText("초안 r2")).toBeVisible();
  await expect(page.getByRole("link", { name: "초안 편집" })).toHaveAttribute("href", /\?draft=/);

  await page.getByLabel("비교 왼쪽 개정").selectOption({ label: "r1 게시" });
  await page.getByLabel("비교 오른쪽 개정").selectOption({ label: "r2 초안" });
  await page.getByRole("button", { name: "비교", exact: true }).click();
  await expect(page.getByText(/차이 \d+개/)).toBeVisible();
});
