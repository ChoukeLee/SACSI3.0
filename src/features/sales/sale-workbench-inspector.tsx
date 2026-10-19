"use client";

import { useId, useState, type ReactNode } from "react";
import Link from "next/link";
import { ArrowUpRight, Printer, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
import type { SaleContractRow } from "@/types/database";
import { salePrice, saleScheduleState } from "./sale-workbench-model";
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

export function SaleWorkbenchInspector({
  data,
  locale,
  loading,
  error,
  selectedId,
  returnTo,
  onClose,
  onRetry,
  onOpen,
  onPrint,
}: {
  data: SaleInspectorData | null;
  locale: Locale;
  loading: boolean;
  error: boolean;
  selectedId: string | null;
  returnTo: string;
  onClose: () => void;
  onRetry: () => void;
  onOpen: (section: "overview" | "finance") => void;
  onPrint: (contract: SaleContractRow) => void;
}) {
  const id = useId();
  const [tab, setTab] = useState<"overview" | "finance" | "profile">("overview");
  const text = (zh: string, fr: string) => (locale === "zh" ? zh : fr);
  if (!selectedId)
    return (
      <aside className={styles.inspector}>
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
      <aside className={styles.inspector} aria-busy={loading}>
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
          <Button variant="ghost" size="sm" className="mt-3" onClick={onClose}>
            {text("关闭", "Fermer")}
          </Button>
        </div>
      </aside>
    );
  const contract = data.contracts.find((row) => row.id === selectedId) as
    SaleContractRow | undefined;
  if (!contract)
    return (
      <aside className={styles.inspector}>
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
    price = salePrice(contract);
  const payments = data.payments.filter((row) => row.source_id === contract.id),
    cash = summarizeContractCash(payments);
  const schedules = data.schedules
    .filter((row) => row.sale_contract_id === contract.id)
    .sort((a, b) => a.installment_no - b.installment_no);
  const recs = data.receivables.filter(
    (row) => row.source_type === "sale_contract" && row.source_id === contract.id,
  );
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
    { id: "overview", label: text("履约", "Exécution") },
    { id: "finance", label: text("付款事实", "Paiements") },
    { id: "profile", label: text("合同资料", "Dossier") },
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
      className={styles.inspector}
    >
      <header className={styles.inspectorHeader}>
        <div className={styles.inspectorTop}>
          <div>
            <p className="mb-3 text-[11px] font-medium tracking-widest text-muted-foreground">
              {text("出售履约", "VENTE · EXÉCUTION")}
            </p>
            <h2>{unit?.unit_no ?? text("房源待核", "Lot à vérifier")}</h2>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="-mr-2 -mt-2 size-8"
            onClick={onClose}
            aria-label={text("关闭合同预览", "Fermer l’aperçu")}
          >
            <X aria-hidden="true" />
          </Button>
        </div>
        <p className={styles.sub}>
          {building?.display_name ?? "—"} · {contract.contract_no}
        </p>
        <p className="mt-3 text-sm font-medium">
          {customer?.name ?? text("客户待核", "Client à vérifier")}
        </p>
        <p className={styles.sub}>
          {
            dictionaries[locale].sales.contractStatus[
              contract.status as keyof typeof dictionaries.zh.sales.contractStatus
            ]
          }{" "}
          · {transfer}
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
                    ? 2
                    : (index + (event.key === "ArrowRight" ? 1 : 2)) % 3;
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
            <h3>{text("分期与应收", "Échéances et créances")}</h3>
            <dl className={styles.facts}>
              <Fact label={text("合同价", "Prix contractuel")}>{money(price)}</Fact>
              <Fact label={text("已建应收未收", "Créances restantes")}>
                {known
                  ? money(summary.outstanding)
                  : text("暂无已核应收", "Aucune créance vérifiée")}
              </Fact>
              <Fact label={text("其中已逾期", "Dont en retard")}>
                {known ? money(summary.overdue) : "—"}
              </Fact>
              <Fact label={text("应收已核销", "Créances rapprochées")}>
                {known ? money(summary.paid) : "—"}
              </Fact>
              <Fact label={text("过户阶段", "Transfert")}>{transfer}</Fact>
            </dl>
            <p className={styles.callout}>
              {text(
                "合同价、现金实收与应收核销分别核对；过户阶段不是付款状态。",
                "Prix, encaissements et rapprochements sont distincts. Le transfert n’est pas un statut de paiement.",
              )}
            </p>
            <h3 className="mt-5">{text("付款计划", "Plan de paiement")}</h3>
            {schedules.length ? (
              schedules.map((schedule) => {
                const state = saleScheduleState(schedule, recs, data.today);
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
            <h3>{text("已录付款事实", "Paiements enregistrés")}</h3>
            <dl className={styles.facts}>
              <Fact label={text("经营收款", "Encaissements")}>
                {payments.some((p) => classifyContractCashPayment(p).kind === "income")
                  ? money(cash.income)
                  : text("暂无已核记录", "Aucune écriture vérifiée")}
              </Fact>
              <Fact label={text("经营支出", "Décaissements")}>
                {payments.some((p) => classifyContractCashPayment(p).kind === "expense")
                  ? money(cash.expense)
                  : text("暂无已核记录", "Aucune écriture vérifiée")}
              </Fact>
            </dl>
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
              .slice(0, 6)
              .map((payment) => {
                const classification = classifyContractCashPayment(payment);
                return (
                  <article className={styles.schedule} key={payment.id}>
                    <div className={styles.scheduleHead}>
                      <span>{payment.payment_date}</span>
                      <strong>
                        {formatMoney(Number(payment.amount), payment.currency, locale)}
                      </strong>
                    </div>
                    <p className={styles.sub}>
                      {dictionaries[locale].finance.categories[
                        payment.source_type as keyof typeof dictionaries.zh.finance.categories
                      ] ?? text("其他付款记录", "Autre écriture")}
                      {classification.kind === "excluded"
                        ? ` · ${text("不计入现金汇总", "Hors synthèse de caisse")}`
                        : ""}
                    </p>
                    <p className={styles.sub}>
                      {text("实际收款人", "Encaisseur")}:{" "}
                      {payment.actual_collector || text("待核对", "À vérifier")}
                    </p>
                    <p className={styles.sub}>
                      {text("录入账号", "Compte de saisie")}:{" "}
                      {payment.recorded_by
                        ? text("已记录，见审计详情", "Enregistré, voir l’audit")
                        : text("待核对", "À vérifier")}
                    </p>
                    {payment.receipt_no ? (
                      <p className={styles.sub}>
                        {text("凭证", "Référence")}: {payment.receipt_no}
                      </p>
                    ) : null}
                  </article>
                );
              })}
            {!payments.length ? (
              <p className="py-5 text-xs text-muted-foreground">
                {text("暂无逐笔付款记录。", "Aucun paiement détaillé.")}
              </p>
            ) : payments.length > 6 ? (
              <p className={styles.note}>
                {text(
                  "显示最近 6 笔，完整记录在办理详情中。",
                  "Les 6 dernières écritures sont affichées. Dossier complet ci-dessous.",
                )}
              </p>
            ) : null}
          </>
        ) : (
          <>
            <h3>{text("合同资料", "Informations contractuelles")}</h3>
            <dl className={styles.facts}>
              <Fact label={text("签约日期", "Signature")}>{contract.signed_date}</Fact>
              <Fact label={text("合同总额", "Total contractuel")}>{money(price)}</Fact>
              <Fact label={text("付款方式", "Plan")}>
                {dictionaries[locale].sales.paymentPlan[
                  contract.payment_plan_type as keyof typeof dictionaries.zh.sales.paymentPlan
                ] ?? text("待核对", "À vérifier")}
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
            </dl>
            <p className={styles.callout}>
              {text(
                "合同标注不能代替财务凭证；关联只依据明确的客户与资产 ID。",
                "Les mentions contractuelles ne remplacent pas les justificatifs. Les relations reposent sur des identifiants explicites.",
              )}
            </p>
          </>
        )}
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
        <Button
          type="button"
          variant="outline"
          className="w-full"
          onClick={() => onOpen(tab === "finance" ? "finance" : "overview")}
        >
          {text("打开合同 / 办理", "Ouvrir le dossier / Gérer")}
          <ArrowUpRight aria-hidden="true" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="w-full text-xs"
          onClick={() => onPrint(contract)}
        >
          <Printer aria-hidden="true" />
          {text("合同 / 打印", "Contrat / Imprimer")}
        </Button>
      </footer>
    </aside>
  );
}
