import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type pg from "pg";
import { afterAll, beforeAll, expect, it } from "vitest";
import { createNativePaymentPostgres } from "./helpers/native-payment-postgres";
import { installApplicationRebuild } from "./helpers/application-rebuild";

const migration = "20261015212825_optimize_statement_authorization_sets.sql";
const actor = randomUUID(),
  missing = randomUUID(),
  guest = randomUUID();
let cluster: Awaited<ReturnType<typeof createNativePaymentPostgres>>, db: pg.Client;
type Policy = {
  relname: string;
  polname: string;
  polcmd: string;
  polpermissive: boolean;
  polroles: number[];
  qual: string | null;
  check_expr: string | null;
};
let original: Policy[], optimized: Policy[];
let open: Awaited<ReturnType<typeof seed>>, hidden: Awaited<ReturnType<typeof seed>>;
let helpers: unknown;
let relationSecurity: unknown, definerCount: unknown;
const reads = [
  "projects",
  "buildings",
  "units",
  "unit_business_flags",
  "customers",
  "daily_bookings",
  "lease_contracts",
  "sale_contracts",
  "sale_payment_schedule",
  "payments",
  "ledger_entries",
  "receivables",
  "cleaning_tasks",
  "notifications",
  "property_fee_rules",
  "user_profiles",
  "project_account_access",
  "audit_logs",
];
beforeAll(async () => {
  cluster = await createNativePaymentPostgres();
  db = await cluster.connect();
  const manifest = JSON.parse(
    readFileSync(resolve("supabase/baselines/rebuild-manifest.json"), "utf8"),
  );
  await installApplicationRebuild(
    db,
    manifest.overlays.some((x: { file: string }) => x.file === migration)
      ? { beforeMigration: migration }
      : undefined,
  );
  await db.query("set search_path=''");
  original = await policies();
  helpers = (
    await db.query(
      "select proname,pg_get_functiondef(oid) definition,proacl,proowner from pg_proc where pronamespace='public'::regnamespace and proname in ('current_user_role','has_app_role','can_access_project','can_access_building','can_access_unit') order by proname",
    )
  ).rows;
  relationSecurity = (
    await db.query(
      "select n.nspname,c.relname,c.relrowsecurity,c.relforcerowsecurity,c.relacl,c.relowner from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','private') and c.relkind in ('r','v','p') order by n.nspname,c.relname",
    )
  ).rows;
  definerCount = (
    await db.query(
      "select count(*)::int n from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private') and p.prosecdef",
    )
  ).rows;
  await db.query(
    "insert into auth.users(id,email) values($1,'authorization@test.invalid'),($2,'no-profile@test.invalid')",
    [actor, missing],
  );
  await db.query(
    "insert into public.user_profiles(id,role,display_name) values($1,'admin','Authorization test')",
    [actor],
  );
  await claims(actor);
  await db.query(
    "insert into public.customers(id,name) values($1,'Synthetic authorization customer')",
    [guest],
  );
  open = await seed(false);
  hidden = await seed(true);
  // Preserve the exact legacy nullable and conflicting-reference boundaries.
  for (const [building, unit] of [
    [null, null],
    [null, open.unit],
    [open.building, null],
    [open.building, hidden.unit],
    [hidden.building, open.unit],
  ])
    await db.query(
      "insert into public.ledger_entries(building_id,unit_id,entry_date,direction,category,amount_xof) values($1,$2,current_date,'income','daily_rental',10)",
      [building, unit],
    );
  for (const [building, unit] of [
    [null, null],
    [null, open.unit],
    [open.building, null],
    [open.building, hidden.unit],
    [hidden.building, open.unit],
  ])
    await db.query(
      "insert into public.receivables(building_id,unit_id,source_type,category,title,due_date,amount_xof,paid_amount_xof,status) values($1,$2,'manual','other','Synthetic nullable boundary',current_date,100,0,'pending')",
      [building, unit],
    );
  await db.query(
    "insert into public.payments(source_type,payment_date,amount,currency,exchange_rate_to_xof,payment_method) values('parking_fee',current_date,10,'XOF',1,'cash')",
  );
  await db.query(readFileSync(resolve("supabase/migrations", migration), "utf8"));
  optimized = await policies();
}, 45000);
afterAll(async () => {
  await cluster?.close();
});
async function policies() {
  return (
    await db.query(
      "select c.relname,p.polname,p.polcmd,p.polpermissive,p.polroles,pg_get_expr(p.polqual,p.polrelid) qual,pg_get_expr(p.polwithcheck,p.polrelid) check_expr from pg_policy p join pg_class c on c.oid=p.polrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' order by c.relname,p.polname",
    )
  ).rows as Policy[];
}
const ident = (s: string) => `"${s.replaceAll('"', '""')}"`;
async function applyPolicies(rows: Policy[]) {
  for (const p of rows)
    await db.query(
      `alter policy ${ident(p.polname)} on public.${ident(p.relname)}${p.qual === null ? "" : ` using (${p.qual})`}${p.check_expr === null ? "" : ` with check (${p.check_expr})`}`,
    );
}
async function claims(id: string | null, role = "authenticated") {
  await db.query("select set_config('request.jwt.claims',$1,false)", [
    JSON.stringify({ sub: id, role, email: "admin@sacsi.com" }),
  ]);
}
async function seed(restricted: boolean) {
  const project = randomUUID(),
    building = randomUUID(),
    unit = randomUUID(),
    lease = randomUUID(),
    sale = randomUUID(),
    booking = randomUUID(),
    payment = randomUUID();
  await db.query(
    "insert into public.projects(id,code,display_name,access_mode,allows_daily_rental,allows_long_lease,allows_sale) values($1,$2,'Synthetic authorization project',$3,true,true,true)",
    [project, project, restricted ? "restricted" : "open"],
  );
  await db.query(
    "insert into public.buildings(id,project_id,code,display_name) values($1,$2,$3,'Synthetic building')",
    [building, project, building],
  );
  await db.query(
    "insert into public.units(id,building_id,code,unit_no,floor_label,status) values($1,$2,$3,'AUTH-1','1','available')",
    [unit, building, unit],
  );
  await db.query(
    "insert into public.unit_business_flags(unit_id,business_type,is_enabled) values($1,'daily_rental',true)",
    [unit],
  );
  await db.query(
    "insert into public.lease_contracts(id,unit_id,customer_id,contract_no,start_date,expected_end_date,payment_cycle,payment_day,monthly_rent_xof,status) values($1,$2,$3,$4,current_date,current_date+365,'monthly',1,100,'active')",
    [lease, unit, guest, lease],
  );
  await db.query(
    "insert into public.sale_contracts(id,unit_id,customer_id,contract_no,signed_date,payment_plan_type,total_amount_xof,status) values($1,$2,$3,$4,current_date,'lump_sum',1000,'active')",
    [sale, unit, guest, sale],
  );
  await db.query(
    "insert into public.sale_payment_schedule(sale_contract_id,installment_no,due_date,amount_xof,status) values($1,1,current_date,1000,'pending')",
    [sale],
  );
  await db.query(
    "insert into public.daily_bookings(id,unit_id,customer_id,check_in,check_out,total_amount_xof,status) values($1,$2,$3,current_date,current_date+1,100,'confirmed')",
    [booking, unit, guest],
  );
  await db.query(
    "insert into public.payments(id,unit_id,source_type,source_id,payment_date,amount,currency,exchange_rate_to_xof,payment_method) values($1,$2,'daily_booking',$3,current_date,100,'XOF',1,'cash')",
    [payment, unit, booking],
  );
  await db.query(
    "insert into public.ledger_entries(building_id,unit_id,payment_id,entry_date,direction,category,amount_xof) values($1,$2,$3,current_date,'income','daily_rental',100)",
    [building, unit, payment],
  );
  await db.query(
    "insert into public.receivables(building_id,unit_id,customer_id,source_type,source_id,category,title,due_date,amount_xof,paid_amount_xof,status) values($1,$2,$3,'daily_booking',$4,'daily_rental','Synthetic receivable',current_date,100,0,'pending')",
    [building, unit, guest, booking],
  );
  await db.query("insert into public.cleaning_tasks(unit_id,is_completed) values($1,false)", [
    unit,
  ]);
  await db.query(
    "insert into public.property_fee_rules(unit_id,monthly_amount_xof,start_date) values($1,10,current_date)",
    [unit],
  );
  return { project, building, unit, booking, payment };
}
async function state(version: Policy[]) {
  await applyPolicies(version);
  await db.query("set role authenticated");
  try {
    const result: Record<string, unknown> = {};
    for (const table of reads)
      result[table] = (
        await db.query(
          `select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) records from public.${ident(table)} t`,
        )
      ).rows[0].records;
    result.helpers = (
      await db.query(
        "select public.can_access_project($1) project_open,public.can_access_project($2) project_hidden,public.can_access_building($3) building_open,public.can_access_unit($4) unit_open,public.can_access_unit($5) unit_hidden,public.can_access_unit(null) unit_null,public.can_access_unit($6) unit_missing",
        [open.project, hidden.project, open.building, open.unit, hidden.unit, randomUUID()],
      )
    ).rows[0];
    return result;
  } finally {
    await db.query("reset role");
  }
}
it.each(["admin", "boss", "finance", "front_desk", "rental_sales"])(
  "preserves original read rows/helpers for %s, including every nullable and conflicting project reference",
  async (role) => {
    await db.query("update public.user_profiles set role=$1 where id=$2", [role, actor]);
    await claims(actor);
    expect(await state(optimized)).toEqual(await state(original));
    await applyPolicies(optimized);
  },
);
it("preserves missing identity/profile outcomes and does not trust an admin-looking email claim", async () => {
  for (const id of [missing, null]) {
    await claims(id);
    expect(await state(optimized)).toEqual(await state(original));
  }
  await claims(actor);
  await db.query("update public.user_profiles set role='admin' where id=$1", [actor]);
  await applyPolicies(optimized);
});
it("preserves policy commands/roles/boolean clauses, all RLS flags, helper definitions/ACL and adds no definer", async () => {
  expect(optimized.map(({ qual: _q, check_expr: _c, ...meta }) => meta)).toEqual(
    original.map(({ qual: _q, check_expr: _c, ...meta }) => meta),
  );
  for (let i = 0; i < original.length; i++) {
    expect(optimized[i].qual === null).toBe(original[i].qual === null);
    expect(optimized[i].check_expr === null).toBe(original[i].check_expr === null);
  }
  expect(
    (
      await db.query(
        "select proname,pg_get_functiondef(oid) definition,proacl,proowner from pg_proc where pronamespace='public'::regnamespace and proname in ('current_user_role','has_app_role','can_access_project','can_access_building','can_access_unit') order by proname",
      )
    ).rows,
  ).toEqual(helpers);
  expect(
    (
      await db.query(
        "select n.nspname,c.relname,c.relrowsecurity,c.relforcerowsecurity,c.relacl,c.relowner from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','private') and c.relkind in ('r','v','p') order by n.nspname,c.relname",
      )
    ).rows,
  ).toEqual(relationSecurity);
  expect(
    (
      await db.query(
        "select count(*)::int n from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private') and p.prosecdef",
      )
    ).rows,
  ).toEqual(definerCount);
  const plan = (await explain(optimized)).Plan;
  const text = JSON.stringify(plan);
  expect(text).toContain("InitPlan");
  expect(text).not.toContain("can_access_unit");
  expect(text).not.toContain("can_access_building");
});
async function attempt(version: Policy[], sql: string, params: unknown[]) {
  await db.query("begin");
  try {
    await applyPolicies(version);
    await db.query("set local role authenticated");
    try {
      const r = await db.query(sql, params);
      return { code: "OK", count: r.rowCount };
    } catch (error) {
      return { code: (error as { code: string }).code };
    }
  } finally {
    await db.query("rollback");
  }
}
it.each(["admin", "boss", "finance", "front_desk", "rental_sales"])(
  "preserves original INSERT/UPDATE USING+WITH CHECK for %s without cross-project reassignment",
  async (role) => {
    await db.query("update public.user_profiles set role=$1 where id=$2", [role, actor]);
    await claims(actor);
    const requests: [string, unknown[]][] = [
      [
        "insert into public.ledger_entries(building_id,unit_id,entry_date,direction,category,amount_xof) values($1,$2,current_date,'income','daily_rental',10)",
        [open.building, open.unit],
      ],
      [
        "insert into public.ledger_entries(building_id,unit_id,entry_date,direction,category,amount_xof) values($1,$2,current_date,'income','daily_rental',10)",
        [open.building, hidden.unit],
      ],
      [
        "insert into public.ledger_entries(building_id,unit_id,entry_date,direction,category,amount_xof) values(null,null,current_date,'income','daily_rental',10)",
        [],
      ],
      ["update public.payments set unit_id=$1 where id=$2", [hidden.unit, open.payment]],
      ["update public.payments set notes='Synthetic authorized note' where id=$1", [open.payment]],
      ["update public.units set building_id=$1 where id=$2", [hidden.building, open.unit]],
      ["update public.projects set access_mode='restricted' where id=$1", [open.project]],
      ["update public.user_profiles set role='boss' where id=$1", [actor]],
      [
        "insert into public.property_fee_rules(unit_id,monthly_amount_xof,start_date) values($1,20,current_date+365)",
        [hidden.unit],
      ],
      [
        "insert into public.projects(id,code,display_name,access_mode) values($1,$2,'Synthetic inserted project','open')",
        [randomUUID(), randomUUID()],
      ],
      ["update public.projects set id=$1 where id=$2", [randomUUID(), open.project]],
      ["delete from public.cleaning_tasks where unit_id=$1", [open.unit]],
      ["delete from public.ledger_entries where unit_id=$1", [hidden.unit]],
      [
        "insert into public.payments(unit_id,source_type,payment_date,amount,currency,exchange_rate_to_xof,payment_method) values($1,'daily_booking',current_date,10,'XOF',1,'cash')",
        [randomUUID()],
      ],
    ];
    for (const [sql, params] of requests) {
      const after = await attempt(optimized, sql, params);
      expect(after, sql).toEqual(await attempt(original, sql, params));
      if (
        sql === "update public.payments set unit_id=$1 where id=$2" &&
        ["admin", "finance"].includes(role)
      )
        expect(after.code).toBe("42501");
    }
  },
);
it("reevaluates grants and application role after each statement even with a reused prepared plan", async () => {
  await applyPolicies(optimized);
  await db.query("update public.user_profiles set role='admin' where id=$1", [actor]);
  await claims(actor);
  await db.query(
    "prepare authorization_read as select count(*)::int n from public.units where id=$1",
  );
  const read = async () => {
    await db.query("set role authenticated");
    try {
      return (await db.query(`execute authorization_read('${hidden.unit}')`)).rows[0].n;
    } finally {
      await db.query("reset role");
    }
  };
  expect(await read()).toBe(0);
  await db.query(
    "insert into public.project_account_access(project_id,account_id,account_email) values($1,$2,'authorization@test.invalid')",
    [hidden.project, actor],
  );
  expect(await read()).toBe(1);
  expect(await state(optimized)).toEqual(await state(original));
  await applyPolicies(optimized);
  await db.query(
    "delete from public.project_account_access where project_id=$1 and account_id=$2",
    [hidden.project, actor],
  );
  expect(await read()).toBe(0);
  await db.query("delete from public.user_profiles where id=$1", [actor]);
  expect(await read()).toBe(0);
  await db.query(
    "insert into public.user_profiles(id,role,display_name) values($1,'admin','Authorization test')",
    [actor],
  );
  await db.query("deallocate authorization_read");
});
async function explain(version: Policy[]) {
  await applyPolicies(version);
  await db.query("set role authenticated");
  try {
    return (
      await db.query(
        "explain(analyze,format json,timing false) select count(*) from public.ledger_entries",
      )
    ).rows[0]["QUERY PLAN"][0];
  } finally {
    await db.query("reset role");
  }
}
it("removes nested per-row authorization calls on a complete 2600-plus-row ledger without changing its count/IDs", async () => {
  await db.query(
    "insert into public.ledger_entries(building_id,unit_id,entry_date,direction,category,amount_xof) select $1,$2,current_date,'income','daily_rental',10 from generate_series(1,2600)",
    [open.building, open.unit],
  );
  const before = await explain(original),
    after = await explain(optimized);
  process.stdout.write(
    JSON.stringify({
      name: "AuthorizationNativeSyntheticPlan",
      beforeMs: before["Execution Time"],
      afterMs: after["Execution Time"],
    }) + "\n",
  );
  expect(JSON.stringify(before.Plan)).toContain("can_access_unit");
  expect(JSON.stringify(after.Plan)).not.toContain("can_access_unit");
  const identity = async (version: Policy[]) => {
    await applyPolicies(version);
    await db.query("set role authenticated");
    try {
      return (
        await db.query(
          "select count(*)::int n,md5(coalesce(string_agg(id::text,',' order by id),'')) ids from public.ledger_entries",
        )
      ).rows[0];
    } finally {
      await db.query("reset role");
    }
  };
  expect(await identity(optimized)).toEqual(await identity(original));
  await applyPolicies(optimized);
});

it("rejects an added parent restrictive policy and rolls back without changing any existing policy", async () => {
  await applyPolicies(original);
  await db.query(
    'create policy "Synthetic additional parent restriction" on public.buildings as restrictive for select to authenticated using(true)',
  );
  const before = await policies();
  try {
    await expect(
      db.query(readFileSync(resolve("supabase/migrations", migration), "utf8")),
    ).rejects.toThrow("authorizationParentPolicyMigrationDrift");
    await db.query("rollback");
    expect(await policies()).toEqual(before);
  } finally {
    await db.query("rollback");
    await db.query('drop policy "Synthetic additional parent restriction" on public.buildings');
    await applyPolicies(optimized);
  }
});

it("refuses a disabled parent RLS boundary instead of inheriting unauthorized parent rows", async () => {
  await applyPolicies(original);
  await db.query("alter table public.units disable row level security");
  try {
    await expect(
      db.query(readFileSync(resolve("supabase/migrations", migration), "utf8")),
    ).rejects.toThrow("authorizationParentRlsMigrationDrift");
    await db.query("rollback");
    expect(await policies()).toEqual(original);
  } finally {
    await db.query("rollback");
    await db.query("alter table public.units enable row level security");
    await applyPolicies(optimized);
  }
});
