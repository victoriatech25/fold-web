"use client";
type Envelope<T> = { data?: T; error?: { code?: string; message?: string } };
export class MaterialRequestError extends Error { constructor(message: string, readonly code: string, readonly status: number) { super(message); this.name = "MaterialRequestError"; } }
export async function materialRequest<T>(url: string, init?: RequestInit): Promise<T> { const response = await fetch(url, { ...init, headers: init?.body ? { "Content-Type": "application/json", ...init.headers } : init?.headers }); const envelope = await response.json() as Envelope<T>; if (!response.ok || envelope.data === undefined) throw new MaterialRequestError(envelope.error?.message ?? "요청을 처리하지 못했습니다.", envelope.error?.code ?? "UNKNOWN", response.status); return envelope.data; }
