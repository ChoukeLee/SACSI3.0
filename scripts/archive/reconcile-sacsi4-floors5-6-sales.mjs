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
const unitNos = [...Array.from({ length: 12 }, (_, i) => String(501 + i)), ...Array.from({ length: 12 }, (_, i) => String(601 + i))];
const units = await checked(supabase.from("units").select("id, unit_no").eq("building_id", building.id).in("unit_no", unitNos), "load units");
if (units.length !== unitNos.length) throw new Error(`Expected ${unitNos.length} units, got ${units.length}`);
const unitByNo = Object.fromEntries(units.map((unit) => [unit.unit_no, unit]));

async function upsertCustomer(name, notes) {
  const rows = await checked(supabase.from("customers").select("id").eq("name", name), `find customer ${name}`);
  if (rows.length >= 1) return rows[0].id;
  return (await checked(supabase.from("customers").insert({ name, notes }).select("id").single(), `insert customer ${name}`)).id;
}

async function upsertPayment(sale, unitNo, entry, index) {
  const receipt = `WB4-SALE-${unitNo}-${entry.date.replaceAll("-", "")}-${entry.code}-${String(index).padStart(2, "0")}`;
  let rows = await checked(supabase.from("payments").select("id").eq("source_id", sale.id).eq("receipt_no", receipt), `find ${receipt}`);
  if (rows.length === 0 && entry.oldReceipt) rows = await checked(supabase.from("payments").select("id").eq("source_id", sale.id).eq("receipt_no", entry.oldReceipt), `find ${entry.oldReceipt}`);
  if (rows.length > 1) throw new Error(`Duplicate payment ${receipt}`);
  const payload = { customer_id: sale.customer_id, unit_id: unitByNo[unitNo].id, source_type: entry.type, source_id: sale.id, payment_date: entry.date, amount: entry.amount, currency: "XOF", exchange_rate_to_xof: 1, receipt_no: receipt, notes: entry.notes };
  let paymentId;
  if (rows.length === 1) {
    paymentId = rows[0].id;
    await checked(supabase.from("payments").update(payload).eq("id", paymentId), `update ${receipt}`);
  } else paymentId = (await checked(supabase.from("payments").insert(payload).select("id").single(), `insert ${receipt}`)).id;
  const ledger = { building_id: building.id, unit_id: unitByNo[unitNo].id, payment_id: paymentId, entry_date: entry.date, direction: entry.direction ?? "income", category: entry.category ?? entry.type, amount_xof: entry.amount, amount_cny: null, description: entry.notes };
  const ledgers = await checked(supabase.from("ledger_entries").select("id").eq("payment_id", paymentId), `find ledger ${receipt}`);
  if (ledgers.length > 1) throw new Error(`Duplicate ledger ${receipt}`);
  if (ledgers.length === 1) await checked(supabase.from("ledger_entries").update(ledger).eq("id", ledgers[0].id), `update ledger ${receipt}`);
  else await checked(supabase.from("ledger_entries").insert(ledger), `insert ledger ${receipt}`);
}

const house = (date, amount, notes) => ({ date, amount, type: "sale_contract", code: "HOUSE", notes });
const extra = (date, amount, type, code, notes, direction = "income", category) => ({ date, amount, type, code, notes, direction, category });
const specs = {
  "501": { buyer: "\u4e07\u6881\u3001\u5f20\u536b\u840d", date: "2026-06-12", total: 60_000_000, entries: [house("2026-06-12",60_000_000,"501\u623f\u6b3e6000\u4e07\u5df2\u4ed8\u6e05\u3002")] },
  "502": { buyer: "\u674e\u4e50\u5168", date: "2026-06-20", total: 80_000_000, entries: [house("2026-06-20",80_000_000,"502\u623f\u6b3e8000\u4e07\u5df2\u4ed8\u6e05\u3002")] },
  "503": { buyer: "\u848b\u53cb\u5e73", date: "2024-04-02", total: 73_000_000, entries: [house("2024-04-02",73_000_000,"503\u623f\u6b3e7300\u4e07\u5df2\u4ed8\u6e05\u3002"),extra("2024-04-02",210_000,"property_fee","PROP","503\u7269\u4e1a\u8d3921\u4e07\u5355\u5217\u3002"),extra("2024-04-12",200_000,"sale_other_expense","FURNREF","503\u9000\u8863\u67dc\u8d3920\u4e07\u3002","expense","sale_furniture_refund")] },
  "504": { buyer: "KONE SOUNAN", date: "2022-10-07", total: 80_000_000, entries: [house("2022-10-07",40_000_000,"504\u7b2c\u4e00\u7b14\u623f\u6b3e4000\u4e07\u3002"),house("2022-10-10",40_000_000,"504\u7b2c\u4e8c\u7b14\u623f\u6b3e4000\u4e07\u3002"),extra("2022-10-10",1_800_000,"sale_other_income","TRANSFERTAX","504\u8fc7\u6237\u7a0e\u4ee3\u6536180\u4e07\u5355\u5217\u3002","liability_in","sale_transfer_tax")] },
  "505": { buyer: "DLAKITE", date: "2022-02-09", total: 66_600_000, entries: [house("2022-02-09",66_600_000,"505\u623f\u6b3e6660\u4e07\u5df2\u4ed8\u6e05\u3002"),extra("2022-02-09",190_000,"sale_other_income","FURNITURE","505\u8863\u67dc\u6b3e19\u4e07\u5355\u5217\uff1b\u5b9e\u9645\u65e5\u671f\u672a\u8bb0\u8f7d\uff0c\u4ee5\u623f\u6b3e\u65e5\u5f52\u8d26\u3002")] },
  "506": { buyer: "BAMAB", date: "2019-11-19", total: 93_100_000, agency: 4_515_000, entries: [house("2019-11-19",34_450_000,"506\u7b2c\u4e00\u7b14\u623f\u6b3e3445\u4e07\u3002"),extra("2019-11-19",4_515_000,"sale_agency_expense","AGENCY","506\u51fa\u552e\u4e2d\u4ecb\u8d39451.5\u4e07\u7531\u516c\u53f8\u652f\u4ed8\uff0c\u5355\u5217\u3002","expense","sale_agency_expense"),house("2020-02-06",10_000_000,"506\u7b2c\u4e8c\u7b14\u623f\u6b3e1000\u4e07\u3002"),house("2023-03-29",48_650_000,"506\u7b2c\u4e09\u7b14\u623f\u6b3e4865\u4e07\uff0c\u5df2\u7ed3\u6e05\u3002"),extra("2023-06-20",2_250_000,"sale_other_income","TRANSFERTAX","506\u8fc7\u6237\u7a0e225\u4e07\uff0c\u4ece201/308/506\u8054\u5408\u7a0e\u6b3e675\u4e07\u4e2d\u5e73\u5747\u5206\u644a\u3002","liability_in","sale_transfer_tax")] },
  "507": { buyer: "DIALLO BOUBACAR", date: "2022-07-29", total: 80_000_000, entries: [extra("2021-12-20",250_000,"sale_registration_fee","REGISTRATION","507/508\u8054\u5408\u8d2d\u4e70\u6ce8\u518c\u91d125\u4e07\uff0c\u6309Excel\u539f\u4f4d\u7f6e\u5217\u5728507\u3002"),house("2022-07-29",80_000_000,"507/508\u540c\u4e00\u4e70\u65b9\u6253\u5305\u4ed8\u6b3e16000\u4e07\uff0c507\u5206\u644a8000\u4e07\u3002"),extra("2022-08-10",500_000,"sale_other_expense","FURNREF","507/508\u9000\u8863\u67dc\u8d3950\u4e07\uff0c\u6309Excel\u539f\u4f4d\u7f6e\u5217\u5728507\u3002","expense","sale_furniture_refund")] },
  "508": { buyer: "DIALLO BOUBACAR", date: "2022-07-29", total: 80_000_000, entries: [house("2022-07-29",80_000_000,"507/508\u540c\u4e00\u4e70\u65b9\u6253\u5305\u4ed8\u6b3e16000\u4e07\uff0c508\u5206\u644a8000\u4e07\u3002")] },
  "509": { buyer: "TRAORE", date: "2023-08-22", total: 76_000_000, entries: [house("2023-08-22",76_000_000,"509\u623f\u6b3e7600\u4e07\u5df2\u4ed8\u6e05\u3002"),extra("2023-08-24",250_000,"sale_registration_fee","REGISTRATION","509\u6ce8\u518c\u91d125\u4e07\u5355\u5217\u3002"),extra("2023-10-09",1_950_000,"sale_other_income","TRANSFERTAX","509\u8fc7\u6237\u7a0e195\u4e07\u5355\u5217\uff0c\u6309Excel\u539f\u989d\u767b\u8bb0\u3002","liability_in","sale_transfer_tax")] },
  "510": { buyer: "ESPECE", date: "2021-12-30", total: 95_000_000, entries: [extra("2021-11-11",250_000,"sale_registration_fee","REGISTRATION","510\u6ce8\u518c\u91d125\u4e07\u5355\u5217\u3002"),house("2021-12-30",95_000_000,"510\u623f\u6b3e9500\u4e07\u5df2\u4ed8\u6e05\uff1bExcel\u6ce8\u8bb0\u672a\u505a\u51fa\u5165\u8d260001118\u3002"),extra("2021-12-31",2_850_000,"sale_other_income","TRANSFERTAX","510\u8fc7\u6237\u7a0e285\u4e07\u5355\u5217\uff0c2022-01-05\u5165\u8d26\u3002","liability_in","sale_transfer_tax")] },
  "511": { buyer: "\u6e38\u8fdb\u3001\u6bb7\u7b11\u82b8", date: "2026-06-12", total: 60_000_000, entries: [house("2026-06-12",60_000_000,"511\u623f\u6b3e6000\u4e07\u5df2\u4ed8\u6e05\u3002")] },
  "512": { buyer: "\u4e70\u65b9\u59d3\u540d\u5f85\u8865", date: "2026-06-13", total: 80_000_000, entries: [house("2026-06-13",63_000_000,"512\u7b2c\u4e00\u7b14\u623f\u6b3e6300\u4e07\u3002"),house("2026-06-13",17_000_000,"512\u7b2c\u4e8c\u7b14\u623f\u6b3e1700\u4e07\uff0c\u5df2\u7ed3\u6e05\u3002")] },
  "601": { buyer: "\u53f6\u743c", date: "2021-12-29", total: 75_000_000, entries: [house("2021-12-29",55_000_000,"601\u79df\u8f6c\u4e70\u9996\u7b14\u54085500\u4e07\uff08Excel\u8bb0480+20+5000\uff09\u3002"),house("2022-03-02",20_000_000,"601\u7b2c\u4e8c\u7b14\u623f\u6b3e2000\u4e07\uff0c\u5df2\u7ed3\u6e05\uff1b\u8d60\u9001\u505c\u8f66\u4f4d\u65e0\u6536\u6b3e\u3002")] },
  "602": { buyer: "SOADDA", date: "2023-07-14", total: 71_000_000, entries: [house("2023-07-14",41_000_000,"602\u7b2c\u4e00\u7b14\u623f\u6b3e4100\u4e07\u3002"),house("2023-07-17",30_000_000,"602\u7b2c\u4e8c\u7b14\u623f\u6b3e3000\u4e07\uff0c\u5df2\u7ed3\u6e05\u3002"),extra("2023-07-24",1_950_000,"sale_other_income","TRANSFERTAX","602\u8fc7\u6237\u7a0e195\u4e07\u5355\u5217\u3002","liability_in","sale_transfer_tax")] },
  "603": { buyer: "KAORE", date: "2021-09-08", total: 66_600_000, entries: [extra("2021-09-08",250_000,"sale_registration_fee","REGISTRATION","603\u6ce8\u518c\u91d125\u4e07\u5355\u5217\u3002"),house("2022-06-26",66_600_000,"603\u623f\u6b3e6660\u4e07\u5df2\u4ed8\u6e05\u3002"),extra("2022-06-26",190_000,"sale_other_income","FURNITURE","603\u8863\u67dc\u6b3e19\u4e07\uff0c\u65e5\u671f\u672a\u8bb0\u8f7d\uff0c\u4ee5\u623f\u6b3e\u65e5\u5f52\u8d26\u3002")] },
  "604": { buyer: "DIALLO THIERNO", date: "2022-09-14", total: 95_000_000, entries: [extra("2022-09-14",250_000,"sale_registration_fee","REGISTRATION","604\u6ce8\u518c\u91d125\u4e07\uff0c2023-03-18\u5165\u8d26\u3002"),house("2023-04-01",9_500_000,"604\u9884\u4ed810%\u623f\u6b3e950\u4e07\u3002"),house("2023-12-22",85_500_000,"604\u7b2c\u4e8c\u7b14\u623f\u6b3e8550\u4e07\uff0c\u5df2\u7ed3\u6e05\u3002"),extra("2024-01-25",300_000,"sale_other_expense","FURNREF","604\u9000\u4e09\u4e2a\u8863\u67dc\u8d3930\u4e07\u3002","expense","sale_furniture_refund")] },
  "605": { buyer: "COMOE", date: "2020-12-09", total: 66_600_000, entries: [extra("2020-12-09",250_000,"sale_registration_fee","REGISTRATION","605\u6ce8\u518c\u91d125\u4e07\u5355\u5217\u3002"),house("2022-07-18",66_600_000,"605\u623f\u6b3e6660\u4e07\u5df2\u4ed8\u6e05\u3002")] },
  "606": { buyer: "KACOU", date: "2023-02-13", total: 95_000_000, agency: 1_425_000, entries: [house("2023-02-13",55_000_000,"606\u7b2c\u4e00\u7b14\u623f\u6b3e5500\u4e07\u3002"),house("2023-04-13",40_000_000,"606\u7b2c\u4e8c\u7b14\u623f\u6b3e4000\u4e07\uff0c\u5df2\u7ed3\u6e05\u3002"),extra("2023-04-13",2_850_000,"sale_other_income","TRANSFERTAX","606\u8fc7\u6237\u7a0e285\u4e07\u5355\u5217\u3002","liability_in","sale_transfer_tax"),extra("2023-04-17",1_425_000,"sale_agency_expense","AGENCY","606\u51fa\u552e\u4e2d\u4ecb\u8d39142.5\u4e07\u7531\u516c\u53f8\u652f\u4ed8\u3002","expense","sale_agency_expense")] },
  "607": { buyer: "\u5ed6\u4fca\u751f", date: "2021-07-22", total: 60_000_000, entries: [house("2021-07-22",60_000_000,"607/608\u540c\u4e00\u4e70\u65b9\u6253\u5305\u4ed8\u6b3e13500\u4e07\uff0c607\u6309Excel\u6807\u4ef7\u5206\u644a6000\u4e07\u3002"),extra("2022-05-28",5_000_000,"sale_other_income","PARKING","607\u53e6\u8d2d\u8f66\u4f4dP52\u8f66\u4f4d\u6b3e500\u4e07\uff0c\u4e0d\u8ba1\u5165607/608\u623f\u4ef7\u3002")] },
  "608": { buyer: "\u5ed6\u4fca\u751f", date: "2021-07-22", total: 75_000_000, entries: [house("2021-07-22",75_000_000,"607/608\u540c\u4e00\u4e70\u65b9\u6253\u5305\u4ed8\u6b3e13500\u4e07\uff0c608\u6309Excel\u6807\u4ef7\u5206\u644a7500\u4e07\u3002")] },
  "609": { buyer: "\u845b\u4eae", date: "2021-06-23", total: 75_000_000, entries: [["2021-06-23",10_000_000],["2021-06-26",20_000_000],["2021-07-05",10_000_000],["2021-07-12",20_000_000],["2021-07-17",15_000_000]].map(([date,amount])=>house(date,amount,`609\u623f\u6b3e${amount/10_000}\u4e07\u3002`)) },
  "610": { buyer: "COPTY", date: "2020-08-14", total: 66_000_000, paidTowardTotal: 64_000_000, entries: [house("2020-08-14",55_000_000,"610\u7b2c\u4e00\u7b14\u623f\u6b3e5500\u4e07\u3002"),extra("2020-10-26",1_980_000,"sale_other_income","TRANSFERTAX","610\u8fc7\u6237\u7a0e198\u4e07\u5355\u5217\uff1bExcel\u5c06\u8be5\u7a0e\u6b3e\u8ba1\u5165\u5df2\u4ed86400\u4e07\u7684\u7ed3\u7b97\u989d\u3002","liability_in","sale_transfer_tax"),...["2020-12-09","2021-01-21","2021-03-29","2021-04-19","2021-07-05","2021-08-25"].map((date)=>house(date,date==="2020-12-09"?2_020_000:1_000_000,`610\u623f\u6b3e${date==="2020-12-09"?202:100}\u4e07\u3002`))] },
  "611": { buyer: "AYA ROSEMONDE", date: "2021-09-03", total: 70_300_000, entries: [["2021-09-03",2_050_000],["2021-09-15",1_500_000],["2021-09-22",2_775_500],["2021-09-27",11_360_000],["2021-09-30",2_000_000],["2021-10-19",3_000_000],["2021-11-10",2_000_000],["2021-12-10",3_000_000],["2022-01-07",1_500_000],["2022-01-22",6_000_000],["2022-02-18",3_000_000],["2022-03-29",1_000_000],["2022-04-08",6_000_000],["2022-04-11",2_240_000],["2022-04-14",4_000_000],["2022-04-19",4_000_000],["2022-04-23",1_425_500],["2022-06-07",2_500_000],["2022-06-07",1_600_000],["2022-06-16",1_500_000],["2022-06-22",1_569_000],["2022-06-22",3_280_000],["2022-06-10",3_000_000]].map(([date,amount])=>house(date,amount,`611\u623f\u6b3e${amount/10_000}\u4e07${date==="2022-06-22"&&amount===3_280_000?"\uff1bExcel\u8bb0327.98\u4e07\uff0c\u6309\u5408\u540c\u603b\u989d\u5f52\u4e00\u4e3a328\u4e07":""}\u3002`)).concat([extra("2022-08-17",200_000,"sale_other_expense","FURNREF","611\u9000\u8863\u67dc\u8d3920\u4e07\u3002","expense","sale_furniture_refund")]) },
  "612": { buyer: "YDO YAO", date: "2020-12-30", total: 88_000_000, agency: 2_000_000, entries: [extra("2020-12-30",250_000,"sale_registration_fee","REGISTRATION","612\u6ce8\u518c\u91d125\u4e07\u5355\u5217\u3002"),house("2020-12-31",88_000_000,"612\u623f\u6b3e8800\u4e07\uff0c\u4ece9000\u4e07\u6536\u6b3e\u4e2d\u6263\u9664\u4e2d\u4ecb\u8d39200\u4e07\u540e\u5f52\u5165\u623f\u6b3e\u3002"),extra("2021-01-14",2_000_000,"sale_agency_expense","AGENCY","612\u51fa\u552e\u4e2d\u4ecb\u8d39200\u4e07\u5df2\u652f\u4ed8\u3002","expense","sale_agency_expense"),extra("2022-08-10",300_000,"sale_other_income","FURNITURE","612\u8863\u67dc\u6b3e30\u4e07\u5355\u5217\u3002")] },
};

const saleIds = [];
for (const [unitNo, spec] of Object.entries(specs)) {
  let rows = await checked(supabase.from("sale_contracts").select("id, customer_id, total_amount_xof").eq("unit_id", unitByNo[unitNo].id).eq("status", "active"), `find sale ${unitNo}`);
  if (rows.length === 0 && ["508", "608", "512"].includes(unitNo)) {
    const customerId = await upsertCustomer(spec.buyer, "\u6765\u6e90\uff1a4\u53f7\u516c\u5bd3.xlsx\uff1b512\u4e70\u65b9\u59d3\u540d\u5f85\u8865\u3002");
    rows = [await checked(supabase.from("sale_contracts").insert({ unit_id: unitByNo[unitNo].id, customer_id: customerId, contract_no: `WB-SALE-SACSI4-${unitNo}-${spec.date.replaceAll("-", "")}`, signed_date: spec.date, transfer_status: "not_started", payment_plan_type: unitNo === "512" ? "\u63094\u53f7\u516c\u5bd3.xlsx\u5df2\u7ed3\u6e05\uff1b\u4e70\u65b9\u59d3\u540d\u5f85\u8865\u3002" : "\u4e0e\u76f8\u90bb\u623f\u95f4\u540c\u4e00\u4e70\u65b9\u6253\u5305\u8d2d\u4e70\uff0c\u6309Excel\u6807\u4ef7\u5206\u644a\u3002", total_amount_xof: spec.total, status: "active" }).select("id, customer_id, total_amount_xof").single(), `insert ${unitNo} sale`)];
  }
  if (rows.length !== 1) throw new Error(`Expected one active ${unitNo} sale, got ${rows.length}`);
  const sale = rows[0];
  await checked(supabase.from("sale_contracts").update({ contract_no: `WB-SALE-SACSI4-${unitNo}-${spec.date.replaceAll("-", "")}`, signed_date: spec.date, total_amount_xof: spec.total, agency_commission_amount_xof: spec.agency ?? null, agency_commission_paid: Boolean(spec.agency), payment_plan_type: `\u6765\u6e90\uff1a4\u53f7\u516c\u5bd3.xlsx\uff1b${unitNo === "610" ? "\u5408\u540c6600\u4e07\uff0c\u5df2\u4ed86400\u4e07\uff0c\u4ecd\u6b20200\u4e07\u3002" : "\u623f\u6b3e\u6309Excel\u660e\u7ec6\u767b\u8bb0\u3002"}` }).eq("id", sale.id), `update sale ${unitNo}`);
  for (let i = 0; i < spec.entries.length; i += 1) await upsertPayment(sale, unitNo, { ...spec.entries[i], oldReceipt: i === 0 ? `S4-SALE-${unitNo}-CONSOLIDATED` : undefined }, i + 1);
  const paid = spec.entries.filter((entry) => entry.type === "sale_contract").reduce((sum, entry) => sum + entry.amount, 0);
  if (paid > spec.total) throw new Error(`${unitNo} house payments exceed contract total`);
  const settledPaid = spec.paidTowardTotal ?? paid;
  const recPayload = { building_id: building.id, unit_id: unitByNo[unitNo].id, customer_id: sale.customer_id, source_type: "sale_contract", source_id: sale.id, category: "sale_lump_sum", title: `4# ${unitNo}\u8d2d\u623f\u6b3e`, due_date: spec.date, amount_xof: spec.total, paid_amount_xof: settledPaid, status: settledPaid === spec.total ? "paid" : "overdue", currency: "XOF", notes: `\u6765\u6e90\uff1a4\u53f7\u516c\u5bd3.xlsx\uff1b${unitNo === "610" ? "\u5df2\u4ed86400\u4e07\u542b\u5355\u5217\u8fc7\u6237\u7a0e198\u4e07\uff0c\u4ecd\u6b20200\u4e07\u3002" : "\u623f\u6b3e\u5df2\u7ed3\u6e05\u3002"}` };
  const recs = await checked(supabase.from("receivables").select("id").eq("source_id", sale.id).eq("category", "sale_lump_sum"), `find receivable ${unitNo}`);
  if (recs.length > 1) throw new Error(`Duplicate receivable ${unitNo}`);
  if (recs.length === 1) await checked(supabase.from("receivables").update(recPayload).eq("id", recs[0].id), `update receivable ${unitNo}`);
  else await checked(supabase.from("receivables").insert(recPayload), `insert receivable ${unitNo}`);
  await checked(supabase.from("units").update({ status: "sold" }).eq("id", unitByNo[unitNo].id), `update unit ${unitNo}`);
  saleIds.push(sale.id);
}

for (const [unitNo, spec] of Object.entries(specs)) {
  const sale = await checked(supabase.from("sale_contracts").select("id").eq("unit_id", unitByNo[unitNo].id).eq("status", "active").single(), `verify sale ${unitNo}`);
  const payments = await checked(supabase.from("payments").select("source_type, amount").eq("source_id", sale.id), `verify payments ${unitNo}`);
  const paid = payments.filter((payment) => payment.source_type === "sale_contract").reduce((sum, payment) => sum + Number(payment.amount), 0);
  const expected = spec.entries.filter((entry) => entry.type === "sale_contract").reduce((sum, entry) => sum + entry.amount, 0);
  if (paid !== expected) throw new Error(`Unexpected ${unitNo} paid ${paid}, expected ${expected}`);
}
await checked(supabase.from("audit_logs").insert({ action: "reconcile_floor_sale_data", entity_type: "building", entity_id: building.id, metadata: { building_code: "SACSI4", floors: ["5F", "6F"], active_sale_units: Object.keys(specs), joint_buyers: { "507_508": "DIALLO BOUBACAR", "607_608": "\u5ed6\u4fca\u751f" }, unit_610_outstanding_xof: 2_000_000 } }), "write audit");
console.log(JSON.stringify({ ok: true, floors: ["5F", "6F"], sales: Object.keys(specs).length, unit_610_outstanding_xof: 2_000_000 }));
