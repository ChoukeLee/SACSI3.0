// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuditWorkbench } from "@/features/settings/audit-workbench";
import { parseAuditWorkbenchQuery } from "@/features/settings/audit-workbench-model";
import type { AuditWorkbenchResult } from "@/features/settings/audit-workbench-types";
import { auditFixture } from "./fixtures/audit-display";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
function result(page = 1, search = "", total = 62): AuditWorkbenchResult {
  const { page: _page, ...filters } = parseAuditWorkbenchQuery();
  const rows = Array.from(
    { length: Math.min(30, Math.max(0, total - (page - 1) * 30)) },
    (_, index) =>
      auditFixture({
        id: id((page - 1) * 30 + index + 1),
        entity_id: id(500),
        entity_label: `Room ${(page - 1) * 30 + index + 1}`,
        before_data: null,
        after_data: null,
        resolved_booking_agent_name: null,
        metadata: { channel: "sacsi_web", request_id: "saved-request" },
      }),
  );
  return {
    rows,
    total,
    page,
    pageSize: 30,
    filters: { ...filters, search },
    summary: { total, recorded: total, missingIdentity: 0, maintenance: 0 },
    options: {
      actions: ["supplementary_payment", "record_lease_collection"],
      entityTypes: ["daily_booking", "lease_collection"],
      actors: [{ key: id(900), label: "recorded@example.invalid" }],
    },
  };
}
function response(body: unknown, status = 200) {
  return {
    ok: status === 200,
    status,
    json: async () => body,
    blob: async () => new Blob(["safe-csv"]),
  } as Response;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
let root: Root;
let host: HTMLDivElement;
const fetchMock = vi.fn<typeof fetch>();
beforeEach(() => {
  vi.stubGlobal("React", React);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  window.history.replaceState(null, "", "/settings/audit-logs");
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
async function render(
  data = result(),
  locale: "zh" | "fr" = "zh",
  viewerKey = "account-a:admin",
  canRead = true,
) {
  await act(async () =>
    root.render(
      <AuditWorkbench initialData={data} locale={locale} viewerKey={viewerKey} canRead={canRead} />,
    ),
  );
}
async function click(element: Element) {
  await act(async () => (element as HTMLButtonElement).click());
}
function button(label: string) {
  return [...host.querySelectorAll("button")].find(
    (element) =>
      element.textContent?.includes(label) || element.getAttribute("aria-label") === label,
  )!;
}
function rows() {
  return host.querySelectorAll("button[aria-controls]");
}
async function typeSearch(value: string) {
  const input = host.querySelector('input[name="search"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function submit() {
  await act(async () =>
    host
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
}
async function resolve(
  pending: ReturnType<typeof deferred<Response>>,
  body: unknown,
  status = 200,
) {
  await act(async () => pending.resolve(response(body, status)));
}
function detail(n: number) {
  return {
    log: auditFixture({
      id: id(n),
      entity_id: id(500),
      metadata: { channel: "sacsi_web", original_instruction: `confirmed-detail-${n}` },
    }),
  };
}

describe("paged audit workbench", () => {
  it.each(["zh", "fr"] as const)(
    "disambiguates unknown/colliding action, module and account options without changing their keys in %s",
    async (locale) => {
      const data = result();
      data.options.actions = [
        "create",
        "legacy_payment_a",
        "legacy_payment_b",
        "set_fixed_checkout",
        "set_checkout_date",
      ];
      data.options.entityTypes = ["unit", "legacy_entity_a", "legacy_entity_b"];
      data.options.actors = [
        { key: id(901), label: "Chouke" },
        { key: "legacy@example.invalid", label: "Chouke" },
        { key: id(902), label: "颖" },
      ];
      await render(data, locale);
      const option = (name: string, key: string) =>
        [...host.querySelectorAll(`select[name="${name}"] option`)].find(
          (row) => (row as HTMLOptionElement).value === key,
        )?.textContent;
      expect(option("action", "create")).toBe(locale === "zh" ? "新建" : "Creer");
      expect(option("entityType", "unit")).toBe(locale === "zh" ? "房源" : "Logement");
      for (const key of ["legacy_payment_a", "legacy_payment_b"])
        expect(option("action", key)).toContain(` · ${key}`);
      for (const key of ["legacy_entity_a", "legacy_entity_b"])
        expect(option("entityType", key)).toContain(` · ${key}`);
      for (const key of ["set_fixed_checkout", "set_checkout_date"])
        expect(option("action", key)).toContain(` · ${key}`);
      expect(option("actor", id(901))).toBe(`Chouke · ${id(901)}`);
      expect(option("actor", "legacy@example.invalid")).toBe("Chouke · legacy@example.invalid");
      expect(option("actor", id(902))).toBe("颖");
    },
  );
  it.each(["zh", "fr"] as const)(
    "uses only the SSR page and displays full-filter counts in %s",
    async (locale) => {
      await render(result(), locale);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(rows()).toHaveLength(30);
      expect(host.textContent).toContain(locale === "zh" ? "共 62 条" : "62 résultats");
      expect(
        button(locale === "zh" ? "导出全部筛选结果 · 62 条" : "Exporter tous les résultats · 62"),
      ).toBeDefined();
      expect(host.querySelector("h1")?.textContent).toBe(
        locale === "zh" ? "操作审计" : "Journal des opérations",
      );
      expect(host.querySelector('input[type="search"]')?.getAttribute("maxlength")).toBe("200");
      expect(host.querySelector("pre")).toBeNull();
      expect(host.querySelectorAll("label").length).toBe(8);
    },
  );
  it("paginates exactly on the server and keeps the applied query in the URL", async () => {
    const next = deferred<Response>();
    fetchMock.mockReturnValueOnce(next.promise);
    await render();
    await click(button("下一页"));
    expect(rows()).toHaveLength(0);
    expect(window.location.search).toBe("?page=2");
    expect(String(fetchMock.mock.calls[0][0])).toBe("/api/settings/audit-logs?page=2");
    await resolve(next, result(2));
    expect(rows()).toHaveLength(30);
    expect(rows()[0].textContent).toContain("Room 31");
    expect(host.textContent).toContain("第 31–60 条");
  });
  it("applies bounded search and preserves the French route", async () => {
    const pending = deferred<Response>();
    fetchMock.mockReturnValueOnce(pending.promise);
    await render(result(), "fr");
    await typeSearch("A&B 房号");
    await submit();
    expect(window.location.pathname).toBe("/fr/settings/audit-logs");
    expect(new URLSearchParams(window.location.search).get("search")).toBe("A&B 房号");
    await resolve(pending, result(1, "A&B 房号", 1));
    expect(rows()).toHaveLength(1);
  });
  it("aborts and ignores an obsolete list response even if transport resolves it", async () => {
    const first = deferred<Response>(),
      second = deferred<Response>();
    fetchMock.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    await render();
    await typeSearch("old");
    await submit();
    await typeSearch("new");
    await submit();
    expect((fetchMock.mock.calls[0][1]?.signal as AbortSignal).aborted).toBe(true);
    await resolve(second, result(1, "new", 1));
    expect(rows()).toHaveLength(1);
    await resolve(first, result(1, "old", 20));
    expect(rows()).toHaveLength(1);
    expect(window.location.search).toBe("?search=new");
    expect(host.textContent).toContain("共 1 条");
  });
  it("loads complete detail only on selection, ignores obsolete detail and keeps technical JSON collapsed", async () => {
    const first = deferred<Response>(),
      second = deferred<Response>();
    fetchMock.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    await render();
    await click(rows()[0]);
    await click(rows()[1]);
    expect((fetchMock.mock.calls[0][1]?.signal as AbortSignal).aborted).toBe(true);
    await resolve(second, detail(2));
    await resolve(first, detail(1));
    expect(host.textContent).toContain("confirmed-detail-2");
    expect(host.textContent).not.toContain("confirmed-detail-1");
    const technical = [...host.querySelectorAll("details")].find((element) =>
      element.textContent?.includes("原始历史 JSON"),
    );
    expect(technical?.open).toBe(false);
    expect(rows()[1].getAttribute("aria-expanded")).toBe("true");
  });
  it("closes and aborts stale detail on filter changes", async () => {
    const oldDetail = deferred<Response>(),
      page = deferred<Response>();
    fetchMock.mockReturnValueOnce(oldDetail.promise).mockReturnValueOnce(page.promise);
    await render();
    await click(rows()[0]);
    await typeSearch("new");
    await submit();
    await resolve(oldDetail, detail(1));
    expect(host.textContent).not.toContain("confirmed-detail-1");
    await resolve(page, result(1, "new", 0));
    expect(host.textContent).toContain("没有匹配记录");
  });
  it("returns keyboard focus to the native row button on Escape", async () => {
    fetchMock.mockResolvedValueOnce(response(detail(1)));
    await render();
    const row = rows()[0] as HTMLButtonElement;
    expect(row.type).toBe("button");
    row.focus();
    await click(row);
    const heading = [...host.querySelectorAll("h2")].find(
      (element) => element.textContent === "历史操作详情",
    )!;
    expect(document.activeElement).toBe(heading);
    await act(async () =>
      heading.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
    );
    expect(document.activeElement).toBe(row);
    expect(row.getAttribute("aria-expanded")).toBe("false");
  });
  it("discards the old SSR snapshot and aborts requests when the account changes", async () => {
    const old = deferred<Response>();
    fetchMock.mockReturnValueOnce(old.promise);
    const original = result();
    await render(original);
    await click(rows()[0]);
    await render(original, "zh", "account-b:admin");
    expect((fetchMock.mock.calls[0][1]?.signal as AbortSignal).aborted).toBe(true);
    expect(rows()).toHaveLength(0);
    expect(host.textContent).not.toContain("Room 1");
    await resolve(old, detail(1));
    expect(host.textContent).not.toContain("confirmed-detail-1");
  });
  it("replaces an initial snapshot and aborts old detail on same-account SSR refresh", async () => {
    const pending = deferred<Response>();
    fetchMock.mockReturnValueOnce(pending.promise);
    await render();
    await click(rows()[0]);
    await render(result(1, "refreshed", 1));
    expect(rows()).toHaveLength(1);
    expect((host.querySelector('input[name="search"]') as HTMLInputElement).value).toBe(
      "refreshed",
    );
    expect((fetchMock.mock.calls[0][1]?.signal as AbortSignal).aborted).toBe(true);
    await resolve(pending, detail(1));
    expect(host.textContent).not.toContain("confirmed-detail-1");
  });
  it("adopts a same-account server-filtered return to the audit URL", async () => {
    await render(result());
    await typeSearch("unsubmitted");
    await render(result(2, "server-filter", 62));
    expect(rows()[0].textContent).toContain("Room 31");
    expect((host.querySelector('input[name="search"]') as HTMLInputElement).value).toBe(
      "server-filter",
    );
    expect(host.textContent).toContain("第 31–60 条");
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("removes all evidence immediately when the role loses access", async () => {
    const pending = deferred<Response>();
    fetchMock.mockReturnValueOnce(pending.promise);
    const original = result();
    await render(original);
    await click(rows()[0]);
    await render(original, "zh", "account-a:finance", false);
    expect(rows()).toHaveLength(0);
    expect(host.querySelector("form")).toBeNull();
    expect((fetchMock.mock.calls[0][1]?.signal as AbortSignal).aborted).toBe(true);
    await resolve(pending, detail(1));
    expect(host.textContent).not.toContain("confirmed-detail-1");
    expect(host.textContent).toContain("没有审计查看权限");
  });
  it("treats a 403 response as revocation, not an empty result", async () => {
    fetchMock.mockResolvedValueOnce(response({}, 403));
    await render();
    await click(rows()[0]);
    expect(rows()).toHaveLength(0);
    expect(host.querySelector("form")).toBeNull();
    expect(host.textContent).toContain("没有审计查看权限");
    expect(host.textContent).not.toContain("没有匹配记录");
  });
  it("exports all applied filters, not the current page or unsubmitted draft, and reports an oversized export", async () => {
    fetchMock.mockResolvedValueOnce(response({}, 413));
    const page = result(2, "applied");
    await render(page);
    await typeSearch("not-applied");
    await click(button("导出全部筛选结果"));
    expect(String(fetchMock.mock.calls[0][0])).toBe(
      "/api/settings/audit-logs/export?search=applied",
    );
    expect(host.textContent).toContain("未导出任何不完整文件");
  });
  it("keeps failures separate from successful empty results and can retry", async () => {
    fetchMock
      .mockResolvedValueOnce(response({}, 503))
      .mockResolvedValueOnce(response(result(1, "", 0)));
    await render();
    await click(button("下一页"));
    expect(host.textContent).not.toContain("没有匹配记录");
    expect(host.textContent).toContain("暂时无法读取");
    // Retry the same page; a valid empty result still reports its exact page.
    fetchMock.mockReset().mockResolvedValueOnce(response({ ...result(1, "", 0), page: 2 }));
    await click(button("重新读取"));
    expect(host.textContent).toContain("没有匹配记录");
    expect(host.querySelector('[role="alert"]')).toBeNull();
  });
  it("reloads the URL query on browser navigation", async () => {
    fetchMock.mockResolvedValueOnce(response(result(1, "back", 2)));
    await render();
    window.history.replaceState(null, "", "/settings/audit-logs?search=back");
    await act(async () => window.dispatchEvent(new PopStateEvent("popstate")));
    expect(String(fetchMock.mock.calls[0][0])).toBe("/api/settings/audit-logs?search=back");
    expect(rows()).toHaveLength(2);
  });
  it("retries a failed filtered SSR read without widening its scope or page", async () => {
    const initialQuery = parseAuditWorkbenchQuery({
      actor: "recorded@example.invalid",
      search: "room-503",
      dateFrom: "2026-09-01",
      dateTo: "2026-10-20",
      page: "2",
    });
    fetchMock.mockResolvedValueOnce(response({}, 503));
    await act(async () =>
      root.render(
        <AuditWorkbench
          locale="zh"
          viewerKey="account-a:admin"
          initialData={null}
          initialQuery={initialQuery}
          initialError={503}
        />,
      ),
    );
    expect((host.querySelector('input[name="search"]') as HTMLInputElement).value).toBe("room-503");
    await click(button("重新读取"));
    const request = new URL(String(fetchMock.mock.calls[0][0]), "http://localhost");
    expect(Object.fromEntries(request.searchParams)).toEqual({
      actor: "recorded@example.invalid",
      search: "room-503",
      dateFrom: "2026-09-01",
      dateTo: "2026-10-20",
      page: "2",
    });
  });
  it.each(["actor=A&actor=B", "search=one&search=two", "page=1&page=2"])(
    "rejects duplicate keys on back/forward navigation: %s",
    async (search) => {
      const pending = deferred<Response>();
      fetchMock.mockReturnValueOnce(pending.promise);
      await render();
      await click(rows()[0]);
      window.history.replaceState(null, "", `/settings/audit-logs?${search}`);
      await act(async () => window.dispatchEvent(new PopStateEvent("popstate")));
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect((fetchMock.mock.calls[0][1]?.signal as AbortSignal).aborted).toBe(true);
      expect(rows()).toHaveLength(0);
      expect(host.textContent).toContain("筛选条件无效");
      expect(button("重新读取")).toBeUndefined();
      await resolve(pending, detail(1));
      expect(host.textContent).not.toContain("confirmed-detail-1");
      expect(window.location.search).toBe(`?${search}`);
    },
  );
  it("rejects malformed detail envelopes instead of presenting the wrong record", async () => {
    fetchMock.mockResolvedValueOnce(response(detail(2)));
    await render();
    await click(rows()[0]);
    expect(host.textContent).toContain("暂时无法读取");
    expect(host.textContent).not.toContain("confirmed-detail-2");
  });
});
