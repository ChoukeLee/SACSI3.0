"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { BedDouble, Building2, Calendar, CreditCard, Home, Printer, User } from "lucide-react";
import type { Locale } from "@/lib/i18n";
import { routeFor } from "@/lib/i18n";
import { cn, formatXof } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/empty-state";
import { StatusBadge } from "@/components/status-badge";
import { MetricCard } from "@/components/metric-card";
import { printDocumentRecord } from "@/features/documents/templates/all-templates";
import type { DocumentRecord } from "@/features/documents/types";
import type { ContractStatus, UnitKind, UnitStatus } from "@/types/domain";
import type { UnitProfileData } from "./unit-profile-service";

const today = new Date().toISOString().slice(0, 10);
type Tab = "overview" | "daily" | "lease" | "sale" | "finance" | "docs" | "audit";
type BadgeTone = React.ComponentProps<typeof Badge>["variant"];

interface Props { data: UnitProfileData; locale: Locale; userRole: string }

export function UnitProfileView({ data, locale, userRole }: Props) {
  void userRole;
  const { unit, buildingName } = data;
  const [tab, setTab] = useState<Tab>("overview");
  const L = labels(locale);

  const custName = (id?: string | null) => data.customers.find((c) => c.id === id)?.name ?? "-";

  const stats = useMemo(() => {
    let totalRec = 0, totalPaid = 0, totalOverdue = 0;
    for (const r of data.receivables) {
      if (r.status === "cancelled") continue;
      const amount = Number(r.amount_xof), paid = Number(r.paid_amount_xof), outstanding = amount - paid;
      totalRec += amount; totalPaid += paid;
      if (outstanding > 0 && (r.status === "overdue" || r.due_date < today)) totalOverdue += outstanding;
    }
    const latestPayment = data.payments[0] ?? null;
    const currentBooking = data.dailyBookings.find((b) => ["checked_in","confirmed","pending_review"].includes(b.status)) ?? null;
    const currentLease = data.leaseContracts.find((l) => l.status === "active") ?? null;
    const currentSale = data.saleContracts.find((s) => s.status === "active") ?? null;
    return { totalRec, totalPaid, totalOverdue, unpaid: totalRec - totalPaid, latestPayment, currentBooking, currentLease, currentSale };
  }, [data]);

  const currentCustomer = stats.currentBooking ? custName(stats.currentBooking.customer_id)
    : stats.currentLease ? custName(stats.currentLease.customer_id)
    : stats.currentSale ? custName(stats.currentSale.customer_id) : null;

  const documents = useMemo(() => {
    const docs: DocumentRecord[] = [];
    for (const b of data.dailyBookings) docs.push({ id: `doc_db_${b.id}`, docType: "daily_booking", source: "daily", title: `${L.daily} ${unit.unit_no} ${b.check_in}`, date: b.check_in, unitNo: unit.unit_no, customerName: custName(b.customer_id), amountXof: Number(b.total_amount_xof), paidAmountXof: Number(b.prepaid_amount_xof), status: b.status, raw: b, customerPhone: undefined } as DocumentRecord);
    for (const lc of data.leaseContracts) docs.push({ id: `doc_lc_${lc.id}`, docType: "lease_contract", source: "lease", title: `${L.leaseContract} ${lc.contract_no}`, date: lc.start_date, unitNo: unit.unit_no, customerName: custName(lc.customer_id), amountXof: Number(lc.monthly_rent_xof), paidAmountXof: 0, status: lc.status, raw: lc, contractNo: lc.contract_no, customerPhone: undefined } as DocumentRecord);
    for (const sc of data.saleContracts) docs.push({ id: `doc_sc_${sc.id}`, docType: "sale_contract", source: "sale", title: `${L.saleContract} ${sc.contract_no}`, date: sc.signed_date, unitNo: unit.unit_no, customerName: custName(sc.customer_id), amountXof: Number(sc.total_amount_xof), paidAmountXof: 0, status: sc.status, raw: sc, contractNo: sc.contract_no, customerPhone: undefined } as DocumentRecord);
    return docs;
  }, [L, data, unit.unit_no]);

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
              <h1 className="font-mono text-2xl font-bold">{unit.unit_no}</h1>
              <StatusBadge status={unit.status} label={L.statusLabels[unit.status] ?? unit.status} />
            </div>
            <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-sm text-muted-foreground">
              <span className="inline-flex items-center gap-1.5"><Building2 className="h-4 w-4" />{buildingName}</span>
              <span>{L.floor}: {unit.floor_label}</span>
              <span>{L.kind}: {L.kindLabels[unit.kind] ?? unit.kind}</span>
              {unit.layout && <span>{L.layout}: {unit.layout}</span>}
              {unit.area_sqm && <span>{L.area}: {unit.area_sqm} m²</span>}
            </div>
            <div className="mt-4 flex gap-3 text-sm">
              <span><span className="text-muted-foreground">{L.currentCustomer}:</span> <strong>{currentCustomer ?? L.noData}</strong></span>
              <span><span className="text-muted-foreground">{L.currentOccupation}:</span> <strong>{occupationText(stats, L)}</strong></span>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button asChild size="sm"><Link href={routeFor(locale, "/daily-rentals")}><BedDouble className="h-4 w-4" />{L.newBooking}</Link></Button>
            <Button asChild size="sm" variant="secondary"><Link href={routeFor(locale, "/leases")}><Home className="h-4 w-4" />{L.newLease}</Link></Button>
            <Button asChild size="sm" variant="outline"><Link href={routeFor(locale, "/sales")}><CreditCard className="h-4 w-4" />{L.newSale}</Link></Button>
          </div>
        </CardContent>
      </Card>

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
      {tab === "overview" && <OverviewTab stats={stats} currentCustomer={currentCustomer} unit={unit} buildingName={buildingName} L={L} />}
      {tab === "daily" && <DailyTab data={data} L={L} locale={locale} custName={custName} />}
      {tab === "lease" && <LeaseTab data={data} L={L} locale={locale} custName={custName} />}
      {tab === "sale" && <SaleTab data={data} L={L} locale={locale} custName={custName} />}

      {tab === "finance" && <FinanceTab data={data} L={L} />}
      {tab === "docs" && <TableTab columns={[L.docs, L.date, L.action]} rows={documents.map(doc => ({ cells: [doc.title, doc.date, <Button key="p" size="sm" variant="ghost" onClick={() => printDocumentRecord(doc, locale)}><Printer className="h-3.5 w-3.5" />{L.print}</Button>] }))} empty={documents.length === 0} emptyText={L.noData} />}
      {tab === "audit" && <TableTab columns={[L.date, L.action, L.entity]} rows={data.auditLogs.slice(0, 50).map(log => ({ cells: [new Date(log.created_at).toLocaleDateString(locale==="fr"?"fr-FR":"zh-CN"), L.auditActions[log.action]??log.action, `${log.entity_type} ${log.entity_id?.slice(0,8)}`] }))} empty={data.auditLogs.length === 0} emptyText={L.noData} />}
    </div>
  );
}

// ── Overview Tab ──
function OverviewTab({ stats, currentCustomer, unit, buildingName, L }: { stats: { totalRec: number; totalPaid: number; totalOverdue: number; unpaid: number; latestPayment: { payment_date: string; amount: number } | null; currentBooking: { check_in: string } | null; currentLease: { contract_no: string } | null; currentSale: { contract_no: string } | null }; currentCustomer: string | null; unit: UnitProfileData["unit"]; buildingName: string; L: ReturnType<typeof labels> }) {
  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard title={L.totalRec} value={formatXof(stats.totalRec)} tone="indigo" />
        <MetricCard title={L.totalPaid} value={formatXof(stats.totalPaid)} tone="green" />
        <MetricCard title={L.unpaid} value={formatXof(stats.unpaid)} tone={stats.unpaid > 0 ? "amber" : "green"} />
        <MetricCard title={L.overdueAmt} value={formatXof(stats.totalOverdue)} tone={stats.totalOverdue > 0 ? "red" : "green"} />
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        <InfoCard label={L.lastPayment} value={stats.latestPayment ? `${stats.latestPayment.payment_date} · ${formatXof(Number(stats.latestPayment.amount))}` : L.noData} />
        <InfoCard label={L.currentCustomer} value={currentCustomer ?? L.noData} />
        <InfoCard label={L.currentOccupation} value={occupationText(stats, L)} />
      </div>

      <Card>
        <CardHeader><CardTitle>{L.unitInfo}</CardTitle></CardHeader>
        <CardContent className="grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
          <span><span className="text-muted-foreground">{L.floor}:</span> {unit.floor_label}</span>
          <span><span className="text-muted-foreground">{L.kind}:</span> {L.kindLabels[unit.kind] ?? unit.kind}</span>
          {unit.area_sqm && <span><span className="text-muted-foreground">{L.area}:</span> {unit.area_sqm} m²</span>}
          {unit.layout && <span><span className="text-muted-foreground">{L.layout}:</span> {unit.layout}</span>}
          {unit.furnishing && <span><span className="text-muted-foreground">{L.furnishing}:</span> {L.furnishingLabels[unit.furnishing] ?? unit.furnishing}</span>}
          {unit.notes && <span className="sm:col-span-2"><span className="text-muted-foreground">{L.notes}:</span> {unit.notes}</span>}
        </CardContent>
      </Card>
    </div>
  );
}

// ── Finance Tab ──
function FinanceTab({ data, L }: { data: UnitProfileData; L: ReturnType<typeof labels> }) {
  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-3">
        {(["daily_booking","lease_contract","sale_contract"] as const).map((source) => {
          const rows = data.receivables.filter((r) => r.source_type === source && r.status !== "cancelled");
          const total = rows.reduce((sum, r) => sum + Number(r.amount_xof), 0);
          const paid = rows.reduce((sum, r) => sum + Number(r.paid_amount_xof), 0);
          return <InfoCard key={source} label={L.sourceLabels[source]} value={`${formatXof(paid)} / ${formatXof(total)}`} />;
        })}
      </div>
      <TableSection title={`${L.receivables} (${data.receivables.filter(r=>r.status!=="cancelled").length})`} empty={data.receivables.length===0} emptyText={L.noData}>
        <table className="w-full text-left text-[13px]">
          <thead className="border-b bg-muted text-xs font-semibold uppercase tracking-[0.04em] text-muted-foreground">
            <tr>{[L.date, L.source, L.amount, L.paid, L.status].map(h=><th key={h} className="px-4 py-2.5">{h}</th>)}</tr>
          </thead>
          <tbody className="divide-y">
            {data.receivables.filter(r=>r.status!=="cancelled").slice(0,50).map(r=>{
              const outstanding = Number(r.amount_xof) - Number(r.paid_amount_xof);
              return <tr key={r.id} className={cn("transition-colors hover:bg-accent/50", r.status==="overdue" && "bg-red-50/30")}>
                <td className="px-4 py-2.5">{r.due_date}</td><td className="px-4 py-2.5 text-muted-foreground">{L.sourceLabels[r.source_type]??r.source_type}</td>
                <td className="px-4 py-2.5 text-right tabular-nums font-medium">{formatXof(Number(r.amount_xof))}</td>
                <td className="px-4 py-2.5 text-right tabular-nums text-emerald-600 font-medium">{formatXof(Number(r.paid_amount_xof))}</td>
                <td className="px-4 py-2.5"><Badge variant={outstanding>0?(r.status==="overdue"?"destructive":"warning"):"success"}>{outstanding>0?formatXof(outstanding):L.settled}</Badge></td>
              </tr>;
            })}
          </tbody>
        </table>
      </TableSection>
      <TableSection title={`${L.payments} (${data.payments.length})`} empty={data.payments.length===0} emptyText={L.noData}>
        <table className="w-full text-left text-[13px]">
          <thead className="border-b bg-muted text-xs font-semibold uppercase tracking-[0.04em] text-muted-foreground">
            <tr>{[L.date,L.amount,L.receipt].map(h=><th key={h} className="px-4 py-2.5">{h}</th>)}</tr>
          </thead>
          <tbody className="divide-y">
            {data.payments.slice(0,50).map(p=><tr key={p.id} className="transition-colors hover:bg-accent/50"><td className="px-4 py-2.5">{p.payment_date}</td><td className="px-4 py-2.5 text-right tabular-nums text-emerald-600 font-medium">{formatXof(Number(p.amount))}</td><td className="px-4 py-2.5 text-muted-foreground">{p.receipt_no??"-"}</td></tr>)}
          </tbody>
        </table>
      </TableSection>
    </div>
  );
}

// ── Shared Components ──

function DailyTab({ data, L, locale, custName }: { data: UnitProfileData; L: ReturnType<typeof labels>; locale: Locale; custName: (id?: string | null) => string }) {
  const rows = data.dailyBookings.map(b => ({ cells: [
    custName(b.customer_id),
    b.check_in + " → " + (b.check_out ?? L.openEnded),
    <Badge key="s" variant={dailyStatusTone(b.status)}>{L.dailyStatusLabels[b.status] ?? b.status}</Badge>,
    <span key="a" className="tabular-nums font-medium">{formatXof(Number(b.total_amount_xof))}</span>,
    <TextLink key="v" href={routeFor(locale, "/daily-rentals")}>{L.view}</TextLink>,
  ]}));
  return <TableTab columns={[L.customer, L.date, L.status, L.amount, L.view]} rows={rows} empty={data.dailyBookings.length === 0} emptyText={L.noData} />;
}

function LeaseTab({ data, L, locale, custName }: { data: UnitProfileData; L: ReturnType<typeof labels>; locale: Locale; custName: (id?: string | null) => string }) {
  const rows = data.leaseContracts.map(lc => ({ cells: [
    custName(lc.customer_id), lc.contract_no,
    lc.start_date + " → " + lc.expected_end_date,
    <span key="a" className="tabular-nums font-medium">{formatXof(Number(lc.monthly_rent_xof))}</span>,
    <Badge key="s" variant={contractTone(lc.status)}>{L.contractStatusLabels[lc.status] ?? lc.status}</Badge>,
    <TextLink key="v" href={routeFor(locale, "/leases")}>{L.view}</TextLink>,
  ]}));
  return <TableTab columns={[L.customer, L.contractNo, L.date, L.amount, L.status, L.view]} rows={rows} empty={data.leaseContracts.length === 0} emptyText={L.noData} />;
}

function SaleTab({ data, L, locale, custName }: { data: UnitProfileData; L: ReturnType<typeof labels>; locale: Locale; custName: (id?: string | null) => string }) {
  const rows = data.saleContracts.map(sc => ({ cells: [
    custName(sc.customer_id), sc.contract_no,
    <span key="a" className="tabular-nums font-medium">{formatXof(Number(sc.total_amount_xof))}</span>,
    <Badge key="s" variant={contractTone(sc.status)}>{L.contractStatusLabels[sc.status] ?? sc.status}</Badge>,
    <TextLink key="v" href={routeFor(locale, "/sales")}>{L.view}</TextLink>,
  ]}));
  return <TableTab columns={[L.buyer, L.contractNo, L.amount, L.status, L.view]} rows={rows} empty={data.saleContracts.length === 0} emptyText={L.noData} />;
}

function TableTab({ columns, rows, empty, emptyText }: { columns: string[]; rows: { cells: React.ReactNode[] }[]; empty: boolean; emptyText: string }) {
  if (empty) return <EmptyState title={emptyText} />;
  return (
    <Card><div className="overflow-x-auto">
      <table className="w-full text-left text-[13px]">
        <thead className="border-b bg-muted text-xs font-semibold uppercase tracking-[0.04em] text-muted-foreground"><tr>{columns.map(h=><th key={h} className="px-4 py-2.5">{h}</th>)}</tr></thead>
        <tbody className="divide-y">{rows.map((row,i)=><tr key={i} className="transition-colors hover:bg-accent/50">{row.cells.map((c,j)=><td key={j} className="px-4 py-2.5">{c}</td>)}</tr>)}</tbody>
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

function dailyStatusTone(status: string): BadgeTone {
  const tones: Record<string, BadgeTone> = { pending_review: "warning", confirmed: "default", checked_in: "success", checked_out: "secondary", cancelled: "destructive" };
  return tones[status] ?? "secondary";
}

function contractTone(status: ContractStatus): BadgeTone {
  const tones: Record<ContractStatus, BadgeTone> = { active: "success", draft: "secondary", terminated: "destructive", expired: "warning" };
  return tones[status] ?? "secondary";
}

function occupationText(stats: { currentBooking: { check_in: string } | null; currentLease: { contract_no: string } | null; currentSale: { contract_no: string } | null }, L: ReturnType<typeof labels>) {
  if (stats.currentBooking) return `${L.daily}: ${stats.currentBooking.check_in}`;
  if (stats.currentLease) return `${L.lease}: ${stats.currentLease.contract_no}`;
  if (stats.currentSale) return `${L.sale}: ${stats.currentSale.contract_no}`;
  return L.noData;
}

// ── Labels — Chinese and French ──
function labels(locale: Locale) {
  if (locale === "fr") {
    return {
      overview: "Apercu", daily: "Jour", lease: "Location", sale: "Vente", finance: "Finance", docs: "Docs", audit: "Audit",
      tabs: "Onglets", floor: "Etage", kind: "Type", area: "Surface", layout: "Typologie", furnishing: "Meubles", notes: "Notes",
      newBooking: "Reserver", newLease: "Nouveau bail", newSale: "Nouvelle vente",
      totalRec: "Total du", totalPaid: "Total paye", unpaid: "Impaye", overdueAmt: "Retard",
      lastPayment: "Dernier paiement", currentCustomer: "Client actuel", currentOccupation: "Occupation actuelle",
      noData: "Aucune donnee", view: "Voir", print: "Imprimer", date: "Date", amount: "Montant", paid: "Paye",
      status: "Statut", customer: "Client", buyer: "Acheteur", contractNo: "Contrat",
      source: "Source", receivables: "Creances", payments: "Paiements", receipt: "Recu",
      action: "Action", entity: "Objet", unitInfo: "Informations du logement",
      openEnded: "non fixe", settled: "Solde", leaseContract: "Contrat bail", saleContract: "Contrat vente",
      statusLabels: { available:"Dispo", reserved:"Reserve", daily_occupied:"Occupe jour", cleaning_pending:"Menage", leased:"Loue", sold:"Vendu", maintenance:"Maintenance", locked:"Bloque" } as Record<UnitStatus,string>,
      kindLabels: { apartment:"Appart", parking:"Parking", storefront:"Commerce", office:"Bureau" } as Record<UnitKind,string>,
      furnishingLabels: { none:"Sans meubles", basic:"Basique", full:"Complet" } as Record<string,string>,
      dailyStatusLabels: { pending_review:"A valider", confirmed:"Confirme", checked_in:"Arrive", checked_out:"Parti", cancelled:"Annule" } as Record<string,string>,
      contractStatusLabels: { active:"Actif", draft:"Brouillon", terminated:"Resilie", expired:"Expire" } as Record<ContractStatus,string>,
      sourceLabels: { daily_booking:"Jour", lease_contract:"Location", sale_contract:"Vente", manual:"Manuel" } as Record<string,string>,
      auditActions: { create:"Creer", update:"Modifier", status_change:"Statut", check_in:"Arrivee", check_out:"Depart", activate:"Activer", terminate:"Resilier", move_out:"Sortie", payment:"Paiement", cancel:"Annuler" } as Record<string,string>,
    };
  }
  return {
    overview: "总览", daily: "日租", lease: "长租", sale: "出售", finance: "财务", docs: "单据", audit: "审计",
    tabs: "房源档案标签", floor: "楼层", kind: "类型", area: "面积", layout: "户型", furnishing: "家具", notes: "备注",
    newBooking: "新建日租", newLease: "新增长租", newSale: "新增出售",
    totalRec: "累计应收", totalPaid: "累计实收", unpaid: "欠费", overdueAmt: "逾期",
    lastPayment: "最近收款", currentCustomer: "当前客户", currentOccupation: "当前占用",
    noData: "暂无数据", view: "查看", print: "打印", date: "日期", amount: "金额", paid: "已收",
    status: "状态", customer: "客户", buyer: "买方", contractNo: "合同号",
    source: "来源", receivables: "应收", payments: "收款", receipt: "收据",
    action: "操作", entity: "对象", unitInfo: "房源信息",
    openEnded: "未定", settled: "结清", leaseContract: "长租合同", saleContract: "出售合同",
    statusLabels: { available:"空闲", reserved:"已预订", daily_occupied:"日租中", cleaning_pending:"待保洁", leased:"长租中", sold:"已售", maintenance:"维修", locked:"锁定" } as Record<UnitStatus,string>,
    kindLabels: { apartment:"公寓", parking:"车位", storefront:"门面", office:"办公" } as Record<UnitKind,string>,
    furnishingLabels: { none:"无家具", basic:"基础家具", full:"齐全家具" } as Record<string,string>,
    dailyStatusLabels: { pending_review:"待审核", confirmed:"已确认", checked_in:"已入住", checked_out:"已退房", cancelled:"已取消" } as Record<string,string>,
    contractStatusLabels: { active:"生效中", draft:"草稿", terminated:"已终止", expired:"已过期" } as Record<ContractStatus,string>,
    sourceLabels: { daily_booking:"日租", lease_contract:"长租", sale_contract:"出售", manual:"手工" } as Record<string,string>,
    auditActions: { create:"新建", update:"修改", status_change:"修改房态", check_in:"入住", check_out:"退房", activate:"激活", terminate:"终止", move_out:"退租", payment:"收款", cancel:"取消" } as Record<string,string>,
  };
}
