"use client";

import { FormEvent, useState } from "react";

type ApiErrorBody = {
  error?: {
    message?: string;
  };
};

export function LoginForm() {
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setMessage("");

    const formData = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/v1/auth/sessions", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: formData.get("email"),
          password: formData.get("password"),
        }),
      });

      if (response.ok) {
        window.location.replace("/");
        return;
      }

      const body = (await response.json().catch(() => null)) as ApiErrorBody | null;
      setMessage(
        body?.error?.message ?? "로그인 요청을 처리하지 못했습니다.",
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
        <label className="block text-sm font-semibold text-slate-800" htmlFor="email">
          이메일
        </label>
        <input
          autoComplete="username"
          autoFocus
          className="h-11 w-full rounded-md border border-slate-300 bg-white px-3 text-sm outline-none transition focus:border-teal-600 focus:ring-2 focus:ring-teal-100"
          id="email"
          maxLength={320}
          name="email"
          required
          type="email"
        />
      </div>
      <div className="space-y-2">
        <label
          className="block text-sm font-semibold text-slate-800"
          htmlFor="password"
        >
          비밀번호
        </label>
        <input
          autoComplete="current-password"
          className="h-11 w-full rounded-md border border-slate-300 bg-white px-3 text-sm outline-none transition focus:border-teal-600 focus:ring-2 focus:ring-teal-100"
          id="password"
          maxLength={256}
          name="password"
          required
          type="password"
        />
      </div>
      <p
        aria-live="polite"
        className={`min-h-5 text-sm ${message ? "text-red-700" : "text-transparent"}`}
      >
        {message || "로그인 안내"}
      </p>
      <button
        className="h-11 w-full rounded-md bg-teal-700 text-sm font-bold text-white transition hover:bg-teal-800 disabled:cursor-not-allowed disabled:bg-slate-400"
        disabled={pending}
        type="submit"
      >
        {pending ? "로그인 중…" : "로그인"}
      </button>
    </form>
  );
}
