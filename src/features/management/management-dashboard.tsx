"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowRight } from "lucide-react";
import type { Locale } from "@/lib/i18n";
import { dictionaries, routeFor } from "@/lib/i18n";
import { formatXof, cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { MetricCard } from "@/components/metric-card";
import { PageHeader } from "@/components/page-header";
import type {
  BuildingRow, UnitRow, DailyBookingRow, LeaseContractRow,
  SaleContractRow, SalePaymentScheduleRow, LedgerEntryRow, ReceivableRow,
} from "@/types/database";

// ── Types ──────────────────────────────────────────────────────────────

export type MgmtStatus =
  | "sold"
  | "leased"
  | "dailyOccupied"
  | "reserved"
  | "cleaningPending"
  | "maintenance"
  | "available";

interface UnitState {
  unit: UnitRow;
  status: MgmtStatus;
}

interface Props {
  buildings: BuildingRow[];
  units: UnitRow[];
  dailyBookings: DailyBookingRow[];
  leaseContracts: LeaseContractRow[];
  saleContracts: SaleContractRow[];
  saleSchedules: SalePaymentScheduleRow[];
  cleaningTasks: { unit_id: string; is_completed: boolean }[];
  ledgerEntries: LedgerEntryRow[];
  receivables: ReceivableRow[];
  locale: Locale;
}

// ── Status color map for room matrix ───────────────────────────────────

const STATUS_CELL: Record<MgmtStatus, string> = {
  sold:             "bg-brand-ink-500 text-white",
  leased:           "bg-indigo-100 text-indigo-800 border-indigo-300",
  dailyOccupied:    "bg-brand-orange-200 text-brand-orange-800",
  reserved:         "bg-amber-200 text-amber-900",
  cleaningPending:  "bg-brand-sky-100 text-brand-sky-700",
  maintenance:      "bg-brand-red-100 text-brand-red-700",
  available:        "bg-brand-green-100 text-brand-green-700 border-brand-green-300",
};

// ── Compute unit snapshot status ───────────────────────────────────────

function computeUnitState(
  unit: UnitRow,
  dailyBookings: DailyBookingRow[],
  leaseContracts: LeaseContractRow[],
  saleContracts: SaleContractRow[],
  cleaningTasks: { unit_id: string; is_completed: boolean }[],
): UnitState {
  // 1. Sold
  const hasActiveSale = saleContracts.some(
    s => s.unit_id === unit.id && s.status === "active",
  );
  if (unit.status === "sold" || hasActiveSale) {
    return { unit, status: "sold" };
  }

  // 2. Leased
  const hasActiveLease = leaseContracts.some(
    l => l.unit_id === unit.id && l.status === "active",
  );
  if (unit.status === "leased" || hasActiveLease) {
    return { unit, status: "leased" };
  }

  // 3. Daily occupied
  const hasCheckedIn = dailyBookings.some(
    b => b.unit_id === unit.id && b.status === "checked_in",
  );
  if (unit.status === "daily_occupied" || hasCheckedIn) {
    return { unit, status: "dailyOccupied" };
  }

  // 4. Reserved (pending_review / confirmed)
  const hasReservedBooking = dailyBookings.some(
    b => b.unit_id === unit.id && (b.status === "pending_review" || b.status === "confirmed"),
  );
  if (unit.status === "reserved" || hasReservedBooking) {
    return { unit, status: "reserved" };
  }

  // 5. Cleaning pending
  const hasPendingCleaning = cleaningTasks.some(
    t => t.unit_id === unit.id && !t.is_completed,
  );
  if (unit.status === "cleaning_pending" || hasPendingCleaning) {
    return { unit, status: "cleaningPending" };
  }

  // 6. Maintenance / locked
  if (unit.status === "maintenance" || unit.status === "locked") {
    return { unit, status: "maintenance" };
  }

  // 7. Available
  return { unit, status: "available" };
}

// ── Component ──────────────────────────────────────────────────────────

export function ManagementDashboard({
  buildings, units, dailyBookings, leaseContracts, saleContracts,
  saleSchedules, cleaningTasks, ledgerEntries, receivables, locale,
}: Props) {
  const t = dictionaries[locale].management;
  const [selectedBuildingId, setSelectedBuildingId] = useState<string>("__all__");

  // Room matrix & status counts only include apartments (exclude parking/storefront/office)
  const residentialUnits = useMemo(
    () => units.filter(u => u.kind === "apartment"),
    [units],
  );

  const activeBuildings = useMemo(
    () => buildings.filter(b => b.is_active),
    [buildings],
  );

  // Filter by building (apartments only)
  const filteredUnits = useMemo(() => {
    if (selectedBuildingId === "__all__") return residentialUnits;
    return residentialUnits.filter(u => u.building_id === selectedBuildingId);
  }, [residentialUnits, selectedBuildingId]);

  const buildingUnits = useMemo(() => {
    const map = new Map<string, UnitRow[]>();
    for (const b of activeBuildings) {
      map.set(b.id, residentialUnits.filter(u => u.building_id === b.id));
    }
    return map;
  }, [activeBuildings, residentialUnits]);

  // Compute unit states
  const unitStates = useMemo(
    () => filteredUnits.map(u => computeUnitState(u, dailyBookings, leaseContracts, saleContracts, cleaningTasks)),
    [filteredUnits, dailyBookings, leaseContracts, saleContracts, cleaningTasks],
  );

  // Status counts
  const counts = useMemo(() => {
    const c: Record<MgmtStatus, number> = {
      sold: 0, leased: 0, dailyOccupied: 0, reserved: 0,
      cleaningPending: 0, maintenance: 0, available: 0,
    };
    for (const s of unitStates) c[s.status]++;
    return c;
  }, [unitStates]);

  // Finance: current month
  const finance = useMemo(() => {
    const now = new Date();
    const monthPrefix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const monthEntries = ledgerEntries.filter(e => e.entry_date.startsWith(monthPrefix));

    const income = monthEntries
      .filter(e => e.direction === "income")
      .reduce((s, e) => s + Number(e.amount_xof), 0);
    const expense = monthEntries
      .filter(e => e.direction === "expense")
      .reduce((s, e) => s + Number(e.amount_xof), 0);
    const dailyRental = monthEntries
      .filter(e => e.direction === "income" && e.category === "daily_rental")
      .reduce((s, e) => s + Number(e.amount_xof), 0);
    const leaseRent = monthEntries
      .filter(e => e.direction === "income" && e.category === "lease_rent")
      .reduce((s, e) => s + Number(e.amount_xof), 0);
    const sale = monthEntries
      .filter(e => e.direction === "income" && e.category === "sale")
      .reduce((s, e) => s + Number(e.amount_xof), 0);
    const deposit = monthEntries
      .filter(e => e.direction === "liability_in")
      .reduce((s, e) => s + Number(e.amount_xof), 0);

    return { income, expense, net: income - expense, dailyRental, leaseRent, sale, deposit };
  }, [ledgerEntries]);

  // Receivables summary
  const receivableStats = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    let totalRec = 0, totalPaid = 0, totalOverdue = 0;
    for (const r of receivables) {
      if (r.status === "cancelled") continue;
      totalRec += Number(r.amount_xof);
      totalPaid += Number(r.paid_amount_xof);
      if (r.status === "overdue" || (Number(r.paid_amount_xof) < Number(r.amount_xof) && r.due_date < today)) {
        totalOverdue += Number(r.amount_xof) - Number(r.paid_amount_xof);
      }
    }
    return { totalRec, totalPaid, outstanding: totalRec - totalPaid, totalOverdue };
  }, [receivables]);

  // Risks
  const risks = useMemo(() => {
    const cleaning = unitStates.filter(s => s.status === "cleaningPending").length;
    const maintenance = unitStates.filter(s => s.status === "maintenance").length;

    // Leases expiring within 30 days
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() + 30);
    const cutoffStr = cutoff.toISOString().slice(0, 10);
    const todayStr = new Date().toISOString().slice(0, 10);
    const leaseExpiring = leaseContracts.filter(
      l => l.status === "active" && l.expected_end_date >= todayStr && l.expected_end_date <= cutoffStr,
    );

    // Active sale contracts with incomplete payment schedules
    const activeSales = saleContracts.filter(s => s.status === "active");
    const saleWithPending = activeSales.filter(s =>
      saleSchedules.some(
        sch => sch.sale_contract_id === s.id && sch.status !== "paid",
      ),
    );

    return { cleaning, maintenance, leaseExpiring, saleWithPending };
  }, [unitStates, leaseContracts, saleContracts, saleSchedules]);

  const buildingName = selectedBuildingId === "__all__"
    ? t.allBuildings
    : activeBuildings.find(b => b.id === selectedBuildingId)?.display_name ?? "";

  return (
    <div>
      <PageHeader title={t.title} description={t.description} />

      {/* Building selector */}
      <div className="mb-6 flex flex-wrap gap-2">
        <BuildingTab
          active={selectedBuildingId === "__all__"}
          onClick={() => setSelectedBuildingId("__all__")}
          label={t.allBuildings}
        />
        {activeBuildings.map(b => (
          <BuildingTab
            key={b.id}
            active={selectedBuildingId === b.id}
            onClick={() => setSelectedBuildingId(b.id)}
            label={b.display_name}
          />
        ))}
      </div>

      {/* Section 1: Status summary */}
      <SectionTitle>{t.sections.buildingStatus} — {buildingName}</SectionTitle>
      <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-7">
        <MiniStat label={t.statuses.sold} value={counts.sold} color="bg-brand-ink-500 text-white" />
        <MiniStat label={t.statuses.leased} value={counts.leased} color="bg-indigo-100 text-indigo-800" />
        <MiniStat label={t.statuses.dailyOccupied} value={counts.dailyOccupied} color="bg-brand-orange-100 text-brand-orange-800" />
        <MiniStat label={t.statuses.reserved} value={counts.reserved} color="bg-amber-100 text-amber-800" />
        <MiniStat label={t.statuses.cleaningPending} value={counts.cleaningPending} color="bg-brand-sky-100 text-brand-sky-700" />
        <MiniStat label={t.statuses.maintenance} value={counts.maintenance} color="bg-brand-red-100 text-brand-red-700" />
        <MiniStat label={t.statuses.available} value={counts.available} color="bg-brand-green-100 text-brand-green-700" />
      </div>

      {/* Section 2: Room matrix */}
      <SectionTitle>{t.sections.roomMatrix}</SectionTitle>
      <div className="mb-8 space-y-6">
        {(selectedBuildingId === "__all__" ? activeBuildings : activeBuildings.filter(b => b.id === selectedBuildingId)).map(building => {
          const bUnits = buildingUnits.get(building.id) ?? [];
          const bStates = bUnits.map(u => computeUnitState(u, dailyBookings, leaseContracts, saleContracts, cleaningTasks));
          return (
            <Card key={building.id} padding="sm">
              <h4 className="mb-2 text-xs font-semibold text-brand-ink-600">{building.display_name}</h4>
              <div className="flex flex-wrap gap-1.5">
                {bStates.map(s => (
                  <div
                    key={s.unit.id}
                    className={cn(
                      "flex h-8 w-8 items-center justify-center rounded text-[9px] font-semibold",
                      STATUS_CELL[s.status],
                    )}
                    title={`${s.unit.unit_no} — ${t.statuses[s.status]}`}
                  >
                    {s.unit.unit_no}
                  </div>
                ))}
              </div>
              {/* Legend */}
              <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-brand-ink-400">
                {Object.entries(t.statuses).map(([key, label]) => (
                  <span key={key} className="flex items-center gap-1">
                    <span className={cn("inline-block h-2 w-2 rounded-sm", STATUS_CELL[key as MgmtStatus]?.split(" ")[0])} />
                    {label}
                  </span>
                ))}
              </div>
            </Card>
          );
        })}
      </div>

      {/* Section 3: Finance overview */}
      <SectionTitle>{t.sections.financeOverview}</SectionTitle>
      <div className="mb-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard title={t.finance.income} value={formatXof(finance.income)} caption="" accent="green" />
        <MetricCard title={t.finance.expense} value={formatXof(finance.expense)} caption="" accent="orange" />
        <MetricCard title={t.finance.net} value={formatXof(finance.net)} caption="" accent="ink" />
        <Card padding="sm">
          <div className="space-y-1.5 text-xs">
            <div className="flex justify-between"><span>{t.finance.dailyRental}</span><span className="font-semibold">{formatXof(finance.dailyRental)}</span></div>
            <div className="flex justify-between"><span>{t.finance.leaseRent}</span><span className="font-semibold">{formatXof(finance.leaseRent)}</span></div>
            <div className="flex justify-between"><span>{t.finance.sale}</span><span className="font-semibold">{formatXof(finance.sale)}</span></div>
            <div className="flex justify-between"><span>{t.finance.depositLiability}</span><span className="font-semibold">{formatXof(finance.deposit)}</span></div>
          </div>
        </Card>
      </div>

      {/* Section 3.5: Receivables summary */}
      <SectionTitle>{locale === "zh" ? "应收账款" : "Comptes clients"}</SectionTitle>
      <div className="mb-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-lg border border-brand-warm-400 bg-white px-4 py-3 border-l-[3px] border-brand-ink-700">
          <p className="text-[10px] text-brand-ink-300">{locale === "zh" ? "应收总额" : "Total dû"}</p>
          <p className="text-lg font-bold tabular-nums text-brand-ink-900">{formatXof(receivableStats.totalRec)}</p>
        </div>
        <div className="rounded-lg border border-brand-warm-400 bg-white px-4 py-3 border-l-[3px] border-brand-green-500">
          <p className="text-[10px] text-brand-ink-300">{locale === "zh" ? "已收总额" : "Total payé"}</p>
          <p className="text-lg font-bold tabular-nums text-brand-green-700">{formatXof(receivableStats.totalPaid)}</p>
        </div>
        <div className="rounded-lg border border-brand-warm-400 bg-white px-4 py-3 border-l-[3px] border-brand-orange">
          <p className="text-[10px] text-brand-ink-300">{locale === "zh" ? "未收总额" : "Restant dû"}</p>
          <p className="text-lg font-bold tabular-nums text-brand-orange-700">{formatXof(receivableStats.outstanding)}</p>
        </div>
        <div className="rounded-lg border border-brand-warm-400 bg-white px-4 py-3 border-l-[3px] border-brand-red-500">
          <p className="text-[10px] text-brand-ink-300">{locale === "zh" ? "逾期总额" : "Total retard"}</p>
          <p className="text-lg font-bold tabular-nums text-brand-red-700">{formatXof(receivableStats.totalOverdue)}</p>
        </div>
      </div>

      {/* Section 4: Risk alerts */}
      <SectionTitle>{t.sections.riskAlerts}</SectionTitle>
      <div className="mb-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <RiskCard
          icon={AlertTriangle}
          label={t.risks.cleaningPending}
          value={`${risks.cleaning} ${t.risks.rooms}`}
          warn={risks.cleaning > 0}
        />
        <RiskCard
          icon={AlertTriangle}
          label={t.risks.maintenanceLocked}
          value={`${risks.maintenance} ${t.risks.rooms}`}
          warn={risks.maintenance > 0}
        />
        <RiskCard
          icon={AlertTriangle}
          label={t.risks.leaseExpiring}
          value={`${risks.leaseExpiring.length} ${t.risks.contracts}`}
          warn={risks.leaseExpiring.length > 0}
          detail={risks.leaseExpiring.map(l => l.contract_no).join(", ")}
        />
        <RiskCard
          icon={AlertTriangle}
          label={t.risks.saleInstallments}
          value={`${risks.saleWithPending.length} ${t.risks.contracts}`}
          warn={risks.saleWithPending.length > 0}
          detail={risks.saleWithPending.map(s => s.contract_no).join(", ")}
        />
      </div>
      {(risks.cleaning === 0 && risks.maintenance === 0 && risks.leaseExpiring.length === 0 && risks.saleWithPending.length === 0) && (
        <p className="text-sm text-brand-green-600 font-medium">{t.risks.none}</p>
      )}

      {/* Quick links */}
      <div className="mt-8 flex flex-wrap gap-2 text-xs text-brand-ink-400">
        <QuickLink href="/daily-rentals/overview" locale={locale} label={dictionaries[locale].shell.nav.dailyOccupancy ?? ""} />
        <QuickLink href="/leases" locale={locale} label={dictionaries[locale].shell.nav.leases ?? ""} />
        <QuickLink href="/sales" locale={locale} label={dictionaries[locale].shell.nav.sales ?? ""} />
        <QuickLink href="/finance" locale={locale} label={dictionaries[locale].shell.nav.finance ?? ""} />
      </div>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="mb-3 text-sm font-semibold text-brand-ink-700">{children}</h2>;
}

function BuildingTab({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "rounded-lg border px-3 py-1.5 text-xs font-medium transition-all duration-fast",
        active
          ? "border-brand-orange bg-brand-orange-50 text-brand-orange-700"
          : "border-brand-warm-400 bg-white text-brand-ink-500 hover:bg-brand-warm-50",
      )}
    >
      {label}
    </button>
  );
}

function MiniStat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className={cn("rounded-lg border border-brand-warm-400 px-3 py-2.5 text-center", color)}>
      <p className="text-[10px] opacity-70">{label}</p>
      <p className="text-lg font-bold tabular-nums">{value}</p>
    </div>
  );
}

function RiskCard({ icon: Icon, label, value, warn, detail }: {
  icon: typeof AlertTriangle; label: string; value: string; warn: boolean; detail?: string;
}) {
  return (
    <Card padding="sm" className={warn ? "border-brand-red-300 bg-brand-red-50/30" : ""}>
      <div className="flex items-center gap-2">
        <Icon className={cn("h-4 w-4", warn ? "text-brand-red-500" : "text-brand-ink-300")} />
        <span className="text-xs font-medium text-brand-ink-600">{label}</span>
      </div>
      <p className={cn("mt-1 text-lg font-bold tabular-nums", warn ? "text-brand-red-700" : "text-brand-ink-400")}>{value}</p>
      {detail && <p className="mt-0.5 text-[10px] text-brand-ink-300 truncate">{detail}</p>}
    </Card>
  );
}

function QuickLink({ href, locale, label }: { href: string; locale: Locale; label: string }) {
  return (
    <Link href={routeFor(locale, href)} className="flex items-center gap-1 text-brand-orange hover:underline">
      {label} <ArrowRight className="h-3 w-3" />
    </Link>
  );
}
