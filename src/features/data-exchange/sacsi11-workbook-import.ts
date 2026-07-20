"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

type UnitInput = { unitNo: string; areaSqm: number; layout: string };
type LeaseInput = {
  unitNo: string; customerName: string; contractNo: string;
  startDate: string; expectedEndDate: string; paymentCycle: string; paymentDay: number;
  monthlyRentXof: number; depositAmountXof: number; depositReceived: boolean;
  signerName: string; status: "active";
};
type SaleInput = {
  unitNo: string; buyerName: string; contractNo: string; signedDate: string;
  paymentPlanType: string; totalAmountXof: number; paidAmountXof: number;
  status: "active" | "draft";
};
type ImportPayload = {
  schemaVersion: number; buildingCode: string; source: string; asOfDate: string;
  preserve: string[]; units: UnitInput[]; leases: LeaseInput[]; sales: SaleInput[];
};

export type Sacsi11ImportResult = {
  success: boolean;
  mode: "preview" | "apply";
  message: string;
  summary: Record<string, number | string>;
};

function parsePayload(payloadText: string): ImportPayload {
  const parsed = JSON.parse(payloadText) as ImportPayload;
  if (parsed.schemaVersion !== 1 || parsed.buildingCode !== "SACSI11") throw new Error("仅支持SACSI11版本1导入数据。");
  if (!Array.isArray(parsed.units) || parsed.units.length !== 72) throw new Error("住宅档案必须为72套。");
  if (!Array.isArray(parsed.leases) || parsed.leases.length !== 30) throw new Error("有效长租合同必须为30份。");
  if (!Array.isArray(parsed.sales) || parsed.sales.length !== 29) throw new Error("销售更新记录必须为29份。");
  const unique = (rows: Array<{ unitNo: string }>) => new Set(rows.map((row) => row.unitNo)).size === rows.length;
  if (!unique(parsed.units) || !unique(parsed.leases) || !unique(parsed.sales)) throw new Error("导入数据存在重复房号。");
  for (const lease of parsed.leases) {
    if (!lease.customerName || !lease.contractNo || lease.monthlyRentXof <= 0 || lease.depositAmountXof < 0) throw new Error(`长租数据不完整：${lease.unitNo}`);
    if (lease.startDate > lease.expectedEndDate) throw new Error(`长租日期倒置：${lease.unitNo}`);
  }
  for (const sale of parsed.sales) {
    if (!sale.buyerName || !sale.contractNo || sale.totalAmountXof <= 0 || sale.paidAmountXof < 0 || sale.paidAmountXof > sale.totalAmountXof) throw new Error(`销售数据不完整：${sale.unitNo}`);
  }
  return parsed;
}

async function loadContext(payload: ImportPayload) {
  const supabase = await createClient();
  const { data: building, error: buildingError } = await supabase.from("buildings").select("id, code").eq("code", payload.buildingCode).single();
  if (buildingError || !building) throw new Error("未找到11号公寓。");
  const { data: units, error: unitsError } = await supabase.from("units").select("id, unit_no, status, kind").eq("building_id", building.id);
  if (unitsError) throw new Error(unitsError.message);
  const apartments = (units ?? []).filter((unit) => unit.kind === "apartment");
  if (apartments.length !== 72) throw new Error(`线上11号楼住宅数量异常：${apartments.length}套。`);
  const unitMap = new Map(apartments.map((unit) => [unit.unit_no, unit]));
  for (const row of payload.units) if (!unitMap.has(row.unitNo)) throw new Error(`线上缺少房源：${row.unitNo}`);
  return { supabase, building, apartments, unitMap };
}

export async function previewSacsi11WorkbookImport(payloadText: string): Promise<Sacsi11ImportResult> {
  await requireRole("admin");
  const payload = parsePayload(payloadText);
  const { supabase, building, apartments } = await loadContext(payload);
  const unitIds = apartments.map((unit) => unit.id);
  const [{ count: activeLeases }, { count: activeSales }, { count: zeroLeaseReceivables }] = await Promise.all([
    supabase.from("lease_contracts").select("id", { count: "exact", head: true }).in("unit_id", unitIds).eq("status", "active"),
    supabase.from("sale_contracts").select("id", { count: "exact", head: true }).in("unit_id", unitIds).eq("status", "active"),
    supabase.from("receivables").select("id", { count: "exact", head: true }).eq("building_id", building.id).eq("source_type", "lease_contract").eq("amount_xof", 0).neq("status", "cancelled"),
  ]);
  return {
    success: true,
    mode: "preview",
    message: "校验通过，可以执行覆盖。日租、保洁、附件及车位不会修改。",
    summary: {
      apartments: apartments.length,
      currentActiveLeases: activeLeases ?? 0,
      targetActiveLeases: payload.leases.length,
      currentActiveSales: activeSales ?? 0,
      salesToUpdate: payload.sales.length,
      zeroLeaseReceivablesToCancel: zeroLeaseReceivables ?? 0,
      monthlyRentXof: payload.leases.reduce((sum, row) => sum + row.monthlyRentXof, 0),
    },
  };
}

export async function applySacsi11WorkbookImport(payloadText: string): Promise<Sacsi11ImportResult> {
  const user = await requireRole("admin");
  const payload = parsePayload(payloadText);
  const { supabase, building, apartments, unitMap } = await loadContext(payload);
  let unitsUpdated = 0;
  let customersCreated = 0;
  let leasesUpdated = 0;
  let leasesCreated = 0;
  let historicalLeasesClosed = 0;
  let salesUpdated = 0;
  let salesCreated = 0;
  let saleReceivablesUpserted = 0;
  let zeroReceivablesCancelled = 0;
  let statusesResolved = 0;

  const customerCache = new Map<string, string>();
  async function getCustomerId(name: string): Promise<string> {
    const cached = customerCache.get(name);
    if (cached) return cached;
    const { data: existing } = await supabase.from("customers").select("id").eq("name", name).limit(1);
    if (existing?.[0]?.id) {
      customerCache.set(name, existing[0].id);
      return existing[0].id;
    }
    const { data: created, error } = await supabase.from("customers").insert({
      name,
      notes: `来源：${payload.source}；整理日期：${payload.asOfDate}`,
    }).select("id").single();
    if (error || !created) throw new Error(`创建客户失败 ${name}: ${error?.message ?? "unknown"}`);
    customersCreated++;
    customerCache.set(name, created.id);
    return created.id;
  }

  for (const row of payload.units) {
    const unit = unitMap.get(row.unitNo)!;
    const { error } = await supabase.from("units").update({ area_sqm: row.areaSqm, layout: row.layout }).eq("id", unit.id);
    if (error) throw new Error(`更新房源${row.unitNo}失败：${error.message}`);
    unitsUpdated++;
  }

  for (const row of payload.leases) {
    const unit = unitMap.get(row.unitNo)!;
    const customerId = await getCustomerId(row.customerName);
    const { data: activeRows } = await supabase.from("lease_contracts").select("id, contract_no, customer_id").eq("unit_id", unit.id).eq("status", "active").limit(1);
    let contractId: string | null = null;
    const active = activeRows?.[0];
    const shouldPreserveOld605 = row.unitNo === "605" && active && active.customer_id !== customerId && active.contract_no !== row.contractNo;
    if (shouldPreserveOld605) {
      const { error } = await supabase.from("lease_contracts").update({ status: "expired", actual_end_date: "2026-05-31" }).eq("id", active.id);
      if (error) throw new Error(`关闭605旧合同失败：${error.message}`);
      historicalLeasesClosed++;
    } else if (active) {
      const { data: updated, error } = await supabase.from("lease_contracts").update({
        customer_id: customerId, contract_no: row.contractNo, start_date: row.startDate,
        expected_end_date: row.expectedEndDate, actual_end_date: null,
        payment_cycle: row.paymentCycle, payment_day: row.paymentDay,
        monthly_rent_xof: row.monthlyRentXof, deposit_amount_xof: row.depositAmountXof,
        deposit_received: row.depositReceived, signer_name: row.signerName, status: "active",
      }).eq("id", active.id).select("id").single();
      if (error || !updated) throw new Error(`更新长租${row.unitNo}失败：${error?.message ?? "unknown"}`);
      contractId = updated.id;
      leasesUpdated++;
    }
    if (!contractId) {
      const { data: byNumber } = await supabase.from("lease_contracts").select("id").eq("contract_no", row.contractNo).limit(1);
      if (byNumber?.[0]?.id) {
        const { data: updated, error } = await supabase.from("lease_contracts").update({
          unit_id: unit.id, customer_id: customerId, start_date: row.startDate,
          expected_end_date: row.expectedEndDate, actual_end_date: null,
          payment_cycle: row.paymentCycle, payment_day: row.paymentDay,
          monthly_rent_xof: row.monthlyRentXof, deposit_amount_xof: row.depositAmountXof,
          deposit_received: row.depositReceived, signer_name: row.signerName, status: "active",
        }).eq("id", byNumber[0].id).select("id").single();
        if (error || !updated) throw new Error(`恢复长租${row.unitNo}失败：${error?.message ?? "unknown"}`);
        contractId = updated.id;
        leasesUpdated++;
      } else {
        const { data: created, error } = await supabase.from("lease_contracts").insert({
          unit_id: unit.id, customer_id: customerId, contract_no: row.contractNo,
          start_date: row.startDate, expected_end_date: row.expectedEndDate,
          payment_cycle: row.paymentCycle, payment_day: row.paymentDay,
          monthly_rent_xof: row.monthlyRentXof, deposit_amount_xof: row.depositAmountXof,
          deposit_received: row.depositReceived, rent_free_days: 0,
          signer_name: row.signerName, status: "active",
        }).select("id").single();
        if (error || !created) throw new Error(`创建长租${row.unitNo}失败：${error?.message ?? "unknown"}`);
        contractId = created.id;
        leasesCreated++;
      }
    }
    const { count, error: cancelError } = await supabase.from("receivables").update({ status: "cancelled", notes: "11号公寓Excel覆盖：取消历史零金额占位应收" }, { count: "exact" }).eq("source_type", "lease_contract").eq("source_id", contractId).eq("amount_xof", 0).neq("status", "cancelled");
    if (cancelError) throw new Error(`清理${row.unitNo}占位应收失败：${cancelError.message}`);
    zeroReceivablesCancelled += count ?? 0;
    const { error: flagError } = await supabase.from("unit_business_flags").upsert({ unit_id: unit.id, business_type: "long_lease", is_enabled: true, default_price_xof: row.monthlyRentXof }, { onConflict: "unit_id,business_type" });
    if (flagError) throw new Error(`更新${row.unitNo}长租价格失败：${flagError.message}`);
  }

  // Cancel any remaining zero-value placeholder lease receivables in SACSI11.
  const { count: remainingCancelled, error: remainingCancelError } = await supabase.from("receivables").update({ status: "cancelled", notes: "11号公寓Excel覆盖：取消历史零金额占位应收" }, { count: "exact" }).eq("building_id", building.id).eq("source_type", "lease_contract").eq("amount_xof", 0).neq("status", "cancelled");
  if (remainingCancelError) throw new Error(`清理零金额应收失败：${remainingCancelError.message}`);
  zeroReceivablesCancelled += remainingCancelled ?? 0;

  for (const row of payload.sales) {
    const unit = unitMap.get(row.unitNo)!;
    const customerId = await getCustomerId(row.buyerName);
    let contractId: string | null = null;
    if (row.status === "active") {
      const { data: activeRows } = await supabase.from("sale_contracts").select("id").eq("unit_id", unit.id).eq("status", "active").limit(1);
      if (activeRows?.[0]?.id) {
        const { data: updated, error } = await supabase.from("sale_contracts").update({
          customer_id: customerId, contract_no: row.contractNo, signed_date: row.signedDate,
          payment_plan_type: row.paymentPlanType, total_amount_xof: row.totalAmountXof, status: row.status,
        }).eq("id", activeRows[0].id).select("id").single();
        if (error || !updated) throw new Error(`更新销售${row.unitNo}失败：${error?.message ?? "unknown"}`);
        contractId = updated.id;
        salesUpdated++;
      }
    }
    if (!contractId) {
      const { data: byNumber } = await supabase.from("sale_contracts").select("id").eq("contract_no", row.contractNo).limit(1);
      if (byNumber?.[0]?.id) {
        const { data: updated, error } = await supabase.from("sale_contracts").update({
          unit_id: unit.id, customer_id: customerId, signed_date: row.signedDate,
          payment_plan_type: row.paymentPlanType, total_amount_xof: row.totalAmountXof, status: row.status,
        }).eq("id", byNumber[0].id).select("id").single();
        if (error || !updated) throw new Error(`更新销售${row.unitNo}失败：${error?.message ?? "unknown"}`);
        contractId = updated.id;
        salesUpdated++;
      } else {
        const { data: created, error } = await supabase.from("sale_contracts").insert({
          unit_id: unit.id, customer_id: customerId, contract_no: row.contractNo,
          signed_date: row.signedDate, transfer_status: "not_started",
          payment_plan_type: row.paymentPlanType, total_amount_xof: row.totalAmountXof,
          status: row.status,
        }).select("id").single();
        if (error || !created) throw new Error(`创建销售${row.unitNo}失败：${error?.message ?? "unknown"}`);
        contractId = created.id;
        salesCreated++;
      }
    }
    const receivableStatus = row.paidAmountXof >= row.totalAmountXof ? "paid" : row.paidAmountXof > 0 ? "partial" : "pending";
    const { data: existingReceivable } = await supabase.from("receivables").select("id").eq("source_type", "sale_contract").eq("source_id", contractId).eq("category", "sale_lump_sum").limit(1);
    const receivableData = {
      building_id: building.id, unit_id: unit.id, customer_id: customerId,
      source_type: "sale_contract", source_id: contractId, category: "sale_lump_sum",
      title: `销售合同 ${row.unitNo} 累计应收`, due_date: row.signedDate,
      amount_xof: row.totalAmountXof, paid_amount_xof: row.paidAmountXof,
      status: receivableStatus, currency: "XOF", notes: `来源：${payload.source}；按表格累计金额登记，车位及含混费用未导入。`,
    };
    const recError = existingReceivable?.[0]?.id
      ? (await supabase.from("receivables").update(receivableData).eq("id", existingReceivable[0].id)).error
      : (await supabase.from("receivables").insert(receivableData)).error;
    if (recError) throw new Error(`更新销售应收${row.unitNo}失败：${recError.message}`);
    saleReceivablesUpserted++;
  }

  // Recompute unit status from active sales, active leases and preserved daily/cleaning operations.
  for (const unit of apartments) {
    const { data: resolved, error: resolveError } = await supabase.rpc("daily_resolve_unit_status", { p_unit_id: unit.id });
    if (resolveError) throw new Error(`重算房态${unit.unit_no}失败：${resolveError.message}`);
    const { error: statusError } = await supabase.from("units").update({ status: resolved }).eq("id", unit.id);
    if (statusError) throw new Error(`写入房态${unit.unit_no}失败：${statusError.message}`);
    statusesResolved++;
  }

  const summary = {
    unitsUpdated, customersCreated, leasesUpdated, leasesCreated, historicalLeasesClosed,
    salesUpdated, salesCreated, saleReceivablesUpserted, zeroReceivablesCancelled,
    statusesResolved, monthlyRentXof: payload.leases.reduce((sum, row) => sum + row.monthlyRentXof, 0),
  };
  await supabase.from("audit_logs").insert({
    actor_id: user.id, actor_email: user.email ?? null, actor_role: user.role,
    action: "sacsi11_workbook_cover", entity_type: "building", entity_id: building.id,
    entity_label: "11号公寓Excel覆盖", metadata: { source: payload.source, as_of_date: payload.asOfDate, ...summary },
  });
  revalidatePath("/units"); revalidatePath("/leases"); revalidatePath("/sales"); revalidatePath("/finance"); revalidatePath("/management");
  return { success: true, mode: "apply", message: "11号公寓数据覆盖完成。", summary };
}
