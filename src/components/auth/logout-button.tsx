"use client";

import { useState } from "react";
import { LogOut } from "lucide-react";

export function LogoutButton() {
  const [pending, setPending] = useState(false);

  async function handleLogout() {
    setPending(true);
    try {
      await fetch("/api/v1/auth/session", {
        method: "DELETE",
        credentials: "same-origin",
      });
    } finally {
      window.location.replace("/login");
    }
  }

  return (
    <button
      className="inline-flex h-8 items-center gap-1.5 rounded border border-slate-300 bg-white px-2.5 text-xs font-semibold text-slate-700 transition hover:border-slate-400 hover:bg-slate-50 disabled:opacity-60"
      disabled={pending}
      onClick={handleLogout}
      type="button"
    >
      <LogOut aria-hidden="true" className="h-3.5 w-3.5" />
      {pending ? "종료 중" : "로그아웃"}
    </button>
  );
}
