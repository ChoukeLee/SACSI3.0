import { randomUUID } from "node:crypto";
import type pg from "pg";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { createNativePaymentPostgres } from "./helpers/native-payment-postgres";
import { installApplicationRebuild } from "./helpers/application-rebuild";

vi.mock("server-only", () => ({}));
import { readFinanceRecordContext } from "@/features/finance/finance-record-context-read";
import { decodePaymentContext } from "@/features/finance/payment-context";

let cluster: Awaited<ReturnType<typeof createNativePaymentPostgres>>;
let db: pg.Client;
beforeAll(async () => {
  cluster = await createNativePaymentPostgres();
  db = await cluster.connect();
  await installApplicationRebuild(db);
}, 45000);
afterAll(async () => {
  await cluster?.close();
});

const allowedColumns: Record<string, readonly string[]> = {
  ledger_entries: [
    "id",
    "building_id",
    "unit_id",
    "payment_id",
    "entry_date",
    "direction",
    "category",
    "amount_xof",
    "currency",
    "amount_native",
    "description",
  ],
  receivables: [
    "id",
    "building_id",
    "unit_id",
    "customer_id",
    "source_type",
    "source_id",
    "category",
    "title",
    "due_date",
    "amount_xof",
    "paid_amount_xof",
    "currency",
    "amount_native",
    "paid_amount_native",
    "status",
    "management_status",
    "service_period_start",
    "service_period_end",
    "service_period_source",
  ],
  units: ["id", "unit_no", "building_id"],
  buildings: ["id", "display_name", "project_id"],
  payments: [
    "id",
    "unit_id",
    "customer_id",
    "source_type",
    "source_id",
    "payment_method",
    "amount",
    "currency",
    "exchange_rate_to_xof",
    "native_settlement",
    "payment_date",
    "reversal_of_payment_id",
  ],
  lease_contracts: ["id", "unit_id", "customer_id", "contract_no"],
  sale_contracts: ["id", "unit_id", "customer_id", "contract_no"],
  daily_bookings: ["id", "unit_id", "guest_customer_id"],
  customers: ["id", "name"],
};
const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;

/** Test-only REST-shaped adapter: local PG, fixed read-only SQL, real caller RLS. */
function authenticatedClient(actor: string): Pick<SupabaseClient, "from"> {
  return {
    from(table: string) {
      if (!Object.hasOwn(allowedColumns, table)) throw new Error("Unknown native read table");
      return {
        select(columns: string) {
          const selected = columns.split(",");
          if (
            !selected.length ||
            selected.some((column) => !allowedColumns[table].includes(column))
          )
            throw new Error("Unknown native read column");
          return {
            eq(key: string, target: string) {
              if (key !== "id" || !uuid.test(target)) throw new Error("Invalid native ID read");
              return {
                async maybeSingle() {
                  const identity = (await db.query("select current_user as role,auth.uid() actor"))
                    .rows[0];
                  expect(identity).toEqual({ role: "authenticated", actor });
                  try {
                    // JSON conversion reproduces PostgREST ISO dates and numeric values.
                    // Every interpolated identifier was checked against the fixed list above.
                    const result = await db.query(
                      `select to_jsonb(s) doc from (select ${selected.join(",")} from public.${table} where id=$1::uuid) s`,
                      [target],
                    );
                    if (result.rows.length > 1) throw new Error("Duplicate native ID read");
                    return { data: result.rows[0]?.doc ?? null, error: null };
                  } catch (cause) {
                    const error = cause as { code?: string; message?: string };
                    return { data: null, error: { code: error.code, message: error.message } };
                  }
                },
              };
            },
          };
        },
      };
    },
  } as unknown as Pick<SupabaseClient, "from">;
}

async function owner() {
  await db.query("reset role");
  await db.query("select set_config('request.jwt.claims','{}',false)");
}
async function login(actor: string) {
  await owner();
  await db.query("select set_config('request.jwt.claims',$1,false)", [
    JSON.stringify({ sub: actor, role: "authenticated" }),
  ]);
  await db.query("set role authenticated");
}
async function fixture(restricted = false) {
  await owner();
  const f = {
    actor: randomUUID(),
    project: randomUUID(),
    building: randomUUID(),
    unit: randomUUID(),
    customer: randomUUID(),
    contract: randomUUID(),
    payment: randomUUID(),
    ledger: randomUUID(),
    feeLedger: randomUUID(),
    receivable: randomUUID(),
    feeReceivable: randomUUID(),
  };
  await db.query("insert into auth.users(id,email) values($1,$2)", [
    f.actor,
    `${f.actor}@test.invalid`,
  ]);
  await db.query(
    "insert into user_profiles(id,role,display_name) values($1,'finance','Synthetic finance reader')",
    [f.actor],
  );
  await db.query(
    "insert into projects(id,code,display_name,access_mode,allows_long_lease) values($1::uuid,$1::text,'Synthetic finance project',$2,true)",
    [f.project, restricted ? "restricted" : "open"],
  );
  await db.query(
    "insert into buildings(id,project_id,code,display_name) values($1::uuid,$2,$1::text,'Synthetic finance building')",
    [f.building, f.project],
  );
  await db.query(
    "insert into units(id,building_id,code,unit_no,floor_label,status) values($1::uuid,$2,$1::text,'TEST-408','4','leased')",
    [f.unit, f.building],
  );
  await db.query("insert into customers(id,name) values($1,'Synthetic historical tenant')", [
    f.customer,
  ]);
  await db.query(
    "insert into lease_contracts(id,unit_id,customer_id,contract_no,start_date,expected_end_date,payment_cycle,payment_day,monthly_rent_xof,deposit_amount_xof,status) values($1::uuid,$2,$3,$1::text,'2026-10-01','2027-09-30','monthly',1,600000,0,'active')",
    [f.contract, f.unit, f.customer],
  );
  // One original-currency payment funds two distinct XOF ledger/allocation components.
  await db.query(
    "insert into payments(id,customer_id,unit_id,source_type,source_id,payment_date,amount,currency,exchange_rate_to_xof,payment_method) values($1,$2,$3,'lease_rent',$4,'2026-10-17',384,'CNY',10000,'bank_transfer')",
    [f.payment, f.customer, f.unit, f.contract],
  );
  await db.query(
    "insert into ledger_entries(id,building_id,unit_id,payment_id,entry_date,direction,category,amount_xof,description) values($1,$2,$3,$4,'2026-10-18','income','lease_rent',3600000,'Synthetic rent component'),($5,$2,$3,$4,'2026-10-18','income','property_fee',240000,'Synthetic property component')",
    [f.ledger, f.building, f.unit, f.payment, f.feeLedger],
  );
  await db.query(
    "insert into receivables(id,building_id,unit_id,customer_id,source_type,source_id,category,title,due_date,amount_xof,paid_amount_xof,status,management_status) values($1,$2,$3,$4,'lease_contract',$5,'lease_rent','Synthetic six month rent','2026-10-01',3600000,3600000,'paid','managed'),($6,$2,$3,$4,'lease_contract',$5,'property_fee','Synthetic property fee','2026-10-01',240000,240000,'paid','managed')",
    [f.receivable, f.building, f.unit, f.customer, f.contract, f.feeReceivable],
  );
  for (const [receivable, amount] of [
    [f.receivable, 3600000],
    [f.feeReceivable, 240000],
  ] as const)
    await db.query(
      "insert into payment_receivable_allocations(payment_id,receivable_id,amount_xof,actor_id,request_id) values($1,$2,$3,$4,$5)",
      [f.payment, receivable, amount, f.actor, randomUUID()],
    );
  await login(f.actor);
  return f;
}

async function businessSnapshot() {
  await owner();
  return (
    await db.query(`select jsonb_build_object(
    'payments',(select jsonb_build_object('count',count(*),'amount',sum(amount),'xof',sum(amount*exchange_rate_to_xof)) from payments),
    'ledger',(select jsonb_build_object('count',count(*),'amount',sum(amount_xof)) from ledger_entries),
    'receivables',(select jsonb_build_object('count',count(*),'amount',sum(amount_xof),'paid',sum(paid_amount_xof)) from receivables),
    'allocations',(select jsonb_build_object('count',count(*),'amount',sum(amount_xof)) from payment_receivable_allocations),
    'contracts',(select count(*) from lease_contracts),
    'units',(select count(*) from units),
    'audit',(select count(*) from audit_logs)
  ) result`)
  ).rows[0].result;
}

it("reads real lease/payment/ledger/receivable columns under authenticated RLS with ISO dates", async () => {
  const f = await fixture();
  const client = authenticatedClient(f.actor);
  const ledger = await readFinanceRecordContext(client, { kind: "ledger", id: f.ledger });
  expect(ledger).toMatchObject({
    id: f.ledger,
    amountXof: 3600000,
    date: "2026-10-18",
    direction: "income",
    paymentId: f.payment,
    paymentMethod: "bank_transfer",
    building: { id: f.building, projectId: f.project },
    unit: { id: f.unit, label: "TEST-408" },
    customer: { id: f.customer, label: "Synthetic historical tenant" },
    source: { type: "lease_contract", id: f.contract, href: `/leases?project=${f.project}` },
  });
  const receivable = await readFinanceRecordContext(client, {
    kind: "receivables",
    id: f.receivable,
  });
  expect(receivable).toMatchObject({
    amountXof: 3600000,
    paidAmountXof: 3600000,
    status: "paid",
    date: "2026-10-01",
    paymentId: null,
    customer: { id: f.customer },
    source: { id: f.contract },
  });
});

it("keeps original currency payment, selected XOF ledger and explicit allocation amounts distinct", async () => {
  const f = await fixture();
  const ledger = await readFinanceRecordContext(authenticatedClient(f.actor), {
    kind: "ledger",
    id: f.ledger,
  });
  const payment = decodePaymentContext(
    (await db.query("select public.payment_context_read_rpc($1) result", [f.payment])).rows[0]
      .result,
  );
  expect(ledger.amountXof).toBe(3600000);
  expect(payment).toMatchObject({
    paymentId: f.payment,
    amount: 384,
    currency: "CNY",
    paymentDate: "2026-10-17",
    allocatedXof: 3840000,
  });
  expect(payment.allocations.map((row) => row.allocatedXof).sort((a, b) => a - b)).toEqual([
    240000, 3600000,
  ]);
});

it("returns 404 for explicitly selected ledger and receivable IDs hidden by real project RLS", async () => {
  const f = await fixture(true);
  const client = authenticatedClient(f.actor);
  for (const [kind, id] of [
    ["ledger", f.ledger],
    ["receivables", f.receivable],
  ] as const)
    await expect(readFinanceRecordContext(client, { kind, id })).rejects.toMatchObject({
      status: 404,
    });
});

it("does not overwrite explicit financial customers after the linked contract customer changes", async () => {
  const f = await fixture();
  const changed = randomUUID();
  await owner();
  await db.query("insert into customers(id,name) values($1,'Synthetic later contract customer')", [
    changed,
  ]);
  await db.query("update lease_contracts set customer_id=$1 where id=$2", [changed, f.contract]);
  await login(f.actor);
  const client = authenticatedClient(f.actor);
  for (const [kind, id] of [
    ["ledger", f.ledger],
    ["receivables", f.receivable],
  ] as const) {
    const result = await readFinanceRecordContext(client, { kind, id });
    expect(result.customer).toBeNull();
    expect(result.source).toBeNull();
    expect(result.amountXof).toBe(3600000);
  }
});

it("preserves a real confirmed end-only receivable period without inventing its start", async () => {
  const f = await fixture();
  await owner();
  await db.query(
    "update receivables set service_period_start=null,service_period_end='2027-03-31',service_period_source='Synthetic confirmed end only',service_period_confirmed_by=$1 where id=$2",
    [f.actor, f.receivable],
  );
  await login(f.actor);
  const result = await readFinanceRecordContext(authenticatedClient(f.actor), {
    kind: "receivables",
    id: f.receivable,
  });
  expect(result.period).toEqual({
    start: null,
    end: "2027-03-31",
    source: "Synthetic confirmed end only",
  });
  expect(result.date).toBe("2026-10-01");
});

it("leaves business row counts, all money totals and audit records unchanged after repeated reads", async () => {
  const f = await fixture();
  const before = await businessSnapshot();
  await login(f.actor);
  const client = authenticatedClient(f.actor);
  for (let pass = 0; pass < 3; pass++) {
    await readFinanceRecordContext(client, { kind: "ledger", id: f.ledger });
    await readFinanceRecordContext(client, { kind: "ledger", id: f.feeLedger });
    await readFinanceRecordContext(client, { kind: "receivables", id: f.receivable });
    await db.query("select public.payment_context_read_rpc($1)", [f.payment]);
  }
  expect(await businessSnapshot()).toEqual(before);
});
