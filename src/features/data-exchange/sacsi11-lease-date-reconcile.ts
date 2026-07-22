"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  SACSI11_LEASE_DATE_AS_OF,
  SACSI11_LEASE_DATE_SOURCE,
  sacsi11LeaseDates,
  sacsi11OverdueRent,
} from "./sacsi11-lease-date-data";

export type Sacsi11LeaseDateResult = {
  success: boolean;
  mode: "preview" | "apply";
  message: string;
  summary: Record<string, number | string>;
};

async function loadContext() {
  const supabase = await createClient();
  const { data: building, error: buildingError } = await supabase.from("buildings").select("id").eq("code", "SACSI11").single();
  if (buildingError || !building) throw new Error("未找到11号公寓。");
  const { data: units, error: unitError } = await supabase.from("units").select("id, unit_no").eq("building_id", building.id).eq("kind", "apartment");
  if (unitError || !units) throw new Error(unitError?.message ?? "读取11号公寓房源失败。");
  const unitByNo = new Map(units.map((unit) => [unit.unit_no, unit]));
  const unitIds = units.map((unit) => unit.id);
  const { data: contracts, error: contractError } = await supabase.from("lease_contracts")
    .select("id, unit_id, customer_id, monthly_rent_xof, expected_end_date, expected_end_confirmed, paid_through_date")
    .in("unit_id", unitIds).eq("status", "active");
  if (contractError || !contracts) throw new Error(contractError?.message ?? "读取11号公寓生效合同失败。");
  const contractByUnitId = new Map(contracts.map((contract) => [contract.unit_id, contract]));
  const contractByUnitNo = new Map<string, (typeof contracts)[number]>();
  for (const row of sacsi11LeaseDates) {
    const unit = unitByNo.get(row.unitNo);
    const contract = unit ? contractByUnitId.get(unit.id) : null;
    if (!unit || !contract) throw new Error(`线上缺少11号公寓生效长租：${row.unitNo}`);
    contractByUnitNo.set(row.unitNo, contract);
  }
  const targetNos = new Set(sacsi11LeaseDates.map((row) => row.unitNo));
  const extraActiveNos = units.filter((unit) => contractByUnitId.has(unit.id) && !targetNos.has(unit.unit_no)).map((unit) => unit.unit_no);
  if (extraActiveNos.length) throw new Error(`线上存在未纳入本次复核的生效合同：${extraActiveNos.join("、")}`);
  return { supabase, building, unitByNo, contractByUnitNo };
}

export async function previewSacsi11LeaseDateReconcile(): Promise<Sacsi11LeaseDateResult> {
  await requireRole("admin");
  const { contractByUnitNo } = await loadContext();
  const changed = sacsi11LeaseDates.filter((row) => {
    const contract = contractByUnitNo.get(row.unitNo)!;
    return contract.expected_end_confirmed !== row.expectedEndConfirmed || contract.paid_through_date !== row.paidThroughDate;
  });
  return {
    success: true,
    mode: "preview",
    message: "校验通过：将合同到期日与租金已缴至日期分开，并补齐当前明确欠租。",
    summary: {
      activeLeases: sacsi11LeaseDates.length,
      contractsToChange: changed.length,
      confirmedContractEnds: sacsi11LeaseDates.filter((row) => row.expectedEndConfirmed).length,
      contractEndsPending: sacsi11LeaseDates.filter((row) => !row.expectedEndConfirmed).length,
      overdueReceivables: sacsi11OverdueRent.length,
      overdueAmountXof: sacsi11OverdueRent.reduce((sum, row) => sum + row.amountXof, 0),
    },
  };
}

export async function applySacsi11LeaseDateReconcile(): Promise<Sacsi11LeaseDateResult> {
  const user = await requireRole("admin");
  const { supabase, building, unitByNo, contractByUnitNo } = await loadContext();
  let contractsUpdated = 0;
  let receivablesCreated = 0;
  let receivablesCorrected = 0;

  for (const row of sacsi11LeaseDates) {
    const contract = contractByUnitNo.get(row.unitNo)!;
    const { error } = await supabase.from("lease_contracts").update({
      expected_end_date: row.paidThroughDate,
      expected_end_confirmed: row.expectedEndConfirmed,
      paid_through_date: row.paidThroughDate,
    }).eq("id", contract.id);
    if (error) throw new Error(`更新${row.unitNo}双日期失败：${error.message}`);
    contractsUpdated += 1;
  }

  for (const row of sacsi11OverdueRent) {
    const unit = unitByNo.get(row.unitNo)!;
    const contract = contractByUnitNo.get(row.unitNo)!;
    const ref = `WB11-LEASE-ARREARS-${row.unitNo}-${row.dueDate.replaceAll("-", "")}`;
    const { data: openRows, error: openError } = await supabase.from("receivables")
      .select("id, due_date, amount_xof, paid_amount_xof, status")
      .eq("source_type", "lease_contract").eq("source_id", contract.id).eq("category", "lease_rent")
      .in("status", ["pending", "partial", "overdue"]);
    if (openError) throw new Error(`读取${row.unitNo}欠租失败：${openError.message}`);
    const exact = (openRows ?? []).find((item) => item.due_date === row.dueDate);
    const sameUnpaid = (openRows ?? []).filter((item) => Number(item.amount_xof) === row.amountXof && Number(item.paid_amount_xof) === 0);
    const data = {
      building_id: building.id,
      unit_id: unit.id,
      customer_id: contract.customer_id,
      source_type: "lease_contract",
      source_id: contract.id,
      category: "lease_rent",
      title: `${row.unitNo} 已到期未缴租金`,
      due_date: row.dueDate,
      amount_xof: row.amountXof,
      paid_amount_xof: 0,
      status: "overdue",
      currency: "XOF",
      notes: `import_ref=${ref}；来源：${SACSI11_LEASE_DATE_SOURCE}；截至${SACSI11_LEASE_DATE_AS_OF}未缴。`,
    };
    const candidate = exact ?? (sameUnpaid.length === 1 ? sameUnpaid[0] : null);
    if (candidate) {
      const { error } = await supabase.from("receivables").update(data).eq("id", candidate.id);
      if (error) throw new Error(`校正${row.unitNo}欠租失败：${error.message}`);
      receivablesCorrected += 1;
    } else {
      const { error } = await supabase.from("receivables").insert(data);
      if (error) throw new Error(`创建${row.unitNo}欠租失败：${error.message}`);
      receivablesCreated += 1;
    }
  }

  await supabase.from("audit_logs").insert({
    action: "sacsi11_lease_date_reconcile",
    entity_type: "building",
    entity_id: building.id,
    user_id: user.id,
    metadata: {
      source: SACSI11_LEASE_DATE_SOURCE,
      as_of: SACSI11_LEASE_DATE_AS_OF,
      active_leases: sacsi11LeaseDates.length,
      confirmed_contract_ends: sacsi11LeaseDates.filter((row) => row.expectedEndConfirmed).length,
      overdue_units: sacsi11OverdueRent.map((row) => row.unitNo),
    },
  });
  for (const path of ["/leases", "/fr/leases", "/finance", "/fr/finance"]) revalidatePath(path);
  return {
    success: true,
    mode: "apply",
    message: "11号公寓合同到期日、已缴至日期及当前欠租校正完成。",
    summary: { contractsUpdated, receivablesCreated, receivablesCorrected },
  };
}
