import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { parseManagementFinanceSnapshot } from "@/features/management/finance-snapshot";
import type { ManagementFinanceSnapshot } from "@/features/management/finance-snapshot";
import { fetchAllPages } from "@/lib/supabase/fetch-all";

export const getBuildings = cache(async () => {
  const supabase = await createClient();
  const { data } = await supabase.from("buildings").select("id, display_name, is_active, code").eq("is_active", true).order("code");
  return data ?? [];
});

export const getUnits = cache(async () => {
  const supabase = await createClient();
  const { data } = await supabase.from("units").select("id, unit_no, floor_label, kind, status, building_id, layout, notes").order("unit_no");
  return data ?? [];
});

export const getManagementFinanceSnapshot = cache(async () => {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("management_finance_snapshot");
  if (!error) return parseManagementFinanceSnapshot(data);

  console.error("Failed to load management finance snapshot RPC; using table fallback:", error);
  return getManagementFinanceSnapshotFallback();
});

async function getManagementFinanceSnapshotFallback(): Promise<ManagementFinanceSnapshot> {
  const supabase = await createClient();
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const monthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  const monthStartText = monthStart.toISOString().slice(0, 10);
  const monthEndText = monthEnd.toISOString().slice(0, 10);
  const asOf = now.toISOString().slice(0, 10);

  const [receivables, units, buildings, customers] = await Promise.all([
    fetchAllPages(
      (from, to) => supabase.from("receivables")
        .select("id, due_date, source_type, category, title, amount_xof, paid_amount_xof, building_id, unit_id, customer_id, status")
        .neq("source_type", "daily_booking")
        .neq("status", "cancelled")
        .lt("due_date", monthEndText)
        .order("due_date", { ascending: false })
        .order("id")
        .range(from, to),
      "management finance fallback receivables",
    ),
    getUnits(),
    getBuildings(),
    getCustomers(),
  ]);

  const unitById = new Map(units.map((unit) => [unit.id, unit]));
  const buildingById = new Map(buildings.map((building) => [building.id, building]));
  const customerById = new Map(customers.map((customer) => [customer.id, customer]));

  const items = receivables.map((receivable) => {
    const amountXof = Math.max(Number(receivable.amount_xof) || 0, 0);
    const paidAmountXof = Math.min(Math.max(Number(receivable.paid_amount_xof) || 0, 0), amountXof);
    const outstandingXof = Math.max(amountXof - paidAmountXof, 0);
    const unit = receivable.unit_id ? unitById.get(receivable.unit_id) : undefined;
    const buildingId = receivable.building_id ?? unit?.building_id ?? null;
    const building = buildingId ? buildingById.get(buildingId) : undefined;
    const status = outstandingXof <= 0
      ? "paid"
      : receivable.due_date < asOf
        ? "overdue"
        : paidAmountXof > 0
          ? "partial"
          : "pending";

    return {
      id: receivable.id,
      dueDate: receivable.due_date,
      sourceType: receivable.source_type,
      category: receivable.category,
      title: receivable.title,
      amountXof,
      paidAmountXof,
      outstandingXof,
      status,
      buildingId,
      buildingCode: building?.code ?? null,
      buildingName: building?.display_name ?? building?.code ?? null,
      unitId: receivable.unit_id,
      unitNo: unit?.unit_no ?? null,
      customerId: receivable.customer_id,
      customerName: receivable.customer_id ? customerById.get(receivable.customer_id)?.name ?? null : null,
    } satisfies ManagementFinanceSnapshot["items"][number];
  }).sort((left, right) => {
    const dueDateOrder = right.dueDate.localeCompare(left.dueDate);
    if (dueDateOrder !== 0) return dueDateOrder;
    const buildingOrder = (left.buildingCode ?? "\uffff").localeCompare(right.buildingCode ?? "\uffff");
    if (buildingOrder !== 0) return buildingOrder;
    const unitOrder = (left.unitNo ?? "\uffff").localeCompare(right.unitNo ?? "\uffff");
    return unitOrder !== 0 ? unitOrder : left.id.localeCompare(right.id);
  });

  const totalReceivable = items.reduce((sum, item) => sum + item.amountXof, 0);
  const totalPaid = items.reduce((sum, item) => sum + item.paidAmountXof, 0);
  const outstanding = items.reduce((sum, item) => sum + item.outstandingXof, 0);
  const overdue = items
    .filter((item) => item.status === "overdue")
    .reduce((sum, item) => sum + item.outstandingXof, 0);

  return {
    monthStart: monthStartText,
    monthEndExclusive: monthEndText,
    asOf,
    summary: {
      totalReceivable,
      totalPaid,
      outstanding,
      overdue,
      count: items.length,
      collectionRate: totalReceivable > 0 ? totalPaid / totalReceivable : 0,
    },
    items,
  };
}

export const getDailyBookings = cache(async () => {
  const supabase = await createClient();
  return fetchAllPages(
    (from, to) => supabase.from("daily_bookings")
      .select("id, unit_id, customer_id, check_in, check_out, checkout_mode, actual_check_out, status")
      .in("status", ["pending_review", "confirmed", "checked_in"])
      .order("check_in", { ascending: false }).order("id").range(from, to),
    "management daily bookings",
  );
});

export const getLeaseContracts = cache(async () => {
  const supabase = await createClient();
  return fetchAllPages(
    (from, to) => supabase.from("lease_contracts")
      .select("id, contract_no, unit_id, customer_id, status, expected_end_date, start_date")
      .in("status", ["active", "draft"])
      .order("start_date", { ascending: false }).order("id").range(from, to),
    "management lease contracts",
  );
});

export const getSaleContracts = cache(async () => {
  const supabase = await createClient();
  return fetchAllPages(
    (from, to) => supabase.from("sale_contracts")
      .select("id, unit_id, customer_id, status, signed_date")
      .in("status", ["active", "draft"])
      .order("signed_date", { ascending: false }).order("id").range(from, to),
    "management sale contracts",
  );
});

export const getCleaningTasks = cache(async () => {
  const supabase = await createClient();
  const { data } = await supabase.from("cleaning_tasks").select("id, unit_id, is_completed");
  return data ?? [];
});

export const getCustomers = cache(async () => {
  const supabase = await createClient();
  return fetchAllPages(
    (from, to) => supabase.from("customers")
      .select("id, name")
      .order("name")
      .order("id")
      .range(from, to),
    "management customers",
  );
});

