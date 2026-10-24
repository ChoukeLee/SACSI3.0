"use client";

import type { ReactNode } from "react";
import { ArrowUpRight, FileSearch, Loader2, RotateCw, X } from "lucide-react";
import {
  directionDisplayLabel,
  financialBusinessLabel,
  statusDisplayLabel,
} from "@/lib/display-labels";
import type { FinanceKind, FinanceReadResult } from "./finance-read";
import { PaymentContextPanel } from "./payment-context-panel";
import { useFinanceWorkbenchContext } from "./use-finance-workbench-context";

export interface FinanceWorkbenchInspectorProps {
  row: FinanceReadResult["rows"][number] | null;
  kind: FinanceKind;
  locale: "zh" | "fr";
  canWrite: boolean;
  scopeKey: string;
  onClose?: () => void;
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)] gap-3 py-1.5 text-xs leading-5">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words text-right font-medium tabular-nums">{children}</dd>
    </div>
  );
}

/** This preview only reads facts. Any fact confirmation uses the existing audited drawer. */
export function FinanceWorkbenchInspector(props: FinanceWorkbenchInspectorProps) {
  return (
    <InspectorContent
      key={JSON.stringify([props.scopeKey, props.kind, props.row?.id ?? null])}
      {...props}
    />
  );
}

function InspectorContent({
  row,
  kind,
  locale,
  canWrite,
  scopeKey,
  onClose,
}: FinanceWorkbenchInspectorProps) {
  const text = (zh: string, fr: string) => (locale === "zh" ? zh : fr);
  const recordId = typeof row?.id === "string" ? row.id : row ? "invalid" : null;
  const paymentId = typeof row?.payment_id === "string" ? row.payment_id : null;
  const { data, loading, error, reload } = useFinanceWorkbenchContext({
    kind,
    recordId,
    paymentId,
    scopeKey,
  });
  const money = (amount: number, currency = "XOF") =>
    `${new Intl.NumberFormat(locale === "zh" ? "zh-CN" : "fr-FR", {
      maximumFractionDigits: 2,
    }).format(amount)} ${currency}`;
  const pending = text("待核对", "À vérifier");

  if (!row || loading || error || !data) {
    return (
      <aside
        aria-label={text("账目详情", "Détail de l'écriture")}
        aria-busy={loading}
        className="min-w-0 rounded-xl border border-border/75 bg-card p-6"
      >
        <div className="mb-6 flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold">{text("账目详情", "Détail de l'écriture")}</h2>
          {row && onClose ? (
            <button
              type="button"
              onClick={onClose}
              aria-label={text("关闭账目详情", "Fermer le détail")}
              className="rounded-md p-1 text-muted-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
            >
              <X aria-hidden="true" className="h-4 w-4" />
            </button>
          ) : null}
        </div>
        {loading ? (
          <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
            {text("正在读取实时账目…", "Lecture de l'écriture en cours…")}
          </p>
        ) : error ? (
          <div role="alert" className="space-y-3 text-sm leading-6">
            <p>
              {text(
                "暂时无法核验这笔账目。请重新读取，不会用零或上一笔记录替代。",
                "Vérification indisponible. Rechargez ; aucune valeur zéro ni ancienne écriture ne sera substituée.",
              )}
            </p>
            <button
              type="button"
              onClick={reload}
              className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
            >
              <RotateCw aria-hidden="true" className="h-3.5 w-3.5" />
              {text("重新读取", "Recharger")}
            </button>
          </div>
        ) : (
          <div className="py-10 text-center">
            <FileSearch aria-hidden="true" className="mx-auto mb-4 h-7 w-7 text-slate-400" />
            <p className="text-sm font-medium">
              {text("选择一笔账目", "Sélectionnez une écriture")}
            </p>
            <p className="mt-2 text-xs leading-6 text-muted-foreground">
              {text(
                "核对业务来源、付款事实与明确分账。",
                "Vérifiez la source, les faits du paiement et les répartitions explicites.",
              )}
            </p>
          </div>
        )}
      </aside>
    );
  }

  const { record, payment } = data;
  const customerCollection = [
    "cimac_customer_collection",
    "cimac_customer_refund",
    "cimac_customer_reversal",
  ].includes(record.source?.type ?? "");
  const customerAccountHref =
    customerCollection && record.customer?.id
      ? `${locale === "fr" ? "/fr" : ""}/finance?view=customers&customerId=${encodeURIComponent(record.customer.id)}&tab=receipts`
      : null;
  const deposit =
    record.direction === "liability_in" ||
    record.direction === "liability_out" ||
    /(?:deposit|caution)/i.test(record.category);
  const period = record.period;
  const method =
    record.paymentMethod === "cash"
      ? text("现金", "Espèces")
      : record.paymentMethod === "bank_transfer"
        ? text("银行转账", "Virement")
        : record.paymentMethod === "check"
          ? text("支票", "Chèque")
          : record.paymentMethod === "offset"
            ? text("非现金抵扣", "Compensation non monétaire")
            : record.paymentMethod === "other"
              ? text("其他方式", "Autre mode")
              : pending;
  const management =
    record.managementStatus === "managed"
      ? text("系统管理", "Gérée")
      : record.managementStatus === "historical_pending"
        ? text("历史待核对", "Historique à vérifier")
        : record.managementStatus === "excluded"
          ? text("已排除", "Exclue")
          : pending;
  const sourceHref = record.source?.href
    ? `${locale === "fr" ? "/fr" : ""}${record.source.href}`
    : null;

  return (
    <aside
      aria-label={text("账目详情", "Détail de l'écriture")}
      className="min-w-0 overflow-hidden rounded-xl border border-border/75 bg-card"
    >
      <header className="border-b border-blue-100 bg-blue-50/70 px-4 py-4 dark:border-blue-900/40 dark:bg-blue-950/40">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-xs font-medium text-slate-600 dark:text-slate-300">
            {kind === "ledger"
              ? `${text("本条分录", "Cette écriture")} · ${record.currency ?? "XOF"}`
              : `${text("本条应收", "Cette créance")} · ${record.currency ?? "XOF"}`}
          </h2>
          {onClose ? (
            <button
              type="button"
              onClick={onClose}
              aria-label={text("关闭账目详情", "Fermer le détail")}
              className="rounded-md p-1 text-muted-foreground hover:bg-white focus-visible:outline-2 focus-visible:outline-ring dark:hover:bg-blue-900/30"
            >
              <X aria-hidden="true" className="h-4 w-4" />
            </button>
          ) : null}
        </div>
        <p className="mt-3 break-words text-[25px] font-semibold leading-tight tracking-tight tabular-nums">
          {money(record.nativeAmount ?? record.amountXof, record.currency ?? "XOF")}
        </p>
        <p className="mt-2 text-xs leading-5 text-slate-600 dark:text-slate-300">
          {financialBusinessLabel(record.category, locale)}
          {record.direction ? ` · ${directionDisplayLabel(record.direction, locale)}` : ""}
        </p>
      </header>

      <div className="space-y-5 px-4 py-4">
        <section aria-label={text("账目归属", "Attribution de l'écriture")}>
          <h3 className="text-xs font-semibold">{text("账目归属", "Attribution de l'écriture")}</h3>
          <dl className="mt-2">
            <Fact label={text("房源", "Lot")}>
              {[record.building?.label, record.unit?.label].filter(Boolean).join(" · ") || pending}
            </Fact>
            <Fact label={text("客户", "Client")}>{record.customer?.label || pending}</Fact>
            <Fact
              label={
                kind === "ledger" ? text("流水日期", "Date d'écriture") : text("到期日", "Échéance")
              }
            >
              {record.date}
            </Fact>
            {record.title ? <Fact label={text("事项", "Objet")}>{record.title}</Fact> : null}
            {kind === "receivables" ? (
              <>
                <Fact label={text("应收已核销", "Montant imputé")}>
                  {record.paidAmountXof === null
                    ? pending
                    : money(
                        record.nativePaidAmount ?? record.paidAmountXof,
                        record.currency ?? "XOF",
                      )}
                </Fact>
                <Fact label={text("登记状态", "Statut enregistré")}>
                  {record.status ? statusDisplayLabel(record.status, locale) : pending}
                </Fact>
                <Fact label={text("管理范围", "Gestion")}>{management}</Fact>
                <Fact label={text("服务账期", "Période de service")}>
                  {period?.start && period.end
                    ? `${period.start} → ${period.end}`
                    : period?.end
                      ? `${text("开始待核", "Début à vérifier")} → ${period.end}`
                      : period?.start
                        ? `${period.start} → ${text("结束待核", "Fin à vérifier")}`
                        : pending}
                </Fact>
                {period?.source ? (
                  <Fact label={text("账期依据", "Source de période")}>{period.source}</Fact>
                ) : null}
              </>
            ) : null}
          </dl>
          {kind === "receivables" ? (
            <p className="mt-2 text-[11px] leading-5 text-muted-foreground">
              {text(
                "应收核销不等于现金收款；到期日不是服务账期。",
                "L'imputation n'est pas un encaissement ; l'échéance n'est pas la période de service.",
              )}
            </p>
          ) : null}
        </section>

        <section aria-label={text("关联付款", "Paiement lié")} className="border-t pt-4">
          <h3 className="text-xs font-semibold">{text("关联付款", "Paiement lié")}</h3>
          {payment ? (
            <>
              <dl className="mt-2">
                <Fact label={text("关联付款原币合计", "Total du paiement, devise d'origine")}>
                  {money(payment.amount, payment.currency)}
                </Fact>
                <Fact label={text("付款日期", "Date du paiement")}>{payment.paymentDate}</Fact>
                <Fact label={text("付款方式", "Mode de paiement")}>{method}</Fact>
                <Fact label={text("实际收款人", "Encaisseur réel")}>
                  {payment.actualCollector || pending}
                </Fact>
                <Fact label={text("录入账号", "Compte de saisie")}>
                  <span title={payment.recordedBy || undefined}>
                    {payment.recordedByName ||
                      (payment.recordedBy
                        ? text("已记录账号身份（姓名待核）", "Compte enregistré, nom à vérifier")
                        : text("历史未记录", "Historique non renseigné"))}
                  </span>
                </Fact>
                {payment.collectorBasis ? (
                  <Fact label={text("收款人依据", "Preuve de l'encaisseur")}>
                    {payment.collectorBasis}
                  </Fact>
                ) : null}
              </dl>
              <p className="mt-2 text-[11px] leading-5 text-muted-foreground">
                {record.paymentMethod === "offset"
                  ? text(
                      "此付款为非现金抵扣，不计为现金实收。付款原币合计与本条分录不是同一口径；录入账号不等于实际收款人。",
                      "Ce paiement est une compensation non monétaire, pas un encaissement. Son total en devise d'origine diffère de cette écriture ; le compte de saisie n'est pas l'encaisseur.",
                    )
                  : text(
                      "付款合计与本条分录不是同一口径，不直接比较不同币种；付款记录可能包含非现金结算。录入账号不等于实际收款人。",
                      "Le paiement total diffère de cette écriture. Ne comparez pas directement des devises différentes ; un paiement peut être non monétaire. Le compte de saisie n'est pas l'encaisseur.",
                    )}
              </p>
              <div className="mt-3 rounded-lg bg-muted/35 px-3 py-2">
                <p className="text-xs font-medium">
                  {text("明确分配至应收", "Répartitions explicites vers les créances")}
                </p>
                {payment.allocations.length ? (
                  <ul className="mt-3 space-y-3">
                    {payment.allocations.map((allocation) => (
                      <li key={allocation.receivableId} className="space-y-1 text-xs leading-5">
                        <div className="flex justify-between gap-3">
                          <span className="min-w-0 break-words">{allocation.title}</span>
                          <strong className="shrink-0 font-medium tabular-nums">
                            {money(allocation.allocatedXof)}
                          </strong>
                        </div>
                        <p className="text-[11px] text-muted-foreground">
                          {text("到期日", "Échéance")} {allocation.dueDate}
                        </p>
                        <p className="text-[11px] text-muted-foreground">
                          {text("服务账期", "Période de service")}:{" "}
                          {allocation.periodStart && allocation.periodEnd
                            ? `${allocation.periodStart} → ${allocation.periodEnd}`
                            : pending}
                        </p>
                        {allocation.periodSource ? (
                          <p className="break-words text-[11px] text-muted-foreground">
                            {text("依据", "Source")}: {allocation.periodSource}
                          </p>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2 text-[11px] leading-5 text-muted-foreground">
                    {text(
                      "尚无明确分配关系，不推断历史归属或自动补账。",
                      "Aucune répartition explicite ; aucune attribution historique ni correction automatique.",
                    )}
                  </p>
                )}
              </div>
            </>
          ) : (
            <p className="mt-2 text-xs leading-6 text-muted-foreground">
              {kind === "ledger"
                ? text(
                    "此分录没有明确关联付款，不据此推断收款人或分账。",
                    "Aucun paiement explicitement lié ; ne déduisez ni encaisseur ni répartition.",
                  )
                : text(
                    "此处不从应收已核销金额倒推付款；可回来源业务核对收款记录。",
                    "Ne reconstituez pas un paiement à partir du montant imputé. Vérifiez les paiements dans le dossier source.",
                  )}
            </p>
          )}
        </section>

        {deposit ? (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] leading-5 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
            {text(
              "押金为独立负债口径，不计作经营收入；本条记录也不代表当前可退押金余额。",
              "Le dépôt est un passif distinct, pas un revenu d'exploitation ; cette écriture ne constitue pas le solde remboursable actuel.",
            )}
          </p>
        ) : null}

        <section className="border-t pt-4" aria-label={text("业务来源", "Source métier")}>
          <h3 className="text-xs font-semibold">{text("业务来源", "Source métier")}</h3>
          <p className="mt-2 break-words text-xs leading-6 text-muted-foreground">
            {record.source?.label ||
              text("尚无可核验的业务来源", "Aucune source métier vérifiable")}
          </p>
          <p className="mt-1 break-all font-mono text-[11px] leading-5 text-muted-foreground">
            {text("记录编号", "Identifiant")}: {record.id}
          </p>
          {sourceHref ? (
            <>
              <a
                href={sourceHref}
                className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-blue-700 underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-ring dark:text-blue-300"
              >
                {text("打开来源工作台", "Ouvrir l'espace source")}
                <ArrowUpRight aria-hidden="true" className="h-3.5 w-3.5" />
              </a>
              <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
                {text(
                  "进入对应业务工作台后，按上述房源或编号查找，不会直接打开指定合同。",
                  "Dans l'espace métier, recherchez le lot ou l'identifiant ci-dessus ; le contrat précis ne s'ouvre pas automatiquement.",
                )}
              </p>
            </>
          ) : null}
        </section>
      </div>

      <footer className="space-y-2 border-t px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          {payment ? (
            <PaymentContextPanel
              paymentId={payment.paymentId}
              locale={locale}
              canWrite={canWrite && !customerCollection}
            />
          ) : null}
          <button
            type="button"
            onClick={reload}
            className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
          >
            <RotateCw aria-hidden="true" className="h-3.5 w-3.5" />
            {text("刷新详情", "Actualiser le détail")}
          </button>
        </div>
        {payment && !customerCollection ? (
          <p className="text-[11px] leading-5 text-muted-foreground">
            {text(
              "付款事实确认后，关闭抽屉并刷新详情读取最新记录；金额、币种与付款日仍由原业务流程办理。",
              "Après confirmation, fermez le volet puis actualisez le détail. Les montants, devises et dates restent gérés par le processus métier existant.",
            )}
          </p>
        ) : null}
        {customerCollection ? (
          <p className="text-[11px] leading-5 text-muted-foreground">
            {text(
              "这是受保护的客户总账收款或校正记录。此处只读核对，不能使用旧单房修改、退款、冲正或付款事实确认入口；请从客户总账的原收款区分办理实际退款与错误冲正。历史旧单仍沿用原流程。",
              "Reçu ou correction du compte client protégé. Lecture seule ici ; les anciennes opérations par lot ne s’appliquent pas. Ouvrez le reçu d’origine dans le compte client pour distinguer remboursement réel et contrepassation d’erreur. Les anciens reçus gardent leur processus existant.",
            )}
            {customerAccountHref ? (
              <>
                {" "}
                <a
                  href={customerAccountHref}
                  className="font-medium text-blue-700 hover:underline dark:text-blue-300"
                >
                  {text("打开客户总账原收款", "Ouvrir les reçus du compte client")} ↗
                </a>
              </>
            ) : null}
          </p>
        ) : null}
      </footer>
    </aside>
  );
}
