import { describe, expect, it } from "vitest";
import {
  salePrice,
  saleRegisteredPrice,
  buildSalePurchaseReceiptSummary,
  saleScheduleReceivable,
  saleScheduleState,
  saleWorkbenchHref,
  saleWorkbenchStats,
} from "@/features/sales/sale-workbench-model";
import { parseWorkspaceQuery, decodeWorkspace } from "@/features/contracts/workspace-model";
import type {
  SaleContractRow,
  SalePaymentScheduleRow,
  ReceivableRow,
  PaymentRow,
} from "@/types/database";
import { saleFixture } from "./fixtures/sale-workbench";
import {
  workspaceContract,
  workspaceProject,
  workspaceBuilding,
} from "./fixtures/contract-workspace";

const contract = saleFixture().contracts[0] as SaleContractRow;
it("keeps a registered native price separate from the legacy XOF slot", () => {
  const native = {
    ...contract,
    sale_currency: "CNY" as const,
    total_amount_native: 720000,
    total_amount_xof: 0,
  };
  expect(salePrice(native)).toBeNull();
  expect(saleRegisteredPrice(native)).toEqual({ currency: "CNY", amount: 720000 });
  expect(salePrice({ ...native, total_amount_xof: 720000 })).toBeNull();
  expect(saleRegisteredPrice({ ...native, total_amount_xof: 720000 })).toBeNull();
  expect(saleRegisteredPrice({ ...native, total_amount_native: null })).toBeNull();
});
it("preserves actual native purchase cash with unknown method, without fees, offsets or cross-buyer records", () => {
  const native = {
    ...contract,
    sale_currency: "CNY" as const,
    total_amount_native: 720000,
    total_amount_xof: 0,
  };
  const receipt = (id: string, amount: number, patch: Partial<PaymentRow> = {}): PaymentRow => ({
    id,
    source_id: contract.id,
    source_type: "sale_contract",
    unit_id: contract.unit_id,
    customer_id: contract.customer_id,
    currency: "CNY",
    amount,
    payment_date: "2026-10-17",
    created_at: "2026-10-17T00:00:00Z",
    native_settlement: true,
    exchange_rate_to_xof: null,
    payment_method: null,
    notes: null,
    receipt_no: null,
    ...patch,
  });
  const first = receipt("native-first", 700000),
    second = receipt("native-second", 20000);
  const result = buildSalePurchaseReceiptSummary(native, [
    first,
    second,
    first,
    receipt("fee", 30000, { source_type: "sale_registration_fee" }),
    receipt("offset", 500, { payment_method: "offset" }),
    receipt("reversal", 500, { request_kind: "sale_reversal" }),
    receipt("wrong-buyer", 500, { customer_id: "other-buyer" }),
    receipt("bad-rate", 500, { exchange_rate_to_xof: 1 }),
    receipt("wrong-currency", 500, { currency: "USD" }),
    receipt("bad-method", 500, { payment_method: "unknown" as PaymentRow["payment_method"] }),
    receipt("bad-date", 500, { payment_date: "2026-02-30" }),
  ]);
  expect(result.amounts).toEqual([{ currency: "CNY", amount: 720000 }]);
  expect([...result.receiptIds]).toEqual([first.id, second.id]);
});
it("reads an Excel sale with an unknown signing date only when its source is retained", () => {
  const data = saleFixture();
  Object.assign(data.contracts[0], {
    signed_date: null,
    registration_basis: "source_record",
    source_reference: "Synthetic workbook / Sheet1!A2",
  });
  expect(decodeWorkspace(data, "sale", data.query, "list")).toEqual(data);
  for (const patch of [
    { registration_basis: "contract" },
    { source_reference: " " },
    { signed_date: undefined },
  ]) {
    const invalid = structuredClone(data);
    Object.assign(invalid.contracts[0], patch);
    expect(() => decodeWorkspace(invalid, "sale", invalid.query, "list")).toThrow();
  }
});
const schedule = {
  id: "88888888-8888-4888-8888-888888888888",
  sale_contract_id: workspaceContract,
  installment_no: 1,
  due_date: "2026-10-19",
  amount_xof: 100,
  status: "pending",
} as SalePaymentScheduleRow;
const receivable = {
  id: "77777777-7777-4777-8777-777777777777",
  source_type: "sale_contract",
  source_id: workspaceContract,
  amount_xof: 100,
  paid_amount_xof: 0,
  due_date: "2026-10-19",
  status: "pending",
  management_status: "managed",
} as ReceivableRow;
describe("sale workbench business boundaries", () => {
  it("uses a production-decoded synthetic detail fixture", () => {
    const data = saleFixture(undefined, "detail", 1);
    decodeWorkspace(data, "sale", data.query, "detail", workspaceContract);
  });
  it("round-trips explicit scope, search, sort, page and stable contract IDs", () => {
    const href = saleWorkbenchHref(
      parseWorkspaceQuery({
        projectId: workspaceProject,
        buildingId: workspaceBuilding,
        search: "客户 A",
        status: "all",
        page: 3,
        sort: "balance",
        direction: "desc",
        locale: "fr",
      }),
      workspaceContract,
    );
    const url = new URL(href, "https://local.invalid");
    expect(url.pathname).toBe("/fr/sales");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      project: workspaceProject,
      building: workspaceBuilding,
      q: "客户 A",
      status: "all",
      page: "3",
      sort: "balance",
      direction: "desc",
      contract: workspaceContract,
    });
    expect(saleWorkbenchHref(parseWorkspaceQuery({}), "not-a-contract")).toBe("/sales");
  });
  it.each([null, 0, -1, NaN, Infinity])("keeps unknown/nonpositive price %s unknown", (value) =>
    expect(salePrice({ ...contract, total_amount_xof: value })).toBeNull(),
  );
  it("does not treat an unconfirmed recorded price as confirmed", () =>
    expect(salePrice({ ...contract, total_amount_confirmed: false })).toBeNull());
  it("keeps a legacy null confirmation marker unknown", () =>
    expect(
      salePrice({ ...contract, total_amount_confirmed: null } as unknown as SaleContractRow),
    ).toBeNull());
  it("keeps valid confirmed contract prices", () => expect(salePrice(contract)).toBe(1000000));
  it("never calls future or today receivables overdue solely from a stale status flag", () => {
    expect(saleScheduleState(schedule, [{ ...receivable, status: "overdue" }], "2026-10-19")).toBe(
      "pending",
    );
    expect(
      saleScheduleState(
        schedule,
        [{ ...receivable, status: "overdue", due_date: "2026-10-20" }],
        "2026-10-19",
      ),
    ).toBe("unverified");
    expect(
      saleScheduleState(
        { ...schedule, due_date: "2026-10-20" },
        [{ ...receivable, status: "overdue", due_date: "2026-10-20" }],
        "2026-10-19",
      ),
    ).toBe("pending");
  });
  it("uses the receivable balance and actual due date for paid, partial and overdue states", () => {
    expect(
      saleScheduleState(schedule, [{ ...receivable, paid_amount_xof: 100 }], "2026-10-20"),
    ).toBe("paid");
    expect(
      saleScheduleState(schedule, [{ ...receivable, paid_amount_xof: 50 }], "2026-10-19"),
    ).toBe("partial");
    expect(
      saleScheduleState(schedule, [{ ...receivable, paid_amount_xof: 50 }], "2026-10-20"),
    ).toBe("overdue");
  });
  it("does not guess an ambiguous or excluded legacy schedule association", () => {
    expect(
      saleScheduleReceivable(schedule, [
        receivable,
        { ...receivable, id: "99999999-9999-4999-8999-999999999999" },
      ]),
    ).toBeNull();
    expect(
      saleScheduleState(
        schedule,
        [{ ...receivable, management_status: "historical_pending" }],
        "2026-10-20",
      ),
    ).toBe("unverified");
    expect(saleScheduleState({ ...schedule, status: "paid" }, [], "2026-10-20")).toBe("unverified");
    expect(
      saleScheduleState({ ...schedule, status: "cancelled" }, [receivable], "2026-10-20"),
    ).toBe("cancelled");
  });
  it("honors explicit receivable IDs, without falling back to a different same-value debt", () => {
    expect(
      saleScheduleReceivable({ ...schedule, receivable_id: "missing" }, [receivable]),
    ).toBeNull();
    expect(
      saleScheduleReceivable({ ...schedule, receivable_id: receivable.id }, [receivable])?.id,
    ).toBe(receivable.id);
  });
  it("rejects mathematically impossible allocation progress instead of showing settled", () =>
    expect(
      saleScheduleState(schedule, [{ ...receivable, paid_amount_xof: 101 }], "2026-10-20"),
    ).toBe("unverified"));
  it("uses server full-scope summary and labels cash-independent totals", () => {
    const blocks = saleWorkbenchStats(saleFixture().stats, "zh");
    expect(blocks.find((b) => b.key === "total")?.value).toContain("51,000,000");
    expect(blocks.find((b) => b.key === "total")?.hint).toContain("非现金实收");
    expect(
      saleWorkbenchStats({ ...saleFixture().stats, unknownAll: true }, "zh").find(
        (b) => b.key === "due",
      )?.value,
    ).toBe("—");
  });
});
