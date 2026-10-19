import { describe, expect, it } from "vitest";
import {
  salePrice,
  saleScheduleReceivable,
  saleScheduleState,
  saleWorkbenchHref,
  saleWorkbenchStats,
} from "@/features/sales/sale-workbench-model";
import { parseWorkspaceQuery, decodeWorkspace } from "@/features/contracts/workspace-model";
import type { SaleContractRow, SalePaymentScheduleRow, ReceivableRow } from "@/types/database";
import { saleFixture } from "./fixtures/sale-workbench";
import {
  workspaceContract,
  workspaceProject,
  workspaceBuilding,
} from "./fixtures/contract-workspace";

const contract = saleFixture().contracts[0] as SaleContractRow;
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
