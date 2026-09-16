// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { OperatorConfirmationPanel } from "@/features/business-actions/operator-confirmation-panel";
import { buildPaymentPreview } from "@/features/business-actions/operator-payment-preview";
import { previewRequest, previewSnapshot } from "./fixtures/operator-preview";
let root: Root;
let host: HTMLDivElement;
const fetchMock = vi.fn();
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.stubGlobal("fetch",fetchMock); fetchMock.mockReset();
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
async function render(completed = false) {
  const result = buildPaymentPreview(previewRequest(),previewSnapshot());
  if (!result.success) throw new Error("invalid fixture");
  await act(async () => root.render(<OperatorConfirmationPanel id="fixed-id" preview={result.preview} actor="operator@test.invalid" expiresAt="2026-09-15T23:59:00Z" completed={completed} />));
}
async function click(selector: string) { await act(async () => (host.querySelector(selector) as HTMLElement).click()); }
it("requires explicit checking and does not submit on render", async () => {
  await render(); expect(fetchMock).not.toHaveBeenCalled();
  expect(host.querySelector("button")?.disabled).toBe(true);
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ status: "completed" }) });
  await click("input"); await click("button");
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(fetchMock).toHaveBeenCalledWith("/api/operator/v1/confirmations/fixed-id", { method: "POST", credentials: "same-origin" });
  expect(host.textContent).toContain("已入账并通过结果复查"); expect(host.querySelector("button")).toBeNull();
});
it("never automatically retries a lost response and retains the same confirmation", async () => {
  fetchMock.mockRejectedValue(new Error("network")); await render(); await click("input"); await click("button");
  expect(fetchMock).toHaveBeenCalledTimes(1); expect(host.textContent).toContain("结果未知");
  await click("button"); expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(fetchMock.mock.calls.every(([url]) => url.endsWith("fixed-id"))).toBe(true);
});
it("does not claim fresh verification for a previously completed record", async () => {
  await render(true); expect(host.textContent).toContain("本页未重新复查当前账务");
  expect(host.querySelector("button")).toBeNull(); expect(fetchMock).not.toHaveBeenCalled();
});
it("stops retrying stale confirmations and explains the next step in Chinese", async () => {
  fetchMock.mockResolvedValue({ ok: false, json: async () => ({ code: "confirmationSnapshotChanged" }) });
  await render(); await click("input"); await click("button");
  expect(host.textContent).toContain("订单账务已变化"); expect(host.textContent).not.toContain("confirmationSnapshotChanged");
  expect(host.querySelector("button")?.disabled).toBe(true);
  await click("button"); expect(fetchMock).toHaveBeenCalledTimes(1);
});
it("returns an expired login to the same confirmation", async () => {
  fetchMock.mockResolvedValue({ ok: false, json: async () => ({ code: "missing_or_invalid_session" }) });
  await render(); await click("input"); await click("button");
  expect(host.textContent).toContain("登录已失效");
  expect(host.querySelector("a")?.getAttribute("href")).toBe("/login?redirect=%2Foperator%2Fconfirmations%2Ffixed-id");
  expect(host.querySelector("button")?.disabled).toBe(true);
});
