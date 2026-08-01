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
const anchorUnits = await checked(supabase.from("units").select("id, unit_no").eq("building_id", building.id).in("unit_no", ["101", "112"]), "load Wang Jun units");
if (anchorUnits.length !== 2) throw new Error(`Expected 101 and 112, got ${anchorUnits.length}`);
const anchorSales = await checked(supabase.from("sale_contracts").select("customer_id").in("unit_id", anchorUnits.map((unit) => unit.id)), "load Wang Jun sales");
if (anchorSales.length !== 2 || anchorSales[0].customer_id !== anchorSales[1].customer_id) throw new Error("101 and 112 must share one buyer");
const customerId = anchorSales[0].customer_id;
const customer = await checked(supabase.from("customers").select("name").eq("id", customerId).single(), "load Wang Jun");
if (customer.name !== "王军") throw new Error(`Unexpected rooftop buyer: ${customer.name}`);

const unitPayload = {
  building_id: building.id,
  code: "SACSI4-ROOFTOP",
  unit_no: "顶楼",
  floor_label: "RF",
  kind: "office",
  status: "sold",
  layout: "顶楼附属资产",
  furnishing: null,
  notes: "来源：4号公寓.xlsx；独立顶楼附属资产；买方王军，与101、112复用同一客户身份，但合同及财务独立统计；总价3000万于2020-11-17一次付清；无租赁、注册金、税款或车位记录。",
};
let unitRows = await checked(supabase.from("units").select("id").eq("building_id", building.id).eq("unit_no", "顶楼"), "find rooftop unit");
if (unitRows.length === 0) unitRows = await checked(supabase.from("units").select("id").eq("code", "SACSI4-ROOFTOP"), "find rooftop by code");
if (unitRows.length > 1) throw new Error("Duplicate rooftop units");
let unitId;
if (unitRows.length === 1) {
  unitId = unitRows[0].id;
  await checked(supabase.from("units").update(unitPayload).eq("id", unitId), "update rooftop unit");
} else {
  unitId = (await checked(supabase.from("units").insert(unitPayload).select("id").single(), "insert rooftop unit")).id;
}

const flagRows = await checked(supabase.from("unit_business_flags").select("unit_id").eq("unit_id", unitId).eq("business_type", "sale"), "find rooftop sale flag");
if (flagRows.length > 1) throw new Error("Duplicate rooftop sale flags");
const flagPayload = { unit_id: unitId, business_type: "sale", is_enabled: true, default_price_xof: 30_000_000 };
if (flagRows.length === 1) await checked(supabase.from("unit_business_flags").update(flagPayload).eq("unit_id", unitId).eq("business_type", "sale"), "update rooftop sale flag");
else await checked(supabase.from("unit_business_flags").insert(flagPayload), "insert rooftop sale flag");

const contractNo = "WB-SALE-SACSI4-ROOFTOP-20201117";
let saleRows = await checked(supabase.from("sale_contracts").select("id").eq("contract_no", contractNo), "find rooftop sale");
if (saleRows.length === 0) saleRows = await checked(supabase.from("sale_contracts").select("id").eq("unit_id", unitId), "find rooftop sale by unit");
if (saleRows.length > 1) throw new Error("Duplicate rooftop sales");
const salePayload = {
  unit_id: unitId,
  customer_id: customerId,
  contract_no: contractNo,
  signed_date: "2020-11-17",
  transfer_status: "not_started",
  agency_commission_amount_xof: null,
  agency_commission_paid: false,
  payment_plan_type: "来源：4号公寓.xlsx；顶楼总价3000万，2020-11-17一次付清；与王军101、112财务独立统计。",
  total_amount_xof: 30_000_000,
  status: "active",
};
let saleId;
if (saleRows.length === 1) {
  saleId = saleRows[0].id;
  await checked(supabase.from("sale_contracts").update(salePayload).eq("id", saleId), "update rooftop sale");
} else {
  saleId = (await checked(supabase.from("sale_contracts").insert(salePayload).select("id").single(), "insert rooftop sale")).id;
}

const receiptNo = "WB4-SALE-ROOFTOP-20201117-HOUSE-01";
const paymentNotes = "4#顶楼王军购置款3000万，2020-11-17一次付清；与101、112财务独立统计。";
const paymentRows = await checked(supabase.from("payments").select("id").eq("source_id", saleId).eq("receipt_no", receiptNo), "find rooftop payment");
if (paymentRows.length > 1) throw new Error("Duplicate rooftop payments");
const paymentPayload = { customer_id: customerId, unit_id: unitId, source_type: "sale_contract", source_id: saleId, payment_date: "2020-11-17", amount: 30_000_000, currency: "XOF", exchange_rate_to_xof: 1, receipt_no: receiptNo, notes: paymentNotes };
let paymentId;
if (paymentRows.length === 1) {
  paymentId = paymentRows[0].id;
  await checked(supabase.from("payments").update(paymentPayload).eq("id", paymentId), "update rooftop payment");
} else {
  paymentId = (await checked(supabase.from("payments").insert(paymentPayload).select("id").single(), "insert rooftop payment")).id;
}

const ledgerRows = await checked(supabase.from("ledger_entries").select("id").eq("payment_id", paymentId), "find rooftop ledger");
if (ledgerRows.length > 1) throw new Error("Duplicate rooftop ledgers");
const ledgerPayload = { building_id: building.id, unit_id: unitId, payment_id: paymentId, entry_date: "2020-11-17", direction: "income", category: "sale_contract", amount_xof: 30_000_000, amount_cny: null, description: paymentNotes };
if (ledgerRows.length === 1) await checked(supabase.from("ledger_entries").update(ledgerPayload).eq("id", ledgerRows[0].id), "update rooftop ledger");
else await checked(supabase.from("ledger_entries").insert(ledgerPayload), "insert rooftop ledger");

const receivableRows = await checked(supabase.from("receivables").select("id").eq("source_id", saleId).eq("category", "sale_lump_sum"), "find rooftop receivable");
if (receivableRows.length > 1) throw new Error("Duplicate rooftop receivables");
const receivablePayload = { building_id: building.id, unit_id: unitId, customer_id: customerId, source_type: "sale_contract", source_id: saleId, category: "sale_lump_sum", title: "4# 顶楼购置款", due_date: "2020-11-17", amount_xof: 30_000_000, paid_amount_xof: 30_000_000, status: "paid", currency: "XOF", notes: `${paymentNotes}\n收据号：${receiptNo}` };
if (receivableRows.length === 1) await checked(supabase.from("receivables").update(receivablePayload).eq("id", receivableRows[0].id), "update rooftop receivable");
else await checked(supabase.from("receivables").insert(receivablePayload), "insert rooftop receivable");

await checked(supabase.from("audit_logs").insert({ action: "reconcile_auxiliary_asset", entity_type: "unit", entity_id: unitId, metadata: { building_code: "SACSI4", unit_no: "顶楼", asset_kind: "office", buyer: "王军", shared_customer_with_units: ["101", "112"], sale_paid_xof: 30_000_000, sale_payment_count: 1, lease_count: 0 } }), "write rooftop audit");
console.log(JSON.stringify({ ok: true, unit: "顶楼", kind: "office", buyer: "王军", sale_paid_xof: 30_000_000, receivables: 1 }));
