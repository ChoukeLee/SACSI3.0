"use client";

import { useState, useMemo } from "react";
import { Download, Mail, TrendingUp, TrendingDown, AlertTriangle } from "lucide-react";
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

export function ReportsView({ entries, bookings, units, leaseContracts, saleContracts, saleSchedules, receivables, payments, customers, locale, userRole }: Props) {
  const permitted = (Object.entries(TAB_PERMISSIONS) as [ReportTab, string[]][]).filter(([, roles]) => roles.includes(userRole)).map(([t]) => t);
  const [tab, setTab] = useState<ReportTab>(permitted[0] ?? "room_status");
  const today = new Date().toISOString().slice(0, 10);
  const monthPrefix = `${new Date().getFullYear()}-${String(new Date().getMonth()+1).padStart(2,"0")}`;

  const custMap = useMemo(() => { const m = new Map<string, CustomerRow>(); for (const c of customers) m.set(c.id, c); return m; }, [customers]);
  const custName = (id?: string|null) => id ? custMap.get(id)?.name ?? id.slice(0,6) : "—";

  const L = {
    roomStatus: locale==="zh"?"房态报表":"Logements", income: locale==="zh"?"收入报表":"Revenus",
    overdue: locale==="zh"?"欠费报表":"Impayes", daily: locale==="zh"?"日租报表":"Journalier",
    lease: locale==="zh"?"长租报表":"Baux", sale: locale==="zh"?"出售回款":"Ventes",
    dailyClose: locale==="zh"?"前台日结":"Cloture jour",
    total: locale==="zh"?"总计":"Total", exportCsv: locale==="zh"?"导出CSV":"Export CSV",
    noData: locale==="zh"?"暂无数据":"Aucune", unit: locale==="zh"?"万XOF":"10k XOF",
  };

  const residential = useMemo(() => units.filter(u => u.kind === "apartment"), [units]);

  // ── Room Status Report ──
  const roomStatusData = useMemo(() => {
    const kinds = { apartment: 0, parking: 0, storefront: 0, office: 0 };
    const statuses: Record<string, number> = {};
    for (const u of units) { kinds[u.kind as keyof typeof kinds] = (kinds[u.kind as keyof typeof kinds]??0)+1; statuses[u.status] = (statuses[u.status]??0)+1; }
    return { kinds, statuses, total: units.length, residential: residential.length };
  }, [units, residential]);

  // ── Income Report ──
  const incomeData = useMemo(() => {
    let rec = 0, paid = 0, overdue = 0;
    const bySource: Record<string, { rec: number; paid: number }> = {};
    for (const r of receivables) { if (r.status==="cancelled") continue; const a=Number(r.amount_xof); const p=Number(r.paid_amount_xof); rec+=a; paid+=p; if(r.status==="overdue"||(r.due_date<today&&p<a)) overdue+=a-p; const s=r.source_type; bySource[s]=bySource[s]??{rec:0,paid:0}; bySource[s].rec+=a; bySource[s].paid+=p; }
    return { rec, paid, overdue, unpaid: rec-paid, rate: rec>0?Math.round(paid/rec*100):0, bySource };
  }, [receivables]);

  // ── Overdue Report ──
  const overdueData = useMemo(() => {
    return receivables.filter(r => { if(r.status==="cancelled"||r.status==="paid") return false; const os=Number(r.amount_xof)-Number(r.paid_amount_xof); return os>0 && (r.status==="overdue"||r.due_date<today); }).map(r => {
      const os = Number(r.amount_xof)-Number(r.paid_amount_xof);
      const od = Math.floor((Date.now()-new Date(r.due_date).getTime())/86400000);
      const unit = units.find(u=>u.id===r.unit_id);
      return { ...r, unpaid: os, overdueDays: od, unitNo: unit?.unit_no??"", cust: custName(r.customer_id) };
    }).sort((a,b) => b.unpaid-a.unpaid);
  }, [receivables, units, custName]);

  // ── Daily Report ──
  const dailyData = useMemo(() => {
    const todayCheckins = bookings.filter(b => b.check_in===today && (b.status==="pending_review"||b.status==="confirmed"));
    const todayCheckouts = bookings.filter(b => (b.check_out===today||(b.checkout_mode==="open"&&b.status==="checked_in")));
    const inHouse = bookings.filter(b => b.status==="checked_in");
    const confirmed = bookings.filter(b => b.status==="confirmed");
    const pending = bookings.filter(b => b.status==="pending_review");
    const cancelled = bookings.filter(b => b.status==="cancelled");
    const openLong = inHouse.filter(b => b.checkout_mode==="open" && (Date.now()-new Date(b.check_in).getTime())/(86400000)>3);
    const dailyIncome = payments.filter(p => p.payment_date.startsWith(monthPrefix) && p.source_type==="daily_booking").reduce((s,p)=>s+Number(p.amount),0);
    return { todayCheckins, todayCheckouts, inHouse, confirmed, pending, cancelled, openLong, dailyIncome, occupancyRate: residential.length>0?Math.round(inHouse.length/residential.length*100):0 };
  }, [bookings, payments, residential]);

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
  }, [leaseContracts, receivables]);

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
  }, [bookings, payments]);

  const tabs: { key: ReportTab; label: string; count?: number }[] = [
    { key: "room_status", label: L.roomStatus }, { key: "income", label: L.income },
    { key: "overdue", label: L.overdue, count: overdueData.length },
    { key: "daily", label: L.daily }, { key: "lease", label: L.lease },
    { key: "sale", label: L.sale }, { key: "daily_close", label: L.dailyClose },
  ];

  const statBox = (l: string, v: string, a: string, key?: string) => {
    const c: Record<string,string>={green:"bg-brand-green-500",red:"bg-brand-red-500",ink:"bg-slate-800",orange:"bg-brand-orange"};
    return <div key={key ?? l} className="overflow-hidden rounded-2xl border border-brand-warm-200 bg-white shadow-natural"><div className={cn("h-[3px]",c[a]??"bg-slate-800")} /><div className="px-3 py-2.5"><p className="text-[10px] font-semibold text-brand-ink-400">{l}</p><p className="text-sm font-bold tabular-nums text-brand-ink-900">{v}</p></div></div>;
  };

  return (
    <div className="space-y-4">
      {/* Tabs */}
      <div className="flex gap-1 rounded-xl border border-brand-warm-200 bg-brand-warm-100 p-1 overflow-x-auto">
        {tabs.filter(t => permitted.includes(t.key)).map(t => (
          <button key={t.key} onClick={() => setTab(t.key)} className={cn("shrink-0 rounded-md px-3 py-1.5 text-[12px] font-medium transition-colors", tab===t.key?"bg-white text-brand-ink-900 shadow-sm":"text-brand-ink-500")}>
            {t.label}{t.count !== undefined ? ` (${t.count})` : ""}
          </button>
        ))}
      </div>

      {/* ── Room Status ── */}
      {tab === "room_status" && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {statBox(locale==="zh"?"总房源":"Total", String(roomStatusData.total), "ink")}
            {statBox(locale==="zh"?"住宿房":"Appart.", String(roomStatusData.residential), "green")}
            {statBox(locale==="zh"?"车位":"Parking", String(roomStatusData.kinds.parking), "ink")}
            {statBox(locale==="zh"?"门面":"Commerce", String(roomStatusData.kinds.storefront), "ink")}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {Object.entries(roomStatusData.statuses).map(([k,v]) => {
              const labels: Record<string,string> = locale==="zh"?{available:"空闲",reserved:"预订",daily_occupied:"日租中",cleaning_pending:"待保洁",leased:"长租中",sold:"已售",maintenance:"维修",locked:"锁定"}:{available:"Dispo",reserved:"Reserve",daily_occupied:"Occupe",cleaning_pending:"Menage",leased:"Loue",sold:"Vendu",maintenance:"Maint",locked:"Bloque"};
              return statBox(labels[k]??k, String(v), k==="available"?"green":k==="daily_occupied"?"red":"ink", k);
            })}
          </div>
          <button onClick={() => downloadCsv("类型,状态,数量",Object.entries(roomStatusData.statuses).map(([k,v])=>csvLine([k,(locale==="zh"?{available:"空闲",daily_occupied:"日租中",leased:"长租中",sold:"已售"}:{available:"Dispo",daily_occupied:"Occupe",leased:"Loue",sold:"Vendu"})[k]??k,v])),"room_status")}
            className="inline-flex items-center gap-1.5 rounded-xl border border-brand-warm-200 bg-white px-3 py-1.5 text-xs font-semibold text-brand-ink-600 shadow-sm transition hover:border-brand-warm-300 hover:bg-brand-warm-50"><Download className="h-3.5 w-3.5"/>{L.exportCsv}</button>
        </div>
      )}

      {/* ── Income ── */}
      {tab === "income" && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
            {statBox(locale==="zh"?"应收":"Du", formatXof(incomeData.rec), "ink")}
            {statBox(locale==="zh"?"实收":"Paye", formatXof(incomeData.paid), "green")}
            {statBox(locale==="zh"?"欠费":"Impaye", formatXof(incomeData.unpaid), "red")}
            {statBox(locale==="zh"?"逾期":"Retard", formatXof(incomeData.overdue), "red")}
            {statBox(locale==="zh"?"收缴率":"Taux", `${incomeData.rate}%`, incomeData.rate>=80?"green":"orange")}
          </div>
          <div className="overflow-x-auto rounded-2xl border border-brand-warm-200 bg-white shadow-natural">
            <table className="data-table"><thead className="bg-brand-warm-50/90 text-[10px] font-black uppercase tracking-[0.14em] text-brand-ink-500"><tr><th className="px-3 py-2">{locale==="zh"?"业务类型":"Source"}</th><th className="px-3 py-2 text-right">{locale==="zh"?"应收":"Du"}</th><th className="px-3 py-2 text-right">{locale==="zh"?"实收":"Paye"}</th><th className="px-3 py-2 text-right">{locale==="zh"?"收缴率":"Taux"}</th></tr></thead>
            <tbody className="divide-y divide-brand-warm-100">
              {Object.entries(incomeData.bySource).map(([k,v]) => {
                const labels: Record<string,string> = locale==="zh"?{daily_booking:"日租",lease_contract:"长租",sale_contract:"出售",manual:"手工"}:{daily_booking:"Jour",lease_contract:"LT",sale_contract:"Vente",manual:"Manuel"};
                return <tr key={k}><td className="px-3 py-2 font-medium">{labels[k]??k}</td><td className="px-3 py-2 text-right">{formatXof(v.rec)}</td><td className="px-3 py-2 text-right text-brand-green-600">{formatXof(v.paid)}</td><td className="px-3 py-2 text-right">{v.rec>0?Math.round(v.paid/v.rec*100):0}%</td></tr>;
              })}
            </tbody></table>
          </div>
          <button onClick={() => downloadCsv("业务类型,应收,实收,收缴率",Object.entries(incomeData.bySource).map(([k,v])=>csvLine([k,v.rec,v.paid,`${v.rec>0?Math.round(v.paid/v.rec*100):0}%`])),"income")}
            className="inline-flex items-center gap-1.5 rounded-xl border border-brand-warm-200 bg-white px-3 py-1.5 text-xs font-semibold text-brand-ink-600 shadow-sm transition hover:border-brand-warm-300 hover:bg-brand-warm-50"><Download className="h-3.5 w-3.5"/>{L.exportCsv}</button>
        </div>
      )}

      {/* ── Overdue ── */}
      {tab === "overdue" && (
        <div className="space-y-2">
          <div className="flex gap-2 text-xs text-brand-ink-500">{locale==="zh"?"共":"Total"}: {overdueData.length} {locale==="zh"?"条":"lignes"} · {locale==="zh"?"欠费合计":"Impaye"}: {formatXof(overdueData.reduce((s,r)=>s+r.unpaid,0))}</div>
          {overdueData.length===0 ? <p className="text-sm font-semibold text-brand-ink-400 py-8 text-center">{L.noData}</p> : (
            <div className="overflow-auto rounded-2xl border border-brand-warm-200 bg-white shadow-natural max-h-[500px]">
              <table className="data-table"><thead className="sticky top-0 bg-brand-warm-50/90 text-[10px] font-black uppercase tracking-[0.14em] text-brand-ink-500"><tr><th className="px-3 py-2">{locale==="zh"?"房号":"Ch"}</th><th className="px-3 py-2">{locale==="zh"?"客户":"Client"}</th><th className="px-3 py-2 text-right">{locale==="zh"?"欠费":"Impaye"}</th><th className="px-3 py-2 text-right">{locale==="zh"?"逾期天数":"Jours"}</th><th className="px-3 py-2">{locale==="zh"?"到期":"Echeance"}</th></tr></thead>
              <tbody className="divide-y divide-brand-warm-100">{overdueData.map(r => <tr key={r.id} className="bg-brand-red-50/20"><td className="px-3 py-2 font-mono">{r.unitNo}</td><td className="px-3 py-2">{r.cust}</td><td className="px-3 py-2 text-right font-semibold text-brand-red-600">{formatXof(r.unpaid)}</td><td className="px-3 py-2 text-right text-brand-red-500">+{r.overdueDays}</td><td className="px-3 py-2">{r.due_date}</td></tr>)}</tbody></table>
            </div>
          )}
          <button onClick={() => downloadCsv("房号,客户,欠费,逾期天数,到期日",overdueData.map(r=>csvLine([r.unitNo,r.cust,r.unpaid,r.overdueDays,r.due_date])),"overdue")}
            className="inline-flex items-center gap-1.5 rounded-xl border border-brand-warm-200 bg-white px-3 py-1.5 text-xs font-semibold text-brand-ink-600 shadow-sm transition hover:border-brand-warm-300 hover:bg-brand-warm-50"><Download className="h-3.5 w-3.5"/>{L.exportCsv}</button>
        </div>
      )}

      {/* ── Daily ── */}
      {tab === "daily" && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {statBox(locale==="zh"?"今日入住":"Arrivees", String(dailyData.todayCheckins.length), "green")}
            {statBox(locale==="zh"?"今日退房":"Departs", String(dailyData.todayCheckouts.length), "orange")}
            {statBox(locale==="zh"?"当前在住":"Occupees", String(dailyData.inHouse.length), "ink")}
            {statBox(locale==="zh"?"入住率":"Taux", `${dailyData.occupancyRate}%`, "green")}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {statBox(locale==="zh"?"待确认":"A conf.", String(dailyData.pending.length), "orange")}
            {statBox(locale==="zh"?"已确认":"Conf.", String(dailyData.confirmed.length), "ink")}
            {statBox(locale==="zh"?"月日租收入":"Revenu mois", formatXof(dailyData.dailyIncome), "green")}
            {statBox(locale==="zh"?"开放>3天":"Open>3j", String(dailyData.openLong.length), "red")}
          </div>
          <button onClick={() => downloadCsv("房号,客户,入住日期,状态",dailyData.todayCheckins.map(b=>{const u=units.find(x=>x.id===b.unit_id);return csvLine([u?.unit_no??"",custName(b.customer_id),b.check_in,b.status]);}),"daily_checkins")}
            className="inline-flex items-center gap-1.5 rounded-xl border border-brand-warm-200 bg-white px-3 py-1.5 text-xs font-semibold text-brand-ink-600 shadow-sm transition hover:border-brand-warm-300 hover:bg-brand-warm-50"><Download className="h-3.5 w-3.5"/>{L.exportCsv}</button>
        </div>
      )}

      {/* ── Lease ── */}
      {tab === "lease" && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {statBox(locale==="zh"?"有效合同":"Actifs", String(leaseData.active.length), "green")}
            {statBox(locale==="zh"?"本月应收":"Du", formatXof(leaseData.leaseRec), "ink")}
            {statBox(locale==="zh"?"本月实收":"Paye", formatXof(leaseData.leasePaid), "green")}
            {statBox(locale==="zh"?"收缴率":"Taux", `${leaseData.rate}%`, leaseData.rate>=80?"green":"orange")}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {statBox(locale==="zh"?"30天到期":"Expire 30j", String(leaseData.expiring30d.length), "orange")}
            {statBox(locale==="zh"?"已到期未退":"Expire", String(leaseData.expired.length), "red")}
            {statBox(locale==="zh"?"欠费合同":"Impayes", String(leaseData.leaseOverdue.length), "red")}
            {statBox(locale==="zh"?"已退租":"Term.", String(leaseData.terminated.length), "ink")}
          </div>
          {leaseData.expiring30d.length>0 && <div className="text-xs"><p className="font-semibold text-slate-800 mb-1">{locale==="zh"?"30天内到期合同":"Expirent sous 30j"}:</p>{leaseData.expiring30d.map(l => <p key={l.id} className="text-brand-ink-600">{l.contract_no} — {l.expected_end_date}</p>)}</div>}
          <button onClick={() => downloadCsv("合同号,开始,到期,月租,状态",leaseData.active.map(l=>csvLine([l.contract_no,l.start_date,l.expected_end_date,l.monthly_rent_xof,l.status])),"leases")}
            className="inline-flex items-center gap-1.5 rounded-xl border border-brand-warm-200 bg-white px-3 py-1.5 text-xs font-semibold text-brand-ink-600 shadow-sm transition hover:border-brand-warm-300 hover:bg-brand-warm-50"><Download className="h-3.5 w-3.5"/>{L.exportCsv}</button>
        </div>
      )}

      {/* ── Sale ── */}
      {tab === "sale" && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {statBox(locale==="zh"?"有效合同":"Actifs", String(saleData.active.length), "green")}
            {statBox(locale==="zh"?"合同总额":"Total", formatXof(saleData.totalAmount), "ink")}
            {statBox(locale==="zh"?"已收":"Paye", formatXof(saleData.paid), "green")}
            {statBox(locale==="zh"?"回款率":"Taux", `${saleData.rate}%`, saleData.rate>=80?"green":"orange")}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {statBox(locale==="zh"?"未收":"Impaye", formatXof(saleData.unpaid), "red")}
            {statBox(locale==="zh"?"逾期分期":"Retard", String(saleData.overdueRecs.length), "red")}
            {statBox(locale==="zh"?"已结清未交付":"Non livre", String(saleData.notDelivered.length), "orange")}
          </div>
          <button onClick={() => downloadCsv("合同号,总价,已收,未收,状态",saleData.active.map(s=>{const p=saleData.active.find(x=>x.id===s.id);const rec=receivables.filter(r=>r.source_id===s.id&&r.status!=="cancelled");const paid=rec.reduce((sum,r)=>sum+Number(r.paid_amount_xof),0);return csvLine([s.contract_no,s.total_amount_xof,paid,Number(s.total_amount_xof)-paid,s.status]);}),"sales")}
            className="inline-flex items-center gap-1.5 rounded-xl border border-brand-warm-200 bg-white px-3 py-1.5 text-xs font-semibold text-brand-ink-600 shadow-sm transition hover:border-brand-warm-300 hover:bg-brand-warm-50"><Download className="h-3.5 w-3.5"/>{L.exportCsv}</button>
        </div>
      )}

      {/* ── Daily Close ── */}
      {tab === "daily_close" && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {statBox(locale==="zh"?"今日新预订":"Nouv. res.", String(dailyCloseData.newBookings.length), "ink")}
            {statBox(locale==="zh"?"今日入住":"Arrivees", String(dailyCloseData.checkins.length), "green")}
            {statBox(locale==="zh"?"今日退房":"Departs", String(dailyCloseData.checkouts.length), "orange")}
            {statBox(locale==="zh"?"今日收款":"Paimts", formatXof(dailyCloseData.todayTotal), "green")}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {statBox(locale==="zh"?"当前在住":"Occupees", String(dailyCloseData.inHouse.length), "ink")}
            {statBox(locale==="zh"?"收款笔数":"Nb paimts", String(dailyCloseData.todayPayments.length), "ink")}
          </div>
          <button onClick={() => {
            const lines: string[] = [];
            lines.push(`SACIS3.0 ${locale==="zh"?"日结":"Cloture"} — ${today}`);
            lines.push(`${locale==="zh"?"新预订":"Res"}: ${dailyCloseData.newBookings.length} | ${locale==="zh"?"入住":"Arr"}: ${dailyCloseData.checkins.length} | ${locale==="zh"?"退房":"Dep"}: ${dailyCloseData.checkouts.length} | ${locale==="zh"?"在住":"Occ"}: ${dailyCloseData.inHouse.length} | ${locale==="zh"?"收款":"P"}: ${formatXof(dailyCloseData.todayTotal)}`);
            navigator.clipboard.writeText(lines.join("\n"));
          }} className="rounded-xl bg-brand-orange-500 px-3.5 py-2 text-xs font-bold text-white shadow-sm transition hover:bg-brand-orange-600 active:scale-[0.98] inline-flex items-center gap-1.5">
            {locale==="zh"?"复制日结":"Copier"}
          </button>
          <button onClick={() => downloadCsv("指标,数值",[["新预订",dailyCloseData.newBookings.length],["入住",dailyCloseData.checkins.length],["退房",dailyCloseData.checkouts.length],["在住",dailyCloseData.inHouse.length],["收款",dailyCloseData.todayTotal]].map(r=>csvLine(r)),"daily_close")}
            className="inline-flex items-center gap-1.5 rounded-xl border border-brand-warm-200 bg-white px-3 py-1.5 text-xs font-semibold text-brand-ink-600 shadow-sm transition hover:border-brand-warm-300 hover:bg-brand-warm-50 ml-2"><Download className="h-3.5 w-3.5"/>{L.exportCsv}</button>
        </div>
      )}
    </div>
  );
}
