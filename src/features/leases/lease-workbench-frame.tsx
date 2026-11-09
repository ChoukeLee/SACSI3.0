import type { ReactNode } from "react";
import type { Locale } from "@/lib/i18n";
import { OperationalPage } from "@/components/ui/operational";
import styles from "./lease-workbench.module.css";

export function LeaseWorkbenchFrame({
  locale,
  workArea = "sacsi",
  navigation,
  action,
  children,
}: {
  locale: Locale;
  workArea?: "sacsi" | "cimac";
  navigation?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}) {
  const zh = locale === "zh";
  const cimac = workArea === "cimac";
  return (
    <OperationalPage
      className={styles.workbench}
      eyebrow={cimac ? "CIMAC · CONTRACTS" : zh ? "SACSI · 租赁管理" : "SACSI · Locations"}
      title={
        cimac
          ? zh
            ? "合同与履约"
            : "Contrats et exécution"
          : zh
            ? "长租工作台"
            : "Locations longue durée"
      }
      description={
        cimac
          ? zh
            ? "合同、应收与收款，在同一个工作区核对。"
            : "Contrats, créances et encaissements réunis pour vérification."
          : zh
            ? "按类别和分组查看资产、租户、租金与已交至，打开资料或跟进收款。"
            : "Consultez les biens, locataires et loyers par catégorie et par groupe, puis ouvrez leur dossier ou le suivi des loyers."
      }
      action={action}
    >
      {navigation}
      {children}
    </OperationalPage>
  );
}
