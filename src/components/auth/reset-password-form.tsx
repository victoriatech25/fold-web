"use client";

import { FormEvent, useState } from "react";

type ApiErrorBody = {
  error?: {
    message?: string;
  };
};

export function ResetPasswordForm({ token }: { token: string }) {
  const [pending, setPending] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [message, setMessage] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setMessage("");

    const formData = new FormData(event.currentTarget);
    const password = String(formData.get("password") ?? "");
    if (password !== String(formData.get("passwordConfirmation") ?? "")) {
      setMessage("비밀번호 확인이 일치하지 않습니다.");
      setPending(false);
      return;
    }

    try {
      const response = await fetch(
        "/api/v1/auth/password-resets/complete",
        {
          method: "POST",
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ token, password }),
        },
      );
      if (response.ok) {
        setCompleted(true);
        setMessage("비밀번호가 설정되었습니다. 로그인해 주세요.");
        return;
      }
      const body = (await response.json().catch(() => null)) as ApiErrorBody | null;
      setMessage(
        body?.error?.message ?? "비밀번호를 설정하지 못했습니다.",
      );
    } catch {
      setMessage("서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="space-y-5" onSubmit={handleSubmit}>
      <div className="space-y-2">
        <label
          className="block text-sm font-semibold text-slate-800"
          htmlFor="password"
        >
          새 비밀번호
        </label>
        <input
          autoComplete="new-password"
          className="h-11 w-full rounded-md border border-slate-300 bg-white px-3 text-sm outline-none transition focus:border-teal-600 focus:ring-2 focus:ring-teal-100"
          disabled={completed}
          id="password"
          maxLength={256}
          minLength={15}
          name="password"
          required
          type="password"
        />
        <p className="text-xs leading-5 text-slate-500">
          15~128자이며 공백을 포함한 긴 문장을 사용할 수 있습니다.
        </p>
      </div>
      <div className="space-y-2">
        <label
          className="block text-sm font-semibold text-slate-800"
          htmlFor="passwordConfirmation"
        >
          새 비밀번호 확인
        </label>
        <input
          autoComplete="new-password"
          className="h-11 w-full rounded-md border border-slate-300 bg-white px-3 text-sm outline-none transition focus:border-teal-600 focus:ring-2 focus:ring-teal-100"
          disabled={completed}
          id="passwordConfirmation"
          maxLength={256}
          minLength={15}
          name="passwordConfirmation"
          required
          type="password"
        />
      </div>
      <p
        aria-live="polite"
        className={`min-h-5 text-sm ${
          completed ? "text-teal-700" : message ? "text-red-700" : "text-transparent"
        }`}
      >
        {message || "비밀번호 재설정 안내"}
      </p>
      {completed ? (
        <a
          className="flex h-11 w-full items-center justify-center rounded-md bg-teal-700 text-sm font-bold text-white transition hover:bg-teal-800"
          href="/login"
        >
          로그인으로 이동
        </a>
      ) : (
        <button
          className="h-11 w-full rounded-md bg-teal-700 text-sm font-bold text-white transition hover:bg-teal-800 disabled:cursor-not-allowed disabled:bg-slate-400"
          disabled={pending}
          type="submit"
        >
          {pending ? "설정 중…" : "새 비밀번호 설정"}
        </button>
      )}
    </form>
  );
}
