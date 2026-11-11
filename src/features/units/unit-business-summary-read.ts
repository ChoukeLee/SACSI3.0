import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  LeaseContractRow,
  SaleContractRow,
  PaymentRow,
  ReceivableRow,
  SalePaymentScheduleRow,
  LedgerEntryRow,
} from "@/types/database";
import { fetchAllPages } from "@/lib/supabase/fetch-all";
import {
  buildUnitBusinessSummaries,
  type UnitBusinessSummary,
  type UnitDailyBrief,
} from "./unit-business-summary-model";
import type { UnitWorkbenchBuilding, UnitWorkbenchRecord } from "./unit-workbench-model";

type Client = Pick<SupabaseClient, "from">;
type Named<T> = T & { customer: { name: string | null } | { name: string | null }[] | null };
const batchSize = 100;
const nameOf = (value: { name: string | null } | { name: string | null }[] | null | undefined) =>
  (Array.isArray(value) ? value[0]?.name : value?.name) ?? null;

async function scopedRows<T extends { id: string }>(
  client: Client,
  table: string,
  ids: readonly string[],
  key: string,
  columns: string,
  statuses?: readonly string[],
): Promise<T[]> {
  const batches: string[][] = [];
  for (let offset = 0; offset < ids.length; offset += batchSize)
    batches.push(ids.slice(offset, offset + batchSize));
  const parts = await Promise.all(
    batches.map(async (batch) => {
      const expected = new Set(batch);
      const rows = await fetchAllPages<T>(
        async (from, to) => {
          let query = client.from(table).select(columns, { count: "exact" }).in(key, batch);
          if (statuses) query = query.in("status", [...statuses]);
          const result = await query.order("id").range(from, to);
          return {
            data: result.data as unknown as T[] | null,
            error: result.error,
            count: result.count,
          };
        },
        `asset business ${table}`,
        1000,
      );
      if (rows.some((row) => !expected.has(String((row as Record<string, unknown>)[key]))))
        throw new Error("AssetBusinessScopeMismatch");
      return rows;
    }),
  );
  const rows = parts.flat();
  if (new Set(rows.map((row) => row.id)).size !== rows.length)
    throw new Error("AssetBusinessDuplicateRows");
  return rows;
}

/** RLS-scoped current records only. Totals use the complete lightweight cash set; only six recent lines per record leave the server. */
export async function readUnitBusinessSummaries(
  client: Client,
  records: readonly UnitWorkbenchRecord[],
  building: UnitWorkbenchBuilding,
  today: string,
): Promise<Record<string, UnitBusinessSummary>> {
  const units = [
    ...new Map(
      records.filter((r) => r.unit.building_id === building.id).map((r) => [r.unit.id, r.unit]),
    ).values(),
  ];
  if (!units.length) return {};
  try {
    const ids = units.map((u) => u.id);
    const [leasesRaw, salesRaw, dailyRaw] = await Promise.all([
      scopedRows<Named<LeaseContractRow>>(
        client,
        "lease_contracts",
        ids,
        "unit_id",
        "*,customer:customers(name)",
        ["active", "draft"],
      ),
      building.allows_sale
        ? scopedRows<Named<SaleContractRow>>(
            client,
            "sale_contracts",
            ids,
            "unit_id",
            "*,customer:customers(name)",
            ["active", "draft"],
          )
        : Promise.resolve([] as Named<SaleContractRow>[]),
      scopedRows<{
        id: string;
        unit_id: string;
        guest_customer_id: string | null;
        guest_name: string | null;
        check_in: string | null;
        check_out: string | null;
        status: string;
        guest: { name: string | null } | null;
        agent: { name: string | null } | null;
      }>(
        client,
        "daily_bookings",
        ids,
        "unit_id",
        "id,unit_id,guest_customer_id,guest_name,check_in,check_out,status,guest:customers!daily_bookings_guest_customer_id_fkey(name),agent:customers!daily_bookings_booking_agent_id_fkey(name)",
        ["checked_in"],
      ),
    ]);
    const leases = leasesRaw.map(({ customer, ...row }) => ({
      ...row,
      customerName: nameOf(customer),
    }));
    const sales = salesRaw.map(({ customer, ...row }) => ({
      ...row,
      customerName: nameOf(customer),
    }));
    const contractIds = [...new Set([...leases, ...sales].map((r) => r.id))];
    const [payments, receivables, schedules] = await Promise.all([
      scopedRows<PaymentRow>(
        client,
        "payments",
        contractIds,
        "source_id",
        "id,source_id,source_type,unit_id,customer_id,payment_date,amount,currency,exchange_rate_to_xof,native_settlement,payment_method,receipt_no,external_receipt_no,notes,request_kind,reversal_of_payment_id,created_at",
      ),
      scopedRows<ReceivableRow>(
        client,
        "receivables",
        contractIds,
        "source_id",
        "id,building_id,unit_id,customer_id,source_type,source_id,category,title,due_date,amount_xof,paid_amount_xof,amount_native,paid_amount_native,currency,status,management_status,notes,service_period_start,service_period_end,service_period_source,created_at,updated_at",
      ),
      scopedRows<SalePaymentScheduleRow>(
        client,
        "sale_payment_schedule",
        sales.map((r) => r.id),
        "sale_contract_id",
        "id,sale_contract_id,installment_no,due_date,amount_xof,status,receivable_id,created_at",
      ),
    ]);
    const ledger = await scopedRows<LedgerEntryRow>(
      client,
      "ledger_entries",
      payments.map((p) => p.id),
      "payment_id",
      "id,building_id,unit_id,payment_id,entry_date,direction,category,amount_xof,currency,amount_native,amount_cny,description,created_at",
    );
    const daily: UnitDailyBrief[] = dailyRaw.map((r) => ({
      recordId: r.id,
      unitId: r.unit_id,
      customerId: r.guest_customer_id,
      customerName: r.guest_name?.trim() || nameOf(r.guest),
      agentName: nameOf(r.agent),
      checkIn: r.check_in,
      checkOut: r.check_out,
      status: r.status,
    }));
    return buildUnitBusinessSummaries({
      units,
      building,
      leases,
      sales,
      daily,
      payments,
      ledger,
      receivables,
      schedules,
      today,
    });
  } catch {
    return Object.fromEntries(
      units.map((u) => [
        u.id,
        {
          status: "unavailable" as const,
          today,
          sales: [],
          leases: [],
          daily: [],
          reviewReasons: ["business_read_unavailable"],
        },
      ]),
    );
  }
}
