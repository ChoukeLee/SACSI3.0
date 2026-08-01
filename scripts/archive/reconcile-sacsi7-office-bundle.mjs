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

const unitNumbers = ["1101", "1102", "1103", "1104", "1105", "1106", "1201", "1202", "1203", "1204", "1205", "1206"];
const contractNo = "WB-LEASE-SACSI7-11-12F-20250901";
const bundleLabel = "11-12\u5c42\u529e\u516c\u5ba4\u6574\u79df";
const coverageNote = `${bundleLabel}\uff1b\u4e3b\u5408\u540c${contractNo}\uff1b\u8d22\u52a1\u7edf\u4e00\u5728\u4e3b\u5408\u540c\u7edf\u8ba1\uff0c\u4e0d\u6309\u623f\u95f4\u91cd\u590d\u5206\u644a\u3002`;

const building = await checked(
  supabase.from("buildings").select("id").eq("code", "SACSI7").single(),
  "load building",
);
const units = await checked(
  supabase.from("units").select("id, unit_no").eq("building_id", building.id).in("unit_no", unitNumbers),
  "load units",
);
if (units.length !== unitNumbers.length) throw new Error(`Expected 12 units, got ${units.length}`);

const anchor = units.find((unit) => unit.unit_no === "1101");
const contract = await checked(
  supabase.from("lease_contracts").select("id").eq("unit_id", anchor.id).eq("status", "active").single(),
  "load master lease",
);

await checked(
  supabase.from("lease_contracts").update({ contract_no: contractNo, status: "active" }).eq("id", contract.id),
  "update master lease",
);

for (const unit of units) {
  await checked(
    supabase.from("units").update({ status: "leased", notes: coverageNote }).eq("id", unit.id),
    `update unit ${unit.unit_no}`,
  );
}

const payments = await checked(
  supabase.from("payments").select("id, source_type, payment_date, notes").eq("source_id", contract.id),
  "load payments",
);
for (const payment of payments) {
  const kind = payment.source_type === "lease_deposit" ? "\u6574\u79df\u62bc\u91d1" : "\u6574\u79df\u79df\u91d1";
  const suffix = payment.notes?.split("\uff1b").filter((part) => part.includes("\u5df2\u7f34\u81f3") || part.includes("\u79df\u91d1") || part.includes("\u62bc\u91d1")) ?? [];
  const notes = [`${bundleLabel}${kind}`, ...suffix].join("\uff1b");
  await checked(supabase.from("payments").update({ notes }).eq("id", payment.id), `update payment ${payment.id}`);
}

const receivables = await checked(
  supabase.from("receivables").select("id, category, due_date, status, notes").eq("source_id", contract.id),
  "load receivables",
);
for (const receivable of receivables) {
  const title = receivable.category === "lease_deposit"
    ? `${bundleLabel} \u62bc\u91d1`
    : receivable.status === "overdue"
      ? `${bundleLabel} \u5df2\u5230\u671f\u672a\u7f34\u79df\u91d1`
      : `${bundleLabel} \u5386\u53f2\u79df\u91d1`;
  const continuation = receivable.notes?.includes("\u5df2\u7f34\u81f3") ? receivable.notes.match(/\u5df2\u7f34\u81f3[^\uff1b]*/)?.[0] : null;
  const notes = [coverageNote, continuation, receivable.status === "overdue" ? "\u5408\u540c\u5230\u671f\u540e\u4ecd\u7ee7\u7eed\u5728\u79df\uff0c\u7eed\u671f\u622a\u6b62\u65e5\u5f85\u8865" : null].filter(Boolean).join("\uff1b");
  await checked(supabase.from("receivables").update({ title, notes }).eq("id", receivable.id), `update receivable ${receivable.id}`);
}

const paymentIds = payments.map((payment) => payment.id);
const ledger = await checked(
  supabase.from("ledger_entries").select("id, category, amount_xof").in("payment_id", paymentIds),
  "load ledger",
);
for (const entry of ledger) {
  const kind = entry.category === "lease_deposit" ? "\u6574\u79df\u62bc\u91d1" : "\u6574\u79df\u79df\u91d1";
  await checked(
    supabase.from("ledger_entries").update({ description: `${bundleLabel}${kind}` }).eq("id", entry.id),
    `update ledger ${entry.id}`,
  );
}

await checked(
  supabase.from("audit_logs").insert({
    action: "reconcile_office_bundle_lease",
    entity_type: "lease_contract",
    entity_id: contract.id,
    metadata: {
      building_code: "SACSI7",
      contract_no: contractNo,
      covered_units: unitNumbers,
      finance_counted_once: true,
      active_after_original_end: true,
      renewal_end_date_pending: true,
    },
  }),
  "write audit log",
);

console.log(JSON.stringify({ ok: true, contractNo, coveredUnits: unitNumbers, paymentCount: payments.length, receivableCount: receivables.length }));
