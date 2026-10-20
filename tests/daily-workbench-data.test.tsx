// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  CalendarWindowData,
  CalendarWindowQuery,
} from "@/features/daily-rentals/calendar-window-model";
import { DAILY_DATA_CHANGED } from "@/features/daily-rentals/daily-read-invalidation";
import { useDailyWorkbenchData } from "@/features/daily-rentals/use-daily-workbench-data";
import {
  calendarBuilding,
  calendarOtherBuilding,
  calendarWindowFixture,
} from "./fixtures/calendar-window";

type HookState = ReturnType<typeof useDailyWorkbenchData>;
type Observation = {
  query: CalendarWindowQuery;
  data: CalendarWindowData | null;
  pending: boolean;
  failed: boolean;
};

let root: Root;
let host: HTMLDivElement;
let initial: CalendarWindowData;
let observations: Observation[];
let state: HookState;
let unmounted: boolean;

const oldQuery: CalendarWindowQuery = {
  buildingId: calendarBuilding,
  from: "2020-01-01",
  to: "2020-01-09",
};

function queryOf(data: CalendarWindowData): CalendarWindowQuery {
  return { buildingId: data.buildingId, from: data.from, to: data.to };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function response(query: CalendarWindowQuery, balance: number) {
  const data = calendarWindowFixture({ ...query, currentOutstanding: balance });
  return { ok: true, json: async () => data };
}

function Harness({ query }: { query: CalendarWindowQuery }) {
  state = useDailyWorkbenchData(initial, query);
  observations.push({
    query: { ...query },
    data: state.data,
    pending: state.pending,
    failed: state.failed,
  });
  return (
    <div>
      <span data-balance>{state.data?.currentOutstanding ?? "unknown"}</span>
      <span data-pending>{String(state.pending)}</span>
      <span data-failed>{String(state.failed)}</span>
      <button type="button" onClick={state.refresh}>
        Refresh
      </button>
    </div>
  );
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  initial = calendarWindowFixture();
  observations = [];
  unmounted = false;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  if (!unmounted) await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function render(query = queryOf(initial)) {
  await act(async () => root.render(<Harness query={query} />));
}

async function refresh() {
  await act(async () => host.querySelector("button")!.click());
}

function balance() {
  return host.querySelector("[data-balance]")?.textContent;
}

async function changed(buildingId?: string) {
  await act(async () => {
    window.dispatchEvent(new CustomEvent(DAILY_DATA_CHANGED, { detail: { buildingId } }));
  });
}

describe("useDailyWorkbenchData scoped snapshots", () => {
  it("uses a matching SSR snapshot without making an initial request", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await render();
    expect(fetch).not.toHaveBeenCalled();
    expect(state.data).toBe(initial);
    expect(state.pending).toBe(false);
    expect(state.failed).toBe(false);
    expect(state.asOf).toBeNull();
    expect(balance()).toBe("100");
  });

  it("fetches a nonmatching initial range without rendering the unrelated SSR data", async () => {
    const request = deferred<ReturnType<typeof response>>();
    const fetch = vi.fn().mockReturnValue(request.promise);
    vi.stubGlobal("fetch", fetch);
    await render(oldQuery);
    expect(observations[0].data).toBeNull();
    expect(state.data).toBeNull();
    expect(state.pending).toBe(true);
    expect(balance()).toBe("unknown");
    expect(fetch).toHaveBeenCalledTimes(1);
    await act(async () => request.resolve(response(oldQuery, 50)));
    expect(balance()).toBe("50");
    expect(state.pending).toBe(false);
    expect(state.asOf).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("uses no-store and an abort signal for the exact changed range", async () => {
    const request = deferred<ReturnType<typeof response>>();
    const fetch = vi.fn().mockReturnValue(request.promise);
    vi.stubGlobal("fetch", fetch);
    await render();
    await render(oldQuery);
    const [url, options] = fetch.mock.calls[0];
    const parsed = new URL(url, "http://localhost");
    expect(parsed.pathname).toBe("/api/daily-rentals/calendar");
    expect(Object.fromEntries(parsed.searchParams)).toEqual(oldQuery);
    expect(options.cache).toBe("no-store");
    expect(options.signal.aborted).toBe(false);
    expect(balance()).toBe("unknown");
    await act(async () => request.resolve(response(oldQuery, 50)));
    expect(balance()).toBe("50");
  });

  it("refetches the original window rather than reverting to stale SSR data", async () => {
    const returning = deferred<ReturnType<typeof response>>();
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response(oldQuery, 50))
      .mockReturnValueOnce(returning.promise);
    vi.stubGlobal("fetch", fetch);
    await render();
    await render(oldQuery);
    expect(balance()).toBe("50");
    const firstReturnRender = observations.length;
    await render();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(observations[firstReturnRender].data).toBeNull();
    expect(balance()).toBe("unknown");
    await act(async () => returning.resolve(response(queryOf(initial), 40)));
    expect(balance()).toBe("40");
    expect(state.data).not.toBe(initial);
  });

  it("ignores a late response from an aborted range after the replacement has loaded", async () => {
    const abandoned = deferred<ReturnType<typeof response>>();
    const fetch = vi
      .fn()
      .mockReturnValueOnce(abandoned.promise)
      .mockResolvedValueOnce(response(queryOf(initial), 25));
    vi.stubGlobal("fetch", fetch);
    await render();
    await render(oldQuery);
    await render();
    expect(fetch.mock.calls[0][1].signal.aborted).toBe(true);
    expect(balance()).toBe("25");
    const refreshedAt = state.asOf;
    await act(async () => abandoned.resolve(response(oldQuery, 999)));
    expect(balance()).toBe("25");
    expect(state.asOf).toBe(refreshedAt);
    expect(state.failed).toBe(false);
  });

  it("ignores delayed JSON parsing from an aborted request, not only a delayed fetch", async () => {
    const oldBody = deferred<CalendarWindowData>();
    const fetch = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: () => oldBody.promise })
      .mockResolvedValueOnce(response(queryOf(initial), 30));
    vi.stubGlobal("fetch", fetch);
    await render();
    await render(oldQuery);
    await render();
    expect(balance()).toBe("30");
    await act(async () => {
      oldBody.resolve(calendarWindowFixture({ ...oldQuery, currentOutstanding: 888 }));
    });
    expect(fetch.mock.calls[0][1].signal.aborted).toBe(true);
    expect(balance()).toBe("30");
    expect(state.failed).toBe(false);
  });

  it("does not turn a late aborted network failure into a replacement-window error", async () => {
    const abandoned = deferred<ReturnType<typeof response>>();
    const fetch = vi
      .fn()
      .mockReturnValueOnce(abandoned.promise)
      .mockResolvedValueOnce(response(queryOf(initial), 20));
    vi.stubGlobal("fetch", fetch);
    await render();
    await render(oldQuery);
    await render();
    await act(async () => abandoned.reject(new Error("late abandoned failure")));
    expect(balance()).toBe("20");
    expect(state.failed).toBe(false);
    expect(state.pending).toBe(false);
  });

  it("returns data=null in the very first render after a building switch, before effects", async () => {
    const request = deferred<ReturnType<typeof response>>();
    const fetch = vi.fn().mockReturnValue(request.promise);
    vi.stubGlobal("fetch", fetch);
    await render();
    const newQuery = { ...queryOf(initial), buildingId: calendarOtherBuilding };
    const firstNewScopeRender = observations.length;
    await render(newQuery);
    expect(observations[firstNewScopeRender]).toMatchObject({
      query: newQuery,
      data: null,
      pending: true,
    });
    expect(balance()).toBe("unknown");
    await act(async () => request.resolve(response(newQuery, 12)));
    expect(state.data?.buildingId).toBe(calendarOtherBuilding);
    expect(balance()).toBe("12");
  });

  it.each(["network", "http", "wrong-scope", "partial"] as const)(
    "leaves a failed %s request unknown rather than falling back to old data",
    async (failure) => {
      const fetch = vi.fn();
      if (failure === "network") fetch.mockRejectedValue(new Error("offline"));
      if (failure === "http") fetch.mockResolvedValue({ ok: false, json: vi.fn() });
      if (failure === "wrong-scope") fetch.mockResolvedValue(response(queryOf(initial), 999));
      if (failure === "partial")
        fetch.mockResolvedValue({
          ok: true,
          json: async () => calendarWindowFixture({ ...oldQuery, bookingCount: 1 }),
        });
      vi.stubGlobal("fetch", fetch);
      await render();
      expect(balance()).toBe("100");
      await render(oldQuery);
      expect(state.failed).toBe(true);
      expect(state.pending).toBe(false);
      expect(state.data).toBeNull();
      expect(balance()).toBe("unknown");
    },
  );

  it("hides same-scope data while refreshing, keeps failure unknown, and supports an explicit retry", async () => {
    const request = deferred<ReturnType<typeof response>>();
    const fetch = vi
      .fn()
      .mockReturnValueOnce(request.promise)
      .mockResolvedValueOnce(response(queryOf(initial), 7));
    vi.stubGlobal("fetch", fetch);
    await render();
    await refresh();
    expect(state.data).toBeNull();
    expect(state.pending).toBe(true);
    expect(balance()).toBe("unknown");
    await act(async () => request.reject(new Error("refresh failed")));
    expect(state.failed).toBe(true);
    expect(state.data).toBeNull();
    await refresh();
    expect(balance()).toBe("7");
    expect(state.failed).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});

describe("useDailyWorkbenchData invalidation", () => {
  it("refreshes relevant and unscoped business events but ignores another building", async () => {
    const fetch = vi.fn().mockResolvedValue(response(queryOf(initial), 9));
    vi.stubGlobal("fetch", fetch);
    await render();
    await changed(calendarOtherBuilding);
    expect(fetch).not.toHaveBeenCalled();
    await changed(calendarBuilding);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(balance()).toBe("9");
    await changed();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("refreshes on visible focus and visible restore, not while hidden", async () => {
    const fetch = vi.fn().mockResolvedValue(response(queryOf(initial), 6));
    vi.stubGlobal("fetch", fetch);
    const visibility = vi.spyOn(document, "visibilityState", "get");
    await render();
    visibility.mockReturnValue("hidden");
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(fetch).not.toHaveBeenCalled();
    visibility.mockReturnValue("visible");
    await act(async () => window.dispatchEvent(new Event("focus")));
    expect(fetch).toHaveBeenCalledTimes(1);
    await act(async () => document.dispatchEvent(new Event("visibilitychange")));
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(balance()).toBe("6");
  });

  it("replaces the building event subscription when the scope changes", async () => {
    const otherQuery = { ...queryOf(initial), buildingId: calendarOtherBuilding };
    const fetch = vi.fn().mockResolvedValue(response(otherQuery, 4));
    vi.stubGlobal("fetch", fetch);
    await render();
    await render(otherQuery);
    expect(fetch).toHaveBeenCalledTimes(1);
    await changed(calendarBuilding);
    expect(fetch).toHaveBeenCalledTimes(1);
    await changed(calendarOtherBuilding);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(state.data?.buildingId).toBe(calendarOtherBuilding);
  });

  it("aborts an invalidated request and rejects its late result", async () => {
    const oldRequest = deferred<ReturnType<typeof response>>();
    const fetch = vi
      .fn()
      .mockReturnValueOnce(oldRequest.promise)
      .mockResolvedValueOnce(response(queryOf(initial), 2));
    vi.stubGlobal("fetch", fetch);
    await render();
    await refresh();
    await changed(calendarBuilding);
    expect(fetch.mock.calls[0][1].signal.aborted).toBe(true);
    expect(balance()).toBe("2");
    await act(async () => oldRequest.resolve(response(queryOf(initial), 999)));
    expect(balance()).toBe("2");
  });

  it("aborts requests and removes all event listeners on unmount", async () => {
    const pending = deferred<ReturnType<typeof response>>();
    const fetch = vi.fn().mockReturnValue(pending.promise);
    vi.stubGlobal("fetch", fetch);
    await render();
    await refresh();
    expect(fetch).toHaveBeenCalledTimes(1);
    await act(async () => root.unmount());
    unmounted = true;
    expect(fetch.mock.calls[0][1].signal.aborted).toBe(true);
    await act(async () => {
      window.dispatchEvent(new CustomEvent(DAILY_DATA_CHANGED));
      window.dispatchEvent(new Event("focus"));
      document.dispatchEvent(new Event("visibilitychange"));
      pending.resolve(response(queryOf(initial), 999));
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(host.textContent).toBe("");
  });
});
