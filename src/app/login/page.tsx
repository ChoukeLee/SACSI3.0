import { Button } from "@/components/ui/button";
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
          <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-primary shadow-sm">
            <span className="text-sm font-bold text-primary-foreground">S</span>
          </div>
          <h1 className="text-base font-bold text-foreground">SACIS 3.0</h1>
          <p className="mt-1 text-sm text-muted-foreground">科建地产房屋管理系统</p>
        </div>

        <form action={login} className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-semibold text-muted-foreground">邮箱</label>
            <input
              type="email"
              name="email"
              placeholder="admin@sacsi.com"
              required
              className="w-full rounded-lg border border-border bg-card px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-ring/30"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-muted-foreground">密码</label>
            <input
              type="password"
              name="password"
              required
              className="w-full rounded-lg border border-border bg-card px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/30"
            />
          </div>

          {error && (
            <p className="rounded-lg bg-accentRed-50 px-3 py-2 text-sm text-accentRed-600">{error}</p>
          )}

          <Button type="submit" className="w-full">
            登录
          </Button>
        </form>
      </div>
    </div>
  );
}
