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

async function workspaceMetrics(page: Page) {
  return page.evaluate(() => {
    const rect = (selector: string) => {
      const value = document.querySelector(selector)?.getBoundingClientRect();
      return value ? {
        x: value.x,
        y: value.y,
        width: value.width,
        height: value.height,
        bottom: value.bottom,
      } : null;
    };
    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      document: {
        width: document.documentElement.scrollWidth,
        height: document.documentElement.scrollHeight,
      },
      drawing: rect('[data-testid="drawing-area"]'),
      canvas: rect('[data-testid="fold-canvas"]'),
      panel: rect('[data-testid="property-panel"]'),
    };
  });
}

test("데스크톱 해상도별 남은 공간을 도면과 속성 패널이 함께 채운다", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await login(page);

  const drawingHeights: number[] = [];
  const drawingWidths: number[] = [];
  for (const viewport of [
    { width: 1280, height: 720 },
    { width: 1440, height: 900 },
    { width: 1920, height: 1080 },
  ]) {
    await page.setViewportSize(viewport);
    await expect(page.getByTestId("fold-canvas")).toBeVisible();
    const metrics = await workspaceMetrics(page);

    expect(metrics.drawing).not.toBeNull();
    expect(metrics.canvas).not.toBeNull();
    expect(metrics.panel).not.toBeNull();
    expect(metrics.document.width).toBeLessThanOrEqual(viewport.width);
    expect(metrics.document.height).toBeLessThanOrEqual(viewport.height);
    expect(metrics.drawing!.bottom).toBeLessThanOrEqual(viewport.height);
    expect(Math.abs(metrics.canvas!.height - metrics.drawing!.height)).toBeLessThanOrEqual(1);
    expect(Math.abs(metrics.panel!.height - metrics.drawing!.height)).toBeLessThan(1);

    drawingHeights.push(metrics.drawing!.height);
    drawingWidths.push(metrics.drawing!.width);
  }

  expect(drawingHeights[1]).toBeGreaterThan(drawingHeights[0]);
  expect(drawingHeights[2]).toBeGreaterThan(drawingHeights[1]);
  expect(drawingWidths[1]).toBeGreaterThan(drawingWidths[0]);
  expect(drawingWidths[2]).toBeGreaterThan(drawingWidths[1]);
});

test("노트북·태블릿·모바일 폭에서 가로 넘침 없이 자연스럽게 재배치한다", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await login(page);

  for (const viewport of [
    { width: 1024, height: 768 },
    { width: 768, height: 1024 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await expect(page.getByTestId("fold-canvas")).toBeVisible();
    const metrics = await workspaceMetrics(page);

    expect(metrics.document.width).toBeLessThanOrEqual(viewport.width);
    expect(metrics.drawing).not.toBeNull();
    expect(metrics.canvas).not.toBeNull();
    expect(Math.abs(metrics.canvas!.width - metrics.drawing!.width)).toBeLessThanOrEqual(1);
    expect(Math.abs(metrics.canvas!.height - metrics.drawing!.height)).toBeLessThanOrEqual(1);
  }
});

test("2D·3D·전개도·분할 화면이 같은 반응형 도면 높이를 사용한다", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page);

  const drawing = page.getByTestId("drawing-area");
  const drawingBox = await drawing.boundingBox();
  expect(drawingBox).not.toBeNull();

  await page.getByRole("button", { name: "3D", exact: true }).click();
  const model = page.getByRole("region", { name: "3D 미리보기" });
  await expect(model).toBeVisible();
  const modelBox = await model.boundingBox();
  expect(modelBox).not.toBeNull();
  expect(Math.abs(modelBox!.height - drawingBox!.height)).toBeLessThanOrEqual(1);

  await page.getByRole("button", { name: "전개도", exact: true }).click();
  const developed = page.getByRole("region", { name: "일반 절곡 전개도" });
  await expect(developed).toBeVisible();
  const developedBox = await developed.boundingBox();
  expect(developedBox).not.toBeNull();
  expect(Math.abs(developedBox!.height - drawingBox!.height)).toBeLessThanOrEqual(1);

  await page.getByRole("button", { name: "분할", exact: true }).click();
  await expect(page.getByTestId("fold-canvas")).toBeVisible();
  await expect(model).toBeVisible();
  await expect(developed).toBeVisible();
  const splitModelBox = await model.boundingBox();
  const splitDevelopedBox = await developed.boundingBox();
  expect(splitModelBox).not.toBeNull();
  expect(splitDevelopedBox).not.toBeNull();
  expect(Math.abs(splitModelBox!.height + splitDevelopedBox!.height - drawingBox!.height)).toBeLessThanOrEqual(1);
});
