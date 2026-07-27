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
const unit = await checked(supabase.from("units").select("id, unit_no, area_sqm").eq("building_id", building.id).eq("unit_no", "B201").single(), "load B201");
if (Number(unit.area_sqm) !== 173.51) throw new Error(`Unexpected B201 area: ${unit.area_sqm}`);

let customers = await checked(supabase.from("customers").select("id").eq("name", "\u6f58\u658c"), "find Pan Bin");
if (customers.length > 1) throw new Error("Duplicate Pan Bin customers");
const customerNotes = "\u6765\u6e90\uff1a3\u53f7\u516c\u5bd3.xlsx\uff1b3# B201\u73b0\u4e1a\u4e3b\uff1bExcel\u4ec5\u8bb0\u201c\u5468\u603b\u5356\u7ed9\u6f58\u658c\u201d\uff1b2026-07-27\u7528\u6237\u786e\u8ba4\u73b0\u4e1a\u4e3b\u4e3a\u6f58\u658c\u3002";
const customerId = customers[0]?.id ?? (await checked(supabase.from("customers").insert({ name: "\u6f58\u658c", notes: customerNotes, is_blacklisted: false }).select("id").single(), "insert Pan Bin")).id;
await checked(supabase.from("customers").update({ notes: customerNotes }).eq("id", customerId), "update Pan Bin");

const contractNo = "WB-SALE-SACSI3-B201-20260101-PANBIN";
const existingSales = await checked(supabase.from("sale_contracts").select("id, contract_no").eq("unit_id", unit.id), "find B201 sale");
if (existingSales.length > 1) throw new Error("Unexpected duplicate B201 sales");
const salePayload = {
  unit_id: unit.id,
  customer_id: customerId,
  contract_no: contractNo,
  signed_date: "2026-01-01",
  transfer_date: null,
  transfer_status: "pending",
  title_certificate_no: null,
  agency_company: null,
  agent_name: null,
  agency_commission_amount_xof: null,
  agency_commission_paid: false,
  payment_plan_type: "full",
  total_amount_xof: 0,
  attachment_url: null,
  status: "active",
};
let saleId;
if (existingSales.length === 1) {
  saleId = existingSales[0].id;
  await checked(supabase.from("sale_contracts").update(salePayload).eq("id", saleId), "update B201 sale");
} else {
  saleId = (await checked(supabase.from("sale_contracts").insert(salePayload).select("id").single(), "insert B201 sale")).id;
}

const notes = "\u6765\u6e90\uff1a3\u53f7\u516c\u5bd3.xlsx\uff1bExcel\u8bb0\u201c\u5468\u603b\u5356\u7ed9\u6f58\u658c\u201d\uff1b2026-07-27\u7528\u6237\u786e\u8ba4\u73b0\u4e1a\u4e3b\u4e3a\u6f58\u658c\uff1b\u539f\u59cb\u7b7e\u7ea6\u65e5\u3001\u603b\u4ef7\u3001\u4ed8\u6b3e\u3001\u7a0e\u8d39\u548c\u8fc7\u6237\u4fe1\u606f\u5747\u5f85\u8865\uff1b2026-01-01\u4e3a\u7cfb\u7edf\u5360\u4f4d\u65e5\uff1b\u4e0d\u751f\u6210\u6b20\u6b3e\u6216\u6536\u6b3e\u3002";
await checked(supabase.from("units").update({ status: "sold", notes }).eq("id", unit.id), "update B201 unit");
await checked(supabase.from("unit_business_flags").update({ is_enabled: true }).eq("unit_id", unit.id).eq("business_type", "sale"), "enable B201 sale flag");

const [payments, receivables, schedules, verifiedSale] = await Promise.all([
  checked(supabase.from("payments").select("id").eq("unit_id", unit.id), "verify B201 payments"),
  checked(supabase.from("receivables").select("id").eq("unit_id", unit.id).neq("status", "cancelled"), "verify B201 receivables"),
  checked(supabase.from("sale_payment_schedule").select("id").eq("sale_contract_id", saleId), "verify B201 schedules"),
  checked(supabase.from("sale_contracts").select("customer_id, total_amount_xof, status").eq("id", saleId).single(), "verify B201 sale"),
]);
if (payments.length || receivables.length || schedules.length || verifiedSale.customer_id !== customerId || Number(verifiedSale.total_amount_xof) !== 0 || verifiedSale.status !== "active") throw new Error("Unexpected verified B201 state");

await checked(supabase.from("audit_logs").insert({
  action: "reconcile_sacsi3_b201_owner",
  entity_type: "sale_contract",
  entity_id: saleId,
  metadata: { building_code: "SACSI3", unit_no: "B201", owner: "\u6f58\u658c", source_text: "\u5468\u603b\u5356\u7ed9\u6f58\u658c", user_confirmed_on: "2026-07-27", placeholder_signed_date: "2026-01-01", total_pending: true, transfer_pending: true, finance_created: false, debt_inferred: false },
}), "write B201 audit log");

console.log(JSON.stringify({ ok: true, unit: "B201", owner: "\u6f58\u658c", sale_id: saleId, total_xof: 0, finance_created: false, pending: ["signed date", "total", "payments", "tax", "transfer"] }));
