import { randomUUID } from "node:crypto";
import type pg from "pg";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { createNativePaymentPostgres } from "./helpers/native-payment-postgres";
import { installApplicationRebuild } from "./helpers/application-rebuild";
vi.mock("server-only", () => ({}));
import {
  readAuditWorkbench,
  readAuditWorkbenchDetail,
  readAuditWorkbenchExport,
  auditWorkbenchCsv,
} from "@/features/settings/audit-workbench-service";
import { parseAuditWorkbenchQuery } from "@/features/settings/audit-workbench-model";
import { auditBusinessSummary } from "@/features/settings/audit-business-summary";

let cluster: Awaited<ReturnType<typeof createNativePaymentPostgres>>, db: pg.Client;
beforeAll(async () => {
  cluster = await createNativePaymentPostgres();
  db = await cluster.connect();
  await installApplicationRebuild(db);
}, 45000);
afterAll(async () => {
  await cluster?.close();
});
async function owner() {
  await db.query("reset role");
  await db.query("select set_config('request.jwt.claims','{}',false)");
}
async function login(actor: string, role = "authenticated") {
  await owner();
  await db.query("select set_config('request.jwt.claims',$1,false)", [
    JSON.stringify({ sub: actor, role, email: "synthetic@test.invalid" }),
  ]);
  await db.query(`set role ${role === "anon" ? "anon" : "authenticated"}`);
}
function client(): Pick<SupabaseClient, "rpc"> {
  return {
    rpc: async (name: string, args: Record<string, unknown>) => {
      expect(name).toBe("audit_workbench_read_rpc");
      try {
        return {
          data: (
            await db.query("select public.audit_workbench_read_rpc($1,$2,$3) result", [
              args.p_input,
              args.p_mode,
              args.p_log_id,
            ])
          ).rows[0].result,
          error: null,
        };
      } catch (cause) {
        const error = cause as { code?: string; message?: string };
        return { data: null, error: { code: error.code, message: error.message } };
      }
    },
  } as unknown as Pick<SupabaseClient, "rpc">;
}
async function fixture(role = "admin", count = 1) {
  await owner();
  const actor = randomUUID(),
    action = `audit-test-${randomUUID()}`,
    ids: string[] = [];
  await db.query("insert into auth.users(id,email) values($1,$2)", [
    actor,
    `${actor}@test.invalid`,
  ]);
  await db.query(
    "insert into user_profiles(id,role,display_name) values($1,$2,'Synthetic current account')",
    [actor, role],
  );
  for (let i = 0; i < count; i++) {
    const id = randomUUID();
    ids.push(id);
    await db.query(
      "insert into audit_logs(id,actor_id,actor_email,actor_role,action,entity_type,entity_label,created_at,metadata,before_data,after_data) values($1,$2,$3,$4,$5,'system','Synthetic audit','2026-10-19T15:00:00Z',$6,$7,$8)",
      [
        id,
        actor,
        `${actor}@test.invalid`,
        role,
        action,
        {
          channel: "sacsi_web",
          request_id: `REQ-${i}`,
          original_instruction: "DO NOT RETURN ALL RAW INSTRUCTIONS",
          password: "DO NOT RETURN PASSWORD",
        },
        { password: "secret", amount: 1 },
        { amount: 2 },
      ],
    );
  }
  await login(actor);
  return { actor, action, ids };
}
async function snapshot() {
  await owner();
  return (
    await db.query(
      "select jsonb_build_object('audit',(select md5(coalesce(string_agg(to_jsonb(a)::text,'' order by id),'')) from audit_logs a),'contracts',(select md5(coalesce(string_agg(to_jsonb(c)::text,'' order by id),'')) from lease_contracts c),'payments',(select md5(coalesce(string_agg(to_jsonb(p)::text,'' order by id),'')) from payments p),'receivables',(select md5(coalesce(string_agg(to_jsonb(r)::text,'' order by id),'')) from receivables r)) value",
    )
  ).rows[0].value;
}
it("paginates exactly 30 rows with deterministic created_at/id ties and full filtered counters", async () => {
  const f = await fixture("admin", 65),
    query = parseAuditWorkbenchQuery({ action: f.action });
  const pages = [];
  for (let page = 1; page <= 4; page++)
    pages.push(await readAuditWorkbench(client(), { ...query, page }));
  expect(pages.map((p) => p.rows.length)).toEqual([30, 30, 5, 0]);
  expect(pages[0].summary).toEqual({ total: 65, recorded: 65, missingIdentity: 0, maintenance: 0 });
  expect(pages.every((p) => p.total === 65)).toBe(true);
  expect(pages.flatMap((p) => p.rows.map((r) => r.id))).toEqual(f.ids.sort().reverse());
  for (const row of pages[0].rows) {
    expect(row.before_data).toBeNull();
    expect(row.after_data).toBeNull();
    expect(row.metadata).not.toHaveProperty("password");
    expect(row.metadata).not.toHaveProperty("original_instruction");
  }
});
it.each(["admin", "boss"])(
  "allows current management role %s and keeps finance's existing table RLS unchanged",
  async (role) => {
    const f = await fixture(role);
    expect(
      (await readAuditWorkbench(client(), parseAuditWorkbenchQuery({ action: f.action }))).total,
    ).toBe(1);
  },
);
it.each(["finance", "front_desk", "rental_sales"])(
  "rejects %s for list/detail/export even if other table policies allow its financial logs",
  async (role) => {
    const f = await fixture(role);
    for (const mode of ["list", "export", "detail"])
      await expect(
        db.query("select public.audit_workbench_read_rpc($1,$2,$3)", [
          {},
          mode,
          mode === "detail" ? f.ids[0] : null,
        ]),
      ).rejects.toMatchObject({ code: "42501" });
    if (role === "finance") {
      await owner();
      await db.query("update audit_logs set entity_type='payment' where id=$1", [f.ids[0]]);
      await login(f.actor);
      expect((await db.query("select id from audit_logs where id=$1", [f.ids[0]])).rowCount).toBe(
        1,
      );
    }
  },
);
it("revoked management role takes effect on the next list/detail/export read", async () => {
  const f = await fixture();
  const query = parseAuditWorkbenchQuery({ action: f.action });
  expect((await readAuditWorkbench(client(), query)).total).toBe(1);
  await owner();
  await db.query("update user_profiles set role='front_desk' where id=$1", [f.actor]);
  await login(f.actor);
  await expect(readAuditWorkbench(client(), query)).rejects.toMatchObject({ status: 403 });
  await expect(readAuditWorkbenchDetail(client(), f.ids[0])).rejects.toMatchObject({ status: 403 });
  await expect(readAuditWorkbenchExport(client(), query)).rejects.toMatchObject({ status: 403 });
});
it("does not bypass underlying audit RLS for counters, options, selected detail or export", async () => {
  const f = await fixture();
  await owner();
  await db.query(
    'create policy "Synthetic audit restriction" on public.audit_logs as restrictive for select to authenticated using(false)',
  );
  try {
    await login(f.actor);
    const query = parseAuditWorkbenchQuery({ action: f.action });
    const list = await readAuditWorkbench(client(), query);
    expect(list.rows).toEqual([]);
    expect(list.summary).toEqual({ total: 0, recorded: 0, missingIdentity: 0, maintenance: 0 });
    expect(list.options).toEqual({ actions: [], entityTypes: [], actors: [] });
    expect((await readAuditWorkbenchExport(client(), query)).total).toBe(0);
    await expect(readAuditWorkbenchDetail(client(), f.ids[0])).rejects.toMatchObject({
      status: 404,
    });
  } finally {
    await owner();
    await db.query('drop policy "Synthetic audit restriction" on public.audit_logs');
  }
});
it("does not bypass a revoked underlying audit SELECT grant", async () => {
  const f = await fixture();
  await owner();
  await db.query("begin");
  try {
    await db.query("revoke select on public.audit_logs from authenticated");
    await login(f.actor);
    await expect(
      readAuditWorkbench(client(), parseAuditWorkbenchQuery({ action: f.action })),
    ).rejects.toMatchObject({ status: 403 });
  } finally {
    await db.query("rollback");
    await owner();
  }
});
it("has no anonymous/service/public EXECUTE grant and is stable invoker with a fixed empty search path", async () => {
  await owner();
  const result = (
    await db.query(
      "select p.prosecdef,p.provolatile,p.proconfig,has_function_privilege('anon',p.oid,'EXECUTE') anon,has_function_privilege('service_role',p.oid,'EXECUTE') service from pg_proc p where p.oid='public.audit_workbench_read_rpc(jsonb,text,uuid)'::regprocedure",
    )
  ).rows[0];
  expect(result).toEqual({
    prosecdef: false,
    provolatile: "s",
    proconfig: ['search_path=""', "plan_cache_mode=force_custom_plan"],
    anon: false,
    service: false,
  });
  await login(randomUUID(), "anon");
  await expect(db.query("select public.audit_workbench_read_rpc()")).rejects.toMatchObject({
    code: "42501",
  });
});
it.each([
  { surprise: "value" },
  { page: 0 },
  { page: 1.1 },
  { page: 100001 },
  { page: "1e2" },
  { search: ["room"] },
  { action: null },
  { channel: "guessed" },
  { identity: "verified_human" },
  { dateFrom: "2026-02-30" },
  { dateFrom: "2026-10-20", dateTo: "2026-10-19" },
  { dateTo: "2026-1-01" },
  { search: "x".repeat(201) },
  { search: "room\n408" },
])(
  "rejects malformed filter %# in the database independently of browser validation",
  async (input) => {
    await fixture();
    await expect(
      db.query("select public.audit_workbench_read_rpc($1)", [input]),
    ).rejects.toMatchObject({ code: "22023" });
  },
);
it("applies inclusive Abidjan/UTC dates, exact action/entity/actor/channel/identity and literal search", async () => {
  const f = await fixture("admin", 3);
  await owner();
  await db.query(
    "update audit_logs set created_at='2026-10-19T00:00:00Z',metadata=metadata||'{\"request_id\":\"REQUEST_%_literal\"}' where id=$1",
    [f.ids[0]],
  );
  await db.query("update audit_logs set created_at='2026-10-19T23:59:59.999Z' where id=$1", [
    f.ids[1],
  ]);
  await db.query("update audit_logs set created_at='2026-10-20T00:00:00Z' where id=$1", [f.ids[2]]);
  await login(f.actor);
  const query = parseAuditWorkbenchQuery({
    action: f.action,
    entityType: "system",
    actor: f.actor,
    channel: "sacsi_web",
    identity: "account_recorded",
    dateFrom: "2026-10-19",
    dateTo: "2026-10-19",
  });
  expect((await readAuditWorkbench(client(), query)).rows.map((r) => r.id)).toEqual([
    f.ids[1],
    f.ids[0],
  ]);
  expect(
    (await readAuditWorkbench(client(), { ...query, search: "%_" })).rows.map((r) => r.id),
  ).toEqual([f.ids[0]]);
  expect(
    (await readAuditWorkbench(client(), { ...query, search: "DO NOT RETURN PASSWORD" })).total,
  ).toBe(0);
});
it("never manufactures identity from metadata while distinguishing old maintenance rows", async () => {
  const f = await fixture("admin", 3);
  await owner();
  await db.query(
    'update audit_logs set actor_id=null,actor_email=null,metadata=\'{"actor_email":"forged@test.invalid","actor_display_name":"Forged name","channel":"explicit_user_authorized_maintenance"}\' where id=$1',
    [f.ids[0]],
  );
  await db.query(
    "update audit_logs set actor_id=null,actor_email=' ',metadata='{\"channel\":\"not_a_known_channel\"}' where id=$1",
    [f.ids[1]],
  );
  await login(f.actor);
  const query = parseAuditWorkbenchQuery({ action: f.action }),
    result = await readAuditWorkbench(client(), query);
  expect(result.summary).toEqual({ total: 3, recorded: 1, maintenance: 1, missingIdentity: 1 });
  const maintenance = await readAuditWorkbench(client(), {
    ...query,
    identity: "maintenance_without_account",
  });
  expect(maintenance.rows[0].id).toBe(f.ids[0]);
  expect(maintenance.rows[0].resolved_actor_display_name).toBeNull();
  expect((await readAuditWorkbench(client(), { ...query, actor: "unknown" })).total).toBe(2);
});
it("reads only an exact selected UUID, redacts nested secrets and leaves raw historical payload unchanged", async () => {
  const f = await fixture("admin", 2);
  await owner();
  await db.query(
    "update audit_logs set metadata=metadata||$1::jsonb,before_data=$2,after_data=$3 where id=$4",
    [
      {
        nested: { accessToken: "NEVER RETURN", api_key: "NEVER RETURN", count: 3 },
        collection_result: { success: true, totalAmount: 999 },
      },
      { db: { password: "NEVER RETURN", value: 1 } },
      { array: [{ authorization: "NEVER RETURN", amount: 2 }] },
      f.ids[0],
    ],
  );
  const before = await snapshot();
  await login(f.actor);
  const { log } = await readAuditWorkbenchDetail(client(), f.ids[0]);
  expect(log.id).toBe(f.ids[0]);
  expect(log.metadata).toMatchObject({
    nested: { accessToken: "[REDACTED]", api_key: "[REDACTED]", count: 3 },
  });
  expect(log.metadata).not.toHaveProperty("collection_result");
  expect(JSON.stringify(log)).not.toContain("NEVER RETURN");
  await expect(readAuditWorkbenchDetail(client(), randomUUID())).rejects.toMatchObject({
    status: 404,
  });
  expect(await snapshot()).toEqual(before);
});
it("retains irregular historical JSON only in selected detail without breaking the entire list", async () => {
  const f = await fixture();
  await owner();
  await db.query("update audit_logs set metadata=$1,before_data=$2,after_data=$3 where id=$4", [
    JSON.stringify([{ SUPABASE_SERVICE_ROLE_KEY: "NEVER RETURN", keep: 1 }]),
    JSON.stringify([1, 2]),
    JSON.stringify("recorded scalar"),
    f.ids[0],
  ]);
  await login(f.actor);
  const list = await readAuditWorkbench(client(), parseAuditWorkbenchQuery({ action: f.action }));
  expect(list.rows[0].metadata).toEqual({});
  expect(list.rows[0].after_data).toBeNull();
  const detail = (await readAuditWorkbenchDetail(client(), f.ids[0])).log;
  expect(detail.metadata).toEqual({
    _recorded_value: [{ SUPABASE_SERVICE_ROLE_KEY: "[REDACTED]", keep: 1 }],
  });
  expect(detail.before_data).toEqual({ _recorded_value: [1, 2] });
  expect(detail.after_data).toEqual({ _recorded_value: "recorded scalar" });
});
it("resolves lease_collection entity_id as the exact visible contract/room without guessing collector", async () => {
  const f = await fixture();
  await owner();
  const project = randomUUID(),
    building = randomUUID(),
    unit = randomUUID(),
    customer = randomUUID(),
    contract = randomUUID(),
    payment = randomUUID(),
    request = randomUUID();
  await db.query(
    "insert into projects(id,code,display_name,allows_long_lease) values($1::uuid,$1::text,'Synthetic audit project',true)",
    [project],
  );
  await db.query(
    "insert into buildings(id,project_id,code,display_name) values($1::uuid,$2,$1::text,'Synthetic audit building')",
    [building, project],
  );
  await db.query(
    "insert into units(id,building_id,code,unit_no,floor_label) values($1::uuid,$2,$1::text,'AUDIT-408','4')",
    [unit, building],
  );
  await db.query("insert into customers(id,name) values($1,'Synthetic audit tenant')", [customer]);
  await db.query(
    "insert into lease_contracts(id,unit_id,customer_id,contract_no,start_date,expected_end_date,payment_cycle,payment_day,monthly_rent_xof,deposit_amount_xof,status) values($1,$2,$3,'AUDIT-CONTRACT-408','2026-01-01','2027-01-01','monthly',1,600000,0,'active')",
    [contract, unit, customer],
  );
  await db.query(
    "update audit_logs set action='record_lease_collection',entity_type='lease_collection',entity_id=$1,after_data=$2,metadata=$3 where id=$4",
    [
      contract,
      {
        success: true,
        requestId: request,
        totalAmount: 60,
        currency: "USD",
        paymentIds: [payment],
        referenceNos: ["AUDIT-USD-RECEIPT"],
        allocations: [{ receivableId: randomUUID(), amount: 60 }],
      },
      {
        channel: "sacsi_web",
        request_id: request,
        input: { currency: "USD", amount: 60, paymentDate: "2026-10-19", paymentMethod: "cash" },
        collection_result: { totalAmount: 999 },
      },
      f.ids[0],
    ],
  );
  await login(f.actor);
  const result = await readAuditWorkbench(
    client(),
    parseAuditWorkbenchQuery({ search: "AUDIT-CONTRACT-408" }),
  );
  const row = result.rows.find((r) => r.id === f.ids[0])!;
  expect(row.metadata).toMatchObject({
    unit_no: "AUDIT-408",
    resolved_contract_no: "AUDIT-CONTRACT-408",
    collection_result: { success: true, totalAmount: 60, currency: "USD" },
  });
  expect(row.metadata?.collection_input).not.toHaveProperty("actualCollector");
  expect(row.after_data).toBeNull();
  const csv = auditWorkbenchCsv([row]);
  expect(csv.split("\r\n")[0]).toMatch(/"external_receipt_no","recorded_business_amount"$/);
  expect(csv.split("\r\n")[1]).toMatch(/,"60 USD"$/);
  expect(csv).not.toContain("600,000 XOF");
  expect(
    (
      await readAuditWorkbench(client(), parseAuditWorkbenchQuery({ search: "AUDIT-408" }))
    ).rows.map((r) => r.id),
  ).toContain(f.ids[0]);
});
it("exports the full filtered scope once, not the displayed page, with exact list parity and no raw secrets", async () => {
  const f = await fixture("admin", 63),
    query = parseAuditWorkbenchQuery({ action: f.action, page: 2 });
  const exported = await readAuditWorkbenchExport(client(), query),
    pages = [];
  for (let page = 1; page <= 3; page++)
    pages.push(await readAuditWorkbench(client(), { ...query, page }));
  expect(exported.total).toBe(63);
  expect(exported.rows).toEqual(pages.flatMap((p) => p.rows));
  const csv = auditWorkbenchCsv(exported.rows);
  expect(csv.match(/audit-test-/g)).toHaveLength(63);
  expect(csv).not.toContain("DO NOT RETURN");
  expect(csv).toContain('"identity_status"');
  expect(csv).toContain('"account_recorded"');
});
it("preserves every audit row and linked business row after repeated list/detail/export reads", async () => {
  const f = await fixture("boss", 3),
    before = await snapshot();
  await login(f.actor);
  const query = parseAuditWorkbenchQuery({ action: f.action });
  for (let i = 0; i < 3; i++) {
    await readAuditWorkbench(client(), query);
    await readAuditWorkbenchDetail(client(), f.ids[0]);
    await readAuditWorkbenchExport(client(), query);
  }
  expect(await snapshot()).toEqual(before);
});
it("executes list/detail/export inside a database-enforced read-only transaction", async () => {
  const f = await fixture(),
    query = parseAuditWorkbenchQuery({ action: f.action });
  await db.query("begin read only");
  try {
    await readAuditWorkbench(client(), query);
    await readAuditWorkbenchDetail(client(), f.ids[0]);
    await readAuditWorkbenchExport(client(), query);
  } finally {
    await db.query("rollback");
  }
});
it("keeps list responses bounded when historical before/after/instructions contain large unrelated payloads", async () => {
  const f = await fixture();
  await owner();
  await db.query(
    "insert into audit_logs(actor_id,action,entity_type,metadata,before_data,after_data) select $1,$2,'system',jsonb_build_object('original_instruction',repeat(md5(n::text),2048)),jsonb_build_object('payload',repeat(md5((n+1)::text),2048)),jsonb_build_object('payload',repeat(md5((n+2)::text),2048)) from generate_series(1,600) n",
    [f.actor, f.action],
  );
  await login(f.actor);
  const start = performance.now(),
    result = await readAuditWorkbench(client(), parseAuditWorkbenchQuery({ action: f.action }));
  expect(result.total).toBe(601);
  expect(result.rows).toHaveLength(30);
  expect(JSON.stringify(result).length).toBeLessThan(35000);
  // Generous local bound catches accidental JSON multiplication, not microbenchmark noise.
  expect(performance.now() - start).toBeLessThan(3000);
});
it("fails an oversized complete export explicitly instead of returning the first 100000 rows", async () => {
  const f = await fixture();
  await owner();
  await db.query(
    "insert into audit_logs(actor_id,action,entity_type,metadata) select $1,$2,'system','{}' from generate_series(1,100000)",
    [f.actor, f.action],
  );
  try {
    await login(f.actor);
    await expect(
      readAuditWorkbenchExport(client(), parseAuditWorkbenchQuery({ action: f.action })),
    ).rejects.toMatchObject({ status: 413 });
  } finally {
    await owner();
    await db.query("delete from audit_logs where action=$1", [f.action]);
  }
});
it.each([
  {
    action: "supplementary_payment",
    entityType: "daily_booking",
    metadata: { amount: 30000 },
    amount: "30,000 XOF",
  },
  {
    action: "operator_collection_item",
    entityType: "receivable",
    metadata: { amount: 640000 },
    amount: "640,000 XOF",
  },
  {
    action: "operator_booking_refund",
    entityType: "daily_booking",
    metadata: { plan: { amountXof: 12000 } },
    amount: "12,000 XOF",
  },
  {
    action: "operator_booking_reverse",
    entityType: "daily_booking",
    metadata: { plan: { amountXof: 15000 } },
    amount: "15,000 XOF",
  },
  {
    action: "operator_booking_correct_room",
    entityType: "daily_booking",
    metadata: { plan: { unitCode: "11-408", targetUnitCode: "11-409" } },
    amount: "",
  },
])(
  "preserves recorded $action list/detail business facts without loading heavy plan data or mutating history",
  async ({ action, entityType, metadata, amount }) => {
    const f = await fixture();
    await owner();
    const sourcePlan: Record<string, unknown> =
      "plan" in metadata && metadata.plan ? metadata.plan : {};
    const source = {
      ...metadata,
      channel: "sacsi_web",
      original_instruction: "DO NOT RETURN HEAVY INSTRUCTION",
      plan: {
        ...sourcePlan,
        ignoredPayload: "DO NOT RETURN HEAVY PLAN".repeat(10000),
        nested: { amountXof: 999999 },
      },
    };
    await db.query("update audit_logs set action=$1,entity_type=$2,metadata=$3 where id=$4", [
      action,
      entityType,
      source,
      f.ids[0],
    ]);
    const before = await snapshot();
    await login(f.actor);
    await db.query("begin read only");
    try {
      const query = parseAuditWorkbenchQuery({ search: f.ids[0] });
      const list = await readAuditWorkbench(client(), query),
        detail = (await readAuditWorkbenchDetail(client(), f.ids[0])).log;
      expect(list.total).toBe(1);
      expect(list.rows[0].before_data).toBeNull();
      expect(list.rows[0].after_data).toBeNull();
      expect(list.rows[0].metadata?.plan).toEqual(sourcePlan);
      expect(JSON.stringify(list.rows[0])).not.toContain("DO NOT RETURN");
      expect(JSON.stringify(list.rows[0]).length).toBeLessThan(3000);
      for (const locale of ["zh", "fr"] as const) {
        const projected = auditBusinessSummary(list.rows[0], locale),
          full = auditBusinessSummary(detail, locale);
        expect(projected.paymentAmount).toBe(full.paymentAmount);
        expect(projected.summary).toBe(full.summary);
      }
      expect(auditBusinessSummary(list.rows[0], "zh").paymentAmount).toBe(amount);
      if (action === "operator_booking_correct_room")
        expect(auditBusinessSummary(list.rows[0], "zh").summary).toContain("11-408 → 11-409");
      const exported = await readAuditWorkbenchExport(client(), query);
      expect(exported.rows).toEqual(list.rows);
      const csv = auditWorkbenchCsv(exported.rows);
      expect(csv.split("\r\n")[0]).toMatch(/"external_receipt_no","recorded_business_amount"$/);
      expect(csv.split("\r\n")[1]).toContain(`"${amount}"`);
      expect(csv).not.toContain("DO NOT RETURN");
    } finally {
      await db.query("rollback");
    }
    expect(await snapshot()).toEqual(before);
  },
);
