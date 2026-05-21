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
    overview: locale === "zh" ? "æ€»è§ˆ" : "Apercu", daily: locale === "zh" ? "æ—¥ç§Ÿ" : "Jour",
    lease: locale === "zh" ? "é•¿ç§Ÿ" : "Location", sale: locale === "zh" ? "å‡ºå”®" : "Vente",
    finance: locale === "zh" ? "è´¢åŠ¡" : "Finance", docs: locale === "zh" ? "å•æ®" : "Docs",
    audit: locale === "zh" ? "å®¡è®¡" : "Audit", room: locale === "zh" ? "æˆ¿å·" : "Ch",
    building: locale === "zh" ? "æ¥¼æ ‹" : "Batiment", floor: locale === "zh" ? "æ¥¼å±‚" : "Etage",
    kind: locale === "zh" ? "ç±»åž‹" : "Type", status: locale === "zh" ? "çŠ¶æ€" : "Statut",
    area: locale === "zh" ? "é¢ç§¯" : "Surface", layout: locale === "zh" ? "æˆ·åž‹" : "Typologie",
    newBooking: locale === "zh" ? "æ–°å»ºæ—¥ç§Ÿ" : "Reserver", newLease: locale === "zh" ? "æ–°å¢žé•¿ç§Ÿ" : "Bail",
    newSale: locale === "zh" ? "æ–°å¢žå‡ºå”®" : "Vente", statusChange: locale === "zh" ? "ä¿®æ”¹æˆ¿æ€" : "Changer statut",
    totalRec: locale === "zh" ? "ç´¯è®¡åº”æ”¶" : "Total du", totalPaid: locale === "zh" ? "ç´¯è®¡å®žæ”¶" : "Total paye",
    unpaid: locale === "zh" ? "æ¬ è´¹" : "Impaye", overdueAmt: locale === "zh" ? "é€¾æœŸ" : "Retard",
    lastPayment: locale === "zh" ? "æœ€è¿‘æ”¶æ¬¾" : "Dernier paiement",
    currentCustomer: locale === "zh" ? "å½“å‰å®¢æˆ·" : "Client actuel",
    noData: locale === "zh" ? "æš‚æ— æ•°æ®" : "Aucune", view: locale === "zh" ? "æŸ¥çœ‹" : "Voir",
    print: locale === "zh" ? "æ‰“å°" : "Imprimer", date: locale === "zh" ? "æ—¥æœŸ" : "Date",
    amount: locale === "zh" ? "é‡‘é¢" : "Montant", paid: locale === "zh" ? "å·²æ”¶" : "Paye",
    statusLabels: {
      available: locale === "zh" ? "ç©ºé—²" : "Dispo", reserved: locale === "zh" ? "é¢„è®¢" : "Reserve",
      daily_occupied: locale === "zh" ? "æ—¥ç§Ÿä¸­" : "Occupe jour", cleaning_pending: locale === "zh" ? "å¾…ä¿æ´" : "Menage",
      leased: locale === "zh" ? "é•¿ç§Ÿä¸­" : "Loue", sold: locale === "zh" ? "å·²å”®" : "Vendu",
      maintenance: locale === "zh" ? "ç»´ä¿®" : "Maint", locked: locale === "zh" ? "é”å®š" : "Bloque",
    } as Record<string, string>,
    kindLabels: { apartment: locale === "zh" ? "å…¬å¯“" : "Appart", parking: locale === "zh" ? "è½¦ä½" : "Parking", storefront: locale === "zh" ? "é—¨é¢" : "Commerce", office: locale === "zh" ? "åŠžå…¬" : "Bureau" } as Record<string, string>,
    dailyStatusLabels: locale === "zh"
      ? { pending_review: "å¾…å®¡æ ¸", confirmed: "å·²ç¡®è®¤", checked_in: "å·²å…¥ä½", checked_out: "å·²é€€æˆ¿", cancelled: "å·²å–æ¶ˆ" } as Record<string, string>
      : { pending_review: "A valider", confirmed: "Confirme", checked_in: "Arrive", checked_out: "Parti", cancelled: "Annule" } as Record<string, string>,
    dailyStatusV: { pending_review: "warning", confirmed: "neutral", checked_in: "success", checked_out: "neutral", cancelled: "danger" } as Record<string, string>,
    contractStatusV: { active: "success", draft: "neutral", terminated: "danger", expired: "warning" } as Record<string, string>,
    contractStatusL: locale === "zh"
      ? { active: "ç”Ÿæ•ˆ", draft: "è‰ç¨¿", terminated: "ç»ˆæ­¢", expired: "è¿‡æœŸ" } as Record<string, string>
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
      docs.push({ id: `doc_db_${b.id}`, docType: "daily_booking", source: "daily", title: `æ—¥ç§Ÿ ${unit.unit_no} ${b.check_in}`, date: b.check_in, unitNo: unit.unit_no, customerName: custName(b.customer_id), amountXof: Number(b.total_amount_xof), paidAmountXof: Number(b.prepaid_amount_xof), status: b.status, raw: b, customerPhone: undefined } as DocumentRecord);
    }
    for (const lc of data.leaseContracts) {
      docs.push({ id: `doc_lc_${lc.id}`, docType: "lease_contract", source: "lease", title: `é•¿ç§ŸåˆåŒ ${lc.contract_no}`, date: lc.start_date, unitNo: unit.unit_no, customerName: custName(lc.customer_id), amountXof: Number(lc.monthly_rent_xof), paidAmountXof: 0, status: lc.status, raw: lc, contractNo: lc.contract_no, customerPhone: undefined } as DocumentRecord);
    }
    for (const sc of data.saleContracts) {
      docs.push({ id: `doc_sc_${sc.id}`, docType: "sale_contract", source: "sale", title: `å‡ºå”®åˆåŒ ${sc.contract_no}`, date: sc.signed_date, unitNo: unit.unit_no, customerName: custName(sc.customer_id), amountXof: Number(sc.total_amount_xof), paidAmountXof: 0, status: sc.status, raw: sc, contractNo: sc.contract_no, customerPhone: undefined } as DocumentRecord);
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
    const m: Record<string, string> = { available: "bg-brand-green-100 text-brand-green-700", reserved: "bg-brand-sky-100 text-brand-sky-700", daily_occupied: "bg-brand-orange-100 text-brand-orange-700", cleaning_pending: "bg-brand-green-100 text-brand-green-700", leased: "bg-brand-sky-100 text-brand-sky-700", sold: "bg-brand-neutral-600 text-white", maintenance: "bg-brand-red-100 text-brand-red-700", locked: "bg-brand-neutral-200 text-brand-neutral-600" };
    return m[s] ?? "bg-slate-100 text-slate-600";
  };

  return (
    <div className="max-w-4xl mx-auto space-y-4">
      {/* Header */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-natural">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <h1 className="text-xl font-black text-slate-950">{unit.unit_no}</h1>
              <span className={cn("rounded-full px-2.5 py-0.5 text-[11px] font-semibold", statusColor(unit.status))}>{L.statusLabels[unit.status] ?? unit.status}</span>
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
              <span><Building2 className="inline h-3 w-3 mr-0.5" />{buildingName}</span>
              <span>{L.floor}: {unit.floor_label}</span>
              <span>{L.kind}: {L.kindLabels[unit.kind] ?? unit.kind}</span>
              {unit.area_sqm && <span>{L.area}: {unit.area_sqm} mÂ²</span>}
              {unit.layout && <span>{L.layout}: {unit.layout}</span>}
              <span>ID: {unit.id.slice(0, 8)}</span>
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <Link href={routeFor(locale, "/daily-rentals")} className="rounded bg-brand-sky-50 px-2.5 py-1.5 text-[10px] font-semibold text-sky-700 hover:bg-sky-100"><BedDouble className="inline h-3 w-3 mr-0.5" />{L.newBooking}</Link>
            <Link href={routeFor(locale, "/leases")} className="rounded bg-brand-green-50 px-2.5 py-1.5 text-[10px] font-semibold text-green-700 hover:bg-green-100"><Home className="inline h-3 w-3 mr-0.5" />{L.newLease}</Link>
            <Link href={routeFor(locale, "/sales")} className="rounded bg-brand-orange-50 px-2.5 py-1.5 text-[10px] font-semibold text-orange-700 hover:bg-orange-100"><CreditCard className="inline h-3 w-3 mr-0.5" />{L.newSale}</Link>
          </div>
        </div>
        {currentCustomer && (
          <div className="mt-3 rounded border border-brand-neutral-200 bg-slate-50 px-3 py-1.5 text-xs">
            <span className="text-slate-500">{L.currentCustomer}: </span>
            <span className="font-semibold text-slate-900">{currentCustomer}</span>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1 overflow-x-auto">
        {tabs.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={cn("shrink-0 rounded-md px-3 py-1.5 text-[12px] font-medium transition-colors", tab === t.key ? "bg-white text-slate-950 shadow-sm" : "text-slate-500")}>
            {t.label}{t.count !== undefined ? ` (${t.count})` : ""}
          </button>
        ))}
      </div>

      {/* â”€â”€ Overview â”€â”€ */}
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
              <p className="font-semibold">{stats.latestPayment ? `${stats.latestPayment.payment_date} Â· ${formatXof(Number(stats.latestPayment.amount))}` : L.noData}</p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-white p-3 text-xs">
              <p className="text-slate-500">{L.currentCustomer}</p>
              <p className="font-semibold">{currentCustomer ?? L.noData}</p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-white p-3 text-xs">
              <p className="text-slate-500">{locale === "zh" ? "å½“å‰å ç”¨" : "Occupation"}</p>
              <p className="font-semibold">
                {stats.currentBooking && <span>{L.daily}: {stats.currentBooking.check_in} </span>}
                {stats.currentLease && <span>{L.lease}: {stats.currentLease.contract_no} </span>}
                {stats.currentSale && <span>{L.sale}: {stats.currentSale.contract_no}</span>}
                {!stats.currentBooking && !stats.currentLease && !stats.currentSale && L.noData}
              </p>
            </div>
          </div>
          {/* Unit info */}
          <div className="rounded-lg border border-slate-200 bg-white p-3">
            <p className="text-xs font-semibold text-slate-800 mb-2">{locale === "zh" ? "æˆ¿æºä¿¡æ¯" : "Details"}</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1 text-xs text-slate-600">
              <span>{L.floor}: {unit.floor_label}</span>
              <span>{L.kind}: {L.kindLabels[unit.kind] ?? unit.kind}</span>
              {unit.area_sqm && <span>{L.area}: {unit.area_sqm} mÂ²</span>}
              {unit.layout && <span>{L.layout}: {unit.layout}</span>}
              {unit.furnishing && <span>{locale === "zh" ? "å®¶å…·" : "Meubles"}: {unit.furnishing}</span>}
              {unit.notes && <span className="col-span-2">{locale === "zh" ? "å¤‡æ³¨" : "Notes"}: {unit.notes}</span>}
            </div>
          </div>
        </div>
      )}

      {/* â”€â”€ Daily Tab â”€â”€ */}
      {tab === "daily" && (
        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-natural">
          {data.dailyBookings.length === 0 ? <div className="py-10 text-center text-sm text-slate-400">{L.noData}</div> : (
            <table className="data-table">
              <thead className="bg-slate-50/90 text-[10px] font-black uppercase tracking-[0.14em] text-slate-500"><tr>
                <th className="px-3 py-2"><User className="inline h-3 w-3 mr-0.5" />{locale === "zh" ? "å®¢æˆ·" : "Client"}</th>
                <th className="px-3 py-2"><Calendar className="inline h-3 w-3 mr-0.5" />{L.date}</th>
                <th className="px-3 py-2">{L.status}</th>
                <th className="px-3 py-2 text-right"><DollarSign className="inline h-3 w-3 mr-0.5" />{L.amount}</th>
                <th className="px-3 py-2">{L.view}</th>
              </tr></thead>
              <tbody className="divide-y divide-slate-100">
                {data.dailyBookings.map(b => (
                  <tr key={b.id} className="hover:bg-slate-50/80">
                    <td className="px-3 py-2 font-medium">{custName(b.customer_id)}</td>
                    <td className="px-3 py-2 text-slate-600">{b.check_in} â†’ {b.check_out ?? (locale === "zh" ? "æœªå®š" : "?")}</td>
                    <td className="px-3 py-2"><Badge variant={(L.dailyStatusV[b.status] as "success" | "warning" | "danger" | "neutral") ?? "neutral"}>{L.dailyStatusLabels[b.status]}</Badge></td>
                    <td className="px-3 py-2 text-right font-medium">{formatXof(Number(b.total_amount_xof))}</td>
                    <td className="px-3 py-2"><Link href={routeFor(locale, "/daily-rentals")} className="text-brand-orange text-[10px] font-semibold hover:underline">{L.view}</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* â”€â”€ Lease Tab â”€â”€ */}
      {tab === "lease" && (
        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-natural">
          {data.leaseContracts.length === 0 ? <div className="py-10 text-center text-sm text-slate-400">{L.noData}</div> : (
            <table className="data-table">
              <thead className="bg-slate-50/90 text-[10px] font-black uppercase tracking-[0.14em] text-slate-500"><tr>
                <th className="px-3 py-2"><User className="inline h-3 w-3 mr-0.5" />{locale === "zh" ? "å®¢æˆ·" : "Client"}</th>
                <th className="px-3 py-2">{locale === "zh" ? "åˆåŒå·" : "NÂ°"}</th>
                <th className="px-3 py-2"><Calendar className="inline h-3 w-3 mr-0.5" />{L.date}</th>
                <th className="px-3 py-2 text-right"><DollarSign className="inline h-3 w-3 mr-0.5" />{L.amount}</th>
                <th className="px-3 py-2">{L.status}</th>
                <th className="px-3 py-2">{L.view}</th>
              </tr></thead>
              <tbody className="divide-y divide-slate-100">
                {data.leaseContracts.map(lc => (
                  <tr key={lc.id} className="hover:bg-slate-50/80">
                    <td className="px-3 py-2 font-medium">{custName(lc.customer_id)}</td>
                    <td className="px-3 py-2">{lc.contract_no}</td>
                    <td className="px-3 py-2 text-slate-600">{lc.start_date} â†’ {lc.expected_end_date}</td>
                    <td className="px-3 py-2 text-right font-medium">{formatXof(Number(lc.monthly_rent_xof))}</td>
                    <td className="px-3 py-2"><Badge variant={(L.contractStatusV[lc.status] as "success" | "warning" | "danger" | "neutral") ?? "neutral"}>{L.contractStatusL[lc.status]}</Badge></td>
                    <td className="px-3 py-2"><Link href={routeFor(locale, "/leases")} className="text-brand-orange text-[10px] font-semibold hover:underline">{L.view}</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* â”€â”€ Sale Tab â”€â”€ */}
      {tab === "sale" && (
        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-natural">
          {data.saleContracts.length === 0 ? <div className="py-10 text-center text-sm text-slate-400">{L.noData}</div> : (
            <table className="data-table">
              <thead className="bg-slate-50/90 text-[10px] font-black uppercase tracking-[0.14em] text-slate-500"><tr>
                <th className="px-3 py-2"><User className="inline h-3 w-3 mr-0.5" />{locale === "zh" ? "ä¹°æ–¹" : "Acheteur"}</th>
                <th className="px-3 py-2">{locale === "zh" ? "åˆåŒå·" : "NÂ°"}</th>
                <th className="px-3 py-2 text-right"><DollarSign className="inline h-3 w-3 mr-0.5" />{L.amount}</th>
                <th className="px-3 py-2">{L.status}</th>
                <th className="px-3 py-2">{L.view}</th>
              </tr></thead>
              <tbody className="divide-y divide-slate-100">
                {data.saleContracts.map(sc => (
                  <tr key={sc.id} className="hover:bg-slate-50/80">
                    <td className="px-3 py-2 font-medium">{custName(sc.customer_id)}</td>
                    <td className="px-3 py-2">{sc.contract_no}</td>
                    <td className="px-3 py-2 text-right font-medium">{formatXof(Number(sc.total_amount_xof))}</td>
                    <td className="px-3 py-2"><Badge variant={(L.contractStatusV[sc.status] as "success" | "warning" | "danger" | "neutral") ?? "neutral"}>{L.contractStatusL[sc.status]}</Badge></td>
                    <td className="px-3 py-2"><Link href={routeFor(locale, "/sales")} className="text-brand-orange text-[10px] font-semibold hover:underline">{L.view}</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* â”€â”€ Finance Tab â”€â”€ */}
      {tab === "finance" && (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-2">
            {(["daily_booking", "lease_contract", "sale_contract"] as const).map(src => {
              const srcRecs = data.receivables.filter(r => r.source_type === src && r.status !== "cancelled");
              const total = srcRecs.reduce((s, r) => s + Number(r.amount_xof), 0);
              const paid = srcRecs.reduce((s, r) => s + Number(r.paid_amount_xof), 0);
              const l: Record<string, string> = locale === "zh" ? { daily_booking: "æ—¥ç§Ÿ", lease_contract: "é•¿ç§Ÿ", sale_contract: "å‡ºå”®" } : { daily_booking: "Jour", lease_contract: "LT", sale_contract: "Vente" };
              return <div key={src} className="rounded-lg border border-slate-200 bg-white p-3 text-xs"><p className="text-slate-500">{l[src]}</p><p className="font-semibold">{formatXof(paid)} <span className="text-slate-400 font-normal">/ {formatXof(total)}</span></p></div>;
            })}
          </div>
          <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-natural">
            <p className="px-3 py-2 text-[11px] font-bold text-slate-800 bg-slate-50">{locale === "zh" ? "åº”æ”¶" : "Creances"} ({data.receivables.filter(r => r.status !== "cancelled").length})</p>
            <table className="data-table"><thead className="bg-slate-50/90 text-[10px] font-black uppercase tracking-[0.14em] text-slate-500"><tr><th className="px-3 py-1.5">{L.date}</th><th className="px-3 py-1.5">{locale === "zh" ? "æ¥æº" : "Src"}</th><th className="px-3 py-1.5 text-right">{L.amount}</th><th className="px-3 py-1.5 text-right">{L.paid}</th><th className="px-3 py-1.5">{L.status}</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {data.receivables.filter(r => r.status !== "cancelled").slice(0, 50).map(r => {
                const os = Number(r.amount_xof) - Number(r.paid_amount_xof);
                const sl: Record<string, string> = locale === "zh" ? { daily_booking: "æ—¥ç§Ÿ", lease_contract: "é•¿ç§Ÿ", sale_contract: "å‡ºå”®", manual: "æ‰‹å·¥" } : { daily_booking: "Jr", lease_contract: "LT", sale_contract: "Vt", manual: "Man" };
                return <tr key={r.id} className={cn("hover:bg-slate-50/80", r.status === "overdue" && "bg-brand-red-50/30")}><td className="px-3 py-1.5">{r.due_date}</td><td className="px-3 py-1.5 text-slate-600">{sl[r.source_type] ?? r.source_type}</td><td className="px-3 py-1.5 text-right font-medium">{formatXof(Number(r.amount_xof))}</td><td className="px-3 py-1.5 text-right text-brand-green-600">{formatXof(Number(r.paid_amount_xof))}</td><td className="px-3 py-1.5"><Badge variant={os > 0 ? (r.status === "overdue" ? "danger" : "warning") : "success"}>{os > 0 ? formatXof(os) : (locale === "zh" ? "ç»“æ¸…" : "Paye")}</Badge></td></tr>;
              })}
            </tbody></table>
          </div>
          <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-natural">
            <p className="px-3 py-2 text-[11px] font-bold text-slate-800 bg-slate-50">{locale === "zh" ? "æ”¶æ¬¾" : "Paiements"} ({data.payments.length})</p>
            <table className="data-table"><thead className="bg-slate-50/90 text-[10px] font-black uppercase tracking-[0.14em] text-slate-500"><tr><th className="px-3 py-1.5">{L.date}</th><th className="px-3 py-1.5 text-right">{L.amount}</th><th className="px-3 py-1.5">{locale === "zh" ? "æ”¶æ®" : "Recu"}</th></tr></thead>
            <tbody className="divide-y divide-slate-100">{data.payments.slice(0, 50).map(p => <tr key={p.id} className="hover:bg-slate-50/80"><td className="px-3 py-1.5">{p.payment_date}</td><td className="px-3 py-1.5 text-right font-medium text-brand-green-700">{formatXof(Number(p.amount))}</td><td className="px-3 py-1.5 text-slate-500">{p.receipt_no ?? "â€”"}</td></tr>)}</tbody></table>
          </div>
        </div>
      )}

      {/* â”€â”€ Docs Tab â”€â”€ */}
      {tab === "docs" && (
        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-natural">
          {customerDocs.length === 0 ? <div className="py-10 text-center text-sm text-slate-400">{L.noData}</div> : (
            <table className="data-table"><thead className="bg-slate-50/90 text-[10px] font-black uppercase tracking-[0.14em] text-slate-500"><tr><th className="px-3 py-2">{locale === "zh" ? "å•æ®" : "Doc"}</th><th className="px-3 py-2">{L.date}</th><th className="px-3 py-2">{L.view}</th></tr></thead>
            <tbody className="divide-y divide-slate-100">{customerDocs.map(d => <tr key={d.id} className="hover:bg-slate-50/80"><td className="px-3 py-2 font-medium">{d.title}</td><td className="px-3 py-2 text-slate-600">{d.date}</td><td className="px-3 py-2"><button onClick={() => printDocumentRecord(d, locale)} className="rounded-lg bg-slate-950 px-2 py-0.5 text-[10px] font-semibold text-white hover:bg-slate-800"><Printer className="inline h-3 w-3 mr-0.5" />{L.print}</button></td></tr>)}</tbody></table>
          )}
        </div>
      )}

      {/* â”€â”€ Audit Tab â”€â”€ */}
      {tab === "audit" && (
        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-natural">
          {data.auditLogs.length === 0 ? <div className="py-10 text-center text-sm text-slate-400">{L.noData}</div> : (
            <table className="data-table"><thead className="bg-slate-50/90 text-[10px] font-black uppercase tracking-[0.14em] text-slate-500"><tr><th className="px-3 py-2">{locale === "zh" ? "æ—¶é—´" : "Date"}</th><th className="px-3 py-2">{locale === "zh" ? "æ“ä½œ" : "Action"}</th><th className="px-3 py-2">{locale === "zh" ? "å¯¹è±¡" : "Objet"}</th></tr></thead>
            <tbody className="divide-y divide-slate-100">{data.auditLogs.slice(0, 50).map(l => { const al: Record<string, string> = locale === "zh" ? { create: "æ–°å»º", update: "ä¿®æ”¹", status_change: "ä¿®æ”¹æˆ¿æ€", check_in: "å…¥ä½", check_out: "é€€æˆ¿", activate: "æ¿€æ´»", terminate: "ç»ˆæ­¢", move_out: "é€€ç§Ÿ", payment: "æ”¶æ¬¾", cancel: "å–æ¶ˆ" } : { create: "Creer", update: "Modifier", status_change: "Statut", check_in: "Arrivee", check_out: "Depart", activate: "Activer", terminate: "Resilier", move_out: "Sortie", payment: "Paiement", cancel: "Annuler" }; return <tr key={l.id} className="hover:bg-slate-50/80"><td className="px-3 py-2 text-[10px] text-slate-500">{new Date(l.created_at).toLocaleDateString()}</td><td className="px-3 py-2">{al[l.action] ?? l.action}</td><td className="px-3 py-2 text-slate-500">{l.entity_type} {l.entity_id?.slice(0, 8)}</td></tr>; })}</tbody></table>
          )}
        </div>
      )}

      {/* Quick links */}
      <div className="flex flex-wrap gap-2 text-xs text-slate-500">
        <Link href={routeFor(locale, "/finance")} className="hover:text-brand-orange flex items-center gap-1">{L.finance}<ArrowRight className="h-3 w-3" /></Link>
        <Link href={routeFor(locale, "/todos")} className="hover:text-brand-orange flex items-center gap-1">{locale === "zh" ? "å¾…åŠž" : "Taches"}<ArrowRight className="h-3 w-3" /></Link>
        <Link href={routeFor(locale, "/data-quality")} className="hover:text-brand-orange flex items-center gap-1">{locale === "zh" ? "æ•°æ®è´¨é‡" : "Qualite"}<ArrowRight className="h-3 w-3" /></Link>
      </div>
    </div>
  );
}

function StatBox({ label, value, accent }: { label: string; value: string; accent: string }) {
  const c: Record<string, string> = { ink: "bg-slate-800", green: "bg-brand-green-500", red: "bg-brand-red-500" };
  return <div className="rounded-lg border border-slate-200 bg-white shadow-natural overflow-hidden"><div className={cn("h-[3px]", c[accent] ?? "bg-slate-800")} /><div className="px-3 py-2.5"><p className="text-[10px] text-slate-400">{label}</p><p className="text-sm font-bold tabular-nums text-slate-950">{value}</p></div></div>;
}
