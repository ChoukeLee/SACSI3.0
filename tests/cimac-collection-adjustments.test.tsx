// @vitest-environment jsdom
import React, { act } from "react";
import { webcrypto } from "node:crypto";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CimacCollectionAdjustments } from "@/features/finance/cimac-collection-adjustments";
import type {
  CimacBillingWriteResult,
  CimacCollectionPosition,
} from "@/features/finance/cimac-billing-types";

const api = vi.hoisted(() => ({
  position: vi.fn(),
  refund: vi.fn(),
  reversal: vi.fn(),
  receipt: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: api.refresh }) }));
vi.mock("@/features/finance/cimac-billing-actions", () => ({
  readCimacCollectionPosition: api.position,
  recordCimacRefund: api.refund,
  reverseCimacCollection: api.reversal,
  readCimacWriteReceipt: api.receipt,
}));
const originalPaymentId = "10000000-0000-4000-8000-000000000001";
const customerId = "20000000-0000-4000-8000-000000000001";
const viewerId = "30000000-0000-4000-8000-000000000001";
const bill1 = "40000000-0000-4000-8000-000000000001";
const bill2 = "40000000-0000-4000-8000-000000000002";
const stamp = "2026-10-20T10:00:00Z";
const shopAllocation = "B1 · S-101 · 商铺租金 · TEST-LEASE-1 退款分配";
const warehouseAllocation = "W1 · W-03 · 仓库物业费 · TEST-LEASE-2 退款分配";
function position(): CimacCollectionPosition {
  return {
    originalPaymentId,
    customerId,
    currency: "XOF",
    originalPaymentDate: "2026-10-20",
    originalPaymentMethod: "bank_transfer",
    originalReceiptNo: "ORIGINAL-001",
    originalAmount: "1000",
    refundedAmount: "0",
    reversedAmount: "0",
    remainingAmount: "1000",
    positionToken: "a".repeat(32),
    canRefund: true,
    canReverse: true,
    allocations: [bill1, bill2].map((receivableId, index) => ({
      receivableId,
      contractId: `50000000-0000-4000-8000-00000000000${index + 1}`,
      unitId: `60000000-0000-4000-8000-00000000000${index + 1}`,
      title: index ? "仓库物业费" : "商铺租金",
      originalAmount: index ? "400" : "600",
      refundedAmount: "0",
      reversedAmount: "0",
      remainingAmount: index ? "400" : "600",
      paidAmount: index ? "400" : "600",
      updatedAt: stamp,
    })),
    adjustments: [],
  };
}
function proof(
  input: Record<string, unknown>,
  kind: "refund" | "reversal",
): CimacBillingWriteResult {
  return {
    success: true,
    status: "completed",
    kind,
    requestId: String(input.requestId),
    actorId: viewerId,
    customerId,
    originalPaymentId,
    entityId: "70000000-0000-4000-8000-000000000001",
    paymentId: "70000000-0000-4000-8000-000000000001",
    auditId: "80000000-0000-4000-8000-000000000001",
    idempotent: false,
    receiptNo: "CORRECTION-001",
    amount: String(input.amount),
    currency: "XOF",
  };
}
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("crypto", webcrypto);
  sessionStorage.clear();
  vi.clearAllMocks();
  api.position.mockResolvedValue({ status: "available", position: position() });
  api.refund.mockImplementation(async (input) => proof(input, "refund"));
  api.reversal.mockImplementation(async (input) => proof(input, "reversal"));
  api.receipt.mockResolvedValue({ status: "not_found" });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
async function render(patch: { locale?: "zh" | "fr"; canWrite?: boolean } = {}) {
  await act(async () =>
    root.render(
      <CimacCollectionAdjustments
        {...{
          originalPaymentId,
          customerId,
          viewerId,
          today: "2026-10-24",
          locale: "zh",
          canWrite: true,
        }}
        unitLabels={{
          "60000000-0000-4000-8000-000000000001": "B1 · S-101",
          "60000000-0000-4000-8000-000000000002": "W1 · W-03",
        }}
        contractLabels={{
          "50000000-0000-4000-8000-000000000001": "TEST-LEASE-1",
          "50000000-0000-4000-8000-000000000002": "TEST-LEASE-2",
        }}
        {...patch}
      />,
    ),
  );
}
async function expand() {
  await act(async () => {
    const detail = host.querySelector("details")!;
    detail.open = true;
    detail.dispatchEvent(new Event("toggle"));
  });
}
function button(label: string) {
  const result = [...host.querySelectorAll("button")].find(
    (el) => el.textContent?.trim() === label || el.querySelector("strong")?.textContent === label,
  );
  if (!result) throw new Error(`Missing button ${label}`);
  return result;
}
async function click(label: string) {
  await writeInteraction(() => button(label).click());
}

async function writeInteraction(dispatch: () => unknown) {
  const writes = [api.refund, api.reversal];
  const before = writes.map((action) => action.mock.calls.length);
  await act(async () => {
    dispatch();
  });
  await act(async () => {
    // React act flushes its queue, not the native WebCrypto worker pool. If
    // hashing is still pending, wait for the real action boundary and result.
    const submitting = [...host.querySelectorAll('button[type="submit"]')].some((control) =>
      /^(?:正在核验并登记…|Vérification et enregistrement…)$/.test(control.textContent ?? ""),
    );
    if (submitting)
      await vi.waitFor(() => {
        expect(writes.some((action, index) => action.mock.calls.length > before[index])).toBe(true);
      });
    await Promise.allSettled(
      writes.flatMap((action, index) =>
        action.mock.results
          .slice(before[index])
          .filter((result) => result.type === "return")
          .map((result) => result.value),
      ),
    );
  });
}
function field(label: string) {
  const parent = [...host.querySelectorAll("label")].find(
    (el) => el.querySelector("span")?.textContent === label,
  );
  const result = parent?.querySelector("input,select,textarea");
  if (!result) throw new Error(`Missing field ${label}`);
  return result as HTMLInputElement;
}
async function input(label: string, value: string) {
  const el = field(label);
  await act(async () => {
    const prototype =
      el instanceof HTMLSelectElement
        ? HTMLSelectElement.prototype
        : el instanceof HTMLTextAreaElement
          ? HTMLTextAreaElement.prototype
          : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(el, value);
    el.dispatchEvent(
      new Event(el instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }),
    );
  });
}
async function submit() {
  await writeInteraction(() =>
    host
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
}
async function fillRefund(amount = "300", allocation = "300") {
  await click("登记实际退款");
  await input("已实际退回 · XOF", amount);
  await input("实际退款日期", "2026-10-22");
  await input("实际退款方式", "cash");
  await input(shopAllocation, allocation);
  await input("实际原因 · 必填", "客户确认实际退回部分款项");
}

describe("CIMAC immutable original-receipt corrections", () => {
  it("reads positions only when expanded and leaves the operation unchosen", async () => {
    await render();
    expect(api.position).not.toHaveBeenCalled();
    expect(host.querySelector("form")).toBeNull();
    await expand();
    expect(api.position).toHaveBeenCalledOnce();
    expect(host.textContent).toContain("ORIGINAL-001");
    expect(host.querySelector("form")).toBeNull();
    expect(api.refund).not.toHaveBeenCalled();
    expect(api.reversal).not.toHaveBeenCalled();
  });
  it("starts actual refund facts and explicit allocations blank, not inferred", async () => {
    await render();
    await expand();
    await click("登记实际退款");
    for (const label of [
      "已实际退回 · XOF",
      "实际退款日期",
      "实际退款方式",
      "实际原因 · 必填",
      shopAllocation,
      warehouseAllocation,
    ])
      expect(field(label).value).toBe("");
    expect(host.textContent).toContain("不执行银行转账");
    expect(host.textContent).toContain("不自动免除合同义务");
  });
  it("submits one explicit partial refund directly with original scope, exact snapshots and no guessed collector", async () => {
    await render();
    await expand();
    await fillRefund();
    await submit();
    expect(api.refund).toHaveBeenCalledOnce();
    expect(api.reversal).not.toHaveBeenCalled();
    expect(api.refund.mock.calls[0][0]).toMatchObject({
      originalPaymentId,
      customerId,
      currency: "XOF",
      amount: "300",
      paymentDate: "2026-10-22",
      paymentMethod: "cash",
      expectedPositionToken: "a".repeat(32),
      reason: "客户确认实际退回部分款项",
      allocations: [
        {
          receivableId: bill1,
          amount: "300",
          expectedRemaining: "600",
          expectedPaid: "600",
          expectedUpdatedAt: stamp,
        },
      ],
    });
    expect(api.refund.mock.calls[0][0].actualCollector).toBeUndefined();
    expect(host.textContent).toContain("实际退款已登记");
    expect(sessionStorage.length).toBe(0);
  });
  it.each([
    ["700", "700"],
    ["300", "200"],
    ["300.5", "300.5"],
    ["-300", "300"],
  ])(
    "rejects overbalance, mismatch and invalid XOF %s/%s before durable identity",
    async (amount, allocation) => {
      await render();
      await expand();
      await fillRefund(amount, allocation);
      await submit();
      expect(api.refund).not.toHaveBeenCalled();
      expect(sessionStorage.length).toBe(0);
      expect(host.querySelector('[role="alert"]')).not.toBeNull();
    },
  );
  it("requires actual refund date, method and reason and rejects impossible dates preflight", async () => {
    await render();
    await expand();
    await fillRefund();
    for (const [label, bad, good] of [
      ["实际退款日期", "", "2026-10-22"],
      ["实际退款方式", "", "cash"],
      ["实际原因 · 必填", " ", "实际退回"],
      ["实际退款日期", "2026-10-19", "2026-10-22"],
    ]) {
      await input(label, bad);
      await submit();
      expect(api.refund).not.toHaveBeenCalled();
      await input(label, good);
    }
    expect(sessionStorage.length).toBe(0);
  });
  it("reverses the whole original erroneous receipt without date/method inputs or real money out", async () => {
    await render();
    await expand();
    await click("冲正错误收款");
    expect(host.textContent).toContain("不是实际退款");
    expect(host.textContent).toContain("生效日期沿用原收款日");
    expect(host.querySelector('input[type="date"]')).toBeNull();
    expect(host.querySelector('input[type="number"]')).toBeNull();
    expect(host.querySelector("select")).toBeNull();
    await input("实际原因 · 必填", "整笔收款录错，客户尚未付款");
    await submit();
    expect(api.reversal).toHaveBeenCalledOnce();
    expect(api.refund).not.toHaveBeenCalled();
    const payload = api.reversal.mock.calls[0][0];
    expect(payload.amount).toBe("1000");
    expect(payload.allocations.map((row: { amount: string }) => row.amount)).toEqual([
      "600",
      "400",
    ]);
    expect(payload.paymentDate).toBeUndefined();
    expect(payload.paymentMethod).toBeUndefined();
    expect(host.textContent).toContain("没有登记实际退款");
  });
  it("shows preserved original plus partial refund chain and prohibits a whole reversal afterwards", async () => {
    const p = position();
    p.refundedAmount = "300";
    p.remainingAmount = "700";
    p.canReverse = false;
    p.allocations[0] = {
      ...p.allocations[0],
      remainingAmount: "300",
      refundedAmount: "300",
      paidAmount: "300",
    };
    p.adjustments = [
      {
        id: "a0000000-0000-4000-8000-000000000001",
        requestId: "b0000000-0000-4000-8000-000000000001",
        paymentId: "c0000000-0000-4000-8000-000000000001",
        originalPaymentId,
        kind: "refund",
        amount: "300",
        currency: "XOF",
        paymentDate: "2026-10-22",
        effectiveDate: "2026-10-22",
        paymentMethod: "cash",
        reason: "客户实际收回款项",
        recordedBy: viewerId,
        auditId: "d0000000-0000-4000-8000-000000000001",
        receiptNo: "REFUND-001",
        createdAt: stamp,
        allocations: [{ receivableId: bill1, amount: "300" }],
      },
    ];
    api.position.mockResolvedValue({ status: "available", position: p });
    await render();
    await expand();
    expect(button("冲正错误收款").disabled).toBe(true);
    expect(host.textContent).toContain("1,000 XOF");
    expect(host.textContent).toContain("700 XOF");
    expect(host.textContent).toContain("REFUND-001");
    expect(host.textContent).toContain(viewerId);
    expect(host.textContent).toContain("不能再整单冲正");
  });
  it("allows readers to inspect the chain but not choose or submit adjustments", async () => {
    await render({ canWrite: false });
    await expand();
    expect(host.textContent).toContain("原单未调整余额");
    expect(host.querySelector('[aria-label="选择校正类型"]')).toBeNull();
    expect(host.querySelector("form")).toBeNull();
  });
  it("does not call unadjusted money refundable when the verified position disallows refund", async () => {
    api.position.mockResolvedValue({
      status: "available",
      position: { ...position(), canRefund: false, canReverse: false },
    });
    await render();
    await expand();
    expect(host.textContent).toContain("原单未调整余额");
    expect(host.textContent).not.toContain("剩余可退");
    expect(host.textContent).toContain("不能把该余额直接作为可退额");
    expect(button("登记实际退款").disabled).toBe(true);
  });
  it("labels identical bill titles by distinct buildings, rooms and contracts", async () => {
    const p = position();
    p.allocations.forEach((row) => {
      row.title = "租金";
    });
    api.position.mockResolvedValue({ status: "available", position: p });
    await render();
    await expand();
    await click("登记实际退款");
    expect(field("B1 · S-101 · 租金 · TEST-LEASE-1 退款分配")).toBeDefined();
    expect(field("W1 · W-03 · 租金 · TEST-LEASE-2 退款分配")).toBeDefined();
  });
  it.each([
    null,
    { ...position(), customerId: viewerId },
    { ...position(), originalPaymentId: viewerId },
  ])("does not replace unavailable or mismatched position with zero %j", async (p) => {
    api.position.mockResolvedValue(
      p ? { status: "available", position: p } : { status: "unavailable", error: "unavailable" },
    );
    await render();
    await expand();
    expect(host.textContent).toContain("不会按零或旧余额办理");
    expect(host.textContent).not.toContain("0 XOF");
    expect(host.querySelector("form")).toBeNull();
  });
  it("locks both operations after unknown refund and retries original payload under one identity", async () => {
    api.refund.mockResolvedValue({ success: false, rejected: false, error: "unknown" });
    await render();
    await expand();
    await fillRefund();
    await submit();
    const first = api.refund.mock.calls[0][0];
    expect(button("冲正错误收款").disabled).toBe(true);
    expect(host.querySelector("fieldset")?.disabled).toBe(true);
    await click("冲正错误收款");
    expect(api.reversal).not.toHaveBeenCalled();
    await click("按原内容同号重试");
    expect(api.refund.mock.calls[1][0]).toEqual(first);
    expect(sessionStorage.length).toBe(1);
    expect(sessionStorage.key(0)).toContain(
      `cimac_adjustment:${viewerId}:${customerId}:${originalPaymentId}`,
    );
  });
  it("keeps pending fixed when collapsed and remounted, with no editable new kind", async () => {
    api.refund.mockResolvedValue({ success: false, rejected: false, error: "unknown" });
    await render();
    await expand();
    await fillRefund();
    await submit();
    await act(async () => root.unmount());
    root = createRoot(host);
    await render();
    await expand();
    expect(button("冲正错误收款").disabled).toBe(true);
    expect(button("登记实际退款").disabled).toBe(true);
    expect(host.querySelector("form")).toBeNull();
    expect(host.textContent).toContain("检测到未核实的操作结果");
    expect(sessionStorage.length).toBe(1);
  });
  it("never unlocks not_found, wrong actor, wrong customer or wrong original receipt", async () => {
    api.refund.mockResolvedValue({ success: false, rejected: false, error: "unknown" });
    await render();
    await expand();
    await fillRefund();
    await submit();
    await click("查询原操作回执");
    expect(host.textContent).toContain("不代表未入账");
    for (const mismatch of [
      { actorId: customerId },
      { customerId: viewerId },
      { originalPaymentId: viewerId },
    ]) {
      api.receipt.mockResolvedValue({
        status: "found",
        receipt: { ...proof(api.refund.mock.calls[0][0], "refund"), ...mismatch },
      });
      await click("查询原操作回执");
      expect(sessionStorage.length).toBe(1);
      expect(button("冲正错误收款").disabled).toBe(true);
    }
  });
  it("shows actual recovered kind even if the pending panel initially selected no operation", async () => {
    sessionStorage.setItem(
      `sacsi:finance-request:v1:cimac_adjustment:${viewerId}:${customerId}:${originalPaymentId}`,
      JSON.stringify({ requestId: originalPaymentId, fingerprint: "f".repeat(64) }),
    );
    api.receipt.mockResolvedValue({
      status: "found",
      receipt: proof({ requestId: originalPaymentId, amount: "1000" }, "reversal"),
    });
    await render();
    await expand();
    await click("查询原操作回执");
    expect(host.textContent).toContain("错误收款已整单冲正");
    expect(host.textContent).not.toContain("实际退款已登记");
    expect(sessionStorage.length).toBe(0);
  });
  it("refreshes known-success balance before a new blank operation", async () => {
    await render();
    await expand();
    await fillRefund();
    await submit();
    const p = position();
    p.refundedAmount = "300";
    p.remainingAmount = "700";
    p.canReverse = false;
    api.position.mockResolvedValue({ status: "available", position: p });
    await click("刷新原单余额与校正链");
    expect(host.querySelector("form")).toBeNull();
    expect(button("冲正错误收款").disabled).toBe(true);
    await click("登记实际退款");
    expect(field("实际退款日期").value).toBe("");
    expect(field("已实际退回 · XOF").value).toBe("");
  });
  it("translates correction semantics without Chinese in the French form", async () => {
    await render({ locale: "fr" });
    await expand();
    await click("Enregistrer un remboursement réel");
    expect(host.textContent).toContain("sans effectuer de virement");
    expect(host.textContent).toContain("sans remise");
    expect(host.textContent).not.toContain("退款");
  });
});
