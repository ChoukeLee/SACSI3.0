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
const units = await checked(supabase.from("units").select("id, unit_no").eq("building_id", building.id).in("unit_no", ["507", "508"]).order("unit_no"), "load units");
if (units.length !== 2) throw new Error(`Unexpected 507/508 unit count: ${units.length}`);
const unitByNo = Object.fromEntries(units.map((unit) => [unit.unit_no, unit]));
const sales = [];
for (const unit of units) {
  const leases = await checked(supabase.from("lease_contracts").select("id").eq("unit_id", unit.id), `load ${unit.unit_no} leases`);
  if (leases.length !== 0) throw new Error(`Unexpected ${unit.unit_no} lease count: ${leases.length}`);
  const sale = await checked(supabase.from("sale_contracts").select("id, customer_id, total_amount_xof").eq("unit_id", unit.id).single(), `load ${unit.unit_no} sale`);
  if (Number(sale.total_amount_xof) !== 80_000_000) throw new Error(`Unexpected ${unit.unit_no} sale total`);
  sales.push({ ...sale, unit_no: unit.unit_no });
}
if (sales[0].customer_id !== sales[1].customer_id) throw new Error("507/508 buyers do not match");
const saleByUnit = Object.fromEntries(sales.map((sale) => [sale.unit_no, sale]));

async function upsertPayment(unitNo, spec) {
  const sale = saleByUnit[unitNo];
  const unit = unitByNo[unitNo];
  const rows = await checked(supabase.from("payments").select("id").eq("source_id", sale.id).eq("receipt_no", spec.receipt), `find ${spec.receipt}`);
  if (rows.length > 1) throw new Error(`Duplicate payment ${spec.receipt}`);
  const payload = {
    customer_id: sale.customer_id,
    unit_id: unit.id,
    source_type: spec.source_type,
    source_id: sale.id,
    payment_date: spec.date,
    amount: spec.amount,
    currency: "XOF",
    exchange_rate_to_xof: 1,
    receipt_no: spec.receipt,
    notes: spec.notes,
  };
  let paymentId;
  if (rows.length === 1) {
    paymentId = rows[0].id;
    await checked(supabase.from("payments").update(payload).eq("id", paymentId), `update ${spec.receipt}`);
  } else {
    paymentId = (await checked(supabase.from("payments").insert(payload).select("id").single(), `insert ${spec.receipt}`)).id;
  }
  const ledgerPayload = {
    building_id: building.id,
    unit_id: unit.id,
    payment_id: paymentId,
    entry_date: spec.date,
    direction: spec.direction,
    category: spec.ledger_category,
    amount_xof: spec.amount,
    amount_cny: null,
    description: spec.notes,
  };
  const ledgers = await checked(supabase.from("ledger_entries").select("id").eq("payment_id", paymentId), `find ledger ${spec.receipt}`);
  if (ledgers.length > 1) throw new Error(`Duplicate ledger ${spec.receipt}`);
  if (ledgers.length === 1) await checked(supabase.from("ledger_entries").update(ledgerPayload).eq("id", ledgers[0].id), `update ledger ${spec.receipt}`);
  else await checked(supabase.from("ledger_entries").insert(ledgerPayload), `insert ledger ${spec.receipt}`);
  return paymentId;
}

const specs = {
  "507": {
    registration: {
      source_type: "sale_registration_fee",
      date: "2021-12-20",
      amount: 125_000,
      receipt: "WB4-SALE-507-20211220-REGISTRATION-01",
      notes: "507/508\u540c\u4e00\u4e70\u65b9\u6253\u5305\u8d2d\u4e70\uff0c\u6ce8\u518c\u91d125\u4e07\u5e73\u5747\u5206\u644a\uff0c507\u8ba112.5\u4e07\u3002",
      direction: "income",
      ledger_category: "sale_registration_fee",
    },
    refund: {
      source_type: "sale_other_expense",
      date: "2022-08-10",
      amount: 250_000,
      receipt: "WB4-SALE-507-20220810-FURNREF-03",
      notes: "507/508\u540c\u4e00\u4e70\u65b9\u6253\u5305\u8d2d\u4e70\uff0c\u8863\u67dc\u9000\u6b3e50\u4e07\u5e73\u5747\u5206\u644a\uff0c507\u8ba125\u4e07\u3002",
      direction: "expense",
      ledger_category: "sale_furniture_refund",
    },
  },
  "508": {
    registration: {
      source_type: "sale_registration_fee",
      date: "2021-12-20",
      amount: 125_000,
      receipt: "WB4-SALE-508-20211220-REGISTRATION-01",
      notes: "507/508\u540c\u4e00\u4e70\u65b9\u6253\u5305\u8d2d\u4e70\uff0c\u6ce8\u518c\u91d125\u4e07\u5e73\u5747\u5206\u644a\uff0c508\u8ba112.5\u4e07\u3002",
      direction: "income",
      ledger_category: "sale_registration_fee",
    },
    refund: {
      source_type: "sale_other_expense",
      date: "2022-08-10",
      amount: 250_000,
      receipt: "WB4-SALE-508-20220810-FURNREF-02",
      notes: "507/508\u540c\u4e00\u4e70\u65b9\u6253\u5305\u8d2d\u4e70\uff0c\u8863\u67dc\u9000\u6b3e50\u4e07\u5e73\u5747\u5206\u644a\uff0c508\u8ba125\u4e07\u3002",
      direction: "expense",
      ledger_category: "sale_furniture_refund",
    },
  },
};

for (const unitNo of ["507", "508"]) {
  const registrationId = await upsertPayment(unitNo, specs[unitNo].registration);
  await upsertPayment(unitNo, specs[unitNo].refund);
  const sale = saleByUnit[unitNo];
  const unit = unitByNo[unitNo];
  const rows = await checked(supabase.from("receivables").select("id").eq("source_id", sale.id).eq("category", "other").eq("due_date", "2021-12-20").eq("amount_xof", 125_000), `find ${unitNo} registration receivable`);
  if (rows.length > 1) throw new Error(`Duplicate ${unitNo} registration receivable`);
  const receivablePayload = {
    building_id: building.id,
    unit_id: unit.id,
    customer_id: sale.customer_id,
    source_type: "sale_contract",
    source_id: sale.id,
    category: "other",
    title: `${unitNo}\u6ce8\u518c\u91d1`,
    due_date: "2021-12-20",
    amount_xof: 125_000,
    paid_amount_xof: 125_000,
    status: "paid",
    currency: "XOF",
    notes: `${specs[unitNo].registration.notes}\n\u6536\u636e\u53f7\uff1a${specs[unitNo].registration.receipt}`,
  };
  if (rows.length === 1) await checked(supabase.from("receivables").update(receivablePayload).eq("id", rows[0].id), `update ${unitNo} registration receivable`);
  else await checked(supabase.from("receivables").insert(receivablePayload), `insert ${unitNo} registration receivable`);

  const housePayment = await checked(supabase.from("payments").select("id, amount").eq("source_id", sale.id).eq("source_type", "sale_contract").single(), `load ${unitNo} house payment`);
  if (Number(housePayment.amount) !== 80_000_000) throw new Error(`Unexpected ${unitNo} house payment`);
  const paymentIds = [housePayment.id, registrationId];
  const incomeReceivables = await checked(supabase.from("receivables").select("amount_xof").eq("source_id", sale.id).neq("status", "cancelled"), `verify ${unitNo} receivables`);
  if (incomeReceivables.length !== paymentIds.length || incomeReceivables.reduce((sum, row) => sum + Number(row.amount_xof), 0) !== 80_125_000) throw new Error(`Unexpected ${unitNo} receivables`);

  await checked(supabase.from("sale_contracts").update({ payment_plan_type: "507/508\u540c\u4e00\u4e70\u65b9\u6253\u5305\u4ed8\u6b3e1.6\u4ebf\uff0c\u623f\u6b3e\u3001\u6ce8\u518c\u91d1\u53ca\u8863\u67dc\u9000\u6b3e\u5747\u6309\u4e24\u95f4\u5e73\u5747\u5206\u644a\u3002" }).eq("id", sale.id), `update ${unitNo} sale notes`);
  await checked(supabase.from("units").update({ notes: `\u6765\u6e90\uff1a4\u53f7\u516c\u5bd3.xlsx\uff1b507/508\u540c\u4e00\u4e70\u65b9DIALLO BOUBACAR\u6253\u5305\u8d2d\u4e70\uff0c\u603b\u623f\u6b3e1.6\u4ebf\u4e8e2022-07-29\u5df2\u7ed3\u6e05\uff0c${unitNo}\u5e73\u5747\u5206\u644a8000\u4e07\uff1b\u6ce8\u518c\u91d125\u4e07\u4e0e\u8863\u67dc\u9000\u6b3e50\u4e07\u5747\u6309\u4e24\u95f4\u5e73\u5747\u5206\u644a\uff1b\u65e0\u79df\u8d41\u6216\u4ee3\u79df\u8bb0\u5f55\u3002` }).eq("id", unit.id), `update ${unitNo} unit notes`);
  await checked(supabase.from("audit_logs").insert({ action: "rereview_unit_data", entity_type: "unit", entity_id: unit.id, metadata: { building_code: "SACSI4", unit_no: unitNo, grouped_units: ["507", "508"], buyer: "DIALLO BOUBACAR", sale_allocated_xof: 80_000_000, registration_allocated_xof: 125_000, furniture_refund_allocated_xof: 250_000, lease_count: 0 } }), `write ${unitNo} audit`);
}

const allPayments = await checked(supabase.from("payments").select("source_type, amount").in("source_id", sales.map((sale) => sale.id)), "verify grouped payments");
const groupedTotals = {
  house: allPayments.filter((payment) => payment.source_type === "sale_contract").reduce((sum, payment) => sum + Number(payment.amount), 0),
  registration: allPayments.filter((payment) => payment.source_type === "sale_registration_fee").reduce((sum, payment) => sum + Number(payment.amount), 0),
  furniture_refund: allPayments.filter((payment) => payment.source_type === "sale_other_expense").reduce((sum, payment) => sum + Number(payment.amount), 0),
};
if (groupedTotals.house !== 160_000_000 || groupedTotals.registration !== 250_000 || groupedTotals.furniture_refund !== 500_000) throw new Error("Unexpected 507/508 grouped totals");

console.log(JSON.stringify({ ok: true, units: ["507", "508"], buyer: "DIALLO BOUBACAR", per_unit_house_xof: 80_000_000, per_unit_registration_xof: 125_000, per_unit_furniture_refund_xof: 250_000, grouped_totals: groupedTotals }));
