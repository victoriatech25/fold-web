import { ResetPasswordForm } from "@/components/auth/reset-password-form";

export const dynamic = "force-dynamic";

type ResetPasswordPageProps = {
  searchParams: Promise<{ token?: string | string[] }>;
};

export default async function ResetPasswordPage({
  searchParams,
}: ResetPasswordPageProps) {
  const tokenValue = (await searchParams).token;
  const token = typeof tokenValue === "string" ? tokenValue : "";

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-100 px-4 py-10 text-slate-950">
      <section className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-7 shadow-sm sm:p-9">
        <div className="mb-8">
          <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-lg bg-teal-700 text-lg font-black text-white">
            F
          </div>
          <h1 className="text-2xl font-black tracking-tight">
            비밀번호 설정
          </h1>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            관리자가 발급한 일회성 링크로 새 비밀번호를 설정합니다.
          </p>
        </div>
        {token ? (
          <ResetPasswordForm token={token} />
        ) : (
          <div>
            <p className="text-sm leading-6 text-red-700">
              재설정 토큰이 없습니다. 관리자에게 새 링크를 요청하세요.
            </p>
            <a
              className="mt-6 flex h-11 w-full items-center justify-center rounded-md border border-slate-300 text-sm font-bold text-slate-700 hover:bg-slate-50"
              href="/login"
            >
              로그인으로 이동
            </a>
          </div>
        )}
      </section>
    </main>
  );
}
