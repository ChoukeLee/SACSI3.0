"use client";
import { financeRowMoney } from "@/lib/native-money";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, FileText, LoaderCircle, LockKeyhole } from "lucide-react";
import {
  decodePaymentContext,
  validPaymentContextId,
  type PaymentContext,
} from "@/features/finance/payment-context";
import { financialBusinessLabel, statusDisplayLabel } from "@/lib/display-labels";
import { reportFinanceFilters, type ReportWorkspaceData } from "./report-read";
import styles from "./reports-view.module.css";

type Locale = "zh" | "fr";
type Row = ReportWorkspaceData["result"]["rows"][number];

function formatNumber(value: number, locale: Locale) {
  return new Intl.NumberFormat(locale === "zh" ? "zh-CN" : "fr-FR", {
    maximumFractionDigits: 2,
  }).format(value);
}

function ReadonlyPayment({ paymentId, locale }: { paymentId: string; locale: Locale }) {
  const zh = locale === "zh";
  const text = (chinese: string, french: string) => (zh ? chinese : french);
  const [result, setResult] = useState<PaymentContext | null>(null);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      try {
        const response = await fetch(
          `/api/finance/payment-context/${encodeURIComponent(paymentId)}`,
          {
            method: "GET",
            credentials: "same-origin",
            cache: "no-store",
            signal: controller.signal,
          },
        );
        if (!response.ok) throw new Error("paymentContextUnavailable");
        const context = decodePaymentContext(await response.json());
        if (context.paymentId !== paymentId) throw new Error("paymentContextTargetMismatch");
        if (!controller.signal.aborted) setResult(context);
      } catch {
        if (!controller.signal.aborted) setFailed(true);
      }
    };
    void load();
    return () => controller.abort();
  }, [paymentId, retry]);

  return (
    <section className={styles.paymentFacts} aria-label={text("付款事实", "Faits du paiement")}>
      <h3>
        <FileText size={13} aria-hidden="true" />
        {text("付款事实", "Faits du paiement")}
      </h3>
      {!result && !failed ? (
        <p className={styles.contextLoading} role="status">
          <LoaderCircle size={13} className={styles.spinner} aria-hidden="true" />
          {text("读取来源中…", "Lecture de la source…")}
        </p>
      ) : null}
      {failed ? (
        <div className={styles.contextError} role="alert">
          <p>
            {text(
              "付款事实暂时无法读取，没有用空值或零代替。",
              "Les faits du paiement sont indisponibles ; aucune valeur n’a été remplacée par zéro.",
            )}
          </p>
          <button
            type="button"
            onClick={() => {
              setFailed(false);
              setResult(null);
              setRetry((value) => value + 1);
            }}
          >
            {text("重新读取", "Réessayer")}
          </button>
        </div>
      ) : null}
      {result ? (
        <>
          <dl className={styles.factList}>
            <div>
              <dt>{text("原币金额", "Montant d’origine")}</dt>
              <dd>
                {formatNumber(result.amount, locale)} {result.currency}
              </dd>
            </div>
            <div>
              <dt>{text("付款日期", "Date du paiement")}</dt>
              <dd>{result.paymentDate}</dd>
            </div>
            <div>
              <dt>{text("账号登记人", "Compte ayant enregistré")}</dt>
              <dd>{result.recordedByName ?? text("未记录姓名", "Nom non renseigné")}</dd>
            </div>
            <div>
              <dt>{text("实际收款人", "Encaisseur effectif")}</dt>
              <dd>{result.actualCollector ?? text("尚未确认", "Non confirmé")}</dd>
            </div>
            {result.collectorBasis ? (
              <div>
                <dt>{text("收款人依据", "Source de l’encaisseur")}</dt>
                <dd>{result.collectorBasis}</dd>
              </div>
            ) : null}
            <div>
              <dt>{text("已关联应收分配", "Affectation liée aux créances")}</dt>
              <dd>{formatNumber(result.allocatedXof, locale)} XOF</dd>
            </div>
          </dl>
          {result.allocations.length ? (
            <details className={styles.allocations}>
              <summary>
                {text("关联应收与账期", "Créances et périodes liées")} · {result.allocations.length}
              </summary>
              {result.allocations.map((allocation) => (
                <div className={styles.allocation} key={allocation.receivableId}>
                  <strong>{allocation.title}</strong>
                  <span>{formatNumber(allocation.allocatedXof, locale)} XOF</span>
                  <p>
                    {text("到期日", "Échéance")} · {allocation.dueDate}
                  </p>
                  <p>
                    {text("账期", "Période")} ·{" "}
                    {allocation.periodStart && allocation.periodEnd
                      ? `${allocation.periodStart} — ${allocation.periodEnd}`
                      : text("尚未确认", "Non confirmée")}
                  </p>
                  {allocation.periodSource ? (
                    <p>
                      {text("来源", "Source")} · {allocation.periodSource}
                    </p>
                  ) : null}
                </div>
              ))}
            </details>
          ) : (
            <p className={styles.inspectorNote}>
              {text(
                "暂无关联应收分配，不据此推断是否欠款。",
                "Aucune affectation liée ; cela ne permet pas de conclure à l’absence de dette.",
              )}
            </p>
          )}
        </>
      ) : null}
    </section>
  );
}

export function ReportInspector({
  row,
  data,
  locale,
}: {
  row: Row | null;
  data: ReportWorkspaceData;
  locale: Locale;
}) {
  const zh = locale === "zh";
  const text = (chinese: string, french: string) => (zh ? chinese : french);
  const ledger = data.query.kind === "ledger";
  const get = (key: string) =>
    row?.[key] === null || row?.[key] === undefined || row?.[key] === "" ? "—" : String(row[key]);
  const paymentId = row?.payment_id;
  const hasPayment = typeof paymentId === "string" && validPaymentContextId(paymentId);
  const financeParams = new URLSearchParams({
    ...reportFinanceFilters(data.query),
    kind: data.query.kind,
  });
  const unit = row?.unit_label;
  if (typeof unit === "string" && unit) financeParams.set("search", unit);
  const financeHref = `${zh ? "" : "/fr"}/finance?${financeParams.toString()}`;
  const value = row ? financeRowMoney(row) : { amount: 0, currency: "XOF" };
  const amount = value.amount;

  return (
    <aside
      className={styles.inspector}
      aria-label={text("选中记录来源", "Source de l’écriture sélectionnée")}
    >
      <div className={styles.inspectorHeading}>
        <span>{text("来源核查", "SOURCE DE L’ÉCRITURE")}</span>
        <LockKeyhole size={13} aria-hidden="true" />
      </div>
      {row ? (
        <>
          <div className={styles.inspectType}>
            {financialBusinessLabel(
              get("source_type") !== "—" ? get("source_type") : get("category"),
              locale,
              get("category"),
            )}
          </div>
          <div className={styles.inspectAmount}>
            {formatNumber(amount, locale)}
            <span>{value.currency}</span>
          </div>
          <p className={styles.inspectorNote}>
            {ledger
              ? text("所选流水登记金额", "Montant inscrit de l’écriture")
              : text("所选应收原额，并非未收余额", "Montant initial de la créance, pas son solde")}
          </p>
          <dl className={styles.factList}>
            <div>
              <dt>{text("关联房号", "Lot associé")}</dt>
              <dd>
                {[get("building_label"), get("unit_label")]
                  .filter((value) => value !== "—")
                  .join(" · ") || text("未关联", "Non associé")}
              </dd>
            </div>
            <div>
              <dt>
                {ledger ? text("登记日期", "Date d’inscription") : text("到期日", "Échéance")}
              </dt>
              <dd>{get(ledger ? "entry_date" : "due_date")}</dd>
            </div>
            <div>
              <dt>{text("事项 / 说明", "Objet / description")}</dt>
              <dd>{get(ledger ? "description" : "title")}</dd>
            </div>
            {!ledger ? (
              <>
                <div>
                  <dt>{text("应收状态", "Statut de la créance")}</dt>
                  <dd>{statusDisplayLabel(get("status"), locale)}</dd>
                </div>
                <div>
                  <dt>{text("应收已核销", "Montant imputé")}</dt>
                  <dd>
                    {formatNumber(financeRowMoney(row, true).amount, locale)} {value.currency}
                  </dd>
                </div>
              </>
            ) : null}
            <div>
              <dt>{text("记录编号", "Identifiant de l’écriture")}</dt>
              <dd className={styles.identifier}>{get("id")}</dd>
            </div>
            {!ledger && get("source_id") !== "—" ? (
              <div>
                <dt>{text("业务来源编号", "Identifiant de la source")}</dt>
                <dd className={styles.identifier}>{get("source_id")}</dd>
              </div>
            ) : null}
          </dl>
          {ledger ? (
            hasPayment ? (
              <ReadonlyPayment key={paymentId} paymentId={paymentId} locale={locale} />
            ) : (
              <p className={styles.unlinkedNote}>
                {text(
                  "独立账务记录，没有可核查的关联付款。不推断实际收款人、方式或账期。",
                  "Écriture sans paiement lié vérifiable. Aucun encaisseur, mode ni période n’est déduit.",
                )}
              </p>
            )
          ) : null}
          <Link href={financeHref} className={styles.financeLink}>
            {unit
              ? text("在财务页查看同房号记录", "Voir les écritures du même lot")
              : text("在财务页查看当前范围", "Voir cette sélection dans Finance")}
            <ArrowUpRight size={13} aria-hidden="true" />
          </Link>
          <p className={styles.inspectorBoundary}>
            {text(
              "这里仅查看，不修改金额或原始业务。",
              "Consultation uniquement ; aucun montant ni dossier modifié.",
            )}
          </p>
        </>
      ) : (
        <div className={styles.inspectorEmpty}>
          <FileText size={26} strokeWidth={1.2} aria-hidden="true" />
          <p>
            {text(
              "选择一条记录，核对来源与付款事实。",
              "Sélectionnez une écriture pour consulter sa source.",
            )}
          </p>
        </div>
      )}
    </aside>
  );
}
