"use client";

import { useId, useState, type ReactNode } from "react";
import Link from "next/link";
import { DollarSign, CalendarPlus, TrendingUp, AlertTriangle, Printer, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  formatContractXof,
  type ContractReceivableSummary,
} from "@/features/contracts/contract-list-model";
import {
  classifyContractCashPayment,
  summarizeContractCash,
} from "@/features/contracts/contract-cash-model";
import type { WorkspaceData } from "@/features/contracts/workspace-model";
import { buildWorkbenchRecordHref } from "@/lib/workbench-links";
import type { Locale } from "@/lib/i18n";
import { dictionaries } from "@/lib/i18n";
import { formatMoney } from "@/lib/currency";
import { cn } from "@/lib/utils";
import type { SaleContractRow } from "@/types/database";
import { saleScheduleReceivable, saleScheduleState } from "./sale-workbench-model";
import {
  buildSalePurchaseReceiptSummary,
  buildSaleRecordOverview,
  saleRegisteredPrice,
  saleRegisteredBalance,
  type SaleCurrencyAmount,
} from "./sale-room-overview-model";
import styles from "./sale-workbench.module.css";

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}
type SaleInspectorData = Pick<
  WorkspaceData,
  | "contracts"
  | "units"
  | "customers"
  | "buildings"
  | "today"
  | "schedules"
  | "payments"
  | "receivables"
> & { summaries: Record<string, ContractReceivableSummary> };

export type SaleWorkbenchAction = "payment" | "installment" | "transfer" | "terminate";

export function SaleWorkbenchInspector({
  data,
  locale,
  loading,
  error,
  selectedId,
  returnTo,
  onClose,
  onRetry,
  initialTab = "overview",
  canRecordFinance = false,
  canManage = false,
  canTerminate = false,
  busy = false,
  onAction,
  onPrint,
  embedded = false,
  operationError,
}: {
  data: SaleInspectorData | null;
  locale: Locale;
  loading: boolean;
  error: boolean;
  selectedId: string | null;
  returnTo: string;
  onClose: () => void;
  onRetry: () => void;
  initialTab?: "overview" | "finance";
  canRecordFinance?: boolean;
  canManage?: boolean;
  canTerminate?: boolean;
  busy?: boolean;
  onAction: (action: SaleWorkbenchAction) => void;
  onPrint: (contract: SaleContractRow) => void;
  embedded?: boolean;
  operationError?: string;
}) {
  const id = useId();
  const [tab, setTab] = useState<"overview" | "finance">(initialTab);
  const inspectorClass = cn(styles.inspector, embedded && styles.embeddedInspector);
  const text = (zh: string, fr: string) => (locale === "zh" ? zh : fr);
  if (!selectedId)
    return (
      <aside className={inspectorClass}>
        <div className={styles.empty}>
          <h2 className="mb-2 font-medium text-foreground">
            {text("沿一笔出售查看履约", "Suivre une vente")}
          </h2>
          {text(
            "选中左侧合同，查看分期、付款事实和过户。详情按需读取，不读取全部历史。",
            "Sélectionnez un contrat pour consulter ses échéances, ses paiements et son transfert.",
          )}
        </div>
      </aside>
    );
  if (loading || error || !data)
    return (
      <aside className={inspectorClass} aria-busy={loading}>
        <div className={styles.empty} role={error ? "alert" : "status"}>
          <p>
            {error
              ? text(
                  "本合同暂不可核验，未显示旧资料或零余额。",
                  "Contrat indisponible : anciennes données et faux soldes nuls masqués.",
                )
              : text("正在读取本合同…", "Chargement du contrat…")}
          </p>
          {error ? (
            <Button variant="outline" size="sm" className="mt-3" onClick={onRetry}>
              {text("重试读取", "Réessayer")}
            </Button>
          ) : null}
          {!embedded ? (
            <Button variant="ghost" size="sm" className="mt-3" onClick={onClose}>
              {text("关闭", "Fermer")}
            </Button>
          ) : null}
          {operationError ? (
            <p role="alert" className="mt-3 text-sm text-red-700">
              {operationError}
            </p>
          ) : null}
        </div>
      </aside>
    );
  const contract = data.contracts.find((row) => row.id === selectedId) as
    SaleContractRow | undefined;
  if (!contract)
    return (
      <aside className={inspectorClass}>
        <div className={styles.empty} role="alert">
          {text("本合同不在当前可核验范围。", "Contrat hors du périmètre vérifiable.")}
        </div>
      </aside>
    );
  const unit = data.units.find((row) => row.id === contract.unit_id),
    customer = data.customers.find((row) => row.id === contract.customer_id),
    building = data.buildings.find((row) => row.id === unit?.building_id);
  const money = (amount: number | null | undefined) =>
    amount === null || amount === undefined
      ? text("待核对", "À vérifier")
      : formatContractXof(amount, locale);
  const summary = data.summaries[contract.id],
    known = !!summary?.count,
    price = saleRegisteredPrice(contract),
    registeredBalance = saleRegisteredBalance(contract),
    nativeSale = (contract.sale_currency ?? "XOF") !== "XOF";
  const payments = data.payments.filter((row) => row.source_id === contract.id);
  const purchaseReceipts = buildSalePurchaseReceiptSummary(contract, payments);
  const nativePurchaseReceiptIds = new Set(
    payments
      .filter(
        (payment) =>
          payment.native_settlement === true &&
          buildSalePurchaseReceiptSummary(contract, [payment]).amounts.length > 0,
      )
      .map((payment) => payment.id),
  );
  const cash = summarizeContractCash(
    payments.filter((payment) => !nativePurchaseReceiptIds.has(payment.id)),
  );
  const originalMoney = (value: NonNullable<ReturnType<typeof saleRegisteredPrice>>) =>
    `${formatMoney(value.amount, value.currency, locale)}${value.currency === "XOF" ? "" : ` ${value.currency}`}`;
  const registeredStatus = contract.registration_basis === "source_record";
  const stateLabel =
    dictionaries[locale].sales.contractStatus[
      contract.status as keyof typeof dictionaries.zh.sales.contractStatus
    ];
  const cnyReceived = payments
    .filter(
      (payment) =>
        payment.currency === "CNY" &&
        ["sale", "sale_contract", "property_fee", "parking_fee"].includes(payment.source_type) &&
        classifyContractCashPayment(payment).kind === "income",
    )
    .reduce((sum, payment) => sum + Number(payment.amount), 0);
  const paymentKindNames: Record<string, string> = {
    sale: text("房款收款", "Paiement du bien"),
    sale_contract: text("房款收款", "Paiement du bien"),
    sale_other_income: text("其他经营收款", "Autre encaissement"),
    sale_other_expense: text("其他经营支出", "Autre décaissement"),
    sale_registration_fee: text("注册金收款", "Frais d'inscription"),
    sale_agency_income: text("中介费收款", "Commission reçue"),
    sale_agency_expense: text("中介费支出", "Commission versée"),
    sale_refund: text("售款退款", "Remboursement du bien"),
    parking_fee: text("车位款收款", "Paiement parking"),
    property_fee: text("物业费收款", "Frais de copropriété"),
  };
  const schedules = data.schedules
    .filter((row) => row.sale_contract_id === contract.id)
    .sort((a, b) => a.installment_no - b.installment_no);
  const recs = data.receivables.filter(
    (row) => row.source_type === "sale_contract" && row.source_id === contract.id,
  );
  const nativeBillRecord =
    nativeSale && unit
      ? buildSaleRecordOverview({
          units: [unit],
          contracts: [contract],
          customers: customer ? [customer] : [],
          buildings: data.buildings,
          today: data.today,
          payments,
          receivables: recs,
          schedules,
        })[0]
      : null;
  const formalKnown = nativeSale ? nativeBillRecord?.outstandingNative != null : known;
  const formalBalanceLabel = nativeSale
    ? nativeBillRecord?.outstandingNative?.length
      ? nativeBillRecord.outstandingNative.map(originalMoney).join(" · ")
      : formalKnown
        ? text("已核账单已结清", "Créances vérifiées soldées")
        : text("暂无已核应收", "Aucune créance vérifiée")
    : known
      ? money(summary.outstanding)
      : text("暂无已核应收", "Aucune créance vérifiée");
  const nativePaidAmounts: SaleCurrencyAmount[] = [];
  const nativeOverdueAmounts: SaleCurrencyAmount[] = [];
  if (nativeSale && formalKnown)
    for (const row of recs.filter(
      (row) => row.status !== "cancelled" && (row.management_status ?? "managed") === "managed",
    )) {
      const currency = (row.currency ?? "XOF") as SaleCurrencyAmount["currency"],
        amount = Number(currency === "XOF" ? row.paid_amount_xof : row.paid_amount_native);
      const item = nativePaidAmounts.find((item) => item.currency === currency);
      if (item) item.amount = Math.round((item.amount + amount) * 100) / 100;
      else nativePaidAmounts.push({ currency, amount });
      const balance = Number(currency === "XOF" ? row.amount_xof : row.amount_native) - amount;
      if (balance > 0 && row.due_date < data.today) {
        const overdue = nativeOverdueAmounts.find((item) => item.currency === currency);
        if (overdue) overdue.amount = Math.round((overdue.amount + balance) * 100) / 100;
        else nativeOverdueAmounts.push({ currency, amount: balance });
      }
    }
  const customerHref = customer
    ? buildWorkbenchRecordHref({
        workspace: "customers",
        id: customer.id,
        locale,
        project: building?.project_id,
        returnTo,
      })
    : null;
  const unitHref = unit
    ? buildWorkbenchRecordHref({
        workspace: "units",
        id: unit.id,
        locale,
        project: building?.project_id,
        building: building?.id,
        returnTo,
      })
    : null;
  const transfer =
    (
      {
        not_started: text("未开始", "Non commencé"),
        in_progress: text("办理中", "En cours"),
        completed: text("已完成", "Terminé"),
      } as Record<string, string>
    )[contract.transfer_status] ?? text("待核对", "À vérifier");
  const tabs = [
    { id: "overview", label: text("概况", "Aperçu") },
    { id: "finance", label: text("收支明细", "Encaissements et dépenses") },
  ] as const;
  const stateLabels: Record<string, string> = {
    paid: text("已核销", "Rapprochée"),
    overdue: text("已逾期", "En retard"),
    pending: text("待付 / 未逾期", "À payer / non échue"),
    partial: text("部分核销 / 未逾期", "Partielle / non échue"),
    cancelled: text("已取消", "Annulée"),
    unverified: text("应收关联待核", "Créance à vérifier"),
  };
  return (
    <aside
      aria-label={text("出售合同履约详情", "Détails du contrat de vente")}
      className={inspectorClass}
    >
      <header className={styles.inspectorHeader}>
        <div className={styles.inspectorTop}>
          {!embedded ? (
            <div>
              <p className="mb-3 text-[11px] font-medium tracking-widest text-muted-foreground">
                {text("出售履约", "VENTE · EXÉCUTION")}
              </p>
              <h2>{unit?.unit_no ?? text("房源待核", "Lot à vérifier")}</h2>
            </div>
          ) : (
            <h2>{customer?.name ?? text("客户待核", "Client à vérifier")}</h2>
          )}
          {!embedded ? (
            <Button
              variant="ghost"
              size="icon"
              className="-mr-2 -mt-2 size-8"
              onClick={onClose}
              aria-label={text("关闭合同预览", "Fermer l’aperçu")}
            >
              <X aria-hidden="true" />
            </Button>
          ) : null}
        </div>
        {!embedded ? (
          <p className={styles.sub}>
            {building?.display_name ?? "—"} · {contract.contract_no}
          </p>
        ) : null}
        {!embedded ? (
          <p className="mt-3 text-sm font-medium">
            {customer?.name ?? text("客户待核", "Client à vérifier")}
          </p>
        ) : null}
        {customer?.phone ? (
          <p className="mt-1 text-sm text-muted-foreground">{customer.phone}</p>
        ) : null}
        <p className={styles.sub}>
          {registeredStatus ? text("按Excel登记", "Enregistré selon Excel") : stateLabel}
          {registeredStatus && contract.status !== "active" ? ` · ${stateLabel}` : ""} · {transfer}
        </p>
      </header>
      <div
        role="tablist"
        aria-label={text("出售详情内容", "Contenu du contrat")}
        className={styles.tabs}
      >
        {tabs.map((item) => (
          <button
            key={item.id}
            role="tab"
            id={`${id}-${item.id}`}
            aria-controls={`${id}-panel`}
            aria-selected={tab === item.id}
            tabIndex={tab === item.id ? 0 : -1}
            onClick={() => setTab(item.id)}
            onKeyDown={(event) => {
              if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
              event.preventDefault();
              const index = tabs.findIndex((t) => t.id === item.id);
              const next =
                event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? tabs.length - 1
                    : (index + (event.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length;
              setTab(tabs[next].id);
              document.getElementById(`${id}-${tabs[next].id}`)?.focus();
            }}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div
        role="tabpanel"
        id={`${id}-panel`}
        aria-labelledby={`${id}-${tab}`}
        className={styles.detail}
      >
        {tab === "overview" ? (
          <>
            <dl className={styles.facts}>
              <Fact label={text("登记总价", "Prix enregistré")}>
                {price ? originalMoney(price) : text("待核对", "À vérifier")}
              </Fact>
              <Fact label={text("房款原币实收", "Encaissements du bien par devise")}>
                {purchaseReceipts.amounts.length
                  ? purchaseReceipts.amounts.map(originalMoney).join(" · ")
                  : text("暂无已核房款实收", "Aucun encaissement du bien vérifié")}
              </Fact>
              <Fact
                label={
                  !formalKnown && registeredBalance
                    ? text("登记余款（Excel）", "Solde enregistré (Excel)")
                    : text("已核未收", "Créances vérifiées restantes")
                }
              >
                {formalKnown
                  ? formalBalanceLabel
                  : registeredBalance
                    ? originalMoney(registeredBalance)
                    : text("暂无已核应收", "Aucune créance vérifiée")}
              </Fact>
              <Fact label={text("过户阶段", "Transfert")}>{transfer}</Fact>
            </dl>
            <details className={styles.secondaryDetails}>
              <summary>{text("合同登记资料", "Informations enregistrées du contrat")}</summary>
              <dl className={styles.facts}>
                <Fact label={text("签约日期", "Signature")}>
                  {contract.signed_date || text("未登记", "Non renseignée")}
                </Fact>
                {registeredStatus ? (
                  <Fact label={text("登记依据", "Source de l’enregistrement")}>
                    {contract.source_reference || text("未登记", "Non renseignée")}
                  </Fact>
                ) : null}
                <Fact label={text("付款方式", "Plan")}>
                  {dictionaries[locale].sales.paymentPlan[
                    contract.payment_plan_type as keyof typeof dictionaries.zh.sales.paymentPlan
                  ] ?? text("待核对", "À vérifier")}
                </Fact>
                <Fact label={text("合同编号", "Référence")}>
                  {contract.contract_no || text("未登记", "Non renseignée")}
                </Fact>
                <Fact label={text("过户日期", "Date du transfert")}>
                  {contract.transfer_date ?? text("未登记", "Non renseignée")}
                </Fact>
                <Fact label={text("产权证号", "Titre foncier")}>
                  {contract.title_certificate_no || text("未登记", "Non renseigné")}
                </Fact>
                <Fact label={text("中介公司", "Agence")}>
                  {contract.agency_company || text("未登记", "Non renseignée")}
                </Fact>
                <Fact label={text("中介经办", "Intermédiaire")}>
                  {contract.agent_name || text("未登记", "Non renseigné")}
                </Fact>
                <Fact label={text("合同佣金", "Commission contractuelle")}>
                  {money(contract.agency_commission_amount_xof)}
                </Fact>
                <Fact label={text("合同佣金标注", "Mention de commission")}>
                  {contract.agency_commission_paid
                    ? text("合同标注已付", "Mention payée")
                    : text("未标注已付", "Non marquée payée")}
                </Fact>
              </dl>
              <p className={styles.sub}>
                {text(
                  "合同标注不代替财务凭证；过户阶段不代表付款状态。",
                  "Les mentions contractuelles ne remplacent pas les justificatifs ; le transfert n’est pas un statut de paiement.",
                )}
              </p>
            </details>
            <h3 className="mt-5">{text("付款计划", "Plan de paiement")}</h3>
            {schedules.length ? (
              schedules.map((schedule) => {
                const state = saleScheduleState(schedule, recs, data.today);
                const receivable = saleScheduleReceivable(schedule, recs);
                return (
                  <div className={styles.schedule} key={schedule.id}>
                    <div className={styles.scheduleHead}>
                      <span>
                        {text(
                          `第 ${schedule.installment_no} 期`,
                          `Échéance ${schedule.installment_no}`,
                        )}
                      </span>
                      <span className={styles.money}>{money(Number(schedule.amount_xof))}</span>
                    </div>
                    <p className={styles.sub}>
                      {schedule.due_date} ·{" "}
                      <span className={state === "overdue" ? styles.alert : undefined}>
                        {stateLabels[state]}
                      </span>
                    </p>
                    {receivable?.title ? <p className={styles.sub}>{receivable.title}</p> : null}
                    {receivable && Number(receivable.paid_amount_xof) > 0 ? (
                      <p className={styles.sub}>
                        {text("已核销", "Rapprochée")} · {money(Number(receivable.paid_amount_xof))}
                      </p>
                    ) : null}
                  </div>
                );
              })
            ) : (
              <p className={styles.note}>
                {text(
                  "暂无已登记付款计划，不代表已付款。",
                  "Aucun plan enregistré ; cela ne confirme pas un règlement.",
                )}
              </p>
            )}
          </>
        ) : tab === "finance" ? (
          <>
            <h3>{text("房款原币实收", "Encaissements du bien par devise")}</h3>
            <p className="mb-3 text-sm font-medium">
              {purchaseReceipts.amounts.length
                ? purchaseReceipts.amounts.map(originalMoney).join(" · ")
                : text("暂无已核房款实收", "Aucun encaissement du bien vérifié")}
            </p>
            {nativeSale ? (
              <p className={styles.sub}>
                {text(
                  "原币房款未折算西法，不能与西法金额相加。",
                  "Les encaissements en devise ne sont pas convertis en XOF et ne s’y additionnent pas.",
                )}
              </p>
            ) : null}
            <h3>{text("已核应收", "Créances vérifiées")}</h3>
            <dl className={styles.facts}>
              <Fact label={text("已建应收未收", "Créances restantes")}>
                {formalKnown ? formalBalanceLabel : text("暂无已核应收", "Aucune créance vérifiée")}
              </Fact>
              <Fact label={text("其中已逾期", "Dont en retard")}>
                {nativeSale
                  ? formalKnown
                    ? nativeOverdueAmounts.length
                      ? nativeOverdueAmounts.map(originalMoney).join(" · ")
                      : text("已核账单无逾期", "Aucun retard vérifié")
                    : "—"
                  : known
                    ? money(summary.overdue)
                    : "—"}
              </Fact>
              <Fact label={text("应收已核销", "Créances rapprochées")}>
                {nativeSale
                  ? formalKnown
                    ? nativePaidAmounts.map(originalMoney).join(" · ")
                    : "—"
                  : known
                    ? money(summary.paid)
                    : "—"}
              </Fact>
            </dl>
            <p className={styles.sub}>
              {text(
                "应收核销与现金实收分别核对，未建已核应收不代表没有欠款。",
                "Créances rapprochées et encaissements restent distincts. L’absence de créance vérifiée ne prouve pas l’absence de dette.",
              )}
            </p>
            <h3 className="mt-5">{text("已录付款事实", "Paiements enregistrés")}</h3>
            <dl className={styles.facts}>
              <Fact
                label={
                  nativeSale
                    ? text("西法经营收款", "Encaissements en XOF")
                    : text("经营收款", "Encaissements")
                }
              >
                {payments.some((p) => classifyContractCashPayment(p).kind === "income")
                  ? money(cash.income)
                  : text("暂无已核记录", "Aucune écriture vérifiée")}
              </Fact>
              <Fact
                label={
                  nativeSale
                    ? text("西法经营支出", "Décaissements en XOF")
                    : text("经营支出", "Décaissements")
                }
              >
                {payments.some((p) => classifyContractCashPayment(p).kind === "expense")
                  ? money(cash.expense)
                  : text("暂无已核记录", "Aucune écriture vérifiée")}
              </Fact>
              <Fact
                label={
                  nativeSale
                    ? text("西法现金净额", "Flux net en XOF")
                    : text("经营现金净额", "Flux de caisse net")
                }
              >
                {payments.some((p) =>
                  ["income", "expense"].includes(classifyContractCashPayment(p).kind),
                )
                  ? money(cash.net)
                  : text("暂无已核记录", "Aucune écriture vérifiée")}
              </Fact>
            </dl>
            {cnyReceived > 0 ? (
              <p className={styles.sub}>
                {text("其中已录人民币收款", "Dont encaissements CNY")}{" "}
                {formatMoney(cnyReceived, "CNY", locale)}
              </p>
            ) : null}
            {contract.agency_commission_paid ? (
              <p className={styles.sub}>
                {text(
                  "合同佣金标注不代替逐笔现金支出。",
                  "La mention de commission ne remplace pas une écriture de caisse.",
                )}
              </p>
            ) : null}
            <p className={styles.callout}>
              {text(
                "非现金抵扣不计作实收；实收人、合同经办和录入账号不能互相代替。",
                "Les compensations ne sont pas du cash. L’encaisseur, l’intermédiaire et le compte de saisie sont distincts.",
              )}
              {cash.excludedCount || cash.nonCashCount
                ? text(
                    ` ${cash.excludedCount} 笔待核、${cash.nonCashCount} 笔非现金变动。`,
                    ` ${cash.excludedCount} à vérifier, ${cash.nonCashCount} hors caisse.`,
                  )
                : ""}
            </p>
            {[...payments]
              .sort(
                (a, b) =>
                  b.payment_date.localeCompare(a.payment_date) ||
                  b.created_at.localeCompare(a.created_at),
              )
              .map((payment) => {
                const classification = classifyContractCashPayment(payment);
                const nativePurchaseReceipt = nativePurchaseReceiptIds.has(payment.id);
                return (
                  <article className={styles.schedule} key={payment.id}>
                    <div className={styles.scheduleHead}>
                      <span>{payment.payment_date}</span>
                      <strong>
                        {classification.kind === "expense" ? "− " : ""}
                        {formatMoney(Number(payment.amount), payment.currency, locale)}
                      </strong>
                    </div>
                    {payment.currency !== "XOF" && classification.amountXof !== null ? (
                      <p className={styles.sub}>
                        {text("折合", "Soit")} {money(classification.amountXof)}
                      </p>
                    ) : null}
                    <p className={styles.sub}>
                      {payment.native_settlement
                        ? nativePurchaseReceipt
                          ? text(
                              "原币房款实收 · 未折算西法",
                              "Encaissement du bien en devise · sans conversion XOF",
                            )
                          : text(
                              "原币登记待核 · 未折算西法",
                              "Devise enregistrée à vérifier · sans conversion XOF",
                            )
                        : (paymentKindNames[payment.source_type] ??
                          text("待核对财务记录", "Écriture à vérifier"))}
                      {classification.kind === "excluded" && !payment.native_settlement
                        ? ` · ${text("不计入现金汇总", "Hors synthèse de caisse")}`
                        : ""}
                    </p>
                    {payment.actual_collector ? (
                      <p className={styles.sub}>
                        {text("实际收款人", "Encaisseur")}: {payment.actual_collector}
                      </p>
                    ) : null}
                    <details className={styles.paymentSourceDetails}>
                      <summary>
                        {text("来源和登记信息", "Source et informations enregistrées")}
                      </summary>
                      {!payment.actual_collector ? (
                        <p className={styles.sub}>
                          {text("实际收款人", "Encaisseur")}: {text("待核对", "À vérifier")}
                        </p>
                      ) : null}
                      <p className={styles.sub}>
                        {text("录入账号", "Compte de saisie")}:{" "}
                        {payment.recorded_by
                          ? text("已记录，见审计详情", "Enregistré, voir l’audit")
                          : text("未登记", "Non renseigné")}
                      </p>
                      {payment.notes ? <p className={styles.sub}>{payment.notes}</p> : null}
                      {payment.receipt_no ? (
                        <p className={styles.sub}>
                          {text("凭证", "Référence")}: {payment.receipt_no}
                        </p>
                      ) : null}
                      {payment.external_receipt_no ? (
                        <p className={styles.sub}>
                          {text("外部凭证", "Référence externe")}: {payment.external_receipt_no}
                        </p>
                      ) : null}
                      {payment.collector_basis ? (
                        <p className={styles.sub}>
                          {text("收款人依据", "Justification de l’encaisseur")}:{" "}
                          {payment.collector_basis}
                        </p>
                      ) : null}
                      <p className={styles.sub}>
                        {text("收款方式", "Mode de paiement")}:{" "}
                        {payment.payment_method || text("未登记", "Non renseigné")}
                      </p>
                    </details>
                  </article>
                );
              })}
            {!payments.length ? (
              <p className="py-5 text-xs text-muted-foreground">
                {text("暂无逐笔付款记录。", "Aucun paiement détaillé.")}
              </p>
            ) : null}
          </>
        ) : null}
        <div className={styles.links}>
          {customerHref ? (
            <Link prefetch={false} href={customerHref}>
              {text("客户档案", "Fiche client")} ↗
            </Link>
          ) : null}
          {unitHref ? (
            <Link prefetch={false} href={unitHref}>
              {text("资产档案", "Fiche du lot")} ↗
            </Link>
          ) : null}
        </div>
      </div>
      <footer className={styles.detailActions}>
        {operationError ? (
          <p role="alert" className="text-sm text-red-700">
            {operationError}
          </p>
        ) : null}
        <details className={styles.secondaryDetails}>
          <summary>{text("更多操作", "Autres opérations")}</summary>
          <fieldset disabled={busy} className="mt-3 grid gap-2">
            {nativeSale ? (
              <p className={styles.sub}>
                {text(
                  "原币登记仅供查看核对，此处不支持手工西法收款或新增西法分期。",
                  "Dossier en devise consultable ; la saisie d’un encaissement ou d’une échéance en XOF n’est pas disponible ici.",
                )}
              </p>
            ) : null}
            {contract.status === "active" ? (
              <div
                className={styles.operationActions}
                aria-label={text("办理此合同", "Gérer ce contrat")}
              >
                {canRecordFinance ? (
                  <Button
                    type="button"
                    size="sm"
                    disabled={busy || nativeSale}
                    onClick={() => onAction("payment")}
                  >
                    <DollarSign aria-hidden="true" />
                    {text("手工登记出售收款", "Saisir manuellement un paiement de vente")}
                  </Button>
                ) : null}
                {canManage ? (
                  <>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={busy || nativeSale}
                      onClick={() => onAction("installment")}
                    >
                      <CalendarPlus aria-hidden="true" />
                      {text("新增分期", "Ajouter une échéance")}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() => onAction("transfer")}
                    >
                      <TrendingUp aria-hidden="true" />
                      {text("更新过户", "Mettre à jour le transfert")}
                    </Button>
                  </>
                ) : null}
                {canTerminate ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => onAction("terminate")}
                  >
                    <AlertTriangle aria-hidden="true" />
                    {text("终止合同", "Résilier le contrat")}
                  </Button>
                ) : null}
              </div>
            ) : null}
            <Button
              type="button"
              variant="ghost"
              className="w-full text-xs"
              disabled={busy || registeredStatus || nativeSale || !contract.signed_date}
              onClick={() => onPrint(contract)}
            >
              <Printer aria-hidden="true" />
              {text("打印登记合同", "Imprimer le contrat enregistré")}
            </Button>
            {registeredStatus || nativeSale || !contract.signed_date ? (
              <p className={styles.sub}>
                {text(
                  "此初始登记暂无可打印的合同，现有资料仍可查看核对。",
                  "Aucun contrat imprimable pour cet enregistrement initial ; le dossier reste consultable.",
                )}
              </p>
            ) : null}
          </fieldset>
        </details>
      </footer>
    </aside>
  );
}
