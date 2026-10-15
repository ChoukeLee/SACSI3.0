"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { routeFor, type Locale } from "@/lib/i18n";

export function LocaleContextLink({ locale, label }: { locale: Locale; label: string }) {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const href = routeFor(locale, pathname) + (search ? `?${search}` : "");
  return (
    <Link
      href={href}
      prefetch={false}
      className="inline-flex h-8 items-center rounded-md px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-card hover:text-foreground"
    >
      {label}
    </Link>
  );
}
