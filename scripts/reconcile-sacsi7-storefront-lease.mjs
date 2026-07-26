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

const customerName = "\u5929\u903b\u79d1\u6280";
const contractNo = "WB-LEASE-SACSI7-STOREFRONT-20250915";
const sourceNote = "\u6765\u6e90\uff1a7\u53f7\u516c\u5bd3.xlsx Sheet1 A1:J100\uff1b\u95e8\u9762\u623f\u5386\u53f2\u79df\u6237\uff1b\u4e0e11#801\u7684\u201c\u5929\u903b\u51fa\u79df\u201d\u5206\u5f00\u5efa\u6863";

const storefront = await checked(
  supabase.from("units").select("id, building_id").eq("code", "SACSI7-STOREFRONT").single(),
  "load storefront",
);
const lease = await checked(
  supabase.from("lease_contracts").select("id, customer_id").eq("unit_id", storefront.id).single(),
  "load storefront lease",
);

let customer = await checked(
  supabase.from("customers").select("id").eq("name", customerName).limit(1),
  "find customer",
);
if (customer.length === 0) {
  customer = [await checked(
    supabase.from("customers").insert({ name: customerName, notes: sourceNote }).select("id").single(),
    "create customer",
  )];
}

await checked(
  supabase.from("lease_contracts").update({
    customer_id: customer[0].id,
    contract_no: contractNo,
    signer_name: customerName,
    monthly_rent_xof: 1_200_000,
    deposit_amount_xof: 2_400_000,
    deposit_received: false,
    start_date: "2025-09-15",
    expected_end_date: "2026-03-14",
    actual_end_date: "2026-03-14",
    status: "terminated",
  }).eq("id", lease.id),
  "update storefront lease",
);

await checked(
  supabase.from("units").update({
    status: "available",
    notes: "\u539f\u79df\u6237\uff1a\u5929\u903b\u79d1\u6280\uff1b\u79df\u671f2025-09-15\u81f32026-03-14\uff1b\u53ea\u5f00\u7968\u3001\u672a\u4ed8\u6b3e\u8d70\u8d26\uff1b\u5f53\u524d\u7a7a\u95f2\uff1b\u6708\u79df120\u4e07XOF\u3002\u6765\u6e90\uff1a7\u53f7\u516c\u5bd3.xlsx Sheet1 A1:J100",
  }).eq("id", storefront.id),
  "update storefront status",
);

await checked(
  supabase.from("audit_logs").insert({
    action: "reconcile_storefront_lease",
    entity_type: "lease_contract",
    entity_id: lease.id,
    metadata: {
      building_code: "SACSI7",
      contract_no: contractNo,
      customer_name: customerName,
      previous_customer_id: lease.customer_id,
      no_cash_payment: true,
      current_unit_status: "available",
    },
  }),
  "write audit log",
);

console.log(JSON.stringify({ ok: true, contractNo, customerId: customer[0].id }));
