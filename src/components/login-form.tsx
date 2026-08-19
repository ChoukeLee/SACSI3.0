"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/logo";
import { login } from "@/app/login/actions";

const TEXT = {
  zh: {
    title: "科建地产房屋管理系统",
    email: "邮箱",
    password: "密码",
    submit: "登录",
    switchTo: "FR",
    errors: {
      missing: "请输入邮箱和密码。",
      account_not_configured: "该账号尚未配置系统权限。",
      rate_limited: "登录尝试过于频繁，请稍后再试。",
    },
  },
  fr: {
    title: "Gestion immobilière Kejian",
    email: "Email",
    password: "Mot de passe",
    submit: "Connexion",
    switchTo: "中文",
    errors: {
      missing: "Veuillez saisir l'email et le mot de passe.",
      account_not_configured: "Ce compte n'a pas encore de droits configurés.",
      rate_limited: "Trop de tentatives, veuillez réessayer plus tard.",
    },
  },
};

export function LoginForm({ errorCode }: { errorCode?: string }) {
  const [lang, setLang] = useState<"zh" | "fr">("zh");
  const t = TEXT[lang];
  const errorText = errorCode
    ? (t.errors[errorCode as keyof typeof t.errors] ?? decodeURIComponent(errorCode))
    : "";

  return (
    <div className="flex min-h-[80vh] items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex justify-center -ml-5">
            <Logo variant="icon" size={128} />
          </div>
          <p className="text-sm text-muted-foreground">{t.title}</p>
        </div>

        <form action={login} className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-semibold text-muted-foreground">{t.email}</label>
            <input type="email" name="email" placeholder="admin@sacsi.com" required className="w-full rounded-lg border border-border bg-card px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/60 focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/20" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-muted-foreground">{t.password}</label>
            <input type="password" name="password" required className="w-full rounded-lg border border-border bg-card px-3 py-2.5 text-sm text-foreground focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/20" />
          </div>
          {errorText && <p className="rounded-lg bg-accentRed-50 px-3 py-2 text-sm text-accentRed-600">{errorText}</p>}
          <Button type="submit" className="w-full">{t.submit}</Button>
        </form>

        <button type="button" onClick={() => setLang(lang === "zh" ? "fr" : "zh")} className="mt-4 w-full text-center text-xs text-muted-foreground hover:underline">
          {t.switchTo}
        </button>
      </div>
    </div>
  );
}