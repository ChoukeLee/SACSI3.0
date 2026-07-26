import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";

function loadEnv(path) {
  return Object.fromEntries(
    fs.readFileSync(path, "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const separator = line.indexOf("=");
        const key = line.slice(0, separator).trim();
        const value = line.slice(separator + 1).trim().replace(/^(['"])(.*)\1$/, "$2");
        return [key, value];
      }),
  );
}

const env = loadEnv(".env.local");
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error(".env.local 缺少 Supabase 服务端连接信息。");

const supabase = createClient(url, key, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const apply = process.argv.includes("--apply");

const targets = [
  { unitNo: "201", total: 208_890_000, house: 198_890_000, parking: 10_000_000 },
  { unitNo: "203", total: 116_080_000, house: 106_080_000, parking: 10_000_000 },
  { unitNo: "205", total: 175_030_000, house: 165_030_000, parking: 10_000_000 },
];

const source = "7号公寓.xlsx Sheet1 A1:J100";
const placeholderDate = "2026-01-01";
const houseNote = (unitNo, ref) => `import_ref=${ref}；来源：${source}；房号${unitNo}；土地款抵房款；已结清；实际日期待补，当前为系统占位日`;
const parkingNote = (unitNo, ref) => `import_ref=${ref}；来源：${source}；房号${unitNo}；车位款；土地款抵款；已结清；实际日期待补，当前为系统占位日`;
const planNote = (target) => `与${targets.filter((row) => row.unitNo !== target.unitNo).map((row) => row.unitNo).join("、")}共同以土地款非现金结算并已结清；房款${target.house / 10_000}万+车位款${target.parking / 10_000}万；实际日期待补，2026-01-01为系统占位日`;

async function checked(query, message) {
  const result = await query;
  if (result.error) throw new Error(`${message}：${result.error.message}`);
  return result.data;
}

const building = await checked(
  supabase.from("buildings").select("id, code").eq("code", "SACSI7").single(),
  "读取7号公寓失败",
);
const units = await checked(
  supabase.from("units").select("id, unit_no").eq("building_id", building.id).in("unit_no", targets.map((row) => row.unitNo)),
  "读取房源失败",
);
if (units.length !== targets.length) throw new Error(`目标房源不完整：读取到 ${units.length}/${targets.length} 间。`);

const unitByNo = new Map(units.map((unit) => [unit.unit_no, unit]));
const contracts = await checked(
  supabase.from("sale_contracts").select("id, unit_id, contract_no, total_amount_xof, payment_plan_type, signed_date, customer_id").in("unit_id", units.map((unit) => unit.id)).eq("status", "active"),
  "读取出售合同失败",
);
if (contracts.length !== targets.length) throw new Error(`生效出售合同不完整：读取到 ${contracts.length}/${targets.length} 份。`);

const contractByUnitId = new Map(contracts.map((contract) => [contract.unit_id, contract]));
const payments = await checked(
  supabase.from("payments").select("id, unit_id, source_id, payment_date, amount, currency, receipt_no, notes").in("source_id", contracts.map((contract) => contract.id)).eq("source_type", "sale_contract"),
  "读取收款失败",
);
const ledgers = payments.length
  ? await checked(
      supabase.from("ledger_entries").select("id, payment_id, amount_xof, description").in("payment_id", payments.map((payment) => payment.id)),
      "读取财务流水失败",
    )
  : [];

const preview = targets.map((target) => {
  const unit = unitByNo.get(target.unitNo);
  const contract = contractByUnitId.get(unit.id);
  const contractPayments = payments.filter((payment) => payment.source_id === contract.id);
  return {
    unitNo: target.unitNo,
    contractId: contract.id,
    contractNo: contract.contract_no,
    contractTotal: Number(contract.total_amount_xof),
    payments: contractPayments.map((payment) => ({
      id: payment.id,
      receiptNo: payment.receipt_no,
      amount: Number(payment.amount),
      ledgerIds: ledgers.filter((ledger) => ledger.payment_id === payment.id).map((ledger) => ledger.id),
    })),
    desired: { house: target.house, parking: target.parking, total: target.total },
  };
});
console.log(JSON.stringify({ mode: apply ? "apply" : "preview", records: preview }, null, 2));
if (!apply) process.exit(0);

for (const target of targets) {
  const unit = unitByNo.get(target.unitNo);
  const contract = contractByUnitId.get(unit.id);
  if (Number(contract.total_amount_xof) !== target.total) {
    throw new Error(`${target.unitNo} 合同总额异常：线上 ${contract.total_amount_xof}，预期 ${target.total}。`);
  }

  const houseRef = `WB7-S-${target.unitNo}-20260101-SALE-01`;
  const parkingRef = `WB7-S-${target.unitNo}-20260101-SALE-02`;
  const contractPayments = payments.filter((payment) => payment.source_id === contract.id);
  const fallbackHousePayments = contractPayments.filter((payment) => Number(payment.amount) === target.total && payment.payment_date === placeholderDate);
  const housePayment = contractPayments.find((payment) => payment.receipt_no === houseRef) ?? (fallbackHousePayments.length === 1 ? fallbackHousePayments[0] : null);
  if (!housePayment) throw new Error(`${target.unitNo} 未找到可拆分的原房款记录。`);

  await checked(
    supabase.from("sale_contracts").update({ payment_plan_type: planNote(target) }).eq("id", contract.id),
    `更新${target.unitNo}合同说明失败`,
  );
  await checked(
    supabase.from("payments").update({
      customer_id: contract.customer_id,
      unit_id: unit.id,
      source_type: "sale_contract",
      source_id: contract.id,
      payment_date: placeholderDate,
      amount: target.house,
      currency: "XOF",
      exchange_rate_to_xof: 1,
      receipt_no: houseRef,
      notes: houseNote(target.unitNo, houseRef),
    }).eq("id", housePayment.id),
    `更新${target.unitNo}房款失败`,
  );

  const houseLedgerData = {
    building_id: building.id,
    unit_id: unit.id,
    payment_id: housePayment.id,
    entry_date: placeholderDate,
    direction: "income",
    category: "sale",
    amount_xof: target.house,
    amount_cny: null,
    description: `${target.unitNo} 土地款抵房款；已结清；实际日期待补，当前为系统占位日`,
  };
  const houseLedger = ledgers.find((ledger) => ledger.payment_id === housePayment.id);
  if (houseLedger) {
    await checked(supabase.from("ledger_entries").update(houseLedgerData).eq("id", houseLedger.id), `更新${target.unitNo}房款流水失败`);
  } else {
    await checked(supabase.from("ledger_entries").insert(houseLedgerData), `创建${target.unitNo}房款流水失败`);
  }

  let parkingPayment = contractPayments.find((payment) => payment.receipt_no === parkingRef);
  const parkingPaymentData = {
    customer_id: contract.customer_id,
    unit_id: unit.id,
    source_type: "sale_contract",
    source_id: contract.id,
    payment_date: placeholderDate,
    amount: target.parking,
    currency: "XOF",
    exchange_rate_to_xof: 1,
    receipt_no: parkingRef,
    notes: parkingNote(target.unitNo, parkingRef),
  };
  if (parkingPayment) {
    await checked(supabase.from("payments").update(parkingPaymentData).eq("id", parkingPayment.id), `更新${target.unitNo}车位款失败`);
  } else {
    parkingPayment = await checked(supabase.from("payments").insert(parkingPaymentData).select("id").single(), `创建${target.unitNo}车位款失败`);
  }

  const parkingLedgerData = {
    building_id: building.id,
    unit_id: unit.id,
    payment_id: parkingPayment.id,
    entry_date: placeholderDate,
    direction: "income",
    category: "sale",
    amount_xof: target.parking,
    amount_cny: null,
    description: `${target.unitNo} 车位款；土地款抵款；已结清；实际日期待补，当前为系统占位日`,
  };
  const parkingLedger = ledgers.find((ledger) => ledger.payment_id === parkingPayment.id);
  if (parkingLedger) {
    await checked(supabase.from("ledger_entries").update(parkingLedgerData).eq("id", parkingLedger.id), `更新${target.unitNo}车位款流水失败`);
  } else {
    await checked(supabase.from("ledger_entries").insert(parkingLedgerData), `创建${target.unitNo}车位款流水失败`);
  }

  await checked(
    supabase.from("receivables").update({
      paid_amount_xof: target.total,
      status: "paid",
      notes: `import_ref=WB7-SALE-RECV-${target.unitNo}；来源：${source}；${planNote(target)}`,
    }).eq("source_type", "sale_contract").eq("source_id", contract.id).eq("category", "sale_lump_sum"),
    `更新${target.unitNo}应收说明失败`,
  );
  await checked(
    supabase.from("audit_logs").insert({
      action: "reconcile_sale_parking_split",
      entity_type: "sale_contract",
      entity_id: contract.id,
      metadata: {
        building: "SACSI7",
        unit_no: target.unitNo,
        before: { combined_payment_xof: target.total },
        after: { house_payment_xof: target.house, parking_payment_xof: target.parking, total_xof: target.total },
        date_note: "实际日期待补，2026-01-01为系统占位日",
      },
    }),
    `写入${target.unitNo}审计记录失败`,
  );
}

console.log("201、203、205 房款与车位款已完成拆分。");
