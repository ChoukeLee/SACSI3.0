import { afterAll, beforeAll, beforeEach, afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import type { PGlite } from "@electric-sql/pglite";
import { asCaller, createPaymentDatabase, ids, migrationFunction, seedPaymentDatabase } from "./helpers/operator-payment-database";

let db: PGlite;
const migration = readFileSync("supabase/migrations/20260923095940_fix_receipt_currency_type.sql", "utf8");
const original = migrationFunction("202607280002_restore_missing_foundations.sql", "confirm_receipt_payment");
beforeAll(async () => {
  db = await createPaymentDatabase();
  await seedPaymentDatabase(db);
  await db.exec("update public.receivables set due_date='2026-09-23'");
  await db.exec(`create table public.attachments (
    id uuid primary key default gen_random_uuid(), storage_path text, bucket text, file_type text,
    linked_type text, linked_id uuid, unit_id uuid, customer_id uuid, uploaded_by uuid,
    ocr_text text, ocr_provider text, metadata jsonb);
    grant select on public.units to authenticated;
    grant select, insert on public.payments, public.ledger_entries, public.audit_logs, public.attachments to authenticated;
    grant select, update on public.receivables to authenticated;`);
  for (const table of ["payments", "ledger_entries", "audit_logs", "receivables", "attachments"]) {
    await db.exec(`alter table public.${table} enable row level security;
      create policy fixture_finance on public.${table} to authenticated
      using (public.current_user_role() in ('admin','finance'))
      with check (public.current_user_role() in ('admin','finance'));`);
  }
}, 30000);
beforeEach(async () => { await db.exec("begin"); await db.exec(migration); });
afterEach(async () => { await db.exec("rollback"); });
afterAll(async () => { await db?.close(); });
const payload = { room_no: "01", receipt_date: "2026-09-23", amount_xof: 10000,
  period_start: "2026-09-01", period_end: "2026-09-30",
  business_type: "daily_rental", receipt_no: "SYNTHETIC-ONLY", image_path: "test/receipt.jpg" };
async function invokeReceipt(extra: Record<string, unknown>) {
  await db.exec("savepoint rpc_call");
  try {
    return await db.query<{ result: Record<string, unknown> }>(
      "select public.confirm_receipt_payment($1::jsonb) result", [JSON.stringify({ ...payload, ...extra })]);
  } catch (error) {
    await db.exec("rollback to savepoint rpc_call");
    throw error;
  } finally { await db.exec("release savepoint rpc_call"); }
}
const confirm = (extra: Record<string, unknown> = {}) => asCaller(db, () => invokeReceipt(extra));

describe("legacy receipt currency regression (synthetic PostgreSQL)", () => {
  it("reproduces the old enum failure without leaving a partial receivable update", async () => {
    await db.exec(original);
    await db.exec("savepoint old_failure");
    await expect(confirm()).rejects.toThrow(/currency.*currency_code|currency_code.*text/i);
    await db.exec("rollback to savepoint old_failure; reset role");
    expect((await db.query("select paid_amount_xof::int paid from receivables")).rows[0]).toEqual({ paid: 0 });
  });
  it.each([undefined, "", "XOF"])("records XOF consistently for currency %s", async (currency) => {
    const result = (await confirm({ currency, actor_id: ids.otherActor })).rows[0].result;
    expect(result.success).toBe(true);
    expect((await db.query("select currency, amount::int amount, exchange_rate_to_xof::int rate from payments")).rows)
      .toEqual([{ currency: "XOF", amount: 10000, rate: 1 }]);
    expect((await db.query("select amount_xof::int amount from ledger_entries")).rows).toEqual([{ amount: 10000 }]);
    expect((await db.query("select paid_amount_xof::int paid from receivables")).rows[0]).toEqual({ paid: 10000 });
    expect((await db.query("select actor_id from audit_logs where action='receipt_scan_confirm'")).rows[0]).toEqual({ actor_id: ids.actor });
    expect((await db.query("select uploaded_by from attachments")).rows[0]).toEqual({ uploaded_by: ids.actor });
    expect((await confirm()).rows[0].result.requiresOverride).toBe(true);
    expect((await db.query("select count(*)::int count from payments")).rows[0]).toEqual({ count: 1 });
  });
  it.each(["CNY", "USD", "EUR", "INVALID"])("rejects unsupported currency %s before any writes", async (currency) => {
    await db.exec("savepoint rejection");
    await expect(confirm({ currency })).rejects.toThrow(/receiptCurrencyMustBeXof|invalid input value for enum/);
    await db.exec("rollback to savepoint rejection; reset role");
    expect((await db.query("select count(*)::int count from payments")).rows[0]).toEqual({ count: 0 });
    expect((await db.query("select paid_amount_xof::int paid from receivables")).rows[0]).toEqual({ paid: 0 });
  });
  it("keeps invoker privileges and denies anonymous execute", async () => {
    expect((await db.query(`select prosecdef, has_function_privilege('anon',oid,'execute') anon
      from pg_proc where oid='public.confirm_receipt_payment(jsonb)'::regprocedure`)).rows[0])
      .toEqual({ prosecdef: false, anon: false });
  });
  it("rejects a missing authenticated identity", async () => {
    await expect(asCaller(db, () => invokeReceipt({}), { actor: null }))
      .rejects.toThrow(/financeWritePermissionDenied/);
  });
  it("denies a non-finance role", async () => {
    await db.query("update user_profiles set role='viewer' where id=$1", [ids.actor]);
    await expect(confirm()).rejects.toThrow(/financeWritePermissionDenied/);
    expect((await db.query("select count(*)::int count from payments")).rows[0]).toEqual({ count: 0 });
  });
  it("rolls back payment, receivable, ledger and attachment if audit insertion fails", async () => {
    await db.exec(`create function public.synthetic_receipt_audit_failure() returns trigger language plpgsql as $$
      begin raise exception 'syntheticAuditFailure'; end; $$;
      create trigger synthetic_receipt_audit_failure before insert on audit_logs
      for each row execute function public.synthetic_receipt_audit_failure();`);
    await expect(confirm()).rejects.toThrow(/syntheticAuditFailure/);
    for (const table of ["payments", "ledger_entries", "attachments", "audit_logs"]) {
      expect((await db.query(`select count(*)::int count from ${table}`)).rows[0]).toEqual({ count: 0 });
    }
    expect((await db.query("select paid_amount_xof::int paid from receivables")).rows[0]).toEqual({ paid: 0 });
  });
});
