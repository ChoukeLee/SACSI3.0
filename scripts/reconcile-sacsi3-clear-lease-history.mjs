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
const units = await checked(supabase.from("units").select("id, unit_no, status, notes").eq("building_id", building.id).in("unit_no", ["B103", "B301", "B404"]), "load units");
const unitByNo = Object.fromEntries(units.map((unit) => [unit.unit_no, unit]));
if (Object.keys(unitByNo).length !== 3) throw new Error("Missing target unit");

async function customerId(name, notes) {
  const rows = await checked(supabase.from("customers").select("id").eq("name", name), `find customer ${name}`);
  if (rows.length > 1) throw new Error(`Duplicate customer ${name}`);
  return rows[0]?.id ?? (await checked(supabase.from("customers").insert({ name, notes, is_blacklisted: false }).select("id").single(), `insert customer ${name}`)).id;
}

async function upsertLease(spec) {
  const unit = unitByNo[spec.unitNo];
  const rows = await checked(supabase.from("lease_contracts").select("id").eq("unit_id", unit.id).eq("contract_no", spec.contractNo), `find ${spec.contractNo}`);
  if (rows.length > 1) throw new Error(`Duplicate lease ${spec.contractNo}`);
  const payload = {
    unit_id: unit.id,
    customer_id: spec.customerId,
    contract_no: spec.contractNo,
    start_date: spec.startDate,
    expected_end_date: spec.endDate,
    actual_end_date: spec.endDate,
    payment_cycle: spec.paymentCycle,
    payment_day: spec.paymentDay,
    monthly_rent_xof: spec.monthlyRent,
    deposit_amount_xof: spec.deposit,
    deposit_received: spec.deposit > 0,
    rent_free_days: 0,
    signer_name: spec.signer,
    attachment_url: null,
    status: "terminated",
    expected_end_confirmed: spec.endConfirmed,
    paid_through_date: spec.paidThrough,
  };
  return rows.length
    ? (await checked(supabase.from("lease_contracts").update(payload).eq("id", rows[0].id).select("id").single(), `update ${spec.contractNo}`)).id
    : (await checked(supabase.from("lease_contracts").insert(payload).select("id").single(), `insert ${spec.contractNo}`)).id;
}

async function upsertPayment({ unitNo, customerId: payerId, sourceId, date, amount, sourceType, receiptNo, direction, category, notes }) {
  const unit = unitByNo[unitNo];
  const rows = await checked(supabase.from("payments").select("id").eq("receipt_no", receiptNo), `find ${receiptNo}`);
  if (rows.length > 1) throw new Error(`Duplicate payment ${receiptNo}`);
  const payload = { customer_id: payerId, unit_id: unit.id, source_type: sourceType, source_id: sourceId, payment_date: date, amount, currency: "XOF", exchange_rate_to_xof: 1, receipt_no: receiptNo, notes };
  const paymentId = rows.length
    ? (await checked(supabase.from("payments").update(payload).eq("id", rows[0].id).select("id").single(), `update ${receiptNo}`)).id
    : (await checked(supabase.from("payments").insert(payload).select("id").single(), `insert ${receiptNo}`)).id;
  const ledgers = await checked(supabase.from("ledger_entries").select("id").eq("payment_id", paymentId), `find ledger ${receiptNo}`);
  const ledger = { building_id: building.id, unit_id: unit.id, payment_id: paymentId, entry_date: date, direction, category, amount_xof: amount, amount_cny: null, description: notes };
  if (ledgers.length) await checked(supabase.from("ledger_entries").update(ledger).eq("id", ledgers[0].id), `update ledger ${receiptNo}`);
  else await checked(supabase.from("ledger_entries").insert(ledger), `insert ledger ${receiptNo}`);
}

async function upsertReceivable({ unitNo, payerId, sourceId, category, title, dueDate, amount, notes }) {
  const unit = unitByNo[unitNo];
  const rows = await checked(supabase.from("receivables").select("id").eq("source_id", sourceId).eq("category", category).neq("status", "cancelled"), `find receivable ${unitNo} ${category}`);
  if (rows.length > 1) throw new Error(`Duplicate receivable ${unitNo} ${category}`);
  const payload = { building_id: building.id, unit_id: unit.id, customer_id: payerId, source_type: "lease_contract", source_id: sourceId, category, title, due_date: dueDate, amount_xof: amount, paid_amount_xof: amount, status: "paid", currency: "XOF", notes };
  if (rows.length) await checked(supabase.from("receivables").update(payload).eq("id", rows[0].id), `update receivable ${unitNo} ${category}`);
  else await checked(supabase.from("receivables").insert(payload), `insert receivable ${unitNo} ${category}`);
}

const zhaoId = await customerId("赵津", "来源：3号公寓.xlsx；3# B103历史租户。");
const zhaoNotes = "来源：3号公寓.xlsx；B103赵津历史租约；2021-05-11收租金270万FCFA，覆盖2021-04-16至2021-07-15；按三个月反推月租90万；Excel未记押金。后续华为租赁缺少金额和完整日期，本次不补录。";
const b103LeaseId = await upsertLease({ unitNo: "B103", customerId: zhaoId, contractNo: "WB-LEASE-SACSI3-B103-20210416-ZHAOJIN", startDate: "2021-04-16", endDate: "2021-07-15", paymentCycle: "quarterly", paymentDay: 16, monthlyRent: 900_000, deposit: 0, signer: "赵津", endConfirmed: true, paidThrough: "2021-07-15" });
await upsertPayment({ unitNo: "B103", customerId: zhaoId, sourceId: b103LeaseId, date: "2021-05-11", amount: 2_700_000, sourceType: "lease_rent", receiptNo: "WB3-LEASE-B103-20210511-RENT-01", direction: "income", category: "lease_rent", notes: zhaoNotes });
await upsertReceivable({ unitNo: "B103", payerId: zhaoId, sourceId: b103LeaseId, category: "lease_rent", title: "3# B103赵津历史租金", dueDate: "2021-05-11", amount: 2_700_000, notes: zhaoNotes });

const ningId = await customerId("中轻／宁椿欢", "来源：3号公寓.xlsx；3# B301、B401、B404历史联合租户。");
const joint2021 = "SACSI3-LEASE-JOINT-B301-B401-B404-20211130";
const joint2022 = "SACSI3-LEASE-JOINT-B301-B404-20220704-05";
const b301Notes = `来源：3号公寓.xlsx；B301宁椿欢历史租约；月租120万FCFA；2021-07-03押2租6合计960万，拆为押金240万和租金720万；租期起点按“六个月止2022-01-14”反推为2021-07-15；2021-11-30三房联合收2160万，B301分摊720万，批次${joint2021}；2022-07-05收720万，原表注明与B404合计转高峰账人民币151200元，批次${joint2022}；已缴至2022-11-30。华为2022-12-15入住但历史收款不清，本次不补录。`;
const b301LeaseId = await upsertLease({ unitNo: "B301", customerId: ningId, contractNo: "WB-LEASE-SACSI3-B301-20210715-NINGCHUNHUAN", startDate: "2021-07-15", endDate: "2022-11-30", paymentCycle: "semiannual", paymentDay: 15, monthlyRent: 1_200_000, deposit: 2_400_000, signer: "宁椿欢", endConfirmed: false, paidThrough: "2022-11-30" });
for (const payment of [
  ["2021-07-03", 2_400_000, "lease_deposit", "DEPOSIT-01", "liability_in", "lease_deposit"],
  ["2021-07-03", 7_200_000, "lease_rent", "RENT-01", "income", "lease_rent"],
  ["2021-11-30", 7_200_000, "lease_rent", "RENT-02", "income", "lease_rent"],
  ["2022-07-05", 7_200_000, "lease_rent", "RENT-03", "income", "lease_rent"],
]) await upsertPayment({ unitNo: "B301", customerId: ningId, sourceId: b301LeaseId, date: payment[0], amount: payment[1], sourceType: payment[2], receiptNo: `WB3-LEASE-B301-${payment[0].replaceAll("-", "")}-${payment[3]}`, direction: payment[4], category: payment[5], notes: b301Notes });
await upsertReceivable({ unitNo: "B301", payerId: ningId, sourceId: b301LeaseId, category: "lease_rent", title: "3# B301宁椿欢已知历史租金", dueDate: "2022-07-05", amount: 21_600_000, notes: b301Notes });
await upsertReceivable({ unitNo: "B301", payerId: ningId, sourceId: b301LeaseId, category: "lease_deposit", title: "3# B301宁椿欢历史押金", dueDate: "2021-07-03", amount: 2_400_000, notes: `${b301Notes} 押金后续处置待确认。` });

const b404Notes = `来源：3号公寓.xlsx；B404宁椿欢历史租约；月租120万FCFA；2021-05-28收押金240万；2021-06-01与B401同收首期六个月租金但Excel无金额，本次不补造；2021-11-30三房联合收2160万，B404分摊720万，批次${joint2021}；2022-07-04收720万，与B301的2022-07-05记录共同对应人民币151200元转高峰账，批次${joint2022}；已缴至2022-11-30。华为2022-12-15入住但历史收款不清，本次不补录；押金后续处置待确认。`;
const b404LeaseId = await upsertLease({ unitNo: "B404", customerId: ningId, contractNo: "WB-LEASE-SACSI3-B404-20210601-NINGCHUNHUAN", startDate: "2021-06-01", endDate: "2022-11-30", paymentCycle: "semiannual", paymentDay: 1, monthlyRent: 1_200_000, deposit: 2_400_000, signer: "宁椿欢", endConfirmed: false, paidThrough: "2022-11-30" });
for (const payment of [
  ["2021-05-28", 2_400_000, "lease_deposit", "DEPOSIT-01", "liability_in", "lease_deposit"],
  ["2021-11-30", 7_200_000, "lease_rent", "RENT-01", "income", "lease_rent"],
  ["2022-07-04", 7_200_000, "lease_rent", "RENT-02", "income", "lease_rent"],
]) await upsertPayment({ unitNo: "B404", customerId: ningId, sourceId: b404LeaseId, date: payment[0], amount: payment[1], sourceType: payment[2], receiptNo: `WB3-LEASE-B404-${payment[0].replaceAll("-", "")}-${payment[3]}`, direction: payment[4], category: payment[5], notes: b404Notes });
await upsertReceivable({ unitNo: "B404", payerId: ningId, sourceId: b404LeaseId, category: "lease_rent", title: "3# B404宁椿欢已知历史租金", dueDate: "2022-07-04", amount: 14_400_000, notes: b404Notes });
await upsertReceivable({ unitNo: "B404", payerId: ningId, sourceId: b404LeaseId, category: "lease_deposit", title: "3# B404宁椿欢历史押金", dueDate: "2021-05-28", amount: 2_400_000, notes: b404Notes });

const historyUnitNotes = {
  B103: zhaoNotes,
  B301: b301Notes,
  B404: b404Notes,
};
for (const unitNo of Object.keys(historyUnitNotes)) {
  const unit = unitByNo[unitNo];
  const marker = historyUnitNotes[unitNo];
  const notes = (unit.notes ?? "").includes(marker) ? unit.notes : `${unit.notes ?? ""}\n历史：${marker}`.trim();
  await checked(supabase.from("units").update({ notes }).eq("id", unit.id), `update ${unitNo} notes`);
}

const targetLeaseIds = [b103LeaseId, b301LeaseId, b404LeaseId];
const verifiedLeases = await checked(supabase.from("lease_contracts").select("id, status").in("id", targetLeaseIds), "verify leases");
const verifiedPayments = await checked(supabase.from("payments").select("source_id, source_type, amount").in("source_id", targetLeaseIds), "verify payments");
const total = (sourceId, type) => verifiedPayments.filter((row) => row.source_id === sourceId && row.source_type === type).reduce((sum, row) => sum + Number(row.amount), 0);
if (verifiedLeases.length !== 3 || verifiedLeases.some((lease) => lease.status !== "terminated")) throw new Error("Unexpected historical lease status");
if (total(b103LeaseId, "lease_rent") !== 2_700_000 || total(b301LeaseId, "lease_rent") !== 21_600_000 || total(b301LeaseId, "lease_deposit") !== 2_400_000 || total(b404LeaseId, "lease_rent") !== 14_400_000 || total(b404LeaseId, "lease_deposit") !== 2_400_000) throw new Error("Unexpected historical payment totals");

await checked(supabase.from("audit_logs").insert({
  action: "reconcile_sacsi3_clear_lease_history",
  entity_type: "building",
  entity_id: building.id,
  metadata: {
    units: {
      B103: { tenant: "赵津", rent_xof: 2_700_000, paid_through: "2021-07-15" },
      B301: { tenant: "中轻／宁椿欢", rent_xof: 21_600_000, deposit_xof: 2_400_000, paid_through: "2022-11-30", deposit_disposition_pending: true },
      B404: { tenant: "中轻／宁椿欢", known_rent_xof: 14_400_000, first_rent_amount_missing: true, deposit_xof: 2_400_000, paid_through: "2022-11-30", deposit_disposition_pending: true },
    },
    joint_receipts: [
      { batch: joint2021, date: "2021-11-30", original_total_xof: 21_600_000, units: ["B301", "B401", "B404"], allocation_xof_each: 7_200_000 },
      { batch: joint2022, dates: ["2022-07-04", "2022-07-05"], original_total_cny: 151_200, units: ["B301", "B404"], recorded_xof_each: 7_200_000 },
    ],
    skipped_for_missing_finance: ["B102华为", "B301华为", "B404华为"],
  },
}), "write audit log");

console.log(JSON.stringify({ ok: true, B103: { rent_xof: 2_700_000 }, B301: { rent_xof: 21_600_000, deposit_xof: 2_400_000 }, B404: { known_rent_xof: 14_400_000, deposit_xof: 2_400_000 } }));
