"use client";

import Link from "next/link";
import type { CimacAccountAllocation, CimacCustomerAccount } from "./cimac-billing-types";
import { billingCategory, billingNumber } from "./cimac-billing-display";
import { buildLeaseCollectionHref } from "@/features/leases/lease-collection-links";
import { CimacCollectionAdjustments } from "./cimac-collection-adjustments";
import styles from "./cimac-customer-workbench.module.css";

export function CimacCustomerReceipts({
  data,
  locale,
  returnHref,
  viewerId,
  today,
  canWrite,
}: {
  data: CimacCustomerAccount;
  locale: "zh" | "fr";
  returnHref: string;
  viewerId: string;
  today: string;
  canWrite: boolean;
}) {
  const text = (zh: string, fr: string) => (locale === "zh" ? zh : fr);
  const base = locale === "fr" ? "/fr" : "";
  const oldLedger = `${base}/cimac/finance?kind=ledger&projectId=${encodeURIComponent(data.project.id)}`;
  const units = new Map(data.units.map((unit) => [unit.id, unit]));
  const receivablesById = new Map(data.receivables.map((row) => [row.id, row]));
  const unitLabels = Object.fromEntries(
    data.units.map((unit) => [
      unit.id,
      `${unit.building_label || unit.building_code} · ${unit.unit_no}`,
    ]),
  );
  const contractLabels = Object.fromEntries(
    data.contracts.map((contract) => [contract.id, contract.contractNo]),
  );
  const allocationsByPayment = new Map<string, CimacAccountAllocation[]>();
  for (const allocation of data.allocations) {
    const values = allocationsByPayment.get(allocation.paymentId) ?? [];
    values.push(allocation);
    allocationsByPayment.set(allocation.paymentId, values);
  }
  const unitLabel = (id: string | null) => {
    const unit = id ? units.get(id) : undefined;
    return unit
      ? `${unit.building_label || unit.building_code} · ${unit.unit_no}`
      : text("房屋关联待核", "Lot à vérifier");
  };
  return (
    <>
      <div>
        <h2>{text("实际收款与核销去向", "Encaissements et affectations")}</h2>
        <p className={styles.subtitle}>
          {text(
            "每笔支付只展示一次；核销、押金、退款与冲正保留原记录。",
            "Chaque paiement apparaît une seule fois ; imputations, dépôts, remboursements et annulations sont conservés.",
          )}
        </p>
      </div>
      {data.payments.length ? (
        data.payments.map((payment) => (
          <section
            className={`${styles.panel} ${styles.receipt}`}
            key={payment.id}
            id={`cimac-payment-${payment.id}`}
          >
            <div className={styles.receiptTop}>
              <div>
                <p className={styles.meta}>
                  {payment.receipt_no || text("无系统收据号", "Sans numéro de reçu")} ·{" "}
                  {payment.payment_date}
                </p>
                <p className={styles.receiptAmount}>
                  {billingNumber(payment.amount, locale)}
                  <small>{payment.currency}</small>
                </p>
                <p className={styles.meta}>
                  {text("原始凭证", "Justificatif d’origine")} ·{" "}
                  {payment.external_receipt_no || text("未登记", "Non renseigné")}
                </p>
              </div>
              <span className={styles.status}>
                {payment.source_type === "cimac_customer_refund"
                  ? text("客户总账 · 实际退款", "Compte client · remboursement réel")
                  : payment.source_type === "cimac_customer_reversal"
                    ? text(
                        "客户总账 · 错误收款冲正（非现金）",
                        "Compte client · contrepassation d’erreur (hors caisse)",
                      )
                    : payment.reversal_of_payment_id
                      ? text("收款冲正记录", "Annulation d’encaissement")
                      : payment.payment_method === "offset"
                        ? text("非现金抵扣", "Compensation non monétaire")
                        : payment.protected_collection ||
                            payment.source_type === "cimac_customer_collection"
                          ? text("客户总账收款", "Encaissement du compte client")
                          : text("已有支付记录", "Paiement existant")}
              </span>
            </div>
            <div className={styles.allocationLines}>
              {(allocationsByPayment.get(payment.id) ?? []).map((allocation, index) => {
                const bill = receivablesById.get(allocation.receivableId);
                return (
                  <div
                    className={styles.allocationLine}
                    key={`${allocation.receivableId}-${index}`}
                  >
                    <span>
                      {bill
                        ? `${unitLabel(bill.unit_id)} · ${billingCategory(bill.category, locale)}`
                        : text("关联应收明细待核", "Détail de créance à vérifier")}
                    </span>
                    <span className={styles.number}>
                      {billingNumber(allocation.amount, locale)} {allocation.currency}
                    </span>
                  </div>
                );
              })}
              {!allocationsByPayment.has(payment.id) ? (
                <p className={styles.note}>
                  {text(
                    "未读取到核销分配，不自动认定为未收或待分账。",
                    "Aucune imputation liée lue ; cela ne prouve ni un impayé ni une affectation à faire.",
                  )}
                </p>
              ) : null}
            </div>
            <div className={styles.receiptFacts}>
              <span>
                {payment.source_type === "cimac_customer_refund" ||
                payment.source_type === "cimac_customer_reversal"
                  ? text("原收款人", "Encaisseur d’origine")
                  : text("实际收款人", "Encaisseur")}
                ：
                <strong>
                  {payment.actual_collector ||
                    text("未登记，不能用录入人代替", "Non renseigné, distinct de l’opérateur")}
                </strong>
              </span>
              <span>
                {text("录入账号标识", "Identifiant de l’opérateur")}：
                <strong>
                  {payment.recorded_by || text("历史未记录", "Non enregistré historiquement")}
                </strong>
              </span>
            </div>
            {payment.collector_basis ? (
              <p className={styles.meta}>
                {text("收款人依据", "Source de vérification")} · {payment.collector_basis}
              </p>
            ) : null}
            {payment.notes ? <p className={styles.meta}>{payment.notes}</p> : null}
            {payment.source_type === "cimac_customer_refund" ||
            payment.source_type === "cimac_customer_reversal" ? (
              <p className={styles.note}>
                {payment.source_type === "cimac_customer_refund"
                  ? text(
                      "这是已实际退款的登记，不是银行转账指令；相应应收已恢复，未自动减免。",
                      "Ceci enregistre un remboursement déjà effectué, sans ordre de virement. Les créances sont rétablies, sans remise de dette.",
                    )
                  : text(
                      "这是整单错误收款冲正，不是实际退款；保留原收款及审计。",
                      "Contrepassation intégrale d’un reçu erroné, sans remboursement réel. Le reçu d’origine et l’audit sont conservés.",
                    )}
                {payment.source_id ? (
                  <>
                    {" "}
                    <a
                      className={styles.correctionLink}
                      href={`#cimac-payment-${payment.source_id}`}
                    >
                      {text("查看原收款与校正链", "Voir le reçu d’origine et ses corrections")} ↑
                    </a>
                  </>
                ) : null}
              </p>
            ) : payment.protected_collection ||
              payment.source_type === "cimac_customer_collection" ? (
              <>
                <p className={styles.note}>
                  {text(
                    "客户总账收款已受核销保护；不能使用旧单房修改、退款或冲正入口。请从原单下方区分实际退款与错误收款冲正；历史旧单仍沿用原处理流程。",
                    "Cet encaissement est protégé. Les anciennes opérations par lot ne s’appliquent pas. Distinguez ci-dessous remboursement réel et contrepassation d’erreur ; les anciens reçus gardent leur processus existant.",
                  )}
                </p>
                {payment.source_type === "cimac_customer_collection" &&
                payment.customer_id &&
                payment.customer_id === data.selectedCustomerId ? (
                  <CimacCollectionAdjustments
                    originalPaymentId={payment.id}
                    customerId={payment.customer_id}
                    viewerId={viewerId}
                    locale={locale}
                    today={today}
                    canWrite={canWrite && data.canWrite}
                    unitLabels={unitLabels}
                    contractLabels={contractLabels}
                  />
                ) : null}
              </>
            ) : (
              <Link className={styles.quietButton} href={oldLedger}>
                {text(
                  "流水、凭证与原处理入口",
                  "Écritures, justificatifs et opérations existantes",
                )}{" "}
                ↗
              </Link>
            )}
          </section>
        ))
      ) : (
        <section className={styles.panel}>
          <p className={styles.empty}>
            {text(
              "当前客户没有已关联的支付记录，不代表没有线下付款。",
              "Aucun paiement lié lu pour ce client ; cela ne prouve pas l’absence de paiement hors système.",
            )}
          </p>
        </section>
      )}
      <div className={styles.twoColumns}>
        <section className={`${styles.panel} ${styles.miniPanel}`}>
          <h3>{text("押金单独核算", "Dépôts séparés")}</h3>
          <p className={styles.subtitle}>
            {text(
              "不自动抵租金、不算收入；退还与抵扣沿用原业务操作和审计。",
              "Ni compensation automatique du loyer ni revenu ; les remboursements et imputations gardent les opérations et l’audit existants.",
            )}
          </p>
        </section>
        <section className={`${styles.panel} ${styles.miniPanel}`}>
          <h3>{text("USD / CNY 保留原币", "USD / CNY en devise d’origine")}</h3>
          <p className={styles.subtitle}>
            {text(
              "原币收款继续通过已支持的合同收款入口办理，不自动换汇。",
              "Les encaissements en devise restent disponibles via le contrat, sans conversion automatique.",
            )}
          </p>
          {data.contracts
            .filter(
              (contract) =>
                contract.kind === "lease" &&
                "rent_currency" in contract.data &&
                contract.data.rent_currency &&
                contract.data.rent_currency !== "XOF",
            )
            .map((contract) => {
              const link = buildLeaseCollectionHref({
                contractId: contract.id,
                locale,
                returnTo: returnHref,
                workArea: "cimac",
              });
              return link ? (
                <Link className={styles.quietButton} key={contract.id} href={link}>
                  {contract.contractNo} ↗
                </Link>
              ) : null;
            })}
        </section>
      </div>
    </>
  );
}
