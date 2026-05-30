"use client";

import { useState, useMemo } from "react";
import { Download } from "lucide-react";
import type { Locale } from "@/lib/i18n";
import { formatXof, cn } from "@/lib/utils";
import type {
  LedgerEntryRow, DailyBookingRow, UnitRow, LeaseContractRow,
  SaleContractRow, SalePaymentScheduleRow, ReceivableRow, PaymentRow, CustomerRow,
} from "@/types/database";

interface Props {
  entries: LedgerEntryRow[]; bookings: DailyBookingRow[]; units: UnitRow[];
  leaseContracts: LeaseContractRow[]; saleContracts: SaleContractRow[];
  saleSchedules: SalePaymentScheduleRow[]; receivables: ReceivableRow[];
  payments: PaymentRow[]; customers: CustomerRow[]; locale: Locale; userRole: string;
}

type ReportTab = "room_status" | "income" | "overdue" | "daily" | "lease" | "sale" | "daily_close";

const TAB_PERMISSIONS: Record<string, string[]> = {
  room_status: ["admin","boss","front_desk"], income: ["admin","boss","finance"],
  overdue: ["admin","boss","finance"], daily: ["admin","boss","front_desk"],
  lease: ["admin","boss","finance"], sale: ["admin","boss","finance"],
  daily_close: ["admin","boss","front_desk"],
};

function csvLine(fields: (string|number|null|undefined)[]): string {
  return fields.map(f => { const s = String(f ?? ""); return s.includes(",")||s.includes('"') ? `"${s.replace(/"/g,'""')}"` : s; }).join(",");
}

function downloadCsv(header: string, rows: string[], filename: string) {
  const csv = [header, ...rows].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
  a.download = `${filename}_${new Date().toISOString().slice(0,10)}.csv`; a.click();
}

function StatBlock({ label, value, dot }: { label: string; value: string; dot: string }) {
  return (
    <div className="flex items-center gap-2.5 rounded-xl border border-border/60 bg-card px-3.5 py-3 shadow-sm">
      <span className={cn("h-2.5 w-2.5 rounded-full shrink-0", dot)} />
      <div className="min-w-0">
        <p className="text-xl font-bold tracking-tight tabular-nums leading-none">{value}</p>
        <p className="text-[11px] text-muted-foreground mt-0.5 leading-tight">{label}</p>
      </div>
    </div>
  );
}

export function ReportsView({ entries: _entries, bookings, units, leaseContracts, saleContracts, saleSchedules: _saleSchedules, receivables, payments, customers, locale, userRole }: Props) {
  const permitted = (Object.entries(TAB_PERMISSIONS) as [ReportTab, string[]][]).filter(([, roles]) => roles.includes(userRole)).map(([t]) => t);
  const [tab, setTab] = useState<ReportTab>(permitted[0] ?? "room_status");
  const today = new Date().toISOString().slice(0, 10);
  const monthPrefix = `${new Date().getFullYear()}-${String(new Date().getMonth()+1).padStart(2,"0")}`;
  const zh = locale === "zh";

  const custMap = useMemo(() => { const m = new Map<string, CustomerRow>(); for (const c of customers) m.set(c.id, c); return m; }, [customers]);
  const custName = (id?: string|null) => id ? custMap.get(id)?.name ?? id.slice(0,6) : "—";

  // ── Labels ──
  const L = useMemo(() => ({
    roomStatus: zh?"房态报表":"Logements",
    income: zh?"收入报表":"Revenus",
    overdue: zh?"欠费报表":"Impayés",
    daily: zh?"日租报表":"Journalier",
    lease: zh?"长租报表":"Baux",
    sale: zh?"出售回款":"Ventes",
    dailyClose: zh?"前台日结":"Clôture jour",
    total: zh?"总计":"Total",
    exportCsv: zh?"导出CSV":"Export CSV",
    unit: zh?"万XOF":"10k XOF",
    noData: zh?"暂无数据":"Aucune donnée",
    amountXof: zh?"应收":"Dû",
    paid: zh?"实收":"Payé",
    unpaid: zh?"欠费":"Impayé",
    overdueLabel: zh?"逾期":"Retard",
    rate: zh?"收缴率":"Taux",
    roomNo: zh?"房号":"Ch",
    customer: zh?"客户":"Client",
    overdueDays: zh?"逾期天数":"Jours",
    dueDate: zh?"到期":"Échéance",
    source: zh?"业务类型":"Source",
    copyClose: zh?"复制日结":"Copier",
    totalUnits: zh?"总房源":"Total",
    residential: zh?"住宿房":"Appart.",
    parking: zh?"车位":"Parking",
    storefront: zh?"门面":"Commerce",
    statusLabels: {
      available: zh?"空闲":"Dispo",
      reserved: zh?"预订":"Réservé",
      daily_occupied: zh?"日租中":"Occupé",
      cleaning_pending: zh?"待保洁":"Ménage",
      leased: zh?"长租中":"Loué",
      sold: zh?"已售":"Vendu",
      maintenance: zh?"维修":"Maint.",
      locked: zh?"锁定":"Bloqué",
    } as Record<string, string>,
    sourceLabels: {
      daily_booking: zh?"日租":"Jour",
      lease_contract: zh?"长租":"Location",
      sale_contract: zh?"出售":"Vente",
      manual: zh?"手工":"Manuel",
    } as Record<string, string>,
    todayCheckins: zh?"今日入住":"Arrivées",
    todayCheckouts: zh?"今日退房":"Départs",
    inHouse: zh?"当前在住":"Occupés",
    occupancyRate: zh?"入住率":"Taux occ.",
    pendingReview: zh?"待确认":"À conf.",
    confirmed: zh?"已确认":"Confirmé",
    monthlyIncome: zh?"月日租收入":"Revenu mois",
    openLong: zh?"开放>3天":">3j ouvert",
    activeContracts: zh?"有效合同":"Actifs",
    monthlyDue: zh?"应收":"Dû",
    monthlyPaid: zh?"实收":"Payé",
    expire30d: zh?"30天内到期":"Exp. 30j",
    expired: zh?"已到期未退":"Expiré",
    overdueContracts: zh?"欠费合同":"Impayés",
    terminated: zh?"已退租":"Résilié",
    totalAmount: zh?"合同总额":"Total",
    notDelivered: zh?"已结清未交付":"Non livré",
    overdueInstallments: zh?"逾期分期":"Retard",
    todayNewBookings: zh?"今日新预订":"Nouv. rés.",
    todayPayments: zh?"今日收款":"Paiements",
    paymentCount: zh?"收款笔数":"Nb paiements",
  }), [zh]);

  const residential = useMemo(() => units.filter(u => u.kind === "apartment"), [units]);

  // ── Room Status Report ──
  const roomStatusData = useMemo(() => {
    const kinds: Record<string, number> = { apartment: 0, parking: 0, storefront: 0, office: 0 };
    const statuses: Record<string, number> = {};
    for (const u of units) { kinds[u.kind] = (kinds[u.kind]??0)+1; statuses[u.status] = (statuses[u.status]??0)+1; }
    return { kinds, statuses, total: units.length, residential: residential.length };
  }, [units, residential]);

  // ── Income Report ──
  const incomeData = useMemo(() => {
    let rec = 0, paid = 0, overdue = 0;
    const bySource: Record<string, { rec: number; paid: number }> = {};
    for (const r of receivables) { if (r.status==="cancelled") continue; const a=Number(r.amount_xof); const p=Number(r.paid_amount_xof); rec+=a; paid+=p; if(r.status==="overdue"||(r.due_date<today&&p<a)) overdue+=a-p; const s=r.source_type; bySource[s]=bySource[s]??{rec:0,paid:0}; bySource[s].rec+=a; bySource[s].paid+=p; }
    return { rec, paid, overdue, unpaid: rec-paid, rate: rec>0?Math.round(paid/rec*100):0, bySource };
  }, [receivables, today]);

  // ── Overdue Report ──
  const overdueData = useMemo(() => {
    return receivables.filter(r => { if(r.status==="cancelled"||r.status==="paid") return false; const os=Number(r.amount_xof)-Number(r.paid_amount_xof); return os>0 && (r.status==="overdue"||r.due_date<today); }).map(r => {
      const os = Number(r.amount_xof)-Number(r.paid_amount_xof);
      const od = Math.floor((Date.now()-new Date(r.due_date).getTime())/86400000);
      const unit = units.find(u=>u.id===r.unit_id);
      return { id: r.id, unpaid: os, overdueDays: od, unitNo: unit?.unit_no??"", cust: custName(r.customer_id), dueDate: r.due_date };
    }).sort((a,b) => b.unpaid-a.unpaid);
  }, [receivables, units, custName, today]);

  // ── Daily Report ──
  const dailyData = useMemo(() => {
    const todayCheckins = bookings.filter(b => b.check_in===today && (b.status==="pending_review"||b.status==="confirmed"));
    const todayCheckouts = bookings.filter(b => (b.check_out===today||(b.checkout_mode==="open"&&b.status==="checked_in")));
    const inHouse = bookings.filter(b => b.status==="checked_in");
    const confirmed = bookings.filter(b => b.status==="confirmed");
    const pending = bookings.filter(b => b.status==="pending_review");
    const openLong = inHouse.filter(b => b.checkout_mode==="open" && (Date.now()-new Date(b.check_in).getTime())/(86400000)>3);
    const dailyIncome = payments.filter(p => p.payment_date.startsWith(monthPrefix) && p.source_type==="daily_booking").reduce((s,p)=>s+Number(p.amount),0);
    return { todayCheckins, todayCheckouts, inHouse, confirmed, pending, openLong, dailyIncome, occupancyRate: residential.length>0?Math.round(inHouse.length/residential.length*100):0 };
  }, [bookings, payments, residential, today, monthPrefix]);

  // ── Lease Report ──
  const leaseData = useMemo(() => {
    const active = leaseContracts.filter(l => l.status==="active");
    const expiring30d = active.filter(l => l.expected_end_date>=today && l.expected_end_date<=new Date(Date.now()+30*86400000).toISOString().slice(0,10));
    const expired = active.filter(l => l.expected_end_date<today);
    const terminated = leaseContracts.filter(l => l.status==="terminated");
    const leaseRecs = receivables.filter(r => r.source_type==="lease_contract"&&r.status!=="cancelled");
    const leaseRec = leaseRecs.reduce((s,r)=>s+Number(r.amount_xof),0);
    const leasePaid = leaseRecs.reduce((s,r)=>s+Number(r.paid_amount_xof),0);
    const leaseOverdue = leaseRecs.filter(r => { const os=Number(r.amount_xof)-Number(r.paid_amount_xof); return os>0&&(r.status==="overdue"||r.due_date<today); });
    return { active, expiring30d, expired, terminated, leaseRec, leasePaid, leaseOverdue, rate: leaseRec>0?Math.round(leasePaid/leaseRec*100):0 };
  }, [leaseContracts, receivables, today]);

  // ── Sale Report ──
  const saleData = useMemo(() => {
    const active = saleContracts.filter(s => s.status==="active");
    const totalAmount = active.reduce((s,sc)=>s+Number(sc.total_amount_xof),0);
    const saleRecs = receivables.filter(r => r.source_type==="sale_contract"&&r.status!=="cancelled");
    const paid = saleRecs.reduce((s,r)=>s+Number(r.paid_amount_xof),0);
    const overdueRecs = saleRecs.filter(r => { const os=Number(r.amount_xof)-Number(r.paid_amount_xof); return os>0&&(r.status==="overdue"||r.due_date<today); });
    const unpaid = saleRecs.reduce((s,r)=>s+Number(r.amount_xof)-Number(r.paid_amount_xof),0);
    const notDelivered = active.filter(s => { const paidForContract=saleRecs.filter(r=>r.source_id===s.id).reduce((sum,r)=>sum+Number(r.paid_amount_xof),0); return paidForContract>=Number(s.total_amount_xof)&&s.transfer_status!=="completed"; });
    return { active, totalAmount, paid, unpaid, overdueRecs, notDelivered, rate: totalAmount>0?Math.round(paid/totalAmount*100):0 };
  }, [saleContracts, receivables]);

  // ── Daily Close Report ──
  const dailyCloseData = useMemo(() => {
    const newBookings = bookings.filter(b => b.created_at?.startsWith(today));
    const checkins = bookings.filter(b => b.check_in===today && b.status==="checked_in");
    const checkouts = bookings.filter(b => (b.actual_check_out?.startsWith(today)||(b.status==="checked_out"&&b.check_out===today)));
    const todayPayments = payments.filter(p => p.payment_date===today);
    const inHouse = bookings.filter(b => b.status==="checked_in");
    const todayTotal = todayPayments.reduce((s,p)=>s+Number(p.amount),0);
    return { newBookings, checkins, checkouts, todayPayments, inHouse, todayTotal };
  }, [bookings, payments, today]);

  const tabs: { key: ReportTab; label: string; count?: number }[] = [
    { key: "room_status", label: L.roomStatus },
    { key: "income", label: L.income },
    { key: "overdue", label: L.overdue, count: overdueData.length },
    { key: "daily", label: L.daily },
    { key: "lease", label: L.lease },
    { key: "sale", label: L.sale },
    { key: "daily_close", label: L.dailyClose },
  ];

  const btnExport = "inline-flex items-center gap-1.5 rounded-md border bg-card px-3 py-1.5 text-sm font-semibold shadow-sm transition-colors hover:bg-accent";

  return (
    <div className="space-y-5">
      {/* ── Tabs ── */}
      <nav className="flex gap-1 overflow-x-auto rounded-xl border bg-card p-1.5 shadow-sm">
        {tabs.filter(t => permitted.includes(t.key)).map(t => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={cn(
              "shrink-0 rounded-md px-4 py-2 text-sm font-semibold transition",
              tab === t.key
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
            )}
          >
            {t.label}{t.count !== undefined && <span className="ml-1 opacity-75">({t.count})</span>}
          </button>
        ))}
      </nav>

      {/* ── Room Status ── */}
      {tab === "room_status" && (
        <div className="space-y-5">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <StatBlock label={L.totalUnits} value={String(roomStatusData.total)} dot="bg-accentBlue-500" />
            <StatBlock label={L.residential} value={String(roomStatusData.residential)} dot="bg-accentGreen-500" />
            <StatBlock label={L.parking} value={String(roomStatusData.kinds.parking)} dot="bg-muted-foreground/40" />
            <StatBlock label={L.storefront} value={String(roomStatusData.kinds.storefront)} dot="bg-muted-foreground/40" />
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {Object.entries(roomStatusData.statuses).map(([k, v]) => {
              const dot = k === "available" ? "bg-accentGreen-500" : k === "daily_occupied" ? "bg-accentBlue-500" : k === "leased" ? "bg-[#7050A0]" : k === "sold" ? "bg-[#505080]" : k === "maintenance" || k === "locked" ? "bg-[#F0A080]" : k === "cleaning_pending" ? "bg-accentAmber-500" : "bg-muted-foreground/40";
              return <StatBlock key={k} label={L.statusLabels[k] ?? k} value={String(v)} dot={dot} />;
            })}
          </div>
          <button onClick={() => downloadCsv("类型,状态,数量", Object.entries(roomStatusData.statuses).map(([k, v]) => csvLine([k, L.statusLabels[k] ?? k, v])), "room_status")}
            className={btnExport}><Download className="h-4 w-4" />{L.exportCsv}</button>
        </div>
      )}

      {/* ── Income ── */}
      {tab === "income" && (
        <div className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <StatBlock label={L.amountXof} value={formatXof(incomeData.rec)} dot="bg-accentBlue-500" />
            <StatBlock label={L.paid} value={formatXof(incomeData.paid)} dot="bg-accentGreen-500" />
            <StatBlock label={L.unpaid} value={formatXof(incomeData.unpaid)} dot="bg-accentAmber-500" />
            <StatBlock label={L.overdueLabel} value={formatXof(incomeData.overdue)} dot="bg-accentRed-500" />
            <StatBlock label={L.rate} value={`${incomeData.rate}%`} dot={incomeData.rate >= 80 ? "bg-accentGreen-500" : "bg-accentAmber-500"} />
          </div>
          <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[13px]">
                <thead className="border-b bg-muted text-xs font-semibold uppercase tracking-[0.04em] text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2.5">{L.source}</th>
                    <th className="px-4 py-2.5 text-right">{L.amountXof}</th>
                    <th className="px-4 py-2.5 text-right">{L.paid}</th>
                    <th className="px-4 py-2.5 text-right">{L.rate}</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {Object.entries(incomeData.bySource).map(([k, v]) => (
                    <tr key={k} className="transition-colors hover:bg-accent/50">
                      <td className="px-4 py-2.5 font-medium">{L.sourceLabels[k] ?? k}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{formatXof(v.rec)}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-emerald-600">{formatXof(v.paid)}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{v.rec > 0 ? Math.round(v.paid / v.rec * 100) : 0}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <button onClick={() => downloadCsv("业务类型,应收,实收,收缴率", Object.entries(incomeData.bySource).map(([k, v]) => csvLine([k, v.rec, v.paid, `${v.rec > 0 ? Math.round(v.paid / v.rec * 100) : 0}%`])), "income")}
            className={btnExport}><Download className="h-4 w-4" />{L.exportCsv}</button>
        </div>
      )}

      {/* ── Overdue ── */}
      {tab === "overdue" && (
        <div className="space-y-5">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span>{zh ? "共" : "Total"}: {overdueData.length} {zh ? "条" : "lignes"}</span>
            <span>·</span>
            <span>{L.unpaid}: <strong className="tabular-nums text-rose-600">{formatXof(overdueData.reduce((s, r) => s + r.unpaid, 0))}</strong></span>
          </div>
          {overdueData.length === 0 ? (
            <div className="flex flex-col items-center gap-3 rounded-xl border bg-card py-16 shadow-sm">
              <p className="text-sm font-semibold text-muted-foreground">{L.noData}</p>
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border bg-card shadow-sm max-h-[500px] overflow-y-auto">
              <table className="w-full text-left text-[13px]">
                <thead className="sticky top-0 bg-muted text-xs font-semibold uppercase tracking-[0.04em] text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2.5">{L.roomNo}</th>
                    <th className="px-4 py-2.5">{L.customer}</th>
                    <th className="px-4 py-2.5 text-right">{L.unpaid}</th>
                    <th className="px-4 py-2.5 text-right">{L.overdueDays}</th>
                    <th className="px-4 py-2.5">{L.dueDate}</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {overdueData.map(r => (
                    <tr key={r.id} className="bg-red-50/30 transition-colors hover:bg-accent/50">
                      <td className="px-4 py-2.5 font-mono">{r.unitNo}</td>
                      <td className="px-4 py-2.5">{r.cust}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-rose-600">{formatXof(r.unpaid)}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-rose-600 font-semibold">+{r.overdueDays}</td>
                      <td className="px-4 py-2.5 whitespace-nowrap text-muted-foreground">{r.dueDate}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <button onClick={() => downloadCsv("房号,客户,欠费,逾期天数,到期日", overdueData.map(r => csvLine([r.unitNo, r.cust, r.unpaid, r.overdueDays, r.dueDate])), "overdue")}
            className={btnExport}><Download className="h-4 w-4" />{L.exportCsv}</button>
        </div>
      )}

      {/* ── Daily ── */}
      {tab === "daily" && (
        <div className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatBlock label={L.todayCheckins} value={String(dailyData.todayCheckins.length)} dot="bg-accentGreen-500" />
            <StatBlock label={L.todayCheckouts} value={String(dailyData.todayCheckouts.length)} dot="bg-accentAmber-500" />
            <StatBlock label={L.inHouse} value={String(dailyData.inHouse.length)} dot="bg-accentBlue-500" />
            <StatBlock label={L.occupancyRate} value={`${dailyData.occupancyRate}%`} dot="bg-accentGreen-500" />
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatBlock label={L.pendingReview} value={String(dailyData.pending.length)} dot="bg-accentAmber-500" />
            <StatBlock label={L.confirmed} value={String(dailyData.confirmed.length)} dot="bg-accentBlue-500" />
            <StatBlock label={L.monthlyIncome} value={formatXof(dailyData.dailyIncome)} dot="bg-accentGreen-500" />
            <StatBlock label={L.openLong} value={String(dailyData.openLong.length)} dot="bg-accentRed-500" />
          </div>
          <button onClick={() => downloadCsv("房号,客户,入住日期,状态", dailyData.todayCheckins.map(b => { const u = units.find(x => x.id === b.unit_id); return csvLine([u?.unit_no ?? "", custName(b.customer_id), b.check_in, b.status]); }), "daily_checkins")}
            className={btnExport}><Download className="h-4 w-4" />{L.exportCsv}</button>
        </div>
      )}

      {/* ── Lease ── */}
      {tab === "lease" && (
        <div className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatBlock label={L.activeContracts} value={String(leaseData.active.length)} dot="bg-accentGreen-500" />
            <StatBlock label={L.monthlyDue} value={formatXof(leaseData.leaseRec)} dot="bg-accentBlue-500" />
            <StatBlock label={L.monthlyPaid} value={formatXof(leaseData.leasePaid)} dot="bg-accentGreen-500" />
            <StatBlock label={L.rate} value={`${leaseData.rate}%`} dot={leaseData.rate >= 80 ? "bg-accentGreen-500" : "bg-accentAmber-500"} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatBlock label={L.expire30d} value={String(leaseData.expiring30d.length)} dot="bg-accentAmber-500" />
            <StatBlock label={L.expired} value={String(leaseData.expired.length)} dot="bg-accentRed-500" />
            <StatBlock label={L.overdueContracts} value={String(leaseData.leaseOverdue.length)} dot="bg-accentRed-500" />
            <StatBlock label={L.terminated} value={String(leaseData.terminated.length)} dot="bg-muted-foreground/40" />
          </div>
          {leaseData.expiring30d.length > 0 && (
            <div className="rounded-xl border bg-card p-4 shadow-sm">
              <p className="mb-2 text-sm font-semibold">{zh ? "30天内到期合同" : "Contrats expirant sous 30 jours"}:</p>
              {leaseData.expiring30d.map(l => (
                <p key={l.id} className="text-sm text-muted-foreground">{l.contract_no} — {l.expected_end_date}</p>
              ))}
            </div>
          )}
          <button onClick={() => downloadCsv("合同号,开始,到期,月租,状态", leaseData.active.map(l => csvLine([l.contract_no, l.start_date, l.expected_end_date, l.monthly_rent_xof, l.status])), "leases")}
            className={btnExport}><Download className="h-4 w-4" />{L.exportCsv}</button>
        </div>
      )}

      {/* ── Sale ── */}
      {tab === "sale" && (
        <div className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatBlock label={L.activeContracts} value={String(saleData.active.length)} dot="bg-accentGreen-500" />
            <StatBlock label={L.totalAmount} value={formatXof(saleData.totalAmount)} dot="bg-accentBlue-500" />
            <StatBlock label={L.paid} value={formatXof(saleData.paid)} dot="bg-accentGreen-500" />
            <StatBlock label={L.rate} value={`${saleData.rate}%`} dot={saleData.rate >= 80 ? "bg-accentGreen-500" : "bg-accentAmber-500"} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <StatBlock label={L.unpaid} value={formatXof(saleData.unpaid)} dot="bg-accentRed-500" />
            <StatBlock label={L.overdueInstallments} value={String(saleData.overdueRecs.length)} dot="bg-accentRed-500" />
            <StatBlock label={L.notDelivered} value={String(saleData.notDelivered.length)} dot="bg-accentAmber-500" />
          </div>
          <button onClick={() => downloadCsv("合同号,总价,已收,未收,状态", saleData.active.map(s => { const rec = receivables.filter(r => r.source_id === s.id && r.status !== "cancelled"); const paid = rec.reduce((sum, r) => sum + Number(r.paid_amount_xof), 0); return csvLine([s.contract_no, s.total_amount_xof, paid, Number(s.total_amount_xof) - paid, s.status]); }), "sales")}
            className={btnExport}><Download className="h-4 w-4" />{L.exportCsv}</button>
        </div>
      )}

      {/* ── Daily Close ── */}
      {tab === "daily_close" && (
        <div className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatBlock label={L.todayNewBookings} value={String(dailyCloseData.newBookings.length)} dot="bg-accentBlue-500" />
            <StatBlock label={L.todayCheckins} value={String(dailyCloseData.checkins.length)} dot="bg-accentGreen-500" />
            <StatBlock label={L.todayCheckouts} value={String(dailyCloseData.checkouts.length)} dot="bg-accentAmber-500" />
            <StatBlock label={L.todayPayments} value={formatXof(dailyCloseData.todayTotal)} dot="bg-accentGreen-500" />
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-2">
            <StatBlock label={L.inHouse} value={String(dailyCloseData.inHouse.length)} dot="bg-accentBlue-500" />
            <StatBlock label={L.paymentCount} value={String(dailyCloseData.todayPayments.length)} dot="bg-muted-foreground/40" />
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => {
              const lines: string[] = [];
              lines.push(`SACIS3.0 ${zh ? "日结" : "Clôture"} — ${today}`);
              lines.push(`${zh ? "新预订" : "Rés"}: ${dailyCloseData.newBookings.length} | ${zh ? "入住" : "Arr"}: ${dailyCloseData.checkins.length} | ${zh ? "退房" : "Dép"}: ${dailyCloseData.checkouts.length} | ${zh ? "在住" : "Occ"}: ${dailyCloseData.inHouse.length} | ${zh ? "收款" : "P"}: ${formatXof(dailyCloseData.todayTotal)}`);
              navigator.clipboard.writeText(lines.join("\n"));
            }} className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3.5 py-2 text-sm font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 active:scale-[0.98]">
              {L.copyClose}
            </button>
            <button onClick={() => downloadCsv("指标,数值", [["新预订", dailyCloseData.newBookings.length], ["入住", dailyCloseData.checkins.length], ["退房", dailyCloseData.checkouts.length], ["在住", dailyCloseData.inHouse.length], ["收款", dailyCloseData.todayTotal]].map(r => csvLine(r)), "daily_close")}
              className={btnExport}><Download className="h-4 w-4" />{L.exportCsv}</button>
          </div>
        </div>
      )}
    </div>
  );
}
