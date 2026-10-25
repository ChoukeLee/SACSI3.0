import "server-only";
import Link from "next/link";
import { notFound } from "next/navigation";
import { hasPermission } from "@/lib/auth";
import { canReadCimacAccount } from "@/features/cimac/cimac-workspace-access";
import {
  CimacCustomersPage,
  getCimacWorkspaceContext,
  type CimacPageProps,
} from "@/features/cimac/cimac-workspace-pages";
import { FinanceWorkspace } from "./finance-workspace";

export async function CimacFinancePage({
  searchParams,
  locale,
}: CimacPageProps & { locale: "zh" | "fr" }) {
  const { user } = await getCimacWorkspaceContext();
  if (!canReadCimacAccount(user.role)) notFound();
  const params = await searchParams;
  if (params.kind || params.view === "reconciliation") {
    return (
      <FinanceWorkspace
        params={params}
        locale={locale}
        canWrite={hasPermission(user, "finance:write")}
        viewerId={user.id}
        workArea="cimac"
      />
    );
  }
  const prefix = locale === "fr" ? "/fr/cimac" : "/cimac";
  return (
    <div className="space-y-5">
      <nav
        className="flex flex-wrap gap-2 text-sm"
        aria-label={locale === "zh" ? "收费与资金视图" : "Vues de facturation"}
      >
        <Link
          className="rounded-lg bg-blue-50 px-3 py-2 text-blue-700"
          href={`${prefix}/finance`}
          aria-current="page"
        >
          {locale === "zh" ? "客户总账" : "Comptes clients"}
        </Link>
        <Link className="rounded-lg border px-3 py-2" href={`${prefix}/finance?kind=ledger`}>
          {locale === "zh" ? "收支流水" : "Écritures"}
        </Link>
        <Link className="rounded-lg border px-3 py-2" href={`${prefix}/finance?kind=receivables`}>
          {locale === "zh" ? "应收账" : "Créances"}
        </Link>
        <Link
          className="rounded-lg border px-3 py-2"
          href={`${locale === "fr" ? "/fr" : ""}/settings/finance-reconciliation`}
        >
          {locale === "zh" ? "公司级关联核对" : "Rapprochement de l’entreprise"}
        </Link>
        <Link className="rounded-lg border px-3 py-2" href={`${prefix}/reports`}>
          {locale === "zh" ? "经营分析" : "Analyse"}
        </Link>
      </nav>
      <CimacCustomersPage searchParams={Promise.resolve(params)} locale={locale} accounts />
    </div>
  );
}
