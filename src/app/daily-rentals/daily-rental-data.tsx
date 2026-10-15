import { unstable_noStore as noStore } from "next/cache";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { fetchAllPages } from "@/lib/supabase/fetch-all";
import type { Locale } from "@/lib/i18n";
import { DailyRentalsResponsiveView } from "@/features/daily-rentals/daily-rentals-responsive-view";
import { businessDate } from "@/features/daily-rentals/receipt-analysis-query";
import { readCalendarWindow } from "@/features/daily-rentals/calendar-window-service";
import type { CustomerSummary } from "@/features/daily-rentals/customer-summary";

/** Initial calendar window only. Full financial context is read independently. */
export async function DailyRentalData({ userRole, locale }: { userRole: string; locale: Locale }) {
  noStore();
  const userAgent = (await headers()).get("user-agent") ?? "";
  const supabase = await createClient();
  const { data: buildingRows, error } = await supabase
    .from("buildings")
    .select("id,code,display_name")
    .in("code", ["SACSI11", "SACSI5"])
    .eq("is_active", true)
    .order("code");
  if (error || !buildingRows) throw new Error("Daily calendar data unavailable");
  const buildings = [...buildingRows].sort((a, b) =>
    a.code === "SACSI11" ? -1 : b.code === "SACSI11" ? 1 : a.code.localeCompare(b.code),
  );
  if (!buildings.length)
    return (
      <p>
        {locale === "zh"
          ? "当前账号没有可访问的日租楼栋。"
          : "Aucun bâtiment journalier accessible."}
      </p>
    );
  const today = businessDate();
  const end = new Date(today + "T00:00:00Z");
  end.setUTCDate(end.getUTCDate() + 8);
  const [window, customers, leases, sales] = await Promise.all([
    readCalendarWindow(
      supabase,
      { buildingId: buildings[0].id, from: today, to: end.toISOString().slice(0, 10) },
      userRole,
    ),
    fetchAllPages(
      (from, to) =>
        supabase
          .from("customers")
          .select("id,name,phone,is_blacklisted")
          .order("name")
          .order("id")
          .range(from, to),
      "daily calendar customer choices",
    ),
    fetchAllPages(
      (from, to) =>
        supabase
          .from("lease_contracts")
          .select("customer_id")
          .eq("status", "active")
          .order("id")
          .range(from, to),
      "daily calendar active lease customers",
    ),
    fetchAllPages(
      (from, to) =>
        supabase
          .from("sale_contracts")
          .select("customer_id")
          .eq("status", "active")
          .order("id")
          .range(from, to),
      "daily calendar active sale customers",
    ),
  ]);
  const leaseIds = new Set(leases.map((row) => row.customer_id)),
    saleIds = new Set(sales.map((row) => row.customer_id));
  const choices = customers.map((row) => ({
    ...row,
    has_active_lease_contract: leaseIds.has(row.id),
    has_active_sale_contract: saleIds.has(row.id),
  })) as CustomerSummary[];
  return (
    <DailyRentalsResponsiveView
      dailyUnits={window.dailyUnits}
      unitLookupUnits={window.unitLookupUnits}
      bookings={window.bookings}
      customers={choices}
      payments={window.payments}
      cleaningTasks={window.cleaningTasks}
      locale={locale}
      userRole={userRole}
      buildings={buildings}
      initialIsDesktop={!/Android|iPhone|iPad|iPod|Mobile/i.test(userAgent)}
      financeSnapshots={{ [window.buildingId]: window.financeSnapshot! }}
      initialWindow={window}
    />
  );
}
