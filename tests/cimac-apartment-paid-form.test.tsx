// @vitest-environment jsdom
import React, { act } from "react";
import { webcrypto } from "node:crypto";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { CimacApartmentPaidForm } from "@/features/cimac/cimac-apartment-paid-form";
import {
  cimacApartmentPlan,
  type CimacApartmentRoom,
} from "@/features/cimac/cimac-apartment-model";
import { paidInput, paidProject, paidBuilding, paidStamp } from "./fixtures/cimac-apartment-paid";
const mocks = vi.hoisted(() => ({ execute: vi.fn(), check: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("@/features/cimac/cimac-apartment-paid-actions", () => ({
  executeApartmentPaidReceipt: mocks.execute,
  checkApartmentPaidStatus: mocks.check,
}));
let host: HTMLDivElement, root: Root;
const input = paidInput(),
  key = `cimac-apartment-paid:${paidProject}:${paidBuilding}`;
function rooms(): CimacApartmentRoom[] {
  return input.rooms.map((r, i) => ({
    ...cimacApartmentPlan()[i],
    unitId: r.unitId,
    unitUpdatedAt: paidStamp,
    registered: true,
    constructionStatus: "operational",
    operationalCondition: "normal",
    occupancyState: "unknown",
    areaSqm: null,
    reservation: null,
    paidReservation: null,
  }));
}
async function render() {
  await act(async () =>
    root.render(
      <CimacApartmentPaidForm
        rooms={rooms()}
        selectedUnitId={input.rooms[0].unitId}
        projectId={paidProject}
        buildingId={paidBuilding}
        locale="zh"
      />,
    ),
  );
}
function button(label: string) {
  const b = [...host.querySelectorAll<HTMLButtonElement>("button")].find(
    (b) => b.textContent === label,
  );
  if (!b) throw Error(`Missing ${label}`);
  return b;
}
async function click(label: string) {
  await act(async () => button(label).click());
}
function fill(name: string, value: string) {
  const el = host.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
    `[name="${name}"]`,
  )!;
  el.value = value;
}
async function review(total = "5250000") {
  await click("登记已收押租");
  await act(async () => {
    for (const el of [...host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].slice(
      1,
    ))
      el.click();
  });
  fill("customerName", input.customerName);
  fill("agreementStartDate", input.agreementStartDate);
  fill("agreementEndDate", input.agreementEndDate);
  fill("paymentDate", input.paymentDate);
  fill("paymentMethod", input.paymentMethod);
  fill("totalAmountXof", total);
  fill("sourceRef", input.sourceRef);
  fill("externalReceiptNo", input.externalReceiptNo!);
  fill("reason", input.reason);
  await act(async () =>
    host
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
}
beforeEach(() => {
  vi.resetAllMocks();
  sessionStorage.clear();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("crypto", webcrypto);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  mocks.execute.mockResolvedValue({ success: true });
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
describe("paid receipt review and recovery UI", () => {
  it("reviews one physical receipt total and exact deposit/rent per room before a write", async () => {
    await render();
    await review();
    expect(mocks.execute).not.toHaveBeenCalled();
    expect(host.textContent).toContain("5,250,000 XOF（525万）");
    expect(host.textContent).toContain("700,000 XOF（70万）");
    expect(host.textContent).toContain("1,050,000 XOF（105万）");
    expect(host.textContent).toContain("2027-03-31");
    expect(host.textContent).toContain("实际入住仍待补充");
    await click("确认登记已收押租");
    expect(mocks.execute).toHaveBeenCalledTimes(1);
    expect(mocks.execute.mock.calls[0][0]).toMatchObject({
      ...input,
      requestId: expect.any(String),
      originalInstruction: expect.any(String),
    });
    expect(sessionStorage.getItem(key)).toBeNull();
    expect(mocks.refresh).toHaveBeenCalledOnce();
  });
  it("rejects entering ten-thousand units instead of XOF units", async () => {
    await render();
    await review("525");
    expect(host.querySelector('[role="alert"]')).not.toBeNull();
    expect(mocks.execute).not.toHaveBeenCalled();
    expect(host.textContent).not.toContain("确认登记已收押租");
  });
  it("retains an identical payload and request ID after uncertainty, with no financial or customer data stored in the browser", async () => {
    mocks.execute
      .mockRejectedValueOnce(Error("lost response"))
      .mockResolvedValueOnce({ success: true });
    await render();
    await review();
    await click("确认登记已收押租");
    const original = mocks.execute.mock.calls[0][0],
      marker = JSON.parse(sessionStorage.getItem(key)!);
    expect(marker).toEqual({
      version: 1,
      requestId: original.requestId,
      fingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(sessionStorage.getItem(key)).not.toContain(input.customerName);
    expect(sessionStorage.getItem(key)).not.toContain("5250000");
    expect(host.querySelector("form")).toBeNull();
    await click("原样重试");
    expect(mocks.execute.mock.calls[1][0]).toEqual(original);
  });
  it("does not unlock a new request when an uncertain original retry is rejected", async () => {
    mocks.execute
      .mockResolvedValueOnce({ success: false, outcome: "unknown", error: "Unknown" })
      .mockResolvedValueOnce({ success: false, outcome: "rejected", error: "Denied now" });
    await render();
    await review();
    await click("确认登记已收押租");
    await click("原样重试");
    expect(sessionStorage.getItem(key)).not.toBeNull();
    expect(host.textContent).toContain("查询原请求");
    expect(host.querySelector("form")).toBeNull();
  });
  it("uses status-only recovery after reload, retaining unknown if no completed result is found", async () => {
    sessionStorage.setItem(
      key,
      JSON.stringify({ version: 1, requestId: input.requestId, fingerprint: "a".repeat(64) }),
    );
    mocks.check
      .mockResolvedValueOnce({ success: true, found: false })
      .mockResolvedValueOnce({ success: true, found: true });
    await render();
    expect(host.textContent).not.toContain("登记已收押租");
    expect(host.textContent).not.toContain("原样重试");
    await click("查询原请求");
    expect(sessionStorage.getItem(key)).not.toBeNull();
    expect(mocks.execute).not.toHaveBeenCalled();
    await click("查询原请求");
    expect(sessionStorage.getItem(key)).toBeNull();
    expect(mocks.refresh).toHaveBeenCalledOnce();
  });
});
