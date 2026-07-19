import { redirect } from "next/navigation";

import { LoginForm } from "@/components/auth/login-form";
import { getCurrentAuthContext } from "@/server/auth/auth-dal";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  if (await getCurrentAuthContext()) redirect("/");

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-100 px-4 py-10 text-slate-950">
      <section className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-7 shadow-sm sm:p-9">
        <div className="mb-8">
          <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-lg bg-teal-700 text-lg font-black text-white">
            F
          </div>
          <h1 className="text-2xl font-black tracking-tight">절곡 웹서비스</h1>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            관리자가 발급한 웹 계정으로 로그인하세요.
          </p>
        </div>
        <LoginForm />
        <p className="mt-7 border-t border-slate-200 pt-5 text-xs leading-5 text-slate-500">
          계정 발급과 비밀번호 재설정은 관리자에게 문의하세요.
        </p>
      </section>
    </main>
  );
}
