import type { Locale } from "@/lib/i18n";
import styles from "./daily-workbench.module.css";

/** Lightweight streaming shell matching the operations workbench without its JS. */
export function CalendarSkeleton({ locale }: { locale: Locale }) {
  return (
    <section
      className={styles.workbench}
      aria-busy="true"
      aria-label={locale === "zh" ? "日租运营台加载中" : "Chargement des opérations"}
    >
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>DAILY OPERATIONS</p>
          <h1 className={styles.title}>{locale === "zh" ? "日租运营台" : "Locations courtes"}</h1>
        </div>
      </header>
      <div className={styles.workspace}>
        <div className={styles.board}>
          <div className={styles.boardHeader}>
            <h2>{locale === "zh" ? "今天需要处理" : "À traiter aujourd'hui"}</h2>
          </div>
          <div className={styles.empty} role="status">
            {locale === "zh"
              ? "正在读取实时房态与订单…"
              : "Lecture de l'occupation et des séjours…"}
          </div>
        </div>
        <div className={styles.inspector}>
          <div className="h-5 w-28 animate-pulse rounded bg-muted" />
          <div className="mt-6 h-32 animate-pulse rounded bg-muted/50" />
        </div>
      </div>
    </section>
  );
}
