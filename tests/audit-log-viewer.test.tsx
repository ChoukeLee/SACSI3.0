// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const { download } = vi.hoisted(() => ({ download: vi.fn() }));
vi.mock("@/lib/csv", () => ({ downloadCsv: download }));
import { AuditLogViewer } from "@/features/settings/audit-log-viewer";
import { auditFixture } from "./fixtures/audit-display";

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("React", React);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  download.mockReset();
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

async function render() {
  await act(async () => root.render(<AuditLogViewer locale="zh" logs={[
    auditFixture(), auditFixture({ id: "second", actor_id: "other-actor", actor_email: "other@example.invalid", metadata: null }),
  ]} />));
}
async function click(button: Element) { await act(async () => (button as HTMLButtonElement).click()); }
function button(text: string) { return [...host.querySelectorAll("button")].find(b => b.textContent?.includes(text))!; }
async function select(label: string, value: string) {
  const element = host.querySelector(`select[aria-label="${label}"]`) as HTMLSelectElement;
  await act(async () => { element.value = value; element.dispatchEvent(new Event("change", { bubbles: true })); });
}

describe("audit reader interactions", () => {
  it("opens business details without requiring a review action", async () => {
    await render();
    const toggle = host.querySelector('[aria-label="查看业务操作详情"]')!;
    await click(toggle);
    const detail = host.querySelector('[aria-label="业务操作详情"]')!;
    expect(detail.textContent).toContain("振咏（当前名称）");
    expect(detail.textContent).toContain("10,000 XOF → 30,000 XOF");
    expect(detail.textContent).toContain("request-example");
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(detail.querySelector("button")).toBeNull();
    expect(host.querySelector("details")?.open).toBe(false);
  });
  it("filters by authenticated account, not by booking agent", async () => {
    await render(); await select("录入账号筛选", "other-actor");
    expect(host.querySelectorAll("tbody tr")).toHaveLength(1);
    expect(host.querySelector("tbody")?.textContent).toContain("other@example.invalid");
  });
  it("filters channels and closes stale detail", async () => {
    await render(); await click(host.querySelector('[aria-label="查看业务操作详情"]')!);
    await select("录入渠道筛选", "unknown");
    expect(host.querySelectorAll("tbody tr")).toHaveLength(1);
    expect(host.querySelector('[aria-label="业务操作详情"]')).toBeNull();
    expect(host.querySelector("tbody")?.textContent).toContain("未记录渠道");
  });
  it("searches by request ID and exports only matching records", async () => {
    await render();
    const input = host.querySelector('input[placeholder="房号 / 账号 / 请求号 / 原始指令"]') as HTMLInputElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "request-example");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(host.querySelectorAll("tbody tr")).toHaveLength(1);
    await click(button("导出 CSV"));
    expect(download).toHaveBeenCalledTimes(1);
    expect(download.mock.calls[0][1]).toContain("请求编号");
    expect(download.mock.calls[0][2]).toHaveLength(1);
    expect(download.mock.calls[0][2][0]).toContain("request-example");
  });
  it("renders instruction markup as text and exports formula-like text safely", async () => {
    await act(async () => root.render(<AuditLogViewer locale="zh" logs={[auditFixture({ metadata: {
      original_instruction: '=HYPERLINK("https://example.invalid") <img src=x onerror=alert(1)>',
    } })]} />));
    await click(host.querySelector('[aria-label="查看业务操作详情"]')!);
    expect(host.querySelector("img")).toBeNull();
    await click(button("导出 CSV"));
    expect(download.mock.calls[0][2][0].at(-1)).toMatch(/^'=HYPERLINK/);
  });
});
