import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asCaller, createPaymentDatabase, ids, recordPayment, seedPaymentDatabase, verifyPayment } from "./helpers/operator-payment-database";
import { verifyOperatorPaymentEvidence } from "@/features/business-actions/operator-payment-verification";
import { auditBusinessSummary } from "@/features/settings/audit-business-summary";
import type { AuditLogRow } from "@/features/settings/audit-log-enrichment";

let db: PGlite;
beforeAll(async () => {
  db = await createPaymentDatabase();
  await db.exec(`create function public.test_fail_audit() returns trigger language plpgsql as $$
    begin if current_setting('test.fail_audit',true)='on' then raise exception 'syntheticAuditFailure'; end if; return new; end; $$;
    create trigger test_fail_audit before insert on public.audit_logs for each row execute function public.test_fail_audit();`);
  await db.exec(`create function public.test_corrupt_ledger() returns trigger language plpgsql as $$
    begin if current_setting('test.corrupt_ledger',true)='on' then new.amount_xof:=1; end if; return new; end; $$;
    create trigger test_corrupt_ledger before insert on public.ledger_entries for each row execute function public.test_corrupt_ledger();`);
}, 30000);
afterAll(async () => { await db?.close(); });
beforeEach(async () => {
  await db.exec(`reset role; set test.fail_audit = 'off'; set test.corrupt_ledger = 'off';
    truncate public.ledger_entries, public.payments, public.receivables, public.audit_logs,
      public.daily_bookings, public.units, public.customers, public.buildings,
      private.operator_action_grants, public.user_profiles, auth.users cascade;`);
  await seedPaymentDatabase(db);
});

async function counts() {
  const result = await db.query(`select
    (select count(*)::int from public.payments) payments,
    (select count(*)::int from public.ledger_entries) ledger,
    (select count(*)::int from public.audit_logs) audit,
    (select prepaid_amount_xof from public.daily_bookings where id='${ids.booking}')::int paid`);
  return result.rows[0];
}

describe("actual payment SQL in an isolated in-memory PostgreSQL fixture", () => {
  it("renders real persisted audit fields as business evidence without confusing agent and actor", async () => {
    await asCaller(db, () => recordPayment(db, { actor: { channel: "external_codex", input_source: "natural_language", original_instruction: "登记测试收款", connector_version: "0.1.0", protocol_version: "1.0" } }));
    const log = (await db.query<AuditLogRow>("select * from public.audit_logs where action='supplementary_payment'")).rows[0];
    const summary = auditBusinessSummary(log, "zh");
    expect(summary).toMatchObject({ actorId: ids.actor, actor: "operator@test.invalid", agent: ids.agent,
      summary: "登记日租收款 10,000 XOF", beforePaid: "0 XOF", afterPaid: "10,000 XOF",
      requestId: ids.request, instruction: "登记测试收款", source: "自然语言" });
  });
  it("keeps the public writer invoker-only and the actor-selectable evaluator owner-only", async () => {
    const functions = (await db.query<{ name: string; definer: boolean; anon: boolean; authenticated: boolean; config: string[] }>(`select
      p.proname name,p.prosecdef definer,p.proconfig config,
      has_function_privilege('anon',p.oid,'execute') anon,
      has_function_privilege('authenticated',p.oid,'execute') authenticated
      from pg_proc p where p.oid in ('public.daily_record_payment_rpc(uuid,numeric,date,text,uuid,jsonb)'::regprocedure,
      'private.operator_daily_payment_integrity(uuid,uuid,uuid)'::regprocedure,
      'private.operator_record_daily_payment(uuid,numeric,date,text,uuid,jsonb)'::regprocedure)`)).rows;
    expect(functions).toHaveLength(3);
    for (const fn of functions) {
      expect(fn.anon).toBe(false);
      expect(fn.config).toContain('search_path=""');
      expect(fn.authenticated).toBe(fn.name !== "operator_daily_payment_integrity");
      expect(fn.definer).toBe(fn.name === "operator_record_daily_payment");
    }
    await expect(asCaller(db, () => db.query("select private.operator_daily_payment_integrity($1,$2,$3)", [ids.booking, ids.request, ids.otherActor])))
      .rejects.toThrow(/permission denied/i);
    expect((await asCaller(db, () => db.query("select public.operator_daily_payment_protocol_version() version"))).rows[0]).toEqual({ version: 2 });
  });
  it("atomically records payment, ledger, receivable and authenticated audit", async () => {
    await asCaller(db, () => recordPayment(db, { actor: { actor_id: ids.otherActor, channel: "external_codex", original_instruction: "Test evidence" } }));
    expect(await counts()).toEqual({ payments: 1, ledger: 1, audit: 1, paid: 10000 });
    const evidence = await asCaller(db, () => verifyPayment(db));
    expect(evidence).toMatchObject({ evidenceVersion: 2, verified: true,
      checks: { payment: true, bookingFinance: true, receivables: true, ledger: true, audit: true } });
    expect(verifyOperatorPaymentEvidence(evidence, { bookingId: ids.booking, requestId: ids.request,
      actorId: ids.actor, amountXof: 10000, paymentDate: "2026-09-15", receiptNo: "TEST-RECEIPT" }).verified).toBe(true);
    const audit = (await db.query<{ actor_id: string; metadata: Record<string, unknown> }>("select actor_id,metadata from public.audit_logs")).rows[0];
    expect(audit.actor_id).toBe(ids.actor);
    expect(audit.metadata.booking_agent_id).toBe(ids.agent);
    expect(audit.metadata.original_instruction).toBe("Test evidence");
  });
  it("replays the same request without a second payment or overwritten original evidence", async () => {
    await asCaller(db, () => recordPayment(db));
    await asCaller(db, () => recordPayment(db, { receipt: "  TEST-RECEIPT  ", actor: { original_instruction: "A retry", connector_version: "0.2.0" } }));
    expect(await counts()).toEqual({ payments: 1, ledger: 1, audit: 1, paid: 10000 });
    const audit = (await db.query<{ metadata: Record<string, unknown> }>("select metadata from public.audit_logs")).rows[0];
    expect(audit.metadata.original_instruction).toBe("Synthetic payment test");
  });
  it.each([{ amount: 20000 }, { date: "2026-09-14" }, { receipt: "OTHER" }, { bookingId: ids.secondRequest }])("rejects replay with changed business fields %j", async (change) => {
    await asCaller(db, () => recordPayment(db));
    await expect(asCaller(db, () => recordPayment(db, change))).rejects.toThrow("requestIdConflict");
    expect(await counts()).toEqual({ payments: 1, ledger: 1, audit: 1, paid: 10000 });
  });
  it("rejects another operator's replay and never attributes it to the new actor", async () => {
    await asCaller(db, () => recordPayment(db));
    await expect(asCaller(db, () => recordPayment(db), { actor: ids.otherActor })).rejects.toThrow("requestIdConflict");
    expect((await asCaller(db, () => verifyPayment(db), { actor: ids.otherActor })).verified).toBe(false);
    expect(await counts()).toEqual({ payments: 1, ledger: 1, audit: 1, paid: 10000 });
  });
  it("rejects a globally reused request belonging to another source type", async () => {
    await db.query(`insert into public.payments (source_type,source_id,payment_date,amount,currency,exchange_rate_to_xof,request_id,request_kind)
      values ('lease',null,current_date,10000,'XOF',1,$1,'daily_payment')`, [ids.request]);
    await expect(asCaller(db, () => recordPayment(db))).rejects.toThrow("requestIdConflict");
    expect(await counts()).toEqual({ payments: 1, ledger: 0, audit: 0, paid: 0 });
  });
  it.each([null, 0, -1, 1.5, "NaN", "Infinity", "-Infinity", "1000000000000"])("rejects invalid amount %s without side effects", async (amount) => {
    await expect(asCaller(db, () => recordPayment(db, { amount }))).rejects.toThrow("invalidPaymentAmount");
    expect(await counts()).toEqual({ payments: 0, ledger: 0, audit: 0, paid: 0 });
  });
  it("rejects infinite date, oversize receipt and absent request ID", async () => {
    await expect(asCaller(db, () => recordPayment(db, { date: "infinity" }))).rejects.toThrow("invalidPaymentDate");
    await expect(asCaller(db, () => recordPayment(db, { receipt: "x".repeat(121) }))).rejects.toThrow("invalidReceiptNo");
    await expect(asCaller(db, () => recordPayment(db, { requestId: null }))).rejects.toThrow("requestIdRequired");
    expect(await counts()).toEqual({ payments: 0, ledger: 0, audit: 0, paid: 0 });
  });
  it("rejects missing bookings, cancelled bookings and overpayments", async () => {
    await expect(asCaller(db, () => recordPayment(db, { bookingId: ids.secondRequest }))).rejects.toThrow("bookingNotFound");
    await expect(asCaller(db, () => recordPayment(db, { amount: 30001 }))).rejects.toThrow("paymentExceedsOutstanding");
    await db.exec("update public.daily_bookings set status='cancelled'");
    await expect(asCaller(db, () => recordPayment(db))).rejects.toThrow("bookingNotPayable");
    expect(await counts()).toEqual({ payments: 0, ledger: 0, audit: 0, paid: 0 });
  });
  it("fails closed for anonymous, missing identity and an unknown role", async () => {
    await expect(asCaller(db, () => recordPayment(db), { role: "anon", actor: null })).rejects.toThrow(/permission denied/i);
    await expect(asCaller(db, () => recordPayment(db), { actor: null, email: "admin@sacsi.com" })).rejects.toThrow("dailyWritePermissionDenied");
    await db.exec("update public.user_profiles set role='unknown'");
    await expect(asCaller(db, () => recordPayment(db))).rejects.toThrow("dailyWritePermissionDenied");
    expect(await counts()).toEqual({ payments: 0, ledger: 0, audit: 0, paid: 0 });
  });
  it("respects explicit action grants and revocation without broad table permissions", async () => {
    await db.exec("update public.user_profiles set role='finance'");
    await expect(asCaller(db, () => recordPayment(db))).rejects.toThrow("dailyWritePermissionDenied");
    await db.query(`insert into private.operator_action_grants(user_id,action_name,granted_by,grant_reason)
      values ($1,'record_daily_payment',$2,'Synthetic authorized entry')`, [ids.actor, ids.otherActor]);
    await asCaller(db, () => recordPayment(db));
    await expect(asCaller(db, () => db.query("select * from public.payments"))).rejects.toThrow(/permission denied/i);
    await db.exec("update private.operator_action_grants set revoked_at=now()");
    await expect(asCaller(db, () => recordPayment(db, { requestId: ids.secondRequest }))).rejects.toThrow("dailyWritePermissionDenied");
    expect(await counts()).toEqual({ payments: 1, ledger: 1, audit: 1, paid: 10000 });
  });
  it("preserves existing trusted service-role usage without fabricating a human actor", async () => {
    await asCaller(db, () => recordPayment(db), { role: "service_role", actor: null });
    await asCaller(db, () => recordPayment(db), { role: "service_role", actor: null });
    expect(await counts()).toEqual({ payments: 1, ledger: 1, audit: 1, paid: 10000 });
    expect((await db.query("select actor_id from public.audit_logs")).rows[0]).toEqual({ actor_id: null });
  });
  it.each(["delete from public.receivables", "update public.receivables set customer_id=null", "update public.receivables set unit_id=null"])("stops inconsistent receivables before writing: %s", async (sql) => {
    await db.exec(sql);
    await expect(asCaller(db, () => recordPayment(db))).rejects.toThrow("bookingFinanceInconsistent");
    expect(await counts()).toEqual({ payments: 0, ledger: 0, audit: 0, paid: 0 });
  });
  it("rolls back payment, ledger, receivable and booking when audit insertion fails", async () => {
    await db.exec("set test.fail_audit='on'");
    await expect(asCaller(db, () => recordPayment(db))).rejects.toThrow("syntheticAuditFailure");
    expect(await counts()).toEqual({ payments: 0, ledger: 0, audit: 0, paid: 0 });
    expect((await db.query("select paid_amount_xof::int as paid from public.receivables")).rows[0]).toEqual({ paid: 0 });
    await db.exec("set test.fail_audit='off'");
    await asCaller(db, () => recordPayment(db));
    expect((await asCaller(db, () => verifyPayment(db))).verified).toBe(true);
  });
  it("rolls back before commit if a trigger silently corrupts the ledger", async () => {
    await db.exec("set test.corrupt_ledger='on'");
    await expect(asCaller(db, () => recordPayment(db))).rejects.toThrow("paymentIntegrityCheckFailed");
    expect(await counts()).toEqual({ payments: 0, ledger: 0, audit: 0, paid: 0 });
    expect((await db.query("select paid_amount_xof::int as paid from public.receivables")).rows[0]).toEqual({ paid: 0 });
  });
  it("does not reapply a payment which was subsequently reversed", async () => {
    await asCaller(db, () => recordPayment(db));
    await db.query(`insert into public.payments (source_type,source_id,payment_date,amount,currency,exchange_rate_to_xof,request_id,request_kind,reversal_of_payment_id)
      select source_type,source_id,payment_date,-amount,currency,exchange_rate_to_xof,$1,'daily_payment_reversal',id from public.payments where request_id=$2`, [ids.secondRequest, ids.request]);
    await db.query("select public.daily_sync_booking_finance_tx($1)", [ids.booking]);
    await expect(asCaller(db, () => recordPayment(db))).rejects.toThrow("paymentAlreadyReversed");
    expect((await asCaller(db, () => verifyPayment(db))).verified).toBe(false);
    expect(await counts()).toEqual({ payments: 2, ledger: 1, audit: 1, paid: 0 });
  });
  it("rejects a missing audit on a legacy request without writing another payment", async () => {
    await asCaller(db, () => recordPayment(db));
    await db.exec("delete from public.audit_logs");
    await expect(asCaller(db, () => recordPayment(db))).rejects.toThrow("requestIdConflict");
    expect(await counts()).toEqual({ payments: 1, ledger: 1, audit: 0, paid: 10000 });
  });
  it("accrues an open stay and rolls that change back on overpayment", async () => {
    await db.exec("update public.daily_bookings set checkout_mode='open',check_out=null,total_amount_xof=10000,final_amount_xof=10000");
    await expect(asCaller(db, () => recordPayment(db, { amount: 40000 }))).rejects.toThrow("paymentExceedsOutstanding");
    expect((await db.query("select final_amount_xof::int as final from public.daily_bookings")).rows[0]).toEqual({ final: 10000 });
    await asCaller(db, () => recordPayment(db, { amount: 30000 }));
    expect((await asCaller(db, () => verifyPayment(db))).verified).toBe(true);
    expect(await counts()).toEqual({ payments: 1, ledger: 1, audit: 1, paid: 30000 });
  });
  it("verifies the original historical audit after a later independent payment", async () => {
    await asCaller(db, () => recordPayment(db));
    await asCaller(db, () => recordPayment(db, { amount: 20000, requestId: ids.secondRequest }));
    expect((await asCaller(db, () => verifyPayment(db))).verified).toBe(true);
    expect((await asCaller(db, () => verifyPayment(db, ids.secondRequest))).verified).toBe(true);
    expect(await counts()).toEqual({ payments: 2, ledger: 2, audit: 2, paid: 30000 });
  });
  it.each([
    ["ledger", "update public.ledger_entries set amount_xof=1"],
    ["ledger", "delete from public.ledger_entries"],
    ["receivables", "update public.receivables set paid_amount_xof=1"],
    ["receivables", "update public.receivables set customer_id=null"],
    ["bookingFinance", "update public.daily_bookings set prepaid_amount_xof=1"],
    ["audit", "update public.audit_logs set metadata=jsonb_set(metadata,'{amount}','1')"],
    ["audit", "update public.audit_logs set after_data=jsonb_set(after_data,'{prepaid_amount_xof}','1')"],
    ["audit", "update public.audit_logs set before_data=jsonb_set(before_data,'{prepaid_amount_xof}','\"bad\"')"],
  ])("fails verification for corrupted %s evidence", async (check, sql) => {
    await asCaller(db, () => recordPayment(db));
    await db.exec(sql);
    expect(await asCaller(db, () => verifyPayment(db))).toMatchObject({ verified: false, checks: { [check]: false } });
  });
});
