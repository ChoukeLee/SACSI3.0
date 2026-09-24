import type { Locale } from "@/lib/i18n";
import type { DailyLodgingBusinessType } from "./daily-rental-policy";

export function addDays(dateStr: string, days: number): string {
  const date = new Date(`${dateStr}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function getLodgingBusinessTypeLabel(
  type: DailyLodgingBusinessType,
  locale: Locale,
): string {
  const labels: Record<DailyLodgingBusinessType, Record<Locale, string>> = {
    upcoming_unpaid: { zh: "预订未入住未付款", fr: "Reservation non payee" },
    upcoming_paid: { zh: "预订未入住已付款", fr: "Reservation payee" },
    fixed_checkout_unpaid: { zh: "固定离店未付款", fr: "Depart fixe non paye" },
    fixed_checkout_paid: { zh: "固定离店已付款", fr: "Depart fixe paye" },
    open_checkout_unpaid: { zh: "未固定离店未付款", fr: "Depart ouvert non paye" },
    open_checkout_paid: { zh: "未固定离店已付款", fr: "Depart ouvert paye" },
    checked_out_unpaid: { zh: "已离店未付款", fr: "Depart effectue non paye" },
    checked_out_paid: { zh: "已离店已付款", fr: "Depart effectue paye" },
    cancelled: { zh: "已取消", fr: "Annule" },
  };

  return labels[type][locale];
}

export function getLodgingBusinessTypeClass(type: DailyLodgingBusinessType): string {
  if (
    type === "upcoming_paid" ||
    type === "fixed_checkout_paid" ||
    type === "open_checkout_paid" ||
    type === "checked_out_paid"
  ) {
    return "border-accentGreen-200 bg-accentGreen-50 text-accentGreen-700";
  }
  if (type === "checked_out_unpaid") {
    return "border-accentRed-200 bg-accentRed-50 text-accentRed-700";
  }
  if (type === "cancelled") {
    return "border-border bg-muted text-muted-foreground";
  }
  return "border-accentAmber-200 bg-accentAmber-50 text-accentAmber-700";
}

export function formatDailyRentalError(message: string | null | undefined, locale: Locale): string {
  const fallback =
    locale === "zh" ? "操作失败，请稍后重试。" : "Operation impossible. Veuillez reessayer.";
  if (!message) return fallback;

  if (message.startsWith("doubleBooked:")) {
    const detail = message.replace("doubleBooked:", "").trim();
    return locale === "zh"
      ? `该房间所选日期已被占用：${detail}`
      : `Cette chambre est deja occupee sur cette periode : ${detail}`;
  }

  const errors: Record<string, Record<Locale, string>> = {
    checkInRequired: {
      zh: "请选择入住日期。",
      fr: "Veuillez choisir une date d'arrivee.",
    },
    checkOutRequired: {
      zh: "请选择离店日期。",
      fr: "Veuillez choisir une date de depart.",
    },
    invalidDateRange: {
      zh: "离店日期必须晚于入住日期。",
      fr: "La date de depart doit etre apres la date d'arrivee.",
    },
    pastDateNotAllowed: {
      zh: "不能创建过去日期的普通预订。如需补录历史订单，请使用历史补录流程。",
      fr: "Impossible de creer une reservation normale dans le passe. Utilisez le mode de rattrapage historique.",
    },
    cleaningPending: {
      zh: "该房间仍待保洁，完成保洁后才能安排入住。",
      fr: "Cette chambre est encore en menage. Terminez le menage avant une nouvelle arrivee.",
    },
    unitMaintenance: {
      zh: "该房间处于维修状态，暂不能预订。",
      fr: "Cette chambre est en maintenance et ne peut pas etre reservee.",
    },
    unitLocked: {
      zh: "该房间已锁定，暂不能预订。",
      fr: "Cette chambre est verrouillee et ne peut pas etre reservee.",
    },
    longLeaseConflict: {
      zh: "该房间已有生效长租合同，不能创建日租预订。",
      fr: "Cette chambre a deja un bail long actif.",
    },
    saleConflict: {
      zh: "该房间已有生效出售合同，不能创建日租预订。",
      fr: "Cette chambre a deja un contrat de vente actif.",
    },
    customerBlacklisted: {
      zh: "该客户已列入黑名单，不能创建预订。",
      fr: "Ce client est sur liste noire et ne peut pas reserver.",
    },
    customerNotFound: {
      zh: "未找到该客户，请刷新后重新选择。",
      fr: "Client introuvable. Actualisez puis choisissez-le de nouveau.",
    },
    dailyBookingAgentRequired: {
      zh: "请选择已配置的日租经办人。",
      fr: "Veuillez choisir un responsable journalier configure.",
    },
    unitNotFound: {
      zh: "未找到该房间，请刷新日历后重试。",
      fr: "Chambre introuvable. Actualisez le calendrier puis reessayez.",
    },
    dailyRentalOnlyAllowedInSacsi11: {
      zh: "该房间尚未启用日租业务。",
      fr: "La location journaliere n'est pas activee pour cette chambre.",
    },
    dailyRentalNotEnabledForUnit: {
      zh: "该房间尚未启用日租业务。",
      fr: "La location journaliere n'est pas activee pour cette chambre.",
    },
    requestIdRequired: {
      zh: "订单请求无效，请关闭侧栏后重新创建。",
      fr: "La demande est invalide. Fermez le panneau puis recommencez.",
    },
    prepaymentRequired: {
      zh: "当前订单暂不能办理入住，请检查房态、保洁和订单状态。",
      fr: "Cette reservation ne peut pas encore etre enregistree ; verifiez l'etat de la chambre et du dossier.",
    },
    bookingNotPendingReview: {
      zh: "只有待确认预订可以执行确认操作。",
      fr: "Seules les reservations a valider peuvent etre confirmees.",
    },
    bookingNotConfirmed: {
      zh: "只有已确认预订可以办理入住。",
      fr: "Seules les reservations confirmees peuvent etre enregistrees en arrivee.",
    },
    bookingNotCheckedIn: {
      zh: "只有入住中的订单可以办理退房。",
      fr: "Seuls les sejours en cours peuvent etre clotures.",
    },
    bookingCannotBeCancelled: {
      zh: "该订单当前状态不能取消。",
      fr: "Cette reservation ne peut pas etre annulee dans son etat actuel.",
    },
    cleaningTaskNotFound: {
      zh: "未找到待保洁任务。",
      fr: "Tache de menage introuvable.",
    },
    cleaningTaskAlreadyCompleted: {
      zh: "该保洁任务已完成。",
      fr: "Cette tache de menage est deja terminee.",
    },
    actualCheckOutBeforeCheckIn: {
      zh: "实际退房日期不能早于入住日期。",
      fr: "La date de depart reelle ne peut pas etre avant l'arrivee.",
    },
    backfillMustBePastDate: {
      zh: "历史补录只能录入过去日期。",
      fr: "Le backfill est reserve aux dates passees.",
    },
    backfillMustBeCompleted: {
      zh: "历史补录只能录入已经结束的住宿记录。",
      fr: "Le backfill est reserve aux sejours deja termines.",
    },
    invalidPrice: {
      zh: "每晚价格必须大于 0。",
      fr: "Le prix par nuit doit etre superieur a 0.",
    },
    invalidPrepaid: {
      zh: "已收金额不能为负数。",
      fr: "Le montant percu ne peut pas etre negatif.",
    },
  };

  return errors[message]?.[locale] ?? message;
}
