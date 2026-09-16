import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const PAYMENT_HARDENING_MIGRATION = "20260915150854_harden_operator_daily_payment_integrity.sql";
const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
export function migrationFunction(file: string, name: string) {
  const sql = read(`supabase/migrations/${file}`);
  const start = sql.indexOf(`create or replace function public.${name}(`);
  const end = sql.indexOf("$$;", start);
  if (start < 0 || end < 0) throw new Error(`Missing function ${name} in ${file}`);
  return sql.slice(start, end + 3);
}

export interface PaymentTestDatabase {
  exec(sql: string): Promise<unknown>;
  query<T = Record<string, unknown>>(sql: string, parameters?: unknown[]): Promise<{ rows: T[] }>;
}

export async function installPaymentDatabase(db: Pick<PaymentTestDatabase, "exec">) {
  await db.exec(read("tests/fixtures/operator-payment-schema.sql"));
  await db.exec(migrationFunction("202608210001_promote_ying_to_admin.sql", "current_user_role"));
  await db.exec(migrationFunction("202607290001_atomic_daily_finance_operations.sql", "daily_sync_booking_finance_tx"));
  await db.exec(migrationFunction("202607280003_harden_authorization.sql", "set_authenticated_audit_actor"));
  await db.exec(`create trigger trg_set_authenticated_audit_actor before insert on public.audit_logs
    for each row execute function public.set_authenticated_audit_actor();`);
  for (const file of ["20260914133925_add_operator_action_grants.sql", "20260914133928_add_external_operator_daily_actions.sql", PAYMENT_HARDENING_MIGRATION]) {
    await db.exec(read(`supabase/migrations/${file}`));
  }
}

export async function createPaymentDatabase() {
  const db = await PGlite.create();
  try {
    await installPaymentDatabase(db);
    return db;
  } catch (error) {
    await db.close();
    throw error;
  }
}

export const ids = {
  actor: "11111111-1111-4111-8111-111111111111", otherActor: "22222222-2222-4222-8222-222222222222",
  booking: "33333333-3333-4333-8333-333333333333", unit: "44444444-4444-4444-8444-444444444444",
  agent: "55555555-5555-4555-8555-555555555555", building: "66666666-6666-4666-8666-666666666666",
  request: "77777777-7777-4777-8777-777777777777", secondRequest: "88888888-8888-4888-8888-888888888888",
};

export async function seedPaymentDatabase(db: PaymentTestDatabase) {
  await db.query("insert into auth.users values ($1, 'operator@test.invalid'), ($2, 'other@test.invalid')", [ids.actor, ids.otherActor]);
  await db.query("insert into public.user_profiles values ($1,'admin','Test operator'), ($2,'admin','Other operator')", [ids.actor, ids.otherActor]);
  await db.query("insert into public.buildings values ($1,'TEST','Synthetic building')", [ids.building]);
  await db.query("insert into public.customers values ($1,'Synthetic booking agent')", [ids.agent]);
  await db.query("insert into public.units values ($1,$2,'TEST-01','01')", [ids.unit, ids.building]);
  await db.query(`insert into public.daily_bookings (id,unit_id,customer_id,booking_agent_id,check_in,check_out,
    nightly_price_xof,total_amount_xof,final_amount_xof,status)
    values ($1,$2,$3,$3,current_date-3,current_date,10000,30000,30000,'checked_in')`, [ids.booking, ids.unit, ids.agent]);
  await db.query(`insert into public.receivables (building_id,unit_id,customer_id,source_type,source_id,category,due_date,amount_xof,status)
    values ($1,$2,$3,'daily_booking',$4,'daily_rental',current_date-3,30000,'pending')`, [ids.building, ids.unit, ids.agent, ids.booking]);
}

/** Emulates verified JWT claims; does NOT test the real Supabase Auth service. */
export async function asCaller<T>(db: PaymentTestDatabase, run: () => Promise<T>, options: { actor?: string | null; role?: "authenticated" | "anon" | "service_role"; email?: string } = {}) {
  const role = options.role ?? "authenticated";
  const actor = options.actor === undefined ? ids.actor : options.actor;
  await db.query("select set_config('request.jwt.claims', $1, false)", [JSON.stringify({ role, sub: actor, email: options.email ?? "operator@test.invalid" })]);
  await db.exec(`set role ${role}`);
  try { return await run(); }
  finally { await db.exec("reset role"); }
}

export function recordPayment(db: PaymentTestDatabase, overrides: Partial<{ bookingId: string | null; amount: number | string | null; date: string | null; receipt: string | null; requestId: string | null; actor: Record<string, unknown> }> = {}) {
  const input = { bookingId: ids.booking, amount: 10000, date: "2026-09-15", receipt: "TEST-RECEIPT", requestId: ids.request,
    actor: { channel: "external_codex", original_instruction: "Synthetic payment test" }, ...overrides };
  return db.query<{ result: Record<string, unknown> }>("select public.daily_record_payment_rpc($1::uuid,$2::numeric,$3::date,$4::text,$5::uuid,$6::jsonb) as result",
    [input.bookingId, input.amount, input.date, input.receipt, input.requestId, JSON.stringify(input.actor)]);
}

export async function verifyPayment(db: PaymentTestDatabase, requestId = ids.request) {
  const result = await db.query<{ result: Record<string, unknown> }>("select public.verify_operator_daily_payment($1,$2) as result", [ids.booking, requestId]);
  return result.rows[0].result;
}
