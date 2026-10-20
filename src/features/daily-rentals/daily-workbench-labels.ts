import type { DailyBookingRow } from "@/types/database";
import type { Locale } from "@/lib/i18n";
import type { CalendarWindowData } from "./calendar-window-model";

export function dailyDateLabel(value: string | null | undefined, locale: Locale) {
  if (!value) return locale === "zh" ? "离店未定" : "Départ ouvert";
  return new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "fr-FR", {
    month: "2-digit",
    day: "2-digit",
    timeZone: "Africa/Abidjan",
  }).format(new Date(value + "T00:00:00Z"));
}

export function dailyGuestLabel(
  booking: DailyBookingRow,
  data: CalendarWindowData,
  locale: Locale,
) {
  return (
    booking.guest_name?.trim() ||
    data.customers?.find((customer) => customer.id === booking.guest_customer_id)?.name ||
    (locale === "zh" ? "住客未登记" : "Voyageur non renseigné")
  );
}

/** Keep legacy operator identities useful without falsely naming them as guests. */
export function dailyBookingIdentityLabel(
  booking: DailyBookingRow,
  data: CalendarWindowData,
  locale: Locale,
) {
  const namedGuest =
    booking.guest_name?.trim() ||
    data.customers?.find((customer) => customer.id === booking.guest_customer_id)?.name;
  if (namedGuest) return namedGuest;
  const agent = data.customers?.find(
    (customer) => customer.id === (booking.booking_agent_id ?? booking.customer_id),
  );
  return agent
    ? `${locale === "zh" ? "经办" : "Resp."} · ${agent.name}`
    : dailyGuestLabel(booking, data, locale);
}

export function dailyStatusLabel(booking: DailyBookingRow, today: string, locale: Locale) {
  const zh = locale === "zh";
  if (booking.status === "checked_in") {
    if (booking.checkout_mode === "open")
      return zh ? "在住 · 离店未定" : "En séjour · départ ouvert";
    if (booking.check_out && booking.check_out <= today)
      return booking.check_out < today
        ? zh
          ? "离店安排待核实"
          : "Départ à vérifier"
        : zh
          ? "今日应退"
          : "Départ aujourd'hui";
    return zh ? "在住" : "En séjour";
  }
  if (booking.status === "checked_out") return zh ? "已退房" : "Terminé";
  if (booking.status === "cancelled") return zh ? "已取消" : "Annulé";
  if (booking.status === "pending_review") return zh ? "待确认" : "À confirmer";
  if (booking.check_in < today) return zh ? "未到店 · 待核实" : "Arrivée à vérifier";
  return booking.check_in === today
    ? zh
      ? "待入住"
      : "Arrivée attendue"
    : zh
      ? "已预订"
      : "Réservé";
}

const reasons: Record<string, [string, string]> = {
  ready: ["所选区间无冲突，当前房间已就绪", "Période libre, chambre prête actuellement"],
  futureHandover: [
    "区间无冲突，入住前复核交付",
    "Période libre, remise à revérifier avant l'arrivée",
  ],
  cleaningPending: ["保洁未完成，先处理交接", "Ménage à terminer avant la remise"],
  readinessUnverified: ["交付状态待核实", "État de remise à vérifier"],
  occupancyUnverified: ["房态与住宿记录待核对", "Occupation et dossier à rapprocher"],
  bookingConflict: ["所选区间有住宿占用", "Occupation pendant la période choisie"],
  openCheckout: ["离店未定，持续占房", "Départ ouvert, chambre toujours occupée"],
  invalidBookingData: ["订单日期不完整，需人工核对", "Dates incomplètes, vérification nécessaire"],
  incompleteWindow: ["读取范围不完整，房态未知", "Lecture incomplète, disponibilité inconnue"],
  invalidDateRange: ["离店日期必须晚于入住日期", "Le départ doit suivre l'arrivée"],
  pastDateNotAllowed: ["过去日期请使用历史补录", "Utilisez le rattrapage pour une date passée"],
  dailyRentalDisabled: ["该房间未启用日租", "Location courte non activée"],
  unitMaintenance: ["维修中，不可安排", "Maintenance, indisponible"],
  unitLocked: ["已锁房，不可安排", "Chambre bloquée"],
  saleConflict: ["出售房源未启用日租", "Bien vendu non autorisé en location courte"],
  longLeaseConflict: ["长租占用，不可安排", "Occupé par un bail long"],
};

export function dailyReadinessLabel(reason: string, locale: Locale) {
  return (reasons[reason] ?? reasons.readinessUnverified)[locale === "zh" ? 0 : 1];
}
