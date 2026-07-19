"use client";

import { useState } from "react";

import { copyText } from "@/components/admin/admin-api";

export function OneTimeUrl({
  title,
  url,
  onClose,
}: {
  title: string;
  url: string;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);

  return (
    <section
      aria-live="polite"
      className="rounded-md border border-amber-300 bg-amber-50 p-4"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="font-bold text-amber-950">{title}</h3>
          <p className="mt-1 text-xs text-amber-800">
            이 주소는 지금 한 번만 표시됩니다. 필요한 곳에 안전하게 전달해
            주세요.
          </p>
        </div>
        <button
          className="text-sm font-semibold text-amber-900 underline"
          onClick={onClose}
          type="button"
        >
          닫기
        </button>
      </div>
      <div className="mt-3 flex gap-2">
        <input
          aria-label={title}
          className="min-w-0 flex-1 rounded border border-amber-300 bg-white px-3 py-2 font-mono text-xs"
          readOnly
          value={url}
        />
        <button
          className="rounded bg-amber-800 px-3 py-2 text-sm font-bold text-white"
          onClick={async () => {
            await copyText(url);
            setCopied(true);
          }}
          type="button"
        >
          {copied ? "복사됨" : "복사"}
        </button>
      </div>
    </section>
  );
}
