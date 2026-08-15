import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import type { ManagementFinanceSnapshot } from "@/features/management/finance-snapshot";
import { fetchAllPages } from "@/lib/supabase/fetch-all";
import { addIsoDays, isOperatingExpensePayment, isRefundPayment, paymentAmountXof } from "@/features/finance/metrics";
import type { PaymentRow } from "@/types/database";

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
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const monthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  const monthStartText = monthStart.toISOString().slice(0, 10);
  const monthEndText = monthEnd.toISOString().slice(0, 10);
  const asOf = now.toISOString().slice(0, 10);
  const upcomingEnd = addIsoDays(asOf, 15);

  const [receivables, payments, historicalPendingRows, units, buildings, customers] = await Promise.all([
    fetchAllPages(
      (from, to) => supabase.from("receivables")
        .select("id, due_date, source_type, category, title, amount_xof, paid_amount_xof, building_id, unit_id, customer_id, status, management_status")
        .neq("source_type", "daily_booking")
        .neq("status", "cancelled")
        .eq("management_status", "managed")
        .lte("due_date", upcomingEnd)
        .order("due_date", { ascending: false })
        .order("id")
        .range(from, to),
      "management finance receivables",
    ),
    fetchAllPages(
      (from, to) => supabase.from("payments")
        .select("id, customer_id, unit_id, source_type, source_id, payment_date, amount, currency, exchange_rate_to_xof, receipt_no, notes, reversal_of_payment_id, created_at")
        .neq("source_type", "daily_booking")
        .gte("payment_date", monthStartText)
        .lt("payment_date", monthEndText)
        .order("payment_date", { ascending: false })
        .order("id")
        .range(from, to),
      "management finance payments",
    ),
    fetchAllPages(
      (from, to) => supabase.from("receivables")
        .select("amount_xof, paid_amount_xof")
        .eq("management_status", "historical_pending")
        .neq("status", "cancelled")
        .range(from, to),
      "management historical pending",
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

  const paymentItems = (payments as PaymentRow[])
    .filter((payment) => !isOperatingExpensePayment(payment))
    .map((payment) => {
      const unit = payment.unit_id ? unitById.get(payment.unit_id) : undefined;
      const buildingId = unit?.building_id ?? null;
      const building = buildingId ? buildingById.get(buildingId) : undefined;
      return {
        id: payment.id,
        paymentDate: payment.payment_date,
        sourceType: payment.source_type,
        amountXof: paymentAmountXof(payment),
        isRefund: isRefundPayment(payment),
        buildingId,
        buildingCode: building?.code ?? null,
        buildingName: building?.display_name ?? building?.code ?? null,
        unitId: payment.unit_id,
        unitNo: unit?.unit_no ?? null,
        customerId: payment.customer_id,
        customerName: payment.customer_id ? customerById.get(payment.customer_id)?.name ?? null : null,
        receiptNo: payment.receipt_no,
      };
    });
  const dueItems = items.filter((item) => item.dueDate <= asOf && item.outstandingXof > 0);
  const upcomingItems = items.filter((item) => item.dueDate > asOf && item.outstandingXof > 0);
  const historicalPending = historicalPendingRows.reduce(
    (sum, row) => sum + Math.max(Number(row.amount_xof) - Number(row.paid_amount_xof), 0), 0,
  );

  return {
    monthStart: monthStartText,
    monthEndExclusive: monthEndText,
    asOf,
    summary: {
      totalReceivable: dueItems.reduce((sum, item) => sum + item.amountXof, 0),
      totalPaid: dueItems.reduce((sum, item) => sum + item.paidAmountXof, 0),
      monthCollected: paymentItems.reduce((sum, item) => sum + (item.isRefund ? -item.amountXof : item.amountXof), 0),
      outstanding: dueItems.reduce((sum, item) => sum + item.outstandingXof, 0),
      overdue: dueItems.filter((item) => item.dueDate < asOf).reduce((sum, item) => sum + item.outstandingXof, 0),
      upcoming: upcomingItems.reduce((sum, item) => sum + item.outstandingXof, 0),
      count: dueItems.length,
      historicalPending,
      historicalPendingCount: historicalPendingRows.filter((row) => Number(row.amount_xof) > Number(row.paid_amount_xof)).length,
      collectionRate: 0,
    },
    items,
    paymentItems,
  };
});

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

