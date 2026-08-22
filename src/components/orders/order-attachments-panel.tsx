"use client";

import { Download, Paperclip, Trash2, Upload } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { orderRequest } from "@/components/orders/order-api";
import { useCommonPopup } from "@/components/ui/common-popup";
import type { FileAssetDto } from "@/server/files/file-service";

type UploadTicket = { file: FileAssetDto; upload: { url: string; expiresAt: string } };

/** 브라우저에서 checksum을 먼저 구해 서버에 알린다. 서버는 올라온 내용을 이 값과 대조한다. */
async function sha256(file: File): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

export function OrderAttachmentsPanel({
  editable,
  onCountChange,
  orderId,
}: {
  editable: boolean;
  onCountChange?: (count: number) => void;
  orderId: string;
}) {
  const popup = useCommonPopup();
  const inputRef = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<FileAssetDto[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const reload = useCallback(async () => {
    try {
      const result = await orderRequest<{ items: FileAssetDto[] }>(
        `/api/v1/orders/${orderId}/attachments`,
      );
      setItems(result.items);
      onCountChange?.(result.items.length);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "첨부 파일을 불러오지 못했습니다.");
    }
  }, [onCountChange, orderId]);

  useEffect(() => {
    // 첫 진입에서 한 번만 불러온다. 이후 갱신은 업로드·삭제가 직접 호출한다.
    void (async () => {
      await reload();
    })();
  }, [reload]);

  async function upload(file: File) {
    setBusy(true);
    setError("");
    try {
      const ticket = await orderRequest<UploadTicket>("/api/v1/files/uploads", {
        method: "POST",
        body: JSON.stringify({
          kind: "OTHER",
          fileName: file.name,
          mediaType: file.type || "application/octet-stream",
          sizeBytes: file.size,
          checksumSha256: await sha256(file),
          salesOrderId: orderId,
        }),
      });
      // presigned URL 로 바이트를 바로 올린다. 앱 서버를 거치지 않는다.
      const put = await fetch(ticket.upload.url, {
        method: "PUT",
        headers: { "content-type": file.type || "application/octet-stream" },
        body: file,
      });
      if (!put.ok) throw new Error("파일을 저장소에 올리지 못했습니다.");
      await orderRequest(`/api/v1/files/${ticket.file.id}/complete`, { method: "POST" });
      await reload();
      await popup.alert({ title: "첨부 완료", message: `${file.name} 파일을 첨부했습니다.` });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "파일을 첨부하지 못했습니다.");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function download(item: FileAssetDto) {
    try {
      const ticket = await orderRequest<{ download: { url: string } }>(
        `/api/v1/files/${item.id}/downloads`,
        { method: "POST" },
      );
      window.open(ticket.download.url, "_blank", "noopener");
    } catch (caught) {
      await popup.alert({
        title: "내려받기 실패",
        message: caught instanceof Error ? caught.message : "파일을 내려받지 못했습니다.",
        variant: "danger",
      });
    }
  }

  async function remove(item: FileAssetDto) {
    const confirmed = await popup.confirm({
      title: "첨부 파일 삭제",
      message: `${item.fileName} 파일을 삭제합니다. 30일 안에는 되돌릴 수 있습니다.`,
      confirmText: "삭제",
      variant: "danger",
    });
    if (!confirmed) return;
    setBusy(true);
    try {
      await orderRequest(`/api/v1/files/${item.id}`, { method: "DELETE" });
      await reload();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "파일을 삭제하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
        <div className="flex items-center gap-2">
          <Paperclip aria-hidden="true" className="h-4 w-4 text-teal-700" />
          <div>
            <h2 className="text-sm font-black text-slate-800">첨부 파일</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              도면 참고자료, 계약서 같은 파일을 수주에 붙입니다. pdf · png · jpg · txt, 20MB까지.
            </p>
          </div>
        </div>
        {editable ? (
          <>
            <input
              accept=".pdf,.png,.jpg,.jpeg,.txt"
              aria-label="첨부 파일 선택"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void upload(file);
              }}
              ref={inputRef}
              type="file"
            />
            <button
              className="inline-flex h-9 items-center gap-1.5 rounded bg-teal-700 px-4 text-xs font-bold text-white hover:bg-teal-800 disabled:opacity-50"
              disabled={busy}
              onClick={() => inputRef.current?.click()}
              type="button"
            >
              <Upload aria-hidden="true" className="h-3.5 w-3.5" />
              {busy ? "처리 중…" : "파일 첨부"}
            </button>
          </>
        ) : null}
      </div>

      {error ? (
        <p className="border-b border-red-200 bg-red-50 px-5 py-3 text-sm text-red-700" role="alert">
          {error}
        </p>
      ) : null}

      {items.length === 0 ? (
        <p className="px-5 py-12 text-center text-sm text-slate-500">
          첨부한 파일이 없습니다.
        </p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {items.map((item) => (
            <li className="flex flex-wrap items-center gap-3 px-5 py-3" key={item.id}>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-bold text-slate-800">{item.fileName}</span>
                <span className="mt-0.5 block text-xs text-slate-500">
                  {formatSize(item.sizeBytes)} · {new Date(item.createdAt).toLocaleString("ko-KR")}
                  {item.status === "PENDING" ? " · 업로드 미완료" : ""}
                </span>
              </span>
              <button
                className="inline-flex items-center gap-1 rounded border border-slate-300 px-3 py-1.5 text-xs font-bold disabled:opacity-50"
                disabled={item.status !== "READY"}
                onClick={() => void download(item)}
                type="button"
              >
                <Download aria-hidden="true" className="h-3.5 w-3.5" />
                내려받기
              </button>
              {editable ? (
                <button
                  aria-label={`${item.fileName} 삭제`}
                  className="inline-flex items-center gap-1 rounded border border-red-300 px-3 py-1.5 text-xs font-bold text-red-700 disabled:opacity-50"
                  disabled={busy}
                  onClick={() => void remove(item)}
                  type="button"
                >
                  <Trash2 aria-hidden="true" className="h-3.5 w-3.5" />
                  삭제
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
