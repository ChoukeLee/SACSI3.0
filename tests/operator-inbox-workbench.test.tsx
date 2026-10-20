// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { OperatorInboxWorkbench } from "@/features/business-actions/operator-inbox-workbench";
import {
  parseOperatorInboxQuery,
  type OperatorInboxItem,
  type OperatorInboxResult,
} from "@/features/business-actions/operator-inbox-model";
const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  router.push.mockReset();
  router.refresh.mockReset();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
const id = "11111111-1111-4111-8111-111111111111";
function item(changes: Partial<OperatorInboxItem> = {}): OperatorInboxItem {
  return {
    id,
    requestId: id,
    kind: "confirmations",
    sourceStatus: "completed",
    state: "completed",
    createdAt: "2026-01-01T00:00:00Z",
    expiresAt: "2026-01-02T00:00:00Z",
    unitNo: "408",
    buildingLabel: "Synthetic",
    operation: null,
    itemCount: null,
    ...changes,
  };
}
function result(rows = [item()]): OperatorInboxResult {
  const counts = {
    all: rows.length,
    pending: 0,
    completed: 0,
    expired: 0,
    superseded: 0,
    unknown: 0,
  };
  for (const row of rows) counts[row.state]++;
  return { page: 1, pageSize: 30, total: rows.length, counts, items: rows };
}
async function render(
  data: OperatorInboxResult | null = result(),
  locale: "zh" | "fr" = "zh",
  params: Record<string, string> = {},
) {
  await act(async () =>
    root.render(
      <OperatorInboxWorkbench
        query={parseOperatorInboxQuery(params)}
        result={data}
        locale={locale}
        actorLabel="Synthetic本人"
      />,
    ),
  );
}
function button(label: string) {
  return [...host.querySelectorAll<HTMLButtonElement>("button")].find(
    (node) => node.textContent === label,
  )!;
}
it("shows completed records as results, with no approval or automatic POST", async () => {
  await render();
  expect(host.textContent).toContain("已完成");
  expect(host.textContent).toContain("原确认有效至");
  expect(host.textContent).toContain("仅本人创建");
  expect(
    host.querySelector('a[href="/operator/confirmations/11111111-1111-4111-8111-111111111111"]')
      ?.textContent,
  ).toContain("查看结果");
  expect(
    [...host.querySelectorAll("button")].some((node) => node.textContent?.includes("批准")),
  ).toBe(false);
  expect(router.push).not.toHaveBeenCalled();
});
it("does not present a read error as zero pending tasks", async () => {
  await render(null);
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("未将读取失败显示为零待办");
  expect(host.textContent).not.toContain("共 0 条");
  expect(host.querySelectorAll("ol li")).toHaveLength(0);
  await act(async () => button("重新读取").click());
  expect(router.refresh).toHaveBeenCalledOnce();
});
it("states precisely what an empty inbox does and does not mean", async () => {
  await render(result([]));
  expect(host.textContent).toContain("这个范围内没有确认单");
  expect(host.textContent).toContain("不代表所有业务都已处理");
  expect(host.textContent).toContain("网页长租收款的本机未决请求");
});
it("never supplies an execution link for an unknown source status", async () => {
  await render(result([item({ state: "unknown", sourceStatus: "future-state" })]));
  expect(host.textContent).toContain("不提供执行入口");
  expect(host.querySelectorAll("ol a")).toHaveLength(0);
});
it("preserves locale on all four detail links", async () => {
  const rows = (
    ["confirmations", "collections", "daily-workflows", "booking-operations"] as const
  ).map((kind) => item({ kind }));
  await render(result(rows), "fr");
  expect(host.textContent).toContain("Mes opérations");
  expect(host.querySelectorAll('ol a[href^="/fr/operator/"]')).toHaveLength(4);
  expect(host.textContent).toContain("Une opération terminée reste terminée");
});
it("uses exact server totals for pagination rather than the visible row count", async () => {
  const data = {
    ...result(),
    total: 110,
    counts: { ...result().counts, all: 110, completed: 110 },
  };
  await render(data);
  expect(host.textContent).toContain("共 110 条 · 第 1 / 4 页");
  await act(async () => button("下一页").click());
  expect(router.push).toHaveBeenCalledWith("/operator?page=2");
});
it("takes the requested status from a deliberate user action and resets page", async () => {
  await render(result(), "zh", { page: "3", kind: "confirmations", search: "1111" });
  const control = [...host.querySelectorAll<HTMLButtonElement>('div[role="group"] button')].find(
    (node) => node.textContent?.startsWith("已完成"),
  )!;
  await act(async () => control.click());
  expect(router.push).toHaveBeenCalledWith(
    "/operator?state=completed&kind=confirmations&search=1111",
  );
});
