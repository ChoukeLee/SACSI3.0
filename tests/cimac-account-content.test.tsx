// @vitest-environment jsdom
import React, { act } from "react";
import { webcrypto } from "node:crypto";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  CimacAccountContent,
  type CimacAccountContentProps,
} from "@/features/finance/cimac-account-content";
import { cimacBillingHref } from "@/features/finance/cimac-billing-query";
import type { CimacCustomerAccount } from "@/features/finance/cimac-billing-types";

const api = vi.hoisted(() => ({
  receipt: vi.fn(),
  position: vi.fn(),
  collection: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: api.refresh }) }));
vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    prefetch: _,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; prefetch?: boolean }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));
vi.mock("@/features/finance/cimac-billing-actions", () => ({
  recordCimacCollection: api.collection,
  saveCimacFeeTerms: vi.fn(),
  saveCimacMeterReading: vi.fn(),
  readCimacWriteReceipt: api.receipt,
  readCimacCollectionPosition: api.position,
  recordCimacRefund: vi.fn(),
  reverseCimacCollection: vi.fn(),
}));
const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const customerId = id(1),
  viewerId = id(2),
  contractId = id(3),
  unitId = id(4),
  billId = id(5),
  paymentId = id(6),
  projectId = id(7);
const stamp = "2026-10-24T10:00:00Z",
  today = "2026-10-25";
const workspace = `/cimac/customers/${customerId}`;
function account(): CimacCustomerAccount {
  const customer = {
    id: customerId,
    name: "独立客户",
    phone: null,
    unitCount: 1,
    contractCount: 1,
    pendingCount: 1,
    balances: [],
  };
  return {
    project: { id: projectId, code: "CIMAC", display_name: "CIMAC" },
    canWrite: true,
    complete: true,
    customerPage: { rows: [customer], page: 1, pageSize: 50, total: 1 },
    selectedCustomerId: customerId,
    customer,
    units: [
      {
        id: unitId,
        building_id: projectId,
        code: "A-101",
        unit_no: "A-101",
        floor_label: "1F",
        kind: "apartment",
        status: "leased",
        area_sqm: null,
        layout: null,
        furnishing: null,
        notes: null,
        created_at: stamp,
        updated_at: stamp,
        building_code: "A",
        building_label: "A",
      },
    ],
    contracts: [
      {
        kind: "lease",
        id: contractId,
        unitId,
        customerId,
        contractNo: "L-NATIVE",
        status: "active",
        data: {
          id: contractId,
          unit_id: unitId,
          customer_id: customerId,
          contract_no: "L-NATIVE",
          start_date: "2026-01-01",
          expected_end_date: "2027-01-01",
          actual_end_date: null,
          payment_cycle: "monthly",
          payment_day: 1,
          monthly_rent_xof: 0,
          rent_currency: "USD",
          monthly_rent_amount: 100,
          deposit_amount_xof: 0,
          deposit_received: false,
          rent_free_days: 0,
          signer_name: null,
          attachment_url: null,
          status: "active",
          created_at: stamp,
          updated_at: stamp,
        },
      },
    ],
    receivables: [
      {
        id: billId,
        building_id: projectId,
        unit_id: unitId,
        customer_id: customerId,
        source_type: "lease_contract",
        source_id: contractId,
        category: "lease_rent",
        title: "原币旧账",
        due_date: "2026-10-01",
        amount_xof: 0,
        paid_amount_xof: 0,
        amount_native: 100,
        paid_amount_native: 0,
        currency: "USD",
        status: "pending",
        management_status: "managed",
        outstanding: "100",
        collectible: false,
        created_at: stamp,
        updated_at: stamp,
      },
    ],
    payments: [
      {
        id: paymentId,
        customer_id: customerId,
        unit_id: null,
        source_type: "cimac_customer_collection",
        source_id: customerId,
        payment_date: "2026-10-24",
        amount: 1000,
        currency: "XOF",
        exchange_rate_to_xof: 1,
        receipt_no: "CIMAC-ORIGINAL",
        notes: null,
        recorded_by: viewerId,
        created_at: stamp,
        protected_collection: true,
      },
    ],
    allocations: [],
    feeTerms: [],
    meterReadings: [],
  };
}
let root: Root, host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("crypto", webcrypto);
  sessionStorage.clear();
  vi.clearAllMocks();
  api.receipt.mockResolvedValue({ status: "not_found" });
  window.history.replaceState({ nextState: "keep" }, "", `${workspace}?tab=account`);
  Element.prototype.scrollIntoView = vi.fn();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
async function render(patch: Partial<CimacAccountContentProps> = {}) {
  await act(async () =>
    root.render(
      <CimacAccountContent
        data={account()}
        locale="zh"
        viewerId={viewerId}
        canWrite
        today={today}
        baseHref={workspace}
        {...patch}
      />,
    ),
  );
}
function button(text: string) {
  const value = [...host.querySelectorAll("button")].find((x) => x.textContent === text);
  if (!value) throw new Error(`Missing button ${text}`);
  return value;
}
async function click(element: Element) {
  await act(async () => element.dispatchEvent(new MouseEvent("click", { bubbles: true })));
}

it("renders account sections without nesting the old page shell, directory or customer summary", async () => {
  await render();
  expect(host.querySelector("h1")).toBeNull();
  expect(host.querySelector("aside")).toBeNull();
  expect(host.querySelector('[aria-label="客户账户汇总"]')).toBeNull();
  expect(host.querySelector('[aria-label="客户收费工作视图"]')).not.toBeNull();
  expect(host.querySelectorAll('button[role="tab"]')).toHaveLength(4);
  expect(host.textContent).toContain("L-NATIVE");
  expect(host.textContent).toContain("USD");
});
it("preserves fixed customer, account view and selected subtab in URL across refresh/remount", async () => {
  await render();
  await click(button("水电抄表"));
  const url = new URL(window.location.href);
  expect(url.pathname).toBe(workspace);
  expect(url.searchParams.get("tab")).toBe("account");
  expect(url.searchParams.get("accountTab")).toBe("meters");
  expect(window.history.state).toEqual({ nextState: "keep" });
  await act(async () => root.unmount());
  root = createRoot(host);
  await render({ tab: "meters" });
  expect(button("水电抄表").getAttribute("aria-selected")).toBe("true");
  expect(host.textContent).toContain("月度水电抄表");
  await click(button("规则与约定"));
  expect(new URL(window.location.href).searchParams.get("accountTab")).toBe("rules");
});
it("preserves authorized building and safe return context when switching account subtabs", async () => {
  const returnTo = `/cimac/customers?building=${projectId}`;
  await render({ building: projectId, returnTo });
  await click(button("规则与约定"));
  const url = new URL(window.location.href);
  expect(url.pathname).toBe(workspace);
  expect(url.searchParams.get("building")).toBe(projectId);
  expect(url.searchParams.get("returnTo")).toBe(returnTo);
  await render({ tab: "receipts", building: projectId, returnTo });
  expect(button("收款核销").getAttribute("aria-selected")).toBe("true");
  expect(host.textContent).toContain("CIMAC-ORIGINAL");
});
it("retains keyboard-accessible tabs and the same explicit billing forms", async () => {
  await render();
  await act(async () =>
    button("收费账单").dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true })),
  );
  expect(button("规则与约定").getAttribute("aria-selected")).toBe("true");
  expect(host.textContent).toContain("约定");
  expect(host.textContent).toContain("待核");
  await click(button("水电抄表"));
  await click(button("登记抄表"));
  expect(host.querySelector("form")).not.toBeNull();
  expect(api.collection).not.toHaveBeenCalled();
});
it.each([{ canWrite: false }, { data: { ...account(), canWrite: false } }])(
  "requires both server permission and account permission for all financial writes",
  async (patch) => {
    await render(patch);
    expect(
      [...host.querySelectorAll("button")].some((x) => x.textContent === "登记收款与分账"),
    ).toBe(false);
    await click(button("水电抄表"));
    expect([...host.querySelectorAll("button")].some((x) => x.textContent === "登记抄表")).toBe(
      false,
    );
    await click(button("规则与约定"));
    expect(host.querySelector("form")).toBeNull();
    expect(api.collection).not.toHaveBeenCalled();
  },
);
it("shares the original-receipt refund/reversal chain and preserves native-currency contract return links", async () => {
  await render({ tab: "receipts" });
  expect(host.textContent).toContain("CIMAC-ORIGINAL");
  expect(host.textContent).toContain("不能使用旧单房修改、退款或冲正入口");
  expect(host.textContent).toContain("退款");
  expect(host.textContent).toContain("冲正");
  expect(host.textContent).toContain("押金单独核算");
  const link = host.querySelector<HTMLAnchorElement>(
    `a[href*="/cimac/contracts/${contractId}/collect"]`,
  )!;
  expect(link).not.toBeNull();
  expect(new URL(link.href).searchParams.get("returnTo")).toBe(
    `${workspace}?tab=account&accountTab=receipts`,
  );
});
it("preserves an unknown write's actor/customer lock on reopening without unlocking another identity", async () => {
  const requestId = id(8);
  sessionStorage.setItem(
    `sacsi:finance-request:v1:cimac_collection:${viewerId}:${customerId}`,
    JSON.stringify({ requestId, fingerprint: "a".repeat(64) }),
  );
  await render();
  await click(button("登记收款与分账"));
  expect(host.textContent).toContain("检测到未核实的操作结果");
  expect(host.querySelector("fieldset")?.disabled).toBe(true);
  await render({ viewerId: id(9) });
  await click(button("登记收款与分账"));
  expect(host.querySelector("fieldset")?.disabled).toBe(false);
  expect(
    sessionStorage.getItem(`sacsi:finance-request:v1:cimac_collection:${viewerId}:${customerId}`),
  ).not.toBeNull();
});
it("does not invent an account or zero when selected customer facts are missing/mismatched", async () => {
  await render({ data: { ...account(), customer: null } });
  expect(host.textContent).toContain("不显示虚构余额");
  expect(host.querySelector('[role="tablist"]')).toBeNull();
  await render({ data: { ...account(), selectedCustomerId: id(9) } });
  expect(host.querySelector('[role="tablist"]')).toBeNull();
});
it("keeps legacy finance URLs by default and rejects foreign or different-customer workspace bases", () => {
  const query = { customerId, search: "", customerPage: 1, tab: "receipts" as const };
  expect(cimacBillingHref(query, "zh")).toBe(
    `/finance?view=customers&customerId=${customerId}&tab=receipts`,
  );
  expect(cimacBillingHref(query, "fr", {}, `/fr${workspace}`)).toBe(
    `/fr${workspace}?tab=account&accountTab=receipts`,
  );
  for (const path of [
    `/cimac/customers/${id(9)}`,
    "https://evil.invalid/cimac/customers/" + customerId,
    "//evil.invalid",
    "/finance",
  ])
    expect(() => cimacBillingHref(query, "zh", {}, path)).toThrow("InvalidCimacBillingQuery");
});
