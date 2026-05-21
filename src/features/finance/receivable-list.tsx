"use client";

import { useState, useMemo } from "react";
import { Download } from "lucide-react";
import type { Locale } from "@/lib/i18n";
import { dictionaries } from "@/lib/i18n";
import { formatXof, cn } from "@/lib/utils";
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

const STATUS_STYLES: Record<string, string> = {
  pending:   "bg-slate-100 text-slate-700",
  partial:   "bg-brand-amber-100 text-brand-amber-700",
  paid:      "bg-brand-green-100 text-brand-green-700",
  overdue:   "bg-brand-red-100 text-brand-red-700",
  cancelled: "bg-slate-50 text-slate-400 line-through",
};

const ROW_BG: Record<string, string> = {
  overdue:   "bg-brand-red-50/30",
  partial:   "bg-brand-amber-50/30",
  paid:      "",
  pending:   "",
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

  const filterBtn = "rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 shadow-sm transition-all duration-fast hover:border-slate-300 hover:bg-slate-50 focus:border-brand-orange-300 focus:outline-none focus:ring-2 focus:ring-brand-orange-500/20";

  const resolveBuildingName = (r: ReceivableRow) => {
    const bid = r.building_id ?? unitBuildingMap.get(r.unit_id ?? "") ?? null;
    if (!bid) return "â€”";
    return buildingMap.get(bid) ?? "â€”";
  };

  return (
    <div>
      {/* Summary cards */}
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <MiniCard label={t.summary.totalReceivable} value={formatXof(summary.totalReceivable)} accent="ink" />
        <MiniCard label={t.summary.totalPaid} value={formatXof(summary.totalPaid)} accent="green" />
        <MiniCard label={t.summary.totalOutstanding} value={formatXof(summary.outstanding)} accent="orange" />
        <MiniCard label={t.summary.totalOverdue} value={formatXof(summary.overdue)} accent="red" />
        <MiniCard
          label={t.summary.collectionRate}
          value={`${(summary.collectionRate * 100).toFixed(1)}%`}
          accent={summary.collectionRate >= 0.8 ? "green" : summary.collectionRate >= 0.5 ? "orange" : "red"}
        />
      </div>

      {/* Filters */}
      <div className="mb-4 flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200 bg-white p-3 shadow-natural">
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
          <option value="__unassigned__">{locale === "zh" ? "æœªå½’å±ž" : "Non attribue"}</option>
        </select>
        <input
          type="date" value={dateFrom}
          onChange={e => setDateFrom(e.target.value)}
          className={cn(filterBtn, "w-[150px]")}
          title={locale === "zh" ? "èµ·å§‹æ—¥æœŸ" : "Date debut"}
        />
        <span className="text-xs font-semibold text-slate-400">-</span>
        <input
          type="date" value={dateTo}
          onChange={e => setDateTo(e.target.value)}
          className={cn(filterBtn, "w-[150px]")}
          title={locale === "zh" ? "ç»“æŸæ—¥æœŸ" : "Date fin"}
        />
        <button
          onClick={handleExportCsv}
          disabled={filtered.length === 0}
          className="ml-auto inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:opacity-40"
        >
          <Download className="h-3.5 w-3.5" />{t.export.csv}
        </button>
        <span className="text-xs font-semibold text-slate-400">
          {filtered.length} {locale === "zh" ? "æ¡" : "lignes"}
        </span>
      </div>

      {/* Table */}
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-slate-200 bg-white py-16 shadow-natural">
          <p className="text-sm font-semibold text-slate-400">{t.empty}</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-natural">
          <div className="overflow-x-auto">
            <table className="data-table min-w-[980px] text-sm">
              <thead>
                <tr>
                  <th className="px-4 py-3">{t.columns.dueDate}</th>
                  <th className="px-4 py-3">{t.columns.building}</th>
                  <th className="px-4 py-3">{t.columns.unit}</th>
                  <th className="px-4 py-3">{t.columns.customer}</th>
                  <th className="px-4 py-3">{t.columns.sourceType}</th>
                  <th className="px-4 py-3">{t.columns.title}</th>
                  <th className="px-4 py-3 text-right">{t.columns.amount}</th>
                  <th className="px-4 py-3 text-right">{t.columns.paid}</th>
                  <th className="px-4 py-3 text-right">{t.columns.outstanding}</th>
                  <th className="px-4 py-3">{t.columns.status}</th>
                  <th className="px-4 py-3 text-right">{t.columns.overdueDays}</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(r => {
                  const os = Number(r.amount_xof) - Number(r.paid_amount_xof);
                  const od = overdueDays(r);
                  return (
                    <tr key={r.id} className={cn("transition-colors duration-fast hover:bg-slate-50/80", ROW_BG[r.status])}>
                      <td className="px-4 py-3 text-sm text-slate-500 whitespace-nowrap">{r.due_date}</td>
                      <td className="px-4 py-3 text-sm text-slate-500 whitespace-nowrap">{resolveBuildingName(r)}</td>
                      <td className="px-4 py-3 font-mono text-sm font-bold text-slate-950">{unitMap.get(r.unit_id ?? "") ?? "-"}</td>
                      <td className="max-w-[120px] truncate px-4 py-3 text-sm text-slate-700">{customerMap.get(r.customer_id ?? "") ?? "-"}</td>
                      <td className="px-4 py-3">
                        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">
                          {t.sourceTypes[r.source_type as keyof typeof t.sourceTypes] ?? r.source_type}
                        </span>
                      </td>
                      <td className="max-w-[180px] truncate px-4 py-3 text-sm text-slate-700">{r.title}</td>
                      <td className="px-4 py-3 text-right text-sm font-semibold tabular-nums text-slate-800">{formatXof(Number(r.amount_xof))}</td>
                      <td className="px-4 py-3 text-right text-sm tabular-nums text-brand-green-600">{formatXof(Number(r.paid_amount_xof))}</td>
                      <td className={cn("px-4 py-3 text-right text-sm tabular-nums font-semibold", os > 0 ? "text-brand-red-600" : "text-brand-green-600")}>{formatXof(os)}</td>
                      <td className="px-4 py-3">
                        <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold", STATUS_STYLES[r.status])}>
                          {t.statuses[r.status as keyof typeof t.statuses] ?? r.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {od !== null && od > 0 ? (
                          <span className="text-brand-red-600 font-medium">+{od}</span>
                        ) : od !== null && od === 0 ? (
                          <span className="text-slate-400">0</span>
                        ) : (
                          <span className="text-slate-300">-</span>
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

function MiniCard({ label, value, accent }: { label: string; value: string; accent: string }) {
  const styles = accent === "ink"
    ? "border-slate-200 bg-white text-slate-950"
    : accent === "green"
      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
      : accent === "orange"
        ? "border-brand-orange-200 bg-brand-orange-50 text-brand-orange-700"
        : "border-brand-red-200 bg-brand-red-50 text-brand-red-700";

  return (
    <div className={cn("rounded-2xl border px-4 py-3 shadow-sm", styles)}>
      <p className="text-[11px] font-bold text-current opacity-70">{label}</p>
      <p className="mt-1 text-2xl font-black tabular-nums">{value}</p>
    </div>
  );
}
