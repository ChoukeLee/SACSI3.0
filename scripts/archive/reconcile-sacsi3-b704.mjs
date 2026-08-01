import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = Object.fromEntries(fs.readFileSync(".env.local", "utf8").split(/\r?\n/).filter((line) => line && !line.startsWith("#")).map((line) => { const index = line.indexOf("="); return [line.slice(0, index), line.slice(index + 1)]; }));
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
async function checked(query, label) { const { data, error } = await query; if (error) throw new Error(`${label}: ${error.message}`); return data; }

const building = await checked(supabase.from("buildings").select("id").eq("code", "SACSI3").single(), "load building");
const unit = await checked(supabase.from("units").select("id, area_sqm").eq("building_id", building.id).eq("unit_no", "B704").single(), "load B704");
if (Number(unit.area_sqm) !== 173.51) throw new Error(`Unexpected B704 area: ${unit.area_sqm}`);
const customers = await checked(supabase.from("customers").select("id").eq("name", "华为"), "find Huawei");
if (customers.length !== 1) throw new Error("Unexpected Huawei customer count");
const customerId = customers[0].id;
const contractNo = "WB-LEASE-SACSI3-B704-20210205-HUAWEI";
const notes = "来源：3号公寓.xlsx；B704记‘华为租2.5、2.5-5.4、100万/月’，与B604原文相同；按已确认的B604口径推算为2021-02-05至2021-05-04，月租100万FCFA，三个月租金300万；Excel未记押金、中介费或后续租约；合同按已终止登记，不推定当前仍在租。";
let leases = await checked(supabase.from("lease_contracts").select("id").eq("unit_id", unit.id).eq("contract_no", contractNo), "find B704 lease");
if (leases.length > 1) throw new Error("Duplicate B704 lease");
const leasePayload = { unit_id: unit.id, customer_id: customerId, contract_no: contractNo, start_date: "2021-02-05", expected_end_date: "2021-05-04", actual_end_date: "2021-05-04", payment_cycle: "quarterly", payment_day: 5, monthly_rent_xof: 1_000_000, deposit_amount_xof: 0, deposit_received: false, rent_free_days: 0, signer_name: "华为", attachment_url: null, status: "terminated", expected_end_confirmed: false, paid_through_date: "2021-05-04" };
const leaseId = leases.length ? (await checked(supabase.from("lease_contracts").update(leasePayload).eq("id", leases[0].id).select("id").single(), "update B704 lease")).id : (await checked(supabase.from("lease_contracts").insert(leasePayload).select("id").single(), "insert B704 lease")).id;

const receiptNo = "WB3-LEASE-B704-20210205-RENT-01";
let payments = await checked(supabase.from("payments").select("id").eq("unit_id", unit.id).eq("receipt_no", receiptNo), "find B704 rent");
if (payments.length > 1) throw new Error("Duplicate B704 rent");
const paymentPayload = { customer_id: customerId, unit_id: unit.id, source_type: "lease_rent", source_id: leaseId, payment_date: "2021-02-05", amount: 3_000_000, currency: "XOF", exchange_rate_to_xof: 1, receipt_no: receiptNo, notes };
const paymentId = payments.length ? (await checked(supabase.from("payments").update(paymentPayload).eq("id", payments[0].id).select("id").single(), "update B704 rent")).id : (await checked(supabase.from("payments").insert(paymentPayload).select("id").single(), "insert B704 rent")).id;
const ledgers = await checked(supabase.from("ledger_entries").select("id").eq("payment_id", paymentId), "find B704 ledger");
if (ledgers.length > 1) throw new Error("Duplicate B704 ledger");
const ledger = { building_id: building.id, unit_id: unit.id, payment_id: paymentId, entry_date: "2021-02-05", direction: "income", category: "lease_rent", amount_xof: 3_000_000, amount_cny: null, description: notes };
if (ledgers.length) await checked(supabase.from("ledger_entries").update(ledger).eq("id", ledgers[0].id), "update B704 ledger"); else await checked(supabase.from("ledger_entries").insert(ledger), "insert B704 ledger");

let receivables = await checked(supabase.from("receivables").select("id").eq("source_id", leaseId).eq("category", "lease_rent").neq("status", "cancelled"), "find B704 receivable");
if (receivables.length > 1) throw new Error("Duplicate B704 receivable");
const receivable = { building_id: building.id, unit_id: unit.id, customer_id: customerId, source_type: "lease_contract", source_id: leaseId, category: "lease_rent", title: "3# B704华为历史租金", due_date: "2021-02-05", amount_xof: 3_000_000, paid_amount_xof: 3_000_000, status: "paid", currency: "XOF", notes };
if (receivables.length) await checked(supabase.from("receivables").update(receivable).eq("id", receivables[0].id), "update B704 receivable"); else await checked(supabase.from("receivables").insert(receivable), "insert B704 receivable");
await checked(supabase.from("units").update({ status: "locked", notes }).eq("id", unit.id), "update B704 unit");

const verified = await checked(supabase.from("payments").select("source_type, amount").eq("source_id", leaseId), "verify B704 payment");
if (verified.length !== 1 || verified[0].source_type !== "lease_rent" || Number(verified[0].amount) !== 3_000_000) throw new Error("Unexpected B704 payment");
await checked(supabase.from("audit_logs").insert({ action: "reconcile_sacsi3_b704", entity_type: "lease_contract", entity_id: leaseId, metadata: { building_code: "SACSI3", unit_no: "B704", tenant: "华为", copied_inference_rule_from: "B604", start: "2021-02-05", end: "2021-05-04", monthly_rent_xof: 1_000_000, rent_xof: 3_000_000, deposit_recorded: false, status: "terminated", current_occupancy_inferred: false } }), "write B704 audit log");
console.log(JSON.stringify({ ok: true, unit: "B704", tenant: "华为", rent_xof: 3_000_000, status: "terminated" }));
