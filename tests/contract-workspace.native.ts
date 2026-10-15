import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type pg from "pg";
import { afterAll, beforeAll, expect, it } from "vitest";
import { createNativePaymentPostgres } from "./helpers/native-payment-postgres";
import { installApplicationRebuild } from "./helpers/application-rebuild";
import { parseWorkspaceQuery, decodeWorkspace } from "../src/features/contracts/workspace-model";
import {
  buildContractReceivableSummaries,
  sortContractRows,
  type ContractTableRow,
} from "../src/features/contracts/contract-list-model";
import { computeFinanceMetrics } from "../src/features/finance/metrics";
import { resolveLeaseOverdue } from "../src/features/leases/lease-receivable-summary";
import type { ReceivableRow } from "../src/types/database";
import { dictionaries } from "../src/lib/i18n";
let cluster: Awaited<ReturnType<typeof createNativePaymentPostgres>>, db: pg.Client;
const actor = randomUUID(),
  project = randomUUID(),
  building = randomUUID(),
  customer = randomUUID(),
  otherProject = randomUUID(),
  otherBuilding = randomUUID(),
  otherUnit = randomUUID(),
  otherContract = randomUUID();
const leases = Array.from({ length: 32 }, () => randomUUID()),
  units = Array.from({ length: 32 }, () => randomUUID()),
  sale = randomUUID();
let today: string;
beforeAll(async () => {
  cluster = await createNativePaymentPostgres();
  db = await cluster.connect();
  const installed = await installApplicationRebuild(db);
  const file = "20261015222540_contract_workspace_read_models.sql";
  if (!installed.includes(file))
    await db.query(readFileSync(resolve("supabase/migrations", file), "utf8"));
  await db.query("insert into auth.users(id,email) values($1,'contract-workspace@test.invalid');", [
    actor,
  ]);
  await db.query("insert into user_profiles(id,role,display_name) values($1,'admin','Synthetic')", [
    actor,
  ]);
  await db.query("select set_config('request.jwt.claims',$1,false)", [
    JSON.stringify({ sub: actor, role: "authenticated" }),
  ]);
  await db.query(
    "insert into projects(id,code,display_name,allows_sale) values($1,'SACSI','Synthetic',true),($2,'OTHER','Other synthetic',true)",
    [project, otherProject],
  );
  await db.query(
    "insert into buildings(id,project_id,code,display_name) values($1,$2,'SACSI11','11 Building'),($3,$4,'OTHER','Other building')",
    [building, project, otherBuilding, otherProject],
  );
  await db.query("insert into customers(id,name,phone) values($1,'Élodie synthetic','012345')", [
    customer,
  ]);
  for (let i = 0; i < leases.length; i++) {
    await db.query(
      "insert into units(id,building_id,code,unit_no,floor_label,status) values($1,$2,$3,$4,'1','available')",
      [units[i], building, `WORKSPACE-${i}`, `${i + 1}`],
    );
    await db.query(
      "insert into lease_contracts(id,unit_id,customer_id,contract_no,start_date,expected_end_date,payment_cycle,payment_day,monthly_rent_xof,paid_through_date,status) values($1,$2,$3,$4,current_date-100,current_date+365,'monthly',1,100,(current_date-60),'active')",
      [leases[i], units[i], customer, `WORKSPACE-${i}`],
    );
    await db.query(
      "insert into receivables(source_type,source_id,building_id,unit_id,customer_id,category,title,due_date,amount_xof,paid_amount_xof,status,management_status) values('lease_contract',$1,$2,$3,$4,'lease_rent','Synthetic',current_date-20,100,$5,'partial','managed'),('lease_contract',$1,$2,$3,$4,'property_fee','Synthetic future',current_date+10,25,0,'pending','managed'),('lease_contract',$1,$2,$3,$4,'lease_rent','Excluded historical',current_date-10,900,0,'pending','historical_pending')",
      [leases[i], building, units[i], customer, i],
    );
  }
  await db.query(
    "insert into units(id,building_id,code,unit_no,floor_label,status) values($1,$2,'WORKSPACE-OTHER','999','1','available')",
    [otherUnit, otherBuilding],
  );
  await db.query(
    "insert into lease_contracts(id,unit_id,customer_id,contract_no,start_date,expected_end_date,payment_cycle,payment_day,monthly_rent_xof,status) values($1,$2,$3,'OTHER',current_date,current_date+365,'monthly',1,999,'active')",
    [otherContract, otherUnit, customer],
  );
  await db.query(
    "insert into sale_contracts(id,unit_id,customer_id,contract_no,signed_date,total_amount_xof,payment_plan_type,status) values($1,$2,$3,'WORKSPACE-SALE',current_date,1000,'flexible_installment','active')",
    [sale, units[0], customer],
  );
  await db.query(
    "insert into sale_payment_schedule(sale_contract_id,installment_no,due_date,amount_xof,status) select $1,n,current_date+n,1,'pending' from generate_series(1,1031) n",
    [sale],
  );
  await db.query(
    "insert into payments(source_type,source_id,unit_id,amount,currency,exchange_rate_to_xof,payment_date,payment_method,receipt_no) select 'lease_rent',$1,$2,1,'XOF',1,current_date-1200+n,'cash','SYNTHETIC-'||n from generate_series(1,1031)n",
    [leases[0], units[0]],
  );
  ({ today } = (await db.query("select current_date::text today")).rows[0]);
});
afterAll(async () => {
  await db?.end();
  await cluster?.close();
});
async function read(
  kind: "lease" | "sale" = "lease",
  patch: Record<string, string | number> = {},
  mode: "list" | "scope" | "detail" | "context" = "list",
  id?: string,
) {
  const q = parseWorkspaceQuery({ projectId: project, buildingId: building, ...patch });
  const { rows } = await db.query("select contract_workspace_read_rpc($1,$2::jsonb,$3,$4) data", [
    kind,
    JSON.stringify(q),
    mode,
    id ?? null,
  ]);
  return decodeWorkspace(rows[0].data, kind, q, mode, id);
}
it("paginates at DB boundary, searches across pages and does not expose historical financial arrays", async () => {
  await db.query("set role authenticated");
  const a = await read(),
    b = await read("lease", { page: 2 });
  expect(a.contracts).toHaveLength(25);
  expect(b.contracts).toHaveLength(7);
  expect(a.total).toBe(32);
  expect(new Set([...a.contracts, ...b.contracts].map((r) => r.id)).size).toBe(32);
  expect(
    (await read("lease", { search: "WORKSPACE-31 elodie" })).contracts.map((r) => r.id),
  ).toEqual([leases[31]]);
  expect(a.payments).toEqual([]);
  expect(a.receivables).toEqual([]);
  expect(a.schedules).toEqual([]);
  expect(a.contracts.some((c) => c.id === otherContract)).toBe(false);
  await db.query("reset role");
});
it("keeps complete-scope stats and managed summaries equivalent to the original JS metrics", async () => {
  const full = await read("lease", {}, "scope"),
    search = await read("lease", { search: "WORKSPACE-31" });
  const rows = (
    await db.query(
      "select to_jsonb(r) data from receivables r where source_type='lease_contract' and source_id=any($1::uuid[])",
      [leases],
    )
  ).rows.map((r) => r.data) as ReceivableRow[];
  const expected = computeFinanceMetrics(rows, { asOfDate: today }),
    summaries = buildContractReceivableSummaries(rows, "lease_contract", today);
  expect(full.stats.currentDue).toBe(expected.outstanding);
  expect(full.stats.overdue).toBe(expected.overdue);
  expect(search.stats).toEqual(full.stats);
  expect(search.total).toBe(1);
  expect(full.scopeCount).toBe(32);
  for (const contract of full.contracts) {
    const actual = full.summaries[contract.id];
    expect({ ...actual, dueOutstanding: undefined }).toEqual({
      ...summaries.get(contract.id),
      dueOutstanding: undefined,
    });
    const rent = contract as { paid_through_date: string; monthly_rent_xof: number };
    const expectedAccrual = resolveLeaseOverdue({
      receivables: rows.filter(
        (r) =>
          r.source_id === contract.id &&
          r.status !== "cancelled" &&
          (r.management_status ?? "managed") === "managed",
      ),
      today,
      paidThroughDate: rent.paid_through_date,
      monthlyRentXof: rent.monthly_rent_xof,
      contractStatus: contract.status,
    });
    expect(full.accruals[contract.id]).toEqual(expectedAccrual);
  }
});
it("loads complete selected-contract histories and schedules beyond the REST page cap", async () => {
  await db.query("set role authenticated");
  const detail = await read("lease", {}, "detail", leases[0]);
  expect(detail.payments).toHaveLength(1031);
  expect(detail.receivables).toHaveLength(3);
  expect(detail.payments[0]).toHaveProperty("request_kind");
  expect(detail.payments[0]).toHaveProperty("reversal_of_payment_id");
  expect(detail.payments[0]).toHaveProperty("payment_method");
  expect((await read("sale", {}, "detail", sale)).schedules).toHaveLength(1031);
  await db.query("reset role");
});
it("rejects anonymous, missing-profile, unknown kinds and a frontline sale read", async () => {
  await db.query("set role authenticated");
  await db.query("select set_config('request.jwt.claims','{}',false)");
  await expect(read()).rejects.toThrow();
  await db.query("select set_config('request.jwt.claims',$1,false)", [
    JSON.stringify({ sub: randomUUID(), role: "authenticated" }),
  ]);
  await expect(read()).rejects.toThrow();
  await db.query("reset role");
  await db.query("update user_profiles set role='front_desk' where id=$1", [actor]);
  await db.query("select set_config('request.jwt.claims',$1,false)", [
    JSON.stringify({ sub: actor, role: "authenticated" }),
  ]);
  await db.query("set role authenticated");
  await expect(read("sale")).rejects.toThrow();
  await db.query("reset role");
  await db.query("update user_profiles set role='admin' where id=$1", [actor]);
});
it("validates project/building relation and selected-detail visibility instead of returning unknown zeros", async () => {
  await expect(read("lease", { buildingId: otherBuilding })).rejects.toThrow();
  await expect(read("lease", {}, "detail", otherContract)).rejects.toThrow();
  await expect(read("lease", { page: 0 })).rejects.toThrow();
});
it("returns no-receivable status as unknown while preserving an overpaid row without negative debt", async () => {
  await db.query("delete from receivables where source_id=$1", [leases[1]]);
  await db.query(
    "update receivables set paid_amount_xof=150,status='paid' where source_id=$1 and category='lease_rent' and management_status='managed'",
    [leases[2]],
  );
  const full = await read("lease", {}, "scope");
  expect(full.summaries[leases[1]].count).toBe(0);
  expect(full.stats.unknownContracts).toBe(1);
  expect(full.summaries[leases[2]].outstanding).toBe(25);
  expect(full.summaries[leases[2]].paid).toBe(150);
});
it("keeps mixed numeric unit and localized status sorting stable across pages, with unknown amounts last", async () => {
  const labels = ["2A", "2B", "A2", "A10", "10-1", "2-1", "2"];
  for (let i = 0; i < labels.length; i++)
    await db.query("update units set unit_no=$2 where id=$1", [units[i], labels[i]]);
  await db.query("update lease_contracts set status='draft' where id=$1", [leases[7]]);
  await db.query("update lease_contracts set status='expired' where id=$1", [leases[8]]);
  await db.query("update lease_contracts set status='terminated' where id=$1", [leases[9]]);
  await db.query("update lease_contracts set monthly_rent_xof=0 where id=$1", [leases[10]]);
  for (const locale of ["zh", "fr"] as const) {
    const all = await read("lease", { status: "all", locale }, "scope");
    const unitMap = new Map(all.units.map((u) => [u.id, u]));
    const rows = all.contracts.map(
      (c) =>
        ({
          id: c.id,
          building: "11 Building",
          unit: unitMap.get(c.unit_id)!.unit_no,
          customer: "Élodie synthetic",
          contractNo: c.contract_no,
          periodStart: (c as { start_date: string }).start_date,
          periodLabel: "",
          amountXof:
            Number((c as { monthly_rent_xof: number }).monthly_rent_xof) > 0
              ? Number((c as { monthly_rent_xof: number }).monthly_rent_xof)
              : null,
          balanceXof: all.summaries[c.id].count ? all.summaries[c.id].outstanding : null,
          status: c.status,
          statusLabel: dictionaries[locale].leases.contractStatus[c.status],
        }) satisfies ContractTableRow,
    );
    for (const sort of ["unit", "status", "amount", "balance", "customer", "period"] as const)
      for (const direction of ["asc", "desc"] as const) {
        const a = await read("lease", { status: "all", locale, sort, direction }),
          b = await read("lease", { status: "all", locale, sort, direction, page: 2 });
        expect(
          [...a.contracts, ...b.contracts].map((c) => c.id),
          `${locale}/${sort}/${direction}`,
        ).toEqual(sortContractRows(rows, { key: sort, direction }).map((c) => c.id));
      }
  }
});
it("matches month-end anchored rent coverage, prior debt, paid coverage and no-coverage branches exactly", async () => {
  const anchors = ["2024-01-30", "2024-02-28", "2025-08-30", null, today];
  for (let i = 0; i < anchors.length; i++) {
    await db.query("update lease_contracts set paid_through_date=$2 where id=$1", [
      leases[i],
      anchors[i],
    ]);
    await db.query(
      "insert into receivables(source_type,source_id,building_id,unit_id,customer_id,category,title,due_date,amount_xof,paid_amount_xof,status,management_status) values('lease_contract',$1,$2,$3,$4,'lease_rent','Prior',date '2024-01-01',50,10,'partial','managed'),('lease_contract',$1,$2,$3,$4,'lease_rent','Paid coverage',current_date-2,100,120,'paid','managed'),('lease_contract',$1,$2,$3,$4,'lease_rent','Cancelled',current_date-3,500,0,'cancelled','managed')",
      [leases[i], building, units[i], customer],
    );
  }
  const all = await read("lease", { status: "all" }, "scope"),
    rows = (
      await db.query("select to_jsonb(r)data from receivables r where source_id=any($1::uuid[])", [
        leases,
      ])
    ).rows.map((r) => r.data) as ReceivableRow[];
  for (const c of all.contracts) {
    const contract = c as { paid_through_date: string | null; monthly_rent_xof: number };
    expect(all.accruals[c.id]).toEqual(
      c.status === "active"
        ? resolveLeaseOverdue({
            receivables: rows.filter(
              (r) =>
                r.source_id === c.id &&
                r.status !== "cancelled" &&
                (r.management_status ?? "managed") === "managed",
            ),
            today,
            paidThroughDate: contract.paid_through_date,
            monthlyRentXof: contract.monthly_rent_xof,
            contractStatus: c.status,
          })
        : null,
    );
  }
});
it("rejects direct-RPC null kind/mode rather than relying only on the HTTP parser", async () => {
  await expect(db.query("select contract_workspace_read_rpc(null,'{}')")).rejects.toThrow();
  await expect(db.query("select contract_workspace_read_rpc('lease','{}',null)")).rejects.toThrow();
});
it("keeps real-schema CIMAC draft and terminated null contract periods unknown across list and full detail", async () => {
  const cimacProject = randomUUID(),
    cimacBuilding = randomUUID(),
    cimacUnits = [randomUUID(), randomUUID()],
    cimacContracts = [randomUUID(), randomUUID()];
  await db.query(
    "insert into projects(id,code,display_name,allows_long_lease) values($1,'CIMAC','Synthetic CIMAC',true)",
    [cimacProject],
  );
  await db.query(
    "insert into buildings(id,project_id,code,display_name) values($1,$2,'CIMAC-SYNTHETIC','Synthetic CIMAC')",
    [cimacBuilding, cimacProject],
  );
  for (let i = 0; i < cimacUnits.length; i++) {
    await db.query(
      "insert into units(id,building_id,code,unit_no,floor_label,status) values($1,$2,$3,$4,'1','available')",
      [cimacUnits[i], cimacBuilding, `CIMAC-NULL-${i}`, `${i + 1}`],
    );
    await db.query(
      "insert into lease_contracts(id,unit_id,customer_id,contract_no,start_date,expected_end_date,expected_end_confirmed,payment_cycle,payment_day,monthly_rent_xof,deposit_amount_xof,status,commencement_state) values($1,$2,$3,$4,null,null,false,'monthly',1,100,100,$5,$6)",
      [
        cimacContracts[i],
        cimacUnits[i],
        customer,
        `CIMAC-NULL-${i}`,
        i ? "terminated" : "draft",
        i ? "cancelled_before_start" : "pending_project_opening",
      ],
    );
  }
  await db.query("set role authenticated");
  try {
    const scope = { projectId: cimacProject, buildingId: cimacBuilding, status: "all" };
    const list = await read("lease", scope);
    expect(list.contracts).toHaveLength(2);
    expect(list.stats.active).toBe(0);
    expect(list.stats.rent).toBe(0);
    expect(list.stats.unknownContracts).toBe(2);
    for (const id of cimacContracts) {
      const detail = await read("lease", scope, "detail", id);
      expect(detail.contracts[0]).toMatchObject({ id, start_date: null, expected_end_date: null });
      expect(list.contracts.find((c) => c.id === id)).toMatchObject({
        start_date: null,
        expected_end_date: null,
      });
      expect(detail.accruals[id]).toBeNull();
      expect(detail.attentionDue[id]).toBeNull();
      expect(detail.receivables).toEqual([]);
    }
  } finally {
    await db.query("reset role");
  }
});
