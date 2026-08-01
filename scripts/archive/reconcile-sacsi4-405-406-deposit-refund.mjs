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
const units = await checked(supabase.from("units").select("id, unit_no, notes").eq("building_id", building.id).in("unit_no", ["405", "406"]), "load 405/406");
if (units.length !== 2) throw new Error(`Expected 405/406 units, got ${units.length}`);

const results = [];
for (const unit of units) {
  const receiptNo = `WB4-LEASE-${unit.unit_no}-20221118-DEPREF-04`;
  const payment = await checked(supabase.from("payments").select("id, source_id, payment_date, source_type").eq("unit_id", unit.id).eq("receipt_no", receiptNo).single(), `load ${receiptNo}`);
  if (payment.source_type !== "lease_deposit_refund" || payment.payment_date !== "2022-11-18") throw new Error(`Unexpected refund ${receiptNo}`);
  const notes = `405/406候玉英联合租约退押金合计87.5万，按两间各50%分摊；${unit.unit_no}退款43.75万。联合押金原收220万，剩余132.5万处置待核实。`;
  await checked(supabase.from("payments").update({ amount: 437_500, notes }).eq("id", payment.id), `update ${receiptNo}`);
  await checked(supabase.from("ledger_entries").update({ amount_xof: 437_500, direction: "liability_out", category: "lease_deposit_refund", description: notes }).eq("payment_id", payment.id), `update ledger ${receiptNo}`);

  const lease = await checked(supabase.from("lease_contracts").select("id").eq("id", payment.source_id).single(), `load lease ${unit.unit_no}`);

  const marker = "405/406联合租约退押金合计87.5万，按两间各43.75万分摊；剩余押金合计132.5万处置待核实。";
  const unitNotes = (unit.notes ?? "").includes("联合租约退押金合计87.5万") ? unit.notes : `${unit.notes ?? ""}\n${marker}`.trim();
  await checked(supabase.from("units").update({ notes: unitNotes }).eq("id", unit.id), `update unit notes ${unit.unit_no}`);
  results.push({ unit_no: unit.unit_no, lease_id: lease.id, receipt_no: receiptNo });
}

const leaseIds = results.map((row) => row.lease_id);
const payments = await checked(supabase.from("payments").select("source_id, source_type, amount, receipt_no").in("source_id", leaseIds), "verify joint lease payments");
const deposits = payments.filter((payment) => payment.source_type === "lease_deposit").reduce((sum, payment) => sum + Number(payment.amount), 0);
const refunds = payments.filter((payment) => payment.source_type === "lease_deposit_refund").reduce((sum, payment) => sum + Number(payment.amount), 0);
const deductions = payments.filter((payment) => payment.source_type === "lease_deposit_deduction").reduce((sum, payment) => sum + Number(payment.amount), 0);
if (deposits !== 2_200_000 || refunds !== 875_000 || deductions !== 0 || deposits - refunds - deductions !== 1_325_000) throw new Error("Unexpected 405/406 deposit settlement");

for (const row of results) {
  const payment = await checked(supabase.from("payments").select("id, amount").eq("receipt_no", row.receipt_no).single(), `verify payment ${row.unit_no}`);
  const ledger = await checked(supabase.from("ledger_entries").select("amount_xof, direction, category").eq("payment_id", payment.id).single(), `verify ledger ${row.unit_no}`);
  if (Number(payment.amount) !== 437_500 || Number(ledger.amount_xof) !== 437_500 || ledger.direction !== "liability_out" || ledger.category !== "lease_deposit_refund") throw new Error(`Refund split failed for ${row.unit_no}`);
}

await checked(supabase.from("audit_logs").insert({
  action: "reconcile_full_audit_batch",
  entity_type: "building",
  entity_id: building.id,
  metadata: {
    building_code: "SACSI4",
    batch: 2,
    units: ["405", "406"],
    joint_deposit_received_xof: deposits,
    excel_refund_total_xof: refunds,
    refund_allocation_xof: { "405": 437_500, "406": 437_500 },
    unresolved_deposit_balance_xof: 1_325_000,
    inferred_deduction_xof: 0,
  },
}), "write audit log");

console.log(JSON.stringify({ ok: true, units: ["405", "406"], deposit_received_xof: deposits, refund_total_xof: refunds, refund_per_unit_xof: 437_500, unresolved_balance_xof: deposits - refunds - deductions }));
