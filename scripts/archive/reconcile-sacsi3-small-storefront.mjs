import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = Object.fromEntries(fs.readFileSync(".env.local", "utf8").split(/\r?\n/).filter((line) => line && !line.startsWith("#")).map((line) => { const index = line.indexOf("="); return [line.slice(0, index), line.slice(index + 1)]; }));
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
async function checked(query, label) { const { data, error } = await query; if (error) throw new Error(`${label}: ${error.message}`); return data; }

const building = await checked(supabase.from("buildings").select("id").eq("code", "SACSI3").single(), "load building");
const unit = await checked(supabase.from("units").select("id, kind").eq("building_id", building.id).eq("unit_no", "小门面房").single(), "load small storefront");
if (unit.kind !== "storefront") throw new Error(`Unexpected unit kind: ${unit.kind}`);
const tenantName = "意大利人（小门面房，姓名待补）";
let customers = await checked(supabase.from("customers").select("id").eq("name", tenantName), "find small storefront tenant");
if (customers.length > 1) throw new Error("Duplicate small storefront tenant");
const customerId = customers[0]?.id ?? (await checked(supabase.from("customers").insert({ name: tenantName, notes: "来源：3号公寓.xlsx；小门面房当前租户，真实姓名待补。", is_blacklisted: false }).select("id").single(), "insert small storefront tenant")).id;

const contractNo = "WB-LEASE-SACSI3-STOREFRONT-S-20220301-ITALIAN";
const contractNotes = "来源：3号公寓.xlsx；小门面房由同一位意大利租户承租，真实姓名待补；月租70万FCFA；租金记录连续覆盖2022-03-01至2026-05-31，28笔合计3570万；用户确认目前仍在租。Excel未记正式合同结束日，以已缴至日期2026-05-31作为系统占位结束日，不代表合同已到期。四笔押金各500万，合计2000万，均属于同一租户且未见退款记录。";
let leases = await checked(supabase.from("lease_contracts").select("id").eq("unit_id", unit.id).eq("contract_no", contractNo), "find small storefront lease");
if (leases.length > 1) throw new Error("Duplicate small storefront lease");
const leasePayload = { unit_id: unit.id, customer_id: customerId, contract_no: contractNo, start_date: "2022-03-01", expected_end_date: "2026-05-31", actual_end_date: null, payment_cycle: "monthly", payment_day: 1, monthly_rent_xof: 700_000, deposit_amount_xof: 20_000_000, deposit_received: true, rent_free_days: 0, signer_name: tenantName, attachment_url: null, status: "active", expected_end_confirmed: false, paid_through_date: "2026-05-31" };
const leaseId = leases.length ? (await checked(supabase.from("lease_contracts").update(leasePayload).eq("id", leases[0].id).select("id").single(), "update small storefront lease")).id : (await checked(supabase.from("lease_contracts").insert(leasePayload).select("id").single(), "insert small storefront lease")).id;

async function upsertPayment({ sourceType, receiptNo, date, amount, direction, category, notes }) {
  const rows = await checked(supabase.from("payments").select("id").eq("unit_id", unit.id).eq("receipt_no", receiptNo), `find ${receiptNo}`);
  if (rows.length > 1) throw new Error(`Duplicate payment ${receiptNo}`);
  const payload = { customer_id: customerId, unit_id: unit.id, source_type: sourceType, source_id: leaseId, payment_date: date, amount, currency: "XOF", exchange_rate_to_xof: 1, receipt_no: receiptNo, notes };
  const paymentId = rows.length ? (await checked(supabase.from("payments").update(payload).eq("id", rows[0].id).select("id").single(), `update ${receiptNo}`)).id : (await checked(supabase.from("payments").insert(payload).select("id").single(), `insert ${receiptNo}`)).id;
  const ledgers = await checked(supabase.from("ledger_entries").select("id").eq("payment_id", paymentId), `find ledger ${receiptNo}`);
  if (ledgers.length > 1) throw new Error(`Duplicate ledger ${receiptNo}`);
  const ledger = { building_id: building.id, unit_id: unit.id, payment_id: paymentId, entry_date: date, direction, category, amount_xof: amount, amount_cny: null, description: notes };
  if (ledgers.length) await checked(supabase.from("ledger_entries").update(ledger).eq("id", ledgers[0].id), `update ledger ${receiptNo}`); else await checked(supabase.from("ledger_entries").insert(ledger), `insert ledger ${receiptNo}`);
}

const deposits = [["2021-11-11", 5_000_000], ["2022-03-08", 5_000_000], ["2022-09-08", 5_000_000], ["2022-11-02", 5_000_000]];
for (let index = 0; index < deposits.length; index += 1) {
  const [date, amount] = deposits[index];
  await upsertPayment({ sourceType: "lease_deposit", receiptNo: `WB3-LEASE-STOREFRONT-S-${date.replaceAll("-", "")}-DEPOSIT-${String(index + 1).padStart(2, "0")}`, date, amount, direction: "liability_in", category: "lease_deposit", notes: `${contractNotes} 本笔押金500万FCFA。` });
}

const rents = [
  ["2022-03-08", 700_000, "2022-03-31", ""], ["2022-04-15", 700_000, "2022-04-30", ""], ["2022-05-08", 700_000, "2022-05-31", ""], ["2022-11-02", 4_200_000, "2022-11-30", ""],
  ["2023-02-22", 1_400_000, "2023-01-31", ""], ["2023-04-26", 2_100_000, "2023-04-30", ""], ["2023-06-13", 700_000, "2023-05-31", ""], ["2023-07-12", 700_000, "2023-06-30", ""], ["2023-08-05", 700_000, "2023-07-31", ""], ["2023-09-07", 700_000, "2023-08-30", "按Excel原文保留缴至8月30日。"],
  ["2024-04-25", 3_500_000, "2024-02-29", "支票转交税务。"], ["2024-05-08", 1_400_000, "2024-04-30", ""], ["2024-05-16", 700_000, "2023-09-30", "2023年9月租金支票转税务。"], ["2024-06-08", 700_000, "2024-05-31", ""], ["2024-07-04", 700_000, "2024-06-30", ""], ["2024-08-17", 700_000, "2024-07-31", ""], ["2024-09-05", 1_400_000, "2024-09-30", ""], ["2024-10-04", 1_400_000, "2024-11-30", ""], ["2024-11-02", 1_400_000, "2025-01-31", ""],
  ["2025-02-12", 1_400_000, "2025-03-31", "Excel原文写2024-02-12，但其缴至2025-03-31且位于2024-11-02与2025-04-04之间，按时间顺序修正为2025-02-12。"], ["2025-04-04", 1_400_000, "2025-05-31", ""], ["2025-06-11", 1_400_000, "2025-07-31", ""], ["2025-08-05", 1_400_000, "2025-09-30", ""], ["2025-10-22", 1_400_000, "2025-11-30", ""],
  ["2026-02-27", 1_400_000, "2026-01-31", ""], ["2026-04-10", 1_400_000, "2026-03-31", ""], ["2026-05-21", 700_000, "2026-04-30", ""], ["2026-06-30", 700_000, "2026-05-31", ""],
];
for (let index = 0; index < rents.length; index += 1) {
  const [date, amount, paidThrough, detail] = rents[index];
  await upsertPayment({ sourceType: "lease_rent", receiptNo: `WB3-LEASE-STOREFRONT-S-${date.replaceAll("-", "")}-RENT-${String(index + 1).padStart(2, "0")}`, date, amount, direction: "income", category: "lease_rent", notes: `${contractNotes} 本笔租金${amount / 10_000}万FCFA，缴至${paidThrough}。${detail}` });
}

const taxNotes = "来源：3号公寓.xlsx；小门面房租金支票转交税务，租金收入仍按原收款统计，同时将同额税务支出单列，避免把支票去向误当成新增收入或遗漏支出。";
await upsertPayment({ sourceType: "lease_other_expense", receiptNo: "WB3-LEASE-STOREFRONT-S-20240425-TAX-TRANSFER-01", date: "2024-04-25", amount: 3_500_000, direction: "expense", category: "lease_other_expense", notes: taxNotes });
await upsertPayment({ sourceType: "lease_other_expense", receiptNo: "WB3-LEASE-STOREFRONT-S-20240516-TAX-TRANSFER-02", date: "2024-05-16", amount: 700_000, direction: "expense", category: "lease_other_expense", notes: taxNotes });

const existingReceivables = await checked(supabase.from("receivables").select("id, category").eq("source_id", leaseId).neq("status", "cancelled"), "load small storefront receivables");
async function saveReceivable(category, title, dueDate, amount, notes) {
  const rows = existingReceivables.filter((row) => row.category === category); if (rows.length > 1) throw new Error(`Duplicate ${category} receivable`);
  const payload = { building_id: building.id, unit_id: unit.id, customer_id: customerId, source_type: "lease_contract", source_id: leaseId, category, title, due_date: dueDate, amount_xof: amount, paid_amount_xof: amount, status: "paid", currency: "XOF", notes };
  if (rows.length) await checked(supabase.from("receivables").update(payload).eq("id", rows[0].id), `update ${category} receivable`); else await checked(supabase.from("receivables").insert(payload), `insert ${category} receivable`);
}
await saveReceivable("lease_rent", "3#小门面房意大利租户历史租金", "2026-05-31", 35_700_000, contractNotes);
await saveReceivable("lease_deposit", "3#小门面房意大利租户押金", "2022-11-02", 20_000_000, `${contractNotes} 押金均未见退还。`);
const unitNotes = "来源：3号公寓.xlsx；小门面房同一位意大利租户，姓名待补，月租70万，目前仍在租；28笔租金合计3570万，已缴至2026-05-31；四笔押金各500万、合计2000万，均未退；420万租金支票转税务，租金收入与税务支出分别列账；合同结束日未知。";
await checked(supabase.from("units").update({ status: "leased", notes: unitNotes }).eq("id", unit.id), "update small storefront unit");

const verified = await checked(supabase.from("payments").select("source_type, amount").eq("source_id", leaseId), "verify small storefront payments");
const sum = (type) => verified.filter((row) => row.source_type === type).reduce((total, row) => total + Number(row.amount), 0);
if (verified.length !== 34 || sum("lease_rent") !== 35_700_000 || sum("lease_deposit") !== 20_000_000 || sum("lease_other_expense") !== 4_200_000) throw new Error("Unexpected small storefront totals");
await checked(supabase.from("audit_logs").insert({ action: "reconcile_sacsi3_small_storefront", entity_type: "lease_contract", entity_id: leaseId, metadata: { building_code: "SACSI3", unit_no: "小门面房", tenant_name_pending: true, same_tenant_for_all_deposits_confirmed: true, start: "2022-03-01", expected_end_placeholder: "2026-05-31", end_confirmed: false, current_status_confirmed: "active", monthly_rent_xof: 700_000, rent_payment_count: 28, rent_xof: 35_700_000, paid_through: "2026-05-31", deposit_payment_count: 4, deposit_xof: 20_000_000, deposit_refund_recorded: false, tax_transfer: { count: 2, amount_xof: 4_200_000, rent_income_preserved: true, expense_recorded: true }, corrected_payment_date: { source: "2024-02-12", recorded: "2025-02-12", reason: "chronology_and_paid_through_2025_03_31" } } }), "write small storefront audit");
console.log(JSON.stringify({ ok: true, unit: "小门面房", status: "active", rent_xof: 35_700_000, deposit_xof: 20_000_000, tax_expense_xof: 4_200_000, paid_through: "2026-05-31" }));
