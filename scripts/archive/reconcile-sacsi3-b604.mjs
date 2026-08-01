import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = Object.fromEntries(fs.readFileSync(".env.local", "utf8").split(/\r?\n/).filter((line) => line && !line.startsWith("#")).map((line) => {
  const index = line.indexOf("=");
  return [line.slice(0, index), line.slice(index + 1)];
}));
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
async function checked(query, label) {
  const { data, error } = await query;
  if (error) throw new Error(`${label}: ${error.message}`);
  return data;
}

const building = await checked(supabase.from("buildings").select("id").eq("code", "SACSI3").single(), "load building");
const unit = await checked(supabase.from("units").select("id, area_sqm").eq("building_id", building.id).eq("unit_no", "B604").single(), "load B604");
if (Number(unit.area_sqm) !== 173.51) throw new Error(`Unexpected B604 area: ${unit.area_sqm}`);
let customers = await checked(supabase.from("customers").select("id").eq("name", "华为"), "find Huawei");
if (customers.length > 1) throw new Error("Duplicate Huawei customers");
const customerNotes = "来源：3号公寓.xlsx；3#多间房历史/当前租户，具体合同按房间分别登记。";
const customerId = customers[0]?.id ?? (await checked(supabase.from("customers").insert({ name: "华为", notes: customerNotes, is_blacklisted: false }).select("id").single(), "insert Huawei")).id;

const contractNo = "WB-LEASE-SACSI3-B604-20210205-HUAWEI";
const leaseNotes = "来源：3号公寓.xlsx；B604记‘华为租2.5、2.5-5.4、100万/月’；经用户确认按相邻记录推算为2021-02-05至2021-05-04，月租100万FCFA，三个月租金300万；年份、起止日和总租金均为基于原表的合理推算；Excel未记押金、中介费或后续租约；合同按已终止登记，不推定当前仍在租。";
let leases = await checked(supabase.from("lease_contracts").select("id").eq("unit_id", unit.id).eq("contract_no", contractNo), "find B604 lease");
if (leases.length > 1) throw new Error("Duplicate B604 lease");
const leasePayload = { unit_id: unit.id, customer_id: customerId, contract_no: contractNo, start_date: "2021-02-05", expected_end_date: "2021-05-04", actual_end_date: "2021-05-04", payment_cycle: "quarterly", payment_day: 5, monthly_rent_xof: 1_000_000, deposit_amount_xof: 0, deposit_received: false, rent_free_days: 0, signer_name: "华为", attachment_url: null, status: "terminated", expected_end_confirmed: false, paid_through_date: "2021-05-04" };
const leaseId = leases.length
  ? (await checked(supabase.from("lease_contracts").update(leasePayload).eq("id", leases[0].id).select("id").single(), "update B604 lease")).id
  : (await checked(supabase.from("lease_contracts").insert(leasePayload).select("id").single(), "insert B604 lease")).id;

const receiptNo = "WB3-LEASE-B604-20210205-RENT-01";
let payments = await checked(supabase.from("payments").select("id").eq("unit_id", unit.id).eq("receipt_no", receiptNo), "find B604 rent");
if (payments.length > 1) throw new Error("Duplicate B604 rent");
const paymentPayload = { customer_id: customerId, unit_id: unit.id, source_type: "lease_rent", source_id: leaseId, payment_date: "2021-02-05", amount: 3_000_000, currency: "XOF", exchange_rate_to_xof: 1, receipt_no: receiptNo, notes: leaseNotes };
const paymentId = payments.length
  ? (await checked(supabase.from("payments").update(paymentPayload).eq("id", payments[0].id).select("id").single(), "update B604 rent")).id
  : (await checked(supabase.from("payments").insert(paymentPayload).select("id").single(), "insert B604 rent")).id;
const ledgers = await checked(supabase.from("ledger_entries").select("id").eq("payment_id", paymentId), "find B604 rent ledger");
if (ledgers.length > 1) throw new Error("Duplicate B604 rent ledger");
const ledger = { building_id: building.id, unit_id: unit.id, payment_id: paymentId, entry_date: "2021-02-05", direction: "income", category: "lease_rent", amount_xof: 3_000_000, amount_cny: null, description: leaseNotes };
if (ledgers.length) await checked(supabase.from("ledger_entries").update(ledger).eq("id", ledgers[0].id), "update B604 rent ledger");
else await checked(supabase.from("ledger_entries").insert(ledger), "insert B604 rent ledger");

let receivables = await checked(supabase.from("receivables").select("id").eq("source_id", leaseId).eq("category", "lease_rent").neq("status", "cancelled"), "find B604 rent receivable");
if (receivables.length > 1) throw new Error("Duplicate B604 rent receivable");
const receivable = { building_id: building.id, unit_id: unit.id, customer_id: customerId, source_type: "lease_contract", source_id: leaseId, category: "lease_rent", title: "3# B604华为历史租金", due_date: "2021-02-05", amount_xof: 3_000_000, paid_amount_xof: 3_000_000, status: "paid", currency: "XOF", notes: leaseNotes };
if (receivables.length) await checked(supabase.from("receivables").update(receivable).eq("id", receivables[0].id), "update B604 receivable");
else await checked(supabase.from("receivables").insert(receivable), "insert B604 receivable");

await checked(supabase.from("units").update({ status: "locked", notes: leaseNotes }).eq("id", unit.id), "update B604 unit");
const [verifiedLease, verifiedPayments] = await Promise.all([
  checked(supabase.from("lease_contracts").select("status, monthly_rent_xof, deposit_amount_xof, paid_through_date").eq("id", leaseId).single(), "verify B604 lease"),
  checked(supabase.from("payments").select("source_type, amount").eq("source_id", leaseId), "verify B604 payments"),
]);
if (verifiedLease.status !== "terminated" || Number(verifiedLease.monthly_rent_xof) !== 1_000_000 || Number(verifiedLease.deposit_amount_xof) !== 0 || verifiedLease.paid_through_date !== "2021-05-04") throw new Error("Unexpected B604 lease state");
if (verifiedPayments.length !== 1 || verifiedPayments[0].source_type !== "lease_rent" || Number(verifiedPayments[0].amount) !== 3_000_000) throw new Error("Unexpected B604 payment state");
await checked(supabase.from("audit_logs").insert({ action: "reconcile_sacsi3_b604", entity_type: "lease_contract", entity_id: leaseId, metadata: { building_code: "SACSI3", unit_no: "B604", tenant: "华为", inferred_dates: true, inferred_year: 2021, start: "2021-02-05", end: "2021-05-04", monthly_rent_xof: 1_000_000, inferred_rent_xof: 3_000_000, deposit_recorded: false, status: "terminated", current_occupancy_inferred: false, user_confirmed_on: "2026-07-27" } }), "write B604 audit log");

console.log(JSON.stringify({ ok: true, unit: "B604", tenant: "华为", rent_xof: 3_000_000, status: "terminated", dates_inferred: true }));
