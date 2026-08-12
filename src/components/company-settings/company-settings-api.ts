"use client";

type ApiEnvelope<T> = {
  data?: T;
  error?: { code?: string; message?: string };
};

export class CompanySettingsRequestError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "CompanySettingsRequestError";
  }
}

export async function companySettingsRequest<T>(
  url: string,
  init: RequestInit,
): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init.headers,
    },
  });
  const envelope = (await response.json()) as ApiEnvelope<T>;
  if (!response.ok || envelope.data === undefined) {
    throw new CompanySettingsRequestError(
      envelope.error?.message ?? "요청을 처리하지 못했습니다.",
      envelope.error?.code ?? "UNKNOWN",
      response.status,
    );
  }
  return envelope.data;
}
