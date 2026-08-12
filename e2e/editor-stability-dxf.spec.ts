import { expect, test, type Page } from "@playwright/test";

const email = "e2e-admin@example.test";
const password = "Browser verification phrase 2026!";

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("이메일").fill(email);
  await page.getByLabel("비밀번호").fill(password);
  await page.getByRole("button", { name: "로그인" }).click();
  await expect(page).toHaveURL("/");
  await page.goto("/fold-editor");
}

test("편집 단축키와 DXF 다운로드를 한 화면에서 검증한다", async ({ page }) => {
  test.setTimeout(60_000);
  await login(page);
  await page.getByRole("button", { name: "새 초안" }).click();
  await page.getByLabel("새 초안 이름").fill("E2E DXF 출력");
  await page.getByRole("button", { name: "생성", exact: true }).click();
  await expect(page).toHaveURL(/\?draft=[0-9a-f-]+$/);

  await page.getByLabel("길이 (mm)", { exact: true }).fill("1000");
  await page.getByRole("button", { name: "연속 선 그리기" }).click();
  const canvas = page.getByTestId("fold-canvas");
  await canvas.click({ position: { x: 180, y: 240 } });
  await canvas.click({ position: { x: 360, y: 240 } });
  const draftName = page.getByLabel("초안 이름");
  await draftName.fill("E2E DXF 키보드");
  await page.getByRole("heading", { name: "절곡 단면 편집기" }).click();
  await page.keyboard.press("ControlOrMeta+z");
  await expect(draftName).toHaveValue("E2E DXF 출력");
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect(draftName).toHaveValue("E2E DXF 키보드");

  await expect(page.getByRole("status")).toHaveText("저장됨", { timeout: 10_000 });
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "DXF 출력" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("E2E DXF 키보드.dxf");
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  const content = Buffer.concat(chunks).toString("utf8");
  expect(content).toContain("AC1015");
  expect(content).toContain("$INSUNITS");
  await expect(page.getByRole("alertdialog", { name: "DXF 생성 완료" })).toBeVisible();
  await page.getByRole("button", { name: "확인" }).click();
});
