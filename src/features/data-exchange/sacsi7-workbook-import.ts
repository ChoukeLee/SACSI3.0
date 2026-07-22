"use server";

import { revalidatePath } from "next/cache";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  SACSI7_AS_OF,
  SACSI7_SOURCE,
  SACSI7_STOREFRONT_RENT_XOF,
  sacsi7ExcludedCategories,
  sacsi7Leases,
  sacsi7OverdueRentReceivables,
  sacsi7OwnerOccupiedUnits,
  sacsi7Sales,
  sacsi7TerminatedLeaseUnits,
  type Sacsi7Payment,
} from "./sacsi7-import-data";

export type Sacsi7ImportResult = {
  success: boolean;
  mode: "preview" | "apply";
  message: string;
  summary: Record<string, number | string | boolean>;
};

const storefrontCode = "SACSI7-STOREFRONT";
const storefrontUnitNo = "门面房";

function receiptNo(scope: "L" | "S", unitNo: string, payment: Sacsi7Payment, index: number) {
  const category = payment.kind === "deposit" ? "DEP" : payment.kind === "rent" ? "RENT" : "SALE";
  return `WB7-${scope}-${unitNo}-${payment.date.replaceAll("-", "")}-${category}-${String(index + 1).padStart(2, "0")}`;
}

function paymentNote(unitNo: string, payment: Sacsi7Payment, ref: string) {
  const paidThrough = payment.paidThrough ? `；已缴至${payment.paidThrough}` : "";
  return `import_ref=${ref}；来源：${SACSI7_SOURCE}；房号${unitNo}${paidThrough}；${payment.note}`;
}

function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createAdminClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

function allTargetPayments() {
  return [
    ...sacsi7Leases.flatMap((lease) => lease.payments.map((payment, index) => ({ scope: "L" as const, unitNo: lease.unitNo, payment, ref: receiptNo("L", lease.unitNo, payment, index) }))),
    ...sacsi7Sales.flatMap((sale) => sale.payments.map((payment, index) => ({ scope: "S" as const, unitNo: sale.unitNo, payment, ref: receiptNo("S", sale.unitNo, payment, index) }))),
  ];
}

async function loadContext() {
  const supabase = await createClient();
  const { data: building, error: buildingError } = await supabase.from("buildings").select("id, code").eq("code", "SACSI7").single();
  if (buildingError || !building) throw new Error("未找到7号公寓。");
  const { data: units, error: unitError } = await supabase.from("units").select("id, code, unit_no, kind, status, notes").eq("building_id", building.id);
  if (unitError || !units) throw new Error(unitError?.message ?? "读取7号楼房源失败。");
  const apartmentUnits = units.filter((unit) => unit.kind === "apartment");
  if (apartmentUnits.length !== 72) throw new Error(`7号楼公寓数量异常：${apartmentUnits.length}。`);
  return { supabase, building, units, apartmentUnits };
}

export async function previewSacsi7WorkbookImport(): Promise<Sacsi7ImportResult> {
  await requireRole("admin");
  const { supabase, building, units, apartmentUnits } = await loadContext();
  const unitIds = apartmentUnits.map((unit) => unit.id);
  const targetPayments = allTargetPayments();
  const refs = targetPayments.map((row) => row.ref);
  const [{ data: leases }, { data: sales }, { data: existingPayments }] = await Promise.all([
    supabase.from("lease_contracts").select("id, status").in("unit_id", unitIds),
    supabase.from("sale_contracts").select("id, status").in("unit_id", unitIds),
    supabase.from("payments").select("receipt_no").in("receipt_no", refs),
  ]);
  const xofPayments = targetPayments.filter((row) => (row.payment.currency ?? "XOF") === "XOF");
  const cnyPayments = targetPayments.filter((row) => row.payment.currency === "CNY");
  return {
    success: true,
    mode: "preview",
    message: "校验通过：覆盖7号楼真实合同、明确收款及房态；退款、中介、物业、注册费和无法拆分金额不导入。",
    summary: {
      buildingId: building.id,
      apartmentsOnline: apartmentUnits.length,
      nonResidentialOnline: units.length - apartmentUnits.length,
      existingLeaseContracts: leases?.length ?? 0,
      existingSaleContracts: sales?.length ?? 0,
      targetActiveLeaseContracts: sacsi7Leases.length,
      targetLeasedApartmentUnits: new Set(sacsi7Leases.flatMap((lease) => lease.masterUnits ?? [lease.unitNo])).size,
      targetOwnerOccupiedUnits: sacsi7OwnerOccupiedUnits.length,
      targetSaleContracts: sacsi7Sales.length,
      targetPayments: targetPayments.length,
      alreadyImportedPayments: existingPayments?.length ?? 0,
      xofPaymentTotal: xofPayments.reduce((sum, row) => sum + row.payment.amount, 0),
      cnyPaymentTotal: cnyPayments.reduce((sum, row) => sum + row.payment.amount, 0),
      storefrontWillBeAvailable: true,
      storefrontMonthlyRentXof: SACSI7_STOREFRONT_RENT_XOF,
      excludedCategories: sacsi7ExcludedCategories.length,
    },
  };
}

async function applySacsi7WorkbookImportInternal(): Promise<Sacsi7ImportResult> {
  const user = await requireRole("admin");
  const { supabase, building, units: initialUnits, apartmentUnits } = await loadContext();

  let storefront = initialUnits.find((unit) => unit.code === storefrontCode);
  if (!storefront) {
    const { data, error } = await supabase.from("units").insert({
      building_id: building.id,
      code: storefrontCode,
      unit_no: storefrontUnitNo,
      floor_label: "G",
      kind: "storefront",
      status: "available",
      area_sqm: null,
      layout: "底商门面房",
      furnishing: "none",
      notes: `原租户：天逻科技；已退租；原租期至2026-03-14；当前空闲；暂定月租${SACSI7_STOREFRONT_RENT_XOF} XOF。来源：${SACSI7_SOURCE}`,
    }).select("id, code, unit_no, kind, status, notes").single();
    if (error || !data) throw new Error(`创建7号楼底商失败：${error?.message ?? "无返回数据"}`);
    storefront = data;
  } else {
    const { error } = await supabase.from("units").update({
      status: "available",
      notes: `原租户：天逻科技；已退租；原租期至2026-03-14；当前空闲；暂定月租${SACSI7_STOREFRONT_RENT_XOF} XOF。来源：${SACSI7_SOURCE}`,
    }).eq("id", storefront.id);
    if (error) throw new Error(`更新7号楼底商失败：${error.message}`);
  }
  await supabase.from("unit_business_flags").upsert({ unit_id: storefront.id, business_type: "long_lease", is_enabled: true, default_price_xof: SACSI7_STOREFRONT_RENT_XOF });

  const customerNames = [...new Set([...sacsi7Leases.map((row) => row.customer), ...sacsi7Sales.map((row) => row.customer)])];
  const { data: existingCustomers, error: customerReadError } = await supabase.from("customers").select("id, name").in("name", customerNames);
  if (customerReadError) throw new Error(`读取客户失败：${customerReadError.message}`);
  const customerByName = new Map((existingCustomers ?? []).map((row) => [row.name, row.id]));
  const missingNames = customerNames.filter((name) => !customerByName.has(name));
  if (missingNames.length) {
    const { data: insertedCustomers, error } = await supabase.from("customers").insert(missingNames.map((name) => ({
      name, gender: null, document_type: null, encrypted_document_no: null, phone: null,
      notes: `由${SACSI7_SOURCE}导入，联系方式与证件待补。`, is_blacklisted: false,
      blacklist_reason: null, blacklist_operator_id: null, blacklist_date: null, blacklist_permanent: false,
    }))).select("id, name");
    if (error) throw new Error(`创建客户失败：${error.message}`);
    for (const row of insertedCustomers ?? []) customerByName.set(row.name, row.id);
  }

  const unitMap = new Map(apartmentUnits.map((unit) => [unit.unit_no, unit]));
  const apartmentIds = apartmentUnits.map((unit) => unit.id);
  const [{ data: existingLeases, error: leaseReadError }, { data: existingSales, error: saleReadError }] = await Promise.all([
    supabase.from("lease_contracts").select("id, unit_id, status, start_date, expected_end_date").in("unit_id", apartmentIds),
    supabase.from("sale_contracts").select("id, unit_id, signed_date").in("unit_id", apartmentIds),
  ]);
  if (leaseReadError) throw new Error(`读取长租合同失败：${leaseReadError.message}`);
  if (saleReadError) throw new Error(`读取出售合同失败：${saleReadError.message}`);
  const activeLeaseByUnitId = new Map((existingLeases ?? []).filter((row) => row.status === "active" || row.status === "draft").map((row) => [row.unit_id, row]));
  const saleByUnitId = new Map((existingSales ?? []).map((row) => [row.unit_id, row]));
  const leaseContractByUnitNo = new Map<string, { id: string; customer_id: string }>();
  let leaseCreated = 0;
  let leaseUpdated = 0;
  let leasePlaceholdersDeleted = 0;

  for (const lease of sacsi7Leases) {
    const unit = unitMap.get(lease.unitNo)!;
    const customerId = customerByName.get(lease.customer)!;
    const data = {
      unit_id: unit.id, customer_id: customerId, contract_no: `WB7-LEASE-${lease.unitNo}`,
      start_date: lease.startDate, expected_end_date: lease.expectedEndDate, actual_end_date: null,
      payment_cycle: "monthly", payment_day: Number(lease.startDate.slice(-2)), monthly_rent_xof: lease.monthlyRentXof,
      deposit_amount_xof: lease.depositXof, deposit_received: lease.payments.some((payment) => payment.kind === "deposit"),
      rent_free_days: 0, signer_name: null, attachment_url: null, status: "active",
    };
    const existing = activeLeaseByUnitId.get(unit.id);
    if (existing) {
      const { error } = await supabase.from("lease_contracts").update(data).eq("id", existing.id);
      if (error) throw new Error(`更新${lease.unitNo}长租失败：${error.message}`);
      leaseContractByUnitNo.set(lease.unitNo, { id: existing.id, customer_id: customerId });
      leaseUpdated += 1;
    } else {
      const { data: inserted, error } = await supabase.from("lease_contracts").insert(data).select("id, customer_id").single();
      if (error || !inserted) throw new Error(`创建${lease.unitNo}长租失败：${error?.message ?? "无返回数据"}`);
      leaseContractByUnitNo.set(lease.unitNo, inserted);
      leaseCreated += 1;
    }
  }

  const placeholderUnitIds = sacsi7TerminatedLeaseUnits.map((unitNo) => unitMap.get(unitNo)!.id);
  const placeholderLeaseIds = (existingLeases ?? [])
    .filter((row) => placeholderUnitIds.includes(row.unit_id) && row.status !== "active")
    .map((row) => row.id);
  if (placeholderLeaseIds.length) {
    const cleanupClient = getServiceClient() ?? supabase;
    const { data: placeholderPayments, error: placeholderPaymentReadError } = await cleanupClient
      .from("payments").select("id").in("source_id", placeholderLeaseIds);
    if (placeholderPaymentReadError) throw new Error(`读取占位合同收款失败：${placeholderPaymentReadError.message}`);
    const placeholderPaymentIds = (placeholderPayments ?? []).map((row) => row.id);
    if (placeholderPaymentIds.length) {
      const { error } = await cleanupClient.from("ledger_entries").delete().in("payment_id", placeholderPaymentIds);
      if (error) throw new Error(`删除占位合同流水失败：${error.message}`);
    }
    for (const [table, column] of [["receivables", "source_id"], ["payments", "source_id"], ["lease_contracts", "id"]] as const) {
      const { data: deleted, error } = await cleanupClient.from(table).delete().in(column, placeholderLeaseIds).select("id");
      if (error) throw new Error(`删除占位合同关联数据失败（${table}）：${error.message}`);
      if (table === "lease_contracts") leasePlaceholdersDeleted = deleted?.length ?? 0;
    }
    if (leasePlaceholdersDeleted !== placeholderLeaseIds.length) {
      throw new Error(`占位合同删除不完整：计划${placeholderLeaseIds.length}份，实际${leasePlaceholdersDeleted}份。`);
    }
  }

  const saleContractByUnitNo = new Map<string, { id: string; customer_id: string }>();
  let saleCreated = 0;
  let saleUpdated = 0;
  for (const saleRow of sacsi7Sales) {
    const unit = unitMap.get(saleRow.unitNo)!;
    const customerId = customerByName.get(saleRow.customer)!;
    const existing = saleByUnitId.get(unit.id);
    const data = {
      unit_id: unit.id, customer_id: customerId, contract_no: `WB7-SALE-${saleRow.unitNo}`,
      signed_date: saleRow.signedDate ?? existing?.signed_date ?? SACSI7_AS_OF, transfer_date: null,
      transfer_status: "not_started", title_certificate_no: null, agency_company: null, agent_name: null,
      agency_commission_amount_xof: null, agency_commission_paid: false,
      payment_plan_type: saleRow.planNote ?? "工作簿历史收款明细", total_amount_xof: saleRow.totalAmountXof,
      attachment_url: null, status: "active",
    };
    if (existing) {
      const { error } = await supabase.from("sale_contracts").update(data).eq("id", existing.id);
      if (error) throw new Error(`更新${saleRow.unitNo}出售合同失败：${error.message}`);
      saleContractByUnitNo.set(saleRow.unitNo, { id: existing.id, customer_id: customerId });
      saleUpdated += 1;
    } else {
      const { data: inserted, error } = await supabase.from("sale_contracts").insert(data).select("id, customer_id").single();
      if (error || !inserted) throw new Error(`创建${saleRow.unitNo}出售合同失败：${error?.message ?? "无返回数据"}`);
      saleContractByUnitNo.set(saleRow.unitNo, inserted);
      saleCreated += 1;
    }
  }

  const saleContractIds = [...saleContractByUnitNo.values()].map((row) => row.id);
  const { data: existingSchedules, error: scheduleReadError } = await supabase.from("sale_payment_schedule").select("id, sale_contract_id, installment_no").in("sale_contract_id", saleContractIds);
  if (scheduleReadError) throw new Error(`读取出售付款计划失败：${scheduleReadError.message}`);
  const scheduleByContractId = new Map((existingSchedules ?? []).filter((row) => row.installment_no === 1).map((row) => [row.sale_contract_id, row.id]));
  let saleSchedulesCreated = 0;
  let saleSchedulesUpdated = 0;
  for (const saleRow of sacsi7Sales.filter((row) => row.totalAmountXof > 0)) {
    const contract = saleContractByUnitNo.get(saleRow.unitNo)!;
    const paidXof = saleRow.payments.filter((payment) => (payment.currency ?? "XOF") === "XOF").reduce((sum, payment) => sum + payment.amount, 0);
    const data = { sale_contract_id: contract.id, installment_no: 1, due_date: saleRow.signedDate ?? SACSI7_AS_OF, amount_xof: saleRow.totalAmountXof, status: paidXof >= saleRow.totalAmountXof ? "paid" : "overdue" };
    const existingId = scheduleByContractId.get(contract.id);
    if (existingId) {
      const { error } = await supabase.from("sale_payment_schedule").update(data).eq("id", existingId);
      if (error) throw new Error(`更新${saleRow.unitNo}付款计划失败：${error.message}`);
      saleSchedulesUpdated += 1;
    } else {
      const { error } = await supabase.from("sale_payment_schedule").insert(data);
      if (error) throw new Error(`创建${saleRow.unitNo}付款计划失败：${error.message}`);
      saleSchedulesCreated += 1;
    }
  }

  const leasedUnitNos = new Set(sacsi7Leases.flatMap((lease) => lease.masterUnits ?? [lease.unitNo]));
  const soldUnitNos = new Set(sacsi7Sales.map((sale) => sale.unitNo));
  const ownerOccupiedByUnitNo = new Map(sacsi7OwnerOccupiedUnits.map((row) => [row.unitNo, row]));
  for (const unit of apartmentUnits) {
    const hasLease = leasedUnitNos.has(unit.unit_no);
    const hasSale = soldUnitNos.has(unit.unit_no);
    const ownerOccupied = ownerOccupiedByUnitNo.get(unit.unit_no);
    const status = ownerOccupied ? "locked" : hasSale ? "sold" : hasLease ? "leased" : "available";
    const update = ownerOccupied
      ? { status, notes: `自用员工宿舍；入住人：${ownerOccupied.occupant}；登记日期：${SACSI7_AS_OF}；来源：用户确认。` }
      : { status };
    const { error } = await supabase.from("units").update(update).eq("id", unit.id);
    if (error) throw new Error(`更新${unit.unit_no}房态失败：${error.message}`);
  }

  const flattened = allTargetPayments();
  const refs = flattened.map((row) => row.ref);
  const { data: existingPaymentRows, error: paymentReadError } = await supabase.from("payments").select("id, receipt_no").in("receipt_no", refs);
  if (paymentReadError) throw new Error(`读取已有收款失败：${paymentReadError.message}`);
  const paymentIdByRef = new Map((existingPaymentRows ?? []).map((row) => [row.receipt_no ?? "", row.id]));
  const paymentInserts: Record<string, unknown>[] = [];
  for (const row of flattened) {
    if (paymentIdByRef.has(row.ref)) continue;
    const unit = unitMap.get(row.unitNo)!;
    const contract = row.scope === "L" ? leaseContractByUnitNo.get(row.unitNo)! : saleContractByUnitNo.get(row.unitNo)!;
    paymentInserts.push({
      customer_id: contract.customer_id, unit_id: unit.id,
      source_type: row.scope === "S" ? "sale_contract" : row.payment.kind === "deposit" ? "lease_deposit" : "lease_contract",
      source_id: contract.id, payment_date: row.payment.date, amount: row.payment.amount,
      currency: row.payment.currency ?? "XOF", exchange_rate_to_xof: row.payment.currency === "CNY" ? 0 : 1,
      receipt_no: row.ref, notes: paymentNote(row.unitNo, row.payment, row.ref),
    });
  }
  if (paymentInserts.length) {
    const { data: inserted, error } = await supabase.from("payments").insert(paymentInserts).select("id, receipt_no");
    if (error) throw new Error(`创建收款失败：${error.message}`);
    for (const row of inserted ?? []) if (row.receipt_no) paymentIdByRef.set(row.receipt_no, row.id);
  }

  const allSourceIds = [...leaseContractByUnitNo.values(), ...saleContractByUnitNo.values()].map((row) => row.id);
  const [{ data: existingReceivables, error: receivableReadError }, { data: existingLedgers, error: ledgerReadError }] = await Promise.all([
    supabase.from("receivables").select("id, source_id, category, due_date, notes").in("source_id", allSourceIds),
    supabase.from("ledger_entries").select("id, payment_id").in("payment_id", [...paymentIdByRef.values()]),
  ]);
  if (receivableReadError) throw new Error(`读取应收失败：${receivableReadError.message}`);
  if (ledgerReadError) throw new Error(`读取流水失败：${ledgerReadError.message}`);
  const receivableRefs = new Set((existingReceivables ?? []).flatMap((row) => row.notes?.match(/import_ref=([^；;]+)/)?.[1] ?? []));
  const ledgerPaymentIds = new Set((existingLedgers ?? []).map((row) => row.payment_id));
  const receivableInserts: Record<string, unknown>[] = [];
  const ledgerInserts: Record<string, unknown>[] = [];
  for (const row of flattened) {
    const unit = unitMap.get(row.unitNo)!;
    const contract = row.scope === "L" ? leaseContractByUnitNo.get(row.unitNo)! : saleContractByUnitNo.get(row.unitNo)!;
    const paymentId = paymentIdByRef.get(row.ref)!;
    const isCny = row.payment.currency === "CNY";
    const note = paymentNote(row.unitNo, row.payment, row.ref);
    if (!isCny && row.scope === "L" && !receivableRefs.has(row.ref)) {
      receivableInserts.push({
        building_id: building.id, unit_id: unit.id, customer_id: contract.customer_id,
        source_type: "lease_contract", source_id: contract.id,
        category: row.payment.kind === "deposit" ? "lease_deposit" : "lease_rent",
        title: `${row.unitNo} ${row.payment.kind === "deposit" ? "历史押金" : "历史租金"}`,
        due_date: row.payment.date, amount_xof: row.payment.amount, paid_amount_xof: row.payment.amount,
        status: "paid", currency: "XOF", notes: note,
      });
    }
    if (!ledgerPaymentIds.has(paymentId)) {
      ledgerInserts.push({
        building_id: building.id, unit_id: unit.id, payment_id: paymentId, entry_date: row.payment.date,
        direction: row.payment.kind === "deposit" ? "liability_in" : "income",
        category: row.scope === "S" ? "sale" : row.payment.kind === "deposit" ? "lease_deposit" : "lease_rent",
        amount_xof: isCny ? 0 : row.payment.amount, amount_cny: isCny ? row.payment.amount : null,
        description: `${row.unitNo} ${row.payment.note}${row.payment.paidThrough ? `；已缴至${row.payment.paidThrough}` : ""}`,
      });
    }
  }
  for (const overdue of sacsi7OverdueRentReceivables) {
    const contract = leaseContractByUnitNo.get(overdue.unitNo)!;
    const unit = unitMap.get(overdue.unitNo)!;
    const ref = `WB7-LEASE-ARREARS-${overdue.unitNo}-${overdue.dueDate}`;
    const exists = (existingReceivables ?? []).some((row) =>
      row.source_id === contract.id && row.category === "lease_rent" && row.due_date === overdue.dueDate,
    );
    if (exists || receivableRefs.has(ref)) continue;
    receivableInserts.push({
      building_id: building.id, unit_id: unit.id, customer_id: contract.customer_id,
      source_type: "lease_contract", source_id: contract.id, category: "lease_rent",
      title: `${overdue.unitNo} 已到期未缴租金`, due_date: overdue.dueDate,
      amount_xof: overdue.amountXof, paid_amount_xof: 0, status: "overdue", currency: "XOF",
      notes: `import_ref=${ref}；来源：${SACSI7_SOURCE}；缴租截至${overdue.paidThrough}；截至${SACSI7_AS_OF}未缴。`,
    });
  }
  for (const saleRow of sacsi7Sales.filter((row) => row.totalAmountXof > 0)) {
    const ref = `WB7-SALE-RECV-${saleRow.unitNo}`;
    if (receivableRefs.has(ref)) continue;
    const unit = unitMap.get(saleRow.unitNo)!;
    const contract = saleContractByUnitNo.get(saleRow.unitNo)!;
    const paidXof = saleRow.payments.filter((payment) => (payment.currency ?? "XOF") === "XOF").reduce((sum, payment) => sum + payment.amount, 0);
    receivableInserts.push({
      building_id: building.id, unit_id: unit.id, customer_id: contract.customer_id,
      source_type: "sale_contract", source_id: contract.id, category: "sale_lump_sum",
      title: `${saleRow.unitNo} 出售房款`, due_date: saleRow.signedDate ?? SACSI7_AS_OF,
      amount_xof: saleRow.totalAmountXof, paid_amount_xof: Math.min(paidXof, saleRow.totalAmountXof),
      status: paidXof >= saleRow.totalAmountXof ? "paid" : paidXof > 0 ? "partial" : "overdue",
      currency: "XOF", notes: `import_ref=${ref}；来源：${SACSI7_SOURCE}；${saleRow.planNote ?? "按工作簿总价及明确收款统计"}`,
    });
  }
  if (receivableInserts.length) {
    const { error } = await supabase.from("receivables").insert(receivableInserts);
    if (error) throw new Error(`创建已收应收记录失败：${error.message}`);
  }
  if (ledgerInserts.length) {
    const { error } = await supabase.from("ledger_entries").insert(ledgerInserts);
    if (error) throw new Error(`创建财务流水失败：${error.message}`);
  }

  await supabase.from("audit_logs").insert({
    action: "sacsi7_workbook_cover_import", entity_type: "building", entity_id: building.id, user_id: user.id,
    metadata: { source: SACSI7_SOURCE, as_of: SACSI7_AS_OF, leases: sacsi7Leases.length, sales: sacsi7Sales.length, owner_occupied: sacsi7OwnerOccupiedUnits, payments_created: paymentInserts.length, excluded: sacsi7ExcludedCategories },
  });
  for (const path of ["/units", "/fr/units", "/leases", "/fr/leases", "/sales", "/fr/sales", "/finance", "/fr/finance"]) revalidatePath(path);
  return {
    success: true, mode: "apply", message: "7号楼工作簿覆盖导入完成。",
    summary: {
      activeLeaseContracts: sacsi7Leases.length, leasedApartmentUnits: leasedUnitNos.size,
      leaseContractsCreated: leaseCreated, leaseContractsUpdated: leaseUpdated, leasePlaceholdersDeleted,
      saleContracts: sacsi7Sales.length, saleContractsCreated: saleCreated, saleContractsUpdated: saleUpdated,
      saleSchedulesCreated, saleSchedulesUpdated,
      paymentsCreated: paymentInserts.length, receivablesCreated: receivableInserts.length, ledgersCreated: ledgerInserts.length,
      ownerOccupiedUnits: sacsi7OwnerOccupiedUnits.length,
      storefrontAvailable: true, storefrontMonthlyRentXof: SACSI7_STOREFRONT_RENT_XOF,
    },
  };
}

export async function applySacsi7WorkbookImport(): Promise<Sacsi7ImportResult> {
  try {
    return await applySacsi7WorkbookImportInternal();
  } catch (error) {
    return { success: false, mode: "apply", message: error instanceof Error ? error.message : String(error), summary: {} };
  }
}
