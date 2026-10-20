"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  decodeCalendarWindow,
  sameCalendarWindow,
  type CalendarWindowData,
  type CalendarWindowQuery,
} from "./calendar-window-model";
import { DAILY_DATA_CHANGED } from "./daily-read-invalidation";

/** No TTL or cross-account cache. Changed/failed scopes never display the previous rooms. */
export function useDailyWorkbenchData(initial: CalendarWindowData, query: CalendarWindowQuery) {
  const [snapshot, setSnapshot] = useState(initial);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const [revision, setRevision] = useState(0);
  const [asOf, setAsOf] = useState<string | null>(null);
  const first = useRef(true);
  const refresh = useCallback(() => setRevision((value) => value + 1), []);
  const { buildingId, from, to } = query;

  useEffect(() => {
    const invalidate = (event: Event) => {
      const changed = (event as CustomEvent<{ buildingId?: string }>).detail?.buildingId;
      if (!changed || changed === buildingId) refresh();
    };
    const restore = () => {
      if (document.visibilityState === "visible") refresh();
    };
    window.addEventListener(DAILY_DATA_CHANGED, invalidate);
    window.addEventListener("focus", restore);
    document.addEventListener("visibilitychange", restore);
    return () => {
      window.removeEventListener(DAILY_DATA_CHANGED, invalidate);
      window.removeEventListener("focus", restore);
      document.removeEventListener("visibilitychange", restore);
    };
  }, [buildingId, refresh]);

  useEffect(() => {
    const expected = { buildingId, from, to };
    if (first.current) {
      first.current = false;
      if (sameCalendarWindow(initial, expected)) return;
    }
    const controller = new AbortController();
    let active = true;
    setPending(true);
    setFailed(false);
    fetch(`/api/daily-rentals/calendar?${new URLSearchParams(expected)}`, {
      signal: controller.signal,
      cache: "no-store",
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("dailyWorkbenchUnavailable");
        return decodeCalendarWindow(await response.json(), expected);
      })
      .then((data) => {
        if (!active) return;
        setSnapshot(data);
        setAsOf(new Date().toISOString());
        setPending(false);
      })
      .catch(() => {
        if (!active) return;
        setFailed(true);
        setPending(false);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [initial, buildingId, from, to, revision]);

  const matches = sameCalendarWindow(snapshot, query);
  return {
    data: matches && !pending && !failed ? snapshot : null,
    pending: pending || (!matches && !failed),
    failed,
    asOf,
    refresh,
  };
}
