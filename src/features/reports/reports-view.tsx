"use client";

import { useMemo, useState } from "react";
import { Banknote, CalendarDays, Minus, TrendingUp } from "lucide-react";
import {
  DataVizCard,
  DonutChart,
  GroupedBarChart,
  MultiLineChart,
  CalendarHeatmap,
  BarListChart,
  type ChartTone,
} from "@/components/ui/data-viz";
import { MetricGrid, SegmentedControl, StatTile } from "@/components/ui/operational";
import { formatXof, sortUnits } from "@/lib/utils";
import { computeFinanceMetrics, isManagedReceivable, receivableOutstanding } from "@/features/finance/metrics";
import {
  aggregateByCategory,
  aggregateDailyCollectionsMonthly,
  aggregateOccupancyMonthly,
  aggregateOutstandingByBuilding,
  aggregatePnlByBuilding,
  aggregatePnlMonthly,
  buildDailyOccupancy,
  dayRangeOfMonth,
  monthRange,
  type DailyCellStatus,
} from "./report-aggregators";
import type { LedgerEntryRow, BuildingRow, UnitRow, DailyBookingRow, PaymentRow, ReceivableRow, CustomerRow } from "@/types/database";
import { downloadCsv } from "./export-csv";

const CATEGORY_TONES = ["blue", "green", "teal", "amber", "sold", "leased", "red", "neutral"] as const;

const STATUS_TONE: Record<DailyCellStatus, ChartTone> = {
  occupied: "blue",
  reserved: "amber",
  cleaning: "teal",
  available: "neutral",
};

function toneForIndex(i: number): (typeof CATEGORY_TONES)[number] {
  return CATEGORY_TONES[i % CATEGORY_TONES.length];
}

export function ReportsView({
  entries,
  buildings,
  units,
  dailyBookings,
  dailyPayments,
  dailyUnitIds,
  receivables,
  customers,
  locale,
}: {
  entries: LedgerEntryRow[];
  buildings: BuildingRow[];
  units: UnitRow[];
  dailyBookings: DailyBookingRow[];
  dailyPayments: PaymentRow[];
  dailyUnitIds: string[];
  receivables: ReceivableRow[];
  customers: CustomerRow[];
  locale: "zh" | "fr";
}) {
  const zh = locale === "zh";

  const availableMonths = useMemo(() => {
    const set = new Set(entries.map((e) => e.entry_date.slice(0, 7)));
    for (const p of dailyPayments) set.add(p.payment_date.slice(0, 7));
    for (const b of dailyBookings) set.add(b.check_in.slice(0, 7));
    return [...set].sort().reverse();
  }, [entries, dailyPayments, dailyBookings]);

  const [selectedMonth, setSelectedMonth] = useState(availableMonths[0] ?? "");
  const [tab, setTab] = useState<"pnl" | "daily" | "receivables">("pnl");

  const monthEntries = useMemo(
    () => entries.filter((e) => e.entry_date.startsWith(selectedMonth)),
    [entries, selectedMonth],
  );

  const income = useMemo(
    () => monthEntries.filter((e) => e.direction === "income").reduce((s, e) => s + Number(e.amount_xof), 0),
    [monthEntries],
  );
  const expense = useMemo(
    () => monthEntries.filter((e) => e.direction === "expense").reduce((s, e) => s + Number(e.amount_xof), 0),
    [monthEntries],
  );

  const trend = useMemo(
    () => (selectedMonth ? aggregatePnlMonthly(entries, monthRange(selectedMonth, 12)) : null),
    [entries, selectedMonth],
  );
  const buildingPnl = useMemo(
    () => aggregatePnlByBuilding(monthEntries, buildings, units),
    [monthEntries, buildings, units],
  );
  const incomeByCategory = useMemo(() => aggregateByCategory(monthEntries, "income"), [monthEntries]);
  const expenseByCategory = useMemo(() => aggregateByCategory(monthEntries, "expense"), [monthEntries]);

  // 日租指标
  const dailyCollected = useMemo(
    () => dailyPayments.filter((p) => p.payment_date.startsWith(selectedMonth)).reduce((s, p) => s + Number(p.amount), 0),
    [dailyPayments, selectedMonth],
  );
  const dailyBookingCount = useMemo(
    () => dailyBookings.filter((b) => b.check_in.startsWith(selectedMonth)).length,
    [dailyBookings, selectedMonth],
  );
  const dailyTrend = useMemo(
    () => (selectedMonth ? aggregateDailyCollectionsMonthly(dailyPayments, monthRange(selectedMonth, 12)) : []),
    [dailyPayments, selectedMonth],
  );
  const occupancyTrend = useMemo(
    () => (selectedMonth ? aggregateOccupancyMonthly(dailyBookings, dailyUnitIds.length, monthRange(selectedMonth, 12)) : []),
    [dailyBookings, dailyUnitIds.length, selectedMonth],
  );
  const currentOccupancyRate = occupancyTrend.find((o) => o.month === selectedMonth)?.rate ?? 0;
  const dailyUnits = useMemo(
    () => sortUnits(units.filter((u) => dailyUnitIds.includes(u.id)) as UnitRow[]),
    [units, dailyUnitIds],
  );
  const heatmap = useMemo(() => {
    if (!selectedMonth) return null;
    const days = dayRangeOfMonth(selectedMonth);
    const occ = buildDailyOccupancy(dailyBookings, dailyUnitIds, days);
    const toneCells: Record<string, Record<string, ChartTone>> = {};
    for (const u of dailyUnits) {
      toneCells[u.id] = {};
      for (const d of days) toneCells[u.id][d] = STATUS_TONE[occ[u.id]?.[d] ?? "available"];
    }
    return { days, toneCells };
  }, [selectedMonth, dailyBookings, dailyUnitIds, dailyUnits]);

  // 应收报表
  const managedReceivables = useMemo(() => receivables.filter((r) => isManagedReceivable(r)), [receivables]);
  const historicalReceivables = useMemo(
    () => receivables.filter((r) => r.management_status === "historical_pending"),
    [receivables],
  );
  const receivableMetrics = useMemo(() => computeFinanceMetrics(managedReceivables), [managedReceivables]);
  const historicalOutstanding = useMemo(
    () => historicalReceivables.reduce((s, r) => s + receivableOutstanding(r), 0),
    [historicalReceivables],
  );
  const outstandingByBuilding = useMemo(
    () => aggregateOutstandingByBuilding(managedReceivables, buildings, units),
    [managedReceivables, buildings, units],
  );
  const notOverdueOutstanding = Math.max(0, receivableMetrics.outstanding - receivableMetrics.overdue);
  const topOutstanding = useMemo(
    () => managedReceivables
      .filter((r) => receivableOutstanding(r) > 0)
      .sort((a, b) => receivableOutstanding(b) - receivableOutstanding(a))
      .slice(0, 20),
    [managedReceivables],
  );
  const buildingNameMap = useMemo(() => new Map(buildings.map((b) => [b.id, b.display_name || b.code])), [buildings]);
  const unitNoMap = useMemo(() => new Map(units.map((u) => [u.id, u.unit_no])), [units]);
  const customerNameMap = useMemo(() => new Map(customers.map((c) => [c.id, c.name])), [customers]);

  const handleExport = () => {
    const today = new Date().toISOString().slice(0, 10);
    if (tab === "pnl") {
      const months = trend?.months ?? [];
      const rows = months.map((m, i) => [m, trend?.income[i] ?? 0, trend?.expense[i] ?? 0, trend?.net[i] ?? 0]);
      downloadCsv("收支报表_" + selectedMonth + ".csv", [zh ? "月份" : "Mois", zh ? "收入" : "Revenus", zh ? "支出" : "Dépenses", zh ? "净额" : "Net"], rows);
    } else if (tab === "daily") {
      const months = monthRange(selectedMonth, 12);
      const occMap = new Map(occupancyTrend.map((o) => [o.month, o]));
      const rows = dailyTrend.map((v, i) => {
        const m = months[i];
        const o = occMap.get(m);
        return [m, v, o?.occupiedNights ?? 0, o ? Math.round(o.rate * 1000) / 10 : 0];
      });
      downloadCsv("日租报表_" + selectedMonth + ".csv", [zh ? "月份" : "Mois", zh ? "日租收款" : "Encaissé", zh ? "入住晚数" : "Nuits", zh ? "入住率%" : "Taux %"], rows);
    } else {
      const rows = managedReceivables
        .filter((r) => receivableOutstanding(r) > 0)
        .sort((a, b) => receivableOutstanding(b) - receivableOutstanding(a))
        .map((r) => {
          const buildingName = buildingNameMap.get(r.building_id ?? "") ?? "";
          const unitNo = r.unit_id ? unitNoMap.get(r.unit_id) ?? "" : "";
          const customerName = r.customer_id ? customerNameMap.get(r.customer_id) ?? "" : "";
          const out = receivableOutstanding(r);
          const status = r.due_date < today ? (zh ? "逾期" : "Retard") : (zh ? "待收" : "Dû");
          return [buildingName, unitNo, customerName, r.due_date, Number(r.amount_xof), Number(r.paid_amount_xof), out, status];
        });
      downloadCsv("应收报表_" + selectedMonth + ".csv", [zh ? "楼栋" : "Bâtiment", zh ? "房号" : "Lot", zh ? "客户" : "Client", zh ? "到期日" : "Échéance", zh ? "应收" : "Dû", zh ? "已收" : "Encaissé", zh ? "未收" : "Solde", zh ? "状态" : "Statut"], rows);
    }
  };

  if (availableMonths.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-card p-10 text-center text-sm text-muted-foreground">
        {zh ? "暂无数据，登记收款后即可生成报表。" : "Aucune donnée. Enregistrez un paiement pour générer des rapports."}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SegmentedControl
          value={tab}
          items={[
            { value: "pnl" as const, label: zh ? "收支" : "P&L" },
            { value: "daily" as const, label: zh ? "日租" : "Location jour" },
            { value: "receivables" as const, label: zh ? "应收" : "Créances" },
          ]}
          onChange={setTab}
          ariaLabel={zh ? "报表类型" : "Type de rapport"}
        />
        <div className="flex items-center gap-2">
          <select
            value={selectedMonth}
            onChange={(e) => setSelectedMonth(e.target.value)}
            className="rounded-lg border border-border bg-card px-3 py-2 text-sm"
            aria-label={zh ? "选择月份" : "Choisir le mois"}
          >
            {availableMonths.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
          <button
            onClick={handleExport}
            className="rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium hover:bg-muted"
          >
            {zh ? "导出 CSV" : "Exporter CSV"}
          </button>
        </div>
      </div>

      {tab === "pnl" ? (
        <>
          <MetricGrid columns={3}>
            <StatTile label={zh ? "本月收入" : "Revenus du mois"} value={formatXof(income)} tone="green" icon={Banknote} />
            <StatTile label={zh ? "本月支出" : "Dépenses du mois"} value={formatXof(expense)} tone="red" icon={Minus} />
            <StatTile label={zh ? "本月净额" : "Résultat net"} value={formatXof(income - expense)} tone={income - expense >= 0 ? "green" : "red"} icon={TrendingUp} />
          </MetricGrid>

          {trend && (
            <DataVizCard title={zh ? "近 12 个月收支趋势" : "Tendance sur 12 mois"} description={zh ? "收入 · 支出 · 净额" : "Revenus · Dépenses · Net"}>
              <MultiLineChart
                xLabels={trend.months}
                series={[
                  { label: zh ? "收入" : "Revenus", values: trend.income, tone: "green" },
                  { label: zh ? "支出" : "Dépenses", values: trend.expense, tone: "red" },
                  { label: zh ? "净额" : "Net", values: trend.net, tone: "blue" },
                ]}
              />
            </DataVizCard>
          )}

          {buildingPnl.length > 0 && (
            <DataVizCard title={zh ? "本月各楼栋收支" : "Revenus/dépenses par bâtiment"}>
              <GroupedBarChart
                groups={buildingPnl.map((b) => ({
                  label: b.buildingName,
                  series: [
                    { label: zh ? "收入" : "Revenus", value: b.income, tone: "green" },
                    { label: zh ? "支出" : "Dépenses", value: b.expense, tone: "red" },
                  ],
                }))}
              />
            </DataVizCard>
          )}

          <div className="grid gap-5 lg:grid-cols-2">
            <DataVizCard title={zh ? "本月收入构成" : "Répartition des revenus"}>
              {incomeByCategory.length > 0 ? (
                <DonutChart
                  items={incomeByCategory.map((c, i) => ({ label: c.label, value: c.value, tone: toneForIndex(i) }))}
                  centerValue={formatXof(income)}
                  centerLabel={zh ? "收入" : "Revenus"}
                />
              ) : (
                <p className="text-sm text-muted-foreground">{zh ? "本月暂无收入" : "Aucun revenu ce mois"}</p>
              )}
            </DataVizCard>
            <DataVizCard title={zh ? "本月支出构成" : "Répartition des dépenses"}>
              {expenseByCategory.length > 0 ? (
                <DonutChart
                  items={expenseByCategory.map((c, i) => ({ label: c.label, value: c.value, tone: toneForIndex(i) }))}
                  centerValue={formatXof(expense)}
                  centerLabel={zh ? "支出" : "Dépenses"}
                />
              ) : (
                <p className="text-sm text-muted-foreground">{zh ? "本月暂无支出" : "Aucune dépense ce mois"}</p>
              )}
            </DataVizCard>
          </div>
        </>
      ) : tab === "daily" ? (
        <>
          <MetricGrid columns={3}>
            <StatTile label={zh ? "本月日租收款" : "Encaissé (jour)"} value={formatXof(dailyCollected)} tone="green" icon={Banknote} />
            <StatTile label={zh ? "本月日租订单" : "Séjours (jour)"} value={String(dailyBookingCount)} tone="blue" icon={CalendarDays} />
            <StatTile label={zh ? "本月入住率" : "Taux d'occupation"} value={Math.round(currentOccupancyRate * 100) + "%"} tone="teal" icon={TrendingUp} />
          </MetricGrid>

          {dailyTrend.length > 0 && (
            <DataVizCard title={zh ? "近 12 个月日租收款" : "Encaissements journaliers sur 12 mois"} description={zh ? "按实际付款日期" : "Par date de paiement"}>
              <GroupedBarChart
                groups={dailyTrend.map((v, i) => ({
                  label: monthRange(selectedMonth, 12)[i] ?? "",
                  series: [{ label: zh ? "日租收款" : "Encaissé", value: v, tone: "green" }],
                }))}
              />
            </DataVizCard>
          )}

          {occupancyTrend.length > 0 && (
            <DataVizCard title={zh ? "近 12 个月入住率" : "Taux d'occupation sur 12 mois"} description={zh ? "按当前日租房源数计算" : "Basé sur le parc actuel"}>
              <MultiLineChart
                xLabels={occupancyTrend.map((o) => o.month)}
                series={[{ label: zh ? "入住率" : "Occupation", values: occupancyTrend.map((o) => Math.round(o.rate * 1000) / 10), tone: "teal" }]}
              />
            </DataVizCard>
          )}

          {heatmap && dailyUnits.length > 0 && (
            <DataVizCard
              title={zh ? "本月入住热力" : "Occupation du mois"}
              description={zh ? "每行一个房间，每列一天" : "Une ligne par chambre, une colonne par jour"}
            >
              <CalendarHeatmap
                rows={dailyUnits.map((u) => ({ id: u.id, label: u.unit_no }))}
                columns={heatmap.days.map((d) => ({ id: d, label: d.slice(8) }))}
                cells={heatmap.toneCells}
                legend={[
                  { label: zh ? "入住" : "Occupé", tone: "blue" },
                  { label: zh ? "预订" : "Réservé", tone: "amber" },
                  { label: zh ? "退房清洁" : "Ménage", tone: "teal" },
                  { label: zh ? "空闲" : "Libre", tone: "neutral" },
                ]}
              />
            </DataVizCard>
          )}
        </>
      ) : (
        <>
          <MetricGrid columns={5}>
            <StatTile label={zh ? "已确认应收" : "Dû confirmé"} value={formatXof(receivableMetrics.receivable)} tone="blue" />
            <StatTile label={zh ? "已确认已收" : "Encaissé confirmé"} value={formatXof(receivableMetrics.collected)} tone="green" />
            <StatTile label={zh ? "已确认未收" : "Solde confirmé"} value={formatXof(receivableMetrics.outstanding)} tone="amber" />
            <StatTile label={zh ? "逾期" : "En retard"} value={formatXof(receivableMetrics.overdue)} tone="red" />
            <StatTile label={zh ? "历史待核" : "Historique à vérifier"} value={formatXof(historicalOutstanding)} tone="neutral" />
          </MetricGrid>

          <div className="grid gap-5 lg:grid-cols-2">
            <DataVizCard title={zh ? "各楼栋已确认未收" : "Solde confirmé par bâtiment"}>
              {outstandingByBuilding.length > 0 ? (
                <BarListChart items={outstandingByBuilding.map((b, i) => ({ label: b.label, value: b.value, tone: (i === 0 ? "red" : "blue") as ChartTone }))} />
              ) : (
                <p className="text-sm text-muted-foreground">{zh ? "暂无未收" : "Aucun solde"}</p>
              )}
            </DataVizCard>
            <DataVizCard title={zh ? "未收构成" : "Répartition du solde"}>
              <DonutChart
                items={[
                  { label: zh ? "逾期" : "En retard", value: receivableMetrics.overdue, tone: "red" as ChartTone },
                  { label: zh ? "未逾期未收" : "Solde non échu", value: notOverdueOutstanding, tone: "amber" as ChartTone },
                  { label: zh ? "历史待核" : "Historique", value: historicalOutstanding, tone: "neutral" as ChartTone },
                ].filter((i) => i.value > 0)}
                centerValue={formatXof(receivableMetrics.outstanding + historicalOutstanding)}
                centerLabel={zh ? "未收合计" : "Solde total"}
              />
            </DataVizCard>
          </div>

          {topOutstanding.length > 0 && (
            <DataVizCard title={zh ? "未收明细（按金额前 20）" : "Top 20 des soldes"}>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] text-sm">
                  <thead>
                    <tr className="text-left text-xs text-muted-foreground">
                      <th className="px-3 py-2">{zh ? "楼栋/房号" : "Bâtiment/Lot"}</th>
                      <th className="px-3 py-2">{zh ? "客户" : "Client"}</th>
                      <th className="px-3 py-2">{zh ? "到期日" : "Échéance"}</th>
                      <th className="px-3 py-2 text-right">{zh ? "应收" : "Dû"}</th>
                      <th className="px-3 py-2 text-right">{zh ? "已收" : "Encaissé"}</th>
                      <th className="px-3 py-2 text-right">{zh ? "未收" : "Solde"}</th>
                      <th className="px-3 py-2">{zh ? "状态" : "Statut"}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {topOutstanding.map((r) => {
                      const out = receivableOutstanding(r);
                      const buildingName = buildingNameMap.get(r.building_id ?? "") ?? "—";
                      const unitNo = r.unit_id ? unitNoMap.get(r.unit_id) ?? "—" : "—";
                      const customerName = r.customer_id ? customerNameMap.get(r.customer_id) ?? "—" : "—";
                      const isOverdue = r.due_date < new Date().toISOString().slice(0, 10);
                      return (
                        <tr key={r.id}>
                          <td className="px-3 py-2">{buildingName} · {unitNo}</td>
                          <td className="px-3 py-2">{customerName}</td>
                          <td className="px-3 py-2 tabular-nums">{r.due_date}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{formatXof(Number(r.amount_xof))}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-emerald-700">{formatXof(Number(r.paid_amount_xof))}</td>
                          <td className="px-3 py-2 text-right font-medium tabular-nums text-red-700">{formatXof(out)}</td>
                          <td className="px-3 py-2">{isOverdue ? (zh ? "逾期" : "Retard") : (zh ? "待收" : "Dû")}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </DataVizCard>
          )}
        </>
      )}
    </div>
  );
}