"use client";

import { ArrowRight, CircleCheck, Clock3, Info } from "lucide-react";
import type { Locale } from "@/lib/i18n";
import { cn, formatXof } from "@/lib/utils";
import { qualifiedUnitNo } from "@/lib/unit-building-label";
import type { DailyBookingRow, UnitRow } from "@/types/database";
import type { CalendarWindowData } from "./calendar-window-model";
import { calculateBilling } from "./billing";
import {
  dailyDateLabel,
  dailyGuestLabel,
  dailyReadinessLabel,
  dailyStatusLabel,
} from "./daily-workbench-labels";
import styles from "./daily-workbench.module.css";

export function DailyWorkbenchInspector({
  data,
  unit,
  booking,
  locale,
  today,
  reason,
  from,
  to,
  userRole,
  onOperate,
}: {
  data: CalendarWindowData;
  unit: UnitRow | null;
  booking: DailyBookingRow | null;
  locale: Locale;
  today: string;
  reason?: string;
  from: string;
  to: string;
  userRole?: string;
  onOperate: () => void;
}) {
  const text = (zh: string, fr: string) => (locale === "zh" ? zh : fr);
  if (!unit)
    return (
      <aside className={styles.inspector} aria-label={text("订单详情", "Détail du séjour")}>
        <h2>{text("选择一笔订单或房间", "Choisissez un séjour ou une chambre")}</h2>
        <p className={styles.subtitle}>
          {text(
            "住宿、经办与收款信息会在这里展开。",
            "Les informations du séjour et de l'encaissement s'afficheront ici.",
          )}
        </p>
      </aside>
    );
  const start = booking?.check_in ?? from;
  const end = booking ? (booking.actual_check_out ?? booking.check_out) : to;
  const billing = booking ? calculateBilling(booking, today) : null;
  const agent = booking
    ? data.customers?.find((c) => c.id === (booking.booking_agent_id ?? booking.customer_id))
    : null;
  const paymentRows = booking ? data.payments.filter((p) => p.source_id === booking.id) : [];
  const netRecorded = paymentRows.reduce((total, p) => total + Number(p.amount), 0);
  const hasCleaning = data.cleaningTasks.some((t) => t.unit_id === unit.id && !t.is_completed);
  const occupied = data.bookings.some(
    (b) => b.unit_id === unit.id && b.status === "checked_in" && !b.actual_check_out,
  );
  const readiness =
    reason ??
    (unit.operational_condition === "maintenance" || unit.status === "maintenance"
      ? "unitMaintenance"
      : unit.operational_condition === "locked" || unit.status === "locked"
        ? "unitLocked"
        : hasCleaning || unit.status === "cleaning_pending"
          ? "cleaningPending"
          : occupied
            ? "occupancyUnverified"
            : booking && booking.check_in > today
              ? "futureHandover"
              : "readinessUnverified");
  const canOperate =
    booking ||
    ((hasCleaning ? ["admin", "rental_sales", "front_desk"] : ["admin", "rental_sales"]).includes(
      userRole ?? "",
    ) &&
      unit.daily_rental_enabled === true &&
      !["unitMaintenance", "unitLocked", "longLeaseConflict", "saleConflict"].includes(readiness));
  const action =
    booking && !["admin", "rental_sales", "front_desk"].includes(userRole ?? "")
      ? text("查看订单与收据", "Consulter dossier et reçu")
      : booking
        ? hasCleaning
          ? text("查看保洁与订单", "Ménage et dossier")
          : booking.status === "checked_in"
            ? text("办理住宿与收款", "Gérer séjour et encaissement")
            : booking.status === "checked_out"
              ? text("查看已完成订单", "Consulter le séjour terminé")
              : text("办理预订与入住", "Gérer réservation et arrivée")
        : hasCleaning
          ? text("处理保洁交接", "Traiter le ménage")
          : text("填写预订信息", "Renseigner la réservation");
  return (
    <aside
      className={styles.inspector}
      aria-label={text("订单详情", "Détail du séjour")}
      aria-live="polite"
    >
      <div className={styles.inspectorTop}>
        <span>
          {booking
            ? text("订单详情", "Détail du séjour")
            : text("房间与预订", "Chambre et réservation")}
        </span>
        <span>{unit.layout ?? text("日租房间", "Location courte")}</span>
      </div>
      <h2 className={styles.detailRoom}>{qualifiedUnitNo(unit)}</h2>
      <div className={styles.detailGuest}>
        {booking
          ? dailyGuestLabel(booking, data, locale)
          : text("尚未创建预订", "Aucune réservation créée")}
        <span
          className={cn(
            styles.tag,
            booking?.status === "checked_in" ? styles.greenTag : styles.blueTag,
          )}
        >
          {booking ? dailyStatusLabel(booking, today, locale) : text("待安排", "À organiser")}
        </span>
      </div>
      <div className={styles.stay}>
        <div>
          <span className={styles.dateLabel}>{text("入住", "Arrivée")}</span>
          <strong>{dailyDateLabel(start, locale)}</strong>
        </div>
        <span className={styles.nights}>
          {end
            ? `${Math.max(1, Math.round((Date.parse(end) - Date.parse(start)) / 86400000))} ${text("晚", "nuits")}`
            : text("持续占房", "Séjour ouvert")}
          <br />→
        </span>
        <div>
          <span className={styles.dateLabel}>
            {booking?.actual_check_out ? text("实际离店", "Départ réel") : text("离店", "Départ")}
          </span>
          <strong>{dailyDateLabel(end, locale)}</strong>
        </div>
      </div>
      <section className={styles.section}>
        <h3>{text("房间交付", "Remise de la chambre")}</h3>
        <div className={styles.checkline}>
          {readiness === "ready" ? (
            <CircleCheck size={15} aria-hidden="true" />
          ) : (
            <Clock3 size={15} aria-hidden="true" />
          )}
          <span>
            {occupied
              ? text(
                  "仍有在住订单，实际退房前不可直接交付",
                  "Un séjour est en cours : départ réel requis avant remise",
                )
              : dailyReadinessLabel(readiness, locale)}
          </span>
        </div>
        {booking?.checkout_mode === "open" && !booking.actual_check_out && (
          <p className={styles.checkline}>
            <Info size={15} aria-hidden="true" />
            {text(
              "离店未定，不自动视为逾期或空房。",
              "Départ ouvert : ni retard ni disponibilité déduits.",
            )}
          </p>
        )}
      </section>
      {billing && (
        <section
          className={styles.money}
          aria-label={text("住宿收款位置", "Position des encaissements")}
        >
          <div className={styles.moneyRow}>
            <span>{text("住宿订单计费", "Facturation du séjour")}</span>
            <strong>{formatXof(billing.finalAmount, locale)}</strong>
          </div>
          <div className={styles.moneyRow}>
            <span>{text("已登记收款净额", "Encaissements nets saisis")}</span>
            <strong>{formatXof(netRecorded, locale)}</strong>
          </div>
          <div className={styles.moneyRow}>
            <span>{text("订单记录已付", "Payé selon le dossier")}</span>
            <strong>{formatXof(billing.paid, locale)}</strong>
          </div>
          <div className={styles.moneyRow}>
            <span>{text("按订单记录待收", "Solde selon le dossier")}</span>
            <strong>{formatXof(billing.outstanding, locale)}</strong>
          </div>
          {netRecorded !== billing.paid && (
            <p className={styles.notice}>
              {text(
                "订单已付记录与收款净额不一致，请先核对，不据此认定客户欠款。",
                "Le payé du dossier diffère des mouvements nets : rapprocher avant de conclure à une dette.",
              )}
            </p>
          )}
          <p className={styles.kicker}>
            {text(
              "订单计算口径，不等于已核实应收；不含押金。实际收款与分账须另行核对。",
              "Calcul du dossier, non une créance vérifiée ; hors caution. Encaissements et affectations à rapprocher.",
            )}
          </p>
        </section>
      )}
      {booking && (
        <details className={styles.identity}>
          <summary>{text("经办与追溯", "Responsable et traçabilité")}</summary>
          <p>
            {text("业务经办：", "Responsable : ")}
            {agent?.name ?? text("未登记", "Non renseigné")}
          </p>
          <p>
            {text(
              "实际收款人、系统录入人与业务经办人不默认相同；请在收款记录与审计中核验。",
              "Le responsable, l'encaisseur et l'auteur de saisie sont distincts ; consulter paiements et audit.",
            )}
          </p>
          {booking.notes && <p>{booking.notes}</p>}
        </details>
      )}
      {canOperate ? (
        <button
          type="button"
          className={cn(styles.primaryButton, styles.detailAction)}
          onClick={onOperate}
        >
          <ArrowRight size={15} aria-hidden="true" />
          {action}
        </button>
      ) : (
        <p className={styles.notice}>
          {text(
            "当前仅可查看房态，或房间存在限制；新建预订与保洁需对应操作权限。",
            "Consultation seule ou chambre restreinte ; réservation et ménage exigent les droits correspondants.",
          )}
        </p>
      )}
      <p className={styles.detailFoot}>
        {text(
          "打开后重新读取实时信息，确认后才执行。",
          "Informations relues à l'ouverture ; action après confirmation.",
        )}
      </p>
    </aside>
  );
}
