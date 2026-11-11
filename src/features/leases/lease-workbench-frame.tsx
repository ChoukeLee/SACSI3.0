import type { ReactNode } from "react";
import type { Locale } from "@/lib/i18n";
import { OperationalPage } from "@/components/ui/operational";
import styles from "./lease-workbench.module.css";

export function LeaseWorkbenchFrame({
  locale,
  workArea = "sacsi",
  action,
  children,
}: {
  locale: Locale;
  workArea?: "sacsi" | "cimac";
  action?: ReactNode;
  children: ReactNode;
}) {
  const zh = locale === "zh";
  const cimac = workArea === "cimac";
  const title = cimac
    ? zh
      ? "合同与履约"
      : "Contrats et exécution"
    : zh
      ? "长租"
      : "Locations longue durée";
  return (
    <OperationalPage
      className={cimac ? styles.workbench : `${styles.workbench} ${styles.leaseHome}`}
      eyebrow={cimac ? "CIMAC · CONTRACTS" : undefined}
      title={title}
      description={
        cimac
          ? zh
            ? "合同、应收与收款，在同一个工作区核对。"
            : "Contrats, créances et encaissements réunis pour vérification."
          : undefined
      }
      action={action}
    >
      {children}
    </OperationalPage>
  );
}
