import type { Locale } from "@/lib/i18n";
import { qualifiedUnitNo } from "@/lib/unit-building-label";
import { addDays } from "./booking-presentation";
import type { CalendarWindowData } from "./calendar-window-model";
import { dailyReadinessLabel } from "./daily-workbench-labels";
import { dailyWorkbenchCounts, findDailyRooms } from "./daily-workbench-model";

/** A user-requested room-state summary, never guest identities or financial records. */
export function dailyWorkbenchShareText(
  data: CalendarWindowData,
  building: string,
  locale: Locale,
) {
  const zh = locale === "zh";
  const counts = dailyWorkbenchCounts(data, data.today);
  const states = findDailyRooms(data, data.today, addDays(data.today, 1), data.today);
  return [
    `${building} · ${zh ? "日租房态" : "Occupation journalière"} · ${data.today}`,
    zh
      ? `待入住/待核实 ${counts.arrivals} · 在住 ${counts.inhouse} · 应退/待核实 ${counts.departures} · 待保洁 ${counts.cleaning}`
      : `Arrivées ${counts.arrivals} · En séjour ${counts.inhouse} · Départs ${counts.departures} · Ménage ${counts.cleaning}`,
    ...states.map(
      (room) => `${qualifiedUnitNo(room.unit)} · ${dailyReadinessLabel(room.reason, locale)}`,
    ),
    zh
      ? "按当前账号可访问房间统计。交付须复核；分类数量不可相加。"
      : "Selon les chambres accessibles au compte. Remise à vérifier ; catégories non cumulables.",
  ].join("\n");
}
