"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import {
  User, Phone, FileText, AlertTriangle, BedDouble, Home, CreditCard,
  Receipt, Clock, ArrowRight, Calendar, DollarSign, ChevronDown, ChevronUp, Printer,
} from "lucide-react";
import type { Locale } from "@/lib/i18n";
import { routeFor } from "@/lib/i18n";
import { formatXof, cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { printDocumentRecord } from "@/features/documents/templates/all-templates";
import type { DocumentRecord } from "@/features/documents/types";
import type { CustomerProfileData } from "./customer-profile-service";

const today = new Date().toISOString().slice(0, 10);

type Tab = "overview" | "daily" | "lease" | "sale" | "finance" | "docs" | "audit";

interface Props {
  data: CustomerProfileData;
  locale: Locale;
  userRole: string;
}

export function CustomerProfileView({ data, locale, userRole }: Props) {
  const { customer } = data;
  const [tab, setTab] = useState<Tab>("overview");
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  const toggleRow = (id: string) => {
    setExpandedRows(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });
  };

  // ── Computed stats ──
  const stats = useMemo(() => {
    let totalRec = 0, totalPaid = 0, totalOverdue = 0;
    for (const r of data.receivables) {
      if (r.status === "cancelled") continue;
      totalRec += Number(r.amount_xof);
      totalPaid += Number(r.paid_amount_xof);
      const os = Number(r.amount_xof) - Number(r.paid_amount_xof);
      if (os > 0 && (r.status === "overdue" || r.due_date < today)) totalOverdue += os;
    }
    const latestPayment = data.payments.length > 0 ? data.payments[0] : null;
    const latestBooking = data.dailyBookings.length > 0 ? data.dailyBookings[0] : null;
    const activeDaily = data.dailyBookings.filter(b => b.status === "checked_in" || b.status === "confirmed").length;
    const activeLease = data.leaseContracts.filter(l => l.status === "active").length;
    const activeSale = data.saleContracts.filter(s => s.status === "active").length;
    return { totalRec, totalPaid, totalOverdue, unpaid: totalRec - totalPaid, latestPayment, latestBooking, activeDaily, activeLease, activeSale };
  }, [data]);

  const customerStatus = customer.is_blacklisted ? "blacklisted"
    : stats.totalOverdue > 0 ? "overdue"
    : stats.activeDaily > 0 || stats.activeLease > 0 || stats.activeSale > 0 ? "active"
    : "inactive";

  // ── Labels ──
  const L = {
    overview: locale === "zh" ? "总览" : "Apercu",
    daily: locale === "zh" ? "日租" : "Jour",
    lease: locale === "zh" ? "长租" : "Location",
    sale: locale === "zh" ? "出售" : "Vente",
    finance: locale === "zh" ? "财务" : "Finance",
    docs: locale === "zh" ? "单据" : "Documents",
    audit: locale === "zh" ? "审计" : "Audit",
    phone: locale === "zh" ? "电话" : "Tel",
    documentType: locale === "zh" ? "证件" : "Piece",
    notes: locale === "zh" ? "备注" : "Notes",
    status: locale === "zh" ? "状态" : "Statut",
    active: locale === "zh" ? "活跃" : "Actif",
    inactive: locale === "zh" ? "历史" : "Inactif",
    blacklisted: locale === "zh" ? "黑名单" : "Liste noire",
    overdue: locale === "zh" ? "欠费" : "Impaye",
    newBooking: locale === "zh" ? "新建日租" : "Reserver",
    newLease: locale === "zh" ? "新增长租" : "Nouveau bail",
    newSale: locale === "zh" ? "新增出售" : "Nouvelle vente",
    newPayment: locale === "zh" ? "新增收款" : "Paiement",
    printDoc: locale === "zh" ? "打印单据" : "Imprimer",
    totalRec: locale === "zh" ? "累计应收" : "Total du",
    totalPaid: locale === "zh" ? "累计实收" : "Total paye",
    unpaid: locale === "zh" ? "当前欠费" : "Impaye",
    overdueAmt: locale === "zh" ? "逾期金额" : "Retard",
    lastPayment: locale === "zh" ? "最近收款" : "Dernier paiement",
    lastBooking: locale === "zh" ? "最近业务" : "Derniere activite",
    noData: locale === "zh" ? "暂无数据" : "Aucune donnee",
    room: locale === "zh" ? "房号" : "Chambre",
    date: locale === "zh" ? "日期" : "Date",
    amount: locale === "zh" ? "金额" : "Montant",
    paid: locale === "zh" ? "已收" : "Paye",
    due: locale === "zh" ? "未收" : "Du",
    view: locale === "zh" ? "查看" : "Voir",
    print: locale === "zh" ? "打印" : "Imprimer",
    action: locale === "zh" ? "操作" : "Action",
    source: locale === "zh" ? "来源" : "Source",
    contractNo: locale === "zh" ? "合同号" : "N°",
  };

  const statusVariant: Record<string, "neutral" | "success" | "danger" | "warning"> = {
    active: "success", inactive: "neutral", overdue: "danger", blacklisted: "danger",
  };

  const statusLabel = locale === "zh"
    ? { active: "活跃", inactive: "历史", overdue: "欠费", blacklisted: "黑名单" }
    : { active: "Actif", inactive: "Inactif", overdue: "Impaye", blacklisted: "Liste noire" };

  const dailyStatusLabels: Record<string, string> = locale === "zh"
    ? { pending_review: "待审核", confirmed: "已确认", checked_in: "已入住", checked_out: "已退房", cancelled: "已取消" }
    : { pending_review: "A valider", confirmed: "Confirme", checked_in: "Arrive", checked_out: "Parti", cancelled: "Annule" };

  const dailyStatusVariant: Record<string, "neutral" | "success" | "danger" | "warning"> = {
    pending_review: "warning", confirmed: "neutral", checked_in: "success", checked_out: "neutral", cancelled: "danger",
  };

  const tabs: { key: Tab; label: string }[] = [
    { key: "overview", label: L.overview },
    { key: "daily", label: `${L.daily} (${data.dailyBookings.length})` },
    { key: "lease", label: `${L.lease} (${data.leaseContracts.length})` },
    { key: "sale", label: `${L.sale} (${data.saleContracts.length})` },
    { key: "finance", label: `${L.finance} (${data.receivables.length + data.payments.length})` },
    { key: "docs", label: L.docs },
    { key: "audit", label: `${L.audit} (${data.auditLogs.length})` },
  ];

  const inputClass = "w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm";
  const labelClass = "text-[10px] text-slate-500";

  const buildDocs = (): DocumentRecord[] => {
    const docs: DocumentRecord[] = [];
    // Daily booking docs
    for (const b of data.dailyBookings) {
      const unit = data.units.find(u => u.id === b.unit_id);
      docs.push({
        id: `doc_daily_${b.id}`, docType: "daily_booking", source: "daily",
        title: `日租 ${unit?.unit_no ?? ""} ${b.check_in}`,
        date: b.check_in, unitNo: unit?.unit_no ?? "", customerName: customer.name,
        amountXof: Number(b.total_amount_xof), paidAmountXof: Number(b.prepaid_amount_xof),
        status: b.status, raw: b, customerPhone: customer.phone,
      } as DocumentRecord);
      if (b.status === "checked_out") {
        docs.push({
          id: `doc_checkout_${b.id}`, docType: "daily_checkout", source: "daily",
          title: `退房结算 ${unit?.unit_no ?? ""}`, date: b.actual_check_out ?? b.check_out ?? "",
          unitNo: unit?.unit_no ?? "", customerName: customer.name,
          amountXof: Number(b.final_amount_xof ?? b.total_amount_xof), paidAmountXof: Number(b.prepaid_amount_xof),
          status: b.status, raw: b, customerPhone: customer.phone,
        } as DocumentRecord);
      }
    }
    // Lease contract docs
    for (const lc of data.leaseContracts) {
      const unit = data.units.find(u => u.id === lc.unit_id);
      docs.push({
        id: `doc_lease_${lc.id}`, docType: "lease_contract", source: "lease",
        title: `长租合同 ${lc.contract_no}`, date: lc.start_date,
        unitNo: unit?.unit_no ?? "", customerName: customer.name,
        amountXof: Number(lc.monthly_rent_xof), paidAmountXof: 0,
        status: lc.status, raw: lc, contractNo: lc.contract_no, customerPhone: customer.phone,
      } as DocumentRecord);
    }
    // Sale contract docs
    for (const sc of data.saleContracts) {
      const unit = data.units.find(u => u.id === sc.unit_id);
      docs.push({
        id: `doc_sale_${sc.id}`, docType: "sale_contract", source: "sale",
        title: `出售合同 ${sc.contract_no}`, date: sc.signed_date,
        unitNo: unit?.unit_no ?? "", customerName: customer.name,
        amountXof: Number(sc.total_amount_xof), paidAmountXof: 0,
        status: sc.status, raw: sc, contractNo: sc.contract_no, customerPhone: customer.phone,
      } as DocumentRecord);
    }
    return docs;
  };

  const customerDocs = useMemo(buildDocs, [data]);

  return (
    <div className="max-w-4xl mx-auto space-y-4">
      {/* Header */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-natural">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <h1 className="text-xl font-black text-slate-950">{customer.name}</h1>
              <Badge variant={statusVariant[customerStatus]}>{statusLabel[customerStatus]}</Badge>
              {customer.is_blacklisted && <AlertTriangle className="h-4 w-4 text-brand-red-500" />}
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
              {customer.phone && <span className="flex items-center gap-1"><Phone className="h-3 w-3" />{customer.phone}</span>}
              {customer.document_type && <span>{locale === "zh" ? "证件" : "Piece"}: {customer.document_type}</span>}
              {customer.gender && <span>{locale === "zh" ? (customer.gender === "male" ? "男" : customer.gender === "female" ? "女" : "其他") : (customer.gender === "male" ? "H" : customer.gender === "female" ? "F" : "Autre")}</span>}
              {customer.notes && <span className="text-slate-400">{customer.notes}</span>}
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <Link href={routeFor(locale, "/daily-rentals")} className="rounded bg-brand-sky-50 px-2.5 py-1.5 text-[10px] font-semibold text-sky-700 hover:bg-sky-100"><BedDouble className="inline h-3 w-3 mr-0.5" />{L.newBooking}</Link>
            <Link href={routeFor(locale, "/leases")} className="rounded bg-brand-green-50 px-2.5 py-1.5 text-[10px] font-semibold text-green-700 hover:bg-green-100"><Home className="inline h-3 w-3 mr-0.5" />{L.newLease}</Link>
            <Link href={routeFor(locale, "/sales")} className="rounded bg-brand-orange-50 px-2.5 py-1.5 text-[10px] font-semibold text-brand-orange-700 hover:bg-brand-orange-100"><CreditCard className="inline h-3 w-3 mr-0.5" />{L.newSale}</Link>
          </div>
        </div>
        {/* Blacklist info */}
        {customer.is_blacklisted && (
          <div className="mt-3 rounded border border-brand-red-200 bg-brand-red-50 p-3 text-xs">
            <p className="font-semibold text-brand-red-700">{L.blacklisted}: {customer.blacklist_reason}</p>
            {customer.blacklist_date && <p className="text-brand-red-500 mt-0.5">{customer.blacklist_date} · {customer.blacklist_permanent ? (locale === "zh" ? "永久" : "Permanent") : (locale === "zh" ? "临时" : "Temporaire")}</p>}
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1 overflow-x-auto">
        {tabs.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={cn("shrink-0 rounded-md px-3 py-1.5 text-[12px] font-medium transition-colors", tab === t.key ? "bg-white text-slate-950 shadow-sm" : "text-slate-500 hover:text-slate-700")}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Overview Tab ── */}
      {tab === "overview" && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <StatBox label={L.totalRec} value={formatXof(stats.totalRec)} accent="ink" />
            <StatBox label={L.totalPaid} value={formatXof(stats.totalPaid)} accent="green" />
            <StatBox label={L.unpaid} value={formatXof(stats.unpaid)} accent={stats.unpaid > 0 ? "red" : "green"} />
            <StatBox label={L.overdueAmt} value={formatXof(stats.totalOverdue)} accent={stats.totalOverdue > 0 ? "red" : "green"} />
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            <div className="rounded-lg border border-slate-200 bg-white p-3 text-xs">
              <p className="text-slate-500">{L.lastPayment}</p>
              <p className="font-semibold">{stats.latestPayment ? `${stats.latestPayment.payment_date} · ${formatXof(Number(stats.latestPayment.amount))}` : L.noData}</p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-white p-3 text-xs">
              <p className="text-slate-500">{L.lastBooking}</p>
              <p className="font-semibold">{stats.latestBooking ? `${stats.latestBooking.check_in} · ${dailyStatusLabels[stats.latestBooking.status]}` : L.noData}</p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-white p-3 text-xs">
              <p className="text-slate-500">{locale === "zh" ? "当前业务" : "Actif"}</p>
              <p className="font-semibold">
                {stats.activeDaily > 0 && <span>{L.daily}:{stats.activeDaily} </span>}
                {stats.activeLease > 0 && <span>{L.lease}:{stats.activeLease} </span>}
                {stats.activeSale > 0 && <span>{L.sale}:{stats.activeSale}</span>}
                {stats.activeDaily === 0 && stats.activeLease === 0 && stats.activeSale === 0 && L.noData}
              </p>
            </div>
          </div>
          {/* Related units */}
          {data.units.length > 0 && (
            <div className="rounded-lg border border-slate-200 bg-white p-3">
              <p className="text-xs font-semibold text-slate-800 mb-2">{locale === "zh" ? "关联房源" : "Logements lies"}</p>
              <div className="flex flex-wrap gap-1.5">
                {data.units.map(u => (
                  <span key={u.id} className="rounded bg-slate-100 px-2 py-0.5 text-[10px] font-mono text-slate-700">{u.unit_no} ({u.kind})</span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Daily Tab ── */}
      {tab === "daily" && (
        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-natural">
          {data.dailyBookings.length === 0 ? (
            <div className="py-10 text-center text-sm text-slate-400">{L.noData}</div>
          ) : (
            <table className="data-table">
              <thead className="bg-slate-50/90 text-[10px] font-black uppercase tracking-[0.14em] text-slate-500"><tr>
                <th className="px-3 py-2">{L.room}</th><th className="px-3 py-2">{L.date}</th><th className="px-3 py-2">{L.status}</th><th className="px-3 py-2 text-right">{L.amount}</th><th className="px-3 py-2">{L.action}</th>
              </tr></thead>
              <tbody className="divide-y divide-slate-100">
                {data.dailyBookings.map(b => {
                  const unit = data.units.find(u => u.id === b.unit_id);
                  return (<tr key={b.id} className="hover:bg-slate-50/80">
                    <td className="px-3 py-2 font-mono font-medium">{unit?.unit_no ?? "?"}</td>
                    <td className="px-3 py-2 text-slate-600">{b.check_in} → {b.check_out ?? (locale === "zh" ? "未定" : "?")}</td>
                    <td className="px-3 py-2"><Badge variant={dailyStatusVariant[b.status]}>{dailyStatusLabels[b.status]}</Badge></td>
                    <td className="px-3 py-2 text-right font-medium">{formatXof(Number(b.total_amount_xof))}</td>
                    <td className="px-3 py-2"><Link href={routeFor(locale, "/daily-rentals")} className="text-brand-orange text-[10px] font-semibold hover:underline">{L.view}</Link></td>
                  </tr>);
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* ── Lease Tab ── */}
      {tab === "lease" && (
        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-natural">
          {data.leaseContracts.length === 0 ? (
            <div className="py-10 text-center text-sm text-slate-400">{L.noData}</div>
          ) : (
            <table className="data-table">
              <thead className="bg-slate-50/90 text-[10px] font-black uppercase tracking-[0.14em] text-slate-500"><tr>
                <th className="px-3 py-2">{L.room}</th><th className="px-3 py-2">{L.contractNo}</th><th className="px-3 py-2">{L.date}</th><th className="px-3 py-2 text-right">{L.amount}</th><th className="px-3 py-2">{L.status}</th><th className="px-3 py-2">{L.action}</th>
              </tr></thead>
              <tbody className="divide-y divide-slate-100">
                {data.leaseContracts.map(lc => {
                  const unit = data.units.find(u => u.id === lc.unit_id);
                  const statusV: Record<string, "neutral" | "success" | "danger" | "warning"> = { active: "success", draft: "neutral", terminated: "danger", expired: "warning" };
                  const statusL: Record<string, string> = locale === "zh" ? { active: "生效", draft: "草稿", terminated: "终止", expired: "过期" } : { active: "Actif", draft: "Brouillon", terminated: "Resilie", expired: "Expire" };
                  return (<tr key={lc.id} className="hover:bg-slate-50/80">
                    <td className="px-3 py-2 font-mono font-medium">{unit?.unit_no ?? "?"}</td>
                    <td className="px-3 py-2">{lc.contract_no}</td>
                    <td className="px-3 py-2 text-slate-600">{lc.start_date} → {lc.expected_end_date}</td>
                    <td className="px-3 py-2 text-right font-medium">{formatXof(Number(lc.monthly_rent_xof))}</td>
                    <td className="px-3 py-2"><Badge variant={statusV[lc.status]}>{statusL[lc.status]}</Badge></td>
                    <td className="px-3 py-2"><Link href={routeFor(locale, "/leases")} className="text-brand-orange text-[10px] font-semibold hover:underline">{L.view}</Link></td>
                  </tr>);
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* ── Sale Tab ── */}
      {tab === "sale" && (
        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-natural">
          {data.saleContracts.length === 0 ? (
            <div className="py-10 text-center text-sm text-slate-400">{L.noData}</div>
          ) : (
            <table className="data-table">
              <thead className="bg-slate-50/90 text-[10px] font-black uppercase tracking-[0.14em] text-slate-500"><tr>
                <th className="px-3 py-2">{L.room}</th><th className="px-3 py-2">{L.contractNo}</th><th className="px-3 py-2 text-right">{L.amount}</th><th className="px-3 py-2">{L.status}</th><th className="px-3 py-2">{L.action}</th>
              </tr></thead>
              <tbody className="divide-y divide-slate-100">
                {data.saleContracts.map(sc => {
                  const unit = data.units.find(u => u.id === sc.unit_id);
                  const statusV: Record<string, "neutral" | "success" | "danger" | "warning"> = { active: "success", draft: "neutral", terminated: "danger", expired: "warning" };
                  const statusL: Record<string, string> = locale === "zh" ? { active: "生效", draft: "草稿", terminated: "终止", expired: "过期" } : { active: "Actif", draft: "Brouillon", terminated: "Resilie", expired: "Expire" };
                  return (<tr key={sc.id} className="hover:bg-slate-50/80">
                    <td className="px-3 py-2 font-mono font-medium">{unit?.unit_no ?? "?"}</td>
                    <td className="px-3 py-2">{sc.contract_no}</td>
                    <td className="px-3 py-2 text-right font-medium">{formatXof(Number(sc.total_amount_xof))}</td>
                    <td className="px-3 py-2"><Badge variant={statusV[sc.status]}>{statusL[sc.status]}</Badge></td>
                    <td className="px-3 py-2"><Link href={routeFor(locale, "/sales")} className="text-brand-orange text-[10px] font-semibold hover:underline">{L.view}</Link></td>
                  </tr>);
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* ── Finance Tab ── */}
      {tab === "finance" && (
        <div className="space-y-4">
          {/* Summary by source */}
          <div className="grid grid-cols-3 gap-2">
            {(["daily_booking", "lease_contract", "sale_contract"] as const).map(src => {
              const srcRecs = data.receivables.filter(r => r.source_type === src && r.status !== "cancelled");
              const total = srcRecs.reduce((s, r) => s + Number(r.amount_xof), 0);
              const paid = srcRecs.reduce((s, r) => s + Number(r.paid_amount_xof), 0);
              const srcLabels: Record<string, string> = locale === "zh" ? { daily_booking: L.daily, lease_contract: L.lease, sale_contract: L.sale } : { daily_booking: "Jour", lease_contract: "Location", sale_contract: "Vente" };
              return (
                <div key={src} className="rounded-lg border border-slate-200 bg-white p-3 text-xs">
                  <p className="text-slate-500">{srcLabels[src]}</p>
                  <p className="font-semibold">{formatXof(paid)} <span className="text-slate-400 font-normal">/ {formatXof(total)}</span></p>
                </div>
              );
            })}
          </div>
          {/* Receivables */}
          <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-natural">
            <p className="px-3 py-2 text-[11px] font-bold text-slate-800 bg-slate-50">{locale === "zh" ? "应收记录" : "Creances"} ({data.receivables.filter(r => r.status !== "cancelled").length})</p>
            <table className="data-table">
              <thead className="bg-slate-50/90 text-[10px] font-black uppercase tracking-[0.14em] text-slate-500"><tr>
                <th className="px-3 py-1.5">{L.date}</th><th className="px-3 py-1.5">{L.source}</th><th className="px-3 py-1.5 text-right">{L.amount}</th><th className="px-3 py-1.5 text-right">{L.paid}</th><th className="px-3 py-1.5">{L.status}</th>
              </tr></thead>
              <tbody className="divide-y divide-slate-100">
                {data.receivables.filter(r => r.status !== "cancelled").slice(0, 50).map(r => {
                  const os = Number(r.amount_xof) - Number(r.paid_amount_xof);
                  const srcLabels: Record<string, string> = locale === "zh" ? { daily_booking: "日租", lease_contract: "长租", sale_contract: "出售", manual: "手工" } : { daily_booking: "Jour", lease_contract: "LT", sale_contract: "Vente", manual: "Manuel" };
                  return (<tr key={r.id} className={cn("hover:bg-slate-50/80", r.status === "overdue" && "bg-brand-red-50/30")}>
                    <td className="px-3 py-1.5">{r.due_date}</td><td className="px-3 py-1.5 text-slate-600">{srcLabels[r.source_type] ?? r.source_type}</td>
                    <td className="px-3 py-1.5 text-right font-medium">{formatXof(Number(r.amount_xof))}</td>
                    <td className="px-3 py-1.5 text-right text-brand-green-600">{formatXof(Number(r.paid_amount_xof))}</td>
                    <td className="px-3 py-1.5"><Badge variant={os > 0 ? (r.status === "overdue" ? "danger" : "warning") : "success"}>{os > 0 ? formatXof(os) : (locale === "zh" ? "已结清" : "Paye")}</Badge></td>
                  </tr>);
                })}
              </tbody>
            </table>
          </div>
          {/* Payments */}
          <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-natural">
            <p className="px-3 py-2 text-[11px] font-bold text-slate-800 bg-slate-50">{locale === "zh" ? "收款记录" : "Paiements"} ({data.payments.length})</p>
            <table className="data-table">
              <thead className="bg-slate-50/90 text-[10px] font-black uppercase tracking-[0.14em] text-slate-500"><tr>
                <th className="px-3 py-1.5">{L.date}</th><th className="px-3 py-1.5 text-right">{L.amount}</th><th className="px-3 py-1.5">{locale === "zh" ? "收据" : "Recu"}</th>
              </tr></thead>
              <tbody className="divide-y divide-slate-100">
                {data.payments.slice(0, 50).map(p => (
                  <tr key={p.id} className="hover:bg-slate-50/80">
                    <td className="px-3 py-1.5">{p.payment_date}</td>
                    <td className="px-3 py-1.5 text-right font-medium text-brand-green-700">{formatXof(Number(p.amount))}</td>
                    <td className="px-3 py-1.5 text-slate-500">{p.receipt_no ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Docs Tab ── */}
      {tab === "docs" && (
        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-natural">
          {customerDocs.length === 0 ? (
            <div className="py-10 text-center text-sm text-slate-400">{L.noData}</div>
          ) : (
            <table className="data-table">
              <thead className="bg-slate-50/90 text-[10px] font-black uppercase tracking-[0.14em] text-slate-500"><tr>
                <th className="px-3 py-2">{locale === "zh" ? "单据" : "Document"}</th><th className="px-3 py-2">{L.date}</th><th className="px-3 py-2">{L.room}</th><th className="px-3 py-2">{L.action}</th>
              </tr></thead>
              <tbody className="divide-y divide-slate-100">
                {customerDocs.map(d => (
                  <tr key={d.id} className="hover:bg-slate-50/80">
                    <td className="px-3 py-2 font-medium">{d.title}</td>
                    <td className="px-3 py-2 text-slate-600">{d.date}</td>
                    <td className="px-3 py-2">{d.unitNo}</td>
                    <td className="px-3 py-2">
                      <button onClick={() => printDocumentRecord(d, locale)}
                        className="rounded-lg bg-slate-950 px-2 py-0.5 text-[10px] font-semibold text-white hover:bg-slate-800">
                        <Printer className="inline h-3 w-3 mr-0.5" />{L.print}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* ── Audit Tab ── */}
      {tab === "audit" && (
        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-natural">
          {data.auditLogs.length === 0 ? (
            <div className="py-10 text-center text-sm text-slate-400">{L.noData}</div>
          ) : (
            <table className="data-table">
              <thead className="bg-slate-50/90 text-[10px] font-black uppercase tracking-[0.14em] text-slate-500"><tr>
                <th className="px-3 py-2">{locale === "zh" ? "时间" : "Date"}</th><th className="px-3 py-2">{L.action}</th><th className="px-3 py-2">{locale === "zh" ? "对象" : "Objet"}</th>
              </tr></thead>
              <tbody className="divide-y divide-slate-100">
                {data.auditLogs.slice(0, 50).map(l => {
                  const actionLabels: Record<string, string> = locale === "zh"
                    ? { create: "新建", update: "修改", delete: "删除", activate: "激活", terminate: "终止", check_in: "入住", check_out: "退房", payment: "收款", move_out: "退租", cancel: "取消", blacklist_add: "拉黑", blacklist_remove: "解除拉黑" }
                    : { create: "Creer", update: "Modifier", delete: "Suppr", activate: "Activer", terminate: "Resilier", check_in: "Arrivee", check_out: "Depart", payment: "Paiement", move_out: "Sortie", cancel: "Annuler", blacklist_add: "Bloquer", blacklist_remove: "Debloquer" };
                  return (<tr key={l.id} className="hover:bg-slate-50/80">
                    <td className="px-3 py-2 text-[10px] text-slate-500">{new Date(l.created_at).toLocaleDateString(locale === "zh" ? "zh-CN" : "fr-FR")}</td>
                    <td className="px-3 py-2">{actionLabels[l.action] ?? l.action}</td>
                    <td className="px-3 py-2 text-slate-500">{l.entity_type} {l.entity_id?.slice(0, 8)}</td>
                  </tr>);
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Quick links */}
      <div className="flex flex-wrap gap-2 text-xs text-slate-500">
        <Link href={routeFor(locale, "/finance")} className="hover:text-brand-orange flex items-center gap-1">{L.finance} <ArrowRight className="h-3 w-3" /></Link>
        <Link href={routeFor(locale, "/todos")} className="hover:text-brand-orange flex items-center gap-1">{locale === "zh" ? "待办" : "Taches"} <ArrowRight className="h-3 w-3" /></Link>
        <Link href={routeFor(locale, "/data-quality")} className="hover:text-brand-orange flex items-center gap-1">{locale === "zh" ? "数据质量" : "Qualite"} <ArrowRight className="h-3 w-3" /></Link>
      </div>
    </div>
  );
}

function StatBox({ label, value, accent }: { label: string; value: string; accent: string }) {
  const c: Record<string, string> = { ink: "bg-slate-800", green: "bg-brand-green-500", red: "bg-brand-red-500", orange: "bg-brand-orange" };
  return (
    <div className="rounded-lg border border-slate-200 bg-white shadow-natural overflow-hidden"><div className={cn("h-[3px]", c[accent] ?? "bg-slate-800")} /><div className="px-3 py-2.5"><p className="text-[10px] text-slate-400">{label}</p><p className="text-sm font-bold tabular-nums text-slate-950">{value}</p></div></div>
  );
}
