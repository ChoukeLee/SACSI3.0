import "server-only";

import Link from "next/link";

import { createClient } from "@/lib/supabase/server";
import { fetchAllPages } from "@/lib/supabase/fetch-all";
import { parseFinanceRead } from "./finance-read";
import { CimacExportActions } from "./cimac-export-actions";
import { FinanceWorkbench } from "./finance-workbench";
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
}: {
  params: Record<string, string | string[] | undefined>;
  locale: "zh" | "fr";
  canWrite: boolean;
}) {
  const query = parseFinanceRead(params);
  const mode = financeWorkbenchMode(params, query.kind);
  const client = await createClient();
  // No units, payment facts or reconciliation scan on the main ledger path.
  const [buildings, projects, report] = await Promise.all([
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
    mode === "reconciliation"
      ? Promise.resolve(null)
      : client.rpc("finance_read_rpc", {
          p_kind: query.kind,
          p_filters: query.filters,
          p_page: query.page,
        }),
  ]);
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
