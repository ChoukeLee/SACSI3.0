import { workspaceFixture, workspaceContract } from "./contract-workspace";
import {
  parseWorkspaceQuery,
  type WorkspaceData,
  type WorkspaceMode,
  type WorkspaceQuery,
} from "../../src/features/contracts/workspace-model";
import type { SaleContractRow } from "../../src/types/database";

export function saleFixture(
  query: WorkspaceQuery = parseWorkspaceQuery({}),
  mode: WorkspaceMode = "list",
  total = 2,
  id = workspaceContract,
): WorkspaceData {
  const data = workspaceFixture({ total }, query, mode);
  data.kind = "sale";
  data.contracts = data.contracts.map(
    (row, index) =>
      ({
        id: index === 0 ? id : row.id,
        unit_id: row.unit_id,
        customer_id: row.customer_id,
        contract_no: `SYNTHETIC-SALE-${index}`,
        signed_date: "2026-01-01",
        transfer_date: null,
        transfer_status: "in_progress",
        title_certificate_no: null,
        agency_company: null,
        agent_name: null,
        agency_commission_amount_xof: null,
        agency_commission_paid: false,
        payment_plan_type: "fixed_installment",
        total_amount_xof: 1000000,
        total_amount_confirmed: true,
        attachment_url: null,
        status: "active",
        created_at: "2026-01-01T00:00:00Z",
        updated_at: row.updated_at,
      }) satisfies SaleContractRow,
  );
  data.units[0].building_id = query.buildingId || data.buildings[0].id;
  data.buildings[0].id = data.units[0].building_id;
  data.units[0].status = "sold";
  data.summaries = Object.fromEntries(
    data.contracts.map((row) => [
      row.id,
      {
        total: 1000000,
        paid: 200000,
        outstanding: 800000,
        overdue: 300000,
        nextDue: "2026-10-01",
        count: mode === "detail" ? 1 : 2,
        dueOutstanding: 300000,
      },
    ]),
  );
  data.accruals = Object.fromEntries(data.contracts.map((row) => [row.id, null]));
  data.attentionDue = Object.fromEntries(data.contracts.map((row) => [row.id, "2026-10-01"]));
  data.stats = {
    ...data.stats,
    scopeCount: 51,
    active: 51,
    total: 51000000,
    received: 10200000,
    outstanding: 40800000,
    dueOutstanding: 15300000,
    transferDone: 3,
  };
  data.receivables = data.receivables.map((row) => ({
    ...row,
    source_type: "sale_contract",
    source_id: id,
    category: "sale_installment",
    amount_xof: 1000000,
    paid_amount_xof: 200000,
  }));
  return data;
}
