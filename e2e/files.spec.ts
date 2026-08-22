// DXF 산출물 보관은 게시된 절곡 개정이 있어야 해서 통합 테스트(job.integration)가 맡는다.
// 여기서는 사용자 업로드본의 API 계약 전체를 브라우저 session 으로 확인한다.
import { createHash } from "node:crypto";

import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

const email = "e2e-admin@example.test";
const password = "Browser verification phrase 2026!";

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("이메일").fill(email);
  await page.getByLabel("비밀번호").fill(password);
  await page.getByRole("button", { name: "로그인" }).click();
  await expect(page).toHaveURL("/");
}

/** 서버가 요청 출처를 검사하므로 API 는 브라우저 안에서 부른다. */
async function api(
  page: Page,
  path: string,
  method: "GET" | "POST" | "DELETE" = "GET",
  body?: unknown,
) {
  return page.evaluate(
    async ([requestPath, requestMethod, requestBody]) => {
      const response = await fetch(requestPath as string, {
        method: requestMethod as string,
        headers: requestBody ? { "content-type": "application/json" } : undefined,
        body: requestBody ? JSON.stringify(requestBody) : undefined,
      });
      return { status: response.status, body: await response.json() };
    },
    [path, method, body ?? null] as const,
  );
}

function sha256(text: string) {
  return createHash("sha256").update(Buffer.from(text, "utf8")).digest("hex");
}

async function uploadAttachment(
  page: Page,
  request: APIRequestContext,
  fileName: string,
  contents: string,
) {
  const sizeBytes = Buffer.byteLength(contents, "utf8");
  const started = await api(page, "/api/v1/files/uploads", "POST", {
    kind: "OTHER",
    fileName,
    mediaType: "text/plain",
    sizeBytes,
    checksumSha256: sha256(contents),
  });
  expect(started.status).toBe(201);
  const fileId = started.body.data.file.id as string;
  const uploadUrl = started.body.data.upload.url as string;

  // presigned URL 로 올리는 것은 브라우저를 거칠 필요가 없다.
  const put = await request.put(uploadUrl, {
    headers: { "content-type": "text/plain" },
    data: contents,
  });
  expect(put.status()).toBe(200);
  return { fileId, started };
}

test("첨부 파일을 올리고 내려받고 지운다", async ({ page, request }) => {
  await login(page);
  const contents = `파일 저장소 검증 ${Date.now()}`;
  const { fileId, started } = await uploadAttachment(page, request, "검증첨부.txt", contents);

  // 시작 시점에는 아직 받을 수 없다.
  expect(started.body.data.file.status).toBe("PENDING");
  const tooEarly = await api(page, `/api/v1/files/${fileId}/downloads`, "POST");
  expect(tooEarly.status).toBe(409);

  const completed = await api(page, `/api/v1/files/${fileId}/complete`, "POST");
  expect(completed.status).toBe(200);
  expect(completed.body.data.status).toBe("READY");
  expect(completed.body.data.sizeBytes).toBe(Buffer.byteLength(contents, "utf8"));

  const ticket = await api(page, `/api/v1/files/${fileId}/downloads`, "POST");
  expect(ticket.status).toBe(200);
  expect(new Date(ticket.body.data.download.expiresAt).getTime()).toBeGreaterThan(Date.now());

  const downloaded = await request.get(ticket.body.data.download.url as string);
  expect(downloaded.status()).toBe(200);
  expect(await downloaded.text()).toBe(contents);
  expect(downloaded.headers()["content-disposition"]).toContain("filename");

  // 지우면 목록·조회에서 사라진다.
  const deleted = await api(page, `/api/v1/files/${fileId}`, "DELETE");
  expect(deleted.status).toBe(200);
  expect(deleted.body.data.status).toBe("DELETED");
  expect((await api(page, `/api/v1/files/${fileId}`)).status).toBe(404);
  expect((await api(page, `/api/v1/files/${fileId}/downloads`, "POST")).status).toBe(404);

  // 유예 기간 안에는 객체가 남아 있어 되돌릴 수 있다.
  const stillStored = await request.get(ticket.body.data.download.url as string);
  expect(stillStored.status()).toBe(200);
});

test("올린 내용이 선언과 다르면 완료를 거부한다", async ({ page, request }) => {
  await login(page);
  const declared = "AAAAAAAAAA";
  const actual = "BBBBBBBBBB";

  const started = await api(page, "/api/v1/files/uploads", "POST", {
    kind: "OTHER",
    fileName: "불일치.txt",
    mediaType: "text/plain",
    sizeBytes: declared.length,
    checksumSha256: sha256(declared),
  });
  expect(started.status).toBe(201);

  await request.put(started.body.data.upload.url as string, {
    headers: { "content-type": "text/plain" },
    data: actual,
  });

  const completed = await api(
    page,
    `/api/v1/files/${started.body.data.file.id}/complete`,
    "POST",
  );
  expect(completed.status).toBe(409);
  expect(completed.body.error.message).toContain("checksum");

  // 깨진 바이트를 남기지 않는다.
  const afterReject = await api(page, `/api/v1/files/${started.body.data.file.id}`);
  expect(afterReject.status).toBe(200);
  expect(afterReject.body.data.status).toBe("FAILED");
});

test("올리지 않고 완료를 요청하면 PENDING으로 남는다", async ({ page }) => {
  await login(page);
  const contents = "올리지 않은 파일";
  const started = await api(page, "/api/v1/files/uploads", "POST", {
    kind: "OTHER",
    fileName: "미완료.txt",
    mediaType: "text/plain",
    sizeBytes: Buffer.byteLength(contents, "utf8"),
    checksumSha256: sha256(contents),
  });
  expect(started.status).toBe(201);

  const completed = await api(
    page,
    `/api/v1/files/${started.body.data.file.id}/complete`,
    "POST",
  );
  expect(completed.status).toBe(409);

  const current = await api(page, `/api/v1/files/${started.body.data.file.id}`);
  expect(current.body.data.status).toBe("PENDING");
});

test("서버 생성물과 허용하지 않는 형식은 업로드를 막는다", async ({ page }) => {
  await login(page);

  const serverKind = await api(page, "/api/v1/files/uploads", "POST", {
    kind: "DXF",
    fileName: "직접만든.dxf",
    mediaType: "application/dxf",
    sizeBytes: 10,
    checksumSha256: sha256("x"),
  });
  expect(serverKind.status).toBe(400);

  const badExtension = await api(page, "/api/v1/files/uploads", "POST", {
    kind: "OTHER",
    fileName: "실행파일.exe",
    mediaType: "application/octet-stream",
    sizeBytes: 10,
    checksumSha256: sha256("x"),
  });
  expect(badExtension.status).toBe(400);

  const badChecksum = await api(page, "/api/v1/files/uploads", "POST", {
    kind: "OTHER",
    fileName: "형식오류.txt",
    mediaType: "text/plain",
    sizeBytes: 10,
    checksumSha256: "짧은값",
  });
  expect(badChecksum.status).toBe(400);
});

test("없는 파일과 잘못된 식별자는 구분해서 거절한다", async ({ page }) => {
  await login(page);

  const missing = await api(page, "/api/v1/files/00000000-0000-4000-8000-000000000000");
  expect(missing.status).toBe(404);

  const malformed = await api(page, "/api/v1/files/not-a-uuid");
  expect(malformed.status).toBe(400);
});
