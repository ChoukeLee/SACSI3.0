import { describe, expect, it } from "vitest";
import { CIMAC_PROJECT_ID } from "@/features/finance/cimac-export-model";
import {
  decodeFinanceRecordContext,
  parseFinanceRecordContextQuery,
  type FinanceRecordContext,
} from "@/features/finance/finance-record-context";

const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const record: FinanceRecordContext = {
  kind: "ledger",
  id,
  amountXof: 500,
  date: "2026-10-15",
  category: "lease_deposit",
  direction: "liability_in",
  title: null,
  paidAmountXof: null,
  status: null,
  managementStatus: null,
  paymentId: null,
  paymentMethod: null,
  building: null,
  unit: null,
  customer: null,
  source: null,
  period: null,
};
describe("finance record context boundary", () => {
  it("keeps liabilities and missing facts distinct from income and zero", () => {
    expect(decodeFinanceRecordContext(record)).toEqual(record);
  });
  it.each([
    {},
    { id: "" },
    { id: "x".repeat(1000) },
    { kind: "payments" },
    { amountXof: "500" },
    { amountXof: NaN },
    { amountXof: Infinity },
    { amountXof: null },
    { date: "2026-02-30" },
    { category: undefined },
    { direction: null },
    { direction: "cash" },
    { paidAmountXof: 0 },
    { customer: { id, label: null } },
    { paymentMethod: undefined },
    { period: { start: "2026-10-01", end: "2026-10-31", source: "receipt" } },
  ])("rejects invalid or incompatible DTO %j", (changes) => {
    expect(() =>
      decodeFinanceRecordContext(Object.keys(changes).length ? { ...record, ...changes } : changes),
    ).toThrow("financeRecordContextUnavailable");
  });
  it("supports explicit end-only service period without inventing its start", () => {
    expect(
      decodeFinanceRecordContext({
        ...record,
        kind: "receivables",
        direction: null,
        paidAmountXof: 0,
        status: "pending",
        period: { start: null, end: "2026-10-31", source: "合同确认" },
      }).period,
    ).toEqual({ start: null, end: "2026-10-31", source: "合同确认" });
  });
  it.each([
    "https://evil.example/leases",
    "/leases?contractId=" + id,
    "/leases?project=" + id + "&contractId=" + id,
    "javascript:alert(1)",
    "/daily-rentals?booking=" + id,
  ])("rejects invented deep links or unsafe source route %s", (href) => {
    expect(() =>
      decodeFinanceRecordContext({
        ...record,
        source: { type: "lease_contract", id, label: "L1", href, linkKind: "workspace" },
      }),
    ).toThrow();
  });
  it("accepts a scoped workspace link, not a claim of directly opening the contract", () => {
    expect(
      decodeFinanceRecordContext({
        ...record,
        building: { id, label: "示例楼栋", projectId: id },
        source: {
          type: "lease_contract",
          id,
          label: "L1",
          href: `/leases?project=${id}`,
          linkKind: "workspace",
        },
      }).source?.linkKind,
    ).toBe("workspace");
  });
  it("rejects a workspace link to a different project or business domain", () => {
    for (const href of [
      `/sales?project=${id}`,
      "/leases?project=bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    ]) {
      expect(() =>
        decodeFinanceRecordContext({
          ...record,
          building: { id, label: "楼栋", projectId: id },
          source: { type: "lease_contract", id, label: "L1", href, linkKind: "workspace" },
        }),
      ).toThrow();
    }
  });
  it.each(["cimac_apartment_rent", "cimac_apartment_deposit"])(
    "allows %s only to the fixed CIMAC apartment workspace",
    (type) => {
      const apartment = {
        ...record,
        building: { id, label: "17#公寓", projectId: CIMAC_PROJECT_ID },
        source: {
          type,
          id,
          label: "公寓已付款预订",
          href: "/cimac/apartments",
          linkKind: "workspace",
        },
      };
      expect(decodeFinanceRecordContext(apartment).source?.href).toBe("/cimac/apartments");
      expect(() =>
        decodeFinanceRecordContext({
          ...apartment,
          building: { ...apartment.building, projectId: id },
        }),
      ).toThrow();
      expect(() =>
        decodeFinanceRecordContext({
          ...apartment,
          source: { ...apartment.source, href: `/leases?project=${CIMAC_PROJECT_ID}` },
        }),
      ).toThrow();
      expect(() =>
        decodeFinanceRecordContext({
          ...apartment,
          source: { ...apartment.source, href: `/cimac/apartments?reservation=${id}` },
        }),
      ).toThrow();
    },
  );
  it("only accepts exact single kind/id parameters", () => {
    expect(parseFinanceRecordContextQuery(new URLSearchParams({ kind: "ledger", id }))).toEqual({
      kind: "ledger",
      id,
    });
    for (const query of [
      `kind=ledger&id=${id}&id=${id}`,
      `kind=ledger&kind=receivables&id=${id}`,
      `kind=ledger&id=${id}&extra=1`,
      `kind=ledger`,
      `id=${id}`,
      `kind=payments&id=${id}`,
      `kind=ledger&id=${"a".repeat(10000)}`,
    ]) {
      expect(() => parseFinanceRecordContextQuery(new URLSearchParams(query))).toThrow(
        "invalidFinanceRecordContext",
      );
    }
  });
});
