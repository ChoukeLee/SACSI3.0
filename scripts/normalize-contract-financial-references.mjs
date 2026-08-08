import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

const apply = process.argv.includes("--apply");
const verify = process.argv.includes("--verify");
const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

const UNIT_ALIASES = {
  "大门面房": "STOREFRONT-L",
  "小门面房": "STOREFRONT-S",
  "门面房": "STOREFRONT",
  "大仓库": "WAREHOUSE-LARGE",
  "小车库": "GARAGE-SMALL",
  "车库1": "GARAGE01",
  "6F前楼": "6F-FRONT",
  "8F前楼": "8F-FRONT",
  "顶楼": "ROOFTOP",
};

const LEASE_CODES = {
  lease_rent: "RENT",
  lease_contract: "RENT",
  lease_deposit: "DEP",
  property_fee: "PROP",
  lease_agency_income: "AGI",
  lease_agency_expense: "AGE",
  lease_furniture_income: "FURN",
  lease_deposit_refund: "DEPREF",
  lease_deposit_deduction: "DEDUCT",
  lease_rent_refund: "RENTREF",
  lease_other_income: "OIN",
  lease_other_expense: "OEX",
};

const SALE_CODES = {
  sale: "HOUSE",
  sale_contract: "HOUSE",
  sale_registration_fee: "REGISTRATION",
  parking_fee: "PARKING",
  sale_agency_income: "AGENCY-IN",
  sale_agency_expense: "AGENCY-OUT",
  sale_other_income: "OTHER-IN",
  sale_other_expense: "OTHER-OUT",
  sale_deposit_refund: "DEPREF",
  sale_furniture: "FURNITURE",
  sale_furniture_income: "FURNITURE",
};

const REFERENCE_BUSINESS_CODES = [
  "REGISTRATION", "AGENCY-OUT", "AGENCY-IN", "FURNITURE", "OTHER-OUT", "OTHER-IN",
  "RENTREF", "DEPREF", "DEDUCT", "PARKING", "HOUSE", "FURN", "PROP", "RENT",
  "DEP", "AGI", "AGE", "OIN", "OEX",
];

function token(value) {
  const normalized = String(value ?? "").trim().toUpperCase().replace(/\s+/g, "-");
  return UNIT_ALIASES[normalized] ?? normalized;
}

function compactDate(value) {
  return String(value ?? "").replaceAll("-", "");
}

function buildingPrefix(buildingCode) {
  const match = /^SACSI(.+)$/i.exec(String(buildingCode ?? "").trim());
  return match ? `WB${token(match[1])}` : `WB-${token(buildingCode)}`;
}

function existingBusinessCode(referenceNo) {
  const upper = String(referenceNo ?? "").toUpperCase();
  return REFERENCE_BUSINESS_CODES.find((code) => new RegExp(`-${code}(?:-[0-9]+)?$`).test(upper)) ?? null;
}

async function fetchAll(table, columns) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from(table).select(columns).range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) return rows;
  }
}

function groupBy(rows, keyOf) {
  const groups = new Map();
  for (const row of rows) {
    const key = keyOf(row);
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }
  return groups;
}

async function updateRows(table, rows, valuesOf, concurrency = 16) {
  for (let index = 0; index < rows.length; index += concurrency) {
    const batch = rows.slice(index, index + concurrency);
    await Promise.all(batch.map(async (row) => {
      const { error } = await db.from(table).update(valuesOf(row)).eq("id", row.id);
      if (error) throw new Error(`${table} ${row.id}: ${error.message}`);
    }));
  }
}

async function insertAudits(rows) {
  for (let index = 0; index < rows.length; index += 250) {
    const { error } = await db.from("audit_logs").insert(rows.slice(index, index + 250));
    if (error) throw new Error(`audit_logs: ${error.message}`);
  }
}

function contractMappings(type, rows, unitById, buildingById) {
  const dateKey = type === "LEASE" ? "start_date" : "signed_date";
  const bases = rows.map((row) => {
    const unit = unitById.get(row.unit_id);
    const building = unit ? buildingById.get(unit.building_id) : null;
    if (!unit || !building) throw new Error(`Missing unit/building for ${type} contract ${row.id}`);
    const base = `WB-${type}-${token(building.code)}-${token(unit.unit_no)}-${compactDate(row[dateKey])}`;
    return { ...row, unit, building, base };
  });
  const mappings = [];
  for (const group of groupBy(bases, (row) => row.base).values()) {
    group.sort((left, right) => {
      const exact = Number(right.contract_no === right.base) - Number(left.contract_no === left.base);
      return exact || String(left.created_at).localeCompare(String(right.created_at)) || left.id.localeCompare(right.id);
    });
    group.forEach((row, index) => {
      const target = index === 0 ? row.base : `${row.base}-${String(index + 1).padStart(2, "0")}`;
      if (row.contract_no !== target) mappings.push({ ...row, old: row.contract_no, target, type });
    });
  }
  return mappings;
}

function paymentMappings(rows, unitById, buildingById) {
  const candidates = rows.flatMap((row) => {
    if (!/^WB/i.test(row.receipt_no ?? "")) return [];
    const unit = unitById.get(row.unit_id);
    const building = unit ? buildingById.get(unit.building_id) : null;
    if (!unit || !building) return [];
    if (LEASE_CODES[row.source_type]) {
      const code = existingBusinessCode(row.receipt_no) ?? LEASE_CODES[row.source_type];
      const prefix = `${buildingPrefix(building.code)}-L-${token(unit.unit_no)}-${compactDate(row.payment_date)}-${code}`;
      return [{ ...row, unit, building, prefix, family: "lease", group: prefix }];
    }
    if (SALE_CODES[row.source_type]) {
      const code = existingBusinessCode(row.receipt_no) ?? SALE_CODES[row.source_type];
      const prefix = `${buildingPrefix(building.code)}-SALE-${token(unit.unit_no)}-${compactDate(row.payment_date)}-${code}`;
      return [{ ...row, unit, building, prefix, family: "sale", group: `sale:${row.source_id ?? row.unit_id}` }];
    }
    return [];
  });
  const mappings = [];
  for (const group of groupBy(candidates, (row) => row.group).values()) {
    group.sort((left, right) => String(left.created_at).localeCompare(String(right.created_at)) || left.id.localeCompare(right.id));
    group.forEach((row, index) => {
      const target = `${row.prefix}-${String(index + 1).padStart(2, "0")}`;
      // source_type is business data, not formatting metadata. Legacy rent/sale
      // rows legitimately use lease_contract/sale_contract and existing queries
      // rely on those values, so normalization must not rewrite them.
      const targetSourceType = row.source_type;
      if (row.receipt_no !== target || row.source_type !== targetSourceType) {
        mappings.push({ ...row, old: row.receipt_no, target, targetSourceType });
      }
    });
  }
  return mappings;
}

async function normalizeContracts(mappings, runId) {
  if (!mappings.length) return;
  await insertAudits(mappings.map((row) => ({
    action: "normalize_contract_number",
    entity_type: row.type === "LEASE" ? "lease_contract" : "sale_contract",
    entity_id: row.id,
    metadata: { run_id: runId, old_contract_no: row.old, new_contract_no: row.target },
  })));
  const lease = mappings.filter((row) => row.type === "LEASE");
  const sale = mappings.filter((row) => row.type === "SALE");
  for (const [table, rows] of [["lease_contracts", lease], ["sale_contracts", sale]]) {
    await updateRows(table, rows, (row) => ({ contract_no: `MIG-TMP-${row.id}` }));
    await updateRows(table, rows, (row) => ({ contract_no: row.target }));
  }
  for (const row of mappings) {
    const { data: receivables, error } = await db.from("receivables").select("id,title").eq("source_id", row.id);
    if (error) throw error;
    await updateRows("receivables", (receivables ?? []).filter((item) => item.title?.includes(row.old)), (item) => ({ title: item.title.replaceAll(row.old, row.target) }));
    const { data: payments, error: paymentError } = await db.from("payments").select("id,notes").eq("source_id", row.id);
    if (paymentError) throw paymentError;
    await updateRows("payments", (payments ?? []).filter((item) => item.notes?.includes(row.old)), (item) => ({ notes: item.notes.replaceAll(row.old, row.target) }));
    const paymentIds = (payments ?? []).map((item) => item.id);
    if (paymentIds.length) {
      const { data: ledger, error: ledgerError } = await db.from("ledger_entries").select("id,description").in("payment_id", paymentIds);
      if (ledgerError) throw ledgerError;
      await updateRows("ledger_entries", (ledger ?? []).filter((item) => item.description?.includes(row.old)), (item) => ({ description: item.description.replaceAll(row.old, row.target) }));
    }
    const { data: unit, error: unitError } = await db.from("units").select("id,notes").eq("id", row.unit_id).single();
    if (unitError) throw unitError;
    if (unit?.notes?.includes(row.old)) {
      const { error: updateError } = await db.from("units").update({ notes: unit.notes.replaceAll(row.old, row.target) }).eq("id", unit.id);
      if (updateError) throw updateError;
    }
  }
}

async function normalizePayments(mappings, runId) {
  if (!mappings.length) return;
  await insertAudits(mappings.map((row) => ({
    action: "normalize_financial_reference",
    entity_type: "payment",
    entity_id: row.id,
    metadata: {
      run_id: runId,
      old_reference_no: row.old,
      new_reference_no: row.target,
      old_source_type: row.source_type,
      new_source_type: row.targetSourceType,
    },
  })));
  await updateRows("payments", mappings, (row) => ({ receipt_no: row.target, source_type: row.targetSourceType }));
}

async function repairRecentEntries(runId) {
  const leaseId = "39c5c88b-92db-4acd-b82a-e9ed350dfbff";
  const saleId = "6cdd5ab5-12f9-4c39-b406-331d4fd92091";
  const bookingId = "3b5ab6d8-f72e-4931-9404-80ced00c5027";

  const { data: directPayments, error: directPaymentError } = await db
    .from("payments")
    .select("id,request_id")
    .in("source_id", [leaseId, saleId]);
  if (directPaymentError) throw directPaymentError;
  await updateRows("payments", (directPayments ?? []).filter((row) => !row.request_id), () => ({ request_id: randomUUID() }));

  const { data: schedules, error: scheduleError } = await db.from("sale_payment_schedule").select("id,installment_no").eq("sale_contract_id", saleId);
  if (scheduleError) throw scheduleError;
  if ((schedules ?? []).length === 0) {
    const { error } = await db.from("sale_payment_schedule").insert([
      { sale_contract_id: saleId, installment_no: 1, due_date: "2026-08-06", amount_xof: 30000000, status: "paid" },
      { sale_contract_id: saleId, installment_no: 2, due_date: "2026-08-06", amount_xof: 50000000, status: "paid" },
    ]);
    if (error) throw error;
  }
  const { data: saleReceivables, error: saleReceivableError } = await db
    .from("receivables")
    .select("*")
    .eq("source_id", saleId)
    .eq("category", "sale_installment")
    .order("created_at");
  if (saleReceivableError) throw saleReceivableError;
  if ((saleReceivables ?? []).length === 1 && Number(saleReceivables[0].amount_xof) === 80000000) {
    const first = saleReceivables[0];
    const { error: updateError } = await db.from("receivables").update({
      title: "房款 WB-SALE-SACSI5-1301-20260806 第1期",
      amount_xof: 30000000,
      paid_amount_xof: 30000000,
      status: "paid",
    }).eq("id", first.id);
    if (updateError) throw updateError;
    const { error: insertError } = await db.from("receivables").insert({
      building_id: first.building_id,
      unit_id: first.unit_id,
      customer_id: first.customer_id,
      source_type: first.source_type,
      source_id: first.source_id,
      category: first.category,
      title: "房款 WB-SALE-SACSI5-1301-20260806 第2期",
      due_date: first.due_date,
      amount_xof: 50000000,
      paid_amount_xof: 50000000,
      status: "paid",
      currency: first.currency,
      notes: first.notes,
    });
    if (insertError) throw insertError;
  }

  const { data: typoPayments, error: typoError } = await db
    .from("payments")
    .select("id,amount")
    .eq("source_id", bookingId)
    .eq("amount", 39999);
  if (typoError) throw typoError;
  for (const payment of typoPayments ?? []) {
    const { error: paymentError } = await db.from("payments").update({ amount: 40000 }).eq("id", payment.id);
    if (paymentError) throw paymentError;
    const { error: ledgerError } = await db.from("ledger_entries").update({ amount_xof: 40000 }).eq("payment_id", payment.id);
    if (ledgerError) throw ledgerError;
  }
  const [{ data: bookingPayments, error: bookingPaymentError }, { data: booking, error: bookingError }] = await Promise.all([
    db.from("payments").select("amount").eq("source_id", bookingId).eq("source_type", "daily_booking"),
    db.from("daily_bookings").select("total_amount_xof,final_amount_xof").eq("id", bookingId).single(),
  ]);
  if (bookingPaymentError) throw bookingPaymentError;
  if (bookingError) throw bookingError;
  const paidXof = (bookingPayments ?? []).reduce((sum, row) => sum + Number(row.amount), 0);
  const dueXof = Number(booking.final_amount_xof ?? booking.total_amount_xof);
  const billingStatus = paidXof >= dueXof ? "settled" : paidXof > 0 ? "partially_paid" : "prepaid";
  const { error: bookingUpdateError } = await db.from("daily_bookings")
    .update({ prepaid_amount_xof: paidXof, billing_status: billingStatus })
    .eq("id", bookingId);
  if (bookingUpdateError) throw bookingUpdateError;

  const { data: existingAudit } = await db.from("audit_logs")
    .select("id")
    .eq("action", "reconcile_hermes_temporary_entries")
    .limit(1);
  if (!existingAudit?.length) {
    await insertAudits([
      { action: "reconcile_hermes_temporary_entries", entity_type: "lease_contract", entity_id: leaseId, metadata: { run_id: runId, source: "Hermes temporary registration", result: "contract, payments, receivables and ledger reconciled" } },
      { action: "reconcile_hermes_temporary_entries", entity_type: "sale_contract", entity_id: saleId, metadata: { run_id: runId, source: "Hermes temporary registration", result: "two paid installments and receivables reconciled" } },
      { action: "correct_rounding_difference", entity_type: "daily_booking", entity_id: bookingId, metadata: { run_id: runId, old_paid_xof: 759999, new_paid_xof: 760000 } },
    ]);
  }
}

async function verifyRecentEntries() {
  const leaseId = "39c5c88b-92db-4acd-b82a-e9ed350dfbff";
  const saleId = "6cdd5ab5-12f9-4c39-b406-331d4fd92091";
  const bookingId = "3b5ab6d8-f72e-4931-9404-80ced00c5027";
  const results = await Promise.all([
    db.from("lease_contracts").select("contract_no,paid_through_date").eq("id", leaseId).single(),
    db.from("sale_contracts").select("contract_no,total_amount_xof").eq("id", saleId).single(),
    db.from("sale_payment_schedule").select("installment_no,due_date,amount_xof,status").eq("sale_contract_id", saleId).order("installment_no"),
    db.from("receivables").select("title,amount_xof,paid_amount_xof,status").eq("source_id", saleId).eq("category", "sale_installment").order("amount_xof"),
    db.from("payments").select("amount,receipt_no,request_id").eq("source_id", saleId).order("amount"),
    db.from("daily_bookings").select("total_amount_xof,prepaid_amount_xof,billing_status").eq("id", bookingId).single(),
    db.from("payments").select("amount,receipt_no").eq("source_id", bookingId),
  ]);
  for (const result of results) {
    if (result.error) throw result.error;
  }
  const [lease, sale, schedules, receivables, salePayments, booking, bookingPayments] = results.map((result) => result.data);
  return { lease, sale, schedules, receivables, salePayments, booking, bookingPayments };
}

async function main() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }
  const [buildings, units, leases, sales, payments] = await Promise.all([
    fetchAll("buildings", "id,code"),
    fetchAll("units", "id,building_id,unit_no"),
    fetchAll("lease_contracts", "id,unit_id,contract_no,start_date,status,created_at"),
    fetchAll("sale_contracts", "id,unit_id,contract_no,signed_date,status,created_at"),
    fetchAll("payments", "id,unit_id,source_id,source_type,payment_date,receipt_no,created_at"),
  ]);
  const buildingById = new Map(buildings.map((row) => [row.id, row]));
  const unitById = new Map(units.map((row) => [row.id, row]));
  const contracts = [
    ...contractMappings("LEASE", leases, unitById, buildingById),
    ...contractMappings("SALE", sales, unitById, buildingById),
  ];
  const financialReferences = paymentMappings(payments, unitById, buildingById);
  const contractTargets = contracts.map((row) => `${row.type}:${row.target}`);
  const duplicateContractTargets = contractTargets.filter((target, index) => contractTargets.indexOf(target) !== index);
  const financialTargets = financialReferences.map((row) => row.target);
  const duplicateFinancialTargets = financialTargets.filter((target, index) => financialTargets.indexOf(target) !== index);
  if (duplicateContractTargets.length || duplicateFinancialTargets.length) {
    throw new Error(`Unsafe duplicate targets: contracts=${[...new Set(duplicateContractTargets)].join(",")}; payments=${[...new Set(duplicateFinancialTargets)].join(",")}`);
  }
  const changesByFamily = Object.fromEntries(
    [...groupBy(financialReferences, (row) => `${row.family}:${row.building.code}`).entries()]
      .map(([key, rows]) => [key, rows.length]),
  );
  console.log(JSON.stringify({
    mode: apply ? "apply" : "dry-run",
    contractChanges: contracts.length,
    financialReferenceChanges: financialReferences.length,
    changesByFamily,
    contractExamples: contracts.slice(0, 12).map(({ type, old, target }) => ({ type, old, target })),
    financialExamples: financialReferences.slice(0, 12).map(({ old, target, source_type, targetSourceType }) => ({ old, target, source_type, targetSourceType })),
  }, null, 2));
  if (!apply) {
    if (verify) console.log(JSON.stringify({ verification: await verifyRecentEntries() }, null, 2));
    return;
  }
  const runId = randomUUID();
  await normalizeContracts(contracts, runId);
  await normalizePayments(financialReferences, runId);
  await repairRecentEntries(runId);
  const verification = await verifyRecentEntries();
  console.log(JSON.stringify({ success: true, runId, contractChanges: contracts.length, financialReferenceChanges: financialReferences.length, verification }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
