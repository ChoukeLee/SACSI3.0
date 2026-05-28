"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  BedDouble,
  Building2,
  Calendar,
  CreditCard,
  DollarSign,
  Home,
  Printer,
  User,
} from "lucide-react";
import type { Locale } from "@/lib/i18n";
import { routeFor } from "@/lib/i18n";
import { cn, formatXof } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { printDocumentRecord } from "@/features/documents/templates/all-templates";
import type { DocumentRecord } from "@/features/documents/types";
import type { ContractStatus, UnitKind, UnitStatus } from "@/types/domain";
import type { UnitProfileData } from "./unit-profile-service";

const today = new Date().toISOString().slice(0, 10);

type Tab = "overview" | "daily" | "lease" | "sale" | "finance" | "docs" | "audit";
type BadgeTone = React.ComponentProps<typeof Badge>["variant"];

interface Props {
  data: UnitProfileData;
  locale: Locale;
  userRole: string;
}

export function UnitProfileView({ data, locale, userRole }: Props) {
  void userRole;
  const { unit, buildingName } = data;
  const [tab, setTab] = useState<Tab>("overview");
  const L = labels(locale);

  const custName = (id?: string | null) => data.customers.find((c) => c.id === id)?.name ?? "-";

  const stats = useMemo(() => {
    let totalRec = 0;
    let totalPaid = 0;
    let totalOverdue = 0;

    for (const r of data.receivables) {
      if (r.status === "cancelled") continue;
      const amount = Number(r.amount_xof);
      const paid = Number(r.paid_amount_xof);
      const outstanding = amount - paid;
      totalRec += amount;
      totalPaid += paid;
      if (outstanding > 0 && (r.status === "overdue" || r.due_date < today)) {
        totalOverdue += outstanding;
      }
    }

    const latestPayment = data.payments[0] ?? null;
    const currentBooking = data.dailyBookings.find((b) => b.status === "checked_in" || b.status === "confirmed" || b.status === "pending_review") ?? null;
    const currentLease = data.leaseContracts.find((l) => l.status === "active") ?? null;
    const currentSale = data.saleContracts.find((s) => s.status === "active") ?? null;

    return {
      totalRec,
      totalPaid,
      totalOverdue,
      unpaid: totalRec - totalPaid,
      latestPayment,
      currentBooking,
      currentLease,
      currentSale,
    };
  }, [data]);

  const currentCustomer = stats.currentBooking
    ? custName(stats.currentBooking.customer_id)
    : stats.currentLease
      ? custName(stats.currentLease.customer_id)
      : stats.currentSale
        ? custName(stats.currentSale.customer_id)
        : null;

  const documents = useMemo(() => {
    const docs: DocumentRecord[] = [];

    for (const b of data.dailyBookings) {
      docs.push({
        id: `doc_db_${b.id}`,
        docType: "daily_booking",
        source: "daily",
        title: `${L.daily} ${unit.unit_no} ${b.check_in}`,
        date: b.check_in,
        unitNo: unit.unit_no,
        customerName: custName(b.customer_id),
        amountXof: Number(b.total_amount_xof),
        paidAmountXof: Number(b.prepaid_amount_xof),
        status: b.status,
        raw: b,
        customerPhone: undefined,
      } as DocumentRecord);
    }

    for (const lc of data.leaseContracts) {
      docs.push({
        id: `doc_lc_${lc.id}`,
        docType: "lease_contract",
        source: "lease",
        title: `${L.leaseContract} ${lc.contract_no}`,
        date: lc.start_date,
        unitNo: unit.unit_no,
        customerName: custName(lc.customer_id),
        amountXof: Number(lc.monthly_rent_xof),
        paidAmountXof: 0,
        status: lc.status,
        raw: lc,
        contractNo: lc.contract_no,
        customerPhone: undefined,
      } as DocumentRecord);
    }

    for (const sc of data.saleContracts) {
      docs.push({
        id: `doc_sc_${sc.id}`,
        docType: "sale_contract",
        source: "sale",
        title: `${L.saleContract} ${sc.contract_no}`,
        date: sc.signed_date,
        unitNo: unit.unit_no,
        customerName: custName(sc.customer_id),
        amountXof: Number(sc.total_amount_xof),
        paidAmountXof: 0,
        status: sc.status,
        raw: sc,
        contractNo: sc.contract_no,
        customerPhone: undefined,
      } as DocumentRecord);
    }

    return docs;
  }, [L.daily, L.leaseContract, L.saleContract, data.dailyBookings, data.leaseContracts, data.saleContracts, unit.unit_no]);

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
      <section className="overflow-hidden rounded-3xl border border-neutral-200 bg-white shadow-natural">
        <div className="flex flex-col gap-5 border-b border-neutral-200 px-6 py-5 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="font-mono text-3xl font-black leading-none text-brand-neutral-950">{unit.unit_no}</h1>
              <UnitStatusPill status={unit.status} label={L.statusLabels[unit.status] ?? unit.status} />
            </div>
            <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-sm font-semibold text-brand-neutral-800">
              <span className="inline-flex items-center gap-1.5">
                <Building2 className="h-4 w-4 text-brand-neutral-500" />
                {buildingName}
              </span>
              <span>{L.floor}: {unit.floor_label}</span>
              <span>{L.kind}: {L.kindLabels[unit.kind] ?? unit.kind}</span>
              {unit.layout && <span>{L.layout}: {unit.layout}</span>}
              {unit.area_sqm && <span>{L.area}: {unit.area_sqm} m²</span>}
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <ActionLink href={routeFor(locale, "/daily-rentals")} tone="dark" icon={<BedDouble className="h-4 w-4" />}>
              {L.newBooking}
            </ActionLink>
            <ActionLink href={routeFor(locale, "/leases")} tone="green" icon={<Home className="h-4 w-4" />}>
              {L.newLease}
            </ActionLink>
            <ActionLink href={routeFor(locale, "/sales")} tone="orange" icon={<CreditCard className="h-4 w-4" />}>
              {L.newSale}
            </ActionLink>
          </div>
        </div>

        <div className="grid gap-3 px-6 py-4 md:grid-cols-3">
          <HeaderInfo label={L.currentCustomer} value={currentCustomer ?? L.noData} />
          <HeaderInfo label={L.currentOccupation} value={occupationText(stats, L)} />
          <HeaderInfo label="ID" value={unit.id.slice(0, 8)} mono />
        </div>
      </section>

      <nav className="flex gap-1 overflow-x-auto rounded-2xl border border-neutral-200 bg-white p-1.5 shadow-natural" aria-label={L.tabs}>
        {tabs.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => setTab(item.key)}
            className={cn(
              "shrink-0 rounded-xl px-4 py-2 text-sm font-black transition",
              tab === item.key
                ? "bg-brand-indigo-500 text-white shadow-sm"
                : "text-brand-neutral-800 hover:bg-brand-neutral-50"
            )}
          >
            {item.label}
            {item.count !== undefined && <span className="ml-1 opacity-75">({item.count})</span>}
          </button>
        ))}
      </nav>

      {tab === "overview" && (
        <div className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatBox label={L.totalRec} value={formatXof(stats.totalRec)} tone="dark" />
            <StatBox label={L.totalPaid} value={formatXof(stats.totalPaid)} tone="green" />
            <StatBox label={L.unpaid} value={formatXof(stats.unpaid)} tone={stats.unpaid > 0 ? "orange" : "green"} />
            <StatBox label={L.overdueAmt} value={formatXof(stats.totalOverdue)} tone={stats.totalOverdue > 0 ? "red" : "green"} />
          </div>

          <div className="grid gap-3 lg:grid-cols-3">
            <InfoCard label={L.lastPayment} value={stats.latestPayment ? `${stats.latestPayment.payment_date} · ${formatXof(Number(stats.latestPayment.amount))}` : L.noData} />
            <InfoCard label={L.currentCustomer} value={currentCustomer ?? L.noData} />
            <InfoCard label={L.currentOccupation} value={occupationText(stats, L)} />
          </div>

          <section className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-natural">
            <h2 className="text-sm font-black text-brand-neutral-950">{L.unitInfo}</h2>
            <div className="mt-4 grid gap-x-8 gap-y-3 text-sm font-semibold text-brand-neutral-800 sm:grid-cols-2 lg:grid-cols-3">
              <span>{L.floor}: {unit.floor_label}</span>
              <span>{L.kind}: {L.kindLabels[unit.kind] ?? unit.kind}</span>
              {unit.area_sqm && <span>{L.area}: {unit.area_sqm} m²</span>}
              {unit.layout && <span>{L.layout}: {unit.layout}</span>}
              {unit.furnishing && <span>{L.furnishing}: {L.furnishingLabels[unit.furnishing] ?? unit.furnishing}</span>}
              {unit.notes && <span className="sm:col-span-2">{L.notes}: {unit.notes}</span>}
            </div>
          </section>
        </div>
      )}

      {tab === "daily" && (
        <DataSection empty={data.dailyBookings.length === 0} emptyText={L.noData}>
          <table className="data-table">
            <DataHead columns={[L.customer, L.date, L.status, L.amount, L.view]} />
            <tbody className="divide-y divide-neutral-100">
              {data.dailyBookings.map((b) => (
                <tr key={b.id} className="hover:bg-brand-indigo-50/40">
                  <Cell strong>{custName(b.customer_id)}</Cell>
                  <Cell>{b.check_in} → {b.check_out ?? L.openEnded}</Cell>
                  <Cell><Badge variant={dailyStatusTone(b.status)}>{L.dailyStatusLabels[b.status] ?? b.status}</Badge></Cell>
                  <Cell align="right" strong>{formatXof(Number(b.total_amount_xof))}</Cell>
                  <Cell><TextLink href={routeFor(locale, "/daily-rentals")}>{L.view}</TextLink></Cell>
                </tr>
              ))}
            </tbody>
          </table>
        </DataSection>
      )}

      {tab === "lease" && (
        <DataSection empty={data.leaseContracts.length === 0} emptyText={L.noData}>
          <table className="data-table">
            <DataHead columns={[L.customer, L.contractNo, L.date, L.amount, L.status, L.view]} />
            <tbody className="divide-y divide-neutral-100">
              {data.leaseContracts.map((lc) => (
                <tr key={lc.id} className="hover:bg-brand-indigo-50/40">
                  <Cell strong>{custName(lc.customer_id)}</Cell>
                  <Cell>{lc.contract_no}</Cell>
                  <Cell>{lc.start_date} → {lc.expected_end_date}</Cell>
                  <Cell align="right" strong>{formatXof(Number(lc.monthly_rent_xof))}</Cell>
                  <Cell><Badge variant={contractTone(lc.status)}>{L.contractStatusLabels[lc.status] ?? lc.status}</Badge></Cell>
                  <Cell><TextLink href={routeFor(locale, "/leases")}>{L.view}</TextLink></Cell>
                </tr>
              ))}
            </tbody>
          </table>
        </DataSection>
      )}

      {tab === "sale" && (
        <DataSection empty={data.saleContracts.length === 0} emptyText={L.noData}>
          <table className="data-table">
            <DataHead columns={[L.buyer, L.contractNo, L.amount, L.status, L.view]} />
            <tbody className="divide-y divide-neutral-100">
              {data.saleContracts.map((sc) => (
                <tr key={sc.id} className="hover:bg-brand-indigo-50/40">
                  <Cell strong>{custName(sc.customer_id)}</Cell>
                  <Cell>{sc.contract_no}</Cell>
                  <Cell align="right" strong>{formatXof(Number(sc.total_amount_xof))}</Cell>
                  <Cell><Badge variant={contractTone(sc.status)}>{L.contractStatusLabels[sc.status] ?? sc.status}</Badge></Cell>
                  <Cell><TextLink href={routeFor(locale, "/sales")}>{L.view}</TextLink></Cell>
                </tr>
              ))}
            </tbody>
          </table>
        </DataSection>
      )}

      {tab === "finance" && (
        <div className="space-y-4">
          <div className="grid gap-3 md:grid-cols-3">
            {(["daily_booking", "lease_contract", "sale_contract"] as const).map((source) => {
              const rows = data.receivables.filter((r) => r.source_type === source && r.status !== "cancelled");
              const total = rows.reduce((sum, r) => sum + Number(r.amount_xof), 0);
              const paid = rows.reduce((sum, r) => sum + Number(r.paid_amount_xof), 0);
              return <InfoCard key={source} label={L.sourceLabels[source]} value={`${formatXof(paid)} / ${formatXof(total)}`} />;
            })}
          </div>

          <DataSection title={`${L.receivables} (${data.receivables.filter((r) => r.status !== "cancelled").length})`} empty={data.receivables.length === 0} emptyText={L.noData}>
            <table className="data-table">
              <DataHead columns={[L.date, L.source, L.amount, L.paid, L.status]} />
              <tbody className="divide-y divide-neutral-100">
                {data.receivables.filter((r) => r.status !== "cancelled").slice(0, 50).map((r) => {
                  const outstanding = Number(r.amount_xof) - Number(r.paid_amount_xof);
                  return (
                    <tr key={r.id} className={cn("hover:bg-brand-indigo-50/40", r.status === "overdue" && "bg-brand-red-50/40")}>
                      <Cell>{r.due_date}</Cell>
                      <Cell>{L.sourceLabels[r.source_type] ?? r.source_type}</Cell>
                      <Cell align="right" strong>{formatXof(Number(r.amount_xof))}</Cell>
                      <Cell align="right" className="font-black text-brand-green-700">{formatXof(Number(r.paid_amount_xof))}</Cell>
                      <Cell><Badge variant={outstanding > 0 ? (r.status === "overdue" ? "danger" : "warning") : "success"}>{outstanding > 0 ? formatXof(outstanding) : L.settled}</Badge></Cell>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </DataSection>

          <DataSection title={`${L.payments} (${data.payments.length})`} empty={data.payments.length === 0} emptyText={L.noData}>
            <table className="data-table">
              <DataHead columns={[L.date, L.amount, L.receipt]} />
              <tbody className="divide-y divide-neutral-100">
                {data.payments.slice(0, 50).map((p) => (
                  <tr key={p.id} className="hover:bg-brand-indigo-50/40">
                    <Cell>{p.payment_date}</Cell>
                    <Cell align="right" className="font-black text-brand-green-700">{formatXof(Number(p.amount))}</Cell>
                    <Cell>{p.receipt_no ?? "-"}</Cell>
                  </tr>
                ))}
              </tbody>
            </table>
          </DataSection>
        </div>
      )}

      {tab === "docs" && (
        <DataSection empty={documents.length === 0} emptyText={L.noData}>
          <table className="data-table">
            <DataHead columns={[L.docs, L.date, L.action]} />
            <tbody className="divide-y divide-neutral-100">
              {documents.map((doc) => (
                <tr key={doc.id} className="hover:bg-brand-indigo-50/40">
                  <Cell strong>{doc.title}</Cell>
                  <Cell>{doc.date}</Cell>
                  <Cell>
                    <button
                      type="button"
                      onClick={() => printDocumentRecord(doc, locale)}
                      className="inline-flex items-center gap-1 rounded-lg bg-brand-indigo-500 px-3 py-1.5 text-xs font-black text-white transition hover:bg-brand-indigo-600"
                    >
                      <Printer className="h-3.5 w-3.5" />
                      {L.print}
                    </button>
                  </Cell>
                </tr>
              ))}
            </tbody>
          </table>
        </DataSection>
      )}

      {tab === "audit" && (
        <DataSection empty={data.auditLogs.length === 0} emptyText={L.noData}>
          <table className="data-table">
            <DataHead columns={[L.date, L.action, L.entity]} />
            <tbody className="divide-y divide-neutral-100">
              {data.auditLogs.slice(0, 50).map((log) => (
                <tr key={log.id} className="hover:bg-brand-indigo-50/40">
                  <Cell>{new Date(log.created_at).toLocaleDateString(locale === "fr" ? "fr-FR" : "zh-CN")}</Cell>
                  <Cell strong>{L.auditActions[log.action] ?? log.action}</Cell>
                  <Cell>{log.entity_type} {log.entity_id?.slice(0, 8)}</Cell>
                </tr>
              ))}
            </tbody>
          </table>
        </DataSection>
      )}
    </div>
  );
}

function labels(locale: Locale) {
  if (locale === "fr") {
    return {
      overview: "Apercu",
      daily: "Jour",
      lease: "Location",
      sale: "Vente",
      finance: "Finance",
      docs: "Docs",
      audit: "Audit",
      tabs: "Onglets du logement",
      floor: "Etage",
      kind: "Type",
      area: "Surface",
      layout: "Typologie",
      furnishing: "Meubles",
      notes: "Notes",
      newBooking: "Reserver",
      newLease: "Nouveau bail",
      newSale: "Nouvelle vente",
      totalRec: "Total du",
      totalPaid: "Total paye",
      unpaid: "Impaye",
      overdueAmt: "Retard",
      lastPayment: "Dernier paiement",
      currentCustomer: "Client actuel",
      currentOccupation: "Occupation actuelle",
      noData: "Aucune donnee",
      view: "Voir",
      print: "Imprimer",
      date: "Date",
      amount: "Montant",
      paid: "Paye",
      status: "Statut",
      customer: "Client",
      buyer: "Acheteur",
      contractNo: "Contrat",
      source: "Source",
      receivables: "Creances",
      payments: "Paiements",
      receipt: "Recu",
      action: "Action",
      entity: "Objet",
      unitInfo: "Informations du logement",
      openEnded: "non fixe",
      settled: "Solde",
      leaseContract: "Contrat bail",
      saleContract: "Contrat vente",
      statusLabels: { available: "Dispo", reserved: "Reserve", daily_occupied: "Occupe jour", cleaning_pending: "Menage", leased: "Loue", sold: "Vendu", maintenance: "Maintenance", locked: "Bloque" } as Record<UnitStatus, string>,
      kindLabels: { apartment: "Appart", parking: "Parking", storefront: "Commerce", office: "Bureau" } as Record<UnitKind, string>,
      furnishingLabels: { none: "Sans meubles", basic: "Basique", full: "Complet" } as Record<string, string>,
      dailyStatusLabels: { pending_review: "A valider", confirmed: "Confirme", checked_in: "Arrive", checked_out: "Parti", cancelled: "Annule" } as Record<string, string>,
      contractStatusLabels: { active: "Actif", draft: "Brouillon", terminated: "Resilie", expired: "Expire" } as Record<ContractStatus, string>,
      sourceLabels: { daily_booking: "Jour", lease_contract: "Location", sale_contract: "Vente", manual: "Manuel" } as Record<string, string>,
      auditActions: { create: "Creer", update: "Modifier", status_change: "Statut", check_in: "Arrivee", check_out: "Depart", activate: "Activer", terminate: "Resilier", move_out: "Sortie", payment: "Paiement", cancel: "Annuler" } as Record<string, string>,
    };
  }

  return {
    overview: "总览",
    daily: "日租",
    lease: "长租",
    sale: "出售",
    finance: "财务",
    docs: "单据",
    audit: "审计",
    tabs: "房源档案标签",
    floor: "楼层",
    kind: "类型",
    area: "面积",
    layout: "户型",
    furnishing: "家具",
    notes: "备注",
    newBooking: "新建日租",
    newLease: "新增长租",
    newSale: "新增出售",
    totalRec: "累计应收",
    totalPaid: "累计实收",
    unpaid: "欠费",
    overdueAmt: "逾期",
    lastPayment: "最近收款",
    currentCustomer: "当前客户",
    currentOccupation: "当前占用",
    noData: "暂无数据",
    view: "查看",
    print: "打印",
    date: "日期",
    amount: "金额",
    paid: "已收",
    status: "状态",
    customer: "客户",
    buyer: "买方",
    contractNo: "合同号",
    source: "来源",
    receivables: "应收",
    payments: "收款",
    receipt: "收据",
    action: "操作",
    entity: "对象",
    unitInfo: "房源信息",
    openEnded: "未定",
    settled: "结清",
    leaseContract: "长租合同",
    saleContract: "出售合同",
    statusLabels: { available: "空闲", reserved: "预订", daily_occupied: "日租中", cleaning_pending: "待保洁", leased: "长租中", sold: "已售", maintenance: "维修", locked: "锁定" } as Record<UnitStatus, string>,
    kindLabels: { apartment: "公寓", parking: "车位", storefront: "门面", office: "办公" } as Record<UnitKind, string>,
    furnishingLabels: { none: "无家具", basic: "基础家具", full: "齐全家具" } as Record<string, string>,
    dailyStatusLabels: { pending_review: "待审核", confirmed: "已确认", checked_in: "已入住", checked_out: "已退房", cancelled: "已取消" } as Record<string, string>,
    contractStatusLabels: { active: "生效中", draft: "草稿", terminated: "已终止", expired: "已过期" } as Record<ContractStatus, string>,
    sourceLabels: { daily_booking: "日租", lease_contract: "长租", sale_contract: "出售", manual: "手工" } as Record<string, string>,
    auditActions: { create: "新建", update: "修改", status_change: "修改房态", check_in: "入住", check_out: "退房", activate: "激活", terminate: "终止", move_out: "退租", payment: "收款", cancel: "取消" } as Record<string, string>,
  };
}

function UnitStatusPill({ status, label }: { status: UnitStatus; label: string }) {
  const styles: Record<UnitStatus, string> = {
    sold: "bg-brand-warm-100 text-brand-ink-800 ring-brand-warm-300",
    leased: "bg-brand-cyan-50 text-brand-cyan-800 ring-brand-cyan-200",
    daily_occupied: "bg-brand-indigo-50 text-brand-indigo-800 ring-brand-indigo-200",
    reserved: "bg-brand-indigo-100 text-brand-indigo-900 ring-brand-indigo-300",
    cleaning_pending: "bg-brand-green-100 text-brand-green-900 ring-brand-green-300",
    available: "bg-brand-green-50 text-brand-green-800 ring-brand-green-200",
    maintenance: "bg-brand-red-500 text-white ring-brand-red-600",
    locked: "bg-white text-brand-neutral-950 ring-brand-neutral-600",
  };
  return <span className={cn("inline-flex rounded-full px-3 py-1 text-xs font-black ring-1 ring-inset", styles[status])}>{label}</span>;
}

function ActionLink({ href, tone, icon, children }: { href: string; tone: "dark" | "green" | "orange"; icon: React.ReactNode; children: React.ReactNode }) {
  const styles = {
    dark: "bg-brand-indigo-500 text-white hover:bg-brand-indigo-600",
    green: "bg-brand-green-50 text-brand-green-800 ring-brand-green-200 hover:bg-brand-green-100",
    orange: "bg-brand-indigo-50 text-brand-indigo-800 ring-brand-indigo-200 hover:bg-brand-indigo-100",
  }[tone];
  return (
    <Link href={href} className={cn("inline-flex h-10 items-center gap-2 rounded-xl px-3 text-xs font-black shadow-sm ring-1 ring-inset transition", styles)}>
      {icon}
      {children}
    </Link>
  );
}

function HeaderInfo({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-2xl bg-brand-neutral-50 px-4 py-3">
      <p className="text-xs font-black text-brand-neutral-500">{label}</p>
      <p className={cn("mt-1 text-sm font-black text-brand-neutral-950", mono && "font-mono")}>{value}</p>
    </div>
  );
}

function StatBox({ label, value, tone }: { label: string; value: string; tone: "dark" | "green" | "orange" | "red" }) {
  const styles = {
    dark: "border-brand-warm-300 bg-white text-brand-ink-900",
    green: "border-brand-green-200 bg-brand-green-50 text-brand-green-900",
    orange: "border-brand-indigo-200 bg-brand-indigo-50 text-brand-indigo-900",
    red: "border-brand-red-600 bg-brand-red-500 text-white",
  }[tone];
  return (
    <div className={cn("rounded-2xl border px-4 py-4 shadow-sm", styles)}>
      <p className="text-xs font-black opacity-80">{label}</p>
      <p className="mt-3 text-2xl font-black leading-none tabular-nums">{value}</p>
    </div>
  );
}

function InfoCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-natural">
      <p className="text-xs font-black text-brand-neutral-500">{label}</p>
      <p className="mt-2 text-base font-black text-brand-neutral-950">{value}</p>
    </div>
  );
}

function DataSection({ title, empty, emptyText, children }: { title?: string; empty: boolean; emptyText: string; children: React.ReactNode }) {
  return (
    <section className="overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-natural">
      {title && <div className="border-b border-neutral-200 bg-brand-neutral-50 px-4 py-3 text-sm font-black text-brand-neutral-950">{title}</div>}
      {empty ? <div className="py-12 text-center text-sm font-semibold text-brand-neutral-500">{emptyText}</div> : <div className="overflow-x-auto">{children}</div>}
    </section>
  );
}

function DataHead({ columns }: { columns: string[] }) {
  return (
    <thead className="bg-brand-neutral-50 text-xs font-black uppercase tracking-[0.14em] text-brand-neutral-700">
      <tr>{columns.map((column) => <th key={column} className="px-4 py-3 text-left">{column}</th>)}</tr>
    </thead>
  );
}

function Cell({ children, align, strong, className }: { children: React.ReactNode; align?: "right"; strong?: boolean; className?: string }) {
  return <td className={cn("px-4 py-3 text-sm text-brand-neutral-800", align === "right" && "text-right tabular-nums", strong && "font-black text-brand-neutral-950", className)}>{children}</td>;
}

function TextLink({ href, children }: { href: string; children: React.ReactNode }) {
  return <Link href={href} className="text-xs font-black text-brand-indigo-700 hover:text-brand-indigo-800 hover:underline">{children}</Link>;
}

function dailyStatusTone(status: string): BadgeTone {
  const tones: Record<string, BadgeTone> = {
    pending_review: "warning",
    confirmed: "accent",
    checked_in: "success",
    checked_out: "neutral",
    cancelled: "danger",
  };
  return tones[status] ?? "neutral";
}

function contractTone(status: ContractStatus): BadgeTone {
  const tones: Record<ContractStatus, BadgeTone> = {
    active: "success",
    draft: "neutral",
    terminated: "danger",
    expired: "warning",
  };
  return tones[status] ?? "neutral";
}

function occupationText(stats: {
  currentBooking: { check_in: string } | null;
  currentLease: { contract_no: string } | null;
  currentSale: { contract_no: string } | null;
}, L: ReturnType<typeof labels>) {
  if (stats.currentBooking) return `${L.daily}: ${stats.currentBooking.check_in}`;
  if (stats.currentLease) return `${L.lease}: ${stats.currentLease.contract_no}`;
  if (stats.currentSale) return `${L.sale}: ${stats.currentSale.contract_no}`;
  return L.noData;
}
