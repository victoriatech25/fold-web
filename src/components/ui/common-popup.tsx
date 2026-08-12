"use client";

import { X } from "lucide-react";
import {
  createContext,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

export type CommonPopupVariant = "info" | "warning" | "danger";

type CommonPopupBase = {
  title: string;
  message: string;
  confirmText?: string;
  variant?: CommonPopupVariant;
};

export type CommonAlertOptions = CommonPopupBase;
export type CommonConfirmOptions = CommonPopupBase & { cancelText?: string };
export type CommonPromptOptions = CommonPopupBase & {
  cancelText?: string;
  defaultValue?: string;
  inputLabel: string;
  maxLength?: number;
  placeholder?: string;
  required?: boolean;
};

type PopupRequest =
  | { kind: "alert"; options: CommonAlertOptions; resolve: () => void }
  | { kind: "confirm"; options: CommonConfirmOptions; resolve: (confirmed: boolean) => void }
  | { kind: "prompt"; options: CommonPromptOptions; resolve: (value: string | null) => void };

type CommonPopupApi = {
  alert: (options: CommonAlertOptions) => Promise<void>;
  confirm: (options: CommonConfirmOptions) => Promise<boolean>;
  prompt: (options: CommonPromptOptions) => Promise<string | null>;
};

const CommonPopupContext = createContext<CommonPopupApi | null>(null);

const confirmColor: Record<CommonPopupVariant, string> = {
  info: "bg-teal-700 hover:bg-teal-800",
  warning: "bg-amber-600 hover:bg-amber-700",
  danger: "bg-red-700 hover:bg-red-800",
};

export function CommonDialog({
  children,
  closeLabel = "닫기",
  description,
  footer,
  initialFocusRef,
  onClose,
  open,
  size = "md",
  title,
  type = "dialog",
}: {
  children: ReactNode;
  closeLabel?: string;
  description?: string;
  footer?: ReactNode;
  initialFocusRef?: RefObject<HTMLElement | null>;
  onClose: () => void;
  open: boolean;
  size?: "sm" | "md" | "lg" | "xl";
  title: string;
  type?: "dialog" | "alertdialog";
}) {
  const titleId = useId();
  const descriptionId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const timer = window.setTimeout(() => {
      const target = initialFocusRef?.current ?? panelRef.current?.querySelector<HTMLElement>(
        "button, input, select, textarea, [tabindex]:not([tabindex='-1'])",
      );
      target?.focus();
    }, 0);
    return () => {
      window.clearTimeout(timer);
      document.body.style.overflow = previousOverflow;
      returnFocusRef.current?.focus();
    };
  }, [initialFocusRef, open]);

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== "Tab" || !panelRef.current) return;
    const focusable = [...panelRef.current.querySelectorAll<HTMLElement>(
      "button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex='-1'])",
    )];
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable.at(-1)!;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  if (!open || typeof document === "undefined") return null;
  const sizeClass = { sm: "max-w-sm", md: "max-w-md", lg: "max-w-2xl", xl: "max-w-4xl" }[size];
  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/55 p-4">
      <div
        aria-describedby={description ? descriptionId : undefined}
        aria-labelledby={titleId}
        aria-modal="true"
        className={`max-h-[90vh] w-full ${sizeClass} overflow-hidden rounded-lg border border-slate-200 bg-white shadow-2xl`}
        onKeyDown={handleKeyDown}
        ref={panelRef}
        role={type}
      >
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
          <div>
            <h2 className="font-black text-slate-950" id={titleId}>{title}</h2>
            {description ? <p className="mt-1 text-sm text-slate-600" id={descriptionId}>{description}</p> : null}
          </div>
          <button aria-label={closeLabel} className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-900" onClick={onClose} type="button">
            <X size={18} />
          </button>
        </div>
        <div className="max-h-[65vh] overflow-auto px-5 py-4">{children}</div>
        {footer ? <div className="flex justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-3">{footer}</div> : null}
      </div>
    </div>,
    document.body,
  );
}

export function CommonPopupProvider({ children }: { children: ReactNode }) {
  const [current, setCurrent] = useState<PopupRequest | null>(null);
  const [promptValue, setPromptValue] = useState("");
  const [promptError, setPromptError] = useState("");
  const queueRef = useRef<PopupRequest[]>([]);
  const currentRef = useRef<PopupRequest | null>(null);
  const promptRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);

  const activate = useCallback((request: PopupRequest) => {
    currentRef.current = request;
    setPromptValue(request.kind === "prompt" ? request.options.defaultValue ?? "" : "");
    setPromptError("");
    setCurrent(request);
  }, []);

  const enqueue = useCallback((request: PopupRequest) => {
    if (currentRef.current) {
      queueRef.current.push(request);
      return;
    }
    activate(request);
  }, [activate]);

  const finish = useCallback((value?: boolean | string | null) => {
    if (!current) return;
    if (current.kind === "alert") current.resolve();
    if (current.kind === "confirm") current.resolve(Boolean(value));
    if (current.kind === "prompt") current.resolve(typeof value === "string" ? value : null);
    const next = queueRef.current.shift() ?? null;
    currentRef.current = null;
    setCurrent(null);
    if (next) activate(next);
  }, [activate, current]);

  const api = useMemo<CommonPopupApi>(() => ({
    alert: (options) => new Promise<void>((resolve) => enqueue({ kind: "alert", options, resolve })),
    confirm: (options) => new Promise<boolean>((resolve) => enqueue({ kind: "confirm", options, resolve })),
    prompt: (options) => new Promise<string | null>((resolve) => enqueue({ kind: "prompt", options, resolve })),
  }), [enqueue]);

  const options = current?.options;
  const variant = options?.variant ?? "info";
  const close = () => finish(current?.kind === "confirm" ? false : null);

  function submitPrompt() {
    if (current?.kind !== "prompt") return;
    const value = promptValue.trim();
    if (current.options.required && !value) {
      setPromptError("값을 입력해 주세요.");
      promptRef.current?.focus();
      return;
    }
    finish(value);
  }

  return (
    <CommonPopupContext.Provider value={api}>
      {children}
      <CommonDialog
        description={options?.message}
        footer={current ? <>
          {current.kind !== "alert" ? <button className="rounded border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-100" onClick={close} type="button">{current.options.cancelText ?? "취소"}</button> : null}
          <button
            className={`rounded px-4 py-2 text-sm font-bold text-white ${confirmColor[variant]}`}
            onClick={() => current.kind === "prompt" ? submitPrompt() : finish(true)}
            ref={current.kind === "prompt" ? undefined : confirmRef}
            type="button"
          >
            {current.options.confirmText ?? "확인"}
          </button>
        </> : null}
        initialFocusRef={current?.kind === "prompt" ? promptRef : confirmRef}
        onClose={close}
        open={Boolean(current)}
        title={options?.title ?? "알림"}
        type={current?.kind === "prompt" ? "dialog" : "alertdialog"}
      >
        {current?.kind === "prompt" ? (
          <label className="block text-sm font-bold text-slate-700">
            {current.options.inputLabel}
            <input
              className="field-control"
              maxLength={current.options.maxLength}
              onChange={(event) => { setPromptValue(event.target.value); setPromptError(""); }}
              onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); submitPrompt(); } }}
              placeholder={current.options.placeholder}
              ref={promptRef}
              value={promptValue}
            />
            {promptError ? <span className="mt-2 block text-xs text-red-700" role="alert">{promptError}</span> : null}
          </label>
        ) : <p className="text-sm text-slate-600">작업 내용을 확인한 뒤 계속해 주세요.</p>}
      </CommonDialog>
    </CommonPopupContext.Provider>
  );
}

export function useCommonPopup(): CommonPopupApi {
  const context = useContext(CommonPopupContext);
  if (!context) throw new Error("useCommonPopup must be used inside CommonPopupProvider.");
  return context;
}
