import type { Locale } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import styles from "./daily-workbench.module.css";

/** Calendar-first streaming shell: no inferred room identities, counts, or occupancy. */
export function CalendarSkeleton({ locale }: { locale: Locale }) {
  return (
    <section
      className={cn(styles.workbench, styles.compactPage)}
      aria-busy="true"
      aria-label={locale === "zh" ? "日租房态加载中" : "Chargement de l'occupation"}
    >
      <header className={cn(styles.header, styles.compactHeader)}>
        <div className={styles.compactHeaderCopy}>
          <h1 className={styles.title}>{locale === "zh" ? "日租房态" : "Locations courtes"}</h1>
        </div>
      </header>
      <div className={cn(styles.workspace, styles.stageWide)}>
        <div className={styles.board}>
          <div className={styles.boardHeader}>
            <h2>{locale === "zh" ? "房态日历" : "Calendrier des chambres"}</h2>
          </div>
          <p className="px-3 py-2 text-xs leading-5 text-muted-foreground" role="status">
            {locale === "zh"
              ? "正在读取实时房态与订单…"
              : "Lecture de l'occupation et des séjours…"}
          </p>
          <div aria-hidden="true" className="border-t">
            <div className="flex h-10 items-center gap-4 border-b bg-muted/40 px-3">
              <div className="h-3 w-12 rounded bg-muted motion-safe:animate-pulse" />
              <div className="h-3 w-40 max-w-full rounded bg-muted motion-safe:animate-pulse" />
            </div>
            {Array.from({ length: 8 }, (_, index) => (
              <div
                key={index}
                data-calendar-skeleton-row
                className="flex h-10 min-w-0 items-center gap-4 border-b px-3 last:border-b-0"
              >
                <div className="h-3 w-12 shrink-0 rounded bg-muted motion-safe:animate-pulse" />
                <div className="h-6 min-w-0 flex-1 rounded bg-muted/50 motion-safe:animate-pulse" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
