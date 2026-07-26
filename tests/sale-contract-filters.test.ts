import { describe, expect, it } from "vitest";
import { getEffectiveSaleContracts } from "../src/features/sales/sale-contract-filters";
import type { SaleContractRow } from "../src/types/database";

function contract(id: string, unitId: string, status: SaleContractRow["status"]): SaleContractRow {
  return {
    id,
    unit_id: unitId,
    customer_id: `customer-${id}`,
    contract_no: `contract-${id}`,
    signed_date: "2026-01-01",
    transfer_date: null,
    transfer_status: "not_started",
    title_certificate_no: null,
    agency_company: null,
    agent_name: null,
    agency_commission_amount_xof: null,
    agency_commission_paid: false,
    payment_plan_type: "lump_sum",
    total_amount_xof: 100,
    attachment_url: null,
    status,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  };
}

describe("getEffectiveSaleContracts", () => {
  it("keeps only active contracts in the selected building", () => {
    const contracts = [
      contract("wang-1204", "unit-1204", "active"),
      contract("sci-1204", "unit-1204", "terminated"),
      contract("yaya-1101", "unit-1101", "terminated"),
      contract("other-building", "unit-other", "active"),
    ];
    const unitBuildingMap = new Map([
      ["unit-1204", "SACSI11"],
      ["unit-1101", "SACSI11"],
      ["unit-other", "SACSI7"],
    ]);

    expect(getEffectiveSaleContracts(contracts, unitBuildingMap, "SACSI11").map((row) => row.id))
      .toEqual(["wang-1204"]);
  });
});
