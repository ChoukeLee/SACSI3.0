"use client";

import { useRef, useState, type FormEvent } from "react";
import type { CimacCollectionInput, CimacCustomerAccount } from "./cimac-billing-types";
import { recordCimacCollection } from "./cimac-billing-actions";
import { CimacWriteFeedback, useCimacWrite } from "./cimac-write-form";
import {
  billingCategory,
  billingMinor,
  billingMinorString,
  billingNumber,
} from "./cimac-billing-display";
import styles from "./cimac-customer-workbench.module.css";

export function CimacCollectionPanel({
  data,
  locale,
  viewerId,
  today,
  canWrite,
  onClose,
}: {
  data: CimacCustomerAccount;
  locale: "zh" | "fr";
  viewerId: string;
  today: string;
  canWrite: boolean;
  onClose: () => void;
}) {
  const text = (zh: string, fr: string) => (locale === "zh" ? zh : fr);
  const [amount, setAmount] = useState("");
  const [paymentDate, setPaymentDate] = useState(today);
  const [method, setMethod] = useState<CimacCollectionInput["paymentMethod"] | "">("");
  const [receiptNo, setReceiptNo] = useState("");
  const [collector, setCollector] = useState("");
  const [basis, setBasis] = useState("");
  const [notes, setNotes] = useState("");
  const [allocations, setAllocations] = useState<Record<string, string>>({});
  const [validation, setValidation] = useState("");
  const feedback = useRef<HTMLDivElement>(null);
  const write = useCimacWrite<CimacCollectionInput>({
    kind: "collection",
    viewerId,
    customerId: data.selectedCustomerId!,
    locale,
    action: recordCimacCollection,
  });
  const bills = data.receivables.filter(
    (row) => row.collectible && row.currency === "XOF" && row.category !== "lease_deposit",
  );
  const amountMinor = billingMinor(amount);
  const allocationEntries = bills.map((bill) => ({
    bill,
    raw: allocations[bill.id] ?? "",
    minor: allocations[bill.id] ? billingMinor(allocations[bill.id]) : BigInt(0),
  }));
  const allocationValid = allocationEntries.every((entry) => entry.minor !== null);
  const total = allocationValid
    ? allocationEntries.reduce((sum, entry) => sum + entry.minor!, BigInt(0))
    : null;
  const remainder = total !== null && amountMinor !== null ? amountMinor - total : null;
  const selectedEntries = allocationEntries.filter(
    (entry) => entry.minor !== null && entry.minor > BigInt(0),
  );
  const units = new Map(data.units.map((unit) => [unit.id, unit]));
  const contracts = new Map(data.contracts.map((contract) => [contract.id, contract]));
  const submitted = useRef<CimacCollectionInput | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!canWrite || write.locked) return;
    let error = "";
    if (
      !amountMinor ||
      amountMinor % BigInt(100) !== BigInt(0) ||
      !method ||
      !/^\d{4}-\d{2}-\d{2}$/.test(paymentDate) ||
      paymentDate > today
    )
      error = text(
        "请填写实际收款日期、方式和大于零的 XOF 整数金额。",
        "Renseignez la date réelle, le mode et un montant XOF entier positif.",
      );
    else if (
      !allocationValid ||
      !selectedEntries.length ||
      total !== amountMinor ||
      selectedEntries.some(
        (entry) =>
          entry.minor! % BigInt(100) !== BigInt(0) ||
          billingMinor(entry.bill.outstanding) === null ||
          entry.minor! > billingMinor(entry.bill.outstanding)!,
      )
    )
      error = text(
        "分账须为 XOF 整数、不超过各账单余额，且合计等于实收。请明确分配，不自动猜用途。",
        "Les affectations XOF doivent être entières, ne pas dépasser les soldes et égaler l’encaissement. Précisez leur destination.",
      );
    else if (!!collector.trim() !== !!basis.trim())
      error = text(
        "实际收款人与核实依据需同时填写；不知道可都留空，不用录入人代替。",
        "Indiquez ensemble l’encaisseur et sa source, ou laissez les deux vides si inconnus, sans utiliser l’opérateur par défaut.",
      );
    setValidation(error);
    if (error || !method) {
      requestAnimationFrame(() => feedback.current?.focus());
      return;
    }
    const input: CimacCollectionInput = {
      customerId: data.selectedCustomerId!,
      amount: billingMinorString(amountMinor!),
      currency: "XOF",
      paymentDate,
      paymentMethod: method,
      ...(receiptNo.trim() ? { externalReceiptNo: receiptNo.trim() } : {}),
      ...(collector.trim()
        ? { actualCollector: collector.trim(), collectorBasis: basis.trim() }
        : {}),
      ...(notes.trim() ? { notes: notes.trim() } : {}),
      allocations: selectedEntries.map((entry) => ({
        receivableId: entry.bill.id,
        amount: billingMinorString(entry.minor!),
        expectedOutstanding: entry.bill.outstanding,
        expectedUpdatedAt: entry.bill.updated_at,
      })),
    };
    submitted.current = input;
    await write.submit(input);
    requestAnimationFrame(() => feedback.current?.focus());
  }

  return (
    <section
      className={styles.allocation}
      aria-label={text("一笔收款分配到多份合同", "Un encaissement affecté à plusieurs contrats")}
    >
      <div className={styles.profileTop}>
        <div>
          <h2>{text("登记实收，明确分账", "Enregistrer et affecter l’encaissement")}</h2>
          <p className={styles.subtitle}>
            {text(
              "仅核销当前客户已有的可收 XOF 账单，不出新账、不挪押金、不换汇。",
              "Créances XOF existantes du client uniquement ; aucune nouvelle créance, utilisation de dépôt ou conversion.",
            )}
          </p>
        </div>
        <button
          type="button"
          className={styles.quietButton}
          disabled={write.phase === "submitting"}
          onClick={onClose}
        >
          {write.phase === "unknown"
            ? text("收起，保留未核操作号", "Fermer en conservant l’opération")
            : text("关闭", "Fermer")}
        </button>
      </div>
      <div ref={feedback} tabIndex={-1}>
        <CimacWriteFeedback
          state={write}
          locale={locale}
          onRetry={() => submitted.current && void write.submit(submitted.current)}
        />
        {validation ? (
          <p role="alert" className={styles.feedback}>
            {validation}
          </p>
        ) : null}
      </div>
      <form onSubmit={(event) => void submit(event)}>
        <fieldset className={styles.fieldset} disabled={write.locked || !canWrite}>
          <div className={styles.formColumns}>
            <label className={styles.field}>
              <span>{text("实际收到 · XOF", "Somme réellement reçue · XOF")}</span>
              <input
                className={styles.input}
                inputMode="numeric"
                type="number"
                min="1"
                step="1"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                required
              />
            </label>
            <label className={styles.field}>
              <span>{text("实际收款日期", "Date réelle d’encaissement")}</span>
              <input
                className={styles.input}
                type="date"
                max={today}
                value={paymentDate}
                onChange={(event) => setPaymentDate(event.target.value)}
                required
              />
            </label>
            <label className={styles.field}>
              <span>{text("实际收款方式", "Moyen d’encaissement réel")}</span>
              <select
                className={styles.select}
                value={method}
                onChange={(event) => setMethod(event.target.value as typeof method)}
                required
              >
                <option value="">{text("请选择", "Choisir")}</option>
                <option value="cash">{text("现金", "Espèces")}</option>
                <option value="check">{text("支票", "Chèque")}</option>
                <option value="bank_transfer">{text("银行转账", "Virement bancaire")}</option>
                <option value="other">{text("其他", "Autre")}</option>
              </select>
            </label>
            <label className={styles.field}>
              <span>
                {text("原始凭证 / 收据号，可留空", "Référence du justificatif, facultative")}
              </span>
              <input
                className={styles.input}
                maxLength={200}
                value={receiptNo}
                onChange={(event) => setReceiptNo(event.target.value)}
              />
            </label>
          </div>
          <div>
            <div className={`${styles.allocationRow} ${styles.note}`}>
              <span>{text("已有账单", "Créance existante")}</span>
              <span className={styles.number}>{text("可核销余额", "Solde disponible")}</span>
              <span className={styles.number}>{text("本次分配 · XOF", "Affectation · XOF")}</span>
            </div>
            {bills.map((bill) => (
              <div className={styles.allocationRow} key={bill.id}>
                <div>
                  {units.get(bill.unit_id ?? "")?.unit_no || text("房屋待核", "Lot à vérifier")} ·{" "}
                  {billingCategory(bill.category, locale)}
                  <p className={styles.meta}>
                    {contracts.get(bill.source_id ?? "")?.contractNo || bill.title}
                  </p>
                </div>
                <span className={`${styles.number} ${styles.muted}`}>
                  {billingNumber(bill.outstanding, locale)}
                </span>
                <label className={styles.field}>
                  <span
                    className={styles.srOnly}
                  >{`${bill.title} ${text("分配金额", "montant affecté")}`}</span>
                  <input
                    className={styles.input}
                    type="number"
                    inputMode="numeric"
                    min="0"
                    max={bill.outstanding}
                    step="1"
                    value={allocations[bill.id] ?? ""}
                    onChange={(event) =>
                      setAllocations((current) => ({ ...current, [bill.id]: event.target.value }))
                    }
                  />
                </label>
              </div>
            ))}
            {!bills.length ? (
              <p className={styles.empty}>
                {text("当前没有可核销的 XOF 应收。", "Aucune créance XOF disponible.")}
              </p>
            ) : null}
          </div>
          <details>
            <summary>{text("收款人依据与备注", "Encaisseur, source et note")}</summary>
            <div className={styles.form}>
              <div className={styles.formColumns}>
                <label className={styles.field}>
                  <span>
                    {text("实际收款人，不知道可留空", "Encaisseur, laisser vide si inconnu")}
                  </span>
                  <input
                    className={styles.input}
                    maxLength={100}
                    value={collector}
                    onChange={(event) => setCollector(event.target.value)}
                  />
                </label>
                <label className={styles.field}>
                  <span>{text("收款人核实依据", "Source de vérification de l’encaisseur")}</span>
                  <input
                    className={styles.input}
                    maxLength={1000}
                    value={basis}
                    onChange={(event) => setBasis(event.target.value)}
                  />
                </label>
              </div>
              <label className={styles.field}>
                <span>{text("备注", "Note")}</span>
                <textarea
                  className={styles.input}
                  maxLength={2000}
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                />
              </label>
            </div>
          </details>
          <p className={styles.note}>
            {text(
              "录入账号由当前登录身份审计记录，与实际收款人分开。仅登记已经实际收到的钱；服务器会再次核验余额和归属。",
              "L’opérateur connecté est audité séparément de l’encaisseur. Enregistrez uniquement des fonds réellement reçus ; soldes et rattachements seront revérifiés.",
            )}
          </p>
        </fieldset>
        <div className={styles.allocationFooter}>
          <div className={styles.note}>
            {text("已分配", "Affecté")}{" "}
            <strong>
              {total === null ? "—" : billingNumber(billingMinorString(total), locale)}
            </strong>{" "}
            · {text("未分配差额", "Écart")}{" "}
            <strong>
              {remainder === null ? "—" : billingNumber(billingMinorString(remainder), locale)}
            </strong>{" "}
            XOF
          </div>
          <button
            type="submit"
            className={styles.primaryButton}
            disabled={!canWrite || write.locked || !bills.length}
          >
            {write.phase === "submitting"
              ? text("正在核验并入账…", "Vérification et enregistrement…")
              : text("登记这笔实收并核销", "Enregistrer et imputer")}
          </button>
        </div>
      </form>
    </section>
  );
}
