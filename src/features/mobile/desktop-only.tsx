"use client";

import { Monitor } from "lucide-react";
import type { Locale } from "@/lib/i18n";
import { dictionaries } from "@/lib/i18n";

export function DesktopOnly({ locale }: { locale: Locale }) {
  const t = dictionaries[locale].mobile;
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center lg:hidden">
      <Monitor className="h-12 w-12 text-slate-300 mb-4" />
      <p className="text-sm font-semibold text-slate-600">{t.desktopOnly}</p>
      <p className="mt-1 text-xs text-slate-400">{t.desktopOnlyHint}</p>
    </div>
  );
}
