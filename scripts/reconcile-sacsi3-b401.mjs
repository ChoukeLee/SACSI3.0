import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = Object.fromEntries(fs.readFileSync(".env.local", "utf8").split(/\r?\n/).filter((line) => line && !line.startsWith("#")).map((line) => { const i = line.indexOf("="); return [line.slice(0, i), line.slice(i + 1)]; }));
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
async function checked(query, label) { const { data, error } = await query; if (error) throw new Error(`${label}: ${error.message}`); return data; }

const building = await checked(supabase.from("buildings").select("id").eq("code", "SACSI3").single(), "load building");
const unit = await checked(supabase.from("units").select("id, area_sqm").eq("building_id", building.id).eq("unit_no", "B401").single(), "load B401");
if (Number(unit.area_sqm) !== 173.51) throw new Error(`Unexpected B401 area: ${unit.area_sqm}`);
const current = await checked(supabase.from("lease_contracts").select("id, customer_id, start_date, expected_end_date, monthly_rent_xof").eq("unit_id", unit.id).eq("status", "active").single(), "load current B401 lease");
if (current.start_date !== "2026-07-16" || current.expected_end_date !== "2026-10-15" || Number(current.monthly_rent_xof) !== 1_900_000) throw new Error("Unexpected current B401 lease");
const currentCustomer = await checked(supabase.from("customers").select("id, name").eq("id", current.customer_id).single(), "load Wang Xian");
if (currentCustomer.name !== "\u738b\u8d24") throw new Error(`Unexpected current tenant: ${currentCustomer.name}`);

const currentNotes = "\u6765\u6e90\uff1a3\u53f7\u516c\u5bd3.xlsx\uff1bB401\u5f53\u524d\u79df\u6237\u738b\u8d24\uff1b\u79df\u671f2026-07-16\u81f32026-10-15\uff1b\u6708\u79df190\u4e07FCFA\uff1b\u79df3\u4e2a\u6708\u5171570\u4e07FCFA\uff1b\u62bc2\u4e2a\u6708\u5171380\u4e07FCFA\uff0c\u539f\u5e01\u4eba\u6c11\u5e0144840\u5143\uff0c\u9690\u542b\u6c47\u7387\u7ea684.7458 FCFA/\u4eba\u6c11\u5e01\u3002";
await checked(supabase.from("lease_contracts").update({ payment_cycle: "quarterly", payment_day: 16, deposit_amount_xof: 3_800_000, deposit_received: true, paid_through_date: "2026-10-15", expected_end_confirmed: true }).eq("id", current.id), "update current B401 lease");
const currentRent = await checked(supabase.from("payments").select("id").eq("unit_id", unit.id).eq("receipt_no", "S3-LEASE-B401-RENT").single(), "load current B401 rent");
await checked(supabase.from("payments").update({ source_type: "lease_rent", source_id: current.id, payment_date: "2026-07-06", amount: 5_700_000, currency: "XOF", exchange_rate_to_xof: 1, notes: currentNotes }).eq("id", currentRent.id), "update current rent");
await checked(supabase.from("ledger_entries").update({ entry_date: "2026-07-06", direction: "income", category: "lease_rent", amount_xof: 5_700_000, amount_cny: null, description: currentNotes }).eq("payment_id", currentRent.id), "update current rent ledger");

const depositReceipt = "WB3-LEASE-B401-20260706-DEPOSIT-01";
let depositRows = await checked(supabase.from("payments").select("id").eq("unit_id", unit.id).eq("receipt_no", depositReceipt), "find current deposit");
if (depositRows.length > 1) throw new Error("Duplicate current B401 deposit");
const depositPayload = { customer_id: currentCustomer.id, unit_id: unit.id, source_type: "lease_deposit", source_id: current.id, payment_date: "2026-07-06", amount: 44_840, currency: "CNY", exchange_rate_to_xof: 3_800_000 / 44_840, receipt_no: depositReceipt, notes: currentNotes };
const currentDepositId = depositRows.length ? (await checked(supabase.from("payments").update(depositPayload).eq("id", depositRows[0].id).select("id").single(), "update current deposit")).id : (await checked(supabase.from("payments").insert(depositPayload).select("id").single(), "insert current deposit")).id;
const currentDepositLedgers = await checked(supabase.from("ledger_entries").select("id").eq("payment_id", currentDepositId), "find current deposit ledger");
const currentDepositLedger = { building_id: building.id, unit_id: unit.id, payment_id: currentDepositId, entry_date: "2026-07-06", direction: "liability_in", category: "lease_deposit", amount_xof: 3_800_000, amount_cny: 44_840, description: currentNotes };
if (currentDepositLedgers.length) await checked(supabase.from("ledger_entries").update(currentDepositLedger).eq("id", currentDepositLedgers[0].id), "update current deposit ledger"); else await checked(supabase.from("ledger_entries").insert(currentDepositLedger), "insert current deposit ledger");
let currentDepositRec = await checked(supabase.from("receivables").select("id").eq("source_id", current.id).eq("category", "lease_deposit").neq("status", "cancelled"), "find current deposit receivable");
const currentDepositRecPayload = { building_id: building.id, unit_id: unit.id, customer_id: currentCustomer.id, source_type: "lease_contract", source_id: current.id, category: "lease_deposit", title: "3# B401\u738b\u8d24\u79df\u8d41\u62bc\u91d1", due_date: "2026-07-06", amount_xof: 3_800_000, paid_amount_xof: 3_800_000, status: "paid", currency: "XOF", notes: currentNotes };
if (currentDepositRec.length) await checked(supabase.from("receivables").update(currentDepositRecPayload).eq("id", currentDepositRec[0].id), "update current deposit receivable"); else await checked(supabase.from("receivables").insert(currentDepositRecPayload), "insert current deposit receivable");
await checked(supabase.from("receivables").update({ title: "3# B401\u738b\u8d24\u4e09\u4e2a\u6708\u79df\u91d1", amount_xof: 5_700_000, paid_amount_xof: 5_700_000, status: "paid", notes: currentNotes }).eq("source_id", current.id).eq("category", "lease_rent").neq("status", "cancelled"), "update current rent receivable");

const historicalName = "\u4e2d\u8f7b\uff0f\u5b81\u693f\u6b22";
let historicalCustomers = await checked(supabase.from("customers").select("id").eq("name", historicalName), "find historical tenant");
if (historicalCustomers.length > 1) throw new Error("Duplicate historical B401 tenant");
const historicalCustomerId = historicalCustomers[0]?.id ?? (await checked(supabase.from("customers").insert({ name: historicalName, notes: "\u6765\u6e90\uff1a3\u53f7\u516c\u5bd3.xlsx\uff1b3# B301\u3001B401\u3001B404\u5386\u53f2\u8054\u5408\u79df\u6237\u3002", is_blacklisted: false }).select("id").single(), "insert historical tenant")).id;
const historicalContractNo = "WB-LEASE-SACSI3-B401-20210601-ZHONGQING-NING";
const jointReceiptBatch = "SACSI3-LEASE-JOINT-B301-B401-B404-20211130";
let historicalRows = await checked(supabase.from("lease_contracts").select("id").eq("unit_id", unit.id).eq("contract_no", historicalContractNo), "find historical B401 lease");
const historicalPayload = { unit_id: unit.id, customer_id: historicalCustomerId, contract_no: historicalContractNo, start_date: "2021-06-01", expected_end_date: "2025-05-30", actual_end_date: "2025-07-05", payment_cycle: "semiannual", payment_day: 1, monthly_rent_xof: 1_200_000, deposit_amount_xof: 2_400_000, deposit_received: true, rent_free_days: 0, signer_name: "\u5b81\u693f\u6b22", attachment_url: null, status: "terminated", expected_end_confirmed: true, paid_through_date: "2025-05-30" };
const historicalId = historicalRows.length ? (await checked(supabase.from("lease_contracts").update(historicalPayload).eq("id", historicalRows[0].id).select("id").single(), "update historical lease")).id : (await checked(supabase.from("lease_contracts").insert(historicalPayload).select("id").single(), "insert historical lease")).id;
const historyNotes = "\u6765\u6e90\uff1a3\u53f7\u516c\u5bd3.xlsx\uff1bB401\u4e2d\u8f7b\uff0f\u5b81\u693f\u6b22\u5386\u53f2\u79df\u7ea6\uff1b\u6708\u79df120\u4e07FCFA\uff1b2021-06-01\u9996\u671f\u79df\u91d1\u4e0eB404\u540c\u7b14\u3001\u8986\u76d6\u81f32021-11-30\uff0c\u4f46Excel\u672a\u8bb0\u91d1\u989d\uff0c\u53ea\u4fdd\u7559\u8986\u76d6\u8bf4\u660e\u4e0d\u8865\u9020\u6536\u6b3e\uff1b2021-11-30\u4e09\u623f\u8054\u5408\u65362160\u4e07\uff0cB401\u6309\u6708\u79df\u7b49\u989d\u5206\u644a720\u4e07\u3002";

async function upsertHistoryPayment({ date, amount, type, code, direction, category, note }) {
  const receiptNo = `WB3-LEASE-B401-${date.replaceAll("-", "")}-${code}`;
  let rows = await checked(supabase.from("payments").select("id").eq("receipt_no", receiptNo), `find ${receiptNo}`);
  const payload = { customer_id: historicalCustomerId, unit_id: unit.id, source_type: type, source_id: historicalId, payment_date: date, amount, currency: "XOF", exchange_rate_to_xof: 1, receipt_no: receiptNo, notes: `${historyNotes}\n${note}` };
  const paymentId = rows.length ? (await checked(supabase.from("payments").update(payload).eq("id", rows[0].id).select("id").single(), `update ${receiptNo}`)).id : (await checked(supabase.from("payments").insert(payload).select("id").single(), `insert ${receiptNo}`)).id;
  const ledgers = await checked(supabase.from("ledger_entries").select("id").eq("payment_id", paymentId), `find ledger ${receiptNo}`);
  const ledger = { building_id: building.id, unit_id: unit.id, payment_id: paymentId, entry_date: date, direction, category, amount_xof: amount, amount_cny: null, description: `${historyNotes}\n${note}` };
  if (ledgers.length) await checked(supabase.from("ledger_entries").update(ledger).eq("id", ledgers[0].id), `update ledger ${receiptNo}`); else await checked(supabase.from("ledger_entries").insert(ledger), `insert ledger ${receiptNo}`);
}
await upsertHistoryPayment({ date: "2021-05-28", amount: 2_400_000, type: "lease_deposit", code: "DEPOSIT-01", direction: "liability_in", category: "lease_deposit", note: "\u62bc\u4e8c\u4e2a\u6708\u5171240\u4e07FCFA\u3002" });
for (const [date, amount, code] of [["2021-11-30",7_200_000,"RENT-01"],["2022-07-07",7_200_000,"RENT-02"],["2022-12-13",7_200_000,"RENT-03"],["2023-06-12",7_200_000,"RENT-04"],["2023-12-07",7_200_000,"RENT-05"],["2024-07-02",2_400_000,"RENT-06"],["2024-07-31",2_400_000,"RENT-07"],["2024-10-15",2_400_000,"RENT-08"],["2024-12-23",7_200_000,"RENT-09"]]) {
  const jointNote = date === "2021-11-30" ? `\u8054\u5408\u6536\u6b3e\u6279\u6b21${jointReceiptBatch}\uff1b\u539f\u59cb\u5408\u8ba12160\u4e07FCFA\uff0cB301\u3001B401\u3001B404\u5404\u5206\u644a720\u4e07FCFA\u3002` : "";
  await upsertHistoryPayment({ date, amount, type: "lease_rent", code, direction: "income", category: "lease_rent", note: `B401\u5386\u53f2\u79df\u91d1${amount / 10_000}\u4e07FCFA\u3002${jointNote}` });
}
await upsertHistoryPayment({ date: "2025-07-05", amount: 1_997_000, type: "lease_deposit_refund", code: "DEPREF-01", direction: "liability_out", category: "lease_deposit_refund", note: "\u5b9e\u9000\u62bc\u91d1199.7\u4e07FCFA\u3002" });

await checked(supabase.from("units").update({ status: "leased", notes: `${currentNotes}\n\u5386\u53f2\uff1a${historyNotes}\n2025-07-05\u5b9e\u9000\u62bc\u91d1199.7\u4e07\uff1bExcel\u540c\u65f6\u5199\u201c240-40.7=199.7\u201d\uff0c\u5b58\u57284\u4e07\u7b97\u672f\u5dee\u5f02\uff0c\u6263\u6b3e\u6682\u4e0d\u5165\u8d26\uff0c\u5f85\u786e\u8ba4\u4e3a40.7\u4e07\u621640.3\u4e07\u3002` }).eq("id", unit.id), "finalize B401 unit");
const historyPayments = await checked(supabase.from("payments").select("source_type, amount").eq("source_id", historicalId), "verify historical payments");
if (historyPayments.filter((row) => row.source_type === "lease_rent").reduce((s, row) => s + Number(row.amount), 0) !== 50_400_000 || historyPayments.filter((row) => row.source_type === "lease_deposit").reduce((s, row) => s + Number(row.amount), 0) !== 2_400_000 || historyPayments.filter((row) => row.source_type === "lease_deposit_refund").reduce((s, row) => s + Number(row.amount), 0) !== 1_997_000 || historyPayments.some((row) => row.source_type === "lease_deposit_deduction")) throw new Error("Unexpected historical B401 totals");
await checked(supabase.from("audit_logs").insert({ action: "reconcile_sacsi3_b401_current_and_history", entity_type: "unit", entity_id: unit.id, metadata: { current: { tenant: currentCustomer.name, lease_start: "2026-07-16", lease_end: "2026-10-15", rent_xof: 5_700_000, deposit_cny: 44_840, deposit_xof: 3_800_000, paid_through: "2026-10-15" }, historical: { tenant: historicalName, start: "2021-06-01", paid_through: "2025-05-30", actual_end: "2025-07-05", monthly_rent_xof: 1_200_000, known_rent_received_xof: 50_400_000, first_period_amount_missing: true, joint_receipt: { batch: jointReceiptBatch, date: "2021-11-30", total_xof: 21_600_000, units: ["B301", "B401", "B404"], allocated_xof: 7_200_000 }, deposit_xof: 2_400_000, deposit_refund_xof: 1_997_000, workbook_stated_deduction_xof: 407_000, arithmetic_implied_deduction_xof: 403_000, deposit_deduction_pending: true } } }), "write B401 audit log");
console.log(JSON.stringify({ ok: true, unit: "B401", current: { tenant: currentCustomer.name, deposit_cny: 44_840, deposit_xof: 3_800_000, paid_through: "2026-10-15" }, historical: { tenant: historicalName, known_rent_xof: 50_400_000, deposit_refund_xof: 1_997_000, deposit_deduction_pending: true } }));
