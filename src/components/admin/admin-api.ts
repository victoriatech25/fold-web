"use client";

type ApiEnvelope<T> = {
  data?: T;
  error?: {
    message?: string;
  };
};

export async function adminRequest<T>(
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
    throw new Error(
      envelope.error?.message ?? "요청을 처리하지 못했습니다.",
    );
  }
  return envelope.data;
}

export async function copyText(value: string): Promise<void> {
  await navigator.clipboard.writeText(value);
}
