import { unstable_noStore as noStore } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { Locale } from "@/lib/i18n";
import { DailyWorkbench } from "@/features/daily-rentals/daily-workbench";
import { businessDate } from "@/features/daily-rentals/receipt-analysis-query";
import { readCalendarWindow } from "@/features/daily-rentals/calendar-window-service";

/** One caller-scoped operational window; forms and financial analysis load on demand. */
export async function DailyRentalData({
  userRole,
  locale,
  viewerId,
}: {
  userRole: string;
  locale: Locale;
  viewerId?: string;
}) {
  noStore();
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
  const window = await readCalendarWindow(
    supabase,
    { buildingId: buildings[0].id, from: today, to: end.toISOString().slice(0, 10) },
    userRole,
  );
  return (
    <DailyWorkbench
      key={`${viewerId ?? "viewer"}:${userRole}`}
      locale={locale}
      userRole={userRole}
      buildings={buildings}
      initialWindow={window}
    />
  );
}
