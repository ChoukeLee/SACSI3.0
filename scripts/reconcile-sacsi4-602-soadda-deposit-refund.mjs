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
const unit = await checked(supabase.from("units").select("id, notes").eq("building_id", building.id).eq("unit_no", "602").single(), "load 602");
const lease = await checked(supabase.from("lease_contracts").select("id, customer_id, signer_name, status, actual_end_date, deposit_amount_xof").eq("unit_id", unit.id).eq("contract_no", "WB-LEASE-SACSI4-602-20221201").single(), "load SOADDA lease");
if (lease.signer_name !== "SOADDA" || lease.status !== "terminated" || lease.actual_end_date !== "2023-08-31" || Number(lease.deposit_amount_xof) !== 1_000_000) throw new Error("Unexpected 602 SOADDA lease");

const receiptNo = "WB4-LEASE-602-20230831-DEPREF-NEW";
const notes = "602 SOADDA新租约押金100万已退还；原201定金100万已有独立退款记录。用户确认两笔均已退，602新押金实际退款日期未记载，以租约结束日2023-08-31作为账务日期。";
let paymentRows = await checked(supabase.from("payments").select("id").eq("source_id", lease.id).eq("receipt_no", receiptNo), "find SOADDA new deposit refund");
if (paymentRows.length > 1) throw new Error("Duplicate SOADDA new deposit refunds");
const paymentPayload = { customer_id: lease.customer_id, unit_id: unit.id, source_type: "lease_deposit_refund", source_id: lease.id, payment_date: "2023-08-31", amount: 1_000_000, currency: "XOF", exchange_rate_to_xof: 1, receipt_no: receiptNo, notes };
let paymentId;
if (paymentRows.length === 1) {
  paymentId = paymentRows[0].id;
  await checked(supabase.from("payments").update(paymentPayload).eq("id", paymentId), "update SOADDA new deposit refund");
} else {
  paymentId = (await checked(supabase.from("payments").insert(paymentPayload).select("id").single(), "insert SOADDA new deposit refund")).id;
}

const ledgerRows = await checked(supabase.from("ledger_entries").select("id").eq("payment_id", paymentId), "find SOADDA new deposit refund ledger");
if (ledgerRows.length > 1) throw new Error("Duplicate SOADDA new deposit refund ledgers");
const ledgerPayload = { building_id: building.id, unit_id: unit.id, payment_id: paymentId, entry_date: "2023-08-31", direction: "liability_out", category: "lease_deposit_refund", amount_xof: 1_000_000, amount_cny: null, description: notes };
if (ledgerRows.length === 1) await checked(supabase.from("ledger_entries").update(ledgerPayload).eq("id", ledgerRows[0].id), "update SOADDA new deposit refund ledger");
else await checked(supabase.from("ledger_entries").insert(ledgerPayload), "insert SOADDA new deposit refund ledger");

const marker = "全盘复核：SOADDA原201定金100万和602新押金100万均已退还；新押金实际退款日期未记载，以2023-08-31作为账务日期。";
const unitNotes = (unit.notes ?? "").includes(marker) ? unit.notes : `${unit.notes ?? ""}\n${marker}`.trim();
await checked(supabase.from("units").update({ notes: unitNotes }).eq("id", unit.id), "update 602 notes");

const payments = await checked(supabase.from("payments").select("source_type, amount, receipt_no").eq("source_id", lease.id), "verify SOADDA deposits");
const received = payments.filter((payment) => payment.source_type === "lease_deposit").reduce((sum, payment) => sum + Number(payment.amount), 0);
const refunded = payments.filter((payment) => payment.source_type === "lease_deposit_refund").reduce((sum, payment) => sum + Number(payment.amount), 0);
const deductions = payments.filter((payment) => payment.source_type === "lease_deposit_deduction").reduce((sum, payment) => sum + Number(payment.amount), 0);
if (received !== 2_000_000 || refunded !== 2_000_000 || deductions !== 0 || received - refunded - deductions !== 0) throw new Error("Unexpected SOADDA deposit balance");
if (!payments.some((payment) => payment.receipt_no === "WB4-LEASE-602-20221213-DEPREF201-02" && Number(payment.amount) === 1_000_000)) throw new Error("Missing original 201 deposit refund");

await checked(supabase.from("audit_logs").insert({ action: "reconcile_full_audit_batch", entity_type: "lease_contract", entity_id: lease.id, metadata: { building_code: "SACSI4", batch: 7, unit_no: "602", tenant: "SOADDA", old_201_deposit_received_xof: 1_000_000, old_201_deposit_refunded_xof: 1_000_000, new_602_deposit_received_xof: 1_000_000, new_602_deposit_refunded_xof: 1_000_000, deposit_balance_xof: 0, both_refunds_confirmed_by_user: true, new_refund_actual_date_known: false, new_refund_accounting_date: "2023-08-31" } }), "write audit log");
console.log(JSON.stringify({ ok: true, unit: "602", tenant: "SOADDA", deposits_received_xof: received, deposits_refunded_xof: refunded, deposit_balance_xof: 0, new_refund_accounting_date: "2023-08-31", new_refund_actual_date_known: false }));
