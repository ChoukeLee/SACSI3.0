import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = Object.fromEntries(fs.readFileSync(".env.local", "utf8").split(/\r?\n/).filter((line) => line && !line.startsWith("#")).map((line) => { const index = line.indexOf("="); return [line.slice(0, index), line.slice(index + 1)]; }));
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
async function checked(query, label) { const { data, error } = await query; if (error) throw new Error(`${label}: ${error.message}`); return data; }

const building = await checked(supabase.from("buildings").select("id").eq("code", "SACSI3").single(), "load building");
const unit = await checked(supabase.from("units").select("id, area_sqm").eq("building_id", building.id).eq("unit_no", "B302").single(), "load B302");
if (Number(unit.area_sqm) !== 54.99) throw new Error(`Unexpected B302 area: ${unit.area_sqm}`);
const sale = await checked(supabase.from("sale_contracts").select("id, customer_id, total_amount_xof").eq("unit_id", unit.id).eq("status", "active").single(), "load B302 sale");
if (Number(sale.total_amount_xof) !== 50_000_000) throw new Error(`Unexpected B302 total: ${sale.total_amount_xof}`);
const customer = await checked(supabase.from("customers").select("id, name").eq("id", sale.customer_id).single(), "load B302 buyer");
if (customer.name !== "BAMBA") throw new Error(`Unexpected B302 buyer: ${customer.name}`);
const notes = "\u6765\u6e90\uff1a3\u53f7\u516c\u5bd3.xlsx\uff1bB302\u4e70\u65b9BAMBA\uff1b\u5408\u540c\u603b\u4ef75000\u4e07FCFA\uff1b2021-01-26\u4e00\u6b21\u6027\u4ed85000\u4e07FCFA\uff0c\u5df2\u7ed3\u6e05\uff1bExcel\u672a\u767b\u8bb03%\u7a0e\uff0c\u4e0d\u63a8\u65ad\u7a0e\u6b3e\uff1bFULO\u63d0\u6210\u4e8e2021-04-07\u652f\u4ed8\uff0c\u91d1\u989d\u5f85\u8865\u3002";
await checked(supabase.from("sale_contracts").update({ signed_date: "2021-01-26", payment_plan_type: "lump_sum", agency_company: "FULO", agency_commission_amount_xof: null, agency_commission_paid: true }).eq("id", sale.id), "update B302 sale");
await checked(supabase.from("units").update({ status: "sold", notes }).eq("id", unit.id), "update B302 unit");
const payment = await checked(supabase.from("payments").select("id").eq("unit_id", unit.id).single(), "load B302 payment");
await checked(supabase.from("payments").update({ customer_id: customer.id, source_type: "sale_contract", source_id: sale.id, payment_date: "2021-01-26", amount: 50_000_000, currency: "XOF", exchange_rate_to_xof: 1, receipt_no: "WB3-SALE-B302-20210126-HOUSE-01", notes }).eq("id", payment.id), "update B302 payment");
await checked(supabase.from("ledger_entries").update({ entry_date: "2021-01-26", direction: "income", category: "sale", amount_xof: 50_000_000, amount_cny: null, description: notes }).eq("payment_id", payment.id), "update B302 ledger");
const receivable = await checked(supabase.from("receivables").select("id").eq("source_id", sale.id).neq("status", "cancelled").single(), "load B302 receivable");
await checked(supabase.from("receivables").update({ category: "sale_lump_sum", title: "3# B302\u8d2d\u623f\u6b3e", due_date: "2021-01-26", amount_xof: 50_000_000, paid_amount_xof: 50_000_000, status: "paid", currency: "XOF", notes }).eq("id", receivable.id), "update B302 receivable");
const verified = await checked(supabase.from("payments").select("amount, source_type").eq("source_id", sale.id), "verify B302 payment");
if (verified.length !== 1 || verified[0].source_type !== "sale_contract" || Number(verified[0].amount) !== 50_000_000) throw new Error("Unexpected verified B302 payment");
await checked(supabase.from("audit_logs").insert({ action: "reconcile_sacsi3_b302_sale", entity_type: "sale_contract", entity_id: sale.id, metadata: { building_code: "SACSI3", unit_no: "B302", buyer: customer.name, total_xof: 50_000_000, payment_date: "2021-01-26", settled: true, tax_recorded: false, tax_inferred: false, agency: { company: "FULO", paid_date: "2021-04-07", amount_pending: true } } }), "write B302 audit log");
console.log(JSON.stringify({ ok: true, unit: "B302", buyer: customer.name, total_xof: 50_000_000, settled: true, tax_inferred: false }));
