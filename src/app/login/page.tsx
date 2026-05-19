import { login } from "./actions";

function loginErrorMessage(error: string | undefined) {
  if (!error) return "";
  if (error === "missing") return "请输入邮箱和密码。";
  return decodeURIComponent(error);
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const params = await searchParams;
  const error = loginErrorMessage(params.error);

  return (
    <div className="flex min-h-[80vh] items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-brand-orange shadow-sm">
            <span className="text-sm font-bold text-white">S</span>
          </div>
          <h1 className="text-lg font-bold text-brand-ink-900">SACIS 3.0</h1>
          <p className="mt-1 text-sm text-brand-ink-400">科建地产房屋管理系统</p>
        </div>

        <form action={login} className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-semibold text-brand-ink-500">邮箱</label>
            <input
              type="email"
              name="email"
              placeholder="admin@sacis.com"
              required
              className="w-full rounded-lg border border-brand-warm-400 bg-white px-3 py-2.5 text-sm text-brand-ink-900 placeholder:text-brand-ink-300 focus:outline-none focus:ring-2 focus:ring-brand-orange-500/30"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-brand-ink-500">密码</label>
            <input
              type="password"
              name="password"
              required
              className="w-full rounded-lg border border-brand-warm-400 bg-white px-3 py-2.5 text-sm text-brand-ink-900 focus:outline-none focus:ring-2 focus:ring-brand-orange-500/30"
            />
          </div>

          {error && (
            <p className="rounded-lg bg-brand-red-50 px-3 py-2 text-sm text-brand-red-600">{error}</p>
          )}

          <button
            type="submit"
            className="w-full rounded-lg bg-brand-orange px-4 py-2.5 text-sm font-semibold text-white transition-all duration-fast hover:bg-brand-orange-600 active:scale-[0.98]"
          >
            登录
          </button>
        </form>
      </div>
    </div>
  );
}
