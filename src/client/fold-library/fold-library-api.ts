import type {
  FoldCategoryDto,
  FoldRevisionDetailDto,
  FoldTemplateDetailDto,
  FoldTemplateListDto,
} from "@/server/fold-library/fold-library-types";

type ApiEnvelope<T> = { data: T };
type ApiErrorEnvelope = { error?: { code?: string; message?: string; requestId?: string } };

export class FoldLibraryApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly requestId?: string) {
    super(message);
    this.name = "FoldLibraryApiError";
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
    throw new FoldLibraryApiError(0, "NETWORK_ERROR", "서버에 연결할 수 없습니다.");
  }
  const body = (await response.json().catch(() => ({}))) as ApiEnvelope<T> | ApiErrorEnvelope;
  if (!response.ok || !("data" in body)) {
    const error = "error" in body ? body.error : undefined;
    throw new FoldLibraryApiError(
      response.status,
      error?.code ?? "UNKNOWN_ERROR",
      error?.message ?? "요청을 처리하지 못했습니다.",
      error?.requestId,
    );
  }
  return body.data;
}

export function listFoldCategories(includeInactive = false): Promise<FoldCategoryDto[]> {
  return request(`/api/v1/fold-categories?includeInactive=${includeInactive}`);
}

export function createFoldCategory(input: { name: string; sortOrder: number }): Promise<FoldCategoryDto> {
  return request("/api/v1/fold-categories", { method: "POST", body: JSON.stringify(input) });
}

export function updateFoldCategory(input: FoldCategoryDto): Promise<FoldCategoryDto> {
  return request(`/api/v1/fold-categories/${encodeURIComponent(input.id)}`, {
    method: "PATCH",
    body: JSON.stringify({
      name: input.name,
      sortOrder: input.sortOrder,
      active: input.active,
      expectedLockVersion: input.lockVersion,
    }),
  });
}

export type FoldTemplateFilters = {
  q?: string;
  categoryId?: string;
  status?: string;
  documentType?: string;
  cursor?: string;
};

export function listFoldTemplates(filters: FoldTemplateFilters = {}): Promise<FoldTemplateListDto> {
  const query = new URLSearchParams({ limit: "25" });
  for (const [key, value] of Object.entries(filters)) if (value) query.set(key, value);
  return request(`/api/v1/fold-templates?${query}`);
}

export function getFoldTemplate(templateId: string): Promise<FoldTemplateDetailDto> {
  return request(`/api/v1/fold-templates/${encodeURIComponent(templateId)}`);
}

export function updateFoldTemplate(input: {
  templateId: string;
  name: string;
  categoryId: string | null;
  expectedLockVersion: number;
}): Promise<FoldTemplateDetailDto> {
  return request(`/api/v1/fold-templates/${encodeURIComponent(input.templateId)}`, {
    method: "PATCH",
    body: JSON.stringify({
      name: input.name,
      categoryId: input.categoryId,
      expectedLockVersion: input.expectedLockVersion,
    }),
  });
}

export function getFoldRevision(revisionId: string): Promise<FoldRevisionDetailDto> {
  return request(`/api/v1/fold-revisions/${encodeURIComponent(revisionId)}`);
}

export function copyFoldTemplate(input: {
  sourceRevisionId: string;
  draftId: string;
  name: string;
  categoryId: string | null;
  targetDocumentType?: "panel";
}): Promise<FoldTemplateDetailDto> {
  return request("/api/v1/fold-templates/copies", { method: "POST", body: JSON.stringify(input) });
}

export function createNextFoldRevision(input: {
  templateId: string;
  sourceRevisionId: string;
  draftId: string;
}): Promise<FoldTemplateDetailDto> {
  return request(`/api/v1/fold-templates/${encodeURIComponent(input.templateId)}/revisions`, {
    method: "POST",
    body: JSON.stringify({ sourceRevisionId: input.sourceRevisionId, draftId: input.draftId }),
  });
}

const transitionPaths = {
  review: "review-requests",
  return: "returns",
  publish: "publications",
  retire: "retirements",
} as const;

export function transitionFoldRevision(input: {
  revisionId: string;
  expectedLockVersion: number;
  action: keyof typeof transitionPaths | "discard";
}): Promise<FoldTemplateDetailDto> {
  const base = `/api/v1/fold-revisions/${encodeURIComponent(input.revisionId)}`;
  return request(input.action === "discard" ? base : `${base}/${transitionPaths[input.action]}`, {
    method: input.action === "discard" ? "DELETE" : "POST",
    body: JSON.stringify({ expectedLockVersion: input.expectedLockVersion }),
  });
}
