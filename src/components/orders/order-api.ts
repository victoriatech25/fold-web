"use client";

type ApiEnvelope<T> = {
  data?: T;
  error?: { code?: string; message?: string; details?: unknown };
};

export class OrderRequestError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "OrderRequestError";
  }
}

export async function orderRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: init?.body
      ? { "Content-Type": "application/json", ...init.headers }
      : init?.headers,
  });
  const envelope = (await response.json()) as ApiEnvelope<T>;
  if (!response.ok || envelope.data === undefined) {
    throw new OrderRequestError(
      envelope.error?.message ?? "요청을 처리하지 못했습니다.",
      envelope.error?.code ?? "UNKNOWN",
      response.status,
      envelope.error?.details,
    );
  }
  return envelope.data;
}
