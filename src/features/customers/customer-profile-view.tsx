"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import {
  Phone, AlertTriangle, BedDouble, Home, CreditCard,
  Receipt, Printer, ArrowRight, User,
} from "lucide-react";
import type { Locale } from "@/lib/i18n";
import { routeFor } from "@/lib/i18n";
import { formatXof, cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/empty-state";
import { MetricCard } from "@/components/metric-card";
import { printDocumentRecord } from "@/features/documents/templates/all-templates";
import type { DocumentRecord } from "@/features/documents/types";
import type { CustomerProfileData } from "./customer-profile-service";

const today = new Date().toISOString().slice(0, 10);
type Tab = "overview" | "daily" | "lease" | "sale" | "finance" | "docs" | "audit";
type BadgeTone = React.ComponentProps<typeof Badge>["variant"];

interface Props { data: CustomerProfileData; locale: Locale; userRole: string }

export function CustomerProfileView({ data, locale, userRole }: Props) {
  void userRole;
  const { customer } = data;
  const [tab, setTab] = useState<Tab>("overview");

  const L = labels(locale);

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

  const customerStatus: string = customer.is_blacklisted ? "blacklisted"
    : stats.totalOverdue > 0 ? "overdue"
    : stats.activeDaily > 0 || stats.activeLease > 0 || stats.activeSale > 0 ? "active"
    : "inactive";

  const documents = useMemo(() => {
    const docs: DocumentRecord[] = [];
    for (const b of data.dailyBookings) {
      const unit = data.units.find(u => u.id === b.unit_id);
      docs.push({ id: `doc_daily_${b.id}`, docType: "daily_booking", source: "daily", title: `${L.daily} ${unit?.unit_no ?? ""} ${b.check_in}`, date: b.check_in, unitNo: unit?.unit_no ?? "", customerName: customer.name, amountXof: Number(b.total_amount_xof), paidAmountXof: Number(b.prepaid_amount_xof), status: b.status, raw: b, customerPhone: customer.phone } as DocumentRecord);
      if (b.status === "checked_out") {
        docs.push({ id: `doc_checkout_${b.id}`, docType: "daily_checkout", source: "daily", title: `${L.checkoutDoc} ${unit?.unit_no ?? ""}`, date: b.actual_check_out ?? b.check_out ?? "", unitNo: unit?.unit_no ?? "", customerName: customer.name, amountXof: Number(b.final_amount_xof ?? b.total_amount_xof), paidAmountXof: Number(b.prepaid_amount_xof), status: b.status, raw: b, customerPhone: customer.phone } as DocumentRecord);
      }
    }
    for (const lc of data.leaseContracts) {
      const unit = data.units.find(u => u.id === lc.unit_id);
      docs.push({ id: `doc_lease_${lc.id}`, docType: "lease_contract", source: "lease", title: `${L.leaseContract} ${lc.contract_no}`, date: lc.start_date, unitNo: unit?.unit_no ?? "", customerName: customer.name, amountXof: Number(lc.monthly_rent_xof), paidAmountXof: 0, status: lc.status, raw: lc, contractNo: lc.contract_no, customerPhone: customer.phone } as DocumentRecord);
    }
    for (const sc of data.saleContracts) {
      const unit = data.units.find(u => u.id === sc.unit_id);
      docs.push({ id: `doc_sale_${sc.id}`, docType: "sale_contract", source: "sale", title: `${L.saleContract} ${sc.contract_no}`, date: sc.signed_date, unitNo: unit?.unit_no ?? "", customerName: customer.name, amountXof: Number(sc.total_amount_xof), paidAmountXof: 0, status: sc.status, raw: sc, contractNo: sc.contract_no, customerPhone: customer.phone } as DocumentRecord);
    }
    return docs;
  }, [L, data, customer]);

  const tabs: { key: Tab; label: string; count?: number }[] = [
    { key: "overview", label: L.overview },
    { key: "daily", label: L.daily, count: data.dailyBookings.length },
    { key: "lease", label: L.lease, count: data.leaseContracts.length },
    { key: "sale", label: L.sale, count: data.saleContracts.length },
    { key: "finance", label: L.finance, count: data.receivables.length + data.payments.length },
    { key: "docs", label: L.docs, count: documents.length },
    { key: "audit", label: L.audit, count: data.auditLogs.length },
  ];

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      {/* ── Header ── */}
      <Card>
        <CardContent className="flex flex-col gap-5 p-6 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-2xl font-bold">{customer.name}</h1>
              <CustomerStatusBadge status={customerStatus} labels={L} />
              {customer.is_blacklisted && <AlertTriangle className="h-5 w-5 text-red-500" />}
            </div>
            <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-sm text-muted-foreground">
              {customer.phone && <span className="inline-flex items-center gap-1.5"><Phone className="h-4 w-4" />{customer.phone}</span>}
              {customer.gender && <span><span className="text-muted-foreground">{L.gender}:</span> {customer.gender === "male" ? L.male : customer.gender === "female" ? L.female : L.other}</span>}
              {customer.document_type && <span><span className="text-muted-foreground">{L.docType}:</span> {customer.document_type === "id_card" ? L.idCard : customer.document_type === "passport" ? L.passport : customer.document_type === "drivers_license" ? L.driversLicense : customer.document_type}</span>}
              {customer.notes && <span className="text-muted-foreground">{customer.notes}</span>}
            </div>
            <div className="mt-4 flex gap-3 text-sm">
              <span><span className="text-muted-foreground">{L.currentBusiness}:</span> <strong>{businessSummary(stats, L)}</strong></span>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button asChild size="sm"><Link href={routeFor(locale, "/daily-rentals")}><BedDouble className="h-4 w-4" />{L.newBooking}</Link></Button>
            <Button asChild size="sm" variant="secondary"><Link href={routeFor(locale, "/leases")}><Home className="h-4 w-4" />{L.newLease}</Link></Button>
            <Button asChild size="sm" variant="outline"><Link href={routeFor(locale, "/sales")}><CreditCard className="h-4 w-4" />{L.newSale}</Link></Button>
          </div>
        </CardContent>
      </Card>

      {/* Blacklist info */}
      {customer.is_blacklisted && (
        <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm">
          <AlertTriangle className="h-4 w-4 shrink-0 text-red-500 mt-0.5" />
          <div>
            <p className="font-semibold text-red-700">{L.blacklisted}: {customer.blacklist_reason}</p>
            {customer.blacklist_date && <p className="text-red-500 text-xs mt-0.5">{customer.blacklist_date} · {customer.blacklist_permanent ? L.permanent : L.temporary}</p>}
          </div>
        </div>
      )}

      {/* ── Tabs ── */}
      <nav className="flex gap-1 overflow-x-auto rounded-xl border bg-card p-1.5 shadow-sm" aria-label={L.tabs}>
        {tabs.map((item) => (
          <button key={item.key} type="button" onClick={() => setTab(item.key)}
            className={cn("shrink-0 rounded-md px-4 py-2 text-sm font-semibold transition", tab === item.key ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-accent hover:text-accent-foreground")}>
            {item.label}{item.count !== undefined && <span className="ml-1 opacity-75">({item.count})</span>}
          </button>
        ))}
      </nav>

      {/* ── Tab Content ── */}
      {tab === "overview" && <OverviewTab stats={stats} customer={customer} L={L} data={data} />}
      {tab === "daily" && <DailyTab data={data} L={L} locale={locale} />}
      {tab === "lease" && <LeaseTab data={data} L={L} locale={locale} />}
      {tab === "sale" && <SaleTab data={data} L={L} locale={locale} />}
      {tab === "finance" && <FinanceTab data={data} L={L} />}
      {tab === "docs" && <TableTab columns={[L.docs, L.date, L.role, L.action]} rows={documents.map(doc => ({ cells: [doc.title, doc.date, doc.unitNo, <Button key="p" size="sm" variant="ghost" onClick={() => printDocumentRecord(doc, locale)}><Printer className="h-3.5 w-3.5" />{L.print}</Button>] }))} empty={documents.length === 0} emptyText={L.noData} />}
      {tab === "audit" && <TableTab columns={[L.date, L.action, L.entity]} rows={data.auditLogs.slice(0, 50).map(log => ({ cells: [new Date(log.created_at).toLocaleDateString(locale === "fr" ? "fr-FR" : "zh-CN"), L.auditActions[log.action] ?? log.action, `${log.entity_type} ${log.entity_id?.slice(0, 8)}`] }))} empty={data.auditLogs.length === 0} emptyText={L.noData} />}

      {/* Quick links */}
      <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
        <Link href={routeFor(locale, "/finance")} className="hover:text-primary flex items-center gap-1">{L.finance} <ArrowRight className="h-3 w-3" /></Link>
        <Link href={routeFor(locale, "/customers")} className="hover:text-primary flex items-center gap-1">{L.backToList} <ArrowRight className="h-3 w-3" /></Link>
      </div>
    </div>
  );
}

// ── Overview Tab ──
function OverviewTab({ stats, customer, L, data }: { stats: { totalRec: number; totalPaid: number; totalOverdue: number; unpaid: number; latestPayment: { payment_date: string; amount: number } | null; latestBooking: { check_in: string; status: string } | null; activeDaily: number; activeLease: number; activeSale: number }; customer: CustomerProfileData["customer"]; L: ReturnType<typeof labels>; data: CustomerProfileData }) {
  const dailyStatusLabels: Record<string, string> = {
    pending_review: L.dailyPending, confirmed: L.dailyConfirmed, checked_in: L.dailyCheckedIn, checked_out: L.dailyCheckedOut, cancelled: L.dailyCancelled,
  };
  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard title={L.totalRec} value={formatXof(stats.totalRec)} tone="indigo" />
        <MetricCard title={L.totalPaid} value={formatXof(stats.totalPaid)} tone="green" />
        <MetricCard title={L.unpaid} value={formatXof(stats.unpaid)} tone={stats.unpaid > 0 ? "amber" : "green"} />
        <MetricCard title={L.overdueAmt} value={formatXof(stats.totalOverdue)} tone={stats.totalOverdue > 0 ? "red" : "green"} />
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <InfoCard label={L.lastPayment} value={stats.latestPayment ? `${stats.latestPayment.payment_date} · ${formatXof(Number(stats.latestPayment.amount))}` : L.noData} />
        <InfoCard label={L.lastBooking} value={stats.latestBooking ? `${stats.latestBooking.check_in} · ${dailyStatusLabels[stats.latestBooking.status] ?? stats.latestBooking.status}` : L.noData} />
        <InfoCard label={L.currentBusiness} value={businessSummary(stats, L)} />
      </div>

      {/* Related units */}
      {data.units.length > 0 && (
        <Card>
          <CardHeader><CardTitle>{L.relatedUnits}</CardTitle></CardHeader>
          <CardContent className="flex flex-wrap gap-1.5">
            {data.units.map(u => (
              <span key={u.id} className="rounded bg-muted px-2 py-0.5 text-xs font-mono">{u.unit_no} ({L.kindLabels[u.kind] ?? u.kind})</span>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle>{L.customerInfo}</CardTitle></CardHeader>
        <CardContent className="grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2">
          <span><span className="text-muted-foreground">{L.name}:</span> {customer.name}</span>
          {customer.gender && <span><span className="text-muted-foreground">{L.gender}:</span> {customer.gender === "male" ? L.male : customer.gender === "female" ? L.female : L.other}</span>}
          {customer.phone && <span><span className="text-muted-foreground">{L.phone}:</span> {customer.phone}</span>}
          {customer.document_type && <span><span className="text-muted-foreground">{L.docType}:</span> {customer.document_type === "id_card" ? L.idCard : customer.document_type === "passport" ? L.passport : customer.document_type === "drivers_license" ? L.driversLicense : customer.document_type}</span>}
          {customer.notes && <span className="sm:col-span-2"><span className="text-muted-foreground">{L.notes}:</span> {customer.notes}</span>}
        </CardContent>
      </Card>
    </div>
  );
}

// ── Finance Tab ──
function FinanceTab({ data, L }: { data: CustomerProfileData; L: ReturnType<typeof labels> }) {
  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-3">
        {(["daily_booking", "lease_contract", "sale_contract"] as const).map((source) => {
          const rows = data.receivables.filter((r) => r.source_type === source && r.status !== "cancelled");
          const total = rows.reduce((sum, r) => sum + Number(r.amount_xof), 0);
          const paid = rows.reduce((sum, r) => sum + Number(r.paid_amount_xof), 0);
          return <InfoCard key={source} label={L.sourceLabels[source]} value={`${formatXof(paid)} / ${formatXof(total)}`} />;
        })}
      </div>
      <TableSection title={`${L.receivables} (${data.receivables.filter(r => r.status !== "cancelled").length})`} empty={data.receivables.length === 0} emptyText={L.noData}>
        <table className="w-full text-left text-[13px]">
          <thead className="border-b bg-muted text-xs font-semibold uppercase tracking-[0.04em] text-muted-foreground">
            <tr>{[L.date, L.source, L.amount, L.paid, L.status].map(h => <th key={h} className="px-4 py-2.5">{h}</th>)}</tr>
          </thead>
          <tbody className="divide-y">
            {data.receivables.filter(r => r.status !== "cancelled").slice(0, 50).map(r => {
              const outstanding = Number(r.amount_xof) - Number(r.paid_amount_xof);
              return <tr key={r.id} className={cn("transition-colors hover:bg-accent/50", r.status === "overdue" && "bg-red-50/30")}>
                <td className="px-4 py-2.5">{r.due_date}</td>
                <td className="px-4 py-2.5 text-muted-foreground">{L.sourceLabels[r.source_type] ?? r.source_type}</td>
                <td className="px-4 py-2.5 text-right tabular-nums font-medium">{formatXof(Number(r.amount_xof))}</td>
                <td className="px-4 py-2.5 text-right tabular-nums text-emerald-600 font-medium">{formatXof(Number(r.paid_amount_xof))}</td>
                <td className="px-4 py-2.5"><Badge variant={outstanding > 0 ? (r.status === "overdue" ? "destructive" : "warning") : "success"}>{outstanding > 0 ? formatXof(outstanding) : L.settled}</Badge></td>
              </tr>;
            })}
          </tbody>
        </table>
      </TableSection>
      <TableSection title={`${L.payments} (${data.payments.length})`} empty={data.payments.length === 0} emptyText={L.noData}>
        <table className="w-full text-left text-[13px]">
          <thead className="border-b bg-muted text-xs font-semibold uppercase tracking-[0.04em] text-muted-foreground">
            <tr>{[L.date, L.amount, L.receipt].map(h => <th key={h} className="px-4 py-2.5">{h}</th>)}</tr>
          </thead>
          <tbody className="divide-y">
            {data.payments.slice(0, 50).map(p => <tr key={p.id} className="transition-colors hover:bg-accent/50"><td className="px-4 py-2.5">{p.payment_date}</td><td className="px-4 py-2.5 text-right tabular-nums text-emerald-600 font-medium">{formatXof(Number(p.amount))}</td><td className="px-4 py-2.5 text-muted-foreground">{p.receipt_no ?? "-"}</td></tr>)}
          </tbody>
        </table>
      </TableSection>
    </div>
  );
}

// ── Shared Components ──

function DailyTab({ data, L, locale }: { data: CustomerProfileData; L: ReturnType<typeof labels>; locale: Locale }) {
  const rows = data.dailyBookings.map(b => {
    const unit = data.units.find(u => u.id === b.unit_id);
    return {
      cells: [
        unit?.unit_no ?? "?",
        b.check_in + " → " + (b.check_out ?? L.openEnded),
        <Badge key="s" variant={dailyStatusTone(b.status)}>{L.dailyStatusLabels[b.status] ?? b.status}</Badge>,
        <span key="a" className="tabular-nums font-medium">{formatXof(Number(b.total_amount_xof))}</span>,
        <TextLink key="v" href={routeFor(locale, "/daily-rentals")}>{L.view}</TextLink>,
      ],
    };
  });
  return <TableTab columns={[L.role, L.date, L.status, L.amount, L.view]} rows={rows} empty={data.dailyBookings.length === 0} emptyText={L.noData} />;
}

function LeaseTab({ data, L, locale }: { data: CustomerProfileData; L: ReturnType<typeof labels>; locale: Locale }) {
  const rows = data.leaseContracts.map(lc => {
    const unit = data.units.find(u => u.id === lc.unit_id);
    return {
      cells: [
        unit?.unit_no ?? "?", lc.contract_no,
        lc.start_date + " → " + lc.expected_end_date,
        <span key="a" className="tabular-nums font-medium">{formatXof(Number(lc.monthly_rent_xof))}</span>,
        <Badge key="s" variant={contractTone(lc.status)}>{L.contractStatusLabels[lc.status] ?? lc.status}</Badge>,
        <TextLink key="v" href={routeFor(locale, "/leases")}>{L.view}</TextLink>,
      ],
    };
  });
  return <TableTab columns={[L.role, L.contractNo, L.date, L.amount, L.status, L.view]} rows={rows} empty={data.leaseContracts.length === 0} emptyText={L.noData} />;
}

function SaleTab({ data, L, locale }: { data: CustomerProfileData; L: ReturnType<typeof labels>; locale: Locale }) {
  const rows = data.saleContracts.map(sc => {
    const unit = data.units.find(u => u.id === sc.unit_id);
    return {
      cells: [
        unit?.unit_no ?? "?", sc.contract_no,
        <span key="a" className="tabular-nums font-medium">{formatXof(Number(sc.total_amount_xof))}</span>,
        <Badge key="s" variant={contractTone(sc.status)}>{L.contractStatusLabels[sc.status] ?? sc.status}</Badge>,
        <TextLink key="v" href={routeFor(locale, "/sales")}>{L.view}</TextLink>,
      ],
    };
  });
  return <TableTab columns={[L.role, L.contractNo, L.amount, L.status, L.view]} rows={rows} empty={data.saleContracts.length === 0} emptyText={L.noData} />;
}

function TableTab({ columns, rows, empty, emptyText }: { columns: string[]; rows: { cells: React.ReactNode[] }[]; empty: boolean; emptyText: string }) {
  if (empty) return <EmptyState title={emptyText} />;
  return (
    <Card><div className="overflow-x-auto">
      <table className="w-full text-left text-[13px]">
        <thead className="border-b bg-muted text-xs font-semibold uppercase tracking-[0.04em] text-muted-foreground"><tr>{columns.map(h => <th key={h} className="px-4 py-2.5">{h}</th>)}</tr></thead>
        <tbody className="divide-y">{rows.map((row, i) => <tr key={i} className="transition-colors hover:bg-accent/50">{row.cells.map((c, j) => <td key={j} className="px-4 py-2.5">{c}</td>)}</tr>)}</tbody>
      </table>
    </div></Card>
  );
}

function TableSection({ title, empty, emptyText, children }: { title?: string; empty: boolean; emptyText: string; children: React.ReactNode }) {
  return (
    <Card>{title && <div className="border-b bg-muted px-4 py-2.5 text-xs font-semibold text-muted-foreground">{title}</div>}{empty ? <div className="py-12 text-center text-sm text-muted-foreground">{emptyText}</div> : <div className="overflow-x-auto">{children}</div>}</Card>
  );
}

function InfoCard({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl border bg-card p-4 shadow-sm"><p className="text-xs font-semibold text-muted-foreground">{label}</p><p className="mt-1.5 text-sm font-bold">{value}</p></div>;
}

function TextLink({ href, children }: { href: string; children: React.ReactNode }) {
  return <Link href={href} className="text-xs font-semibold text-primary hover:underline">{children}</Link>;
}

function CustomerStatusBadge({ status, labels: labelSet }: { status: string; labels: ReturnType<typeof labels> }) {
  const variant: Record<string, BadgeTone> = { active: "success", inactive: "secondary", overdue: "destructive", blacklisted: "destructive" };
  const text: Record<string, string> = {
    active: labelSet.active,
    inactive: labelSet.inactive,
    overdue: labelSet.overdue,
    blacklisted: labelSet.blacklisted,
  };
  return <Badge variant={variant[status] ?? "secondary"}>{text[status] ?? status}</Badge>;
}

function businessSummary(stats: { activeDaily: number; activeLease: number; activeSale: number }, L: ReturnType<typeof labels>) {
  const parts: string[] = [];
  if (stats.activeDaily > 0) parts.push(`${L.daily}:${stats.activeDaily}`);
  if (stats.activeLease > 0) parts.push(`${L.lease}:${stats.activeLease}`);
  if (stats.activeSale > 0) parts.push(`${L.sale}:${stats.activeSale}`);
  return parts.length > 0 ? parts.join(" ") : L.noData;
}

function dailyStatusTone(status: string): BadgeTone {
  const tones: Record<string, BadgeTone> = { pending_review: "warning", confirmed: "default", checked_in: "success", checked_out: "secondary", cancelled: "destructive" };
  return tones[status] ?? "secondary";
}

function contractTone(status: string): BadgeTone {
  const tones: Record<string, BadgeTone> = { active: "success", draft: "secondary", terminated: "destructive", expired: "warning" };
  return tones[status] ?? "secondary";
}

function labels(locale: Locale) {
  if (locale === "fr") {
    return {
      overview: "Aperçu", daily: "Jour", lease: "Location", sale: "Vente", finance: "Finance", docs: "Docs", audit: "Audit",
      tabs: "Onglets", name: "Nom", gender: "Genre", phone: "Tél", docType: "Pièce", notes: "Notes",
      newBooking: "Réserver", newLease: "Nouveau bail", newSale: "Nouvelle vente",
      totalRec: "Total dû", totalPaid: "Total payé", unpaid: "Impayé", overdueAmt: "Retard",
      lastPayment: "Dernier paiement", lastBooking: "Dernière activité", currentBusiness: "Activité actuelle",
      noData: "Aucune donnée", view: "Voir", print: "Imprimer", date: "Date", amount: "Montant", paid: "Payé",
      status: "Statut", role: "Chambre", contractNo: "Contrat",
      source: "Source", receivables: "Créances", payments: "Paiements", receipt: "Reçu",
      action: "Action", entity: "Objet", customerInfo: "Informations client", relatedUnits: "Logements liés",
      openEnded: "non fixé", settled: "Soldé", leaseContract: "Contrat bail", saleContract: "Contrat vente",
      checkoutDoc: "Clôture", backToList: "Liste clients",
      active: "Actif", inactive: "Inactif", overdue: "Impayé", blacklisted: "Liste noire",
      male: "Homme", female: "Femme", other: "Autre",
      idCard: "Carte d'identité", passport: "Passeport", driversLicense: "Permis",
      permanent: "Permanent", temporary: "Temporaire",
      dailyPending: "À valider", dailyConfirmed: "Confirmé", dailyCheckedIn: "Arrivé", dailyCheckedOut: "Parti", dailyCancelled: "Annulé",
      dailyStatusLabels: { pending_review: "À valider", confirmed: "Confirmé", checked_in: "Arrivé", checked_out: "Parti", cancelled: "Annulé" } as Record<string, string>,
      contractStatusLabels: { active: "Actif", draft: "Brouillon", terminated: "Résilié", expired: "Expiré" } as Record<string, string>,
      kindLabels: { apartment: "Appart", parking: "Parking", storefront: "Commerce", office: "Bureau" } as Record<string, string>,
      sourceLabels: { daily_booking: "Jour", lease_contract: "Location", sale_contract: "Vente", manual: "Manuel" } as Record<string, string>,
      auditActions: { create: "Créer", update: "Modifier", delete: "Suppr", activate: "Activer", terminate: "Résilier", check_in: "Arrivée", check_out: "Départ", payment: "Paiement", move_out: "Sortie", cancel: "Annuler", blacklist_add: "Bloquer", blacklist_remove: "Débloquer" } as Record<string, string>,
    };
  }
  return {
    overview: "\u603b\u89c8", daily: "\u65e5\u79df", lease: "\u957f\u79df", sale: "\u51fa\u552e", finance: "\u8d22\u52a1", docs: "\u5355\u636e", audit: "\u5ba1\u8ba1",
    tabs: "\u5ba2\u6237\u6863\u6848\u6807\u7b7e", name: "\u59d3\u540d", gender: "\u6027\u522b", phone: "\u7535\u8bdd", docType: "\u8bc1\u4ef6", notes: "\u5907\u6ce8",
    newBooking: "\u65b0\u5efa\u65e5\u79df", newLease: "\u65b0\u589e\u957f\u79df", newSale: "\u65b0\u589e\u51fa\u552e",
    totalRec: "\u7d2f\u8ba1\u5e94\u6536", totalPaid: "\u7d2f\u8ba1\u5b9e\u6536", unpaid: "\u5f53\u524d\u6b20\u8d39", overdueAmt: "\u903e\u671f\u91d1\u989d",
    lastPayment: "\u6700\u8fd1\u6536\u6b3e", lastBooking: "\u6700\u8fd1\u4e1a\u52a1", currentBusiness: "\u5f53\u524d\u4e1a\u52a1",
    noData: "\u6682\u65e0\u6570\u636e", view: "\u67e5\u770b", print: "\u6253\u5370", date: "\u65e5\u671f", amount: "\u91d1\u989d", paid: "\u5df2\u6536",
    status: "\u72b6\u6001", role: "\u623f\u53f7", contractNo: "\u5408\u540c\u53f7",
    source: "\u6765\u6e90", receivables: "\u5e94\u6536", payments: "\u6536\u6b3e", receipt: "\u6536\u636e",
    action: "\u64cd\u4f5c", entity: "\u5bf9\u8c61", customerInfo: "\u5ba2\u6237\u4fe1\u606f", relatedUnits: "\u5173\u8054\u623f\u6e90",
    openEnded: "\u672a\u5b9a", settled: "\u7ed3\u6e05", leaseContract: "\u957f\u79df\u5408\u540c", saleContract: "\u51fa\u552e\u5408\u540c",
    checkoutDoc: "\u9000\u623f\u7ed3\u7b97", backToList: "\u8fd4\u56de\u5ba2\u6237\u5217\u8868",
    active: "\u6d3b\u8dc3", inactive: "\u5386\u53f2", overdue: "\u6b20\u8d39", blacklisted: "\u9ed1\u540d\u5355",
    male: "\u7537", female: "\u5973", other: "\u5176\u4ed6",
    idCard: "\u8eab\u4efd\u8bc1", passport: "\u62a4\u7167", driversLicense: "\u9a7e\u7167",
    permanent: "\u6c38\u4e45", temporary: "\u4e34\u65f6",
    dailyPending: "\u5f85\u5ba1\u6838", dailyConfirmed: "\u5df2\u786e\u8ba4", dailyCheckedIn: "\u5df2\u5165\u4f4f", dailyCheckedOut: "\u5df2\u9000\u623f", dailyCancelled: "\u5df2\u53d6\u6d88",
    dailyStatusLabels: { pending_review: "\u5f85\u5ba1\u6838", confirmed: "\u5df2\u786e\u8ba4", checked_in: "\u5df2\u5165\u4f4f", checked_out: "\u5df2\u9000\u623f", cancelled: "\u5df2\u53d6\u6d88" } as Record<string, string>,
    contractStatusLabels: { active: "\u751f\u6548\u4e2d", draft: "\u8349\u7a3f", terminated: "\u5df2\u7ec8\u6b62", expired: "\u5df2\u8fc7\u671f" } as Record<string, string>,
    kindLabels: { apartment: "\u516c\u5bd3", parking: "\u8f66\u4f4d", storefront: "\u95e8\u9762", office: "\u529e\u516c" } as Record<string, string>,
    sourceLabels: { daily_booking: "\u65e5\u79df", lease_contract: "\u957f\u79df", sale_contract: "\u51fa\u552e", manual: "\u624b\u5de5" } as Record<string, string>,
    auditActions: { create: "\u65b0\u5efa", update: "\u4fee\u6539", delete: "\u5220\u9664", activate: "\u6fc0\u6d3b", terminate: "\u7ec8\u6b62", check_in: "\u5165\u4f4f", check_out: "\u9000\u623f", payment: "\u6536\u6b3e", move_out: "\u9000\u79df", cancel: "\u53d6\u6d88", blacklist_add: "\u62c9\u9ed1", blacklist_remove: "\u89e3\u9664\u62c9\u9ed1" } as Record<string, string>,
  };
}
