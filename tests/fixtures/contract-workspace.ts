import {
  parseWorkspaceQuery,
  type WorkspaceData,
  type WorkspaceQuery,
  type WorkspaceMode,
} from "../../src/features/contracts/workspace-model";
export const workspaceProject = "11111111-1111-4111-8111-111111111111",
  workspaceBuilding = "22222222-2222-4222-8222-222222222222",
  workspaceContract = "33333333-3333-4333-8333-333333333333",
  workspaceUnit = "44444444-4444-4444-8444-444444444444",
  workspaceCustomer = "55555555-5555-4555-8555-555555555555";
export function workspaceFixture(
  overrides: Partial<WorkspaceData> = {},
  query: WorkspaceQuery = parseWorkspaceQuery({ projectId: workspaceProject, buildingId: "" }),
  mode: WorkspaceMode = "list",
): WorkspaceData {
  const total = overrides.total ?? 1,
    rows = mode === "list" ? Math.min(25, Math.max(0, total - (query.page - 1) * 25)) : total;
  const contracts = Array.from({ length: rows }, (_, i) => ({
    id: i === 0 ? workspaceContract : `66666666-6666-4666-8666-${String(i).padStart(12, "0")}`,
    unit_id: workspaceUnit,
    customer_id: workspaceCustomer,
    contract_no: `SYNTHETIC-${i}`,
    status: "active",
    start_date: "2026-01-01",
    expected_end_date: "2027-01-01",
    expected_end_confirmed: true,
    payment_cycle: "monthly",
    payment_day: 1,
    monthly_rent_xof: 100,
    deposit_amount_xof: 100,
    deposit_received: false,
    paid_through_date: null,
    rent_free_days: 0,
    signer_name: null,
    attachment_url: null,
    actual_end_date: null,
    updated_at: "2026-10-15T00:00:00Z",
  }));
  const receivables =
    mode === "detail"
      ? contracts.map((c) => ({
          id: "77777777-7777-4777-8777-777777777777",
          source_id: c.id,
          source_type: "lease_contract",
          amount_xof: 100,
          paid_amount_xof: 0,
          due_date: "2026-10-01",
          status: "pending",
          management_status: "managed",
          category: "lease_rent",
        }))
      : [];
  return {
    kind: "lease",
    mode,
    query,
    today: "2026-10-15",
    page: query.page,
    pageSize: 25,
    total,
    scopeCount: 51,
    stats: {
      scopeCount: 51,
      active: 51,
      rent: 5100,
      total: 5100,
      currentDue: 5100,
      outstanding: 5100,
      received: 0,
      dueOutstanding: 5100,
      overdue: 5100,
      overdueContracts: 51,
      unknownContracts: 0,
      unknownAll: false,
      transferDone: 0,
      dueSoon: 0,
    },
    buildings: [
      {
        id: workspaceBuilding,
        project_id: query.projectId || workspaceProject,
        code: "SACSI11",
        display_name: "Synthetic 11",
        project: {
          id: query.projectId || workspaceProject,
          code: "SACSI",
          display_name: "Synthetic",
        },
      },
    ],
    contracts: contracts as WorkspaceData["contracts"],
    units: [
      {
        id: workspaceUnit,
        building_id: workspaceBuilding,
        code: "SYNTHETIC",
        unit_no: "101",
        floor_label: "1",
        status: "leased",
        kind: "apartment",
        unit_business_flags: [],
      } as unknown as WorkspaceData["units"][number],
    ],
    customers: [
      {
        id: workspaceCustomer,
        name: "Synthetic guest",
        phone: null,
        notes: null,
        is_blacklisted: false,
      } as WorkspaceData["customers"][number],
    ],
    payments: [],
    receivables: receivables as WorkspaceData["receivables"],
    schedules: [],
    paymentCount: 0,
    receivableCount: receivables.length,
    scheduleCount: 0,
    summaries: Object.fromEntries(
      contracts.map((c) => [
        c.id,
        {
          total: 100,
          paid: 0,
          outstanding: 100,
          overdue: 100,
          nextDue: "2026-10-01",
          count: 1,
          dueOutstanding: 100,
        },
      ]),
    ),
    accruals: Object.fromEntries(contracts.map((c) => [c.id, null])),
    attentionDue: Object.fromEntries(contracts.map((c) => [c.id, "2026-10-01"])),
    ...overrides,
  };
}
