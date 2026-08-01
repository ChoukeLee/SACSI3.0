import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = Object.fromEntries(
  fs.readFileSync(".env.local", "utf8").split(/\r?\n/).filter((line) => line && !line.startsWith("#")).map((line) => {
    const i = line.indexOf("=");
    return [line.slice(0, i), line.slice(i + 1)];
  }),
);
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
async function checked(query, label) {
  const { data, error } = await query;
  if (error) throw new Error(`${label}: ${error.message}`);
  return data;
}

const building = await checked(supabase.from("buildings").select("id").eq("code", "SACSI4").single(), "load building");
const unitNos = ["401", "402", "403", "404", "405", "406", "407", "408", "409", "410", "411", "412"];
const units = await checked(supabase.from("units").select("id, unit_no").eq("building_id", building.id).in("unit_no", unitNos), "load units");
if (units.length !== unitNos.length) throw new Error(`Expected ${unitNos.length} units, got ${units.length}`);
const unitByNo = Object.fromEntries(units.map((unit) => [unit.unit_no, unit]));

async function upsertCustomer(name, notes) {
  const rows = await checked(supabase.from("customers").select("id").eq("name", name), `find customer ${name}`);
  if (rows.length >= 1) return rows[0].id;
  return (await checked(supabase.from("customers").insert({ name, notes }).select("id").single(), `insert customer ${name}`)).id;
}

async function upsertLease(spec) {
  const contractNo = `WB-LEASE-SACSI4-${spec.unitNo}-${spec.start.replaceAll("-", "")}${spec.suffix ? `-${spec.suffix}` : ""}`;
  let rows = await checked(supabase.from("lease_contracts").select("id, customer_id").eq("contract_no", contractNo), `find ${contractNo}`);
  if (rows.length === 0) rows = await checked(supabase.from("lease_contracts").select("id, customer_id").eq("unit_id", unitByNo[spec.unitNo].id).eq("start_date", spec.start), `find ${spec.unitNo} ${spec.start}`);
  if (rows.length > 1) throw new Error(`Duplicate lease ${contractNo}`);
  const customerId = rows.length === 1
    ? rows[0].customer_id
    : await upsertCustomer(spec.tenant, `\u6765\u6e90\uff1a4\u53f7\u516c\u5bd3.xlsx\uff1b${spec.unitNo}\u79df\u6237\u3002`);
  const payload = {
    unit_id: unitByNo[spec.unitNo].id,
    customer_id: customerId,
    contract_no: contractNo,
    start_date: spec.start,
    expected_end_date: spec.end,
    actual_end_date: spec.active ? null : (spec.actualEnd ?? spec.end),
    payment_cycle: spec.cycle ?? "semiannual",
    payment_day: Number(spec.start.slice(8, 10)),
    monthly_rent_xof: spec.monthlyRent,
    deposit_amount_xof: spec.deposit ?? 0,
    deposit_received: Boolean(spec.deposit),
    rent_free_days: 0,
    signer_name: spec.tenant,
    status: spec.active ? "active" : "terminated",
    expected_end_confirmed: true,
    paid_through_date: spec.paidThrough ?? null,
  };
  let leaseId;
  if (rows.length === 1) {
    leaseId = rows[0].id;
    await checked(supabase.from("lease_contracts").update(payload).eq("id", leaseId), `update ${contractNo}`);
  } else leaseId = (await checked(supabase.from("lease_contracts").insert(payload).select("id").single(), `insert ${contractNo}`)).id;
  return { leaseId, customerId, contractNo };
}

async function upsertEntry(lease, spec, entry, index) {
  const currency = entry.currency ?? "XOF";
  const rate = entry.rate ?? 1;
  const amountXof = entry.amountXof ?? Math.round(entry.amount * rate);
  const receipt = `WB4-LEASE-${spec.unitNo}-${entry.date.replaceAll("-", "")}-${entry.code}-${String(index).padStart(2, "0")}`;
  let rows = await checked(supabase.from("payments").select("id").eq("source_id", lease.leaseId).eq("receipt_no", receipt), `find ${receipt}`);
  if (rows.length === 0 && entry.oldReceipt) rows = await checked(supabase.from("payments").select("id").eq("source_id", lease.leaseId).eq("receipt_no", entry.oldReceipt), `find ${entry.oldReceipt}`);
  if (rows.length > 1) throw new Error(`Duplicate payment ${receipt}`);
  const paymentPayload = {
    customer_id: lease.customerId,
    unit_id: unitByNo[spec.unitNo].id,
    source_type: entry.type,
    source_id: lease.leaseId,
    payment_date: entry.date,
    amount: entry.amount,
    currency,
    exchange_rate_to_xof: rate,
    receipt_no: receipt,
    notes: entry.notes,
  };
  let paymentId;
  if (rows.length === 1) {
    paymentId = rows[0].id;
    await checked(supabase.from("payments").update(paymentPayload).eq("id", paymentId), `update ${receipt}`);
  } else paymentId = (await checked(supabase.from("payments").insert(paymentPayload).select("id").single(), `insert ${receipt}`)).id;
  const ledgerPayload = {
    building_id: building.id,
    unit_id: unitByNo[spec.unitNo].id,
    payment_id: paymentId,
    entry_date: entry.date,
    direction: entry.direction ?? (entry.type === "lease_deposit" ? "liability_in" : "income"),
    category: entry.category ?? entry.type,
    amount_xof: amountXof,
    amount_cny: currency === "CNY" ? entry.amount : null,
    description: entry.notes,
  };
  const ledgers = await checked(supabase.from("ledger_entries").select("id").eq("payment_id", paymentId), `find ledger ${receipt}`);
  if (ledgers.length > 1) throw new Error(`Duplicate ledger ${receipt}`);
  if (ledgers.length === 1) await checked(supabase.from("ledger_entries").update(ledgerPayload).eq("id", ledgers[0].id), `update ledger ${receipt}`);
  else await checked(supabase.from("ledger_entries").insert(ledgerPayload), `insert ledger ${receipt}`);
  if (entry.receivable === false) return;
  const receivablePayload = {
    building_id: building.id,
    unit_id: unitByNo[spec.unitNo].id,
    customer_id: lease.customerId,
    source_type: "lease_contract",
    source_id: lease.leaseId,
    category: entry.type === "lease_rent" ? "lease_rent" : entry.type === "lease_deposit" ? "lease_deposit" : "other",
    title: `${spec.unitNo} ${entry.title}`,
    due_date: entry.date,
    amount_xof: amountXof,
    paid_amount_xof: amountXof,
    status: "paid",
    currency: "XOF",
    notes: entry.notes,
  };
  const recs = await checked(supabase.from("receivables").select("id").eq("source_id", lease.leaseId).eq("notes", entry.notes), `find receivable ${receipt}`);
  if (recs.length > 1) throw new Error(`Duplicate receivable ${receipt}`);
  if (recs.length === 1) await checked(supabase.from("receivables").update(receivablePayload).eq("id", recs[0].id), `update receivable ${receipt}`);
  else await checked(supabase.from("receivables").insert(receivablePayload), `insert receivable ${receipt}`);
}

const rent = (date, amount, notes, extra = {}) => ({ date, amount, type: "lease_rent", code: "RENT", title: "\u79df\u91d1", notes, ...extra });
const prop = (date, amount, notes, extra = {}) => ({ date, amount, type: "property_fee", code: "PROP", title: "\u7269\u4e1a\u8d39", notes, ...extra });
const dep = (date, amount, notes, extra = {}) => ({ date, amount, type: "lease_deposit", code: "DEP", title: "\u62bc\u91d1", notes, direction: "liability_in", ...extra });
const agencyIn = (date, amount, notes) => ({ date, amount, type: "lease_agency_income", code: "AGI", title: "\u4e2d\u4ecb\u8d39\u6536\u5165", notes });
const out = (date, amount, code, notes, type = "lease_other_expense", direction = "expense") => ({ date, amount, type, code, title: "", notes, direction, receivable: false });

const specs = [
  { unitNo: "401", tenant: "\u674e\u4e9a\u6960", start: "2023-05-06", end: "2024-11-05", monthlyRent: 500_000, paidThrough: "2024-11-05", notes: "\u5386\u53f2\u79df\u7ea6\uff1bExcel\u76842024.11.9\u4e0e\u622a\u6b62\u65e5\u51b2\u7a81\uff0c\u6309\u534a\u5e74\u5468\u671f\u63a8\u5b9a\u4e3a2024-05-09\u6536\u6b3e\u3002", entries: [rent("2023-05-08",3_000_000,"401\u674e\u4e9a\u6960\u534a\u5e74\u79df\u91d1300\u4e07\u3002"),prop("2023-05-08",210_000,"401\u674e\u4e9a\u6960\u534a\u5e74\u7269\u4e1a\u8d3921\u4e07\u3002"),rent("2023-11-04",3_000_000,"401\u674e\u4e9a\u6960\u534a\u5e74\u79df\u91d1300\u4e07\u3002"),prop("2023-11-04",210_000,"401\u674e\u4e9a\u6960\u534a\u5e74\u7269\u4e1a\u8d3921\u4e07\u3002"),rent("2024-05-09",3_000_000,"401\u674e\u4e9a\u6960\u534a\u5e74\u79df\u91d1300\u4e07\uff1b\u65e5\u671f\u6309\u5468\u671f\u63a8\u5b9a\u3002"),prop("2024-05-09",210_000,"401\u674e\u4e9a\u6960\u534a\u5e74\u7269\u4e1a\u8d3921\u4e07\uff1b\u65e5\u671f\u6309\u5468\u671f\u63a8\u5b9a\u3002")] },
  { unitNo: "403", tenant: "\u5370\u5ea6\u4eba2", start: "2022-04-01", end: "2022-09-30", deposit: 1_000_000, monthlyRent: 500_000, notes: "\u79df\u6237\u8dd1\u8def\uff0c\u8b66\u5bdf\u5904\u7406\uff1b\u62bc\u91d1\u6309\u6263\u6b3e\u95ed\u73af\u3002", entries: [dep("2022-03-23",1_000_000,"403\u5370\u5ea6\u4eba2\u62bc\u91d1100\u4e07\u3002"),rent("2022-03-23",3_000_000,"403\u5370\u5ea6\u4eba2\u79df\u91d1300\u4e07\u3002"),prop("2022-03-23",210_000,"403\u5370\u5ea6\u4eba2\u7269\u4e1a\u8d3921\u4e07\u3002"),out("2022-09-30",1_000_000,"DEPDED","403\u5370\u5ea6\u4eba2\u8dd1\u8def\uff0c\u62bc\u91d1100\u4e07\u6309\u6263\u6b3e\u5904\u7406\u3002","lease_deposit_deduction","liability_out")] },
  { unitNo: "403", tenant: "\u9759\u9759", start: "2023-10-01", end: "2024-03-31", deposit: 1_000_000, monthlyRent: 500_000, suffix: "JING", notes: "\u5386\u53f2\u79df\u7ea6\uff1b\u623f\u4e1c\u53d6\u79df\u91d1200\u4e07\uff0c\u53f6\u743c\u53d6\u62bc\u91d1100\u4e07\u3002", entries: [dep("2023-09-18",1_000_000,"403\u9759\u9759\u62bc\u91d1100\u4e07\u3002"),rent("2023-09-18",3_000_000,"403\u9759\u9759\u79df\u91d1300\u4e07\u3002"),prop("2023-09-18",210_000,"403\u9759\u9759\u7269\u4e1a\u8d3921\u4e07\u3002"),agencyIn("2023-09-18",500_000,"403\u9759\u9759\u4e2d\u4ecb\u8d39\u6536\u516550\u4e07\u3002"),out("2024-02-21",2_000_000,"OWNER","403\u9759\u9759\u79df\u91d1\u4e2d\u623f\u4e1c\u53d6200\u4e07\u3002"),out("2024-05-30",1_000_000,"DEPREF","403\u9759\u9759\u62bc\u91d1100\u4e07\u7531\u53f6\u743c\u53d6\u56de\u3002","lease_deposit_refund","liability_out")] },
  { unitNo: "403", tenant: "\u848b\u53cb\u5e73\u79df2", start: "2024-04-01", end: "2024-09-30", actualEnd: "2024-08-14", deposit: 1_000_000, monthlyRent: 500_000, suffix: "JIANG", notes: "\u5386\u53f2\u79df\u7ea6\uff1b\u90ed\u6b66\u8273\u4ee3\u4ed880\u4e07\u5355\u5217\uff0c2024-08-14\u9000\u79df\u3002", entries: [dep("2024-03-25",1_000_000,"403\u848b\u53cb\u5e73\u79df2\u62bc\u91d1100\u4e07\u3002"),rent("2024-03-25",3_000_000,"403\u848b\u53cb\u5e73\u79df2\u79df\u91d1300\u4e07\u3002"),prop("2024-03-25",210_000,"403\u848b\u53cb\u5e73\u79df2\u7269\u4e1a\u8d3921\u4e07\u3002"),out("2024-04-26",2_700_000,"OWNER","403\u848b\u53cb\u5e73\u79df2\u79df\u91d1\u4e2d\u623f\u4e1c\u53d6270\u4e07\u3002"),rent("2024-08-14",800_000,"403\u848b\u53cb\u5e73\u79df2\u7531\u90ed\u6b66\u8273\u4ee3\u4ed8\u79df\u91d1\u7b4980\u4e07\u3002"),out("2024-08-14",800_000,"OWNER2","403\u90ed\u6b66\u8273\u4ee3\u4ed880\u4e07\u540e\u8f6c\u4ed8\u623f\u4e1c\u3002"),out("2024-08-14",1_000_000,"DEPREF","403\u848b\u53cb\u5e73\u79df2\u9000\u62bc\u91d1100\u4e07\u3002","lease_deposit_refund","liability_out")] },
  { unitNo: "403", tenant: "\u90ed\u6b66\u8273", start: "2024-10-01", end: "2025-03-31", actualEnd: "2024-12-01", deposit: 1_000_000, monthlyRent: 500_000, suffix: "GUO", notes: "2024-12-01\u56e0\u623f\u4e1c\u7528\u623f\u8f6c509\uff0c\u62bc\u91d1\u540c\u6b65\u8f6c509\u3002", entries: [dep("2024-08-14",1_000_000,"403\u90ed\u6b66\u8273\u62bc\u91d1100\u4e07\uff0c\u540e\u8f6c509\u3002"),rent("2024-08-14",3_000_000,"403\u90ed\u6b66\u8273\u79df\u91d1300\u4e07\u3002"),prop("2024-08-14",210_000,"403\u90ed\u6b66\u8273\u7269\u4e1a\u8d3921\u4e07\u3002"),out("2024-12-01",1_000_000,"DEPTRANSFER","403\u90ed\u6b66\u8273\u62bc\u91d1100\u4e07\u8f6c\u81f3509\u3002","lease_deposit_refund","liability_out")] },
  { unitNo: "404", tenant: "\u6768\u5f66\u6625", start: "2021-09-15", end: "2022-03-14", actualEnd: "2022-03-03", deposit: 1_200_000, monthlyRent: 600_000, notes: "2022-03-03\u9000\u79df\uff1b\u62bc\u91d1\u6309\u5df2\u9000\u95ed\u73af\u3002", entries: [dep("2021-09-09",1_200_000,"404\u6768\u5f66\u6625\u62bc\u91d1120\u4e07\u3002"),rent("2021-09-09",3_600_000,"404\u6768\u5f66\u6625\u79df\u91d1360\u4e07\u3002"),out("2022-03-03",1_200_000,"DEPREF","404\u6768\u5f66\u6625\u62bc\u91d1120\u4e07\u5df2\u9000\uff0c\u5177\u4f53\u9000\u6b3e\u65e5\u672a\u8bb0\u8f7d\u3002","lease_deposit_refund","liability_out")] },
  { unitNo: "404", tenant: "\u738b\u5a01\u5dcd", start: "2022-03-25", end: "2024-04-24", actualEnd: "2024-04-24", deposit: 1_200_000, monthlyRent: 600_000, suffix: "WANG", notes: "\u9996\u7b14EUR 7700\u6298\u5408504\u4e07\uff1bCNY 42816\u6298\u5408384\u4e07\uff1b\u5747\u4fdd\u7559\u539f\u5e01\u8bf4\u660e\u5e76\u6309\u7528\u9014\u5206\u5217\u3002", entries: [dep("2022-03-25",1_200_000,"404\u738b\u5a01\u5dcd\u9996\u7b14\u539f\u5e01EUR 7700\u4e2d\u62bc\u91d1\u90e8\u5206\uff0c\u6298\u5408120\u4e07XOF\u3002"),rent("2022-03-25",3_600_000,"404\u738b\u5a01\u5dcd\u9996\u7b14\u539f\u5e01EUR 7700\u4e2d\u79df\u91d1\u90e8\u5206\uff0c\u6298\u5408360\u4e07XOF\u3002"),prop("2022-03-25",240_000,"404\u738b\u5a01\u5dcd\u9996\u7b14\u539f\u5e01EUR 7700\u4e2d\u7269\u4e1a\u8d39\u90e8\u5206\uff0c\u6298\u540824\u4e07XOF\u3002"),rent("2022-11-05",1_950_000,"404\u738b\u5a01\u5dcd\u540e\u7eed\u6536\u6b3e195\u4e07\uff0cExcel\u672a\u7ed9\u51fa\u7528\u9014\u62c6\u5206\u3002"),rent("2023-01-03",3_840_000,"404\u738b\u5a01\u5dcd\u6536\u6b3e384\u4e07\uff0c\u8f6c\u9ad8\u603b\u3002"),rent("2023-08-07",40_140,"404\u738b\u5a01\u5dcdCNY 42816\u4e2d\u79df\u91d1\u90e8\u5206\uff0c\u6298\u5408360\u4e07XOF\u3002",{currency:"CNY",rate:3_840_000/42_816,amountXof:3_600_000}),prop("2023-08-07",2_676,"404\u738b\u5a01\u5dcdCNY 42816\u4e2d\u7269\u4e1a\u8d39\u90e8\u5206\uff0c\u6298\u540824\u4e07XOF\u3002",{currency:"CNY",rate:3_840_000/42_816,amountXof:240_000}),rent("2023-12-28",1_800_000,"404\u738b\u5a01\u5dcd\u79df\u91d1180\u4e07\u3002"),prop("2023-12-28",120_000,"404\u738b\u5a01\u5dcd\u7269\u4e1a\u8d3912\u4e07\u3002"),rent("2024-04-04",600_000,"404\u738b\u5a01\u5dcd\u79df\u91d160\u4e07\u3002"),prop("2024-04-04",40_000,"404\u738b\u5a01\u5dcd\u7269\u4e1a\u8d394\u4e07\u3002"),out("2024-06-03",893_000,"DEPREF","404\u738b\u5a01\u5dcd\u5b9e\u9000\u62bc\u91d189.3\u4e07\u3002","lease_deposit_refund","liability_out"),out("2024-06-03",307_000,"DEPDED","404\u738b\u5a01\u5dcd\u62bc\u91d1\u6263\u6b3e30.7\u4e07\uff0c\u4e0e\u900089.3\u4e07\u95ed\u73af120\u4e07\u3002","lease_deposit_deduction","liability_out")] },
  { unitNo: "404", tenant: "SHARMA", start: "2024-07-01", end: "2026-06-30", deposit: 1_200_000, monthlyRent: 600_000, suffix: "SHARMA", paidThrough: "2026-06-30", notes: "102\u62bc\u91d1120\u4e07\u8f6c\u5165404\uff1b\u5df2\u5230\u671f\u4e14\u65e0\u7eed\u79df\u8bb0\u5f55\uff0c\u62bc\u91d1\u9000\u6b3e\u72b6\u6001\u672a\u77e5\u3002", entries: [dep("2024-07-01",1_200_000,"404 SHARMA\u62bc\u91d1120\u4e07\u7531102\u8f6c\u5165\u3002"),...["2024-07-05","2024-12-30","2025-06-30","2025-12-30"].flatMap((d)=>[rent(d,3_600_000,`404 SHARMA\u534a\u5e74\u79df\u91d1360\u4e07\u3002`),prop(d,240_000,`404 SHARMA\u534a\u5e74\u7269\u4e1a\u8d3924\u4e07\u3002`)])] },
];

for (const unitNo of ["405", "406"]) specs.push({ unitNo, tenant: "\u5019\u7389\u82f1", start: "2021-09-01", end: "2022-02-28", deposit: 1_100_000, monthlyRent: 550_000, suffix: "JOINT", notes: "405/406\u8054\u5408\u79df\u7ea6\uff0c\u6708\u79df\u5408\u8ba1110\u4e07\u3001\u62bc\u91d1\u5408\u8ba1220\u4e07\uff1b\u4e24\u7b14440\u4e07\u6309\u4e24\u95f4\u540450%\u62c6\u8d26\u3002", entries: [dep("2021-08-30",1_100_000,`${unitNo}\u5019\u7389\u82f1\u8054\u5408\u79df\u7ea6\u62bc\u91d1\u5206\u644a110\u4e07\u3002`),rent("2021-08-30",1_100_000,`${unitNo}\u5019\u7389\u82f1\u8054\u5408\u79df\u7ea6\u9996\u7b14440\u4e07\u4e2d\u79df\u91d1\u5206\u644a110\u4e07\u3002`),rent("2021-10-19",2_200_000,`${unitNo}\u5019\u7389\u82f1\u8054\u5408\u79df\u7ea6\u7b2c\u4e8c\u7b14440\u4e07\u4e2d\u79df\u91d1\u5206\u644a220\u4e07\u3002`),out("2022-11-18",875_000,"DEPREF",`${unitNo}\u5019\u7389\u82f1\u8054\u5408\u79df\u7ea6\u9000\u62bc\u91d1\u8bb0\u5f5587.5\u4e07\uff0c\u6309Excel\u539f\u989d\u5355\u5217\u3002`,"lease_deposit_refund","liability_out")] });
for (const unitNo of ["405", "406"]) specs.push({ unitNo, tenant: "\u8def\u5efa\u516c\u53f8", start: "2022-03-01", end: "2023-12-31", monthlyRent: 550_000, suffix: "LUJIAN", notes: "405/406\u8054\u5408\u79df\u7ea6\uff1b\u53ea\u767b\u8bb0Excel\u4e2d\u660e\u786e\u91d1\u989d\uff0c2022-09-20\u7b49\u672a\u5199\u91d1\u989d\u7684\u8bb0\u5f55\u4e0d\u7f16\u9020\u3002", entries: [rent("2022-03-23",3_300_000,`${unitNo}\u8def\u5efa\u516c\u53f8\u8054\u5408\u79df\u91d1660\u4e07\u630950%\u5206\u644a330\u4e07\u3002`),prop("2022-03-23",225_000,`${unitNo}\u8def\u5efa\u516c\u53f8\u8054\u5408\u7269\u4e1a\u8d3945\u4e07\u630950%\u5206\u644a22.5\u4e07\u3002`),prop("2022-11-18",225_000,`${unitNo}\u8def\u5efa\u516c\u53f8\u8865\u4ea4\u8054\u5408\u7269\u4e1a\u8d3945\u4e07\u630950%\u5206\u644a22.5\u4e07\u3002`),...(unitNo === "405" ? [prop("2023-11-30",490_000,"405\u8def\u5efa\u516c\u53f8\u7269\u4e1a\u8d3949\u4e07\uff0c\u81f32023-12-31\u3002")] : [rent("2023-11-30",320_000,"406\u8def\u5efa\u516c\u53f8\u79df\u91d132\u4e07\uff0c\u81f32023-10-31\u3002")])] });

specs.push(
  { unitNo: "406", tenant: "LOSCHIAVO", start: "2024-02-15", end: "2025-04-30", actualEnd: "2025-03-31", deposit: 1_400_000, monthlyRent: 700_000, notes: "2025-03-31\u9000\u623f\uff0c\u62bc\u91d1\u6309\u5df2\u9000\u95ed\u73af\u3002", entries: [dep("2024-02-06",1_400_000,"406 LOSCHIAVO\u62bc\u91d1140\u4e07\u3002"),rent("2024-02-06",4_200_000,"406 LOSCHIAVO\u79df\u91d1420\u4e07\u3002"),agencyIn("2024-02-06",700_000,"406 LOSCHIAVO\u4e2d\u4ecb\u8d39\u6536\u516570\u4e07\u3002"),out("2024-02-19",350_000,"AGENCY","406 LOSCHIAVO\u4e2d\u4ecb\u53d6\u8d3935\u4e07\u3002","lease_agency_expense"),rent("2024-08-26",2_450_000,"406 LOSCHIAVO\u79df\u91d1245\u4e07\u3002"),rent("2025-01-28",3_500_000,"406 LOSCHIAVO\u79df\u91d1350\u4e07\u3002"),out("2025-03-31",1_400_000,"DEPREF","406 LOSCHIAVO\u62bc\u91d1140\u4e07\u5df2\u9000\uff0c\u5177\u4f53\u9000\u6b3e\u65e5\u672a\u8bb0\u8f7d\u3002","lease_deposit_refund","liability_out")] },
  { unitNo: "407", tenant: "\u4f55\u5efa\u8f89", start: "2022-06-05", end: "2023-06-04", deposit: 1_000_000, monthlyRent: 500_000, notes: "\u5386\u53f2\u79df\u7ea6\uff1b\u62bc\u91d1\u900081.8\u4e07\u3001\u626318.2\u4e07\u3002", entries: [dep("2022-06-02",1_000_000,"407\u4f55\u5efa\u8f89\u62bc\u91d1100\u4e07\u3002"),rent("2022-06-02",3_000_000,"407\u4f55\u5efa\u8f89\u79df\u91d1300\u4e07\u3002"),prop("2022-06-02",210_000,"407\u4f55\u5efa\u8f89\u7269\u4e1a\u8d3921\u4e07\u3002"),out("2023-01-16",818_000,"DEPREF","407\u4f55\u5efa\u8f89\u5b9e\u9000\u62bc\u91d181.8\u4e07\u3002","lease_deposit_refund","liability_out"),out("2023-01-16",182_000,"DEPDED","407\u4f55\u5efa\u8f89\u62bc\u91d1\u626318.2\u4e07\u3002","lease_deposit_deduction","liability_out")] },
  { unitNo: "407", tenant: "\u738b\u541b", start: "2023-02-24", end: "2024-05-23", deposit: 1_000_000, monthlyRent: 500_000, suffix: "WANG", notes: "\u5386\u53f2\u79df\u7ea6\uff1b\u62bc\u91d1\u900059.7\u4e07\u3001\u626340.3\u4e07\uff1b\u623f\u4e1c\u53d6\u79df66.6\u4e07\u3002", entries: [dep("2023-02-23",1_000_000,"407\u738b\u541b\u62bc\u91d1100\u4e07\u3002"),rent("2023-02-23",3_000_000,"407\u738b\u541b\u79df\u91d1300\u4e07\u3002"),prop("2023-02-23",210_000,"407\u738b\u541b\u7269\u4e1a\u8d3921\u4e07\u3002"),rent("2023-09-13",1_000_000,"407\u738b\u541b\u79df\u91d1100\u4e07\u3002"),rent("2023-09-20",2_210_000,"407\u738b\u541b\u6536\u6b3e221\u4e07\uff0cExcel\u672a\u7ed9\u51fa\u79df\u91d1/\u7269\u4e1a\u8d39\u62c6\u5206\u3002"),rent("2024-03-25",1_500_000,"407\u738b\u541b\u79df\u91d1150\u4e07\u3002"),out("2024-04-12",666_000,"OWNER","407\u738b\u541b\u79df\u91d1\u4e2d\u623f\u4e1c\u53d666.6\u4e07\u3002"),out("2024-06-03",597_000,"DEPREF","407\u738b\u541b\u5b9e\u9000\u62bc\u91d159.7\u4e07\u3002","lease_deposit_refund","liability_out"),out("2024-06-03",403_000,"DEPDED","407\u738b\u541b\u62bc\u91d1\u626340.3\u4e07\u3002","lease_deposit_deduction","liability_out")] },
  { unitNo: "408", tenant: "\u4e2d\u94c1\u4e8c\u5341\u5c40", start: "2021-10-01", end: "2022-03-31", actualEnd: "2022-04-30", deposit: 1_200_000, monthlyRent: 600_000, notes: "2022-04-30\u817e\u51fa\uff1b\u62bc\u91d1\u6309\u5df2\u9000\u95ed\u73af\u3002", entries: [dep("2021-10-21",1_200_000,"408\u4e2d\u94c1\u4e8c\u5341\u5c40\u62bc\u91d1120\u4e07\u3002"),rent("2021-10-21",3_600_000,"408\u4e2d\u94c1\u4e8c\u5341\u5c40\u79df\u91d1360\u4e07\u3002"),out("2022-04-30",1_200_000,"DEPREF","408\u4e2d\u94c1\u4e8c\u5341\u5c40\u62bc\u91d1120\u4e07\u5df2\u9000\u3002","lease_deposit_refund","liability_out")] },
  { unitNo: "408", tenant: "\u738b\u96ea\u71d5", start: "2022-06-20", end: "2022-12-19", deposit: 1_200_000, monthlyRent: 600_000, suffix: "WANG", notes: "\u5386\u53f2\u79df\u7ea6\uff1bExcel\u6807\u8bb0\u5df2\u9000\u3002", entries: [dep("2022-06-15",1_200_000,"408\u738b\u96ea\u71d5\u62bc\u91d1120\u4e07\u3002"),rent("2022-06-15",3_600_000,"408\u738b\u96ea\u71d5\u79df\u91d1360\u4e07\u3002"),prop("2022-06-15",240_000,"408\u738b\u96ea\u71d5\u7269\u4e1a\u8d3924\u4e07\u3002"),out("2022-12-19",1_200_000,"DEPREF","408\u738b\u96ea\u71d5\u62bc\u91d1120\u4e07\u5df2\u9000\uff0c\u5177\u4f53\u9000\u6b3e\u65e5\u672a\u8bb0\u8f7d\u3002","lease_deposit_refund","liability_out")] },
);

const luoDates = ["2023-03-02","2023-08-31","2024-03-07","2024-09-05","2025-02-28","2025-09-01","2026-03-05"];
specs.push({ unitNo: "408", tenant: "\u7f57\u7389\u65b0", start: "2023-03-02", end: "2026-08-31", active: true, deposit: 1_200_000, monthlyRent: 600_000, paidThrough: "2026-08-31", notes: "\u5f53\u524d\u5728\u79df\uff0c\u5df2\u7f34\u81f32026-08-31\u3002", entries: [dep(luoDates[0],1_200_000,"408\u7f57\u7389\u65b0\u62bc\u91d1120\u4e07\uff0c\u5f53\u524d\u6301\u6709\u3002"),...luoDates.flatMap((d,i)=>[rent(d,3_600_000,`408\u7f57\u7389\u65b0\u7b2c${i+1}\u671f\u79df\u91d1360\u4e07\u3002`,i===6?{oldReceipt:"WB4-L-408-20260305-RENT"}:{}),prop(d,240_000,`408\u7f57\u7389\u65b0\u7b2c${i+1}\u671f\u7269\u4e1a\u8d3924\u4e07\u3002`)])] });

specs.push(
  { unitNo: "409", tenant: "\u502a\u5eb7", start: "2022-03-15", end: "2023-10-14", actualEnd: "2023-10-24", monthlyRent: 500_000, notes: "\u5386\u53f2\u79df\u7ea6\uff1b2023-11-08\u768436.6\u4e07\u4e3a10\u5929\u79df\u91d1\u53ca\u9000\u623f\u590d\u539f\u8d39\u5408\u5e76\u8bb0\u5f55\u3002", entries: [rent("2022-03-08",1_500_000,"409\u502a\u5eb7\u79df\u91d1150\u4e07\u3002"),prop("2022-03-08",105_000,"409\u502a\u5eb7\u7269\u4e1a\u8d3910.5\u4e07\u3002"),rent("2022-06-20",2_000_000,"409\u502a\u5eb7\u79df\u91d1200\u4e07\u3002"),prop("2022-06-20",140_000,"409\u502a\u5eb7\u7269\u4e1a\u8d3914\u4e07\u3002"),rent("2022-12-12",3_000_000,"409\u502a\u5eb7\u79df\u91d1300\u4e07\u3002"),prop("2022-12-12",210_000,"409\u502a\u5eb7\u7269\u4e1a\u8d3921\u4e07\u3002"),rent("2023-05-20",1_500_000,"409\u502a\u5eb7\u79df\u91d1150\u4e07\u3002"),prop("2023-05-20",105_000,"409\u502a\u5eb7\u7269\u4e1a\u8d3910.5\u4e07\u3002"),rent("2023-07-28",1_500_000,"409\u502a\u5eb7\u79df\u91d1150\u4e07\u3002"),prop("2023-07-28",105_000,"409\u502a\u5eb7\u7269\u4e1a\u8d3910.5\u4e07\u3002"),{date:"2023-11-08",amount:366_000,type:"lease_other_income",code:"OTHER",title:"\u5176\u4ed6\u6536\u5165",notes:"409\u502a\u5eb710\u5929\u79df\u91d1\u53ca\u9000\u623f\u590d\u539f\u8d39\u5408\u8ba136.6\u4e07\uff0c\u6309Excel\u5408\u5e76\u767b\u8bb0\u3002"}] },
  { unitNo: "409", tenant: "OUMOU BAH", start: "2023-12-01", end: "2024-11-30", actualEnd: "2025-02-05", deposit: 2_000_000, monthlyRent: 550_000, suffix: "OUMOU", notes: "\u4e0e506\u8054\u5408\u4ed8\u6b3e\uff0c\u6309\u6708\u79df55:65\u5206\u644a\uff1b2024-10-03\u652f\u7968\u8df3\u7968\u4e0d\u8bb0\u6536\u6b3e\u3002", entries: [dep("2023-11-28",2_000_000,"409 OUMOU BAH\u79df\u623f\u5b9a\u91d1200\u4e07\uff0c\u6309\u62bc\u91d1\u767b\u8bb0\u3002"),rent("2023-12-14",1_191_667,"409/506\u8054\u5408\u6536260\u4e07\uff0c409\u630955:65\u5206\u644a119.1667\u4e07\u3002"),rent("2024-04-02",2_200_000,"409/506\u8054\u5408\u6536480\u4e07\uff0c409\u630955:65\u5206\u644a220\u4e07\u3002"),rent("2024-08-06",550_000,"409/506\u8054\u5408\u6536120\u4e07\uff0c409\u630955:65\u5206\u644a55\u4e07\u3002"),rent("2024-08-06",550_000,"409/506\u540c\u65e5\u7b2c\u4e8c\u7b14\u8054\u5408\u6536120\u4e07\uff0c409\u5206\u644a55\u4e07\u3002",{code:"RENTB"}),rent("2024-11-06",550_000,"409/506\u8054\u5408\u6536120\u4e07\uff0c409\u5206\u644a55\u4e07\u3002"),rent("2024-12-12",1_100_000,"409/506\u8054\u5408\u6536240\u4e07\uff0c409\u5206\u644a110\u4e07\u3002"),out("2025-02-05",504_167,"DEPREF","409/506\u8054\u5408\u9000110\u4e07\uff0c409\u630955:65\u5206\u644a50.4167\u4e07\u3002","lease_deposit_refund","liability_out")] },
  { unitNo: "409", tenant: "\u5f90\u5efa\u826f", start: "2025-03-01", end: "2026-08-28", active: true, deposit: 1_000_000, monthlyRent: 500_000, paidThrough: "2026-08-28", notes: "\u5f53\u524d\u5728\u79df\uff0c\u5df2\u7f34\u81f32026-08-28\u3002", entries: [dep("2025-02-28",1_000_000,"409\u5f90\u5efa\u826f\u62bc\u91d1100\u4e07\uff0c\u5f53\u524d\u6301\u6709\u3002"),...[["2025-02-28",null],["2025-08-25",null],["2026-02-26","WB4-L-409-20260226-RENT"]].flatMap(([d,old])=>[rent(d,3_000_000,"409\u5f90\u5efa\u826f\u534a\u5e74\u79df\u91d1300\u4e07\u3002",old?{oldReceipt:old}:{}),prop(d,210_000,"409\u5f90\u5efa\u826f\u534a\u5e74\u7269\u4e1a\u8d3921\u4e07\u3002")])] },
  { unitNo: "410", tenant: "\u5510\u5eb7\u4e50\uff0f\u516c\u53f8\u4ee3\u79df", start: "2021-08-16", end: "2026-08-15", active: true, deposit: 1_200_000, monthlyRent: 600_000, paidThrough: "2026-08-15", notes: "\u5f53\u524d\u5728\u79df\uff1bExcel\u53e6\u8bb0\u201c500\u8f6c\u79df\u91d1/\u5b9a\u91d1500\u201d\uff0c\u7528\u9014\u4e0d\u6e05\uff0c\u4ec5\u4fdd\u7559\u8bf4\u660e\u800c\u4e0d\u65b0\u589e\u6536\u6b3e\u3002", entries: [dep("2021-08-12",1_200_000,"410\u5510\u5eb7\u4e50\u62bc\u91d1120\u4e07\uff0c\u5f53\u524d\u6301\u6709\u3002"),rent("2021-08-12",3_600_000,"410\u5510\u5eb7\u4e50\u79df\u91d1360\u4e07\u3002"),rent("2022-02-24",3_600_000,"410\u5510\u5eb7\u4e50\u79df\u91d1360\u4e07\u3002"),...[["2022-08-17",3_600_000,240_000],["2023-02-18",3_600_000,240_000],["2023-08-11",3_600_000,240_000],["2024-03-01",7_200_000,480_000],["2025-02-15",3_600_000,240_000],["2025-08-13",3_600_000,240_000],["2026-02-13",3_600_000,240_000]].flatMap(([d,r,p],i)=>[rent(d,r,`410\u5510\u5eb7\u4e50\u7b2c${i+1}\u671f\u540e\u7eed\u79df\u91d1\u3002`,d==="2026-02-13"?{oldReceipt:"WB4-L-410-20260213-RENT"}:{}),prop(d,p,`410\u5510\u5eb7\u4e50\u7b2c${i+1}\u671f\u540e\u7eed\u7269\u4e1a\u8d39\u3002`)])] },
  { unitNo: "411", tenant: "\u6797\u5fd7\u6d69\u51af\u7acb\u529b", start: "2022-06-01", end: "2024-05-31", actualEnd: "2024-05-07", deposit: 1_000_000, monthlyRent: 500_000, notes: "\u5386\u53f2\u79df\u7ea6\uff1b2024-05-07\u9000\u62bc\u91d1100\u4e07\u3001\u9000\u79df\u91d150\u4e07\u3002", entries: [dep("2022-05-21",1_000_000,"411\u6797\u5fd7\u6d69/\u51af\u7acb\u529b\u62bc\u91d1100\u4e07\u3002"),...["2022-05-21","2022-12-13","2023-05-29","2023-11-30"].flatMap((d)=>[rent(d,3_000_000,"411\u6797\u5fd7\u6d69/\u51af\u7acb\u529b\u534a\u5e74\u79df\u91d1300\u4e07\u3002"),prop(d,210_000,"411\u6797\u5fd7\u6d69/\u51af\u7acb\u529b\u534a\u5e74\u7269\u4e1a\u8d3921\u4e07\u3002")]),out("2024-05-07",1_000_000,"DEPREF","411\u6797\u5fd7\u6d69/\u51af\u7acb\u529b\u9000\u62bc\u91d1100\u4e07\u3002","lease_deposit_refund","liability_out"),out("2024-05-07",500_000,"RENTREF","411\u6797\u5fd7\u6d69/\u51af\u7acb\u529b\u9000\u79df\u91d150\u4e07\u3002","lease_rent_refund","expense")] },
);

const created = [];
for (const spec of specs) {
  const lease = await upsertLease(spec);
  for (let i = 0; i < spec.entries.length; i += 1) await upsertEntry(lease, spec, spec.entries[i], i + 1);
  created.push({ unitNo: spec.unitNo, contractNo: lease.contractNo, active: Boolean(spec.active) });
}

for (const unitNo of unitNos) await checked(supabase.from("units").update({ status: "sold" }).eq("id", unitByNo[unitNo].id), `update ${unitNo} status`);
const active = await checked(supabase.from("lease_contracts").select("id, unit_id").in("unit_id", units.map((unit) => unit.id)).eq("status", "active"), "verify active leases");
const activeNos = active.map((lease) => units.find((unit) => unit.id === lease.unit_id)?.unit_no).sort();
if (JSON.stringify(activeNos) !== JSON.stringify(["408", "409", "410"])) throw new Error(`Unexpected active leases: ${activeNos.join(",")}`);
const paymentIds = (await checked(supabase.from("payments").select("id").in("source_id", created.map((item) => item.contractNo).length ? (await checked(supabase.from("lease_contracts").select("id").in("unit_id", units.map((unit) => unit.id)), "load floor lease ids")).map((row) => row.id) : []), "load payment ids")).map((row) => row.id);
if (paymentIds.length) {
  const ledgerRows = await checked(supabase.from("ledger_entries").select("payment_id").in("payment_id", paymentIds), "verify ledgers");
  const counts = new Map();
  for (const row of ledgerRows) counts.set(row.payment_id, (counts.get(row.payment_id) ?? 0) + 1);
  for (const id of paymentIds) if (counts.get(id) !== 1) throw new Error(`Payment ${id} has ${counts.get(id) ?? 0} ledgers`);
}
await checked(supabase.from("audit_logs").insert({ action: "reconcile_floor_lease_data", entity_type: "building", entity_id: building.id, metadata: { building_code: "SACSI4", floor: "4F", active_lease_units: activeNos, source: "4\u53f7\u516c\u5bd3.xlsx Sheet1 rows 61-99" } }), "write audit log");
console.log(JSON.stringify({ ok: true, floor: "4F", lease_count: created.length, active_units: activeNos }));
