"use client";
import Link from "next/link";
import { leaseRentLabel } from "@/lib/native-money";
import { paymentDisplay } from "@/lib/currency";
import { NativeLeaseFinance } from "./native-lease-finance";

import { useId, useState, type KeyboardEvent, type ReactNode } from "react";
import { ArrowUpRight, Building2, CalendarDays, FileText, Printer, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  buildContractReceivableSummaries,
  formatContractXof,
  type ContractReceivableSummary,
} from "@/features/contracts/contract-list-model";
import {
  classifyContractCashPayment,
  summarizeContractCash,
} from "@/features/contracts/contract-cash-model";
import { addIsoDays } from "@/features/finance/metrics";
import { dictionaries, type Locale } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type {
  CustomerRow,
  LeaseContractRow,
  PaymentRow,
  ReceivableRow,
  UnitRow,
} from "@/types/database";

export interface LeaseWorkbenchInspectorProps {
  contract: LeaseContractRow | null;
  unit?: UnitRow | null;
  customer?: CustomerRow | null;
  buildingLabel?: string;
  summary?: ContractReceivableSummary | null;
  payments: PaymentRow[];
  receivables: ReceivableRow[];
  locale: Locale;
  today: string;
  /** Detail reads must complete before payment / receivable figures are displayed. */
  loading?: boolean;
  /** A failed read must never leave a prior contract's data or actions available. */
  error?: boolean;
  onOpen: (section?: "overview" | "finance") => void;
  onPrint: () => void;
  onClose?: () => void;
  /** Supplied only to roles permitted to collect, for this exact active contract. */
  collectionHref?: string | null;
}

type InspectorTab = "contract" | "finance" | "records";

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)] gap-3 py-2.5 text-[13px]">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="break-words text-right font-medium tabular-nums">{children}</dd>
    </div>
  );
}

/** A read-only companion to the existing contract drawer. No write action lives here. */
export function LeaseWorkbenchInspector(props: LeaseWorkbenchInspectorProps) {
  // Switching contracts also resets the local preview tab, without a sync effect.
  return <InspectorContent key={props.contract?.id ?? "empty"} {...props} />;
}

function InspectorContent({
  contract,
  unit,
  customer,
  buildingLabel,
  summary,
  payments,
  receivables,
  locale,
  today,
  loading = false,
  error = false,
  onOpen,
  onPrint,
  onClose,
  collectionHref,
}: LeaseWorkbenchInspectorProps) {
  const [tab, setTab] = useState<InspectorTab>("contract");
  const id = useId();
  const zh = locale === "zh";
  const text = (chinese: string, french: string) => (zh ? chinese : french);
  const money = (value: number | null | undefined) => formatContractXof(value, locale);
  const tabs: { id: InspectorTab; label: string }[] = [
    { id: "contract", label: text("合同", "Contrat") },
    { id: "finance", label: text("账务", "Finances") },
    { id: "records", label: text("记录", "Écritures") },
  ];

  function moveTab(event: KeyboardEvent<HTMLButtonElement>, current: InspectorTab) {
    const position = tabs.findIndex((item) => item.id === current);
    let next = position;
    if (event.key === "ArrowRight") next = (position + 1) % tabs.length;
    else if (event.key === "ArrowLeft") next = (position + tabs.length - 1) % tabs.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = tabs.length - 1;
    else return;
    event.preventDefault();
    setTab(tabs[next].id);
    event.currentTarget.parentElement
      ?.querySelectorAll<HTMLButtonElement>("[role=tab]")
      [next]?.focus();
  }

  if (!contract || error || loading) {
    return (
      <aside
        aria-label={text("合同预览", "Aperçu du contrat")}
        aria-busy={loading}
        className="min-w-0 rounded-2xl border border-border/75 bg-card p-6"
      >
        <div className="flex min-h-64 flex-col items-center justify-center text-center">
          <div className="mb-4 rounded-2xl bg-blue-50 p-3 text-blue-600 dark:bg-blue-950/50 dark:text-blue-300">
            <FileText className="size-6" aria-hidden="true" />
          </div>
          <h2
            className="text-sm font-semibold"
            role={error ? "alert" : loading ? "status" : undefined}
          >
            {error
              ? text("合同暂时无法核验", "Contrat momentanément indisponible")
              : loading
                ? text("正在读取合同…", "Chargement du contrat…")
                : text("选一份合同，展开工作", "Choisissez un contrat")}
          </h2>
          <p className="mt-2 max-w-64 text-xs leading-6 text-muted-foreground">
            {error
              ? text(
                  "未展示旧合同与旧金额，请重新选择或稍后重试。",
                  "Aucun ancien contrat ou montant n’est affiché. Réessayez après avoir sélectionné le contrat.",
                )
              : loading
                ? text(
                    "核对租期与实时账务后再显示预览。",
                    "Vérification de la location et des écritures avant affichage.",
                  )
                : text(
                    "点击列表中的房源，先看租期与账务；需要办理时再打开完整详情。",
                    "Sélectionnez un lot pour consulter sa location et ses finances avant d’ouvrir le dossier complet.",
                  )}
          </p>
        </div>
      </aside>
    );
  }

  const contractPayments = payments.filter((payment) => payment.source_id === contract.id);
  const contractReceivables = receivables.filter(
    (row) => row.source_type === "lease_contract" && row.source_id === contract.id,
  );
  const financialSummary =
    summary ??
    buildContractReceivableSummaries(contractReceivables, "lease_contract", today).get(contract.id);
  const receivablesKnown = !loading && !!financialSummary && financialSummary.count > 0;
  const cash = summarizeContractCash(contractPayments);
  const cashLines = contractPayments.map(classifyContractCashPayment);
  const hasIncome = cashLines.some((line) => line.kind === "income");
  const hasExpense = cashLines.some((line) => line.kind === "expense");
  const hasDepositIn = cashLines.some((line) => line.kind === "deposit_in");
  const hasDepositOut = cashLines.some((line) => line.kind === "deposit_out");
  const depositNeedsReview =
    contract.deposit_received !== hasDepositIn ||
    cash.depositOut > cash.depositIn ||
    contractPayments.some(
      (payment) =>
        payment.source_type.startsWith("lease_deposit") &&
        classifyContractCashPayment(payment).kind === "excluded",
    );
  const endKnown = !!contract.expected_end_date && contract.expected_end_confirmed !== false;
  const endLabel = !endKnown
    ? text("待确认", "À confirmer")
    : contract.expected_end_date >= "2099-01-01"
      ? text("长期", "Long terme")
      : contract.expected_end_date;
  const contractStatus = dictionaries[locale].leases.contractStatus;
  const cycleLabels = dictionaries[locale].leases.paymentCycle;
  const status =
    contractStatus[contract.status as keyof typeof contractStatus] ?? text("待核对", "À vérifier");
  const cycle =
    cycleLabels[contract.payment_cycle as keyof typeof cycleLabels] ??
    text("待确认", "À confirmer");
  const recentPayments = [...contractPayments]
    .sort(
      (left, right) =>
        right.payment_date.localeCompare(left.payment_date) ||
        right.created_at.localeCompare(left.created_at),
    )
    .slice(0, 6);
  const categories = dictionaries[locale].finance.categories;
  const noCash = text("暂无已核记录", "Aucune écriture vérifiée");
  const suggestion =
    receivablesKnown && financialSummary!.overdue > 0
      ? {
          title: text("核对逾期应收与实收", "Vérifier les impayés et les encaissements"),
          detail: text(
            "先核实收款凭证与应收核销情况，再打开完整账务跟进。",
            "Vérifiez les justificatifs et le rapprochement des créances avant de poursuivre dans le dossier complet.",
          ),
        }
      : contract.status === "draft" || !contract.start_date || !endKnown
        ? {
            title: text("核实合同资料", "Vérifier les informations du contrat"),
            detail: text(
              "先核对客户、合同日期与约定，再在原流程中办理。",
              "Confirmez le client, les dates et les conditions avant toute opération dans le dossier complet.",
            ),
          }
        : contract.status === "active" &&
            contract.expected_end_date < "2099-01-01" &&
            contract.expected_end_date <= addIsoDays(today, 30)
          ? {
              title: text("确认续租 / 退租安排", "Confirmer la suite du bail"),
              detail: text(
                "合同已到期或将在 30 天内到期，不代表已经退租；请先确认客户安排。",
                "Le bail est échu ou arrive à échéance sous 30 jours. Cela ne confirme pas une sortie ; vérifiez les dispositions avec le client.",
              ),
            }
          : {
              title: text("查看合同与账务", "Consulter le contrat et les écritures"),
              detail: text(
                "这里仅供核对；需要办理时，打开完整详情进入原流程。",
                "Cet aperçu est en lecture seule. Ouvrez le dossier complet pour toute opération.",
              ),
            };

  return (
    <aside
      aria-label={text("合同预览", "Aperçu du contrat")}
      aria-busy={loading}
      className="min-w-0 overflow-hidden rounded-2xl border border-border/75 bg-card"
    >
      <div className="border-b border-blue-100/80 bg-blue-50/65 px-5 pb-4 pt-5 dark:border-blue-900/50 dark:bg-blue-950/25">
        <div className="mb-4 flex items-start justify-between gap-2">
          <span className="text-[11px] font-medium tracking-[0.1em] text-blue-600 dark:text-blue-300">
            {text("合同速览", "APERÇU DU CONTRAT")}
          </span>
          {onClose ? (
            <Button
              variant="ghost"
              size="icon"
              className="-mr-2 -mt-2 size-8"
              aria-label={text("关闭预览", "Fermer l’aperçu")}
              onClick={onClose}
            >
              <X aria-hidden="true" />
            </Button>
          ) : null}
        </div>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="break-words text-xl font-semibold tracking-tight">
              {unit?.unit_no ?? text("房源待核对", "Lot à vérifier")}
            </h2>
            <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
              <Building2 className="size-3.5 shrink-0" aria-hidden="true" />
              <span className="break-words">
                {buildingLabel || text("楼栋待核对", "Immeuble à vérifier")}
              </span>
            </p>
          </div>
          <span className="shrink-0 rounded-full border border-border/70 bg-card px-2.5 py-1 text-[11px] font-medium">
            {status}
          </span>
        </div>
        <p className="mt-4 break-words text-sm font-medium">
          {customer?.name || text("客户资料待补充", "Client à compléter")}
        </p>
        <p className="mt-1 break-all text-xs text-muted-foreground">{contract.contract_no}</p>
      </div>

      <div
        role="tablist"
        aria-label={text("合同预览内容", "Détails de l’aperçu")}
        className="grid grid-cols-3 border-b px-4"
      >
        {tabs.map((item) => (
          <button
            key={item.id}
            id={`${id}-tab-${item.id}`}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            aria-controls={`${id}-panel`}
            tabIndex={tab === item.id ? 0 : -1}
            onClick={() => setTab(item.id)}
            onKeyDown={(event) => moveTab(event, item.id)}
            className={cn(
              "min-h-11 border-b-2 px-2 text-xs font-medium outline-offset-[-3px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring",
              tab === item.id
                ? "border-blue-600 text-blue-700 dark:text-blue-300"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div
        id={`${id}-panel`}
        role="tabpanel"
        aria-labelledby={`${id}-tab-${tab}`}
        className="min-h-72 px-5 py-4"
      >
        <NativeLeaseFinance
          contract={contract}
          payments={contractPayments}
          receivables={contractReceivables}
          locale={locale}
          today={today}
        />
        {tab === "contract" ? (
          <>
            <div className="flex items-center gap-2 text-xs font-semibold">
              <CalendarDays className="size-4 text-muted-foreground" aria-hidden="true" />
              {text("租约信息", "Conditions de location")}
            </div>
            <dl className="mt-2 divide-y divide-border/60">
              <Fact label={text("起租日期", "Début")}>
                {contract.start_date || text("待确认", "À confirmer")}
              </Fact>
              <Fact label={text("预计到期", "Fin prévue")}>{endLabel}</Fact>
              {contract.expected_end_date >= "2099-01-01" ? (
                <Fact label={text("原登记日期", "Date enregistrée")}>
                  {contract.expected_end_date}
                </Fact>
              ) : null}
              {contract.actual_end_date ? (
                <Fact label={text("实际结束", "Fin réelle")}>{contract.actual_end_date}</Fact>
              ) : null}
              <Fact label={text("月租金", "Loyer mensuel")}>
                {leaseRentLabel(contract, locale)}
              </Fact>
              <Fact label={text("支付周期", "Règlement")}>{cycle}</Fact>
              <Fact label={text("登记覆盖至", "Couverture enregistrée jusqu’au")}>
                {contract.paid_through_date || text("未登记", "Non renseigné")}
              </Fact>
              <Fact label={text("约定押金", "Caution contractuelle")}>
                {money(contract.deposit_amount_xof)}
              </Fact>
            </dl>
            <p className="mt-3 rounded-lg bg-muted/45 px-3 py-2.5 text-xs leading-5 text-muted-foreground">
              {text(
                "合同到期不等于已退租；约定押金不等于实收或可退金额。登记覆盖日不等于当前欠款；实收核销与覆盖确认分别核对。",
                "La fin prévue ne confirme pas une sortie. La caution prévue n’est ni un encaissement ni un montant remboursable. La couverture enregistrée ne prouve pas un impayé actuel ; encaissement et couverture sont distincts.",
              )}
            </p>
          </>
        ) : loading ? (
          <p role="status" className="py-8 text-center text-sm text-muted-foreground">
            {text("正在读取本合同账务…", "Chargement des écritures…")}
          </p>
        ) : tab === "finance" ? (
          <>
            <div className="rounded-xl border border-border/75 bg-muted/20 p-3.5">
              <p className="text-xs text-muted-foreground">
                {text("已核应收 · 当前未收", "Créances vérifiées · Solde actuel")}
              </p>
              <p
                className={cn(
                  "mt-2 break-words text-xl font-semibold tabular-nums",
                  receivablesKnown && financialSummary!.outstanding > 0
                    ? "text-amber-700 dark:text-amber-300"
                    : "text-foreground",
                )}
              >
                {receivablesKnown ? money(financialSummary!.outstanding) : "—"}
              </p>
              <p className="mt-1.5 text-xs leading-5 text-muted-foreground">
                {receivablesKnown
                  ? text(
                      `已纳管 ${financialSummary!.count} 笔应收；不含待核历史。`,
                      `${financialSummary!.count} créances suivies, hors historique à vérifier.`,
                    )
                  : text(
                      "未有已核应收，不代表没有欠款。",
                      "Aucune créance vérifiée ne signifie pas aucune dette.",
                    )}
              </p>
            </div>
            <dl className="mt-2 divide-y divide-border/60">
              <Fact label={text("其中已逾期", "Dont en retard")}>
                {receivablesKnown ? money(financialSummary!.overdue) : "—"}
              </Fact>
              <Fact label={text("最早未结到期", "Première échéance ouverte")}>
                {receivablesKnown && financialSummary!.nextDue ? financialSummary!.nextDue : "—"}
              </Fact>
              <Fact label={text("应收已核销", "Créances rapprochées")}>
                {receivablesKnown ? money(financialSummary!.paid) : "—"}
              </Fact>
              <Fact label={text("已录经营收款", "Encaissements enregistrés")}>
                {hasIncome ? money(cash.income) : noCash}
              </Fact>
              <Fact label={text("已录经营支出", "Décaissements enregistrés")}>
                {hasExpense ? money(cash.expense) : noCash}
              </Fact>
            </dl>
            <p className="mt-2 text-xs leading-5 text-muted-foreground">
              {text(
                "应收核销与现金收款是不同口径；非现金抵扣不计入经营收款。",
                "Le rapprochement des créances est distinct des encaissements. Les compensations ne sont pas du cash.",
              )}
            </p>
            <div className="mt-4 border-t pt-3">
              <h3 className="text-xs font-semibold">
                {text("押金独立核对", "Caution · Suivi distinct")}
              </h3>
              <dl className="mt-1 divide-y divide-border/60">
                <Fact label={text("已录押金实收", "Caution encaissée")}>
                  {hasDepositIn ? money(cash.depositIn) : noCash}
                </Fact>
                <Fact label={text("已录押金实退", "Caution remboursée")}>
                  {hasDepositOut ? money(cash.depositOut) : noCash}
                </Fact>
              </dl>
              <p className="text-xs leading-5 text-muted-foreground">
                {text(
                  "不计入经营收入；可退金额需在退租结算中核实扣减与原始凭证。",
                  "Hors recettes d’exploitation. Le remboursement nécessite de vérifier les retenues et les justificatifs lors de la sortie.",
                )}
              </p>
              {depositNeedsReview ? (
                <p className="mt-2 text-xs leading-5 text-amber-700 dark:text-amber-300">
                  {text(
                    "押金标记与已录收退记录存在待核差异，请核对后办理。",
                    "Écart à vérifier entre l’indicateur de caution et les écritures enregistrées.",
                  )}
                </p>
              ) : null}
            </div>
            {cash.excludedCount > 0 || cash.nonCashCount > 0 ? (
              <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2.5 text-xs leading-5 text-amber-800 dark:bg-amber-950/25 dark:text-amber-300">
                {text(
                  `${cash.excludedCount} 笔待核记录未计入现金汇总；${cash.nonCashCount} 笔非现金变动。`,
                  `${cash.excludedCount} écritures à vérifier exclues du cash ; ${cash.nonCashCount} mouvements hors caisse.`,
                )}
              </p>
            ) : null}
          </>
        ) : (
          <>
            <p className="mb-3 text-xs leading-5 text-muted-foreground">
              {text(
                "最近登记的财务记录，不等于完整操作审计；操作身份以审计日志为准。",
                "Dernières écritures financières, pas un journal d’audit complet. L’identité de l’opérateur se vérifie dans l’audit.",
              )}
            </p>
            {recentPayments.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                {text("暂无财务记录", "Aucune écriture financière")}
              </p>
            ) : (
              <ol className="divide-y divide-border/60">
                {recentPayments.map((payment) => {
                  const line = classifyContractCashPayment(payment);
                  const label =
                    categories[payment.source_type as keyof typeof categories] ??
                    text("其他财务记录", "Autre écriture");
                  const sign = line.kind === "expense" || line.kind === "deposit_out" ? "−" : "+";
                  return (
                    <li key={payment.id} className="py-3 first:pt-0">
                      <div className="flex items-start justify-between gap-3 text-xs">
                        <p className="min-w-0 break-words font-medium">{label}</p>
                        <span className="shrink-0 tabular-nums text-muted-foreground">
                          {payment.payment_date}
                        </span>
                      </div>
                      <p className="mt-1.5 text-sm font-semibold tabular-nums">
                        {payment.native_settlement
                          ? paymentDisplay(payment, locale).primary
                          : line.kind === "excluded"
                            ? line.reason === "non_cash_offset"
                              ? text("非现金抵扣", "Compensation hors caisse")
                              : text("待核对，不计入现金", "À vérifier, exclu du cash")
                            : `${sign}${money(line.amountXof)}`}
                      </p>
                      <p className="mt-1 break-words text-xs leading-5 text-muted-foreground">
                        {text("实收人", "Encaisseur")}:{" "}
                        {payment.actual_collector || text("待核对", "À vérifier")}
                        {payment.receipt_no ? ` · ${payment.receipt_no}` : ""}
                      </p>
                    </li>
                  );
                })}
              </ol>
            )}
            {contractPayments.length > recentPayments.length ? (
              <p className="mt-2 text-xs text-muted-foreground">
                {text(
                  "仅显示最近 6 笔，其余见完整财务记录。",
                  "Les 6 dernières écritures sont affichées. Consultez le dossier pour la suite.",
                )}
              </p>
            ) : null}
          </>
        )}
      </div>

      <div className="space-y-2 border-t bg-muted/15 p-4">
        {contract.status === "active" && collectionHref ? (
          <Link
            href={collectionHref}
            className="flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
          >
            {text("登记实际收款", "Enregistrer un encaissement")}
            <ArrowUpRight className="size-4" aria-hidden="true" />
          </Link>
        ) : null}
        <section aria-label={text("建议下一步", "Prochaine étape suggérée")} className="pb-2">
          <h3 className="text-[11px] font-medium text-muted-foreground">
            {text("建议下一步", "Prochaine étape suggérée")}
          </h3>
          <p className="mt-1.5 text-[13px] font-medium leading-5">{suggestion.title}</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">{suggestion.detail}</p>
        </section>
        <Button
          type="button"
          variant="outline"
          className="min-h-10 w-full border-blue-200/80 text-blue-700 hover:bg-blue-50 dark:border-blue-800 dark:text-blue-300 dark:hover:bg-blue-950/50"
          onClick={() => onOpen(tab === "contract" ? "overview" : "finance")}
        >
          {tab === "contract"
            ? text("打开合同详情 / 办理", "Ouvrir le dossier / Gérer")
            : text("打开完整财务记录", "Ouvrir les écritures complètes")}
          <ArrowUpRight aria-hidden="true" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="min-h-10 w-full text-xs"
          onClick={onPrint}
          disabled={loading}
        >
          <Printer aria-hidden="true" />
          {text("合同 / 打印", "Contrat / Imprimer")}
        </Button>
      </div>
    </aside>
  );
}
