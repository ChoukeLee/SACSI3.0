import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = Object.fromEntries(
  fs.readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => {
      const separator = line.indexOf("=");
      return [line.slice(0, separator), line.slice(separator + 1)];
    }),
);

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

async function checked(query, label) {
  const { data, error } = await query;
  if (error) throw new Error(`${label}: ${error.message}`);
  return data;
}

const building = await checked(
  supabase.from("buildings").select("id").eq("code", "SACSI6").single(),
  "load building",
);
const units = await checked(
  supabase.from("units").select("id, unit_no").eq("building_id", building.id).in("unit_no", ["301", "302", "303", "304"]),
  "load units",
);
const unitByNo = Object.fromEntries(units.map((unit) => [unit.unit_no, unit]));
const leases = await checked(
  supabase.from("lease_contracts").select("id, unit_id, customer_id, start_date").in("unit_id", units.map((unit) => unit.id)),
  "load leases",
);
const leaseByKey = Object.fromEntries(
  leases.map((lease) => [`${units.find((unit) => unit.id === lease.unit_id)?.unit_no}:${lease.start_date}`, lease]),
);

const contractNumbers = {
  "302:2023-08-04": "WB-LEASE-SACSI6-302-20230804",
  "301:2023-10-05": "WB-LEASE-SACSI6-301-20231005",
  "303:2023-10-27": "WB-LEASE-SACSI6-303-20231027",
  "304:2023-10-27": "WB-LEASE-SACSI6-304-20231027",
  "304:2023-12-21": "WB-LEASE-SACSI6-304-20231221",
  "301:2024-07-30": "WB-LEASE-SACSI6-301-20240730",
  "301:2025-09-01": "WB-LEASE-SACSI6-301-20250901",
  "304:2026-04-01": "WB-LEASE-SACSI6-304-20260401",
};
for (const [key, contractNo] of Object.entries(contractNumbers)) {
  const lease = leaseByKey[key];
  if (!lease) throw new Error(`Missing lease ${key}`);
  await checked(supabase.from("lease_contracts").update({ contract_no: contractNo }).eq("id", lease.id), `update ${key}`);
}

const refundAdjustments = [
  {
    lease: leaseByKey["304:2023-10-27"],
    receipt: "WB6-HIST-304-20231130-OTHERREF",
    amount: 1_778_800,
    note: "304\u8c2d\u604b\u8054\u5408\u9000\u6b3e676\u4e07\u5206\u644a\uff1b\u62bc\u91d1180\u4e07\u53e6\u5217\uff1b\u5176\u4ed6\u9000\u6b3e177.88\u4e07\uff1b\u6309203/304\u6708\u79df80:90\u6bd4\u4f8b\u5206\u644a",
  },
];
refundAdjustments.push({
  lease: await checked(
    supabase.from("lease_contracts").select("id").eq("contract_no", "WB-LEASE-SACSI6-203-20231027").single(),
    "load 203 Tan lease",
  ),
  receipt: "WB6-HIST-203-20231130-OTHERREF",
  amount: 1_581_200,
  note: "203\u8c2d\u604b\u8054\u5408\u9000\u6b3e676\u4e07\u5206\u644a\uff1b\u62bc\u91d1160\u4e07\u53e6\u5217\uff1b\u5176\u4ed6\u9000\u6b3e158.12\u4e07\uff1b\u6309203/304\u6708\u79df80:90\u6bd4\u4f8b\u5206\u644a",
});
for (const adjustment of refundAdjustments) {
  const payment = await checked(
    supabase.from("payments").select("id").eq("source_id", adjustment.lease.id).eq("receipt_no", adjustment.receipt).single(),
    `load ${adjustment.receipt}`,
  );
  await checked(
    supabase.from("payments").update({ amount: adjustment.amount, notes: adjustment.note }).eq("id", payment.id),
    `update ${adjustment.receipt}`,
  );
  await checked(
    supabase.from("ledger_entries").update({ amount_xof: adjustment.amount, description: adjustment.note }).eq("payment_id", payment.id),
    `update ledger ${adjustment.receipt}`,
  );
}

async function splitArrears({ lease, existingAmount, first, second }) {
  const existing = await checked(
    supabase.from("receivables").select("id").eq("source_id", lease.id).eq("category", "lease_rent").eq("amount_xof", existingAmount).neq("status", "paid").single(),
    `load arrears ${existingAmount}`,
  );
  await checked(supabase.from("receivables").update(first).eq("id", existing.id), `update arrears ${first.title}`);
  const secondRows = await checked(
    supabase.from("receivables").select("id").eq("source_id", lease.id).eq("category", "lease_rent").eq("due_date", second.due_date).eq("amount_xof", second.amount_xof).limit(1),
    `find arrears ${second.title}`,
  );
  if (secondRows.length > 0) {
    await checked(supabase.from("receivables").update(second).eq("id", secondRows[0].id), `update arrears ${second.title}`);
  } else {
    await checked(supabase.from("receivables").insert(second), `insert arrears ${second.title}`);
  }
}

const deputyLease = leaseByKey["301:2025-09-01"];
const deputyBase = {
  building_id: building.id,
  unit_id: unitByNo["301"].id,
  customer_id: deputyLease.customer_id,
  source_type: "lease_contract",
  source_id: deputyLease.id,
  category: "lease_rent",
  amount_xof: 2_700_000,
  paid_amount_xof: 0,
  status: "overdue",
  currency: "XOF",
};
await splitArrears({
  lease: deputyLease,
  existingAmount: 5_400_000,
  first: { ...deputyBase, title: "301 2026\u5e744-6\u6708\u79df\u91d1\u6b20\u6b3e", due_date: "2026-04-01", notes: "\u526f\u90e8\u957f\u79df\u7ea6\u7ee7\u7eed\u5728\u79df\uff1b2026\u5e74\u7b2c\u4e8c\u5b63\u5ea6\u79df\u91d13\u4e2a\u6708\uff0c90\u4e07/\u6708" },
  second: { ...deputyBase, title: "301 2026\u5e747-9\u6708\u79df\u91d1\u6b20\u6b3e", due_date: "2026-07-01", notes: "\u526f\u90e8\u957f\u79df\u7ea6\u7ee7\u7eed\u5728\u79df\uff1b2026\u5e74\u7b2c\u4e09\u5b63\u5ea6\u79df\u91d13\u4e2a\u6708\uff0c90\u4e07/\u6708" },
});

const chengLease = leaseByKey["302:2023-08-04"];
const chengBase = {
  building_id: building.id,
  unit_id: unitByNo["302"].id,
  customer_id: chengLease.customer_id,
  source_type: "lease_contract",
  source_id: chengLease.id,
  category: "lease_rent",
  amount_xof: 2_100_000,
  paid_amount_xof: 0,
  status: "overdue",
  currency: "XOF",
};
await splitArrears({
  lease: chengLease,
  existingAmount: 4_200_000,
  first: { ...chengBase, title: "302 2026\u5e743-5\u6708\u79df\u91d1\u6b20\u6b3e", due_date: "2026-03-01", notes: "\u6210\u5c0f\u9f99\u4ee3\u79df\u7ee7\u7eed\u5728\u79df\uff1b2026\u5e743-5\u6708\u79df\u91d13\u4e2a\u6708\uff0c70\u4e07/\u6708" },
  second: { ...chengBase, title: "302 2026\u5e746-8\u6708\u79df\u91d1\u6b20\u6b3e", due_date: "2026-06-01", notes: "\u6210\u5c0f\u9f99\u4ee3\u79df\u7ee7\u7eed\u5728\u79df\uff1b2026\u5e746-8\u6708\u79df\u91d13\u4e2a\u6708\uff0c70\u4e07/\u6708" },
});

const sale302 = await checked(
  supabase.from("sale_contracts").select("id").eq("unit_id", unitByNo["302"].id).eq("status", "active").single(),
  "load 302 sale",
);
await checked(
  supabase.from("sale_contracts").update({
    contract_no: "WB-SALE-SACSI6-302-20240905",
    agency_commission_amount_xof: 1_350_000,
    agency_commission_paid: true,
    payment_plan_type: "\u5408\u540c\u603b\u989d9000\u4e07\uff1b\u5df2\u65369000\u4e07\uff0c\u5df2\u7ed3\u6e05\uff1b\u51fa\u552e\u4e2d\u4ecb\u8d39135\u4e07\u5df2\u652f\u4ed8\uff1b\u4ee3\u79df\u8d22\u52a1\u53e6\u5217",
  }).eq("id", sale302.id),
  "update 302 sale",
);
const saleAgency = await checked(
  supabase.from("payments").select("id").eq("source_id", sale302.id).eq("receipt_no", "WB6-SALE-302-20240905-AGENTEXP").single(),
  "load 302 sale agency expense",
);
await checked(
  supabase.from("payments").update({ source_type: "sale_agency_expense", notes: "302 COULIBALY\u51fa\u552e\u4e2d\u4ecb\u8d39135\u4e07\uff0c\u5df2\u652f\u4ed8" }).eq("id", saleAgency.id),
  "update 302 sale agency payment",
);
await checked(
  supabase.from("ledger_entries").update({ direction: "expense", category: "sale_agency_expense", description: "302 COULIBALY\u51fa\u552e\u4e2d\u4ecb\u8d39135\u4e07" }).eq("payment_id", saleAgency.id),
  "update 302 sale agency ledger",
);

const yrlibiLease = leaseByKey["304:2023-12-21"];
const yrlibiAgency = await checked(
  supabase.from("payments").select("id").eq("source_id", yrlibiLease.id).eq("receipt_no", "WB6-HIST-304-20231221-AGENT").single(),
  "load YRLIBI agency payment",
);
await checked(
  supabase.from("payments").update({ source_type: "lease_agency_income", notes: "304 YRLIBI\u9996\u6b3e\u4e2d\u7684\u4e2d\u4ecb\u8d39\u6536\u516590\u4e07" }).eq("id", yrlibiAgency.id),
  "update YRLIBI agency payment",
);
await checked(
  supabase.from("ledger_entries").update({ direction: "income", category: "lease_agency_income", description: "304 YRLIBI\u4e2d\u4ecb\u8d39\u6536\u516590\u4e07" }).eq("payment_id", yrlibiAgency.id),
  "update YRLIBI agency ledger",
);

await checked(
  supabase.from("audit_logs").insert({
    action: "reconcile_floor_lease_sale_data",
    entity_type: "building",
    entity_id: building.id,
    metadata: {
      building_code: "SACSI6",
      floor: "3F",
      normalized_lease_contracts: Object.values(contractNumbers),
      unit_203_refund_xof: 3_181_200,
      unit_304_refund_xof: 3_578_800,
      unit_301_active_arrears_xof: 5_400_000,
      unit_302_active_arrears_xof: 4_200_000,
      unit_302_sale_agency_expense_xof: 1_350_000,
      unit_304_agency_income_xof: 900_000,
    },
  }),
  "write audit log",
);

console.log(JSON.stringify({ ok: true, refunds: { unit203: 3_181_200, unit304: 3_578_800 }, activeArrears: { unit301: 5_400_000, unit302: 4_200_000 } }));
