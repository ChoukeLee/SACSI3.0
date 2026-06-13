"use client";

import { useRouter } from "next/navigation";
import { useRef, useCallback, useEffect } from "react";
import type { Locale } from "@/lib/i18n";
import { routeFor } from "@/lib/i18n";

// Core high-frequency pages — prefetched on idle. Other pages prefetch on hover/focus only.
const COMMON_ROUTES = [
  "/management",
  "/units",
  "/leases",
  "/sales",
  "/customers",
  "/finance",
];

const NO_PREFETCH_ROUTES = new Set(["/daily-rentals", "/fr/daily-rentals"]);

function shouldPrefetch(href: string) {
  return !NO_PREFETCH_ROUTES.has(href);
}

/** Deduplicated router.prefetch wrapper — swallows errors silently. */
export function usePrefetch() {
  const router = useRouter();
  const seen = useRef(new Set<string>());

  const prefetch = useCallback(
    (href: string) => {
      if (!shouldPrefetch(href)) return;
      if (seen.current.has(href)) return;
      seen.current.add(href);
      try {
        router.prefetch(href);
      } catch {
        /* prefetch failures must not affect the page */
      }
    },
    [router],
  );

  return prefetch;
}

/**
 * Prefetches the most-used pages during browser idle time.
 * Renders nothing — pure side-effect.
 */
export function IdlePrefetch({ locale }: { locale: Locale }) {
  const prefetch = usePrefetch();

  useEffect(() => {
    let id: number | NodeJS.Timeout;
    const enqueue = () => {
      if (typeof window !== "undefined" && "requestIdleCallback" in window) {
        id = window.requestIdleCallback(run, { timeout: 3000 });
      } else {
        id = setTimeout(run, 2000) as unknown as number;
      }
    };
    const run = () => {
      for (const route of COMMON_ROUTES) {
        prefetch(routeFor(locale, route));
      }
    };

    // Small stagger so the initial render isn't competing with prefetches
    const t = setTimeout(enqueue, 300);
    return () => {
      clearTimeout(t);
      if (typeof window !== "undefined" && "cancelIdleCallback" in window) {
        window.cancelIdleCallback(id as number);
      } else {
        clearTimeout(id as ReturnType<typeof setTimeout>);
      }
    };
  }, [locale, prefetch]);

  return null;
}
