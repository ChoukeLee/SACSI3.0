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
const unit512 = await checked(supabase.from("units").select("id").eq("building_id", building.id).eq("unit_no", "512").single(), "load 512");
const songLease = await checked(supabase.from("lease_contracts").select("customer_id, signer_name").eq("unit_id", unit512.id).eq("status", "active").single(), "load Song 512 lease");
if (songLease.signer_name !== "宋昱霖") throw new Error(`Unexpected 512 tenant: ${songLease.signer_name}`);
const customerId = songLease.customer_id;

const unitPayload = {
  building_id: building.id,
  code: "SACSI4-GARAGE-01",
  unit_no: "车库1",
  floor_label: "G",
  kind: "parking",
  status: "available",
  layout: "车库",
  furnishing: null,
  notes: "来源：4号公寓.xlsx；原表未记实际车库编号，按出现顺序建立技术编号‘车库1’。宋昱霖2021-10-04至2024-10-19承租并已腾出；初期100万/月，2022-10起70万/月；押金分140万、60万两笔共200万，明确退140万，剩余60万处置待核实。",
};
let unitRows = await checked(supabase.from("units").select("id").eq("building_id", building.id).eq("unit_no", "车库1"), "find garage01 unit");
if (unitRows.length === 0) unitRows = await checked(supabase.from("units").select("id").eq("code", "SACSI4-GARAGE-01"), "find garage01 by code");
if (unitRows.length > 1) throw new Error("Duplicate garage01 units");
let unitId;
if (unitRows.length === 1) {
  unitId = unitRows[0].id;
  await checked(supabase.from("units").update(unitPayload).eq("id", unitId), "update garage01 unit");
} else {
  unitId = (await checked(supabase.from("units").insert(unitPayload).select("id").single(), "insert garage01 unit")).id;
}

const flagRows = await checked(supabase.from("unit_business_flags").select("unit_id").eq("unit_id", unitId).eq("business_type", "long_lease"), "find garage01 lease flag");
if (flagRows.length > 1) throw new Error("Duplicate garage01 lease flags");
const flagPayload = { unit_id: unitId, business_type: "long_lease", is_enabled: true, default_price_xof: 700_000 };
if (flagRows.length === 1) await checked(supabase.from("unit_business_flags").update(flagPayload).eq("unit_id", unitId).eq("business_type", "long_lease"), "update garage01 lease flag");
else await checked(supabase.from("unit_business_flags").insert(flagPayload), "insert garage01 lease flag");

const contractNo = "WB-LEASE-SACSI4-GARAGE01-20211004";
let leaseRows = await checked(supabase.from("lease_contracts").select("id").eq("contract_no", contractNo), "find garage01 lease");
if (leaseRows.length === 0) leaseRows = await checked(supabase.from("lease_contracts").select("id").eq("unit_id", unitId), "find garage01 lease by unit");
if (leaseRows.length > 1) throw new Error("Duplicate garage01 leases");
const leasePayload = {
  unit_id: unitId,
  customer_id: customerId,
  contract_no: contractNo,
  start_date: "2021-10-04",
  expected_end_date: "2024-10-19",
  actual_end_date: "2024-10-19",
  payment_cycle: "semiannual",
  payment_day: 4,
  monthly_rent_xof: 700_000,
  deposit_amount_xof: 2_000_000,
  deposit_received: true,
  rent_free_days: 0,
  signer_name: "宋昱霖",
  status: "terminated",
  expected_end_confirmed: true,
  paid_through_date: "2024-10-19",
};
let leaseId;
if (leaseRows.length === 1) {
  leaseId = leaseRows[0].id;
  await checked(supabase.from("lease_contracts").update(leasePayload).eq("id", leaseId), "update garage01 lease");
} else {
  leaseId = (await checked(supabase.from("lease_contracts").insert(leasePayload).select("id").single(), "insert garage01 lease")).id;
}

const entries = [
  { date: "2021-08-27", amount: 1_400_000, type: "lease_deposit", code: "DEP-A", direction: "liability_in", ledger: "lease_deposit", title: "车库1押金", notes: "车库1宋昱霖第一笔押金140万；2024-10-19明确退还140万。" },
  { date: "2021-09-22", amount: 600_000, type: "lease_deposit", code: "DEP-B", direction: "liability_in", ledger: "lease_deposit", title: "车库1押金", notes: "车库1宋昱霖第二笔押金60万；Excel未记载退还或扣款，处置待核实。" },
  { date: "2021-09-22", amount: 6_000_000, type: "lease_rent", code: "RENT-01", direction: "income", ledger: "lease_rent", title: "车库1租金", notes: "车库1宋昱霖租金600万，租期2021-10-04至2022-04-04，按100万/月。" },
  { date: "2022-04-25", amount: 6_000_000, type: "lease_rent", code: "RENT-02", direction: "income", ledger: "lease_rent", title: "车库1租金", notes: "车库1宋昱霖租金600万，租期2022-04-05至2022-10-04，按100万/月。" },
  { date: "2022-10-13", amount: 4_200_000, type: "lease_rent", code: "RENT-03", direction: "income", ledger: "lease_rent", title: "车库1租金", notes: "车库1宋昱霖租金420万，租期至2023-04-04，按70万/月。" },
  { date: "2023-04-14", amount: 4_200_000, type: "lease_rent", code: "RENT-04", direction: "income", ledger: "lease_rent", title: "车库1租金", notes: "车库1宋昱霖租金420万，租期至2023-10-04，按70万/月。" },
  { date: "2023-10-09", amount: 4_200_000, type: "lease_rent", code: "RENT-05", direction: "income", ledger: "lease_rent", title: "车库1租金", notes: "车库1宋昱霖租金420万，租期至2024-04-04，按70万/月。" },
  { date: "2024-05-02", amount: 4_200_000, type: "lease_rent", code: "RENT-06", direction: "income", ledger: "lease_rent", title: "车库1租金", notes: "车库1宋昱霖租金420万，租期至2024-10-04，按70万/月。" },
  { date: "2024-10-19", amount: 350_000, type: "lease_rent", code: "RENT-07", direction: "income", ledger: "lease_rent", title: "车库1租金", notes: "车库1宋昱霖末期租金35万，租至2024-10-19并腾出。" },
  { date: "2024-10-19", amount: 1_400_000, type: "lease_deposit_refund", code: "DEPREF", direction: "liability_out", ledger: "lease_deposit_refund", notes: "车库1宋昱霖2024-10-19腾出，明确退押金140万；其余60万处置待核实。", receivable: false },
];

for (const entry of entries) {
  const receiptNo = `WB4-LEASE-GARAGE01-${entry.date.replaceAll("-", "")}-${entry.code}`;
  const paymentRows = await checked(supabase.from("payments").select("id").eq("source_id", leaseId).eq("receipt_no", receiptNo), `find ${receiptNo}`);
  if (paymentRows.length > 1) throw new Error(`Duplicate payment ${receiptNo}`);
  const paymentPayload = { customer_id: customerId, unit_id: unitId, source_type: entry.type, source_id: leaseId, payment_date: entry.date, amount: entry.amount, currency: "XOF", exchange_rate_to_xof: 1, receipt_no: receiptNo, notes: entry.notes };
  let paymentId;
  if (paymentRows.length === 1) {
    paymentId = paymentRows[0].id;
    await checked(supabase.from("payments").update(paymentPayload).eq("id", paymentId), `update ${receiptNo}`);
  } else {
    paymentId = (await checked(supabase.from("payments").insert(paymentPayload).select("id").single(), `insert ${receiptNo}`)).id;
  }
  const ledgerRows = await checked(supabase.from("ledger_entries").select("id").eq("payment_id", paymentId), `find ledger ${receiptNo}`);
  if (ledgerRows.length > 1) throw new Error(`Duplicate ledger ${receiptNo}`);
  const ledgerPayload = { building_id: building.id, unit_id: unitId, payment_id: paymentId, entry_date: entry.date, direction: entry.direction, category: entry.ledger, amount_xof: entry.amount, amount_cny: null, description: entry.notes };
  if (ledgerRows.length === 1) await checked(supabase.from("ledger_entries").update(ledgerPayload).eq("id", ledgerRows[0].id), `update ledger ${receiptNo}`);
  else await checked(supabase.from("ledger_entries").insert(ledgerPayload), `insert ledger ${receiptNo}`);
  if (entry.receivable === false) continue;
  const category = entry.type === "lease_rent" ? "lease_rent" : "lease_deposit";
  const receivableRows = await checked(supabase.from("receivables").select("id").eq("source_id", leaseId).eq("category", category).eq("due_date", entry.date).eq("amount_xof", entry.amount), `find receivable ${receiptNo}`);
  if (receivableRows.length > 1) throw new Error(`Duplicate receivable ${receiptNo}`);
  const receivablePayload = { building_id: building.id, unit_id: unitId, customer_id: customerId, source_type: "lease_contract", source_id: leaseId, category, title: entry.title, due_date: entry.date, amount_xof: entry.amount, paid_amount_xof: entry.amount, status: "paid", currency: "XOF", notes: `${entry.notes}\n收据号：${receiptNo}` };
  if (receivableRows.length === 1) await checked(supabase.from("receivables").update(receivablePayload).eq("id", receivableRows[0].id), `update receivable ${receiptNo}`);
  else await checked(supabase.from("receivables").insert(receivablePayload), `insert receivable ${receiptNo}`);
}

const payments = await checked(supabase.from("payments").select("source_type, amount").eq("source_id", leaseId), "verify garage01 payments");
const receivables = await checked(supabase.from("receivables").select("amount_xof").eq("source_id", leaseId).neq("status", "cancelled"), "verify garage01 receivables");
if (payments.length !== 10 || receivables.length !== 9 || receivables.reduce((sum, row) => sum + Number(row.amount_xof), 0) !== 31_150_000) throw new Error("Unexpected garage01 financial records");
const refund = payments.filter((payment) => payment.source_type === "lease_deposit_refund").reduce((sum, payment) => sum + Number(payment.amount), 0);
if (refund !== 1_400_000) throw new Error("Unexpected garage01 deposit refund");

await checked(supabase.from("customers").update({ notes: "来源：4号公寓.xlsx；4号楼512当前长租租户；车库1历史租户（2021-10-04至2024-10-19）。" }).eq("id", customerId), "update Song notes");
await checked(supabase.from("audit_logs").insert({ action: "reconcile_auxiliary_asset", entity_type: "unit", entity_id: unitId, metadata: { building_code: "SACSI4", unit_no: "车库1", technical_numbering: true, tenant: "宋昱霖", customer_reused_from_unit: "512", lease_start: "2021-10-04", lease_end: "2024-10-19", rent_income_xof: 29_150_000, deposit_received_xof: 2_000_000, deposit_refunded_xof: 1_400_000, deposit_unresolved_xof: 600_000, status: "available" } }), "write garage01 audit");
console.log(JSON.stringify({ ok: true, unit: "车库1", tenant: "宋昱霖", status: "available", rent_income_xof: 29_150_000, deposit_received_xof: 2_000_000, deposit_refunded_xof: 1_400_000, deposit_unresolved_xof: 600_000, receivables: 9 }));
