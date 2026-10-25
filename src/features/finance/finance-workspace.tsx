import "server-only";

import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { fetchAllPages } from "@/lib/supabase/fetch-all";
import { parseFinanceRead } from "./finance-read";
import { CimacExportActions } from "./cimac-export-actions";
import { FinanceWorkbench } from "./finance-workbench";
import {
  decodeFinanceWorkbenchRead,
  financeWorkbenchKey,
  financeWorkbenchMode,
  financeScopeIsValid,
  type FinanceBuildingOption,
  type FinanceProjectOption,
} from "./finance-workbench-model";

/** Shared content loader. Each workspace route fixes its project before the RPC. */
export async function FinanceWorkspace({
  params,
  locale,
  canWrite,
  workArea = "sacsi",
}: {
  params: Record<string, string | string[] | undefined>;
  locale: "zh" | "fr";
  canWrite: boolean;
  viewerId?: string;
  workArea?: "sacsi" | "cimac";
}) {
  const query = parseFinanceRead(params);
  const mode = financeWorkbenchMode(params, query.kind);
  const client = await createClient();
  const [allBuildings, allProjects] = await Promise.all([
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
  ]);
  const projects = allProjects.filter(
    (project) => project.code.toUpperCase() === workArea.toUpperCase(),
  );
  if (projects.length !== 1) throw new Error("FinanceWorkspaceProjectUnavailable");
  const project = projects[0];
  const buildings = allBuildings.filter((building) => building.project_id === project.id);
  const projectMismatch = !!query.filters.projectId && query.filters.projectId !== project.id;
  query.filters.projectId = project.id;
  const prefix = `${locale === "fr" ? "/fr" : ""}${workArea === "cimac" ? "/cimac" : ""}`;
  if (projectMismatch || !financeScopeIsValid(query, projects, buildings)) {
    return (
      <section role="alert" className="space-y-3 rounded-xl border bg-card p-6">
        <h1 className="text-lg font-semibold">
          {locale === "zh" ? "当前筛选范围不可用" : "Périmètre indisponible"}
        </h1>
        <p className="text-sm text-muted-foreground">
          {locale === "zh"
            ? "所选楼栋不属于当前工作区，或无权访问。没有改成全部项目或零账目。"
            : "Bâtiment incompatible ou inaccessible. Aucun remplacement par tous les projets ou un solde nul."}
        </p>
        <Link href={`${prefix}/finance?kind=ledger`}>
          {locale === "zh" ? "返回当前工作区流水" : "Revenir au journal de cet espace"}
        </Link>
      </section>
    );
  }
  let result = null;
  if (mode !== "reconciliation") {
    const report = await client.rpc("finance_read_rpc", {
      p_kind: query.kind,
      p_filters: query.filters,
      p_page: query.page,
    });
    if (report.error || !report.data) throw new Error("FinanceReadUnavailable");
    result = decodeFinanceWorkbenchRead(report.data, query.kind, query.page);
  }
  // The legacy reconciliation RPC has no project attribution. Company-wide
  // checks have their own explicitly named page instead of leaking into a project.
  return (
    <FinanceWorkbench
      key={financeWorkbenchKey(query, mode)}
      scopeKey={financeWorkbenchKey(query, mode)}
      query={query}
      mode={mode}
      result={result}
      projects={projects}
      buildings={buildings}
      reconciliation={
        mode === "reconciliation" ? { available: false, count: null, issues: [] } : null
      }
      locale={locale}
      canWrite={canWrite}
      today={new Date().toISOString().slice(0, 10)}
      workArea={workArea}
      projectLocked
      reconciliationPending
      exportActions={
        <CimacExportActions
          kind={query.kind}
          filters={query.filters}
          locale={locale}
          workArea={workArea}
        />
      }
    />
  );
}
