import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { routeFor, type Locale } from "@/lib/i18n";
import { OperationalPage } from "@/components/ui/operational";
import styles from "./lease-workbench.module.css";

export function LeaseWorkbenchFrame({
  locale,
  workArea = "sacsi",
  view = "browse",
  action,
  children,
}: {
  locale: Locale;
  workArea?: "sacsi" | "cimac";
  view?: "browse" | "collections";
  action?: ReactNode;
  children: ReactNode;
}) {
  const zh = locale === "zh";
  const cimac = workArea === "cimac";
  const title = cimac
    ? zh
      ? "合同与履约"
      : "Contrats et exécution"
    : view === "collections"
      ? zh
        ? "收款跟进"
        : "Suivi des loyers"
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

export function LeaseCollectionsBackLink({ locale }: { locale: Locale }) {
  return (
    <Link className={styles.browseAction} href={routeFor(locale, "/leases")} prefetch={false}>
      <ArrowLeft size={16} aria-hidden="true" />
      {locale === "zh" ? "返回长租" : "Revenir aux locations"}
    </Link>
  );
}
