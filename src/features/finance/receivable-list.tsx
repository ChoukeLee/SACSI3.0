"use client";

import { useState, useMemo } from "react";
import { Download } from "lucide-react";
import type { Locale } from "@/lib/i18n";
import { dictionaries } from "@/lib/i18n";
import { formatXof, cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";
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
  pending:   "bg-brand-warm-100 text-brand-ink-600",
  partial:   "bg-brand-amber-100 text-amber-700",
  paid:      "bg-brand-green-100 text-brand-green-700",
  overdue:   "bg-brand-red-100 text-brand-red-700",
  cancelled: "bg-brand-warm-50 text-brand-ink-300 line-through",
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

  const filterBtn = "rounded-lg border border-brand-warm-400 px-2.5 py-1 text-[11px] font-medium transition-all duration-fast bg-white";

  const resolveBuildingName = (r: ReceivableRow) => {
    const bid = r.building_id ?? unitBuildingMap.get(r.unit_id ?? "") ?? null;
    if (!bid) return "—";
    return buildingMap.get(bid) ?? "—";
  };

  return (
    <div>
      {/* Summary cards */}
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
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
      <div className="mb-4 flex flex-wrap gap-2 items-center">
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
          <option value="__unassigned__">{locale === "zh" ? "未归属" : "Non attribue"}</option>
        </select>
        <input
          type="date" value={dateFrom}
          onChange={e => setDateFrom(e.target.value)}
          className={cn(filterBtn, "w-[130px]")}
          title={locale === "zh" ? "起始日期" : "Date debut"}
        />
        <span className="text-xs text-brand-ink-300">—</span>
        <input
          type="date" value={dateTo}
          onChange={e => setDateTo(e.target.value)}
          className={cn(filterBtn, "w-[130px]")}
          title={locale === "zh" ? "结束日期" : "Date fin"}
        />
        <button
          onClick={handleExportCsv}
          disabled={filtered.length === 0}
          className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-brand-warm-400 bg-white px-3 py-1.5 text-xs font-medium text-brand-ink-600 hover:bg-brand-warm-50 disabled:opacity-40"
        >
          <Download className="h-3.5 w-3.5" />{t.export.csv}
        </button>
        <span className="text-xs text-brand-ink-300">
          {filtered.length} {locale === "zh" ? "条" : "lignes"}
        </span>
      </div>

      {/* Table */}
      {filtered.length === 0 ? (
        <Card variant="subtle" className="py-10 text-center text-sm text-brand-ink-300">{t.empty}</Card>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-brand-warm-400 bg-white">
          <table className="w-full min-w-[900px] text-left text-xs">
            <thead>
              <tr className="border-b border-brand-warm-400 bg-brand-warm-50">
                <th className="px-2 py-2.5 text-[10px] font-semibold uppercase text-brand-ink-400">{t.columns.dueDate}</th>
                <th className="px-2 py-2.5 text-[10px] font-semibold uppercase text-brand-ink-400">{t.columns.building}</th>
                <th className="px-2 py-2.5 text-[10px] font-semibold uppercase text-brand-ink-400">{t.columns.unit}</th>
                <th className="px-2 py-2.5 text-[10px] font-semibold uppercase text-brand-ink-400">{t.columns.customer}</th>
                <th className="px-2 py-2.5 text-[10px] font-semibold uppercase text-brand-ink-400">{t.columns.sourceType}</th>
                <th className="px-2 py-2.5 text-[10px] font-semibold uppercase text-brand-ink-400">{t.columns.title}</th>
                <th className="px-2 py-2.5 text-right text-[10px] font-semibold uppercase text-brand-ink-400">{t.columns.amount}</th>
                <th className="px-2 py-2.5 text-right text-[10px] font-semibold uppercase text-brand-ink-400">{t.columns.paid}</th>
                <th className="px-2 py-2.5 text-right text-[10px] font-semibold uppercase text-brand-ink-400">{t.columns.outstanding}</th>
                <th className="px-2 py-2.5 text-[10px] font-semibold uppercase text-brand-ink-400">{t.columns.status}</th>
                <th className="px-2 py-2.5 text-right text-[10px] font-semibold uppercase text-brand-ink-400">{t.columns.overdueDays}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-brand-warm-400">
              {filtered.map(r => {
                const os = Number(r.amount_xof) - Number(r.paid_amount_xof);
                const od = overdueDays(r);
                return (
                  <tr key={r.id} className={cn("transition-colors duration-fast", ROW_BG[r.status])}>
                    <td className="px-2 py-2 text-brand-ink-600 whitespace-nowrap">
                      {r.due_date}
                    </td>
                    <td className="px-2 py-2 text-xs text-brand-ink-500 whitespace-nowrap">{resolveBuildingName(r)}</td>
                    <td className="px-2 py-2 font-mono text-brand-ink-700">{unitMap.get(r.unit_id ?? "") ?? "—"}</td>
                    <td className="px-2 py-2 text-brand-ink-600 max-w-[80px] truncate">{customerMap.get(r.customer_id ?? "")?.slice(0, 6) ?? "—"}</td>
                    <td className="px-2 py-2">
                      <span className="text-[10px] rounded bg-brand-warm-100 px-1.5 py-0.5 text-brand-ink-500">
                        {t.sourceTypes[r.source_type as keyof typeof t.sourceTypes] ?? r.source_type}
                      </span>
                    </td>
                    <td className="px-2 py-2 text-brand-ink-600 max-w-[120px] truncate">{r.title}</td>
                    <td className="px-2 py-2 text-right font-medium tabular-nums text-brand-ink-700">{formatXof(Number(r.amount_xof))}</td>
                    <td className="px-2 py-2 text-right tabular-nums text-brand-green-600">{formatXof(Number(r.paid_amount_xof))}</td>
                    <td className={cn("px-2 py-2 text-right tabular-nums font-semibold", os > 0 ? "text-brand-red-600" : "text-brand-green-600")}>{formatXof(os)}</td>
                    <td className="px-2 py-2">
                      <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold", STATUS_STYLES[r.status])}>
                        {t.statuses[r.status as keyof typeof t.statuses] ?? r.status}
                      </span>
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums">
                      {od !== null && od > 0 ? (
                        <span className="text-brand-red-600 font-medium">+{od}</span>
                      ) : od !== null && od === 0 ? (
                        <span className="text-brand-ink-300">0</span>
                      ) : (
                        <span className="text-brand-ink-200">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function MiniCard({ label, value, accent }: { label: string; value: string; accent: string }) {
  const borderColor: Record<string, string> = {
    ink: "border-brand-ink-700", green: "border-brand-green-500",
    orange: "border-brand-orange", red: "border-brand-red-500",
  };
  return (
    <div className={cn("rounded-lg border border-brand-warm-400 bg-white px-3 py-2.5 border-l-[3px]", borderColor[accent] ?? "border-brand-ink-700")}>
      <p className="text-[10px] text-brand-ink-300">{label}</p>
      <p className="text-sm font-bold tabular-nums text-brand-ink-900">{value}</p>
    </div>
  );
}
