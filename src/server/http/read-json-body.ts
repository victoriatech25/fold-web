import "server-only";

export type JsonBodyResult =
  | { ok: true; value: unknown }
  | {
      ok: false;
      status: 400 | 413 | 415;
      code: "INVALID_REQUEST" | "PAYLOAD_TOO_LARGE" | "UNSUPPORTED_MEDIA_TYPE";
      message: string;
    };

export async function readJsonBody(
  request: Request,
  maxPayloadBytes: number,
): Promise<JsonBodyResult> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.startsWith("application/json")) {
    return {
      ok: false,
      status: 415,
      code: "UNSUPPORTED_MEDIA_TYPE",
      message: "application/json 요청이 필요합니다.",
    };
  }

  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > maxPayloadBytes) {
    return {
      ok: false,
      status: 413,
      code: "PAYLOAD_TOO_LARGE",
      message: "요청 본문이 너무 큽니다.",
    };
  }

  const rawBody = await request.text();
  if (Buffer.byteLength(rawBody, "utf8") > maxPayloadBytes) {
    return {
      ok: false,
      status: 413,
      code: "PAYLOAD_TOO_LARGE",
      message: "요청 본문이 너무 큽니다.",
    };
  }

  try {
    return { ok: true, value: JSON.parse(rawBody) };
  } catch {
    return {
      ok: false,
      status: 400,
      code: "INVALID_REQUEST",
      message: "올바른 JSON 요청이 필요합니다.",
    };
  }
}
