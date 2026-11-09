// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LeaseRoomOverview } from "@/features/leases/lease-room-overview";
import {
  buildLeaseRoomOverview,
  buildLeaseRecordOverview,
} from "@/features/leases/lease-room-overview-model";
import { workspaceFixture } from "./fixtures/contract-workspace";
import type { LeaseContractRow, ReceivableRow } from "@/types/database";

let host: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
it.each(["XOF", "USD"] as const)(
  "keeps %s room rent and follow-up values in their display unit without changing source amounts",
  async (currency) => {
    const fixture = workspaceFixture();
    const contract: LeaseContractRow = {
      ...(fixture.contracts[0] as LeaseContractRow),
      status: "active",
      start_date: "2026-01-01",
      expected_end_date: "2027-12-31",
      rent_currency: currency,
      monthly_rent_xof: currency === "XOF" ? 650000 : 0,
      monthly_rent_amount: currency === "USD" ? 3200 : null,
    };
    const bill: ReceivableRow = {
      id: "bbbbbbbb-bbbb-4bbb-8bbb-000000000001",
      source_type: "lease_contract",
      source_id: contract.id,
      unit_id: contract.unit_id,
      customer_id: contract.customer_id,
      building_id: fixture.units[0].building_id,
      category: "lease_rent",
      title: "SYNTHETIC",
      due_date: "2026-11-07",
      amount_xof: currency === "XOF" ? 650000 : 0,
      paid_amount_xof: 0,
      amount_native: currency === "USD" ? 3200 : null,
      paid_amount_native: currency === "USD" ? 0 : null,
      currency,
      status: "pending",
      management_status: "managed",
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    };
    const input = {
      units: [fixture.units[0]],
      contracts: [contract],
      customers: fixture.customers,
      buildings: fixture.buildings,
      today: "2026-11-08",
      receivables: [bill],
    };
    await act(async () =>
      root.render(
        <LeaseRoomOverview
          rows={buildLeaseRoomOverview(input)}
          records={buildLeaseRecordOverview(input)}
          locale="zh"
          loading={false}
          error={false}
          onSelectUnit={vi.fn()}
          onSelectRecord={vi.fn()}
          onRetry={vi.fn()}
        />,
      ),
    );
    const card = host.querySelector("[data-room-id]")!;
    expect(card).toBeTruthy();
    expect(card.textContent).toContain(currency === "XOF" ? "65 万西法" : "$3,200 USD");
    expect(card.textContent).not.toContain("650,000");
    await act(async () =>
      [...host.querySelectorAll<HTMLButtonElement>("button")]
        .find((b) => b.textContent?.startsWith("收款跟进"))!
        .click(),
    );
    expect(host.querySelector("[data-followup-record-id]")?.textContent).toContain(
      currency === "XOF" ? "65 万西法" : "$3,200 USD",
    );
    expect(contract.monthly_rent_xof).toBe(currency === "XOF" ? 650000 : 0);
    expect(bill.amount_native).toBe(currency === "USD" ? 3200 : null);
  },
);
