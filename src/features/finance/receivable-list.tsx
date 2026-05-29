"use client";

import { useState, useMemo } from "react";
import { Download } from "lucide-react";
import type { Locale } from "@/lib/i18n";
import { dictionaries } from "@/lib/i18n";
import { formatXof, cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { MetricCard } from "@/components/metric-card";
import {
  calculateReceivableSummary,
  buildReceivableCsv,
} from "@/features/finance/receivable-summary";
import type { ReceivableRow, BuildingRow } from "@/types/database";

interface UnitSummary {
  id: string; unit_no: string; building_id: string;
}

interface CustomerSummary {
  id: string; name: string;
}

interface Props {
  receivables: ReceivableRow[];
  units: UnitSummary[];
  customers: CustomerSummary[];
  buildings: BuildingRow[];
  locale: Locale;
}

const statusTone: Record<string, "default" | "secondary" | "destructive" | "outline" | "warning" | "success"> = {
  pending: "secondary",
  partial: "warning",
  paid: "success",
  overdue: "destructive",
  cancelled: "outline",
};

const rowBg: Record<string, string> = {
  partial: "bg-amber-50/30",
  overdue: "bg-red-50/30",
  cancelled: "opacity-60",
};

export function ReceivableList({ receivables, units, customers, buildings, locale }: Props) {
  const t = dictionaries[locale].receivables;
  const [statusFilter, setStatusFilter] = useState("all");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [buildingFilter, setBuildingFilter] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const unitMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const u of units) m.set(u.id, u.unit_no);
    return m;
  }, [units]);

  const unitBuildingMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const u of units) m.set(u.id, u.building_id);
    return m;
  }, [units]);

  const customerMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of customers) m.set(c.id, c.name);
    return m;
  }, [customers]);

  const buildingMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const b of buildings) m.set(b.id, b.display_name || b.code);
    return m;
  }, [buildings]);

  const filtered = useMemo(() => {
    return receivables.filter((r) => {
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      if (sourceFilter !== "all" && r.source_type !== sourceFilter) return false;
      if (buildingFilter !== "all") {
        const bid = r.building_id ?? unitBuildingMap.get(r.unit_id ?? "") ?? null;
        if (buildingFilter === "__unassigned__") {
          if (bid !== null) return false;
        } else {
          if (bid !== buildingFilter) return false;
        }
      }
      if (dateFrom && r.due_date < dateFrom) return false;
      if (dateTo && r.due_date > dateTo) return false;
      return true;
    });
  }, [receivables, statusFilter, sourceFilter, buildingFilter, dateFrom, dateTo, unitBuildingMap]);

  const summary = useMemo(
    () => calculateReceivableSummary(filtered),
    [filtered],
  );

  const overdueDays = (r: ReceivableRow) => {
    if (r.status === "paid" || r.status === "cancelled") return null;
    const today = new Date().toISOString().slice(0, 10);
    if (r.due_date >= today) return null;
    return Math.floor((Date.now() - new Date(r.due_date).getTime()) / 86400000);
  };

  const handleExportCsv = () => {
    const csv = buildReceivableCsv(filtered, unitMap, buildingMap, customerMap, {
      daily_booking: t.sourceTypes.daily_booking,
      lease_contract: t.sourceTypes.lease_contract,
      sale_contract: t.sourceTypes.sale_contract,
      manual: t.sourceTypes.manual,
      daily_rental: t.categories.daily_rental,
      lease_rent: t.categories.lease_rent,
      lease_deposit: t.categories.lease_deposit,
      sale_installment: t.categories.sale_installment,
      sale_lump_sum: t.categories.sale_lump_sum,
      other: t.categories.other,
      pending: t.statuses.pending,
      partial: t.statuses.partial,
      paid: t.statuses.paid,
      overdue: t.statuses.overdue,
      cancelled: t.statuses.cancelled,
    });
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `receivables_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const resolveBuildingName = (r: ReceivableRow) => {
    const bid = r.building_id ?? unitBuildingMap.get(r.unit_id ?? "") ?? null;
    if (!bid) return "—";
    return buildingMap.get(bid) ?? "—";
  };

  const filterBtn = "h-9 rounded-md border bg-card px-3 py-2 text-sm shadow-sm transition-colors hover:border-ring/30 focus:outline-none focus:ring-2 focus:ring-ring/20";
  const filterDate = cn(filterBtn, "w-[150px]");

  const collectionTone = summary.collectionRate >= 0.8 ? "green" : summary.collectionRate >= 0.5 ? "amber" : "red";

  return (
    <div className="space-y-5">
      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <MetricCard title={t.summary.totalReceivable} value={formatXof(summary.totalReceivable)} tone="indigo" />
        <MetricCard title={t.summary.totalPaid} value={formatXof(summary.totalPaid)} tone="green" />
        <MetricCard title={t.summary.totalOutstanding} value={formatXof(summary.outstanding)} tone="amber" />
        <MetricCard title={t.summary.totalOverdue} value={formatXof(summary.overdue)} tone="red" />
        <MetricCard
          title={t.summary.collectionRate}
          value={`${(summary.collectionRate * 100).toFixed(1)}%`}
          tone={collectionTone}
        />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className={filterBtn}>
          <option value="all">{t.filters.status}: {t.filters.all}</option>
          {Object.entries(t.statuses).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select value={sourceFilter} onChange={e => setSourceFilter(e.target.value)} className={filterBtn}>
          <option value="all">{t.filters.sourceType}: {t.filters.all}</option>
          {Object.entries(t.sourceTypes).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select value={buildingFilter} onChange={e => setBuildingFilter(e.target.value)} className={filterBtn}>
          <option value="all">{t.filters.building}: {t.filters.all}</option>
          {buildings.map(b => <option key={b.id} value={b.id}>{b.display_name || b.code}</option>)}
          <option value="__unassigned__">{locale === "zh" ? "未归属" : "Non attribué"}</option>
        </select>
        <input
          type="date" value={dateFrom}
          onChange={e => setDateFrom(e.target.value)}
          className={filterDate}
          title={locale === "zh" ? "起始日期" : "Date début"}
        />
        <span className="text-xs font-semibold text-muted-foreground">-</span>
        <input
          type="date" value={dateTo}
          onChange={e => setDateTo(e.target.value)}
          className={filterDate}
          title={locale === "zh" ? "结束日期" : "Date fin"}
        />
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={handleExportCsv}
            disabled={filtered.length === 0}
            className="inline-flex items-center gap-1.5 rounded-md border bg-card px-3 py-2 text-sm font-semibold shadow-sm transition-colors hover:bg-accent disabled:opacity-40"
          >
            <Download className="h-4 w-4" />{t.export.csv}
          </button>
          <span className="text-xs font-semibold text-muted-foreground">
            {filtered.length} {locale === "zh" ? "条" : "lignes"}
          </span>
        </div>
      </div>

      {/* Table */}
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border bg-card py-16 shadow-sm">
          <p className="text-sm font-semibold text-muted-foreground">{t.empty}</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13px] min-w-[980px]">
              <thead className="border-b bg-muted text-xs font-semibold uppercase tracking-[0.04em] text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5">{t.columns.dueDate}</th>
                  <th className="px-4 py-2.5">{t.columns.building}</th>
                  <th className="px-4 py-2.5">{t.columns.unit}</th>
                  <th className="px-4 py-2.5">{t.columns.customer}</th>
                  <th className="px-4 py-2.5">{t.columns.sourceType}</th>
                  <th className="px-4 py-2.5">{t.columns.title}</th>
                  <th className="px-4 py-2.5 text-right">{t.columns.amount}</th>
                  <th className="px-4 py-2.5 text-right">{t.columns.paid}</th>
                  <th className="px-4 py-2.5 text-right">{t.columns.outstanding}</th>
                  <th className="px-4 py-2.5">{t.columns.status}</th>
                  <th className="px-4 py-2.5 text-right">{t.columns.overdueDays}</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {filtered.map(r => {
                  const os = Number(r.amount_xof) - Number(r.paid_amount_xof);
                  const od = overdueDays(r);
                  return (
                    <tr key={r.id} className={cn("transition-colors hover:bg-accent/50", rowBg[r.status] ?? "")}>
                      <td className="px-4 py-2.5 whitespace-nowrap text-muted-foreground">{r.due_date}</td>
                      <td className="px-4 py-2.5 whitespace-nowrap text-muted-foreground">{resolveBuildingName(r)}</td>
                      <td className="px-4 py-2.5 font-mono text-sm font-bold">{unitMap.get(r.unit_id ?? "") ?? "-"}</td>
                      <td className="max-w-[120px] truncate px-4 py-2.5">{customerMap.get(r.customer_id ?? "") ?? "-"}</td>
                      <td className="px-4 py-2.5">
                        <Badge variant="secondary" className="text-xs">
                          {t.sourceTypes[r.source_type as keyof typeof t.sourceTypes] ?? r.source_type}
                        </Badge>
                      </td>
                      <td className="max-w-[180px] truncate px-4 py-2.5">{r.title}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums font-semibold">{formatXof(Number(r.amount_xof))}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-emerald-600">{formatXof(Number(r.paid_amount_xof))}</td>
                      <td className={cn("px-4 py-2.5 text-right tabular-nums font-semibold", os > 0 ? "text-rose-600" : "text-emerald-600")}>{formatXof(os)}</td>
                      <td className="px-4 py-2.5">
                        <Badge variant={statusTone[r.status] ?? "secondary"}>{t.statuses[r.status as keyof typeof t.statuses] ?? r.status}</Badge>
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums">
                        {od !== null && od > 0 ? (
                          <span className="text-rose-600 font-semibold">+{od}</span>
                        ) : od !== null && od === 0 ? (
                          <span className="text-muted-foreground">0</span>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
