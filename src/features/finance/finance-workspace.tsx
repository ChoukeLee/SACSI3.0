import "server-only";

import Link from "next/link";

import { createClient } from "@/lib/supabase/server";
import { fetchAllPages } from "@/lib/supabase/fetch-all";
import { parseFinanceRead } from "./finance-read";
import { CimacExportActions } from "./cimac-export-actions";
import { FinanceWorkbench } from "./finance-workbench";
import { CimacCustomerWorkbench } from "./cimac-customer-workbench";
import { readCimacCustomerAccount } from "./cimac-billing-read";
import { parseCimacBillingQuery, wantsCimacCustomerWorkspace } from "./cimac-billing-query";
import {
  decodeFinanceReconciliation,
  decodeFinanceWorkbenchRead,
  financeWorkbenchKey,
  financeWorkbenchMode,
  financeScopeIsValid,
  type FinanceBuildingOption,
  type FinanceProjectOption,
  type FinanceReconciliation,
} from "./finance-workbench-model";

export async function FinanceWorkspace({
  params,
  locale,
  canWrite,
  viewerId,
}: {
  params: Record<string, string | string[] | undefined>;
  locale: "zh" | "fr";
  canWrite: boolean;
  viewerId?: string;
}) {
  const client = await createClient();
  const explicitLegacy =
    params.view !== "customers" &&
    !!(
      params.kind ||
      params.view ||
      params.buildingId ||
      params.dateFrom ||
      params.dateTo ||
      params.direction ||
      params.category ||
      params.status ||
      params.management ||
      params.outstandingOnly ||
      params.page
    );
  const legacyQuery = explicitLegacy ? parseFinanceRead(params) : null;
  const legacyMode = legacyQuery ? financeWorkbenchMode(params, legacyQuery.kind) : null;
  // Keep the established ledger's metadata and paged read parallel. The new
  // customer path does not preload every customer's financial history.
  const earlyReport =
    legacyQuery && legacyMode !== "reconciliation"
      ? client.rpc("finance_read_rpc", {
          p_kind: legacyQuery.kind,
          p_filters: legacyQuery.filters,
          p_page: legacyQuery.page,
        })
      : null;
  const [buildings, projects, loadedReport] = await Promise.all([
    fetchAllPages<FinanceBuildingOption>(
      (from, to) =>
        client
          .from("buildings")
          .select("id,project_id,display_name,code")
          .order("id")
          .range(from, to),
      "finance buildings",
    ),
    fetchAllPages<FinanceProjectOption>(
      (from, to) =>
        client.from("projects").select("id,code,display_name").order("id").range(from, to),
      "finance projects",
    ),
    earlyReport,
  ]);
  const cimac = projects.find((project) => project.code === "CIMAC");
  if (wantsCimacCustomerWorkspace(params, cimac?.id)) {
    const query = parseCimacBillingQuery(params);
    if (!cimac || (params.projectId && params.projectId !== cimac.id) || !viewerId) {
      return (
        <section role="alert" className="space-y-3 rounded-xl border bg-card p-6">
          <h1 className="text-lg font-semibold">
            {locale === "zh" ? "建材城客户总账不可用" : "Comptes clients CIMAC indisponibles"}
          </h1>
          <p className="text-sm text-muted-foreground">
            {locale === "zh"
              ? "当前账号无权访问该项目，或所选范围不匹配。"
              : "Projet inaccessible ou périmètre incompatible."}
          </p>
          <Link href={`${locale === "fr" ? "/fr" : ""}/finance?kind=ledger`}>
            {locale === "zh" ? "打开通用财务" : "Ouvrir la comptabilité générale"}
          </Link>
        </section>
      );
    }
    try {
      const data = await readCimacCustomerAccount(client, query);
      if (data.project.id !== cimac.id) throw new Error("CimacAccountUnavailable");
      return (
        <CimacCustomerWorkbench
          key={`${viewerId}:${data.selectedCustomerId ?? "empty"}:${query.customerPage}:${query.search}`}
          data={data}
          locale={locale}
          canWrite={canWrite && data.canWrite}
          viewerId={viewerId}
          query={query}
          today={new Date().toISOString().slice(0, 10)}
        />
      );
    } catch {
      return (
        <section role="alert" className="space-y-3 rounded-xl border bg-card p-6">
          <h1 className="text-lg font-semibold">
            {locale === "zh" ? "暂时无法读取完整客户总账" : "Compte client complet indisponible"}
          </h1>
          <p className="text-sm text-muted-foreground">
            {locale === "zh"
              ? "没有将读取失败显示为零余额。请刷新重试，或使用原有财务入口核对；历史账务未被修改。"
              : "Un échec de lecture n’est pas un solde nul. Réessayez ou consultez les écritures existantes ; aucun historique n’a été modifié."}
          </p>
          <Link href={`${locale === "fr" ? "/fr" : ""}/finance?kind=ledger&projectId=${cimac.id}`}>
            {locale === "zh" ? "查看原有收支流水" : "Consulter les écritures existantes"}
          </Link>
        </section>
      );
    }
  }
  const query = legacyQuery ?? parseFinanceRead(params);
  const mode = legacyMode ?? financeWorkbenchMode(params, query.kind);
  if (!financeScopeIsValid(query, projects, buildings)) {
    return (
      <section role="alert" className="space-y-3 rounded-xl border bg-card p-6">
        <h1 className="text-lg font-semibold">
          {locale === "zh" ? "当前筛选范围不可用" : "Périmètre indisponible"}
        </h1>
        <p className="text-sm text-muted-foreground">
          {locale === "zh"
            ? "项目或楼栋不存在、无权访问，或两者不匹配。没有将这个范围显示为“全部”或零账目。"
            : "Projet ou bâtiment absent, inaccessible ou incompatible. Ce périmètre n’est présenté ni comme global ni comme un total nul."}
        </p>
        <Link
          className="inline-flex rounded-md border px-3 py-2 text-sm"
          href={`${locale === "fr" ? "/fr" : ""}/finance`}
        >
          {locale === "zh" ? "重新选择授权范围" : "Choisir un périmètre autorisé"}
        </Link>
      </section>
    );
  }
  const report =
    mode === "reconciliation"
      ? null
      : (loadedReport ??
        (await client.rpc("finance_read_rpc", {
          p_kind: query.kind,
          p_filters: query.filters,
          p_page: query.page,
        })));
  if (mode !== "reconciliation" && (!report || report.error || !report.data))
    throw new Error("FinanceReadUnavailable");
  const result = report ? decodeFinanceWorkbenchRead(report.data, query.kind, query.page) : null;
  let reconciliation: FinanceReconciliation | null = null;
  if (mode === "reconciliation") {
    try {
      const { data, error } = await client.rpc("finance_reconciliation_rpc");
      if (error || !data) throw new Error("FinanceReconciliationUnavailable");
      reconciliation = decodeFinanceReconciliation(data);
    } catch {
      reconciliation = { available: false, count: null, issues: [] };
    }
  }
  return (
    <FinanceWorkbench
      key={financeWorkbenchKey(query, mode)}
      scopeKey={financeWorkbenchKey(query, mode)}
      query={query}
      mode={mode}
      result={result}
      projects={projects}
      buildings={buildings}
      reconciliation={reconciliation}
      locale={locale}
      canWrite={canWrite}
      today={new Date().toISOString().slice(0, 10)}
      exportActions={
        <CimacExportActions kind={query.kind} filters={query.filters} locale={locale} />
      }
    />
  );
}
