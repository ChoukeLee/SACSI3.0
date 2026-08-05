"use client";

import { useState, useMemo } from "react";
import { Download } from "lucide-react";
import type { Locale } from "@/lib/i18n";
import { dictionaries } from "@/lib/i18n";
import { formatXof, cn } from "@/lib/utils";
import { financialBusinessLabel, statusDisplayLabel } from "@/lib/display-labels";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DateInput } from "@/components/ui/date-input";
import { BusinessTable, BusinessTbody, BusinessTd, BusinessTh, BusinessThead, BusinessRow, MoneyCell } from "@/components/ui/business-table";
import { DataVizCard, DonutChart } from "@/components/ui/data-viz";
import { FilterBar, FilterGroup, MetricGrid, SegmentedControl, StatTile, controlClass } from "@/components/ui/operational";
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
      property_fee: t.categories.property_fee,
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

  const filterDate = cn(controlClass, "w-[150px]");

  const collectionTone = summary.collectionRate >= 0.8 ? "green" : summary.collectionRate >= 0.5 ? "amber" : "red";

  return (
    <div className="space-y-5">
      <MetricGrid columns={5}>
        <StatTile tone="blue" label={t.summary.totalReceivable} value={formatXof(summary.totalReceivable)} />
        <StatTile tone="green" label={t.summary.totalPaid} value={formatXof(summary.totalPaid)} />
        <StatTile tone="amber" label={t.summary.totalOutstanding} value={formatXof(summary.outstanding)} />
        <StatTile tone="red" label={t.summary.totalOverdue} value={formatXof(summary.overdue)} />
        <StatTile tone={collectionTone} label={t.summary.collectionRate} value={`${(summary.collectionRate * 100).toFixed(1)}%`} />
      </MetricGrid>

      <DataVizCard
        title={locale === "zh" ? "应收结构" : "Structure des créances"}
        description={locale === "zh" ? "已收、未收与逾期的比例" : "Payé, restant et en retard"}
        metric={`${(summary.collectionRate * 100).toFixed(1)}%`}
      >
        <DonutChart
          centerValue={`${Math.round(summary.collectionRate * 100)}%`}
          centerLabel={t.summary.collectionRate}
          items={[
            { label: t.summary.totalPaid, value: summary.totalPaid, tone: "green" },
            { label: t.summary.totalOutstanding, value: Math.max(summary.outstanding - summary.overdue, 0), tone: "amber" },
            { label: t.summary.totalOverdue, value: summary.overdue, tone: "red" },
          ]}
        />
      </DataVizCard>

      <FilterBar
        meta={
          <div className="flex items-center gap-2">
            <Button onClick={handleExportCsv} disabled={filtered.length === 0} variant="outline" size="sm">
              <Download className="h-4 w-4" />{t.export.csv}
            </Button>
            <span>{filtered.length} {locale === "zh" ? "条" : "lignes"}</span>
          </div>
        }
      >
        <FilterGroup label={t.filters.status}>
          <SegmentedControl
            value={statusFilter}
            onChange={setStatusFilter}
            ariaLabel={t.filters.status}
            items={[
              { value: "all", label: t.filters.all },
              ...Object.entries(t.statuses).map(([value, label]) => ({ value, label })),
            ]}
          />
        </FilterGroup>
        <FilterGroup label={t.filters.sourceType}>
          <SegmentedControl
            value={sourceFilter}
            onChange={setSourceFilter}
            ariaLabel={t.filters.sourceType}
            items={[
              { value: "all", label: t.filters.all },
              ...Object.entries(t.sourceTypes).map(([value, label]) => ({ value, label })),
            ]}
          />
        </FilterGroup>
        <FilterGroup label={t.filters.building}>
          <SegmentedControl
            value={buildingFilter}
            onChange={setBuildingFilter}
            ariaLabel={t.filters.building}
            items={[
              { value: "all", label: t.filters.all },
              ...buildings.map((b) => ({ value: b.id, label: b.display_name || b.code })),
              { value: "__unassigned__", label: locale === "zh" ? "未归属" : "Non attribue" },
            ]}
          />
        </FilterGroup>
        <FilterGroup label={locale === "zh" ? "日期" : "Date"}>
          <DateInput
            value={dateFrom}
            onChangeValue={setDateFrom}
            className={filterDate}
            title={locale === "zh" ? "起始日期" : "Date debut"}
          />
          <span className="px-0.5 text-xs font-semibold text-muted-foreground">-</span>
          <DateInput
            value={dateTo}
            onChangeValue={setDateTo}
            className={filterDate}
            title={locale === "zh" ? "结束日期" : "Date fin"}
          />
        </FilterGroup>
      </FilterBar>

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
                      <BusinessTd className="font-mono text-sm font-semibold">{unitMap.get(r.unit_id ?? "") ?? "-"}</BusinessTd>
                      <BusinessTd className="max-w-[120px] truncate">{customerMap.get(r.customer_id ?? "") ?? "-"}</BusinessTd>
                      <BusinessTd align="center">
                        <Badge variant="secondary" className="text-xs">
                          {financialBusinessLabel(r.source_type, locale, r.category)}
                        </Badge>
                      </BusinessTd>
                      <BusinessTd className="max-w-[180px] truncate">{r.title}</BusinessTd>
                      <MoneyCell>{formatXof(Number(r.amount_xof))}</MoneyCell>
                      <MoneyCell tone="income">{formatXof(Number(r.paid_amount_xof))}</MoneyCell>
                      <MoneyCell tone={os > 0 ? "expense" : "income"}>{formatXof(os)}</MoneyCell>
                      <BusinessTd align="center">
                        <Badge variant={statusTone[r.status] ?? "secondary"}>{t.statuses[r.status as keyof typeof t.statuses] ?? statusDisplayLabel(r.status, locale)}</Badge>
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
