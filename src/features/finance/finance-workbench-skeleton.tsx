import { OperationalPageSkeleton } from "@/components/operational-page-skeleton";
import styles from "./finance-workbench.module.css";

/** Keep the page identity visible while authorized totals are still loading. */
export function FinanceWorkbenchSkeleton({ locale }: { locale: "zh" | "fr" }) {
  return (
    <div className={styles.workbench} aria-busy="true">
      <header className={styles.heading}>
        <div>
          <p className={styles.eyebrow}>FINANCE WORKSPACE</p>
          <h1>{locale === "zh" ? "财务工作台" : "Espace finance"}</h1>
          <p className={styles.subtitle}>
            {locale === "zh"
              ? "正在读取授权账目与汇总，不会以零替代未知数据。"
              : "Lecture des écritures et totaux autorisés, sans remplacer l’inconnu par zéro."}
          </p>
        </div>
      </header>
      <OperationalPageSkeleton kind="table" rows={8} />
    </div>
  );
}
