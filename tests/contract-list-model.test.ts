import { describe, expect, it } from "vitest";
import type { ReceivableRow } from "@/types/database";
import {
  buildContractReceivableSummaries,
  formatContractXof,
  matchesContractSearch,
  sortContractRows,
  type ContractTableRow,
} from "@/features/contracts/contract-list-model";

const row = (id: string, values: Partial<ContractTableRow> = {}): ContractTableRow => ({
  id,
  contractNo: `LEASE-${id}`,
  building: "11#公寓",
  unit: id,
  customer: "Émilie Dupont",
  periodStart: "2026-10-01",
  periodLabel: "2026-10-01 → 2027-09-30",
  amountXof: 600000,
  balanceXof: 100000,
  status: "active",
  statusLabel: "生效",
  ...values,
});

describe("contract workspace projection", () => {
  it("displays exact fractional XOF and never renders missing/invalid values as zero", () => {
    expect(formatContractXof(181.4, "zh")).toBe("181.4 XOF");
    expect(formatContractXof(181.4, "fr")).toBe("181,4 XOF");
    expect(formatContractXof(null, "zh")).toBe("—");
    expect(formatContractXof(Number.NaN, "fr")).toBe("—");
  });
  it("searches customer, room, contract and optional phone without accent/case sensitivity", () => {
    expect(matchesContractSearch(row("503"), "emilie 503")).toBe(true);
    expect(matchesContractSearch(row("503"), "lease-503")).toBe(true);
    expect(matchesContractSearch(row("503", { searchText: "+225 01020304" }), "01020304")).toBe(
      true,
    );
    expect(matchesContractSearch(row("503"), "emilie 504")).toBe(false);
  });

  it("sorts room numbers numerically, leaves the input untouched and breaks ties by stable id", () => {
    const rows = [row("1002"), row("902"), row("503")];
    expect(
      sortContractRows(rows, { key: "unit", direction: "asc" }).map((value) => value.id),
    ).toEqual(["503", "902", "1002"]);
    expect(rows[0].id).toBe("1002");
    expect(
      sortContractRows([row("b", { unit: "503" }), row("a", { unit: "503" })], {
        key: "unit",
        direction: "desc",
      }).map((value) => value.id),
    ).toEqual(["a", "b"]);
  });

  it("never treats an unknown amount as zero and sorts unknowns last in either direction", () => {
    const rows = [
      row("unknown", { amountXof: null }),
      row("known", { amountXof: 10 }),
      row("zero", { amountXof: 0 }),
    ];
    expect(
      sortContractRows(rows, { key: "amount", direction: "asc" }).map((value) => value.id),
    ).toEqual(["zero", "known", "unknown"]);
    expect(
      sortContractRows(rows, { key: "amount", direction: "desc" }).map((value) => value.id),
    ).toEqual(["known", "zero", "unknown"]);
  });

  it("uses managed obligations only, does not offset another obligation's unpaid balance and respects due-day boundary", () => {
    const receivable = (id: string, values: Partial<ReceivableRow> = {}) =>
      ({
        id,
        source_id: "c",
        source_type: "lease_contract",
        amount_xof: 100,
        paid_amount_xof: 0,
        due_date: "2026-10-15",
        status: "pending",
        management_status: "managed",
        ...values,
      }) as ReceivableRow;
    const summaries = buildContractReceivableSummaries(
      [
        receivable("due"),
        receivable("overpaid", { paid_amount_xof: 150 }),
        receivable("late", { due_date: "2026-10-14", paid_amount_xof: 40 }),
        receivable("history", { management_status: "historical_pending" }),
        receivable("excluded", { management_status: "excluded" }),
        receivable("cancelled", { status: "cancelled" }),
        receivable("sale", { source_type: "sale_contract" }),
      ],
      "lease_contract",
      "2026-10-15",
    );
    expect(summaries.get("c")).toEqual({
      total: 300,
      paid: 190,
      outstanding: 160,
      overdue: 60,
      nextDue: "2026-10-14",
      count: 3,
    });
    expect(summaries.has("missing")).toBe(false);
  });
});
