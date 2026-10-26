import { expect, it } from "vitest";
import { decodeWorkspace, parseWorkspaceQuery } from "../src/features/contracts/workspace-model";
import { workspaceContract, workspaceFixture } from "./fixtures/contract-workspace";
it("validates the separate pending lease count without requiring it from older responses", () => {
  const d = workspaceFixture();
  expect(decodeWorkspace(d, "lease", d.query, "list").stats.pending).toBeUndefined();
  d.stats.pending = 1;
  expect(decodeWorkspace(d, "lease", d.query, "list").stats.pending).toBe(1);
  for (const pending of [-1, 0.5, d.scopeCount + 1]) {
    expect(() =>
      decodeWorkspace({ ...d, stats: { ...d.stats, pending } }, "lease", d.query, "list"),
    ).toThrow();
  }
});
it("validates scope stats, records and counts without manufacturing unknown money", () => {
  const d = workspaceFixture();
  expect(decodeWorkspace(d, "lease", d.query, "list")).toEqual(d);
  for (const mutate of [
    (x: any) => delete x.stats.overdue,
    (x: any) => (x.stats.currentDue = "NaN"),
    (x: any) => (x.total = 26),
    (x: any) => (x.units[0].building_id = "77777777-7777-4777-8777-777777777777"),
    (x: any) => (x.customers = []),
  ]) {
    const bad = structuredClone(d);
    mutate(bad);
    expect(() => decodeWorkspace(bad, "lease", d.query, "list")).toThrow();
  }
});
it("rejects detail histories associated with a different contract", () => {
  const d = workspaceFixture({}, undefined, "detail");
  for (const key of ["payments", "receivables", "schedules"] as const) {
    const bad = structuredClone(d);
    (bad[key] as any[]).push({
      id: "77777777-7777-4777-8777-777777777777",
      source_id: "wrong",
      source_type: "lease_contract",
      sale_contract_id: "wrong",
    });
    expect(() => decodeWorkspace(bad, "lease", d.query, "detail", workspaceContract)).toThrow();
  }
});
it("accepts complete empty authorized scope distinctly from a failed read", () => {
  const d = workspaceFixture({
    total: 0,
    scopeCount: 0,
    stats: { ...workspaceFixture().stats, scopeCount: 0 },
  });
  expect(decodeWorkspace(d, "lease", d.query, "list").contracts).toEqual([]);
  expect(() => parseWorkspaceQuery({ page: "2.5" })).toThrow();
  expect(() => parseWorkspaceQuery({ status: null })).toThrow();
});
it("preserves explicit unknown CIMAC lease dates but rejects missing or invalid date fields", () => {
  for (const mode of ["list", "detail"] as const) {
    const d = workspaceFixture({}, undefined, mode);
    Object.assign(d.contracts[0], { status: "draft", start_date: null, expected_end_date: null });
    expect(
      decodeWorkspace(d, "lease", d.query, mode, mode === "detail" ? workspaceContract : undefined),
    ).toEqual(d);
    for (const key of ["start_date", "expected_end_date"] as const) {
      const missing = structuredClone(d);
      delete (missing.contracts[0] as unknown as Record<string, unknown>)[key];
      expect(() =>
        decodeWorkspace(
          missing,
          "lease",
          d.query,
          mode,
          mode === "detail" ? workspaceContract : undefined,
        ),
      ).toThrow();
      const invalid = structuredClone(d);
      Object.assign(invalid.contracts[0], { [key]: "2026-02-30" });
      expect(() =>
        decodeWorkspace(
          invalid,
          "lease",
          d.query,
          mode,
          mode === "detail" ? workspaceContract : undefined,
        ),
      ).toThrow();
    }
  }
});
it("requires complete reversal, request and financial fields and rejects invalid dates/blank amounts", () => {
  const d = workspaceFixture({}, undefined, "detail");
  const payment = {
    id: "99999999-9999-4999-8999-999999999999",
    source_type: "lease_rent",
    source_id: workspaceContract,
    amount: "2",
    currency: "CNY",
    exchange_rate_to_xof: "90.7",
    payment_date: "2026-10-15",
    payment_method: "bank_transfer",
    receipt_no: null,
    notes: null,
    request_kind: null,
    reversal_of_payment_id: null,
  };
  (d.payments as any[]).push(payment);
  d.paymentCount = 1;
  expect(decodeWorkspace(d, "lease", d.query, "detail", workspaceContract)).toEqual(d);
  for (const mutate of [
    (x: any) => delete x.payments[0].reversal_of_payment_id,
    (x: any) => delete x.payments[0].request_kind,
    (x: any) => delete x.payments[0].payment_method,
    (x: any) => (x.payments[0].amount = "  "),
    (x: any) => (x.payments[0].amount = "0x10"),
    (x: any) => (x.payments[0].payment_date = "2026-02-30"),
    (x: any) => delete x.contracts[0].monthly_rent_xof,
    (x: any) => delete x.contracts[0].paid_through_date,
    (x: any) => delete x.receivables[0].paid_amount_xof,
    (x: any) => {
      x.receivables = [];
      x.receivableCount = 0;
    },
    (x: any) => delete x.units[0].unit_business_flags,
  ]) {
    const bad = structuredClone(d);
    mutate(bad);
    expect(() => decodeWorkspace(bad, "lease", d.query, "detail", workspaceContract)).toThrow();
  }
});
