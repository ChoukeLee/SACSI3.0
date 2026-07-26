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
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

async function checked(query, label) {
  const { data, error } = await query;
  if (error) throw new Error(`${label}: ${error.message}`);
  return data;
}

const lease = await checked(
  supabase.from("lease_contracts").select("id, unit_id").eq("contract_no", "WB-LEASE-SACSI6-404-20240705").single(),
  "load Coastwin lease",
);
const otherPayments = await checked(
  supabase.from("payments").select("id").eq("source_id", lease.id).eq("receipt_no", "WB6-LEASE-404-20251226-OTHER-01"),
  "load incorrect other payment",
);
if (otherPayments.length > 0) {
  const ids = otherPayments.map((payment) => payment.id);
  await checked(supabase.from("ledger_entries").delete().in("payment_id", ids), "delete incorrect other ledger");
  await checked(supabase.from("payments").delete().in("id", ids), "delete incorrect other payment");
}
await checked(
  supabase.from("receivables").delete().eq("source_id", lease.id).eq("due_date", "2025-12-26").eq("category", "other").eq("amount_xof", 100_000),
  "delete incorrect other receivable",
);

const rent = await checked(
  supabase.from("payments").select("id").eq("source_id", lease.id).eq("receipt_no", "WB6-LEASE-404-20251226-RENT-16").single(),
  "load Coastwin rent",
);
await checked(
  supabase.from("payments").update({ amount: 2_700_000, notes: "404 Coastwin 2025-12-26\u79df\u91d1270\u4e07\uff0c\u5df2\u7f34\u81f32026-01-04\uff1bExcel\u7684292\u4e07\u7ecf\u7528\u6237\u786e\u8ba4\u4e3a\u7edf\u8ba1\u8f93\u5165\u9519\u8bef\uff0c\u6b63\u786e\u5b9e\u6536\u4e3a282\u4e07" }).eq("id", rent.id),
  "update Coastwin rent",
);
await checked(
  supabase.from("ledger_entries").update({ amount_xof: 2_700_000, description: "404 Coastwin\u79df\u91d1270\u4e07\uff0c\u5df2\u7f34\u81f32026-01-04\uff1b292\u4e07\u4e3aExcel\u8f93\u5165\u9519\u8bef" }).eq("payment_id", rent.id),
  "update Coastwin rent ledger",
);
await checked(
  supabase.from("receivables").update({
    amount_xof: 2_700_000,
    paid_amount_xof: 2_700_000,
    status: "paid",
    notes: "2025-12-26\u6b63\u786e\u5b9e\u6536282\u4e07\uff1a\u79df\u91d1270\u4e07+\u7269\u4e1a\u8d3912\u4e07\uff1bExcel\u7684292\u4e07\u4e3a\u7edf\u8ba1\u8f93\u5165\u9519\u8bef\uff1b\u5df2\u7f34\u81f32026-01-04",
  }).eq("source_id", lease.id).eq("due_date", "2025-12-26").eq("category", "lease_rent"),
  "update Coastwin rent receivable",
);

await checked(
  supabase.from("audit_logs").insert({
    action: "correct_workbook_input_error",
    entity_type: "lease_contract",
    entity_id: lease.id,
    metadata: { building_code: "SACSI6", unit_no: "404", workbook_amount_xof: 2_920_000, corrected_amount_xof: 2_820_000, removed_other_income_xof: 100_000 },
  }),
  "write audit log",
);

console.log(JSON.stringify({ ok: true, unit: "404", correctedTotal: 2_820_000, removedOtherIncome: 100_000 }));
