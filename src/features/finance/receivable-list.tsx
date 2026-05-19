"use client";

import { useState, useMemo } from "react";
import type { Locale } from "@/lib/i18n";
import { dictionaries } from "@/lib/i18n";
import { formatXof, cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import type { ReceivableRow } from "@/types/database";

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
  locale: Locale;
}

const STATUS_STYLES: Record<string, string> = {
  pending:  "bg-brand-warm-100 text-brand-ink-600",
  partial:  "bg-brand-amber-100 text-amber-700",
  paid:     "bg-brand-green-100 text-brand-green-700",
  overdue:  "bg-brand-red-100 text-brand-red-700",
  cancelled:"bg-brand-warm-50 text-brand-ink-300 line-through",
};

export function ReceivableList({ receivables, units, customers, locale }: Props) {
  const t = dictionaries[locale].receivables;
  const [statusFilter, setStatusFilter] = useState("all");
  const [sourceFilter, setSourceFilter] = useState("all");

  const unitMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const u of units) m.set(u.id, u.unit_no);
    return m;
  }, [units]);

  const customerMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of customers) m.set(c.id, c.name);
    return m;
  }, [customers]);

  const filtered = useMemo(() => {
    return receivables.filter(r => {
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      if (sourceFilter !== "all" && r.source_type !== sourceFilter) return false;
      return true;
    });
  }, [receivables, statusFilter, sourceFilter]);

  const summary = useMemo(() => {
    let total = 0, paid = 0, overdue = 0;
    const today = new Date().toISOString().slice(0, 10);
    for (const r of filtered) {
      if (r.status === "cancelled") continue;
      total += Number(r.amount_xof);
      paid += Number(r.paid_amount_xof);
      if (r.status === "overdue" || (Number(r.paid_amount_xof) < Number(r.amount_xof) && r.due_date < today)) {
        overdue += Number(r.amount_xof) - Number(r.paid_amount_xof);
      }
    }
    return { total, paid, outstanding: total - paid, overdue };
  }, [filtered]);

  const overdueDays = (r: ReceivableRow) => {
    if (r.status === "paid" || r.status === "cancelled") return null;
    const today = new Date().toISOString().slice(0, 10);
    if (r.due_date >= today) return null;
    const diff = Math.floor((Date.now() - new Date(r.due_date).getTime()) / 86400000);
    return diff;
  };

  const filterBtn = "rounded-lg border border-brand-warm-400 px-2.5 py-1 text-[11px] font-medium transition-all duration-fast";
  const filterBtnActive = "border-brand-orange bg-brand-orange-50 text-brand-orange-700";

  return (
    <div>
      {/* Summary cards */}
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <MiniCard label={t.summary.totalReceivable} value={formatXof(summary.total)} accent="ink" />
        <MiniCard label={t.summary.totalPaid} value={formatXof(summary.paid)} accent="green" />
        <MiniCard label={t.summary.totalOutstanding} value={formatXof(summary.outstanding)} accent="orange" />
        <MiniCard label={t.summary.totalOverdue} value={formatXof(summary.overdue)} accent="red" />
      </div>

      {/* Filters */}
      <div className="mb-4 flex flex-wrap gap-2">
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
          className={filterBtn}>
          <option value="all">{t.filters.status}: {t.filters.all}</option>
          {Object.entries(t.statuses).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
        <select value={sourceFilter} onChange={e => setSourceFilter(e.target.value)}
          className={filterBtn}>
          <option value="all">{t.filters.sourceType}: {t.filters.all}</option>
          {Object.entries(t.sourceTypes).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
        <span className="text-xs text-brand-ink-300 self-center ml-auto">
          {filtered.length} {locale === "zh" ? "条" : "lignes"}
        </span>
      </div>

      {/* Table */}
      {filtered.length === 0 ? (
        <Card variant="subtle" className="py-10 text-center text-sm text-brand-ink-300">{t.empty}</Card>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-brand-warm-400 bg-white">
          <table className="w-full min-w-[800px] text-left text-xs">
            <thead>
              <tr className="border-b border-brand-warm-400 bg-brand-warm-50">
                <th className="px-2 py-2.5 text-[10px] font-semibold uppercase text-brand-ink-400">{t.columns.dueDate}</th>
                <th className="px-2 py-2.5 text-[10px] font-semibold uppercase text-brand-ink-400">{t.columns.unit}</th>
                <th className="px-2 py-2.5 text-[10px] font-semibold uppercase text-brand-ink-400">{t.columns.customer}</th>
                <th className="px-2 py-2.5 text-[10px] font-semibold uppercase text-brand-ink-400">{t.columns.sourceType}</th>
                <th className="px-2 py-2.5 text-[10px] font-semibold uppercase text-brand-ink-400">{t.columns.title}</th>
                <th className="px-2 py-2.5 text-right text-[10px] font-semibold uppercase text-brand-ink-400">{t.columns.amount}</th>
                <th className="px-2 py-2.5 text-right text-[10px] font-semibold uppercase text-brand-ink-400">{t.columns.paid}</th>
                <th className="px-2 py-2.5 text-right text-[10px] font-semibold uppercase text-brand-ink-400">{t.columns.outstanding}</th>
                <th className="px-2 py-2.5 text-[10px] font-semibold uppercase text-brand-ink-400">{t.columns.status}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-brand-warm-400">
              {filtered.map(r => {
                const os = Number(r.amount_xof) - Number(r.paid_amount_xof);
                const od = overdueDays(r);
                return (
                  <tr key={r.id} className={cn(
                    "transition-colors duration-fast",
                    r.status === "overdue" && "bg-brand-red-50/30",
                  )}>
                    <td className="px-2 py-2 text-brand-ink-600 whitespace-nowrap">
                      {r.due_date}
                      {od !== null && od > 0 && (
                        <span className="ml-1 text-[10px] text-brand-red-500">+{od}</span>
                      )}
                    </td>
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
    <div className={cn("rounded-lg border border-brand-warm-400 bg-white px-3 py-2.5 border-l-[3px]", borderColor[accent])}>
      <p className="text-[10px] text-brand-ink-300">{label}</p>
      <p className="text-sm font-bold tabular-nums text-brand-ink-900">{value}</p>
    </div>
  );
}
