"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import {
  BedDouble, Home, CreditCard, Printer, ArrowRight, AlertTriangle,
  Building2, Calendar, DollarSign, User,
} from "lucide-react";
import type { Locale } from "@/lib/i18n";
import { routeFor } from "@/lib/i18n";
import { formatXof, cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { printDocumentRecord } from "@/features/documents/templates/all-templates";
import type { DocumentRecord } from "@/features/documents/types";
import type { UnitProfileData } from "./unit-profile-service";

const today = new Date().toISOString().slice(0, 10);

type Tab = "overview" | "daily" | "lease" | "sale" | "finance" | "docs" | "audit";

interface Props { data: UnitProfileData; locale: Locale; userRole: string; }

export function UnitProfileView({ data, locale, userRole }: Props) {
  const { unit, buildingName } = data;
  const [tab, setTab] = useState<Tab>("overview");

  const L = {
    overview: locale === "zh" ? "总览" : "Apercu", daily: locale === "zh" ? "日租" : "Jour",
    lease: locale === "zh" ? "长租" : "Location", sale: locale === "zh" ? "出售" : "Vente",
    finance: locale === "zh" ? "财务" : "Finance", docs: locale === "zh" ? "单据" : "Docs",
    audit: locale === "zh" ? "审计" : "Audit", room: locale === "zh" ? "房号" : "Ch",
    building: locale === "zh" ? "楼栋" : "Batiment", floor: locale === "zh" ? "楼层" : "Etage",
    kind: locale === "zh" ? "类型" : "Type", status: locale === "zh" ? "状态" : "Statut",
    area: locale === "zh" ? "面积" : "Surface", layout: locale === "zh" ? "户型" : "Typologie",
    newBooking: locale === "zh" ? "新建日租" : "Reserver", newLease: locale === "zh" ? "新增长租" : "Bail",
    newSale: locale === "zh" ? "新增出售" : "Vente", statusChange: locale === "zh" ? "修改房态" : "Changer statut",
    totalRec: locale === "zh" ? "累计应收" : "Total du", totalPaid: locale === "zh" ? "累计实收" : "Total paye",
    unpaid: locale === "zh" ? "欠费" : "Impaye", overdueAmt: locale === "zh" ? "逾期" : "Retard",
    lastPayment: locale === "zh" ? "最近收款" : "Dernier paiement",
    currentCustomer: locale === "zh" ? "当前客户" : "Client actuel",
    noData: locale === "zh" ? "暂无数据" : "Aucune", view: locale === "zh" ? "查看" : "Voir",
    print: locale === "zh" ? "打印" : "Imprimer", date: locale === "zh" ? "日期" : "Date",
    amount: locale === "zh" ? "金额" : "Montant", paid: locale === "zh" ? "已收" : "Paye",
    statusLabels: {
      available: locale === "zh" ? "空闲" : "Dispo", reserved: locale === "zh" ? "预订" : "Reserve",
      daily_occupied: locale === "zh" ? "日租中" : "Occupe jour", cleaning_pending: locale === "zh" ? "待保洁" : "Menage",
      leased: locale === "zh" ? "长租中" : "Loue", sold: locale === "zh" ? "已售" : "Vendu",
      maintenance: locale === "zh" ? "维修" : "Maint", locked: locale === "zh" ? "锁定" : "Bloque",
    } as Record<string, string>,
    kindLabels: { apartment: locale === "zh" ? "公寓" : "Appart", parking: locale === "zh" ? "车位" : "Parking", storefront: locale === "zh" ? "门面" : "Commerce", office: locale === "zh" ? "办公" : "Bureau" } as Record<string, string>,
    dailyStatusLabels: locale === "zh"
      ? { pending_review: "待审核", confirmed: "已确认", checked_in: "已入住", checked_out: "已退房", cancelled: "已取消" } as Record<string, string>
      : { pending_review: "A valider", confirmed: "Confirme", checked_in: "Arrive", checked_out: "Parti", cancelled: "Annule" } as Record<string, string>,
    dailyStatusV: { pending_review: "warning", confirmed: "neutral", checked_in: "success", checked_out: "neutral", cancelled: "danger" } as Record<string, string>,
    contractStatusV: { active: "success", draft: "neutral", terminated: "danger", expired: "warning" } as Record<string, string>,
    contractStatusL: locale === "zh"
      ? { active: "生效", draft: "草稿", terminated: "终止", expired: "过期" } as Record<string, string>
      : { active: "Actif", draft: "Brouillon", terminated: "Resilie", expired: "Expire" } as Record<string, string>,
  };

  const custName = (id?: string | null) => data.customers.find(c => c.id === id)?.name ?? "?";

  const stats = useMemo(() => {
    let totalRec = 0, totalPaid = 0, totalOverdue = 0;
    for (const r of data.receivables) {
      if (r.status === "cancelled") continue;
      totalRec += Number(r.amount_xof);
      totalPaid += Number(r.paid_amount_xof);
      const os = Number(r.amount_xof) - Number(r.paid_amount_xof);
      if (os > 0 && (r.status === "overdue" || r.due_date < today)) totalOverdue += os;
    }
    const latestPayment = data.payments[0] ?? null;
    const currentBooking = data.dailyBookings.find(b => b.status === "checked_in" || b.status === "confirmed");
    const currentLease = data.leaseContracts.find(l => l.status === "active");
    const currentSale = data.saleContracts.find(s => s.status === "active");
    return { totalRec, totalPaid, totalOverdue, unpaid: totalRec - totalPaid, latestPayment, currentBooking, currentLease, currentSale };
  }, [data]);

  const currentCustomer = stats.currentBooking ? custName(stats.currentBooking.customer_id)
    : stats.currentLease ? custName(stats.currentLease.customer_id)
    : stats.currentSale ? custName(stats.currentSale.customer_id) : null;

  const buildDocs = (): DocumentRecord[] => {
    const docs: DocumentRecord[] = [];
    for (const b of data.dailyBookings) {
      docs.push({ id: `doc_db_${b.id}`, docType: "daily_booking", source: "daily", title: `日租 ${unit.unit_no} ${b.check_in}`, date: b.check_in, unitNo: unit.unit_no, customerName: custName(b.customer_id), amountXof: Number(b.total_amount_xof), paidAmountXof: Number(b.prepaid_amount_xof), status: b.status, raw: b, customerPhone: undefined } as DocumentRecord);
    }
    for (const lc of data.leaseContracts) {
      docs.push({ id: `doc_lc_${lc.id}`, docType: "lease_contract", source: "lease", title: `长租合同 ${lc.contract_no}`, date: lc.start_date, unitNo: unit.unit_no, customerName: custName(lc.customer_id), amountXof: Number(lc.monthly_rent_xof), paidAmountXof: 0, status: lc.status, raw: lc, contractNo: lc.contract_no, customerPhone: undefined } as DocumentRecord);
    }
    for (const sc of data.saleContracts) {
      docs.push({ id: `doc_sc_${sc.id}`, docType: "sale_contract", source: "sale", title: `出售合同 ${sc.contract_no}`, date: sc.signed_date, unitNo: unit.unit_no, customerName: custName(sc.customer_id), amountXof: Number(sc.total_amount_xof), paidAmountXof: 0, status: sc.status, raw: sc, contractNo: sc.contract_no, customerPhone: undefined } as DocumentRecord);
    }
    return docs;
  };
  const customerDocs = useMemo(buildDocs, [data]);

  const tabs: { key: Tab; label: string; count?: number }[] = [
    { key: "overview", label: L.overview },
    { key: "daily", label: L.daily, count: data.dailyBookings.length },
    { key: "lease", label: L.lease, count: data.leaseContracts.length },
    { key: "sale", label: L.sale, count: data.saleContracts.length },
    { key: "finance", label: L.finance, count: data.receivables.length + data.payments.length },
    { key: "docs", label: L.docs, count: customerDocs.length },
    { key: "audit", label: L.audit, count: data.auditLogs.length },
  ];

  const statusColor = (s: string) => {
    const m: Record<string, string> = { available: "bg-brand-green-100 text-green-700", reserved: "bg-sky-100 text-sky-700", daily_occupied: "bg-brand-red-100 text-red-700", cleaning_pending: "bg-purple-100 text-purple-700", leased: "bg-indigo-100 text-indigo-700", sold: "bg-brand-ink-500 text-white", maintenance: "bg-amber-100 text-amber-700", locked: "bg-brand-warm-200 text-brand-ink-400" };
    return m[s] ?? "bg-brand-warm-100 text-brand-ink-500";
  };

  return (
    <div className="max-w-4xl mx-auto space-y-4">
      {/* Header */}
      <div className="rounded-xl border border-brand-warm-400 bg-white p-5 shadow-natural">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <h1 className="text-xl font-bold text-brand-ink-900">{unit.unit_no}</h1>
              <span className={cn("rounded-full px-2.5 py-0.5 text-[11px] font-semibold", statusColor(unit.status))}>{L.statusLabels[unit.status] ?? unit.status}</span>
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-brand-ink-500">
              <span><Building2 className="inline h-3 w-3 mr-0.5" />{buildingName}</span>
              <span>{L.floor}: {unit.floor_label}</span>
              <span>{L.kind}: {L.kindLabels[unit.kind] ?? unit.kind}</span>
              {unit.area_sqm && <span>{L.area}: {unit.area_sqm} m²</span>}
              {unit.layout && <span>{L.layout}: {unit.layout}</span>}
              <span>ID: {unit.id.slice(0, 8)}</span>
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <Link href={routeFor(locale, "/daily-rentals")} className="rounded bg-brand-sky-50 px-2.5 py-1.5 text-[10px] font-medium text-sky-700 hover:bg-sky-100"><BedDouble className="inline h-3 w-3 mr-0.5" />{L.newBooking}</Link>
            <Link href={routeFor(locale, "/leases")} className="rounded bg-brand-green-50 px-2.5 py-1.5 text-[10px] font-medium text-green-700 hover:bg-green-100"><Home className="inline h-3 w-3 mr-0.5" />{L.newLease}</Link>
            <Link href={routeFor(locale, "/sales")} className="rounded bg-brand-orange-50 px-2.5 py-1.5 text-[10px] font-medium text-orange-700 hover:bg-orange-100"><CreditCard className="inline h-3 w-3 mr-0.5" />{L.newSale}</Link>
          </div>
        </div>
        {currentCustomer && (
          <div className="mt-3 rounded border border-brand-warm-200 bg-brand-warm-50 px-3 py-1.5 text-xs">
            <span className="text-brand-ink-400">{L.currentCustomer}: </span>
            <span className="font-semibold text-brand-ink-800">{currentCustomer}</span>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 rounded-lg border border-brand-warm-300 bg-brand-warm-50 p-1 overflow-x-auto">
        {tabs.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={cn("shrink-0 rounded-md px-3 py-1.5 text-[12px] font-medium transition-colors", tab === t.key ? "bg-white text-brand-ink-900 shadow-sm" : "text-brand-ink-400")}>
            {t.label}{t.count !== undefined ? ` (${t.count})` : ""}
          </button>
        ))}
      </div>

      {/* ── Overview ── */}
      {tab === "overview" && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <StatBox label={L.totalRec} value={formatXof(stats.totalRec)} accent="ink" />
            <StatBox label={L.totalPaid} value={formatXof(stats.totalPaid)} accent="green" />
            <StatBox label={L.unpaid} value={formatXof(stats.unpaid)} accent={stats.unpaid > 0 ? "red" : "green"} />
            <StatBox label={L.overdueAmt} value={formatXof(stats.totalOverdue)} accent={stats.totalOverdue > 0 ? "red" : "green"} />
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            <div className="rounded-lg border border-brand-warm-300 bg-white p-3 text-xs">
              <p className="text-brand-ink-400">{L.lastPayment}</p>
              <p className="font-semibold">{stats.latestPayment ? `${stats.latestPayment.payment_date} · ${formatXof(Number(stats.latestPayment.amount))}` : L.noData}</p>
            </div>
            <div className="rounded-lg border border-brand-warm-300 bg-white p-3 text-xs">
              <p className="text-brand-ink-400">{L.currentCustomer}</p>
              <p className="font-semibold">{currentCustomer ?? L.noData}</p>
            </div>
            <div className="rounded-lg border border-brand-warm-300 bg-white p-3 text-xs">
              <p className="text-brand-ink-400">{locale === "zh" ? "当前占用" : "Occupation"}</p>
              <p className="font-semibold">
                {stats.currentBooking && <span>{L.daily}: {stats.currentBooking.check_in} </span>}
                {stats.currentLease && <span>{L.lease}: {stats.currentLease.contract_no} </span>}
                {stats.currentSale && <span>{L.sale}: {stats.currentSale.contract_no}</span>}
                {!stats.currentBooking && !stats.currentLease && !stats.currentSale && L.noData}
              </p>
            </div>
          </div>
          {/* Unit info */}
          <div className="rounded-lg border border-brand-warm-300 bg-white p-3">
            <p className="text-xs font-semibold text-brand-ink-700 mb-2">{locale === "zh" ? "房源信息" : "Details"}</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1 text-xs text-brand-ink-500">
              <span>{L.floor}: {unit.floor_label}</span>
              <span>{L.kind}: {L.kindLabels[unit.kind] ?? unit.kind}</span>
              {unit.area_sqm && <span>{L.area}: {unit.area_sqm} m²</span>}
              {unit.layout && <span>{L.layout}: {unit.layout}</span>}
              {unit.furnishing && <span>{locale === "zh" ? "家具" : "Meubles"}: {unit.furnishing}</span>}
              {unit.notes && <span className="col-span-2">{locale === "zh" ? "备注" : "Notes"}: {unit.notes}</span>}
            </div>
          </div>
        </div>
      )}

      {/* ── Daily Tab ── */}
      {tab === "daily" && (
        <div className="rounded-xl border border-brand-warm-300 bg-white overflow-hidden">
          {data.dailyBookings.length === 0 ? <div className="py-10 text-center text-sm text-brand-ink-300">{L.noData}</div> : (
            <table className="w-full text-xs">
              <thead className="bg-brand-warm-50 text-[10px] uppercase text-brand-ink-400"><tr>
                <th className="px-3 py-2"><User className="inline h-3 w-3 mr-0.5" />{locale === "zh" ? "客户" : "Client"}</th>
                <th className="px-3 py-2"><Calendar className="inline h-3 w-3 mr-0.5" />{L.date}</th>
                <th className="px-3 py-2">{L.status}</th>
                <th className="px-3 py-2 text-right"><DollarSign className="inline h-3 w-3 mr-0.5" />{L.amount}</th>
                <th className="px-3 py-2">{L.view}</th>
              </tr></thead>
              <tbody className="divide-y divide-brand-warm-200">
                {data.dailyBookings.map(b => (
                  <tr key={b.id} className="hover:bg-brand-warm-50">
                    <td className="px-3 py-2 font-medium">{custName(b.customer_id)}</td>
                    <td className="px-3 py-2 text-brand-ink-500">{b.check_in} → {b.check_out ?? (locale === "zh" ? "未定" : "?")}</td>
                    <td className="px-3 py-2"><Badge variant={(L.dailyStatusV[b.status] as "success" | "warning" | "danger" | "neutral") ?? "neutral"}>{L.dailyStatusLabels[b.status]}</Badge></td>
                    <td className="px-3 py-2 text-right font-medium">{formatXof(Number(b.total_amount_xof))}</td>
                    <td className="px-3 py-2"><Link href={routeFor(locale, "/daily-rentals")} className="text-brand-orange text-[10px] font-medium hover:underline">{L.view}</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* ── Lease Tab ── */}
      {tab === "lease" && (
        <div className="rounded-xl border border-brand-warm-300 bg-white overflow-hidden">
          {data.leaseContracts.length === 0 ? <div className="py-10 text-center text-sm text-brand-ink-300">{L.noData}</div> : (
            <table className="w-full text-xs">
              <thead className="bg-brand-warm-50 text-[10px] uppercase text-brand-ink-400"><tr>
                <th className="px-3 py-2"><User className="inline h-3 w-3 mr-0.5" />{locale === "zh" ? "客户" : "Client"}</th>
                <th className="px-3 py-2">{locale === "zh" ? "合同号" : "N°"}</th>
                <th className="px-3 py-2"><Calendar className="inline h-3 w-3 mr-0.5" />{L.date}</th>
                <th className="px-3 py-2 text-right"><DollarSign className="inline h-3 w-3 mr-0.5" />{L.amount}</th>
                <th className="px-3 py-2">{L.status}</th>
                <th className="px-3 py-2">{L.view}</th>
              </tr></thead>
              <tbody className="divide-y divide-brand-warm-200">
                {data.leaseContracts.map(lc => (
                  <tr key={lc.id} className="hover:bg-brand-warm-50">
                    <td className="px-3 py-2 font-medium">{custName(lc.customer_id)}</td>
                    <td className="px-3 py-2">{lc.contract_no}</td>
                    <td className="px-3 py-2 text-brand-ink-500">{lc.start_date} → {lc.expected_end_date}</td>
                    <td className="px-3 py-2 text-right font-medium">{formatXof(Number(lc.monthly_rent_xof))}</td>
                    <td className="px-3 py-2"><Badge variant={(L.contractStatusV[lc.status] as "success" | "warning" | "danger" | "neutral") ?? "neutral"}>{L.contractStatusL[lc.status]}</Badge></td>
                    <td className="px-3 py-2"><Link href={routeFor(locale, "/leases")} className="text-brand-orange text-[10px] font-medium hover:underline">{L.view}</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* ── Sale Tab ── */}
      {tab === "sale" && (
        <div className="rounded-xl border border-brand-warm-300 bg-white overflow-hidden">
          {data.saleContracts.length === 0 ? <div className="py-10 text-center text-sm text-brand-ink-300">{L.noData}</div> : (
            <table className="w-full text-xs">
              <thead className="bg-brand-warm-50 text-[10px] uppercase text-brand-ink-400"><tr>
                <th className="px-3 py-2"><User className="inline h-3 w-3 mr-0.5" />{locale === "zh" ? "买方" : "Acheteur"}</th>
                <th className="px-3 py-2">{locale === "zh" ? "合同号" : "N°"}</th>
                <th className="px-3 py-2 text-right"><DollarSign className="inline h-3 w-3 mr-0.5" />{L.amount}</th>
                <th className="px-3 py-2">{L.status}</th>
                <th className="px-3 py-2">{L.view}</th>
              </tr></thead>
              <tbody className="divide-y divide-brand-warm-200">
                {data.saleContracts.map(sc => (
                  <tr key={sc.id} className="hover:bg-brand-warm-50">
                    <td className="px-3 py-2 font-medium">{custName(sc.customer_id)}</td>
                    <td className="px-3 py-2">{sc.contract_no}</td>
                    <td className="px-3 py-2 text-right font-medium">{formatXof(Number(sc.total_amount_xof))}</td>
                    <td className="px-3 py-2"><Badge variant={(L.contractStatusV[sc.status] as "success" | "warning" | "danger" | "neutral") ?? "neutral"}>{L.contractStatusL[sc.status]}</Badge></td>
                    <td className="px-3 py-2"><Link href={routeFor(locale, "/sales")} className="text-brand-orange text-[10px] font-medium hover:underline">{L.view}</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* ── Finance Tab ── */}
      {tab === "finance" && (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-2">
            {(["daily_booking", "lease_contract", "sale_contract"] as const).map(src => {
              const srcRecs = data.receivables.filter(r => r.source_type === src && r.status !== "cancelled");
              const total = srcRecs.reduce((s, r) => s + Number(r.amount_xof), 0);
              const paid = srcRecs.reduce((s, r) => s + Number(r.paid_amount_xof), 0);
              const l: Record<string, string> = locale === "zh" ? { daily_booking: "日租", lease_contract: "长租", sale_contract: "出售" } : { daily_booking: "Jour", lease_contract: "LT", sale_contract: "Vente" };
              return <div key={src} className="rounded-lg border border-brand-warm-300 bg-white p-3 text-xs"><p className="text-brand-ink-400">{l[src]}</p><p className="font-semibold">{formatXof(paid)} <span className="text-brand-ink-300 font-normal">/ {formatXof(total)}</span></p></div>;
            })}
          </div>
          <div className="rounded-xl border border-brand-warm-300 bg-white overflow-hidden">
            <p className="px-3 py-2 text-[11px] font-bold text-brand-ink-700 bg-brand-warm-50">{locale === "zh" ? "应收" : "Creances"} ({data.receivables.filter(r => r.status !== "cancelled").length})</p>
            <table className="w-full text-xs"><thead className="bg-brand-warm-50/50 text-[10px] uppercase text-brand-ink-400"><tr><th className="px-3 py-1.5">{L.date}</th><th className="px-3 py-1.5">{locale === "zh" ? "来源" : "Src"}</th><th className="px-3 py-1.5 text-right">{L.amount}</th><th className="px-3 py-1.5 text-right">{L.paid}</th><th className="px-3 py-1.5">{L.status}</th></tr></thead>
            <tbody className="divide-y divide-brand-warm-200">
              {data.receivables.filter(r => r.status !== "cancelled").slice(0, 50).map(r => {
                const os = Number(r.amount_xof) - Number(r.paid_amount_xof);
                const sl: Record<string, string> = locale === "zh" ? { daily_booking: "日租", lease_contract: "长租", sale_contract: "出售", manual: "手工" } : { daily_booking: "Jr", lease_contract: "LT", sale_contract: "Vt", manual: "Man" };
                return <tr key={r.id} className={cn("hover:bg-brand-warm-50", r.status === "overdue" && "bg-brand-red-50/30")}><td className="px-3 py-1.5">{r.due_date}</td><td className="px-3 py-1.5 text-brand-ink-500">{sl[r.source_type] ?? r.source_type}</td><td className="px-3 py-1.5 text-right font-medium">{formatXof(Number(r.amount_xof))}</td><td className="px-3 py-1.5 text-right text-brand-green-600">{formatXof(Number(r.paid_amount_xof))}</td><td className="px-3 py-1.5"><Badge variant={os > 0 ? (r.status === "overdue" ? "danger" : "warning") : "success"}>{os > 0 ? formatXof(os) : (locale === "zh" ? "结清" : "Paye")}</Badge></td></tr>;
              })}
            </tbody></table>
          </div>
          <div className="rounded-xl border border-brand-warm-300 bg-white overflow-hidden">
            <p className="px-3 py-2 text-[11px] font-bold text-brand-ink-700 bg-brand-warm-50">{locale === "zh" ? "收款" : "Paiements"} ({data.payments.length})</p>
            <table className="w-full text-xs"><thead className="bg-brand-warm-50/50 text-[10px] uppercase text-brand-ink-400"><tr><th className="px-3 py-1.5">{L.date}</th><th className="px-3 py-1.5 text-right">{L.amount}</th><th className="px-3 py-1.5">{locale === "zh" ? "收据" : "Recu"}</th></tr></thead>
            <tbody className="divide-y divide-brand-warm-200">{data.payments.slice(0, 50).map(p => <tr key={p.id} className="hover:bg-brand-warm-50"><td className="px-3 py-1.5">{p.payment_date}</td><td className="px-3 py-1.5 text-right font-medium text-brand-green-700">{formatXof(Number(p.amount))}</td><td className="px-3 py-1.5 text-brand-ink-400">{p.receipt_no ?? "—"}</td></tr>)}</tbody></table>
          </div>
        </div>
      )}

      {/* ── Docs Tab ── */}
      {tab === "docs" && (
        <div className="rounded-xl border border-brand-warm-300 bg-white overflow-hidden">
          {customerDocs.length === 0 ? <div className="py-10 text-center text-sm text-brand-ink-300">{L.noData}</div> : (
            <table className="w-full text-xs"><thead className="bg-brand-warm-50 text-[10px] uppercase text-brand-ink-400"><tr><th className="px-3 py-2">{locale === "zh" ? "单据" : "Doc"}</th><th className="px-3 py-2">{L.date}</th><th className="px-3 py-2">{L.view}</th></tr></thead>
            <tbody className="divide-y divide-brand-warm-200">{customerDocs.map(d => <tr key={d.id} className="hover:bg-brand-warm-50"><td className="px-3 py-2 font-medium">{d.title}</td><td className="px-3 py-2 text-brand-ink-500">{d.date}</td><td className="px-3 py-2"><button onClick={() => printDocumentRecord(d, locale)} className="rounded bg-brand-ink-900 px-2 py-0.5 text-[10px] font-semibold text-white hover:bg-brand-ink-700"><Printer className="inline h-3 w-3 mr-0.5" />{L.print}</button></td></tr>)}</tbody></table>
          )}
        </div>
      )}

      {/* ── Audit Tab ── */}
      {tab === "audit" && (
        <div className="rounded-xl border border-brand-warm-300 bg-white overflow-hidden">
          {data.auditLogs.length === 0 ? <div className="py-10 text-center text-sm text-brand-ink-300">{L.noData}</div> : (
            <table className="w-full text-xs"><thead className="bg-brand-warm-50 text-[10px] uppercase text-brand-ink-400"><tr><th className="px-3 py-2">{locale === "zh" ? "时间" : "Date"}</th><th className="px-3 py-2">{locale === "zh" ? "操作" : "Action"}</th><th className="px-3 py-2">{locale === "zh" ? "对象" : "Objet"}</th></tr></thead>
            <tbody className="divide-y divide-brand-warm-200">{data.auditLogs.slice(0, 50).map(l => { const al: Record<string, string> = locale === "zh" ? { create: "新建", update: "修改", status_change: "修改房态", check_in: "入住", check_out: "退房", activate: "激活", terminate: "终止", move_out: "退租", payment: "收款", cancel: "取消" } : { create: "Creer", update: "Modifier", status_change: "Statut", check_in: "Arrivee", check_out: "Depart", activate: "Activer", terminate: "Resilier", move_out: "Sortie", payment: "Paiement", cancel: "Annuler" }; return <tr key={l.id} className="hover:bg-brand-warm-50"><td className="px-3 py-2 text-[10px] text-brand-ink-400">{new Date(l.created_at).toLocaleDateString()}</td><td className="px-3 py-2">{al[l.action] ?? l.action}</td><td className="px-3 py-2 text-brand-ink-400">{l.entity_type} {l.entity_id?.slice(0, 8)}</td></tr>; })}</tbody></table>
          )}
        </div>
      )}

      {/* Quick links */}
      <div className="flex flex-wrap gap-2 text-xs text-brand-ink-400">
        <Link href={routeFor(locale, "/finance")} className="hover:text-brand-orange flex items-center gap-1">{L.finance}<ArrowRight className="h-3 w-3" /></Link>
        <Link href={routeFor(locale, "/todos")} className="hover:text-brand-orange flex items-center gap-1">{locale === "zh" ? "待办" : "Taches"}<ArrowRight className="h-3 w-3" /></Link>
        <Link href={routeFor(locale, "/data-quality")} className="hover:text-brand-orange flex items-center gap-1">{locale === "zh" ? "数据质量" : "Qualite"}<ArrowRight className="h-3 w-3" /></Link>
      </div>
    </div>
  );
}

function StatBox({ label, value, accent }: { label: string; value: string; accent: string }) {
  const c: Record<string, string> = { ink: "bg-brand-ink-700", green: "bg-brand-green-500", red: "bg-brand-red-500" };
  return <div className="rounded-lg border border-brand-warm-300 bg-white shadow-natural overflow-hidden"><div className={cn("h-[3px]", c[accent] ?? "bg-brand-ink-700")} /><div className="px-3 py-2.5"><p className="text-[10px] text-brand-ink-300">{label}</p><p className="text-sm font-bold tabular-nums text-brand-ink-900">{value}</p></div></div>;
}
