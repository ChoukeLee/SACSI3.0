import { describe, expect, it } from "vitest";
import { parseFinanceRead } from "@/features/finance/finance-read";
import {
  decodeFinanceReconciliation,
  decodeFinanceWorkbenchRead,
  financeIssueLabels,
  financeManagedOutstanding,
  financeNumber,
  financeWorkbenchHref,
  financeWorkbenchKey,
  financeWorkbenchMode,
} from "@/features/finance/finance-workbench-model";

const project = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const building = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const payload = () => ({
  kind: "ledger",
  page: 1,
  pageSize: 50,
  total: 350,
  summary: { income: 90000000, expense: 100, liability_in: 200, liability_out: 0 },
  rows: [
    {
      id: "entry",
      entry_date: "2026-10-19",
      category: "lease_rent",
      direction: "income",
      amount_xof: "120.25",
      building_label: null,
      unit_label: null,
      description: null,
    },
  ],
});
describe("finance workbench boundaries", () => {
  it("keeps the complete-filter aggregate instead of deriving it from the current page", () => {
    const result = decodeFinanceWorkbenchRead(payload(), "ledger", 1);
    expect(result.summary.income).toBe(90000000);
    expect(result.total).toBe(350);
    expect(result.rows[0].amount_xof).toBe(120.25);
  });
  it.each([null, undefined, "", " 5", "NaN", NaN, Infinity, {}, [], Number.MAX_SAFE_INTEGER])(
    "rejects unknown or unsafe amounts %s",
    (value) => expect(() => financeNumber(value)).toThrow(),
  );
  it.each([0, -300, 12.25, "0", "-40.25"])("preserves legitimate signed values %s", (value) =>
    expect(financeNumber(value)).toBe(Number(value)),
  );
  it.each(["income", "expense", "liability_in", "liability_out"])(
    "does not reinterpret %s as an unrelated cash category",
    (direction) => {
      const data = payload();
      data.rows[0].direction = direction;
      expect(decodeFinanceWorkbenchRead(data, "ledger", 1).rows[0].direction).toBe(direction);
    },
  );
  it("rejects missing summary data rather than showing NaN or zero", () => {
    const data = payload();
    delete (data.summary as Record<string, unknown>).income;
    expect(() => decodeFinanceWorkbenchRead(data, "ledger", 1)).toThrow();
  });
  it.each(["2026-02-30", "2026-10-99", "19/10/2026"])("rejects impossible dates %s", (date) => {
    const data = payload();
    data.rows[0].entry_date = date;
    expect(() => decodeFinanceWorkbenchRead(data, "ledger", 1)).toThrow();
  });
  it("rejects duplicate and cross-kind responses", () => {
    const data = payload();
    data.rows.push(data.rows[0]);
    expect(() => decodeFinanceWorkbenchRead(data, "ledger", 1)).toThrow();
    expect(() => decodeFinanceWorkbenchRead(payload(), "receivables", 1)).toThrow();
    expect(() => decodeFinanceWorkbenchRead(payload(), "ledger", 2)).toThrow();
  });
  it("keeps filter, date and export navigation semantics across locales", () => {
    const q = parseFinanceRead({
      projectId: project,
      buildingId: building,
      kind: "ledger",
      search: "甲 & 50%_",
      category: "property_fee",
      direction: "income",
      dateFrom: "2026-10-01",
      dateTo: "2026-10-19",
      page: "3",
    });
    const url = new URL(financeWorkbenchHref(q, "fr", "ledger", { page: "4" }), "http://local");
    expect(url.pathname).toBe("/fr/finance");
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      ...q.filters,
      kind: "ledger",
      page: "4",
    });
    const next = new URL(financeWorkbenchHref(q, "zh", "receivables"), "http://local");
    expect(next.searchParams.has("direction")).toBe(false);
    expect(next.searchParams.has("page")).toBe(false);
    expect(next.searchParams.get("search")).toBe(q.filters.search);
  });
  it("drops incompatible receivable filters when switching to the ledger", () => {
    const q = parseFinanceRead({
      kind: "receivables",
      status: "partial",
      management: "historical_pending",
      outstandingOnly: "true",
      category: "property_fee",
      page: "2",
    });
    const params = new URL(financeWorkbenchHref(q, "zh", "ledger"), "http://local").searchParams;
    expect(Object.fromEntries(params)).toEqual({ category: "property_fee", kind: "ledger" });
  });
  it("keys every scope, page, mode and filter transition while canonicalizing filter order", () => {
    const q = parseFinanceRead({ kind: "ledger", search: "a", projectId: project });
    expect(financeWorkbenchKey(q, "ledger")).toBe(
      financeWorkbenchKey(
        { ...q, filters: Object.fromEntries(Object.entries(q.filters).reverse()) },
        "ledger",
      ),
    );
    for (const changed of [
      { ...q, page: 2 },
      { ...q, filters: { ...q.filters, search: "b" } },
    ])
      expect(financeWorkbenchKey(changed, "ledger")).not.toBe(financeWorkbenchKey(q, "ledger"));
    expect(financeWorkbenchKey(q, "reconciliation")).not.toBe(financeWorkbenchKey(q, "ledger"));
  });
  it("makes reconciliation scope independent and explicit without changing ledger filters", () => {
    const q = parseFinanceRead({ projectId: project, page: "4" });
    const url = new URL(financeWorkbenchHref(q, "zh", "reconciliation"), "http://local");
    expect(url.searchParams.get("view")).toBe("reconciliation");
    expect(url.searchParams.has("page")).toBe(false);
    expect(financeWorkbenchMode(Object.fromEntries(url.searchParams), q.kind)).toBe(
      "reconciliation",
    );
    expect(() => financeWorkbenchMode({ view: ["reconciliation", "ledger"] }, "ledger")).toThrow();
    expect(() => financeWorkbenchMode({ view: "unreviewed" }, "ledger")).toThrow();
  });
  it("does not call all multi-line allocations duplicates", () =>
    expect(financeIssueLabels.zh.duplicate_payment_ledger).toContain("不一定重复"));
  it("labels proven customer receipt reconciliation errors in both languages", () => {
    expect(financeIssueLabels.zh.cimac_customer_collection_mismatch).toContain("客户总账");
    expect(financeIssueLabels.fr.cimac_customer_collection_mismatch).toContain("incohérentes");
  });
  it("does not conflate a reconciliation read failure with zero issues", () => {
    expect(decodeFinanceReconciliation({ count: 0, issues: [] })).toEqual({
      available: true,
      count: 0,
      issues: [],
    });
    for (const value of [
      {},
      null,
      { count: 0, issues: [{ code: "x", entity_id: "y" }] },
      { count: 1, issues: [{ code: null, entity_id: "y" }] },
    ])
      expect(() => decodeFinanceReconciliation(value)).toThrow();
  });
  it("historical, cancelled and excluded balances are never labelled current debt", () => {
    const row = {
      management_status: "managed",
      status: "partial",
      amount_xof: 1000,
      paid_amount_xof: 300,
    };
    expect(financeManagedOutstanding(row)).toBe(700);
    expect(financeManagedOutstanding({ ...row, status: "cancelled" })).toBeNull();
    expect(
      financeManagedOutstanding({ ...row, management_status: "historical_pending" }),
    ).toBeNull();
    expect(financeManagedOutstanding({ ...row, management_status: "excluded" })).toBeNull();
  });
});
