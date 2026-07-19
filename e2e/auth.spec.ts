import { expect, test } from "@playwright/test";

const email = "e2e-admin@example.test";
const password = "Browser verification phrase 2026!";
const baseURL = "http://127.0.0.1:3100";

async function loginAsAdministrator(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.getByLabel("이메일").fill(email);
  await page.getByLabel("비밀번호").fill(password);
  await page.getByRole("button", { name: "로그인" }).click();
  await expect(page).toHaveURL("/");
}

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
  await loginAsAdministrator(page);
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

test("관리자 UI에서 조직 설정과 사용자 수명주기를 완료한다", async ({
  browser,
  page,
}) => {
  await loginAsAdministrator(page);
  await expect(
    page.getByRole("link", { name: "조직 관리" }),
  ).toBeVisible();

  await page.getByRole("link", { name: "조직 관리" }).click();
  await expect(page).toHaveURL(/\/admin\/users$/);
  await expect(
    page.getByRole("heading", { name: "사용자 관리" }),
  ).toBeVisible();

  await page.getByRole("link", { name: "부서" }).click();
  await page.getByPlaceholder("DESIGN").fill("E2E_DESIGN");
  await page.getByPlaceholder("설계팀").fill("E2E 설계팀");
  await page.getByRole("button", { name: "추가" }).click();
  await expect(page.locator('input[value="E2E 설계팀"]')).toBeVisible();

  await page.getByRole("link", { name: "역할과 권한" }).click();
  await expect(page.getByText("ADMINISTRATOR", { exact: true })).toBeVisible();
  await page.getByPlaceholder("SHOP_TEAM").fill("E2E_SUPPORT");
  await page.getByLabel("이름").fill("E2E 지원");
  await page.getByLabel("설명").fill("브라우저 회귀 검증 역할");
  await page
    .getByRole("checkbox", { name: "customer.read 거래처 조회" })
    .check();
  await page.getByRole("button", { name: "역할 추가" }).click();
  await expect(page.getByText("E2E_SUPPORT", { exact: true })).toBeVisible();

  await page.getByRole("link", { name: "사용자" }).click();
  await page.getByLabel("이메일").fill("e2e-viewer@example.test");
  await page.locator('input[name="displayName"]').fill("E2E 조회자");
  await page
    .getByRole("group", { name: "역할" })
    .getByRole("checkbox", { name: "조회자" })
    .check();
  await page.getByRole("button", { name: "초대 주소 발급" }).click();
  const invitationUrl = await page
    .getByLabel("사용자 초대 주소")
    .inputValue();
  await expect(page.getByText("E2E 조회자", { exact: true })).toBeVisible();

  await page.getByPlaceholder("이름 또는 이메일").fill("e2e-viewer");
  await page.getByRole("button", { name: "조회" }).click();
  await expect(page.getByText("현재 1명 표시")).toBeVisible();

  const viewerContext = await browser.newContext();
  const viewerPage = await viewerContext.newPage();
  await viewerPage.goto(invitationUrl);
  await viewerPage
    .getByLabel("새 비밀번호", { exact: true })
    .fill("E2E viewer phrase 2026!");
  await viewerPage
    .getByLabel("새 비밀번호 확인")
    .fill("E2E viewer phrase 2026!");
  await viewerPage
    .getByRole("button", { name: "새 비밀번호 설정" })
    .click();
  await expect(
    viewerPage.getByText("비밀번호가 설정되었습니다. 로그인해 주세요."),
  ).toBeVisible();
  await viewerPage.getByRole("link", { name: "로그인으로 이동" }).click();
  await viewerPage.getByLabel("이메일").fill("e2e-viewer@example.test");
  await viewerPage
    .getByLabel("비밀번호")
    .fill("E2E viewer phrase 2026!");
  await viewerPage.getByRole("button", { name: "로그인" }).click();
  await expect(viewerPage).toHaveURL("/");
  await expect(
    viewerPage.getByRole("link", { name: "조직 관리" }),
  ).toHaveCount(0);
  const deniedPage = await viewerPage.goto("/admin/users");
  expect(deniedPage?.status()).toBe(404);
  const deniedApi = await viewerPage.request.get("/api/v1/admin/users");
  expect(deniedApi.status()).toBe(403);

  const usersResponse = await page.request.get(
    "/api/v1/admin/users?query=e2e-viewer&limit=25",
  );
  expect(usersResponse.ok()).toBe(true);
  const usersEnvelope = (await usersResponse.json()) as {
    data: {
      items: Array<{ id: string; updatedAt: string }>;
    };
  };
  const viewer = usersEnvelope.data.items[0];
  const suspendResponse = await page.request.patch(
    `/api/v1/admin/users/${viewer.id}`,
    {
      headers: { Origin: baseURL },
      data: {
        status: "SUSPENDED",
        expectedUpdatedAt: viewer.updatedAt,
      },
    },
  );
  expect(suspendResponse.ok()).toBe(true);
  await viewerPage.goto("/");
  await expect(viewerPage).toHaveURL(/\/login$/);
  await viewerContext.close();
});
