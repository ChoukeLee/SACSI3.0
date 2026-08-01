import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = Object.fromEntries(fs.readFileSync(".env.local", "utf8").split(/\r?\n/).filter((line) => line && !line.startsWith("#")).map((line) => {
  const i = line.indexOf("=");
  return [line.slice(0, i), line.slice(i + 1)];
}));
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
async function checked(query, label) {
  const { data, error } = await query;
  if (error) throw new Error(`${label}: ${error.message}`);
  return data;
}

const building = await checked(supabase.from("buildings").select("id").eq("code", "SACSI4").single(), "load building");
const unit = await checked(supabase.from("units").select("id, notes").eq("building_id", building.id).eq("unit_no", "503").single(), "load 503");
const lease = await checked(supabase.from("lease_contracts").select("id, customer_id, signer_name, status, actual_end_date, deposit_amount_xof").eq("unit_id", unit.id).eq("contract_no", "WB-LEASE-SACSI4-503-20220615").single(), "load CHAUHAN lease");
if (lease.signer_name !== "CHAUHAN" || lease.status !== "terminated" || lease.actual_end_date !== "2023-03-14" || Number(lease.deposit_amount_xof) !== 1_000_000) throw new Error("Unexpected 503 CHAUHAN lease");

const receiptNo = "WB4-LEASE-503-20230314-DEPREF-06";
const notes = "503 CHAUHAN押金100万已退还；用户确认已退，实际退款日期未记载，以租约结束日2023-03-14作为账务日期。";
let paymentRows = await checked(supabase.from("payments").select("id").eq("source_id", lease.id).eq("receipt_no", receiptNo), "find CHAUHAN refund");
if (paymentRows.length > 1) throw new Error("Duplicate CHAUHAN refund payments");
const paymentPayload = { customer_id: lease.customer_id, unit_id: unit.id, source_type: "lease_deposit_refund", source_id: lease.id, payment_date: "2023-03-14", amount: 1_000_000, currency: "XOF", exchange_rate_to_xof: 1, receipt_no: receiptNo, notes };
let paymentId;
if (paymentRows.length === 1) {
  paymentId = paymentRows[0].id;
  await checked(supabase.from("payments").update(paymentPayload).eq("id", paymentId), "update CHAUHAN refund");
} else {
  paymentId = (await checked(supabase.from("payments").insert(paymentPayload).select("id").single(), "insert CHAUHAN refund")).id;
}

const ledgerRows = await checked(supabase.from("ledger_entries").select("id").eq("payment_id", paymentId), "find CHAUHAN refund ledger");
if (ledgerRows.length > 1) throw new Error("Duplicate CHAUHAN refund ledgers");
const ledgerPayload = { building_id: building.id, unit_id: unit.id, payment_id: paymentId, entry_date: "2023-03-14", direction: "liability_out", category: "lease_deposit_refund", amount_xof: 1_000_000, amount_cny: null, description: notes };
if (ledgerRows.length === 1) await checked(supabase.from("ledger_entries").update(ledgerPayload).eq("id", ledgerRows[0].id), "update CHAUHAN refund ledger");
else await checked(supabase.from("ledger_entries").insert(ledgerPayload), "insert CHAUHAN refund ledger");

const marker = "全盘复核：503 CHAUHAN押金100万已退还，实际退款日期未记载，以2023-03-14作为账务日期。";
const unitNotes = (unit.notes ?? "").includes(marker) ? unit.notes : `${unit.notes ?? ""}\n${marker}`.trim();
await checked(supabase.from("units").update({ notes: unitNotes }).eq("id", unit.id), "update 503 notes");

const payments = await checked(supabase.from("payments").select("source_type, amount").eq("source_id", lease.id), "verify CHAUHAN deposit settlement");
const received = payments.filter((payment) => payment.source_type === "lease_deposit").reduce((sum, payment) => sum + Number(payment.amount), 0);
const refunded = payments.filter((payment) => payment.source_type === "lease_deposit_refund").reduce((sum, payment) => sum + Number(payment.amount), 0);
const deducted = payments.filter((payment) => payment.source_type === "lease_deposit_deduction").reduce((sum, payment) => sum + Number(payment.amount), 0);
if (received !== 1_000_000 || refunded !== 1_000_000 || deducted !== 0 || received - refunded - deducted !== 0) throw new Error("Unexpected CHAUHAN deposit balance");

await checked(supabase.from("audit_logs").insert({ action: "reconcile_full_audit_batch", entity_type: "lease_contract", entity_id: lease.id, metadata: { building_code: "SACSI4", batch: 6, unit_no: "503", tenant: "CHAUHAN", deposit_received_xof: received, deposit_refunded_xof: refunded, deposit_balance_xof: 0, refund_confirmed_by_user: true, actual_refund_date_known: false, accounting_date: "2023-03-14" } }), "write audit log");
console.log(JSON.stringify({ ok: true, unit: "503", tenant: "CHAUHAN", deposit_received_xof: received, deposit_refunded_xof: refunded, deposit_balance_xof: 0, accounting_date: "2023-03-14", actual_refund_date_known: false }));
