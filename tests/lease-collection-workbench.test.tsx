// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { webcrypto } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  LeaseCollectionWorkbench,
  type LeaseCollectionWorkbenchProps,
} from "@/features/leases/lease-collection-workbench";
import type {
  LeaseCollectionInput,
  LeaseCollectionResult,
} from "@/features/leases/lease-collection-types";
import type { CustomerRow, LeaseContractRow, ReceivableRow, UnitRow } from "@/types/database";
import { readLeaseCollectionPending } from "@/features/leases/lease-collection-pending";

const record = vi.hoisted(() =>
  vi.fn<(input: LeaseCollectionInput) => Promise<LeaseCollectionResult>>(),
);
const readReceipt = vi.hoisted(() => vi.fn());
vi.mock("@/features/leases/lease-collection-actions", () => ({
  recordLeaseCollection: record,
  readLeaseCollectionReceipt: readReceipt,
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

const contract: LeaseContractRow & { commencement_state: "started" } = {
  id: "lease-1",
  unit_id: "unit-1",
  customer_id: "customer-1",
  contract_no: "TEST-LEASE-1",
  start_date: "2026-01-01",
  expected_end_date: "2026-12-31",
  expected_end_confirmed: true,
  actual_end_date: null,
  payment_cycle: "monthly",
  payment_day: 1,
  status: "active",
  rent_currency: "XOF",
  monthly_rent_xof: 600000,
  deposit_amount_xof: 0,
  deposit_received: false,
  rent_free_days: 0,
  signer_name: null,
  attachment_url: null,
  paid_through_date: "2026-08-31",
  commencement_state: "started",
  updated_at: "2026-10-01T00:00:00Z",
  created_at: "2026-01-01T00:00:00Z",
};
const unit = { id: "unit-1", building_id: "building-1", unit_no: "408" } as UnitRow;
const customer = { id: "customer-1", name: "测试客户" } as CustomerRow;
function bill(id = "rent", changes: Partial<ReceivableRow> = {}): ReceivableRow {
  return {
    id,
    building_id: "building-1",
    unit_id: "unit-1",
    customer_id: "customer-1",
    source_type: "lease_contract",
    source_id: "lease-1",
    category: "lease_rent",
    title: id === "rent" ? "九月租金" : id,
    due_date: "2026-09-01",
    amount_xof: 600000,
    paid_amount_xof: 0,
    currency: "XOF",
    status: "pending",
    management_status: "managed",
    service_period_start: "2026-09-01",
    service_period_end: "2026-09-30",
    service_period_source: "confirmed_receipt",
    created_at: "2026-08-01T00:00:00Z",
    updated_at: "2026-09-01T00:00:00Z",
    ...changes,
  };
}
function success(input: LeaseCollectionInput): LeaseCollectionResult {
  return {
    success: true,
    requestId: input.requestId,
    referenceNos: ["SYSTEM-RECEIPT-01"],
    paymentIds: ["payment-real-1"],
    allocations: input.allocations.map(({ receivableId, amount }) => ({ receivableId, amount })),
    currency: input.currency,
    totalAmount: input.amount,
    paidThroughBefore: "2026-08-31",
    paidThroughAfter: input.coverage?.throughDate ?? "2026-08-31",
    ...(input.coverage
      ? {
          coverage: {
            throughDate: input.coverage.throughDate,
            receivableIds: input.coverage.receivableIds,
          },
        }
      : {}),
  };
}

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("crypto", webcrypto);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callback(0);
    return 0;
  });
  sessionStorage.clear();
  record.mockReset();
  readReceipt.mockReset();
  readReceipt.mockResolvedValue({ status: "not_found" });
  record.mockImplementation(async (input) => success(input));
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  sessionStorage.clear();
  vi.unstubAllGlobals();
});
async function render(changes: Partial<LeaseCollectionWorkbenchProps> = {}) {
  await act(async () =>
    root.render(
      <LeaseCollectionWorkbench
        contract={contract}
        unit={unit}
        customer={customer}
        buildingLabel="4号公寓"
        receivables={[bill()]}
        recordedByLabel="Chucke · 管理员"
        viewerId="viewer-1"
        writeReady={true}
        returnHref="/leases?contractId=lease-1"
        locale="zh"
        today="2026-10-20"
        {...changes}
      />,
    ),
  );
}
function amountInput() {
  return host.querySelector<HTMLInputElement>('input[id$="-amount"]')!;
}
function methodInput() {
  return [...host.querySelectorAll<HTMLSelectElement>("select")].find((item) =>
    [...item.options].some((option) => option.value === "cash"),
  )!;
}
function checkbox(title: string) {
  return [...host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].find((input) =>
    input.parentElement?.textContent?.includes(title),
  )!;
}
function button(label: string) {
  const result = [...host.querySelectorAll<HTMLButtonElement>("button")].find(
    (item) => item.textContent === label,
  );
  if (!result) throw new Error(`Missing button ${label}`);
  return result;
}
async function fill(
  input: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement,
  value: string,
) {
  const prototype =
    input instanceof HTMLSelectElement
      ? HTMLSelectElement.prototype
      : input instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(
      new Event(input instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }),
    );
  });
}
async function click(element: HTMLElement) {
  await act(async () => element.click());
}
async function waitForRecordedRequests(count: number) {
  // Native Web Crypto completion is outside React's act queue. Observe the
  // actual action boundary, not a fixed delay or the end of a click handler.
  await act(async () => {
    await vi.waitFor(() => expect(record).toHaveBeenCalledTimes(count), {
      timeout: 2000,
      interval: 10,
    });
  });
}
async function submit() {
  const submitting = () =>
    /^(?:正在核验并入账…|Vérification et enregistrement…)$/.test(
      host.querySelector('button[type="submit"]')?.textContent ?? "",
    );
  const wasSubmitting = submitting();
  const before = record.mock.calls.length;
  await act(async () => {
    host
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  // Observe completion of native hashing through the action boundary. Do not
  // await a deliberately deferred server result or expect a duplicate submit
  // to create a new call: those behaviours are tested independently below.
  if (!wasSubmitting && submitting()) await waitForRecordedRequests(before + 1);
}
async function validDraft() {
  await click(checkbox("九月租金"));
  await fill(amountInput(), "600000");
  await fill(methodInput(), "cash");
  await click(checkbox("我已核实"));
}

describe("independent lease collection workbench", () => {
  it("carries the original contract and identity without inventing amount, method or collector", async () => {
    await render();
    expect(host.querySelector('a[href="/leases?contractId=lease-1"]')).not.toBeNull();
    expect(host.textContent).toContain("4号公寓 · 408");
    expect(host.textContent).toContain("测试客户");
    expect(host.textContent).toContain("TEST-LEASE-1");
    expect(amountInput().value).toBe("");
    expect(methodInput().value).toBe("");
    expect(host.querySelector<HTMLInputElement>('input[type="date"]')?.value).toBe("2026-10-20");
    expect(
      [...host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].every(
        (input) => !input.checked,
      ),
    ).toBe(true);
    expect(host.textContent).toContain("录入人不等于实际收款人");
    expect(host.querySelector<HTMLInputElement>('input[placeholder*="不知道"]')?.value).toBe("");
    expect([...methodInput().options].map((option) => option.value)).not.toContain("offset");
    expect(record).not.toHaveBeenCalled();
  });

  it("does not submit incomplete values or an unconfirmed real receipt", async () => {
    await render();
    await submit();
    expect(record).not.toHaveBeenCalled();
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("请确认这笔钱已经实际收到");
    await click(checkbox("九月租金"));
    await fill(amountInput(), "600000");
    await fill(methodInput(), "cash");
    await submit();
    expect(record).not.toHaveBeenCalled();
  });

  it("allows preview editing but blocks all write paths before the collection service is ready", async () => {
    await render({ writeReady: false });
    expect(host.textContent).toContain("当前收款服务尚未启用，本页可预览核对，不能提交入账。");
    expect(host.querySelector<HTMLFieldSetElement>("fieldset")?.disabled).toBe(false);
    await validDraft();
    expect(amountInput().value).toBe("600000");
    expect(button("确认实收并入账").disabled).toBe(true);
    await submit();
    expect(record).not.toHaveBeenCalled();
    expect(sessionStorage.length).toBe(0);
  });

  it("explains the preview-only readiness boundary in French", async () => {
    await render({ writeReady: false, locale: "fr" });
    expect(host.textContent).toContain("Le service d’encaissement n’est pas encore activé");
    expect(host.querySelector<HTMLFieldSetElement>("fieldset")?.disabled).toBe(false);
    expect(button("Confirmer et enregistrer").disabled).toBe(true);
    expect(record).not.toHaveBeenCalled();
  });

  it("still permits pending receipt lookup while the write service is disabled", async () => {
    const requestId = "11111111-1111-4111-8111-111111111111";
    sessionStorage.setItem(
      "sacsi:finance-request:v1:lease_collection:viewer-1:lease-1",
      JSON.stringify({ requestId, fingerprint: "f".repeat(64) }),
    );
    await render({ writeReady: false });
    expect(button("查询已入账回执").disabled).toBe(false);
    await click(button("查询已入账回执"));
    expect(readReceipt).toHaveBeenCalledExactlyOnceWith(requestId);
    expect(record).not.toHaveBeenCalled();
    expect(sessionStorage.length).toBe(1);
  });

  it("selects an existing bill explicitly but never infers the total received", async () => {
    await render();
    await click(checkbox("九月租金"));
    expect(
      host.querySelector<HTMLInputElement>('input[aria-label="九月租金 本次核销金额"]')?.value,
    ).toBe("600000");
    expect(amountInput().value).toBe("");
    await click(button("用已选合计填写实收"));
    expect(amountInput().value).toBe("600000");
    expect(host.querySelector('[data-balanced="true"]')).not.toBeNull();
    expect(record).not.toHaveBeenCalled();
  });

  it("supports a partial existing-bill allocation and preserves the actual-balance snapshot", async () => {
    await render();
    await validDraft();
    await fill(
      host.querySelector<HTMLInputElement>('input[aria-label="九月租金 本次核销金额"]')!,
      "100000",
    );
    await fill(amountInput(), "100000");
    expect(checkbox("我已核实").checked).toBe(false);
    await click(checkbox("我已核实"));
    await submit();
    expect(record).toHaveBeenCalledTimes(1);
    expect(record.mock.calls[0][0]).toMatchObject({
      amount: 100000,
      currency: "XOF",
      paymentMethod: "cash",
      allocations: [
        {
          receivableId: "rent",
          amount: 100000,
          expectedOutstanding: 600000,
          expectedUpdatedAt: "2026-09-01T00:00:00Z",
        },
      ],
    });
    expect(record.mock.calls[0][0]).not.toHaveProperty("actualCollector");
    expect(record.mock.calls[0][0]).not.toHaveProperty("paidThroughDate");
  });

  it("rejects total differences and over-allocation before calling the action", async () => {
    await render();
    await validDraft();
    await fill(amountInput(), "599999.99");
    await click(checkbox("我已核实"));
    await submit();
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("必须与本次实收完全相等");
    expect(record).not.toHaveBeenCalled();
    await fill(
      host.querySelector<HTMLInputElement>('input[aria-label="九月租金 本次核销金额"]')!,
      "600001",
    );
    await fill(amountInput(), "600001");
    await click(checkbox("我已核实"));
    await submit();
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("超过账单未收余额");
    expect(record).not.toHaveBeenCalled();
  });

  it("requires a real future-safe date and explicit collection method", async () => {
    await render();
    await validDraft();
    await fill(host.querySelector<HTMLInputElement>('input[type="date"]')!, "2026-10-21");
    await click(checkbox("我已核实"));
    await submit();
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("不能晚于今天");
    expect(record).not.toHaveBeenCalled();
  });

  it("shows actual server-confirmed references, record IDs and total, not a predicted receipt", async () => {
    record.mockImplementation(async (input) => ({
      ...success(input),
      success: true,
      requestId: input.requestId,
      totalAmount: 599999,
      paidThroughBefore: "2026-08-31",
      paidThroughAfter: "2026-08-31",
      currency: "XOF",
      referenceNos: ["ACTUAL-REF"],
      paymentIds: ["actual-payment-id"],
      allocations: [{ receivableId: "rent", amount: 599999 }],
    }));
    await render();
    await validDraft();
    await submit();
    expect(host.querySelector('[role="status"]')?.textContent).toContain("已完成入账");
    expect(host.textContent).toContain("599,999 XOF");
    expect(host.textContent).toContain("ACTUAL-REF");
    expect(host.textContent).toContain("actual-payment-id");
    expect([...host.querySelectorAll("a")].map((anchor) => anchor.getAttribute("href"))).toContain(
      "/finance?kind=ledger&search=ACTUAL-REF",
    );
    expect(host.querySelector("form")).toBeNull();
    expect(sessionStorage.length).toBe(0);
  });

  it("prevents double submits and freezes fields while awaiting a server result", async () => {
    let resolve!: (result: LeaseCollectionResult) => void;
    record.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    await render();
    await validDraft();
    await submit();
    await submit();
    expect(record).toHaveBeenCalledTimes(1);
    expect(host.querySelector<HTMLFieldSetElement>("fieldset")?.disabled).toBe(true);
    expect(button("正在核验并入账…").disabled).toBe(true);
    await act(async () => resolve(success(record.mock.calls[0][0])));
    expect(host.textContent).toContain("已完成入账");
  });

  it("retains the identical request on an unknown result and prohibits edited retries", async () => {
    const realDigest = webcrypto.subtle.digest.bind(webcrypto.subtle);
    let releaseRetryDigest!: () => void;
    const retryDigestGate = new Promise<void>((resolve) => {
      releaseRetryDigest = resolve;
    });
    let digestCalls = 0;
    vi.stubGlobal("crypto", {
      randomUUID: webcrypto.randomUUID.bind(webcrypto),
      subtle: {
        async digest(...args: Parameters<typeof realDigest>) {
          digestCalls += 1;
          if (digestCalls === 2) await retryDigestGate;
          return realDigest(...args);
        },
      },
    });
    record.mockResolvedValueOnce({ success: false, rejected: false, error: "网络无法确认" });
    await render();
    await validDraft();
    await submit();
    await waitForRecordedRequests(1);
    const first = record.mock.calls[0][0];
    expect(host.textContent).toContain("暂时无法确认是否已经入账");
    expect(host.querySelector<HTMLFieldSetElement>("fieldset")?.disabled).toBe(true);
    await fill(amountInput(), "1");
    await click(button("按原操作号核对 / 重试"));
    // A completed act(click) does not imply the native SHA-256 has finished.
    // Hold that boundary deliberately to reproduce slow CI worker scheduling.
    expect(digestCalls).toBe(2);
    expect(record).toHaveBeenCalledTimes(1);
    releaseRetryDigest();
    await waitForRecordedRequests(2);
    expect(record).toHaveBeenCalledTimes(2);
    expect(record.mock.calls[1][0]).toEqual(first);
    expect(host.textContent).toContain("已完成入账");
    expect(sessionStorage.length).toBe(0);
  });

  it("treats a thrown transport failure as unknown and safely retries with the original ID", async () => {
    record.mockRejectedValueOnce(new Error("lost transport"));
    await render();
    await validDraft();
    await submit();
    await waitForRecordedRequests(1);
    expect(host.textContent).toContain("结果未知，请勿另起一笔");
    const first = record.mock.calls[0][0];
    await click(button("按原操作号核对 / 重试"));
    await waitForRecordedRequests(2);
    expect(record.mock.calls[1][0]).toEqual(first);
  });

  it("allows correction only after an explicit known rejection, with a new request ID", async () => {
    record.mockResolvedValueOnce({ success: false, rejected: true, error: "账单余额已变化" });
    await render();
    await validDraft();
    await submit();
    const originalId = record.mock.calls[0][0].requestId;
    expect(host.textContent).toContain("本次未提交成功");
    expect(host.querySelector<HTMLFieldSetElement>("fieldset")?.disabled).toBe(false);
    expect(sessionStorage.length).toBe(0);
    await fill(amountInput(), "100000");
    await fill(
      host.querySelector<HTMLInputElement>('input[aria-label="九月租金 本次核销金额"]')!,
      "100000",
    );
    await click(checkbox("我已核实"));
    await submit();
    expect(record.mock.calls[1][0].requestId).not.toBe(originalId);
    expect(record.mock.calls[1][0].amount).toBe(100000);
  });

  it("waits for a gated native digest before reading a known-rejection request ID", async () => {
    record.mockResolvedValueOnce({ success: false, rejected: true, error: "账单余额已变化" });
    await render();
    await validDraft();
    const nativeDigest = webcrypto.subtle.digest.bind(webcrypto.subtle);
    let release!: () => void;
    let started!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const entered = new Promise<void>((resolve) => {
      started = resolve;
    });
    const digestSpy = vi
      .spyOn(webcrypto.subtle, "digest")
      .mockImplementationOnce(async (...args) => {
        started();
        await blocked;
        return nativeDigest(...args);
      });
    try {
      let settled = false;
      const interaction = submit().then(() => {
        settled = true;
      });
      await entered;
      await nativeDigest("SHA-256", new TextEncoder().encode("native-worker-boundary"));
      expect(settled).toBe(false);
      expect(record).not.toHaveBeenCalled();
      release();
      await interaction;
      expect(record).toHaveBeenCalledTimes(1);
      expect(record.mock.calls[0][0].requestId).toMatch(/^[0-9a-f-]{36}$/);
      expect(host.textContent).toContain("本次未提交成功");
      expect(host.querySelector<HTMLFieldSetElement>("fieldset")?.disabled).toBe(false);
      expect(sessionStorage.length).toBe(0);
    } finally {
      release();
      digestSpy.mockRestore();
    }
  });

  it("only changes 万西法 after an explicit unit toggle and preserves the represented sum", async () => {
    await render();
    await fill(amountInput(), "600000");
    await click(button("万西法"));
    expect(amountInput().value).toBe("60");
    expect(host.textContent).toContain("实际入账：600,000 XOF");
    await click(button("XOF"));
    expect(amountInput().value).toBe("600000");
    await click(button("万西法"));
    await fill(amountInput(), "60");
    await click(checkbox("九月租金"));
    await fill(methodInput(), "bank_transfer");
    await click(checkbox("我已核实"));
    await submit();
    expect(record.mock.calls[0][0]).toMatchObject({
      amount: 600000,
      paymentMethod: "bank_transfer",
    });
  });

  it("separates native rent from XOF property fees and clears allocations when currency changes", async () => {
    const nativeContract = { ...contract, rent_currency: "USD" as const };
    await render({
      contract: nativeContract,
      receivables: [
        bill("rent", {
          currency: "USD",
          amount_xof: 0,
          paid_amount_xof: 0,
          amount_native: 1000,
          paid_amount_native: 0,
        }),
        bill("物业费", { category: "property_fee", amount_xof: 40000 }),
      ],
    });
    await click(checkbox("物业费"));
    await fill(amountInput(), "40000");
    await fill(host.querySelector<HTMLSelectElement>("select")!, "USD");
    expect(amountInput().value).toBe("");
    expect(host.textContent).not.toContain("40,000 XOF");
    expect(checkbox("九月租金").checked).toBe(false);
    expect(host.textContent).toContain("按原币入账，不折算为西法");
    expect([...host.querySelectorAll("button")].some((item) => item.textContent === "万西法")).toBe(
      false,
    );
    await click(checkbox("九月租金"));
    await fill(amountInput(), "1000");
    await fill(methodInput(), "cash");
    await click(checkbox("我已核实"));
    await submit();
    expect(record.mock.calls[0][0]).toMatchObject({
      currency: "USD",
      amount: 1000,
      allocations: [{ receivableId: "rent", amount: 1000 }],
    });
    expect(record.mock.calls[0][0]).not.toHaveProperty("exchangeRateToXof");
  });

  it("does not turn a due date into a missing service period", async () => {
    await render({
      receivables: [bill("rent", { service_period_start: null, service_period_end: null })],
    });
    expect(host.textContent).toContain("账期待确认");
    expect(host.textContent).toContain("到期日 2026-09-01");
    expect(host.textContent).not.toContain("2026-09-01 —");
  });

  it("retains a verified service-period end when only its start is unknown", async () => {
    await render({
      receivables: [bill("rent", { service_period_start: null, service_period_end: "2026-09-30" })],
    });
    expect(host.textContent).toContain("开始待确认 — 2026-09-30");
    expect(checkbox("九月租金")).not.toBeUndefined();
    expect(host.textContent).not.toContain("没有可核销");
  });

  it("does not offer historical, closed or contradictory bills and never writes when none are usable", async () => {
    await render({
      receivables: [
        bill("old", { management_status: "historical_pending" }),
        bill("paid", { status: "paid", paid_amount_xof: 600000 }),
        bill("wrong", { customer_id: "somebody-else" }),
      ],
    });
    expect(host.textContent).toContain("没有可核销的 XOF 账单");
    expect(button("确认实收并入账").disabled).toBe(true);
    expect(record).not.toHaveBeenCalled();
    expect(host.textContent).toContain("1 笔币种、金额或归属资料待核");
  });

  it("keeps additional bills compact but allows explicitly expanding every existing bill", async () => {
    await render({ receivables: Array.from({ length: 5 }, (_, index) => bill(`bill-${index}`)) });
    expect(host.querySelectorAll('input[type="checkbox"]').length).toBe(5);
    await click(button("查看全部 5 笔账单"));
    expect(host.querySelectorAll('input[type="checkbox"]').length).toBe(7);
    await click(checkbox("bill-4"));
    await click(button("收起未选账单"));
    expect(checkbox("bill-4")).not.toBeUndefined();
  });

  it("requires evidence for an explicitly named collector and keeps recording identity separate", async () => {
    await render();
    await validDraft();
    await fill(host.querySelector<HTMLInputElement>('input[placeholder*="不知道"]')!, "颖");
    await click(checkbox("我已核实"));
    await submit();
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("也请说明核实依据");
    expect(record).not.toHaveBeenCalled();
    await fill(
      host.querySelector<HTMLInputElement>('input[placeholder*="收据签名"]')!,
      "群内原始收据签名",
    );
    await click(checkbox("我已核实"));
    await submit();
    expect(record.mock.calls[0][0]).toMatchObject({
      actualCollector: "颖",
      collectorBasis: "群内原始收据签名",
    });
    expect(record.mock.calls[0][0]).not.toHaveProperty("recordedByLabel");
  });

  it("never updates contract coverage just because a fully paid contiguous period is available", async () => {
    await render();
    expect(checkbox("同时更新租金登记覆盖日期").disabled).toBe(true);
    await validDraft();
    const sync = checkbox("同时更新租金登记覆盖日期");
    expect(sync.disabled).toBe(false);
    expect(sync.checked).toBe(false);
    expect(host.textContent).toContain("2026-08-31");
    expect(host.textContent).toContain("2026-09-30");
    await submit();
    expect(record.mock.calls[0][0]).not.toHaveProperty("coverage");
    expect(host.textContent).toContain("登记覆盖日期未变更");
    expect(host.textContent).toContain("下期账单安排待确认，本次未生成新应收");
  });

  it("only submits the optional coverage proof after an explicit checkbox confirmation", async () => {
    await render();
    await validDraft();
    await click(checkbox("同时更新租金登记覆盖日期"));
    expect(checkbox("我已核实").checked).toBe(false);
    await click(checkbox("我已核实"));
    await submit();
    expect(record.mock.calls[0][0]).toMatchObject({
      coverage: {
        expectedPaidThroughDate: "2026-08-31",
        expectedContractUpdatedAt: "2026-10-01T00:00:00Z",
        throughDate: "2026-09-30",
        receivableIds: ["rent"],
      },
    });
    const after = [...host.querySelectorAll("dt")].find(
      (node) => node.textContent === "入账后登记覆盖至",
    )?.nextElementSibling;
    expect(after?.textContent).toBe("2026-09-30");
    expect(host.textContent).toContain("登记覆盖日期已按本次核实的完整账期同步");
  });

  it("removes coverage opt-in whenever the allocation is edited", async () => {
    await render();
    await validDraft();
    await click(checkbox("同时更新租金登记覆盖日期"));
    expect(checkbox("同时更新租金登记覆盖日期").checked).toBe(true);
    await fill(
      host.querySelector<HTMLInputElement>('input[aria-label="九月租金 本次核销金额"]')!,
      "100000",
    );
    expect(checkbox("同时更新租金登记覆盖日期").checked).toBe(false);
    expect(checkbox("同时更新租金登记覆盖日期").disabled).toBe(true);
    await fill(amountInput(), "100000");
    await click(checkbox("我已核实"));
    await submit();
    expect(record.mock.calls[0][0].amount).toBe(100000);
    expect(record.mock.calls[0][0]).not.toHaveProperty("coverage");
  });

  it.each([
    { service_period_start: null, service_period_end: null },
    { service_period_start: null, service_period_end: "2026-09-30" },
    { service_period_source: null },
    { service_period_start: "2026-09-02" },
  ] as Partial<ReceivableRow>[])(
    "still collects verified money without advancing unknown or discontinuous coverage: %j",
    async (changes) => {
      await render({ receivables: [bill("rent", changes)] });
      await validDraft();
      expect(checkbox("同时更新租金登记覆盖日期").disabled).toBe(true);
      expect(host.textContent).toContain("不满足时仍可登记实收");
      await submit();
      expect(record).toHaveBeenCalledTimes(1);
      expect(record.mock.calls[0][0]).not.toHaveProperty("coverage");
    },
  );

  it("does not advance rent coverage for property-fee-only collections", async () => {
    await render({
      receivables: [
        bill("fee", { category: "property_fee", title: "九月物业费", amount_xof: 40000 }),
      ],
    });
    await click(checkbox("九月物业费"));
    await fill(amountInput(), "40000");
    await fill(methodInput(), "cash");
    expect(checkbox("同时更新租金登记覆盖日期").disabled).toBe(true);
    await click(checkbox("我已核实"));
    await submit();
    expect(record.mock.calls[0][0]).not.toHaveProperty("coverage");
  });

  it("only displays the persisted server coverage on recovery, not the now-changed contract", async () => {
    const requestId = "11111111-1111-4111-8111-111111111111";
    sessionStorage.setItem(
      "sacsi:finance-request:v1:lease_collection:viewer-1:lease-1",
      JSON.stringify({ requestId, fingerprint: "f".repeat(64) }),
    );
    readReceipt.mockResolvedValue({
      status: "found",
      contractId: contract.id,
      receipt: {
        success: true,
        requestId,
        referenceNos: ["SAVED-RECEIPT"],
        paymentIds: ["saved-payment"],
        allocations: [{ receivableId: "rent", amount: 600000 }],
        currency: "XOF",
        totalAmount: 600000,
        paidThroughBefore: "2026-08-31",
        paidThroughAfter: "2026-09-30",
        coverage: { throughDate: "2026-09-30", receivableIds: ["rent"] },
      },
    });
    await render({
      contract: { ...contract, paid_through_date: "2026-10-31" },
      receivables: [bill("rent", { status: "paid", paid_amount_xof: 600000 })],
    });
    await click(button("查询已入账回执"));
    const after = [...host.querySelectorAll("dt")].find(
      (node) => node.textContent === "入账后登记覆盖至",
    )?.nextElementSibling;
    expect(after?.textContent).toBe("2026-09-30");
    expect(host.textContent).not.toContain("2026-10-31");
    expect(record).not.toHaveBeenCalled();
  });

  it("localizes the optional coverage and actual receipt dates in French", async () => {
    await render({ locale: "fr" });
    await click(checkbox("九月租金"));
    await fill(amountInput(), "600000");
    await fill(methodInput(), "cash");
    expect(checkbox("Mettre aussi à jour la couverture du loyer").checked).toBe(false);
    await click(checkbox("Mettre aussi à jour la couverture du loyer"));
    await click(checkbox("Je confirme"));
    await submit();
    expect(record.mock.calls[0][0].coverage?.throughDate).toBe("2026-09-30");
    expect(host.textContent).toContain("Couverture enregistrée après");
    expect(host.textContent).toContain("aucune nouvelle créance n’a été créée");
  });

  it("resets the draft when navigating to a different contract", async () => {
    await render();
    await validDraft();
    await render({ contract: { ...contract, id: "lease-2" }, receivables: [] });
    expect(amountInput().value).toBe("");
    expect(methodInput().value).toBe("");
    expect(checkbox("我已核实").checked).toBe(false);
  });

  it("localizes the real workflow and finance return route in French", async () => {
    await render({
      locale: "fr",
      customer: { ...customer, name: "Client test" },
      receivables: [bill("rent", { title: "Loyer septembre" })],
    });
    expect(host.textContent).toContain("Enregistrer un encaissement vérifié");
    expect(host.textContent).toContain("L’opérateur n’est pas nécessairement l’encaisseur");
    expect(methodInput().value).toBe("");
    await click(checkbox("Loyer septembre"));
    await fill(amountInput(), "600000");
    await fill(methodInput(), "cash");
    await click(checkbox("Je confirme"));
    await submit();
    expect(host.textContent).toContain("Encaissement enregistré");
    expect([...host.querySelectorAll("a")].map((anchor) => anchor.getAttribute("href"))).toContain(
      "/fr/finance?kind=ledger&search=SYSTEM-RECEIPT-01",
    );
  });

  it.each([
    ["0.29", "0.000029"],
    ["0.01", "0.000001"],
    ["999999999999.99", "99999999.999999"],
  ])("switches %s base units to 万 losslessly", async (base, wan) => {
    await render();
    await fill(amountInput(), base);
    await click(button("万西法"));
    expect(amountInput().value).toBe(wan);
    await click(button("XOF"));
    expect(amountInput().value).toBe(base);
  });

  it("restores a persisted receipt after a lost response and changed receivable balances, without a second payment", async () => {
    record.mockRejectedValueOnce(new Error("response was lost after commit"));
    await render();
    await validDraft();
    await submit();
    expect(record).toHaveBeenCalledTimes(1);
    const original = record.mock.calls[0][0];
    const confirmedReceipt = success(original);
    readReceipt.mockResolvedValue({
      status: "found",
      contractId: contract.id,
      receipt: confirmedReceipt,
    });
    await act(async () => root.unmount());
    root = createRoot(host);
    await render({ receivables: [bill("rent", { status: "paid", paid_amount_xof: 600000 })] });
    expect(host.textContent).toContain("检测到一笔结果尚未核实的收款操作");
    expect(host.querySelector<HTMLFieldSetElement>("fieldset")?.disabled).toBe(true);
    expect(
      [...host.querySelectorAll("button")].some(
        (item) => item.textContent === "按原操作号核对 / 重试",
      ),
    ).toBe(false);
    await submit();
    expect(record).toHaveBeenCalledTimes(1);
    await click(button("查询已入账回执"));
    expect(readReceipt).toHaveBeenCalledExactlyOnceWith(original.requestId);
    expect(host.textContent).toContain("已完成入账");
    expect(host.textContent).toContain("SYSTEM-RECEIPT-01");
    expect(host.textContent).toContain("payment-real-1");
    expect(sessionStorage.length).toBe(0);
    expect(record).toHaveBeenCalledTimes(1);
  });

  it("never interprets a not-found receipt as permission to clear the pending request or write another payment", async () => {
    const requestId = "11111111-1111-4111-8111-111111111111";
    const key = "sacsi:finance-request:v1:lease_collection:viewer-1:lease-1";
    sessionStorage.setItem(key, JSON.stringify({ requestId, fingerprint: "f".repeat(64) }));
    await render();
    await click(button("查询已入账回执"));
    expect(host.textContent).toContain("这不代表没有入账");
    expect(sessionStorage.getItem(key)).not.toBeNull();
    expect(host.querySelector<HTMLFieldSetElement>("fieldset")?.disabled).toBe(true);
    await submit();
    expect(record).not.toHaveBeenCalled();
  });

  it.each(["wrong-contract", "wrong-request"])(
    "keeps the pending lock for a %s recovery response",
    async (caseName) => {
      const requestId = "11111111-1111-4111-8111-111111111111";
      const key = "sacsi:finance-request:v1:lease_collection:viewer-1:lease-1";
      sessionStorage.setItem(key, JSON.stringify({ requestId, fingerprint: "f".repeat(64) }));
      readReceipt.mockResolvedValue({
        status: "found",
        contractId: caseName === "wrong-contract" ? "another-contract" : contract.id,
        receipt: {
          success: true,
          requestId:
            caseName === "wrong-request" ? "22222222-2222-4222-8222-222222222222" : requestId,
          referenceNos: ["WRONG-REF"],
          paymentIds: ["WRONG-PAYMENT"],
          allocations: [],
          currency: "XOF",
          totalAmount: 600000,
          paidThroughBefore: "2026-08-31",
          paidThroughAfter: "2026-08-31",
        },
      });
      await render();
      await click(button("查询已入账回执"));
      expect(host.textContent).toContain("回执与当前合同或操作号不一致");
      expect(host.textContent).not.toContain("WRONG-REF");
      expect(sessionStorage.getItem(key)).not.toBeNull();
      expect(host.querySelector<HTMLFieldSetElement>("fieldset")?.disabled).toBe(true);
      expect(record).not.toHaveBeenCalled();
    },
  );

  it("preserves the pending identity on receipt-service failure", async () => {
    const key = "sacsi:finance-request:v1:lease_collection:viewer-1:lease-1";
    sessionStorage.setItem(
      key,
      JSON.stringify({
        requestId: "11111111-1111-4111-8111-111111111111",
        fingerprint: "f".repeat(64),
      }),
    );
    readReceipt.mockRejectedValue(new Error("network lost"));
    await render();
    await click(button("查询已入账回执"));
    expect(host.textContent).toContain("原操作号已保留");
    expect(sessionStorage.getItem(key)).not.toBeNull();
    expect(record).not.toHaveBeenCalled();
  });

  it("isolates pending identities and form state by the real logged-in account", async () => {
    const key = "sacsi:finance-request:v1:lease_collection:viewer-1:lease-1";
    sessionStorage.setItem(
      key,
      JSON.stringify({
        requestId: "11111111-1111-4111-8111-111111111111",
        fingerprint: "f".repeat(64),
      }),
    );
    await render({ viewerId: "viewer-2" });
    expect(host.querySelector<HTMLFieldSetElement>("fieldset")?.disabled).toBe(false);
    expect(host.textContent).not.toContain("检测到一笔结果尚未核实");
    await validDraft();
    await render({ viewerId: "viewer-1" });
    expect(host.querySelector<HTMLFieldSetElement>("fieldset")?.disabled).toBe(true);
    expect(amountInput().value).toBe("");
    expect(host.textContent).toContain("检测到一笔结果尚未核实");
    expect(sessionStorage.getItem(key)).not.toBeNull();
    expect(readReceipt).not.toHaveBeenCalled();
    expect(record).not.toHaveBeenCalled();
  });

  it("fails closed on corrupted pending identity without deleting it", async () => {
    const key = "sacsi:finance-request:v1:lease_collection:viewer-1:lease-1";
    sessionStorage.setItem(key, "corrupted request identity");
    await render();
    expect(host.textContent).toContain("本地未完成操作标识无法安全读取");
    expect(host.querySelector<HTMLFieldSetElement>("fieldset")?.disabled).toBe(true);
    expect(sessionStorage.getItem(key)).toBe("corrupted request identity");
    expect(readReceipt).not.toHaveBeenCalled();
    expect(record).not.toHaveBeenCalled();
  });
});

describe("read-only account-scoped pending identity", () => {
  it("reads exactly this account and contract, without storing form values", () => {
    const requestId = "11111111-1111-4111-8111-111111111111";
    const storage = {
      getItem: vi.fn(() => JSON.stringify({ requestId, fingerprint: "a".repeat(64) })),
    };
    expect(readLeaseCollectionPending("viewer-1", "lease-1", storage)).toEqual({
      status: "pending",
      requestId,
    });
    expect(storage.getItem).toHaveBeenCalledExactlyOnceWith(
      "sacsi:finance-request:v1:lease_collection:viewer-1:lease-1",
    );
  });
  it.each([
    "null",
    "[]",
    "{}",
    '{"requestId":"bad"}',
    JSON.stringify({ requestId: "11111111-1111-4111-8111-111111111111", fingerprint: "bad" }),
  ])("rejects malformed pending record %s", (raw) => {
    expect(readLeaseCollectionPending("viewer-1", "lease-1", { getItem: () => raw })).toEqual({
      status: "unavailable",
    });
  });
  it("handles missing and unavailable storage conservatively", () => {
    expect(readLeaseCollectionPending("viewer-1", "lease-1", { getItem: () => null })).toEqual({
      status: "none",
    });
    expect(
      readLeaseCollectionPending("viewer-1", "lease-1", {
        getItem: () => {
          throw new Error("storage blocked");
        },
      }),
    ).toEqual({ status: "unavailable" });
  });
});
