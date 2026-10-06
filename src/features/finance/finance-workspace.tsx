import "server-only";

import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { fetchAllPages } from "@/lib/supabase/fetch-all";
import { formatXof } from "@/lib/utils";
import { parseFinanceRead, type FinanceReadResult } from "./finance-read";
import { ManualEntryForm } from "./manual-entry-form";

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
  const supabase = await createClient();
  const [report, buildings, units, reconciliation] = await Promise.all([
    supabase.rpc("finance_read_rpc", {
      p_kind: query.kind,
      p_filters: query.filters,
      p_page: query.page,
    }),
    fetchAllPages<{ id: string; display_name: string; code: string }>(
      (from, to) =>
        supabase
          .from("buildings")
          .select("id,display_name,code")
          .eq("is_active", true)
          .order("id")
          .range(from, to),
      "buildings",
    ),
    canWrite
      ? fetchAllPages<{ id: string; unit_no: string; building_id: string }>(
          (from, to) =>
            supabase.from("units").select("id,unit_no,building_id").order("id").range(from, to),
          "units",
        )
      : Promise.resolve([]),
    supabase.rpc("finance_reconciliation_rpc"),
  ]);
  if (report.error || !report.data || reconciliation.error || !reconciliation.data)
    throw new Error("FinanceReadUnavailable");
  const result = report.data as FinanceReadResult;
  const zh = locale === "zh";
  const quality = reconciliation.data as {
    count: number;
    issues: { code: string; entity_id: string }[];
  };
  const href = (page: number) =>
    "?" + new URLSearchParams({ ...query.filters, kind: query.kind, page: String(page) });
  const exportHref =
    "/api/finance/export?" + new URLSearchParams({ ...query.filters, kind: query.kind });
  const summaries =
    query.kind === "ledger"
      ? [
          ["income", zh ? "收入（不含押金）" : "Revenus"],
          ["expense", zh ? "费用" : "Dépenses"],
          ["liability_in", zh ? "押金/负债流入" : "Entrées de passif"],
          ["liability_out", zh ? "押金/负债流出" : "Sorties de passif"],
        ]
      : [
          ["receivable", zh ? "应收" : "Dû"],
          ["paid", zh ? "已收" : "Reçu"],
          ["outstanding", zh ? "未收" : "Solde"],
          ["overdue", zh ? "逾期" : "En retard"],
        ];
  const columns =
    query.kind === "ledger"
      ? [
          "entry_date",
          "building_label",
          "unit_label",
          "direction",
          "category",
          "amount_xof",
          "description",
        ]
      : [
          "due_date",
          "building_label",
          "unit_label",
          "title",
          "amount_xof",
          "paid_amount_xof",
          "status",
        ];
  const labels: Record<string, string> = zh
    ? {
        entry_date: "日期",
        due_date: "到期日",
        building_label: "楼栋",
        unit_label: "房号",
        direction: "收支",
        category: "类别",
        amount_xof: "金额 XOF",
        paid_amount_xof: "已收 XOF",
        description: "说明",
        title: "事项",
        status: "状态",
      }
    : {};
  const cls = "rounded-md border bg-background p-2 text-sm";
  return (
    <div className="space-y-4">
      <form className="flex flex-wrap items-end gap-3" method="get">
        <label>
          {zh ? "账表" : "Vue"}
          <select name="kind" defaultValue={query.kind} className={`${cls} block`}>
            <option value="ledger">{zh ? "收支账" : "Journal"}</option>
            <option value="receivables">{zh ? "应收账" : "Créances"}</option>
          </select>
        </label>
        <label>
          {zh ? "楼栋" : "Bâtiment"}
          <select
            name="buildingId"
            defaultValue={query.filters.buildingId}
            className={`${cls} block`}
          >
            <option value="">{zh ? "全部" : "Tous"}</option>
            {buildings.map((b) => (
              <option key={b.id} value={b.id}>
                {b.display_name || b.code}
              </option>
            ))}
          </select>
        </label>
        <label>
          {zh ? "起日" : "Du"}
          <input
            name="dateFrom"
            type="date"
            defaultValue={query.filters.dateFrom}
            className={`${cls} block`}
          />
        </label>
        <label>
          {zh ? "止日" : "Au"}
          <input
            name="dateTo"
            type="date"
            defaultValue={query.filters.dateTo}
            className={`${cls} block`}
          />
        </label>
        <label>
          {zh ? "搜索" : "Recherche"}
          <input
            name="search"
            defaultValue={query.filters.search}
            maxLength={150}
            className={`${cls} block`}
          />
        </label>
        {query.kind === "ledger" ? (
          <>
            <select
              aria-label={zh ? "方向" : "Direction"}
              name="direction"
              defaultValue={query.filters.direction}
              className={cls}
            >
              <option value="">{zh ? "所有收支" : "Toutes directions"}</option>
              {["income", "expense", "liability_in", "liability_out"].map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
            <input
              aria-label={zh ? "类别" : "Catégorie"}
              name="category"
              defaultValue={query.filters.category}
              placeholder={zh ? "类别" : "Catégorie"}
              className={cls}
            />
          </>
        ) : (
          <>
            <select
              aria-label={zh ? "状态" : "Statut"}
              name="status"
              defaultValue={query.filters.status}
              className={cls}
            >
              <option value="">{zh ? "所有状态" : "Tous statuts"}</option>
              {["pending", "partial", "paid", "overdue", "cancelled"].map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
            <select
              aria-label={zh ? "管理范围" : "Gestion"}
              name="management"
              defaultValue={query.filters.management || "managed"}
              className={cls}
            >
              <option value="managed">{zh ? "系统管理" : "Gérées"}</option>
              <option value="historical_pending">
                {zh ? "历史待核对" : "Historique à vérifier"}
              </option>
              <option value="excluded">{zh ? "已排除" : "Exclues"}</option>
              <option value="all">{zh ? "全部" : "Toutes"}</option>
            </select>
          </>
        )}
        <button className="rounded-md bg-primary p-2 text-primary-foreground">
          {zh ? "查询" : "Filtrer"}
        </button>
        <a href={exportHref} className={cls}>
          {zh ? "导出完整筛选结果" : "Exporter les résultats"}
        </a>
      </form>
      <div className="grid gap-3 sm:grid-cols-4">
        {summaries.map(([key, label]) => (
          <div key={key} className="rounded-xl border bg-card p-4">
            <div className="text-sm text-muted-foreground">{label}</div>
            <strong className="text-xl">{formatXof(Number(result.summary[key]))}</strong>
          </div>
        ))}
      </div>
      <p className="text-sm text-muted-foreground">
        {zh
          ? "合计按全部筛选范围中的有效管理记录计算（取消、历史待核对及排除项不计），明细每页 50 条。"
          : "Totaux des écritures et créances gérées valides ; 50 lignes par page."}{" "}
        {result.total} {zh ? "条" : "lignes"}
      </p>
      <div className="overflow-x-auto rounded-xl border">
        <table className="w-full text-sm">
          <thead>
            <tr>
              {columns.map((key) => (
                <th key={key} className="p-3 text-left">
                  {labels[key] || key}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {result.rows.map((row) => (
              <tr key={String(row.id)} className="border-t">
                {columns.map((key) => (
                  <td key={key} className="p-3">
                    {key.endsWith("amount_xof") ? formatXof(Number(row[key])) : (row[key] ?? "—")}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {!result.rows.length && <p className="p-6">{zh ? "没有匹配记录" : "Aucun résultat"}</p>}
      </div>
      <nav className="flex gap-4" aria-label="Pagination">
        {query.page > 1 && <Link href={href(query.page - 1)}>{zh ? "上一页" : "Précédent"}</Link>}
        <span>
          {query.page} / {Math.max(1, Math.ceil(result.total / 50))}
        </span>
        {query.page * 50 < result.total && (
          <Link href={href(query.page + 1)}>{zh ? "下一页" : "Suivant"}</Link>
        )}
      </nav>
      {canWrite && <ManualEntryForm buildings={buildings} units={units} zh={zh} />}
      <details className="rounded-xl border bg-card p-4">
        <summary>
          {zh ? "财务关联待核对" : "Rapprochement à examiner"} · {quality.count}
        </summary>
        <p className="mt-3 text-sm text-muted-foreground">
          {zh
            ? "自动检查不修改金额；历史缺失链接不能按猜测补账。最多展示 100 项。"
            : "Lecture seule ; aucune correction automatique. Maximum 100 éléments."}
        </p>
        <ul className="mt-3 space-y-2 text-sm">
          {quality.issues.map((issue) => (
            <li key={issue.code + issue.entity_id}>
              {issue.code} · {issue.entity_id}
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}
