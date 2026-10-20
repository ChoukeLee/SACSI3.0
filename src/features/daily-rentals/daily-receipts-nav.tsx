import Link from "next/link";
import { CalendarDays, ChartNoAxesCombined } from "lucide-react";
import styles from "./receipt-analysis.module.css";

export function DailyReceiptsNav({
  locale,
  active,
  userRole,
}: {
  locale: "zh" | "fr";
  active: "calendar" | "receipts";
  userRole?: string;
}) {
  if (userRole && !["admin", "finance", "boss"].includes(userRole)) return null;
  const prefix = locale === "fr" ? "/fr" : "";
  return (
    <nav
      className={styles.nav}
      aria-label={locale === "fr" ? "Vues des locations courtes" : "日租视图"}
    >
      <Link
        href={`${prefix}/daily-rentals`}
        aria-current={active === "calendar" ? "page" : undefined}
      >
        <CalendarDays size={16} aria-hidden="true" />
        {locale === "fr" ? "Calendrier" : "房态日历"}
      </Link>
      <Link
        href={`${prefix}/daily-rentals/receipts`}
        aria-current={active === "receipts" ? "page" : undefined}
      >
        <ChartNoAxesCombined size={16} aria-hidden="true" />
        {locale === "fr" ? "Encaissements" : "收款分析"}
      </Link>
    </nav>
  );
}
