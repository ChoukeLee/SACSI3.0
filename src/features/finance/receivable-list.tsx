"use client";

import { useState, useMemo } from "react";
import { Download } from "lucide-react";
import type { Locale } from "@/lib/i18n";
import { dictionaries } from "@/lib/i18n";
import { formatXof, cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { DateInput } from "@/components/ui/date-input";
import { BusinessTable, BusinessTbody, BusinessTd, BusinessTh, BusinessThead, BusinessRow, MoneyCell } from "@/components/ui/business-table";
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

function receivableBusinessLabel(r: ReceivableRow, locale: Locale) {
  const zh: Record<string, string> = {
    daily_booking: "日租房费",
    lease_rent: "长租租金",
    lease_deposit: "长租押金",
    sale_installment: "出售分期",
    sale_lump_sum: "出售全款",
    sale_contract: "出售",
    manual: "手工应收",
    other: "其他应收",
  };
  const fr: Record<string, string> = {
    daily_booking: "Location jour",
    lease_rent: "Loyer longue durée",
    lease_deposit: "Dépôt longue durée",
    sale_installment: "Vente échelonnée",
    sale_lump_sum: "Vente comptant",
    sale_contract: "Vente",
    manual: "Créance manuelle",
    other: "Autre créance",
  };
  const labels = locale === "fr" ? fr : zh;
  return labels[r.category || ""] ?? labels[r.source_type] ?? r.source_type;
}

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
    const statusWeight: Record<string, number> = { overdue: 0, partial: 1, pending: 2, paid: 3, cancelled: 4 };
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
    }).sort((a, b) => {
      const statusCompare = (statusWeight[a.status] ?? 9) - (statusWeight[b.status] ?? 9);
      if (statusCompare !== 0) return statusCompare;
      const dueCompare = a.due_date.localeCompare(b.due_date);
      if (dueCompare !== 0) return dueCompare;
      const unitCompare = (unitMap.get(a.unit_id ?? "") ?? "").localeCompare(unitMap.get(b.unit_id ?? "") ?? "", undefined, { numeric: true });
      if (unitCompare !== 0) return unitCompare;
      return Number(b.amount_xof) - Number(a.amount_xof);
    });
  }, [receivables, statusFilter, sourceFilter, buildingFilter, dateFrom, dateTo, unitBuildingMap, unitMap]);

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
      {/* Summary stats */}
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-5">
        <div className="flex items-center gap-2.5 rounded-xl border border-border/60 bg-card px-3.5 py-3 shadow-sm">
          <span className="h-2.5 w-2.5 rounded-full bg-accentBlue-500 shrink-0" />
          <div className="min-w-0"><p className="text-xl font-bold tracking-tight tabular-nums leading-none">{formatXof(summary.totalReceivable)}</p><p className="text-[11px] text-muted-foreground mt-0.5 leading-tight">{t.summary.totalReceivable}</p></div>
        </div>
        <div className="flex items-center gap-2.5 rounded-xl border border-border/60 bg-card px-3.5 py-3 shadow-sm">
          <span className="h-2.5 w-2.5 rounded-full bg-accentGreen-500 shrink-0" />
          <div className="min-w-0"><p className="text-xl font-bold tracking-tight tabular-nums leading-none">{formatXof(summary.totalPaid)}</p><p className="text-[11px] text-muted-foreground mt-0.5 leading-tight">{t.summary.totalPaid}</p></div>
        </div>
        <div className="flex items-center gap-2.5 rounded-xl border border-border/60 bg-card px-3.5 py-3 shadow-sm">
          <span className="h-2.5 w-2.5 rounded-full bg-accentAmber-500 shrink-0" />
          <div className="min-w-0"><p className="text-xl font-bold tracking-tight tabular-nums leading-none">{formatXof(summary.outstanding)}</p><p className="text-[11px] text-muted-foreground mt-0.5 leading-tight">{t.summary.totalOutstanding}</p></div>
        </div>
        <div className="flex items-center gap-2.5 rounded-xl border border-border/60 bg-card px-3.5 py-3 shadow-sm">
          <span className="h-2.5 w-2.5 rounded-full bg-accentRed-500 shrink-0" />
          <div className="min-w-0"><p className="text-xl font-bold tracking-tight tabular-nums leading-none">{formatXof(summary.overdue)}</p><p className="text-[11px] text-muted-foreground mt-0.5 leading-tight">{t.summary.totalOverdue}</p></div>
        </div>
        <div className="flex items-center gap-2.5 rounded-xl border border-border/60 bg-card px-3.5 py-3 shadow-sm">
          <span className={cn("h-2.5 w-2.5 rounded-full shrink-0", collectionTone === "green" ? "bg-accentGreen-500" : collectionTone === "amber" ? "bg-accentAmber-500" : "bg-accentRed-500")} />
          <div className="min-w-0"><p className="text-xl font-bold tracking-tight tabular-nums leading-none">{(summary.collectionRate * 100).toFixed(1)}%</p><p className="text-[11px] text-muted-foreground mt-0.5 leading-tight">{t.summary.collectionRate}</p></div>
        </div>
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
        <DateInput
          value={dateFrom}
          onChangeValue={setDateFrom}
          className={filterDate}
          title={locale === "zh" ? "起始日期" : "Date début"}
        />
        <span className="text-xs font-semibold text-muted-foreground">-</span>
        <DateInput
          value={dateTo}
          onChangeValue={setDateTo}
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
        <BusinessTable minWidth="min-w-[980px]">
              <BusinessThead>
                <tr>
                  <BusinessTh>{t.columns.dueDate}</BusinessTh>
                  <BusinessTh>{t.columns.building}</BusinessTh>
                  <BusinessTh>{t.columns.unit}</BusinessTh>
                  <BusinessTh>{t.columns.customer}</BusinessTh>
                  <BusinessTh align="center">{t.columns.sourceType}</BusinessTh>
                  <BusinessTh>{t.columns.title}</BusinessTh>
                  <BusinessTh align="right">{t.columns.amount}</BusinessTh>
                  <BusinessTh align="right">{t.columns.paid}</BusinessTh>
                  <BusinessTh align="right">{t.columns.outstanding}</BusinessTh>
                  <BusinessTh align="center">{t.columns.status}</BusinessTh>
                  <BusinessTh align="right">{t.columns.overdueDays}</BusinessTh>
                </tr>
              </BusinessThead>
              <BusinessTbody>
                {filtered.map(r => {
                  const os = Number(r.amount_xof) - Number(r.paid_amount_xof);
                  const od = overdueDays(r);
                  return (
                    <BusinessRow key={r.id} className={rowBg[r.status] ?? ""}>
                      <BusinessTd className="text-muted-foreground">{r.due_date}</BusinessTd>
                      <BusinessTd className="text-muted-foreground">{resolveBuildingName(r)}</BusinessTd>
                      <BusinessTd className="font-mono text-sm font-bold">{unitMap.get(r.unit_id ?? "") ?? "-"}</BusinessTd>
                      <BusinessTd className="max-w-[120px] truncate">{customerMap.get(r.customer_id ?? "") ?? "-"}</BusinessTd>
                      <BusinessTd align="center">
                        <Badge variant="secondary" className="text-xs">
                          {receivableBusinessLabel(r, locale)}
                        </Badge>
                      </BusinessTd>
                      <BusinessTd className="max-w-[180px] truncate">{r.title}</BusinessTd>
                      <MoneyCell>{formatXof(Number(r.amount_xof))}</MoneyCell>
                      <MoneyCell tone="income">{formatXof(Number(r.paid_amount_xof))}</MoneyCell>
                      <MoneyCell tone={os > 0 ? "expense" : "income"}>{formatXof(os)}</MoneyCell>
                      <BusinessTd align="center">
                        <Badge variant={statusTone[r.status] ?? "secondary"}>{t.statuses[r.status as keyof typeof t.statuses] ?? r.status}</Badge>
                      </BusinessTd>
                      <BusinessTd align="right" className="tabular-nums">
                        {od !== null && od > 0 ? (
                          <span className="text-rose-600 font-semibold">+{od}</span>
                        ) : od !== null && od === 0 ? (
                          <span className="text-muted-foreground">0</span>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </BusinessTd>
                    </BusinessRow>
                  );
                })}
              </BusinessTbody>
        </BusinessTable>
      )}
    </div>
  );
}
