"use client";
import { leaseRentLabel, financeRowMoney, financeRowLabel } from "@/lib/native-money";
import { formatMoney } from "@/lib/currency";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  BedDouble,
  Building2,
  FileText,
  Home,
  Landmark,
  ReceiptText,
} from "lucide-react";
import type { Locale } from "@/lib/i18n";
import { routeFor } from "@/lib/i18n";
import { buildWorkbenchRecordHref, safeWorkbenchReturnTo } from "@/lib/workbench-links";
import { cn, formatXof } from "@/lib/utils";
import { paymentDisplay } from "@/lib/currency";
import { ProfileAuditTimeline } from "@/features/profiles/audit-timeline";
import {
  computeFinanceMetrics,
  isManagedReceivable,
  isReceivableOverdue,
  receivableOutstanding,
} from "@/features/finance/metrics";
import { HistoryPagination, useHistoryPage } from "@/features/profiles/history-pagination";
import {
  currencyDisplayLabel,
  financialBusinessLabel,
  isFinancialExpenseSourceType,
  statusDisplayLabel,
} from "@/lib/display-labels";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/empty-state";
import { conditionLabel } from "./operational-position";
import type { ContractStatus, UnitKind } from "@/types/domain";
import type { UnitProfileData } from "./unit-profile-service";
import styles from "./unit-profile.module.css";

type Tab = "overview" | "daily" | "contracts" | "finance" | "audit";
type BadgeTone = React.ComponentProps<typeof Badge>["variant"];

type UnitProfileProps = {
  data: UnitProfileData;
  locale: Locale;
  returnTo?: string;
};

export function UnitProfileView(props: UnitProfileProps) {
  return <UnitProfile key={props.data.unit.id} {...props} />;
}

function UnitProfile({ data, locale, returnTo }: UnitProfileProps) {
  const [tab, setTab] = useState<Tab>("overview");
  const zh = locale === "zh";
  const unit = data.unit;
  const today = new Date().toISOString().slice(0, 10);
  const customerMap = useMemo(
    () => new Map(data.customers.map((customer) => [customer.id, customer])),
    [data.customers],
  );
  const customerName = (id: string | null | undefined) =>
    id ? (customerMap.get(id)?.name ?? (zh ? "客户待补" : "Client à compléter")) : "-";

  const activeBooking = data.dailyBookings.find((row) => row.status === "checked_in");
  const activeLease = data.leaseContracts.find((row) => row.status === "active");
  const activeSale = data.saleContracts.find((row) => row.status === "active");
  const currentCustomer = activeBooking
    ? activeBooking.guest_customer_id
    : (activeLease?.customer_id ?? activeSale?.customer_id);
  const currentCustomerLabel = activeBooking
    ? activeBooking.guest_customer_id
      ? customerName(activeBooking.guest_customer_id)
      : (activeBooking.guest_name ?? (zh ? "住客身份待补" : "Identité du client à compléter"))
    : currentCustomer
      ? customerName(currentCustomer)
      : zh
        ? "暂无"
        : "Aucun";

  const finance = useMemo(() => {
    const metrics = computeFinanceMetrics(data.receivables, { asOfDate: today });
    return { ...metrics, received: metrics.collected };
  }, [data.receivables, today]);
  const dailyPage = useHistoryPage(data.dailyBookings);
  const leasePage = useHistoryPage(data.leaseContracts);
  const salePage = useHistoryPage(data.saleContracts);
  const receivablePage = useHistoryPage(
    data.receivables.filter((row) => row.status !== "cancelled"),
  );
  const paymentPage = useHistoryPage(data.payments);

  const tabs = [
    { value: "overview" as const, label: zh ? "概览" : "Aperçu" },
    {
      value: "daily" as const,
      label: zh ? "日租" : "Location jour",
      count: data.dailyBookings.length,
    },
    {
      value: "contracts" as const,
      label: zh ? "长租 / 出售" : "Bail / Vente",
      count: data.leaseContracts.length + data.saleContracts.length,
    },
    {
      value: "finance" as const,
      label: zh ? "财务记录" : "Finance",
      count:
        data.receivables.filter((row) => row.status !== "cancelled").length + data.payments.length,
    },
    {
      value: "audit" as const,
      label: zh ? "历史轨迹" : "Historique",
      count: data.auditLogs.length,
    },
  ];

  return (
    <div className={styles.profile} data-unit-profile>
      <header className={styles.header}>
        <div className="min-w-0">
          <Button asChild variant="ghost" size="sm" className="-ml-2 mb-3 text-muted-foreground">
            <Link href={safeWorkbenchReturnTo(returnTo) ?? routeFor(locale, "/units")}>
              <ArrowLeft className="h-4 w-4" />
              {zh ? "返回资产目录" : "Retour au répertoire"}
            </Link>
          </Button>
          <p className={styles.eyebrow}>ASSET DOSSIER</p>
          <h1>
            {unit.unit_no}
            <span>{zh ? "完整资产档案" : "Dossier complet"}</span>
          </h1>
          <div className={styles.subtitle}>
            <span className="inline-flex items-center gap-1.5">
              <Building2 className="h-4 w-4" />
              {data.buildingName}
            </span>
            <span>
              {zh
                ? "关联业务、财务与完整历史，在同一处核对。"
                : "Relations métier, finance et historique complet, au même endroit."}
            </span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild size="sm" variant="outline">
            <Link href={routeFor(locale, "/daily-rentals")}>
              <BedDouble className="h-4 w-4" />
              {zh ? "进入日租" : "Ouvrir jour"}
            </Link>
          </Button>
          <Button asChild size="sm" variant="outline">
            <Link href={routeFor(locale, "/leases")}>
              <Home className="h-4 w-4" />
              {zh ? "进入长租" : "Ouvrir bail"}
            </Link>
          </Button>
          <Button asChild size="sm" variant="outline">
            <Link href={routeFor(locale, "/sales")}>
              <Landmark className="h-4 w-4" />
              {zh ? "进入出售" : "Ouvrir vente"}
            </Link>
          </Button>
        </div>
      </header>

      <nav className={styles.tabs} aria-label={zh ? "房间档案" : "Dossier du lot"}>
        {tabs.map((item) => (
          <button
            key={item.value}
            type="button"
            aria-current={tab === item.value ? "page" : undefined}
            onClick={() => setTab(item.value)}
            aria-controls={`unit-profile-${unit.id}-content`}
          >
            {item.label}
            {"count" in item && <span>{item.count}</span>}
          </button>
        ))}
      </nav>
      <p className="text-xs leading-relaxed text-muted-foreground">
        {zh
          ? "当前账号权限内的完整历史。应收指标仅含纳管应收；已核销不是期间现金流。预订不作实际入住，经办人不作住客。"
          : "Historique complet dans vos droits. Créances suivies uniquement ; leur règlement ne représente pas le flux de trésorerie. Une réservation n’est pas un séjour effectif ; le responsable n’est pas le client."}
      </p>

      <div id={`unit-profile-${unit.id}-content`} className={styles.content}>
        {tab === "overview" && (
          <div className="space-y-4">
            <section
              className={styles.dimensions}
              aria-label={zh ? "资产独立状态" : "Dimensions de l’actif"}
            >
              <InfoRow
                label={zh ? "权属 / 出售口径" : "Propriété / vente"}
                value={
                  !data.position
                    ? zh
                      ? "待核实"
                      : "À vérifier"
                    : data.position.ownership === "sold"
                      ? zh
                        ? "已售（业务口径）"
                        : "Vendu (projection métier)"
                      : zh
                        ? "未明确（不按空闲推定）"
                        : "Non précisée"
                }
              />
              <InfoRow
                label={zh ? "实际占用" : "Occupation réelle"}
                value={
                  !data.position
                    ? zh
                      ? "待核实"
                      : "À vérifier"
                    : [
                        data.position.daily_occupied && (zh ? "日租入住" : "Séjour"),
                        data.position.lease_occupied && (zh ? "长租" : "Bail"),
                      ]
                        .filter(Boolean)
                        .join(" · ") || (zh ? "无当前入住" : "Aucune occupation")
                }
              />
              <InfoRow
                label={zh ? "运行条件" : "État opérationnel"}
                value={conditionLabel(data.position?.operational_condition, locale)}
              />
              <InfoRow
                label={zh ? "保洁" : "Nettoyage"}
                value={
                  !data.position
                    ? zh
                      ? "待核实"
                      : "À vérifier"
                    : data.position.cleaning_pending
                      ? zh
                        ? "待保洁"
                        : "En attente"
                      : zh
                        ? "无待办保洁"
                        : "Aucun nettoyage en attente"
                }
              />
            </section>
            <p className={styles.note}>
              {zh
                ? "权属、实际占用与运行条件独立判断。“已售”是业务投影，不作为产权登记凭证；无占用不等于可出租。"
                : "Propriété, occupation et état sont indépendants. « Vendu » n’est pas une preuve de titre ; sans occupation ne signifie pas prêt à louer."}
            </p>
            <div className={styles.metrics}>
              <Metric
                label={zh ? "纳管应收" : "Créances suivies"}
                value={formatXof(finance.receivable)}
                tone="blue"
              />
              <Metric
                label={zh ? "应收已核销" : "Affecté aux créances"}
                value={formatXof(finance.received)}
                tone="green"
              />
              <Metric
                label={zh ? "未收" : "Solde ouvert"}
                value={formatXof(finance.outstanding)}
                tone={finance.outstanding > 0 ? "amber" : "green"}
              />
              <Metric
                label={zh ? "逾期" : "En retard"}
                value={formatXof(finance.overdue)}
                tone={finance.overdue > 0 ? "red" : "green"}
              />
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
              <section className={styles.section}>
                <h2>{zh ? "当前业务信息" : "Activité actuelle"}</h2>
                <div className="space-y-3 p-5 text-sm">
                  <InfoRow
                    label={zh ? "当前业务" : "Activité"}
                    value={currentBusinessLabel({ activeBooking, activeLease, activeSale }, locale)}
                  />
                  <InfoRow label={zh ? "当前客户" : "Client actuel"} value={currentCustomerLabel} />
                  {activeBooking && (
                    <InfoRow
                      label={zh ? "经办人" : "Responsable"}
                      value={customerName(activeBooking.booking_agent_id)}
                    />
                  )}
                  <InfoRow
                    label={zh ? "日租" : "Location jour"}
                    value={
                      activeBooking
                        ? `${activeBooking.check_in} → ${activeBooking.check_out ?? (zh ? "未定" : "Ouvert")}`
                        : "-"
                    }
                  />
                  <InfoRow
                    label={zh ? "长租" : "Bail"}
                    value={
                      activeLease
                        ? `${activeLease.contract_no} · ${zh ? "已缴至" : "Payé au"} ${activeLease.paid_through_date ?? (zh ? "未记录" : "—")}`
                        : "-"
                    }
                  />
                  <InfoRow
                    label={zh ? "出售" : "Vente"}
                    value={
                      activeSale
                        ? `${activeSale.contract_no} · ${formatXof(Number(activeSale.total_amount_xof))}`
                        : "-"
                    }
                  />
                </div>
              </section>
              <section className={styles.section}>
                <h2>{zh ? "房间资料" : "Informations du lot"}</h2>
                <div className="grid gap-x-6 gap-y-3 p-5 text-sm sm:grid-cols-2">
                  <InfoRow label={zh ? "楼栋" : "Bâtiment"} value={data.buildingName} />
                  <InfoRow label={zh ? "楼层" : "Étage"} value={unit.floor_label} />
                  <InfoRow label={zh ? "类型" : "Type"} value={unitKindLabel(unit.kind, locale)} />
                  <InfoRow
                    label={zh ? "家具" : "Meubles"}
                    value={furnishingLabel(unit.furnishing, locale)}
                  />
                  <InfoRow label={zh ? "户型" : "Plan"} value={unit.layout ?? "-"} />
                  <InfoRow
                    label={zh ? "面积" : "Surface"}
                    value={unit.area_sqm != null ? `${Number(unit.area_sqm).toFixed(2)} m²` : "-"}
                  />
                  {unit.notes && (
                    <div className="sm:col-span-2">
                      <InfoRow label={zh ? "备注" : "Notes"} value={unit.notes} />
                    </div>
                  )}
                </div>
              </section>
            </div>
          </div>
        )}

        {tab === "daily" && (
          <RecordCard
            title={zh ? "日租记录" : "Historique jour"}
            footer={<HistoryPagination {...dailyPage.pagination} locale={locale} />}
            icon={BedDouble}
            empty={data.dailyBookings.length === 0}
            emptyText={zh ? "这个房间暂无日租记录" : "Aucune location jour"}
          >
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-sm">
                <thead>
                  <tr>
                    {[
                      zh ? "入住" : "Arrivée",
                      zh ? "离店" : "Départ",
                      zh ? "客户" : "Client",
                      zh ? "经办人" : "Responsable",
                      zh ? "金额" : "Montant",
                      zh ? "订单付款" : "Paiement de réservation",
                      zh ? "状态" : "Statut",
                      "",
                    ].map((label) => (
                      <th key={label} className="px-4 py-3 text-left text-xs text-muted-foreground">
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {dailyPage.rows.map((row) => (
                    <tr key={row.id} className="hover:bg-muted/40">
                      <td className="px-4 py-3 tabular-nums">{row.check_in}</td>
                      <td className="px-4 py-3 tabular-nums">
                        {row.check_out ?? (zh ? "未定" : "Ouvert")}
                      </td>
                      <td className="px-4 py-3 font-medium">
                        {row.guest_customer_id
                          ? customerName(row.guest_customer_id)
                          : (row.guest_name ?? (zh ? "住客身份待补" : "Client à compléter"))}
                      </td>
                      <td className="px-4 py-3">{customerName(row.booking_agent_id)}</td>
                      <td className="px-4 py-3 tabular-nums">
                        {formatXof(Number(row.total_amount_xof))}
                      </td>
                      <td className="px-4 py-3 tabular-nums text-emerald-700">
                        {formatXof(Number(row.prepaid_amount_xof))}
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant={dailyTone(row.status)}>
                          {statusDisplayLabel(row.status, locale)}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Button asChild size="sm" variant="ghost">
                          <Link href={routeFor(locale, "/daily-rentals")}>
                            {zh ? "查看 / 修改" : "Voir / modifier"}
                          </Link>
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </RecordCard>
        )}

        {tab === "contracts" && (
          <div className="space-y-4">
            <RecordCard
              title={zh ? "长租合同" : "Baux"}
              footer={<HistoryPagination {...leasePage.pagination} locale={locale} />}
              icon={Home}
              empty={data.leaseContracts.length === 0}
              emptyText={zh ? "暂无长租合同" : "Aucun bail"}
            >
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] text-sm">
                  <thead>
                    <tr>
                      {[
                        zh ? "合同号" : "Contrat",
                        zh ? "客户" : "Client",
                        zh ? "开始" : "Début",
                        zh ? "已缴至" : "Payé au",
                        zh ? "月租" : "Loyer",
                        zh ? "状态" : "Statut",
                        "",
                      ].map((label) => (
                        <th
                          key={label}
                          className="px-4 py-3 text-left text-xs text-muted-foreground"
                        >
                          {label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {leasePage.rows.map((row) => (
                      <tr key={row.id} className="hover:bg-muted/40">
                        <td className="px-4 py-3 font-medium">{row.contract_no}</td>
                        <td className="px-4 py-3">{customerName(row.customer_id)}</td>
                        <td className="px-4 py-3">{row.start_date}</td>
                        <td className="px-4 py-3">
                          {row.paid_through_date ?? (zh ? "未记录" : "—")}
                        </td>
                        <td className="px-4 py-3 tabular-nums">{leaseRentLabel(row, locale)}</td>
                        <td className="px-4 py-3">
                          <Badge variant={contractTone(row.status)}>
                            {statusDisplayLabel(row.status, locale)}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <Button asChild size="sm" variant="ghost">
                            <Link
                              href={
                                buildWorkbenchRecordHref({
                                  workspace: "leases",
                                  id: row.id,
                                  locale,
                                  building: unit.building_id,
                                  returnTo: routeFor(locale, `/units/${unit.id}`),
                                }) ?? routeFor(locale, "/leases")
                              }
                            >
                              {zh ? "进入长租" : "Ouvrir"}
                            </Link>
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </RecordCard>
            <RecordCard
              title={zh ? "出售合同" : "Ventes"}
              footer={<HistoryPagination {...salePage.pagination} locale={locale} />}
              icon={Landmark}
              empty={data.saleContracts.length === 0}
              emptyText={zh ? "暂无出售合同" : "Aucune vente"}
            >
              <div className="overflow-x-auto">
                <table className="w-full min-w-[700px] text-sm">
                  <thead>
                    <tr>
                      {[
                        zh ? "合同号" : "Contrat",
                        zh ? "客户" : "Client",
                        zh ? "签约日期" : "Signature",
                        zh ? "总价" : "Montant",
                        zh ? "状态" : "Statut",
                        "",
                      ].map((label) => (
                        <th
                          key={label}
                          className="px-4 py-3 text-left text-xs text-muted-foreground"
                        >
                          {label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {salePage.rows.map((row) => (
                      <tr key={row.id} className="hover:bg-muted/40">
                        <td className="px-4 py-3 font-medium">{row.contract_no}</td>
                        <td className="px-4 py-3">{customerName(row.customer_id)}</td>
                        <td className="px-4 py-3">{row.signed_date}</td>
                        <td className="px-4 py-3 tabular-nums">
                          {formatXof(Number(row.total_amount_xof))}
                        </td>
                        <td className="px-4 py-3">
                          <Badge variant={contractTone(row.status)}>
                            {statusDisplayLabel(row.status, locale)}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <Button asChild size="sm" variant="ghost">
                            <Link
                              href={
                                buildWorkbenchRecordHref({
                                  workspace: "sales",
                                  id: row.id,
                                  locale,
                                  building: unit.building_id,
                                  returnTo: routeFor(locale, `/units/${unit.id}`),
                                }) ?? routeFor(locale, "/sales")
                              }
                            >
                              {zh ? "进入出售" : "Ouvrir"}
                            </Link>
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </RecordCard>
          </div>
        )}

        {tab === "finance" && (
          <div className="space-y-4">
            <div className={styles.metrics}>
              <Metric
                label={zh ? "纳管应收" : "Créances suivies"}
                value={formatXof(finance.receivable)}
                tone="blue"
              />
              <Metric
                label={zh ? "应收已核销" : "Affecté aux créances"}
                value={formatXof(finance.received)}
                tone="green"
              />
              <Metric
                label={zh ? "未收" : "Solde ouvert"}
                value={formatXof(finance.outstanding)}
                tone="amber"
              />
              <Metric
                label={zh ? "逾期" : "En retard"}
                value={formatXof(finance.overdue)}
                tone={finance.overdue > 0 ? "red" : "green"}
              />
            </div>
            <RecordCard
              title={zh ? "应收记录" : "Créances"}
              footer={<HistoryPagination {...receivablePage.pagination} locale={locale} />}
              icon={FileText}
              empty={data.receivables.filter((row) => row.status !== "cancelled").length === 0}
              emptyText={zh ? "暂无应收记录" : "Aucune créance"}
            >
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] text-sm">
                  <thead>
                    <tr>
                      {[
                        zh ? "到期日" : "Échéance",
                        zh ? "业务" : "Activité",
                        zh ? "说明" : "Libellé",
                        zh ? "应收" : "Dû",
                        zh ? "已核销" : "Imputé",
                        zh ? "未结" : "Solde",
                      ].map((label) => (
                        <th
                          key={label}
                          className="px-4 py-3 text-left text-xs text-muted-foreground"
                        >
                          {label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {receivablePage.rows.map((row) => {
                      const value = financeRowMoney(row);
                      const balance =
                        row.amount_native != null
                          ? Math.max(0, value.amount - financeRowMoney(row, true).amount)
                          : receivableOutstanding(row);
                      return (
                        <tr
                          key={row.id}
                          className={cn(
                            "hover:bg-muted/40",
                            isManagedReceivable(row) &&
                              isReceivableOverdue(row, today) &&
                              "bg-red-50/40",
                          )}
                        >
                          <td className="px-4 py-3">{row.due_date}</td>
                          <td className="px-4 py-3">
                            {financialBusinessLabel(row.source_type, locale, row.category)}
                          </td>
                          <td className="px-4 py-3 font-medium">
                            {row.title}
                            {!isManagedReceivable(row) && (
                              <span className="block text-xs font-normal text-muted-foreground">
                                {zh ? "未纳管 · 不计指标" : "Hors suivi · exclu des indicateurs"}
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3 tabular-nums">{financeRowLabel(row, locale)}</td>
                          <td className="px-4 py-3 tabular-nums text-emerald-700">
                            {financeRowLabel(row, locale, true)}
                          </td>
                          <td
                            className={cn(
                              "px-4 py-3 tabular-nums font-medium",
                              balance > 0 && "text-red-700",
                            )}
                          >
                            {formatMoney(balance, value.currency, locale)}{" "}
                            {value.currency === "XOF" ? "" : value.currency}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </RecordCard>
            <RecordCard
              title={zh ? "收付款与调整" : "Paiements et ajustements"}
              footer={<HistoryPagination {...paymentPage.pagination} locale={locale} />}
              icon={ReceiptText}
              empty={data.payments.length === 0}
              emptyText={zh ? "暂无收款记录" : "Aucun paiement"}
            >
              <div className="overflow-x-auto">
                <table className="w-full min-w-[620px] text-sm">
                  <thead>
                    <tr>
                      {[
                        zh ? "日期" : "Date",
                        zh ? "业务" : "Activité",
                        zh ? "金额" : "Montant",
                        zh ? "币种" : "Devise",
                        zh ? "收据号" : "Reçu",
                      ].map((label) => (
                        <th
                          key={label}
                          className="px-4 py-3 text-left text-xs text-muted-foreground"
                        >
                          {label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {paymentPage.rows.map((row) => {
                      const isExpense = isFinancialExpenseSourceType(row.source_type);
                      const display = paymentDisplay(row, locale);
                      return (
                        <tr key={row.id} className="hover:bg-muted/40">
                          <td className="px-4 py-3">{row.payment_date}</td>
                          <td className={cn("px-4 py-3", isExpense && "font-medium text-red-700")}>
                            {financialBusinessLabel(row.source_type, locale)}
                          </td>
                          <td
                            className={cn(
                              "px-4 py-3 font-medium tabular-nums",
                              isExpense ? "text-red-700" : "text-emerald-700",
                            )}
                          >
                            {display.primary}
                            {display.secondary && (
                              <span className="block text-[11px] font-normal text-muted-foreground">
                                {zh ? "折合 " : "Soit "}
                                {display.secondary}
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            {currencyDisplayLabel(row.currency, locale)}
                          </td>
                          <td className="px-4 py-3">{row.receipt_no ?? "-"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </RecordCard>
          </div>
        )}
        {tab === "audit" && <ProfileAuditTimeline logs={data.auditLogs} locale={locale} />}
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "blue" | "green" | "amber" | "red";
}) {
  const dots = {
    blue: "bg-accentBlue-500",
    green: "bg-accentGreen-500",
    amber: "bg-accentAmber-500",
    red: "bg-accentRed-500",
  };
  return (
    <div className={styles.metric}>
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-medium">{label}</p>
        <span className={cn("h-2.5 w-2.5 rounded-full", dots[tone])} />
      </div>
      <p className="mt-3 text-xl font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="mt-1 font-medium leading-relaxed">{value}</p>
    </div>
  );
}

function RecordCard({
  title,
  icon: Icon,
  empty,
  emptyText,
  children,
  footer,
}: {
  title: string;
  icon: typeof FileText;
  empty: boolean;
  emptyText: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <section className={styles.section}>
      <h2>
        <Icon className="h-4 w-4 text-muted-foreground" />
        {title}
      </h2>
      <div>
        {empty ? (
          <div className="p-6">
            <EmptyState title={emptyText} />
          </div>
        ) : (
          children
        )}
      </div>
      {!empty && footer}
    </section>
  );
}

function unitKindLabel(kind: UnitKind, locale: Locale) {
  const zh = {
    apartment: "公寓",
    parking: "车位",
    storefront: "门面",
    office: "办公室",
    warehouse: "仓库",
  };
  const fr = {
    apartment: "Appartement",
    parking: "Parking",
    storefront: "Commerce",
    office: "Bureau",
    warehouse: "Entrepôt",
  };
  return (locale === "zh" ? zh : fr)[kind] ?? kind;
}
function furnishingLabel(value: string | null, locale: Locale) {
  if (!value) return "-";
  const zh: Record<string, string> = { none: "无家具", basic: "基础家具", full: "家具齐全" };
  const fr: Record<string, string> = {
    none: "Non meublé",
    basic: "Meubles de base",
    full: "Meublé",
  };
  return (locale === "zh" ? zh : fr)[value] ?? value;
}
function dailyTone(status: string): BadgeTone {
  return (
    (
      {
        pending_review: "warning",
        confirmed: "default",
        checked_in: "success",
        checked_out: "secondary",
        cancelled: "destructive",
      } as Record<string, BadgeTone>
    )[status] ?? "secondary"
  );
}
function contractTone(status: ContractStatus): BadgeTone {
  return (
    {
      active: "success",
      draft: "secondary",
      terminated: "destructive",
      expired: "warning",
    } as Record<ContractStatus, BadgeTone>
  )[status];
}
function currentBusinessLabel(
  input: {
    activeBooking?: UnitProfileData["dailyBookings"][number];
    activeLease?: UnitProfileData["leaseContracts"][number];
    activeSale?: UnitProfileData["saleContracts"][number];
  },
  locale: Locale,
) {
  if (input.activeBooking) return locale === "zh" ? "日租入住" : "Location jour";
  if (input.activeLease) return locale === "zh" ? "长租" : "Bail";
  if (input.activeSale) return locale === "zh" ? "已出售" : "Vendu";
  return locale === "zh" ? "暂无" : "Aucune";
}
