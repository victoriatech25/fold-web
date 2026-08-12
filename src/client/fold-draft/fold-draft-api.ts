import type { ServerFoldDocument } from "@/domain/fold-document/schema";
import type {
  FoldDraftConflictDto,
  FoldDraftDetailDto,
  FoldDraftListDto,
  FoldMaterialOptionDto,
} from "@/server/fold-draft/fold-draft-types";

type ApiEnvelope<T> = { data: T };

type ApiErrorEnvelope = {
  error?: {
    code?: string;
    message?: string;
    requestId?: string;
    issues?: unknown;
    conflict?: FoldDraftConflictDto;
  };
};

export class FoldDraftApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly requestId?: string,
    readonly conflict?: FoldDraftConflictDto,
    readonly issues?: unknown,
  ) {
    super(message);
    this.name = "FoldDraftApiError";
  }

  get retryable(): boolean {
    return this.status >= 500;
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      cache: "no-store",
      credentials: "same-origin",
      ...init,
      headers: {
        ...(init?.body ? { "content-type": "application/json" } : {}),
        ...init?.headers,
      },
    });
  } catch {
    throw new FoldDraftApiError(
      0,
      "NETWORK_ERROR",
      "서버에 연결할 수 없습니다.",
    );
  }
  const body = (await response.json().catch(() => ({}))) as
    | ApiEnvelope<T>
    | ApiErrorEnvelope;
  if (!response.ok || !("data" in body)) {
    const error = "error" in body ? body.error : undefined;
    throw new FoldDraftApiError(
      response.status,
      error?.code ?? "UNKNOWN_ERROR",
      error?.message ?? "요청을 처리하지 못했습니다.",
      error?.requestId,
      error?.conflict,
      error?.issues,
    );
  }
  return body.data;
}

export function listFoldDrafts(cursor?: string): Promise<FoldDraftListDto> {
  const query = new URLSearchParams({ limit: "25" });
  if (cursor) query.set("cursor", cursor);
  return request(`/api/v1/fold-drafts?${query.toString()}`);
}

export function getFoldDraft(draftId: string): Promise<FoldDraftDetailDto> {
  return request(`/api/v1/fold-drafts/${encodeURIComponent(draftId)}`);
}

export function createFoldDraft(input: {
  draftId: string;
  document: ServerFoldDocument;
}): Promise<FoldDraftDetailDto> {
  return request("/api/v1/fold-drafts", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateFoldDraft(input: {
  draftId: string;
  expectedLockVersion: number;
  document: ServerFoldDocument;
}): Promise<FoldDraftDetailDto> {
  return request(`/api/v1/fold-drafts/${encodeURIComponent(input.draftId)}`, {
    method: "PUT",
    body: JSON.stringify({
      expectedLockVersion: input.expectedLockVersion,
      document: input.document,
    }),
  });
}

export function deleteFoldDraft(input: {
  draftId: string;
  expectedLockVersion: number;
}): Promise<{ draftId: string }> {
  return request(`/api/v1/fold-drafts/${encodeURIComponent(input.draftId)}`, {
    method: "DELETE",
    body: JSON.stringify({ expectedLockVersion: input.expectedLockVersion }),
  });
}

export function listFoldMaterialOptions(): Promise<FoldMaterialOptionDto[]> {
  return request("/api/v1/fold-material-options");
}

export async function exportFoldDraftDxf(revisionId: string): Promise<{
  blob: Blob;
  fileName: string;
  checksumSha256: string | null;
  assetId: string | null;
}> {
  let response: Response;
  try {
    response = await fetch("/api/v1/fold-exports/dxf", {
      method: "POST",
      cache: "no-store",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ revisionId }),
    });
  } catch {
    throw new FoldDraftApiError(0, "NETWORK_ERROR", "서버에 연결할 수 없습니다.");
  }
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as ApiErrorEnvelope;
    throw new FoldDraftApiError(
      response.status,
      body.error?.code ?? "UNKNOWN_ERROR",
      body.error?.message ?? "DXF를 생성하지 못했습니다.",
      body.error?.requestId,
    );
  }
  const disposition = response.headers.get("content-disposition") ?? "";
  const encoded = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  const fileName = encoded ? decodeURIComponent(encoded) : "fold-drawing.dxf";
  return {
    blob: await response.blob(),
    fileName,
    checksumSha256: response.headers.get("x-dxf-checksum-sha256"),
    assetId: response.headers.get("x-file-asset-id"),
  };
}
