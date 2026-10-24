"use client";

import Link from "next/link";
import type { CimacAccountAllocation, CimacCustomerAccount } from "./cimac-billing-types";
import { billingCategory, billingNumber } from "./cimac-billing-display";
import { buildLeaseCollectionHref } from "@/features/leases/lease-collection-links";
import styles from "./cimac-customer-workbench.module.css";

export function CimacCustomerReceipts({
  data,
  locale,
  returnHref,
}: {
  data: CimacCustomerAccount;
  locale: "zh" | "fr";
  returnHref: string;
}) {
  const text = (zh: string, fr: string) => (locale === "zh" ? zh : fr);
  const base = locale === "fr" ? "/fr" : "";
  const oldLedger = `${base}/finance?kind=ledger&projectId=${encodeURIComponent(data.project.id)}`;
  const units = new Map(data.units.map((unit) => [unit.id, unit]));
  const receivablesById = new Map(data.receivables.map((row) => [row.id, row]));
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
          <section className={`${styles.panel} ${styles.receipt}`} key={payment.id}>
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
                {payment.reversal_of_payment_id
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
                {text("实际收款人", "Encaisseur")}：
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
            {payment.protected_collection || payment.source_type === "cimac_customer_collection" ? (
              <p className={styles.note}>
                {text(
                  "客户总账收款已受核销保护；不能使用旧单房修改、退款或冲正入口。客户级更正流程尚未开放，需要时先核对完整分账并联系管理员处理。",
                  "Cet encaissement est protégé par ses imputations. Les anciennes opérations par lot (modification, remboursement, annulation) ne s’appliquent pas. La correction multi-contrats n’est pas encore ouverte ; faites vérifier toutes les affectations avec l’administrateur.",
                )}
              </p>
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
