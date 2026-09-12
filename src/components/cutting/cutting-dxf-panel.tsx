"use client";

import { useCallback, useEffect, useState } from "react";

import { useCommonPopup } from "@/components/ui/common-popup";
import type { CuttingDxfFileDto } from "@/server/cutting/cutting-dxf-service";
import { cuttingRequest } from "./cutting-plan-list-panel";

/**
 * 재단 개정의 원판 DXF(`P2-B11` 4.7). 생성은 큐 작업이라 걸어 두고 파일 목록을
 * 다시 읽는다. 내려받기는 파일 서비스의 presigned URL 로 한다.
 */
const kindLabels: Record<CuttingDxfFileDto["kind"], string> = {
  SHEET: "원판",
  LASER_GROUP: "레이저 그룹",
  ZIP: "전체 zip",
};

export function CuttingDxfPanel({
  planId,
  revisionId,
  revisionNumber,
  canGenerate,
}: {
  planId: string;
  revisionId: string;
  revisionNumber: number;
  canGenerate: boolean;
}) {
  const popup = useCommonPopup();
  const [files, setFiles] = useState<CuttingDxfFileDto[] | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    const outcome = await cuttingRequest<{ files: CuttingDxfFileDto[] }>(
      `/api/v1/cutting-plans/${planId}/revisions/${revisionId}/dxf`,
    );
    setFiles(outcome.files);
    return outcome.files;
  }, [planId, revisionId]);

  useEffect(() => {
    // 목록을 못 읽어도 화면은 서야 한다. 빈 목록으로 두고 생성 버튼은 남긴다.
    const timer = setTimeout(() => {
      void refresh().catch(() => setFiles((current) => current ?? []));
    }, 0);
    return () => clearTimeout(timer);
  }, [refresh]);

  // 생성을 걸어 둔 동안 2초마다 목록을 다시 읽는다. 파일이 생기면 멈춘다.
  useEffect(() => {
    if (!pending) return;
    const timer = setInterval(() => {
      void refresh()
        .then((list) => {
          if (list.length > 0) setPending(false);
        })
        .catch(() => undefined);
    }, 2_000);
    const stop = setTimeout(() => setPending(false), 120_000);
    return () => {
      clearInterval(timer);
      clearTimeout(stop);
    };
  }, [pending, refresh]);

  async function generate() {
    setError("");
    try {
      await cuttingRequest(`/api/v1/cutting-plans/${planId}/revisions/${revisionId}/dxf`, { method: "POST", body: "{}" });
      setPending(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "DXF 생성을 걸지 못했습니다.");
    }
  }

  async function download(file: CuttingDxfFileDto) {
    try {
      const ticket = await cuttingRequest<{ download: { url: string } }>(`/api/v1/files/${file.assetId}/downloads`, {
        method: "POST",
      });
      window.open(ticket.download.url, "_blank", "noopener");
    } catch (caught) {
      await popup.alert({
        title: "내려받기 실패",
        message: caught instanceof Error ? caught.message : "파일을 내려받지 못했습니다.",
        variant: "danger",
      });
    }
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm" data-testid="cutting-dxf-panel">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-black">원판 DXF</h2>
        <span className="text-xs text-slate-500">개정 {revisionNumber} · 원판마다 파일 하나, 레이저 그룹마다 전개도 하나</span>
        {canGenerate ? (
          <button
            className="ml-auto rounded border border-teal-700 px-3 py-1 text-xs font-bold text-teal-800 disabled:opacity-50"
            data-testid="cutting-dxf-generate"
            disabled={pending}
            onClick={() => void generate()}
            type="button"
          >
            {pending ? "생성 중…" : files && files.length > 0 ? "다시 생성" : "DXF 생성"}
          </button>
        ) : null}
      </div>
      {error ? <p className="mt-2 text-xs font-bold text-red-800">{error}</p> : null}
      {files === null ? (
        <p className="mt-2 text-xs text-slate-500">파일 목록을 읽고 있습니다.</p>
      ) : files.length === 0 ? (
        <p className="mt-2 text-xs text-slate-500">
          {pending ? "worker 가 DXF 를 만들고 있습니다. 끝나면 여기에 나타납니다." : "아직 만든 DXF 가 없습니다."}
        </p>
      ) : (
        <ul className="mt-2 divide-y divide-slate-100 text-xs" data-testid="cutting-dxf-files">
          {files.map((file) => (
            <li className="flex items-center gap-2 py-1.5" key={file.assetId}>
              <span className="w-20 shrink-0 text-slate-500">{kindLabels[file.kind]}</span>
              <span className="font-mono">{file.fileName}</span>
              <span className="text-slate-400">{(file.sizeBytes / 1024).toFixed(1)} KB</span>
              {file.status === "READY" ? (
                <button className="ml-auto text-teal-800 underline" onClick={() => void download(file)} type="button">
                  내려받기
                </button>
              ) : (
                <span className="ml-auto text-amber-800">저장소에 보관되지 않았습니다. 다시 생성해 주세요.</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
