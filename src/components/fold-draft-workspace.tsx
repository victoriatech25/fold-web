"use client";

import {
  AlertTriangle,
  Copy,
  Download,
  FolderOpen,
  Plus,
  RefreshCw,
  Save,
  Trash2,
  X,
} from "lucide-react";
import { reaction } from "mobx";
import { observer } from "mobx-react-lite";
import { useCallback, useEffect, useRef, useState } from "react";

import { CanvasWorkspace } from "@/components/canvas-workspace";
import { CommonDialog, useCommonPopup } from "@/components/ui/common-popup";
import {
  FoldDraftAutosaveController,
  type FoldDraftSaveStatus,
} from "@/client/fold-draft/autosave";
import {
  createFoldDraft,
  deleteFoldDraft,
  exportFoldDraftDxf,
  FoldDraftApiError,
  getFoldDraft,
  listFoldDrafts,
  listFoldMaterialOptions,
  updateFoldDraft,
} from "@/client/fold-draft/fold-draft-api";
import {
  deleteFoldDraftRecovery,
  getFoldDraftRecovery,
  putFoldDraftRecovery,
  type FoldDraftRecoveryRecord,
} from "@/client/fold-draft/recovery-store";
import {
  browserFoldProfileV4ToServerDocumentV3,
  serverDocumentToBrowserFoldProfileV4,
} from "@/domain/fold-document/adapter";
import {
  createFoldBlock,
  createFoldProfile,
  type CalculationSettings,
  type MaterialSnapshot,
  type ProfileType,
} from "@/domain/fold-profile";
import type {
  FoldDraftDetailDto,
  FoldDraftSummaryDto,
  FoldMaterialOptionDto,
} from "@/server/fold-draft/fold-draft-types";
import { foldEditorStore } from "@/stores/fold-editor-store";

type FoldDraftWorkspaceProps = {
  initialDraftId: string | null;
  identity: {
    organizationId: string;
    userId: string;
  };
  canEdit: boolean;
};

const initialStatus: FoldDraftSaveStatus = {
  kind: "clean",
  message: "서버 초안을 선택하세요",
};

function materialFromOption(option: FoldMaterialOptionDto): MaterialSnapshot {
  return {
    id: option.ruleRevisionId,
    name: option.material.name,
    thickness: Number(option.material.thicknessMm),
    insideBendRadius: Number(option.material.insideBendRadiusMm),
    cutAngle: Number(option.material.cutAngleDeg),
    elongation: {
      "v-cut": Number(option.material.elongationMm.vCut),
      "a-cut": Number(option.material.elongationMm.aCut),
      "no-cut": Number(option.material.elongationMm.noCut),
    },
    cutDepth: {
      "v-cut": Number(option.material.cutDepthMm.vCut),
      "a-cut": Number(option.material.cutDepthMm.aCut),
      "no-cut": Number(option.material.cutDepthMm.noCut),
    },
  };
}

function calculationFromOption(
  option: FoldMaterialOptionDto,
): CalculationSettings {
  return {
    mode: option.calculation.mode,
    elongationOption: option.calculation.elongationOption,
    vCutEnabled: option.calculation.vCutEnabled,
    decimalPlaces: option.calculation.decimalPlaces,
    decimalOperation: option.calculation.decimalOperation,
  };
}

function profileFromDetail(detail: FoldDraftDetailDto) {
  return serverDocumentToBrowserFoldProfileV4(detail.document, {
    id: detail.draftId,
    createdAt: detail.createdAt,
    updatedAt: detail.updatedAt,
  });
}

function statusClass(kind: FoldDraftSaveStatus["kind"]): string {
  if (kind === "clean") return "bg-emerald-50 text-emerald-800";
  if (kind === "dirty" || kind === "saving") {
    return "bg-blue-50 text-blue-800";
  }
  if (kind === "conflict" || kind === "invalid") {
    return "bg-red-50 text-red-800";
  }
  return "bg-amber-50 text-amber-800";
}

export const FoldDraftWorkspace = observer(function FoldDraftWorkspace({
  initialDraftId,
  identity,
  canEdit,
}: FoldDraftWorkspaceProps) {
  const { alert: alertPopup, confirm: confirmPopup } = useCommonPopup();
  const controllerRef = useRef<FoldDraftAutosaveController | null>(null);
  const initialLoadHandledRef = useRef(false);
  const suppressReactionRef = useRef(false);
  const statusRef = useRef<FoldDraftSaveStatus>(initialStatus);
  const [detail, setDetail] = useState<FoldDraftDetailDto | null>(null);
  const [saveStatus, setSaveStatusState] =
    useState<FoldDraftSaveStatus>(initialStatus);
  const [materialOptions, setMaterialOptions] = useState<FoldMaterialOptionDto[]>([]);
  const [recentDrafts, setRecentDrafts] = useState<FoldDraftSummaryDto[]>([]);
  const [recentOpen, setRecentOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("새 절곡 초안");
  const [newType, setNewType] = useState<ProfileType>("normal");
  const [newMaterialId, setNewMaterialId] = useState("");
  const [newSheetItemId, setNewSheetItemId] = useState("");
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [recovery, setRecovery] = useState<FoldDraftRecoveryRecord | null>(null);
  const [recoveryError, setRecoveryError] = useState<string | null>(null);

  const setSaveStatus = useCallback((status: FoldDraftSaveStatus) => {
    statusRef.current = status;
    setSaveStatusState(status);
  }, []);

  const recoveryIdentity = useCallback(
    (draftId: string) => ({ ...identity, draftId }),
    [identity],
  );

  const synchronizeServerDetail = useCallback((saved: FoldDraftDetailDto) => {
    suppressReactionRef.current = true;
    foldEditorStore.synchronizeProfile(profileFromDetail(saved));
    suppressReactionRef.current = false;
    setDetail(saved);
  }, []);

  const installDetail = useCallback(
    async (loaded: FoldDraftDetailDto, checkRecovery: boolean) => {
      controllerRef.current?.stop();
      suppressReactionRef.current = true;
      foldEditorStore.loadProfile(profileFromDetail(loaded), !canEdit, true);
      suppressReactionRef.current = false;
      setDetail(loaded);
      setRecovery(null);
      setLoadError(null);

      if (canEdit) {
        controllerRef.current = new FoldDraftAutosaveController({
          initial: loaded,
          save: ({ expectedLockVersion, document }) =>
            updateFoldDraft({
              draftId: loaded.draftId,
              expectedLockVersion,
              document,
            }),
          writeRecovery: async (input) => {
            try {
              await putFoldDraftRecovery({
                ...recoveryIdentity(loaded.draftId),
                ...input,
              });
              setRecoveryError(null);
            } catch {
              setRecoveryError("브라우저 복구본을 저장하지 못했습니다.");
            }
          },
          deleteRecovery: async () => {
            try {
              await deleteFoldDraftRecovery(
                recoveryIdentity(loaded.draftId),
              );
            } catch {
              setRecoveryError("브라우저 복구본을 정리하지 못했습니다.");
            }
          },
          onStatus: setSaveStatus,
          onServerDocument: synchronizeServerDetail,
        });
      } else {
        controllerRef.current = null;
        setSaveStatus({ kind: "clean", message: "조회 전용" });
      }

      if (!checkRecovery || !canEdit) return;
      try {
        const record = await getFoldDraftRecovery(
          recoveryIdentity(loaded.draftId),
        );
        if (!record) return;
        if (record.localChecksum === loaded.checksumSha256) {
          await deleteFoldDraftRecovery(recoveryIdentity(loaded.draftId));
        } else {
          setRecovery(record);
        }
      } catch {
        setRecoveryError("브라우저 복구본을 확인하지 못했습니다.");
      }
    },
    [
      canEdit,
      recoveryIdentity,
      setSaveStatus,
      synchronizeServerDetail,
    ],
  );

  const openDraft = useCallback(
    async (draftId: string, checkRecovery = true) => {
      const state = statusRef.current.kind;
      if (
        detail &&
        detail.draftId !== draftId &&
        state !== "clean" &&
        !(await confirmPopup({
          title: "다른 초안 열기",
          message: "저장되지 않은 변경이 있습니다. 현재 변경을 남겨두고 다른 초안을 여시겠습니까?",
          confirmText: "다른 초안 열기",
          variant: "warning",
        }))
      ) {
        return;
      }
      setBusy(true);
      try {
        const loaded = await getFoldDraft(draftId);
        await installDetail(loaded, checkRecovery);
        setRecentOpen(false);
        window.history.replaceState(
          null,
          "",
          `/fold-editor?draft=${encodeURIComponent(draftId)}`,
        );
      } catch (error) {
        setLoadError(
          error instanceof Error ? error.message : "초안을 열지 못했습니다.",
        );
      } finally {
        setBusy(false);
      }
    },
    [confirmPopup, detail, installDetail],
  );

  useEffect(() => {
    if (!detail) foldEditorStore.setReadOnly(!canEdit);
  }, [canEdit, detail]);

  useEffect(() => {
    void listFoldMaterialOptions()
      .then((options) => {
        setMaterialOptions(options);
        setNewMaterialId((current) => {
          const next = current || options[0]?.ruleRevisionId || "";
          const option = options.find((item) => item.ruleRevisionId === next);
          setNewSheetItemId(option?.defaultSheetItemId ?? option?.sheetItems[0]?.sheetItemId ?? "");
          return next;
        });
      })
      .catch((error) => {
        setLoadError(
          error instanceof Error ? error.message : "재질 기준을 불러오지 못했습니다.",
        );
      });
  }, []);

  useEffect(() => {
    if (initialLoadHandledRef.current) return;
    initialLoadHandledRef.current = true;
    if (initialDraftId) {
      void openDraft(initialDraftId);
    }
  }, [initialDraftId, openDraft]);

  useEffect(() => {
    const dispose = reaction(
      () => JSON.stringify(foldEditorStore.profile),
      () => {
        const controller = controllerRef.current;
        if (!controller || suppressReactionRef.current || !canEdit) return;
        try {
          controller.update(
            browserFoldProfileV4ToServerDocumentV3(
              foldEditorStore.profile,
              foldEditorStore.profile.material.id,
            ),
          );
        } catch (error) {
          controller.invalidate(
            error instanceof Error
              ? error.message
              : "저장할 수 없는 편집 값이 있습니다.",
          );
        }
      },
    );
    return dispose;
  }, [canEdit]);

  useEffect(() => {
    const onOnline = () => controllerRef.current?.resume();
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (statusRef.current.kind !== "clean") event.preventDefault();
    };
    window.addEventListener("online", onOnline);
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("beforeunload", onBeforeUnload);
      controllerRef.current?.stop();
    };
  }, []);

  async function showRecentDrafts() {
    setBusy(true);
    try {
      const result = await listFoldDrafts();
      setRecentDrafts(result.items);
      setRecentOpen(true);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "초안 목록을 불러오지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function createNewDraft() {
    const name = newName.trim();
    const option = materialOptions.find(
      (item) => item.ruleRevisionId === newMaterialId,
    );
    if (!name || !option) return;
    setBusy(true);
    try {
      const draftId = crypto.randomUUID();
      const profile = createFoldProfile({
        id: draftId,
        name,
        profileType: newType,
        material: materialFromOption(option),
        calculation: calculationFromOption(option),
        sheetItemSnapshot: option.sheetItems.find((sheet) => sheet.sheetItemId === newSheetItemId),
      });
      if (newType === "box") profile.blocks.push(createFoldBlock(2));
      const created = await createFoldDraft({
        draftId,
        document: browserFoldProfileV4ToServerDocumentV3(
          profile,
          option.ruleRevisionId,
        ),
      });
      await installDetail(created, false);
      setCreateOpen(false);
      window.history.replaceState(
        null,
        "",
        `/fold-editor?draft=${encodeURIComponent(draftId)}`,
      );
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "새 초안을 만들지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function removeCurrentDraft() {
    if (!detail || !canEdit) return;
    if (!(await confirmPopup({
      title: "초안 삭제",
      message: `'${detail.name}' 초안을 삭제하시겠습니까? 삭제한 작업 초안은 목록에서 복원할 수 없습니다.`,
      confirmText: "삭제",
      variant: "danger",
    }))) return;
    setBusy(true);
    try {
      await deleteFoldDraft({
        draftId: detail.draftId,
        expectedLockVersion: controllerRef.current?.currentLockVersion ?? detail.lockVersion,
      });
      controllerRef.current?.stop();
      await deleteFoldDraftRecovery(recoveryIdentity(detail.draftId)).catch(() => undefined);
      setDetail(null);
      setSaveStatus(initialStatus);
      foldEditorStore.loadProfile(createFoldProfile(), false, false);
      window.history.replaceState(null, "", "/fold-editor");
    } catch (error) {
      if (error instanceof FoldDraftApiError && error.status === 409) {
        setSaveStatus({
          kind: "conflict",
          message: error.message,
          conflict: error.conflict,
          requestId: error.requestId,
        });
      } else {
        setLoadError(error instanceof Error ? error.message : "초안을 삭제하지 못했습니다.");
      }
    } finally {
      setBusy(false);
    }
  }

  async function downloadCurrentDxf() {
    if (!detail) return;
    setBusy(true);
    try {
      if (canEdit) await controllerRef.current?.flush();
      if (statusRef.current.kind !== "clean") {
        throw new Error("초안 저장을 완료한 뒤 다시 출력해 주세요.");
      }
      const result = await exportFoldDraftDxf(detail.draftId);
      const url = URL.createObjectURL(result.blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = result.fileName;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      await alertPopup({
        title: "DXF 생성 완료",
        message: `${result.fileName} 파일을 내려받았습니다.\nSHA-256: ${result.checksumSha256 ?? "확인 불가"}`,
        confirmText: "확인",
        variant: "info",
      });
    } catch (error) {
      await alertPopup({
        title: "DXF 생성 실패",
        message: error instanceof Error ? error.message : "DXF를 생성하지 못했습니다.",
        confirmText: "확인",
        variant: "danger",
      });
    } finally {
      setBusy(false);
    }
  }

  async function reloadServerVersion() {
    if (!detail) return;
    if (!(await confirmPopup({
      title: "서버본 다시 읽기",
      message: "현재 로컬 변경을 버리고 마지막으로 저장된 서버 버전을 다시 불러오시겠습니까?",
      confirmText: "서버본 읽기",
      variant: "danger",
    }))) return;
    await deleteFoldDraftRecovery(recoveryIdentity(detail.draftId)).catch(() => undefined);
    await openDraft(detail.draftId, false);
  }

  async function copyLocalAsNewDraft() {
    const controller = controllerRef.current;
    if (!controller) return;
    setBusy(true);
    try {
      const draftId = crypto.randomUUID();
      const copied = await createFoldDraft({
        draftId,
        document: controller.currentDocument,
      });
      await installDetail(copied, false);
      window.history.replaceState(
        null,
        "",
        `/fold-editor?draft=${encodeURIComponent(draftId)}`,
      );
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "새 초안으로 복사하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  function applyRecovery() {
    if (!recovery || !detail || !controllerRef.current) return;
    suppressReactionRef.current = true;
    foldEditorStore.synchronizeProfile(
      serverDocumentToBrowserFoldProfileV4(recovery.document, {
        id: detail.draftId,
        createdAt: detail.createdAt,
        updatedAt: recovery.savedAt,
      }),
    );
    suppressReactionRef.current = false;
    controllerRef.current.restore(
      recovery.document,
      recovery.baseLockVersion,
      recovery.baseChecksum,
    );
    setRecovery(null);
  }

  async function discardRecovery() {
    if (!detail) return;
    await deleteFoldDraftRecovery(recoveryIdentity(detail.draftId)).catch(() => undefined);
    setRecovery(null);
  }

  function applyMaterial(ruleRevisionId: string) {
    const option = materialOptions.find(
      (item) => item.ruleRevisionId === ruleRevisionId,
    );
    if (!option) return;
    foldEditorStore.applyServerMaterial(
      materialFromOption(option),
      calculationFromOption(option),
    );
    foldEditorStore.applyServerSheet(
      option.sheetItems.find((sheet) => sheet.sheetItemId === option.defaultSheetItemId)
        ?? option.sheetItems[0],
    );
  }

  function applySheet(sheetItemId: string) {
    const option = materialOptions.find((item) => item.ruleRevisionId === foldEditorStore.profile.material.id);
    foldEditorStore.applyServerSheet(option?.sheetItems.find((sheet) => sheet.sheetItemId === sheetItemId));
  }

  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col">
      <section className="mb-3 shrink-0 border border-slate-300 bg-white p-3 shadow-sm">
        <div className="flex flex-wrap items-end gap-2">
          <label className="min-w-[180px] flex-1 text-xs font-semibold text-slate-600">
            초안 이름
            <input
              aria-label="초안 이름"
              value={detail ? foldEditorStore.profile.name : "저장되지 않은 예제"}
              disabled={!detail || !canEdit}
              maxLength={200}
              onChange={(event) => foldEditorStore.setProfileName(event.target.value)}
              className="field-control mt-1 disabled:bg-slate-100"
            />
          </label>
          <label className="w-[190px] min-w-[170px] text-xs font-semibold text-slate-600">
            서버 재질 기준
            <select
              aria-label="서버 재질 기준"
              value={detail ? foldEditorStore.profile.material.id : ""}
              disabled={!detail || !canEdit || materialOptions.length === 0}
              onChange={(event) => applyMaterial(event.target.value)}
              className="field-control mt-1 bg-white disabled:bg-slate-100"
            >
              {!detail ? <option value="">초안을 먼저 생성하세요</option> : null}
              {materialOptions.map((option) => (
                <option key={option.ruleRevisionId} value={option.ruleRevisionId}>
                  {option.name} · r{option.revisionNumber}
                </option>
              ))}
            </select>
          </label>
          <label className="w-[220px] min-w-[190px] text-xs font-semibold text-slate-600">
            서버 원판 기준
            <select
              aria-label="서버 원판 기준"
              value={detail ? foldEditorStore.profile.sheetItemSnapshot?.sheetItemId ?? "" : ""}
              disabled={!detail || !canEdit}
              onChange={(event) => applySheet(event.target.value)}
              className="field-control mt-1 bg-white disabled:bg-slate-100"
            >
              <option value="">원판 미지정</option>
              {(materialOptions.find((option) => option.ruleRevisionId === foldEditorStore.profile.material.id)?.sheetItems ?? []).map((sheet) => (
                <option key={sheet.sheetItemId} value={sheet.sheetItemId}>{sheet.name} · {sheet.widthMm}×{sheet.lengthMm}</option>
              ))}
            </select>
          </label>
          <span
            role="status"
            className={`inline-flex h-9 items-center rounded px-3 text-xs font-bold ${statusClass(saveStatus.kind)}`}
          >
            {saveStatus.message}
          </span>
          <button
            type="button"
            disabled={!detail || !canEdit || busy}
            onClick={() => void controllerRef.current?.flush()}
            className="inline-flex h-9 items-center gap-1.5 rounded border border-slate-300 px-3 text-xs font-bold text-slate-700 disabled:opacity-40"
          >
            <Save size={15} /> 지금 저장
          </button>
          <button
            type="button"
            disabled={!detail || busy}
            onClick={() => void downloadCurrentDxf()}
            className="inline-flex h-9 items-center gap-1.5 rounded border border-teal-300 bg-teal-50 px-3 text-xs font-bold text-teal-800 disabled:opacity-40"
          >
            <Download size={15} /> DXF 출력
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void showRecentDrafts()}
            className="inline-flex h-9 items-center gap-1.5 rounded border border-slate-300 px-3 text-xs font-bold text-slate-700 disabled:opacity-40"
          >
            <FolderOpen size={15} /> 최근 초안
          </button>
          {canEdit ? (
            <button
              type="button"
              disabled={busy || materialOptions.length === 0}
              onClick={() => setCreateOpen(true)}
              className="inline-flex h-9 items-center gap-1.5 rounded bg-teal-700 px-3 text-xs font-bold text-white disabled:opacity-40"
            >
              <Plus size={15} /> 새 초안
            </button>
          ) : null}
          {detail && canEdit ? (
            <button
              type="button"
              disabled={busy}
              aria-label="현재 초안 삭제"
              onClick={() => void removeCurrentDraft()}
              className="inline-flex h-9 w-9 items-center justify-center rounded border border-red-200 text-red-700 disabled:opacity-40"
            >
              <Trash2 size={15} />
            </button>
          ) : null}
        </div>
        {detail ? (
          <p className="mt-2 text-[11px] text-slate-500">
            버전 {controllerRef.current?.currentLockVersion ?? detail.lockVersion} · 마지막 수정 {new Date(detail.updatedAt).toLocaleString("ko-KR")}
          </p>
        ) : (
          <p className="mt-2 text-[11px] text-amber-700">
            현재 예제는 서버에 저장되지 않습니다. 새 초안을 생성해 작업을 시작하세요.
          </p>
        )}
      </section>

      {loadError ? (
        <div className="mb-3 flex items-center justify-between rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          <span>{loadError}</span>
          <button type="button" aria-label="오류 닫기" onClick={() => setLoadError(null)}><X size={16} /></button>
        </div>
      ) : null}
      {recoveryError ? (
        <div className="mb-3 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          {recoveryError} 서버 자동 저장은 계속 시도합니다.
        </div>
      ) : null}
      {recovery ? (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950">
          <AlertTriangle size={17} />
          <span className="mr-auto">{new Date(recovery.savedAt).toLocaleString("ko-KR")}의 미저장 복구본이 있습니다.</span>
          <button type="button" onClick={applyRecovery} className="rounded bg-amber-700 px-3 py-1.5 text-xs font-bold text-white">복구</button>
          <button type="button" onClick={() => void discardRecovery()} className="rounded border border-amber-400 px-3 py-1.5 text-xs font-bold">버리기</button>
        </div>
      ) : null}
      {saveStatus.kind === "conflict" ? (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded border border-red-300 bg-red-50 px-3 py-3 text-sm text-red-950">
          <AlertTriangle size={18} />
          <span className="mr-auto">다른 화면의 저장과 충돌했습니다. 자동 저장을 중지했습니다.</span>
          <button type="button" onClick={() => void reloadServerVersion()} className="inline-flex items-center gap-1 rounded border border-red-300 px-3 py-1.5 text-xs font-bold"><RefreshCw size={14} /> 서버본 다시 읽기</button>
          <button type="button" onClick={() => void copyLocalAsNewDraft()} className="inline-flex items-center gap-1 rounded bg-red-700 px-3 py-1.5 text-xs font-bold text-white"><Copy size={14} /> 새 초안으로 복사</button>
        </div>
      ) : null}

      <CanvasWorkspace readOnly={!canEdit && Boolean(detail)} />
      </div>

      <CommonDialog
        closeLabel="최근 초안 닫기"
        onClose={() => setRecentOpen(false)}
        open={recentOpen}
        size="lg"
        title="최근 절곡 초안"
      >
        <div className="divide-y divide-slate-100">
          {recentDrafts.length === 0 ? <p className="p-6 text-center text-sm text-slate-500">저장된 초안이 없습니다.</p> : recentDrafts.map((draft) => (
            <button key={draft.draftId} type="button" onClick={() => void openDraft(draft.draftId)} className="block w-full p-4 text-left hover:bg-slate-50">
              <span className="block text-sm font-bold text-slate-900">{draft.name}</span>
              <span className="mt-1 block text-xs text-slate-500">{draft.documentType === "box" ? "박스" : "일반"} · v{draft.lockVersion} · {new Date(draft.updatedAt).toLocaleString("ko-KR")}</span>
            </button>
          ))}
        </div>
      </CommonDialog>

      <CommonDialog
        closeLabel="새 초안 닫기"
        footer={<>
          <button type="button" onClick={() => setCreateOpen(false)} className="rounded border border-slate-300 px-4 py-2 text-xs font-bold">취소</button>
          <button type="button" disabled={busy || !newName.trim() || !newMaterialId} onClick={() => void createNewDraft()} className="rounded bg-teal-700 px-4 py-2 text-xs font-bold text-white disabled:opacity-40">생성</button>
        </>}
        onClose={() => setCreateOpen(false)}
        open={createOpen}
        title="새 절곡 초안"
      >
        <div className="space-y-4">
          <label className="block text-xs font-semibold text-slate-600">이름<input aria-label="새 초안 이름" value={newName} maxLength={200} onChange={(event) => setNewName(event.target.value)} className="field-control mt-1" /></label>
          <label className="block text-xs font-semibold text-slate-600">도면 타입<select aria-label="새 초안 도면 타입" value={newType} onChange={(event) => setNewType(event.target.value as ProfileType)} className="field-control mt-1 bg-white"><option value="normal">일반</option><option value="box">박스</option></select></label>
          <label className="block text-xs font-semibold text-slate-600">재질 기준<select aria-label="새 초안 재질 기준" value={newMaterialId} onChange={(event) => { const value = event.target.value; setNewMaterialId(value); const option = materialOptions.find((item) => item.ruleRevisionId === value); setNewSheetItemId(option?.defaultSheetItemId ?? option?.sheetItems[0]?.sheetItemId ?? ""); }} className="field-control mt-1 bg-white">{materialOptions.map((option) => <option key={option.ruleRevisionId} value={option.ruleRevisionId}>{option.name} · r{option.revisionNumber}</option>)}</select></label>
          <label className="block text-xs font-semibold text-slate-600">원판 기준<select aria-label="새 초안 원판 기준" value={newSheetItemId} onChange={(event) => setNewSheetItemId(event.target.value)} className="field-control mt-1 bg-white"><option value="">원판 미지정</option>{(materialOptions.find((option) => option.ruleRevisionId === newMaterialId)?.sheetItems ?? []).map((sheet) => <option key={sheet.sheetItemId} value={sheet.sheetItemId}>{sheet.name} · {sheet.widthMm}×{sheet.lengthMm}</option>)}</select></label>
        </div>
      </CommonDialog>
    </>
  );
});
