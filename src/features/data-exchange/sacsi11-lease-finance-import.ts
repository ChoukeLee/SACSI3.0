"use server";

import { revalidatePath } from "next/cache";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

type AllocationInput = {
  category: "lease_rent" | "lease_deposit";
  paymentDate: string;
  amountXof: number;
  receiptNo: string;
  legacyReceiptNo?: string | null;
  method: "cheque" | "cash" | "unknown";
  paidThrough?: string | null;
  sourceSummary: string;
};
type LeaseFinanceInput = { unitNo: string; allocations: AllocationInput[] };
type FinancePayload = {
  schemaVersion: number;
  buildingCode: string;
  source: string;
  asOfDate: string;
  scope: string;
  disableDailyRentalUnits: string[];
  furnishedVacantUnits: Array<{ unitNo: string; monthlyReferenceXof: number }>;
  leases: LeaseFinanceInput[];
  excluded: string[];
};

export type Sacsi11LeaseFinanceResult = {
  success: boolean;
  mode: "preview" | "apply";
  message: string;
  summary: Record<string, number | string | boolean>;
};

function parsePayload(payloadText: string): FinancePayload {
  const payload = JSON.parse(payloadText) as FinancePayload;
  if (payload.schemaVersion !== 1 || payload.buildingCode !== "SACSI11") throw new Error("仅支持SACSI11长租财务版本1。");
  if (payload.scope !== "current_active_long_leases_only") throw new Error("导入范围必须仅限当前有效长租。");
  if (!Array.isArray(payload.leases) || payload.leases.length !== 30) throw new Error("必须包含30份有效长租。");
  if (new Set(payload.leases.map((row) => row.unitNo)).size !== 30) throw new Error("长租房号存在重复。");
  const allocations = payload.leases.flatMap((row) => row.allocations);
  if (allocations.length === 0 || new Set(allocations.map((row) => row.receiptNo)).size !== allocations.length) throw new Error("收款编号为空或重复。");
  for (const row of allocations) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(row.paymentDate) || row.amountXof <= 0) throw new Error(`收款数据无效：${row.receiptNo}`);
    if (!row.sourceSummary || !["lease_rent", "lease_deposit"].includes(row.category)) throw new Error(`收款分类无效：${row.receiptNo}`);
  }
  return payload;
}

async function loadFinanceContext(payload: FinancePayload) {
  const supabase = await createClient();
  const { data: building, error: buildingError } = await supabase.from("buildings").select("id, code").eq("code", payload.buildingCode).single();
  if (buildingError || !building) throw new Error("未找到11号公寓。");
  const { data: units, error: unitsError } = await supabase.from("units").select("id, unit_no, kind").eq("building_id", building.id).eq("kind", "apartment");
  if (unitsError || !units || units.length !== 72) throw new Error(`线上住宅数量异常：${units?.length ?? 0}套。`);
  const unitMap = new Map(units.map((row) => [row.unit_no, row]));
  const unitIds = units.map((row) => row.id);
  const { data: contracts, error: contractsError } = await supabase.from("lease_contracts").select("id, unit_id, customer_id, contract_no, monthly_rent_xof, deposit_amount_xof").in("unit_id", unitIds).eq("status", "active");
  if (contractsError || !contracts) throw new Error(contractsError?.message ?? "读取有效合同失败。");
  const contractByUnitId = new Map(contracts.map((row) => [row.unit_id, row]));
  const contractMap = new Map<string, (typeof contracts)[number]>();
  for (const row of payload.leases) {
    const unit = unitMap.get(row.unitNo);
    const contract = unit ? contractByUnitId.get(unit.id) : null;
    if (!unit || !contract) throw new Error(`线上缺少有效长租：${row.unitNo}`);
    contractMap.set(row.unitNo, contract);
  }
  if (contractMap.size !== 30) throw new Error(`有效长租匹配数量异常：${contractMap.size}。`);
  return { supabase, building, unitMap, contractMap };
}

function allocationNote(payload: FinancePayload, unitNo: string, row: AllocationInput) {
  const method = row.method === "cheque" ? "支票" : row.method === "cash" ? "现金" : "方式待补";
  const paidThrough = row.paidThrough ? `；已缴至${row.paidThrough}` : "";
  return `import_ref=${row.receiptNo}；来源：${payload.source}；${method}${paidThrough}；${row.sourceSummary}`;
}

function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createAdminClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

export async function previewSacsi11LeaseFinanceImport(payloadText: string): Promise<Sacsi11LeaseFinanceResult> {
  await requireRole("admin");
  const payload = parsePayload(payloadText);
  const { supabase, unitMap } = await loadFinanceContext(payload);
  const allocations = payload.leases.flatMap((lease) => lease.allocations);
  const receiptNos = allocations.map((row) => row.receiptNo);
  const legacyNos = allocations.map((row) => row.legacyReceiptNo).filter((value): value is string => !!value);
  const [{ data: existing }, { data: legacy }, { data: flag }] = await Promise.all([
    supabase.from("payments").select("receipt_no").in("receipt_no", receiptNos),
    legacyNos.length ? supabase.from("payments").select("receipt_no").in("receipt_no", legacyNos) : Promise.resolve({ data: [] }),
    supabase.from("unit_business_flags").select("is_enabled").eq("unit_id", unitMap.get("503")!.id).eq("business_type", "daily_rental").maybeSingle(),
  ]);
  return {
    success: true,
    mode: "preview",
    message: "校验通过：仅写入30份当前有效长租的明确租金与押金；不导入销售、日租、中介、物业、家具及退款。",
    summary: {
      activeLeases: payload.leases.length,
      allocations: allocations.length,
      depositXof: allocations.filter((row) => row.category === "lease_deposit").reduce((sum, row) => sum + row.amountXof, 0),
      rentXof: allocations.filter((row) => row.category === "lease_rent").reduce((sum, row) => sum + row.amountXof, 0),
      alreadyImported: existing?.length ?? 0,
      legacyPaymentsToReconcile: legacy?.length ?? 0,
      excludedCategories: payload.excluded.length,
      unit503DailyRentalCurrentlyEnabled: flag?.is_enabled ?? false,
      unit503FurnishedReferenceXof: payload.furnishedVacantUnits.find((row) => row.unitNo === "503")?.monthlyReferenceXof ?? 0,
    },
  };
}

export async function applySacsi11LeaseFinanceImport(payloadText: string): Promise<Sacsi11LeaseFinanceResult> {
  const user = await requireRole("admin");
  const payload = parsePayload(payloadText);
  const { supabase, building, unitMap, contractMap } = await loadFinanceContext(payload);
  const flattened = payload.leases.flatMap((lease) => lease.allocations.map((allocation) => ({ lease, allocation })));
  const receiptNos = flattened.map(({ allocation }) => allocation.receiptNo);
  const legacyNos = flattened.map(({ allocation }) => allocation.legacyReceiptNo).filter((value): value is string => !!value);
  const allLookupNos = [...new Set([...receiptNos, ...legacyNos])];

  const { data: paymentRows, error: paymentReadError } = await supabase.from("payments").select("id, receipt_no").in("receipt_no", allLookupNos);
  if (paymentReadError) throw new Error(`读取历史收款失败：${paymentReadError.message}`);
  const paymentByReceipt = new Map((paymentRows ?? []).map((row) => [row.receipt_no ?? "", row]));
  const paymentIdByReceipt = new Map<string, string>();
  const paymentInserts: Record<string, unknown>[] = [];
  const paymentUpdates: Array<{ id: string; data: Record<string, unknown>; finalReceiptNo: string }> = [];

  for (const { lease, allocation } of flattened) {
    const unit = unitMap.get(lease.unitNo)!;
    const contract = contractMap.get(lease.unitNo)!;
    const note = allocationNote(payload, lease.unitNo, allocation);
    const data = {
      customer_id: contract.customer_id,
      unit_id: unit.id,
      source_type: allocation.category === "lease_deposit" ? "lease_deposit" : "lease_contract",
      source_id: contract.id,
      payment_date: allocation.paymentDate,
      amount: allocation.amountXof,
      currency: "XOF",
      exchange_rate_to_xof: 1,
      receipt_no: allocation.receiptNo,
      notes: note,
    };
    const existing = paymentByReceipt.get(allocation.receiptNo) ?? (allocation.legacyReceiptNo ? paymentByReceipt.get(allocation.legacyReceiptNo) : undefined);
    if (existing) {
      paymentUpdates.push({ id: existing.id, data, finalReceiptNo: allocation.receiptNo });
      paymentIdByReceipt.set(allocation.receiptNo, existing.id);
    } else {
      paymentInserts.push(data);
    }
  }

  for (const row of paymentUpdates) {
    const { error } = await supabase.from("payments").update(row.data).eq("id", row.id);
    if (error) throw new Error(`更新收款${row.finalReceiptNo}失败：${error.message}`);
  }
  if (paymentInserts.length) {
    const { data: inserted, error } = await supabase.from("payments").insert(paymentInserts).select("id, receipt_no");
    if (error) throw new Error(`批量创建收款失败：${error.message}`);
    for (const row of inserted ?? []) if (row.receipt_no) paymentIdByReceipt.set(row.receipt_no, row.id);
  }

  const contractIds = [...new Set([...contractMap.values()].map((row) => row.id))];
  const { data: existingReceivables, error: receivableReadError } = await supabase.from("receivables").select("id, source_id, category, amount_xof, paid_amount_xof, notes").in("source_id", contractIds).in("category", ["lease_rent", "lease_deposit"]).neq("status", "cancelled");
  if (receivableReadError) throw new Error(`读取应收失败：${receivableReadError.message}`);
  const receivableByImportRef = new Map<string, (typeof existingReceivables)[number]>();
  for (const row of existingReceivables ?? []) {
    const match = row.notes?.match(/import_ref=([^；;]+)/);
    if (match) receivableByImportRef.set(match[1], row);
  }
  const claimedLegacyReceivables = new Set<string>();
  const receivableInserts: Record<string, unknown>[] = [];
  const receivableUpdates: Array<{ id: string; data: Record<string, unknown> }> = [];

  for (const { lease, allocation } of flattened) {
    const unit = unitMap.get(lease.unitNo)!;
    const contract = contractMap.get(lease.unitNo)!;
    const note = allocationNote(payload, lease.unitNo, allocation);
    const title = allocation.category === "lease_deposit"
      ? `历史押金 ${lease.unitNo}`
      : `历史租金 ${lease.unitNo}${allocation.paidThrough ? ` 已缴至${allocation.paidThrough}` : ""}`;
    const data = {
      building_id: building.id,
      unit_id: unit.id,
      customer_id: contract.customer_id,
      source_type: "lease_contract",
      source_id: contract.id,
      category: allocation.category,
      title,
      due_date: allocation.paymentDate,
      amount_xof: allocation.amountXof,
      paid_amount_xof: allocation.amountXof,
      status: "paid",
      currency: "XOF",
      notes: note,
    };
    let existing = receivableByImportRef.get(allocation.receiptNo);
    if (!existing && allocation.legacyReceiptNo) {
      existing = (existingReceivables ?? []).find((row) => !claimedLegacyReceivables.has(row.id)
        && row.source_id === contract.id && row.category === allocation.category
        && Number(row.amount_xof) === allocation.amountXof && Number(row.paid_amount_xof) === allocation.amountXof);
    }
    if (existing) {
      claimedLegacyReceivables.add(existing.id);
      receivableUpdates.push({ id: existing.id, data });
    } else {
      receivableInserts.push(data);
    }
  }
  for (const row of receivableUpdates) {
    const { error } = await supabase.from("receivables").update(row.data).eq("id", row.id);
    if (error) throw new Error(`更新历史应收失败：${error.message}`);
  }
  if (receivableInserts.length) {
    const { error } = await supabase.from("receivables").insert(receivableInserts);
    if (error) throw new Error(`批量创建历史应收失败：${error.message}`);
  }

  const paymentIds = [...paymentIdByReceipt.values()];
  const { data: existingLedgers, error: ledgerReadError } = await supabase.from("ledger_entries").select("id, payment_id, category").in("payment_id", paymentIds);
  if (ledgerReadError) throw new Error(`读取财务流水失败：${ledgerReadError.message}`);
  const ledgerByPayment = new Map((existingLedgers ?? []).map((row) => [`${row.payment_id}:${row.category}`, row]));
  const ledgerInserts: Record<string, unknown>[] = [];
  const ledgerUpdates: Array<{ id: string; data: Record<string, unknown> }> = [];
  for (const { lease, allocation } of flattened) {
    const unit = unitMap.get(lease.unitNo)!;
    const paymentId = paymentIdByReceipt.get(allocation.receiptNo);
    if (!paymentId) throw new Error(`缺少收款ID：${allocation.receiptNo}`);
    const description = allocation.category === "lease_deposit"
      ? `长租押金 房间${lease.unitNo}；${allocation.sourceSummary}`
      : `长租租金 房间${lease.unitNo}${allocation.paidThrough ? `；已缴至${allocation.paidThrough}` : ""}；${allocation.sourceSummary}`;
    const data = {
      building_id: building.id,
      unit_id: unit.id,
      payment_id: paymentId,
      entry_date: allocation.paymentDate,
      direction: allocation.category === "lease_deposit" ? "liability_in" : "income",
      category: allocation.category,
      amount_xof: allocation.amountXof,
      description,
    };
    const existing = ledgerByPayment.get(`${paymentId}:${allocation.category}`);
    if (existing) ledgerUpdates.push({ id: existing.id, data });
    else ledgerInserts.push(data);
  }
  for (const row of ledgerUpdates) {
    const { error } = await supabase.from("ledger_entries").update(row.data).eq("id", row.id);
    if (error) throw new Error(`更新财务流水失败：${error.message}`);
  }
  if (ledgerInserts.length) {
    const { error } = await supabase.from("ledger_entries").insert(ledgerInserts);
    if (error) throw new Error(`批量创建财务流水失败：${error.message}`);
  }

  const depositContractIds = payload.leases.map((row) => contractMap.get(row.unitNo)!.id);
  const { error: depositStatusError } = await supabase.from("lease_contracts").update({ deposit_received: true }).in("id", depositContractIds);
  if (depositStatusError) throw new Error(`更新押金状态失败：${depositStatusError.message}`);

  const unit503 = unitMap.get("503")!;
  let unit503DailyRentalDisabled = false;
  const { data: regularFlagUpdate } = await supabase.from("unit_business_flags").update({ is_enabled: false }).eq("unit_id", unit503.id).eq("business_type", "daily_rental").select("unit_id");
  unit503DailyRentalDisabled = (regularFlagUpdate?.length ?? 0) > 0;
  if (!unit503DailyRentalDisabled) {
    const service = getServiceClient();
    if (service) {
      const { data: serviceFlagUpdate, error } = await service.from("unit_business_flags").update({ is_enabled: false }).eq("unit_id", unit503.id).eq("business_type", "daily_rental").select("unit_id");
      if (error) throw new Error(`关闭503日租标记失败：${error.message}`);
      unit503DailyRentalDisabled = (serviceFlagUpdate?.length ?? 0) > 0;
    }
  }

  await supabase.from("audit_logs").insert({
    action: "sacsi11_active_lease_finance_import",
    entity_type: "building",
    entity_id: building.id,
    user_id: user.id,
    metadata: {
      source: payload.source,
      active_leases: payload.leases.length,
      allocations: flattened.length,
      payment_inserts: paymentInserts.length,
      payment_updates: paymentUpdates.length,
      unit_503_daily_rental_disabled: unit503DailyRentalDisabled,
      excluded: payload.excluded,
    },
  });

  for (const path of ["/finance", "/fr/finance", "/leases", "/fr/leases", "/units", "/fr/units"]) revalidatePath(path);
  return {
    success: true,
    mode: "apply",
    message: "11号公寓当前有效长租财务明细导入完成。",
    summary: {
      activeLeases: payload.leases.length,
      allocations: flattened.length,
      paymentsCreated: paymentInserts.length,
      paymentsReconciled: paymentUpdates.length,
      receivablesCreated: receivableInserts.length,
      receivablesReconciled: receivableUpdates.length,
      ledgersCreated: ledgerInserts.length,
      ledgersReconciled: ledgerUpdates.length,
      depositXof: flattened.filter(({ allocation }) => allocation.category === "lease_deposit").reduce((sum, { allocation }) => sum + allocation.amountXof, 0),
      rentXof: flattened.filter(({ allocation }) => allocation.category === "lease_rent").reduce((sum, { allocation }) => sum + allocation.amountXof, 0),
      unit503DailyRentalDisabled,
    },
  };
}
