"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    const supabase = createClient();
    const { error: authError } = await supabase.auth.signInWithPassword({ email, password });

    if (authError) {
      setError(authError.message);
      setLoading(false);
      return;
    }

    router.replace("/");
    router.refresh();
  };

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

        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-brand-ink-500 mb-1">邮箱</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="admin@sacis.com"
              required
              className="w-full rounded-lg border border-brand-warm-400 bg-white px-3 py-2.5 text-sm text-brand-ink-900 placeholder:text-brand-ink-300 focus:outline-none focus:ring-2 focus:ring-brand-orange-500/30"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-brand-ink-500 mb-1">密码</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              className="w-full rounded-lg border border-brand-warm-400 bg-white px-3 py-2.5 text-sm text-brand-ink-900 focus:outline-none focus:ring-2 focus:ring-brand-orange-500/30"
            />
          </div>

          {error && (
            <p className="text-sm text-brand-red-600 bg-brand-red-50 rounded-lg px-3 py-2">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-brand-orange px-4 py-2.5 text-sm font-semibold text-white transition-all duration-fast hover:bg-brand-orange-600 active:scale-[0.98] disabled:opacity-50"
          >
            {loading ? "登录中..." : "登录"}
          </button>
        </form>
      </div>
    </div>
  );
}
