import { createClient } from "@/lib/supabase/server";
import { unstable_noStore as noStore } from "next/cache";
import { headers } from "next/headers";
import { sortUnits } from "@/lib/utils";
import { DailyRentalsResponsiveView } from "@/features/daily-rentals/daily-rentals-responsive-view";
import type { UnitRow, DailyBookingRow } from "@/types/database";
import type { CustomerSummary } from "@/features/daily-rentals/calendar";

import type { Locale } from "@/lib/i18n";
import { fetchAllPages } from "@/lib/supabase/fetch-all";
import { businessDate } from "@/features/daily-rentals/receipt-analysis-query";
import { readDailyReceiptReport } from "@/features/reports/daily-receipt-report-service";
import {
  dailyBookingFinancePosition,
  type CalendarFinanceSnapshot,
} from "@/features/daily-rentals/calendar-finance-model";

interface DailyRentalDataProps {
  userRole: string;
  locale: Locale;
}

/**
 * Async data-fetching component for daily rentals.
 * Wrapped in Suspense in the page — streams in after the page shell.
 */
export async function DailyRentalData({ userRole, locale }: DailyRentalDataProps) {
  noStore();
  const userAgent = (await headers()).get("user-agent") ?? "";
  const initialIsDesktop = !/Android|iPhone|iPad|iPod|Mobile/i.test(userAgent);
  const supabase = await createClient();

  const [
    buildingsRes,
    customersRes,
    activeLeasesRes,
    activeSalesRes,
    cleaningRes,
    paymentRows,
    bookingRows,
    unitsRes,
  ] = await Promise.all([
    supabase
      .from("buildings")
      .select("id, code, display_name")
      .in("code", ["SACSI11", "SACSI5"])
      .eq("is_active", true),
    fetchAllPages(
      (from, to) =>
        supabase
          .from("customers")
          .select("id, name, phone, is_blacklisted")
          .order("name")
          .order("id")
          .range(from, to),
      "daily calendar customers",
    ).then((data) => ({ data, error: null })),
    fetchAllPages(
      (from, to) =>
        supabase
          .from("lease_contracts")
          .select("id, customer_id")
          .eq("status", "active")
          .order("id")
          .range(from, to),
      "daily calendar lease customers",
    ).then((data) => ({ data, error: null })),
    fetchAllPages(
      (from, to) =>
        supabase
          .from("sale_contracts")
          .select("id, customer_id")
          .eq("status", "active")
          .order("id")
          .range(from, to),
      "daily calendar sale customers",
    ).then((data) => ({ data, error: null })),
    fetchAllPages(
      (from, to) =>
        supabase
          .from("cleaning_tasks")
          .select("id, unit_id, daily_booking_id, is_completed")
          .eq("is_completed", false)
          .order("id")
          .range(from, to),
      "daily calendar cleaning tasks",
    ).then((data) => ({ data, error: null })),
    fetchAllPages(
      (from, to) =>
        supabase
          .from("payments")
          .select(
            "id, source_type, source_id, unit_id, amount, currency, exchange_rate_to_xof, payment_date, reversal_of_payment_id, request_kind",
          )
          .eq("source_type", "daily_booking")
          .order("payment_date", { ascending: false })
          .order("id", { ascending: false })
          .range(from, to),
      "daily calendar payment positions",
    ),
    fetchAllPages(
      (from, to) =>
        supabase
          .from("daily_bookings")
          .select(
            "id, unit_id, customer_id, guest_customer_id, booking_agent_id, check_in, check_out, checkout_mode, actual_check_out, nightly_price_xof, total_amount_xof, prepaid_amount_xof, manual_discount_amount_xof, final_amount_xof, status, notes",
          )
          .order("check_in", { ascending: false })
          .order("id", { ascending: false })
          .range(from, to),
      "daily calendar bookings",
    ),
    supabase
      .from("units")
      .select(
        "id, building_id, code, unit_no, floor_label, status, notes, reservation_holder_name, unit_business_flags!inner(business_type, is_enabled, default_price_xof)",
      )
      .eq("unit_business_flags.business_type", "daily_rental")
      .eq("unit_business_flags.is_enabled", true)
      .in("status", [
        "available",
        "reserved",
        "daily_occupied",
        "cleaning_pending",
        "maintenance",
        "locked",
        "sold",
      ])
      .order("unit_no"),
  ]);

  for (const result of [
    buildingsRes,
    customersRes,
    activeLeasesRes,
    activeSalesRes,
    cleaningRes,
    unitsRes,
  ]) {
    if (result.error || !result.data) throw new Error("Daily calendar data unavailable");
  }

  let dailyUnits: UnitRow[] = [];
  let unitLookupUnits: UnitRow[] = [];
  let bookings: DailyBookingRow[] = [];
  let customers: CustomerSummary[] = [];
  let cleaningTasks: {
    id: string;
    unit_id: string;
    daily_booking_id: string | null;
    is_completed: boolean;
  }[] = [];
  let payments: {
    id: string;
    source_id: string;
    amount: number;
    payment_date: string;
    reversal_of_payment_id: string | null;
    request_kind: string | null;
    unit_id?: string | null;
  }[] = [];

  if (!customersRes.error) {
    const activeLeaseCustomerIds = new Set(
      (activeLeasesRes.data ?? []).map((row) => row.customer_id).filter(Boolean),
    );
    const activeSaleCustomerIds = new Set(
      (activeSalesRes.data ?? []).map((row) => row.customer_id).filter(Boolean),
    );
    customers = (customersRes.data ?? []).map((customer) => ({
      ...(customer as unknown as CustomerSummary),
      has_active_lease_contract: activeLeaseCustomerIds.has(customer.id),
      has_active_sale_contract: activeSaleCustomerIds.has(customer.id),
    }));
  }
  if (!cleaningRes.error) cleaningTasks = cleaningRes.data ?? [];
  payments = paymentRows;
  bookings = bookingRows as unknown as DailyBookingRow[];

  const buildings = (buildingsRes.data ?? []).sort((left, right) =>
    left.code === "SACSI11"
      ? -1
      : right.code === "SACSI11"
        ? 1
        : left.code.localeCompare(right.code),
  );
  const buildingIds = buildings.map((building) => building.id);
  if (buildingIds.length > 0 && !unitsRes.error) {
    const buildingIdSet = new Set(buildingIds);
    dailyUnits = sortUnits(
      (unitsRes.data ?? [])
        .filter((unit) => buildingIdSet.has(unit.building_id))
        .map((unit) => {
          const flags = Array.isArray(unit.unit_business_flags)
            ? unit.unit_business_flags
            : [unit.unit_business_flags];
          return {
            ...unit,
            daily_rental_enabled: true,
            daily_rental_price_xof:
              flags.find((flag) => flag?.business_type === "daily_rental")?.default_price_xof ??
              null,
          };
        }) as unknown as UnitRow[],
    );
    const visibleUnitIds = new Set(dailyUnits.map((unit) => unit.id));
    const bookingUnitIds = Array.from(
      new Set(bookings.map((booking) => booking.unit_id).filter(Boolean)),
    );
    const missingBookingUnitIds = bookingUnitIds.filter((unitId) => !visibleUnitIds.has(unitId));
    let historyUnits: UnitRow[] = [];
    if (missingBookingUnitIds.length > 0) {
      const { data: historyUnitsData, error: historyUnitsErr } = await supabase
        .from("units")
        .select(
          "id, building_id, code, unit_no, floor_label, status, notes, reservation_holder_name",
        )
        .in("building_id", buildingIds)
        .in("id", missingBookingUnitIds);
      if (historyUnitsErr || !historyUnitsData)
        throw new Error("Daily calendar history unavailable");
      historyUnits = historyUnitsData as unknown as UnitRow[];
    }
    const activeBookingUnitIds = new Set(
      bookings
        .filter((booking) => booking.status === "confirmed" || booking.status === "checked_in")
        .map((booking) => booking.unit_id),
    );
    const activeExternalUnits = historyUnits.filter((unit) => activeBookingUnitIds.has(unit.id));
    dailyUnits = sortUnits([...dailyUnits, ...activeExternalUnits]);
    unitLookupUnits = sortUnits([...dailyUnits, ...historyUnits]);
  }

  const today = businessDate();
  const month = today.slice(0, 7);
  const canReadCash = ["admin", "finance", "boss"].includes(userRole);
  const financeSnapshots: Record<string, CalendarFinanceSnapshot> = Object.fromEntries(
    await Promise.all(
      buildings.map(async (building) => {
        const unitIds = new Set(
          unitLookupUnits.filter((unit) => unit.building_id === building.id).map((unit) => unit.id),
        );
        const position = dailyBookingFinancePosition(
          bookings.filter((booking) => unitIds.has(booking.unit_id)),
          today,
        );
        // A receipt-read failure must not become a zero collection total. Booking
        // operations remain available even when this independent report is down.
        const receipts = canReadCash
          ? await readDailyReceiptReport(supabase, `${month}-01`, today, building.id, true).catch(
              () => null,
            )
          : null;
        return [
          building.id,
          {
            month,
            today,
            cash: receipts?.summary ?? null,
            includedPaymentIds:
              receipts?.rows.filter((row) => row.kind !== "excluded").map((row) => row.id) ?? [],
            currentOutstanding: position.currentOutstanding,
            monthSettled: position.monthSettled,
          },
        ];
      }),
    ),
  );

  return (
    <DailyRentalsResponsiveView
      dailyUnits={dailyUnits}
      unitLookupUnits={unitLookupUnits}
      bookings={bookings}
      customers={customers}
      payments={payments}
      cleaningTasks={cleaningTasks}
      locale={locale}
      userRole={userRole}
      buildings={buildings}
      initialIsDesktop={initialIsDesktop}
      financeSnapshots={financeSnapshots}
    />
  );
}
