import { describe, expect, it } from "vitest";
import {
  cimacBillingHref,
  parseCimacBillingQuery,
  wantsCimacCustomerWorkspace,
} from "@/features/finance/cimac-billing-query";

const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
describe("CIMAC customer account navigation", () => {
  it("uses a bounded customer directory and never invents a selected customer", () => {
    expect(parseCimacBillingQuery({})).toEqual({ search: "", customerPage: 1, tab: "bills" });
  });
  it.each([
    { customerId: "wrong" },
    { customerId: [id, id] },
    { search: ["a", "b"] },
    { search: "x".repeat(121) },
    { customerPage: "0" },
    { customerPage: "1.1" },
    { customerPage: "2000001" },
    { tab: "unknown" },
  ])("rejects malformed or duplicate query facts %s", (params) => {
    expect(() => parseCimacBillingQuery(params)).toThrow("InvalidCimacBillingQuery");
  });
  it("keeps an explicitly selected customer and safely encodes navigation", () => {
    const query = parseCimacBillingQuery({ customerId: id, search: "店 & 仓", customerPage: "2" });
    const url = new URL(
      cimacBillingHref(query, "fr", { tab: "meters" }),
      "https://example.invalid",
    );
    expect(url.pathname).toBe("/fr/finance");
    expect(url.searchParams.get("search")).toBe("店 & 仓");
    expect(url.searchParams.get("customerPage")).toBe("2");
    expect(url.searchParams.get("tab")).toBe("meters");
    expect(url.searchParams.get("view")).toBe("customers");
  });
  it("makes the approved customer view the CIMAC default, not the default for every project", () => {
    expect(wantsCimacCustomerWorkspace({}, id)).toBe(true);
    expect(wantsCimacCustomerWorkspace({ projectId: id }, id)).toBe(true);
    expect(wantsCimacCustomerWorkspace({}, undefined)).toBe(false);
    expect(wantsCimacCustomerWorkspace({ projectId: "other" }, id)).toBe(false);
  });
  it.each([
    { kind: "ledger" },
    { kind: "receivables" },
    { view: "reconciliation" },
    { dateFrom: "2026-10-01" },
    { page: "2" },
    { buildingId: id },
  ])("preserves existing financial entry points %s", (params) => {
    expect(wantsCimacCustomerWorkspace(params, id)).toBe(false);
  });
});
