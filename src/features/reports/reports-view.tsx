"use client";

import { useMemo, useState } from "react";
import { Banknote, CalendarDays, Minus, TrendingUp } from "lucide-react";
import {
  DataVizCard,
  DonutChart,
  GroupedBarChart,
  MultiLineChart,
  CalendarHeatmap,
  type ChartTone,
} from "@/components/ui/data-viz";
import { MetricGrid, SegmentedControl, StatTile } from "@/components/ui/operational";
import { formatXof, sortUnits } from "@/lib/utils";
import {
  aggregateByCategory,
  aggregateDailyCollectionsMonthly,
  aggregateOccupancyMonthly,
  aggregatePnlByBuilding,
  aggregatePnlMonthly,
  buildDailyOccupancy,
  dayRangeOfMonth,
  monthRange,
  type DailyCellStatus,
} from "./report-aggregators";
import type { LedgerEntryRow, BuildingRow, UnitRow, DailyBookingRow, PaymentRow } from "@/types/database";

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
  locale,
}: {
  entries: LedgerEntryRow[];
  buildings: BuildingRow[];
  units: UnitRow[];
  dailyBookings: DailyBookingRow[];
  dailyPayments: PaymentRow[];
  dailyUnitIds: string[];
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
  const [tab, setTab] = useState<"pnl" | "daily">("pnl");

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
          ]}
          onChange={setTab}
          ariaLabel={zh ? "报表类型" : "Type de rapport"}
        />
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
      ) : (
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
      )}
    </div>
  );
}