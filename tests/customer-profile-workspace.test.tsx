// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { CustomerProfileData } from "@/features/customers/customer-profile-service";
import { customerDirectoryFixture, directoryIds } from "./fixtures/customer-directory";

const mocks = vi.hoisted(() => ({ refresh: vi.fn(), print: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("@/features/documents/templates/all-templates", () => ({
  printDocumentRecord: mocks.print,
}));
vi.mock("@/components/attachments/receipt-thumb", () => ({
  ReceiptThumb: () => <span>Original receipt</span>,
}));
vi.mock("@/features/customers/customer-workbench-form", () => ({
  CustomerWorkbenchForm: ({
    profile,
    onClose,
    onSaved,
  }: {
    profile: { id: string; name: string };
    onClose: () => void;
    onSaved: (id: string, created: boolean) => void;
  }) => (
    <section role="dialog" aria-label="Edit coordinates">
      <p>{profile.name}</p>
      <button onClick={onClose}>Cancel edit</button>
      <button onClick={() => onSaved(profile.id, false)}>Saved fixture</button>
    </section>
  ),
}));
import { CustomerProfileView } from "@/features/customers/customer-profile-view";

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
function fixture(): CustomerProfileData {
  return {
    customer: {
      ...customerDirectoryFixture("detail").profile,
      phone: "Unique phone 123",
      notes: "Unique source note",
      encrypted_document_no: "NEVER-RENDER-THIS",
    },
    units: [
      {
        id: directoryIds.unit,
        building_id: directoryIds.building,
        unit_no: "101",
        kind: "apartment",
      },
    ],
    dailyBookings: [],
    agentBookings: [
      {
        id: directoryIds.booking,
        unit_id: directoryIds.unit,
        status: "checked_in",
        check_in: "2026-10-19",
        total_amount_xof: 100,
      },
    ],
    unresolvedBookings: [
      {
        id: "unknown",
        unit_id: directoryIds.unit,
        status: "checked_out",
        check_in: "2026-10-18",
        total_amount_xof: 200,
      },
    ],
    leaseContracts: [
      {
        id: directoryIds.other,
        unit_id: directoryIds.unit,
        contract_no: "LEASE-101",
        status: "active",
        start_date: "2026-10-01",
        expected_end_date: "2027-10-01",
        monthly_rent_xof: 600000,
      },
    ],
    saleContracts: [
      {
        id: directoryIds.sale,
        unit_id: directoryIds.unit,
        contract_no: "SALE-101",
        status: "active",
        signed_date: "2026-10-01",
        total_amount_xof: 9000000,
      },
    ],
    receivables: [],
    payments: Array.from({ length: 30 }, (_, i) => ({
      id: `p-${i}`,
      payment_date: "2026-10-19",
      amount: 1200 + i,
      currency: "CNY",
      exchange_rate_to_xof: 90,
      receipt_no: `Original-${i}`,
    })),
    auditLogs: [],
    attachments: [{ id: "attachment", storage_path: "fixture", file_type: "image/jpeg" }],
  } as unknown as CustomerProfileData;
}
async function render(
  data = fixture(),
  userRole = "admin",
  locale: "zh" | "fr" = "zh",
  returnTo = "/customers?project=__unassigned__&q=source",
) {
  await act(async () =>
    root.render(
      <CustomerProfileView data={data} locale={locale} userRole={userRole} returnTo={returnTo} />,
    ),
  );
}
async function click(text: string) {
  const target = [...host.querySelectorAll("button")].find((button) =>
    button.textContent?.startsWith(text),
  );
  expect(target, text).toBeTruthy();
  await act(async () => target!.click());
}
it("has one identity area and preserves the exact directory scope as the prominent return link", async () => {
  await render();
  expect(host.querySelectorAll("h1")).toHaveLength(1);
  expect(host.querySelectorAll("aside")).toHaveLength(1);
  expect(host.textContent?.match(/Unique phone 123/g)).toHaveLength(1);
  expect(host.textContent?.match(/Unique source note/g)).toHaveLength(1);
  expect(host.textContent).not.toContain("NEVER-RENDER-THIS");
  expect(host.querySelector("a")?.getAttribute("href")).toBe(
    "/customers?project=__unassigned__&q=source",
  );
  expect(host.querySelector('[role="dialog"]')).toBeNull();
});
it("links a history record to the exact contract and back to this profile instead of a generic old page", async () => {
  await render();
  await click("长租");
  const lease = new URL(
    host.querySelector('[role="tabpanel"] a')!.getAttribute("href")!,
    "https://example.invalid",
  );
  expect(lease.pathname).toBe("/leases");
  expect(lease.searchParams.get("contract")).toBe(directoryIds.other);
  expect(lease.searchParams.get("building")).toBe(directoryIds.building);
  expect(lease.searchParams.get("returnTo")).toBe(`/customers/${directoryIds.customer}`);
  await click("出售");
  const sale = new URL(
    host.querySelector('[role="tabpanel"] a')!.getAttribute("href")!,
    "https://example.invalid",
  );
  expect(sale.searchParams.get("contract")).toBe(directoryIds.sale);
});
it("keeps paginated payments, original currency, attachments and original print action reachable", async () => {
  await render();
  await click("财务");
  expect(host.textContent).toContain("¥1,200");
  expect(host.textContent).toContain("Original receipt");
  expect(host.querySelectorAll("tbody tr")).toHaveLength(25);
  await click("下一页");
  expect(host.querySelectorAll("tbody tr")).toHaveLength(5);
  await click("单据");
  expect(host.querySelectorAll("tbody tr")).toHaveLength(2);
  await click("打印");
  expect(mocks.print).toHaveBeenCalledWith(
    expect.objectContaining({ id: `doc_lease_${directoryIds.other}` }),
    "zh",
  );
});
it("keeps guests, agents and unknown historical identity separate", async () => {
  await render();
  await click("经办记录");
  expect(host.textContent).toContain("不代表本人入住或实际收款");
  await click("身份待核");
  expect(host.textContent).toContain("暂不计入住客业务数和单据");
  await click("日租");
  expect(host.querySelectorAll("tbody tr")).toHaveLength(0);
});
it.each(["boss", "front_desk", "unknown"])(
  "does not expose editing for read-only role %s",
  async (role) => {
    await render(fixture(), role);
    expect(host.textContent).not.toContain("编辑资料");
  },
);
it("opens only the shared focused editor, closes without refresh, and refreshes after saved confirmation", async () => {
  await render();
  await click("编辑资料");
  expect(host.querySelectorAll('[role="dialog"]')).toHaveLength(1);
  await click("Cancel edit");
  expect(mocks.refresh).not.toHaveBeenCalled();
  await click("编辑资料");
  await click("Saved fixture");
  expect(mocks.refresh).toHaveBeenCalledOnce();
  expect(host.querySelector('[role="dialog"]')).toBeNull();
});
it("does not carry an open editor onto a different customer", async () => {
  await render();
  await click("编辑资料");
  const next = fixture();
  next.customer = { ...next.customer, id: directoryIds.other, name: "Different customer" };
  await render(next);
  expect(host.querySelector('[role="dialog"]')).toBeNull();
});
it("supports keyboard tabs, French labels, safe fallback return and disappearing optional tabs", async () => {
  await render(fixture(), "boss", "fr", "https://evil.invalid");
  expect(host.querySelector("a")?.getAttribute("href")).toBe("/fr/customers");
  const first = host.querySelector('[role="tab"]')!;
  await act(async () =>
    first.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true })),
  );
  expect(host.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe("Audit0");
  expect(document.activeElement).toBe(host.querySelector('[role="tab"][aria-selected="true"]'));
  await click("Dossiers gérés");
  const next = fixture();
  next.agentBookings = [];
  await render(next, "boss", "fr");
  expect(host.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe("Aperçu");
});
