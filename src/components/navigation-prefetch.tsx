"use client";

import { useCallback } from "react";
import type { Locale } from "@/lib/i18n";

/** Predictive prefetch is disabled for this data-heavy back office. */
export function usePrefetch() {
  return useCallback((_href: string) => {
    // Keep the API stable for sidebar/mobile nav while avoiding stale route payloads.
  }, []);
}

/** Kept for compatibility with older imports. */
export function IdlePrefetch({ locale: _locale }: { locale: Locale }) {
  return null;
}
