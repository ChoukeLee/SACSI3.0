"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { ArrowLeft, ArrowUpRight, Check, CheckCircle2, Loader2, ReceiptText } from "lucide-react";
import { runFinanceRequest } from "@/features/finance/finance-request";
import { clearBusinessRequestIdentity } from "@/lib/business-request-identity";
import type { CustomerRow, LeaseContractRow, ReceivableRow, UnitRow } from "@/types/database";
import { readLeaseCollectionReceipt, recordLeaseCollection } from "./lease-collection-actions";
import { readLeaseCollectionPending } from "./lease-collection-pending";
import {
  buildLeaseCollectionSubmission,
  formatCollectionMoneyInput,
  getLeaseCollectionBills,
  getLeaseCollectionCoverageProposal,
  moneyMinor,
  parseCollectionMoney,
  type LeaseCollectionDraft,
} from "./lease-collection-model";
import type { LeaseCollectionInput, LeaseCollectionSuccess } from "./lease-collection-types";
import styles from "./lease-collection.module.css";

export interface LeaseCollectionWorkbenchProps {
  contract: LeaseContractRow;
  unit: UnitRow;
  customer: CustomerRow;
  buildingLabel: string;
  receivables: ReceivableRow[];
  recordedByLabel: string;
  viewerId: string;
  writeReady: boolean;
  returnHref: string;
  locale: "zh" | "fr";
  today: string;
}

type Submission = Omit<LeaseCollectionInput, "requestId">;
type Phase = "checking" | "editing" | "submitting" | "unknown" | "rejected" | "success";

export function LeaseCollectionWorkbench(props: LeaseCollectionWorkbenchProps) {
  return <CollectionContent key={`${props.viewerId}:${props.contract.id}`} {...props} />;
}

function CollectionContent({
  contract,
  unit,
  customer,
  buildingLabel,
  receivables,
  recordedByLabel,
  viewerId,
  writeReady,
  returnHref,
  locale,
  today,
}: LeaseCollectionWorkbenchProps) {
  const text = (zh: string, fr: string) => (locale === "zh" ? zh : fr);
  const requestTarget = `${viewerId}:${contract.id}`;
  const id = useId();
  const [draft, setDraft] = useState<LeaseCollectionDraft>(() => ({
    currency: "XOF",
    amount: "",
    amountUnit: "unit",
    paymentDate: today,
    paymentMethod: "",
    externalReceiptNo: "",
    actualCollector: "",
    collectorBasis: "",
    notes: "",
    allocations: {},
    syncPaidThrough: false,
  }));
  const [confirmed, setConfirmed] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [phase, setPhase] = useState<Phase>("checking");
  const [message, setMessage] = useState("");
  const [receipt, setReceipt] = useState<LeaseCollectionSuccess | null>(null);
  const [pendingRequestId, setPendingRequestId] = useState<string | null>(null);
  const [recoveryBusy, setRecoveryBusy] = useState(false);
  const [recoveryMessage, setRecoveryMessage] = useState("");
  const busy = useRef(false);
  const recovering = useRef(false);
  const mounted = useRef(true);
  const pendingInput = useRef<Submission | null>(null);
  const feedback = useRef<HTMLDivElement>(null);
  const { bills, excludedCount } = getLeaseCollectionBills(contract, receivables, unit.building_id);
  const currencyBills = bills.filter((bill) => bill.currency === draft.currency);
  const visibleBills = showAll
    ? currencyBills
    : currencyBills.filter((bill, index) => index < 3 || bill.id in draft.allocations);
  const selectedBills = currencyBills.filter((bill) => bill.id in draft.allocations);
  const locked =
    phase === "checking" || phase === "submitting" || phase === "unknown" || phase === "success";
  const coverageProposal = getLeaseCollectionCoverageProposal(
    contract,
    receivables,
    draft,
    today,
    unit.building_id,
  );
  const syncPaidThrough = draft.syncPaidThrough === true && coverageProposal !== null;
  const validation = buildLeaseCollectionSubmission(
    contract,
    receivables,
    { ...draft, syncPaidThrough },
    today,
    unit.building_id,
  );
  const issues = !validation.ok && attempted ? validation.issues : [];
  const amount = parseCollectionMoney(draft.amount, draft.amountUnit);
  const allocationValues = selectedBills.map((bill) => ({
    bill,
    amount: parseCollectionMoney(draft.allocations[bill.id]),
  }));
  const allocationInvalid = allocationValues.some((line) => line.amount === null);
  const allocatedMinor = allocationValues.reduce(
    (sum, line) => sum + (moneyMinor(line.amount ?? 0) ?? 0),
    0,
  );
  const allocated =
    allocationInvalid || !Number.isSafeInteger(allocatedMinor) ? null : allocatedMinor / 100;
  const amountMinor = amount === null ? null : moneyMinor(amount);
  const difference =
    amountMinor !== null && allocated !== null ? (amountMinor - allocatedMinor) / 100 : null;
  const categoryAmount = (category: "lease_rent" | "property_fee") => {
    const values = allocationValues.filter((line) => line.bill.category === category);
    if (values.some((line) => line.amount === null)) return null;
    const sum = values.reduce((total, line) => total + (moneyMinor(line.amount ?? 0) ?? 0), 0);
    return Number.isSafeInteger(sum) ? sum / 100 : null;
  };
  const money = (value: number | null, currency = draft.currency) =>
    value === null
      ? "—"
      : `${new Intl.NumberFormat(locale === "zh" ? "zh-CN" : "fr-FR", {
          maximumFractionDigits: 2,
        }).format(value)} ${currency}`;
  const currencies = [
    "XOF",
    ...(contract.rent_currency && contract.rent_currency !== "XOF" ? [contract.rent_currency] : []),
  ] as LeaseCollectionDraft["currency"][];

  useEffect(() => {
    mounted.current = true;
    let pending: ReturnType<typeof readLeaseCollectionPending>;
    try {
      pending = readLeaseCollectionPending(viewerId, contract.id, sessionStorage);
    } catch {
      pending = { status: "unavailable" };
    }
    if (pending.status === "pending") {
      setPendingRequestId(pending.requestId);
      setMessage(
        locale === "zh"
          ? "检测到一笔结果尚未核实的收款操作。请先查询该操作号的已入账回执。"
          : "Une opération d’encaissement reste à vérifier. Recherchez d’abord son reçu enregistré.",
      );
      setPhase("unknown");
    } else if (pending.status === "unavailable") {
      setMessage(
        locale === "zh"
          ? "本地未完成操作标识无法安全读取。请保留当前页面并联系核对，不要另起收款。"
          : "L’identifiant local d’une opération en attente est illisible. Faites vérifier la situation sans créer un nouvel encaissement.",
      );
      setPhase("unknown");
    } else {
      setPhase("editing");
    }
    return () => {
      mounted.current = false;
    };
  }, [contract.id, viewerId, locale]);

  function update<K extends keyof LeaseCollectionDraft>(key: K, value: LeaseCollectionDraft[K]) {
    if (locked) return;
    setDraft((current) => ({
      ...current,
      [key]: value,
      ...(key === "allocations" || key === "currency" ? { syncPaidThrough: false } : {}),
    }));
    setConfirmed(false);
    if (phase === "rejected") setPhase("editing");
    setMessage("");
  }

  function changeCurrency(currency: LeaseCollectionDraft["currency"]) {
    if (locked || currency === draft.currency) return;
    setDraft((current) => ({
      ...current,
      currency,
      amount: "",
      amountUnit: "unit",
      allocations: {},
      syncPaidThrough: false,
    }));
    setConfirmed(false);
    setAttempted(false);
    setMessage("");
  }

  function changeAmountUnit(amountUnit: LeaseCollectionDraft["amountUnit"]) {
    if (locked || amountUnit === draft.amountUnit) return;
    const base = parseCollectionMoney(draft.amount, draft.amountUnit);
    setDraft((current) => ({
      ...current,
      amountUnit,
      amount: base === null ? "" : formatCollectionMoneyInput(base, amountUnit),
    }));
    setConfirmed(false);
  }

  function toggleBill(billId: string, outstanding: number) {
    if (locked) return;
    const allocations = { ...draft.allocations };
    if (billId in allocations) delete allocations[billId];
    else allocations[billId] = String(outstanding);
    update("allocations", allocations);
  }

  const issueLabels: Record<string, string> = {
    invalid_amount: text(
      "金额格式无效：基础单位最多两位小数，万西法最多六位小数。",
      "Montant invalide : deux décimales en unité de base, six pour l’unité de 10 000 XOF.",
    ),
    required: text(
      "请补充必填内容，并选择实际收款方式。",
      "Complétez les champs obligatoires et le moyen d’encaissement réel.",
    ),
    unsupported_currency: text(
      "本合同不支持该收款币种。",
      "Cette devise n’est pas disponible pour ce contrat.",
    ),
    unsupported_unit: text(
      "只有西法金额可以使用万西法单位。",
      "L’unité de 10 000 n’est disponible qu’en XOF.",
    ),
    invalid_date: text("请填写有效的收款日期。", "Indiquez une date d’encaissement valide."),
    future_date: text(
      "实际收款日期不能晚于今天。",
      "La date d’encaissement ne peut pas être future.",
    ),
    unavailable_receivable: text(
      "所选账单已不可核销，请刷新核对应收。",
      "Une créance sélectionnée n’est plus disponible. Actualisez pour vérifier.",
    ),
    currency_mismatch: text(
      "一笔实收只能分配给同币种账单。",
      "Un encaissement ne peut couvrir que des créances de la même devise.",
    ),
    exceeds_balance: text(
      "核销金额超过账单未收余额。",
      "Le montant affecté dépasse le solde de la créance.",
    ),
    unallocated: text("请至少选择一笔已建账单。", "Sélectionnez au moins une créance existante."),
    amount_mismatch: text(
      "账单核销合计必须与本次实收完全相等。",
      "Le total affecté doit être égal au montant encaissé.",
    ),
    too_many_allocations: text(
      "所选账单过多，请分笔核对办理。",
      "Trop de créances sélectionnées. Traitez-les séparément.",
    ),
    collector_basis_required: text(
      "填写实际收款人时，也请说明核实依据。",
      "Précisez la source de vérification de l’encaisseur indiqué.",
    ),
    collector_required: text(
      "填写收款人依据时，也请说明依据指向的实际收款人。",
      "Précisez l’encaisseur auquel se rapporte la source de vérification.",
    ),
    too_long: text(
      "补充说明过长，请缩短后再提交。",
      "Une information complémentaire est trop longue. Réduisez-la avant l’envoi.",
    ),
    invalid_contract: text(
      "合同资料不完整，暂不能收款。",
      "Les données du contrat sont incomplètes. Encaissement indisponible.",
    ),
    coverage_unavailable: text(
      "所选账期不足以核实连续完整覆盖，不能同步缴至日期；仍可仅登记实收。",
      "Les périodes sélectionnées ne prouvent pas une couverture complète et continue. Vous pouvez enregistrer l’encaissement sans modifier la couverture.",
    ),
  };

  async function submit(event?: FormEvent) {
    event?.preventDefault();
    if (!writeReady) return;
    if (busy.current || recovering.current || phase === "success" || phase === "checking") return;
    setAttempted(true);
    const retry = phase === "unknown";
    if (!retry && (!validation.ok || !confirmed)) {
      setMessage("");
      requestAnimationFrame(() => feedback.current?.focus());
      return;
    }
    const input = retry ? pendingInput.current : validation.ok ? validation.input : null;
    if (!input) return;
    busy.current = true;
    pendingInput.current = input;
    setPhase("submitting");
    setMessage("");
    try {
      const result = await runFinanceRequest(
        "lease_collection",
        requestTarget,
        input,
        (requestId) => {
          if (mounted.current) setPendingRequestId(requestId);
          return recordLeaseCollection({ ...input, requestId });
        },
      );
      if (!mounted.current) return;
      if (result.success) {
        setReceipt(result);
        setPhase("success");
        pendingInput.current = null;
      } else {
        setMessage(result.error);
        setPhase(result.rejected ? "rejected" : "unknown");
        if (result.rejected) pendingInput.current = null;
      }
    } catch (error) {
      if (!mounted.current) return;
      setMessage(
        error instanceof Error
          ? error.message
          : text(
              "结果未知，请保留原内容重试。",
              "Résultat inconnu. Réessayez sans modifier le contenu.",
            ),
      );
      setPhase("unknown");
    } finally {
      busy.current = false;
      if (mounted.current) requestAnimationFrame(() => feedback.current?.focus());
    }
  }

  async function recoverReceipt() {
    if (!pendingRequestId || busy.current || recovering.current) return;
    recovering.current = true;
    setRecoveryBusy(true);
    setRecoveryMessage("");
    try {
      const result = await readLeaseCollectionReceipt(pendingRequestId);
      if (!mounted.current) return;
      if (result.status === "found") {
        if (result.contractId !== contract.id || result.receipt.requestId !== pendingRequestId) {
          setRecoveryMessage(
            text(
              "回执与当前合同或操作号不一致，暂不解除锁定。请联系核对。",
              "Le reçu ne correspond pas au contrat ou à l’opération. Le verrouillage est conservé ; faites vérifier la situation.",
            ),
          );
          return;
        }
        const pending = readLeaseCollectionPending(viewerId, contract.id, sessionStorage);
        if (pending.status !== "pending" || pending.requestId !== pendingRequestId) {
          setRecoveryMessage(
            text(
              "本地操作标识已变化，未清除任何未完成操作。请联系核对。",
              "L’identifiant local a changé. Aucune opération en attente n’a été effacée ; faites vérifier la situation.",
            ),
          );
          return;
        }
        clearBusinessRequestIdentity("finance", "lease_collection", requestTarget);
        setReceipt(result.receipt);
        pendingInput.current = null;
        setMessage("");
        setPhase("success");
      } else if (result.status === "not_found") {
        setRecoveryMessage(
          text(
            "暂未查到已入账回执，原请求仍可能正在处理。这不代表没有入账；操作号已保留，请稍后重查或联系核对，不要另起一笔。",
            "Aucun reçu enregistré trouvé pour le moment ; la requête peut encore être en cours. Cela ne prouve pas l’absence d’enregistrement. L’identifiant est conservé : réessayez la recherche ou faites vérifier, sans créer un autre paiement.",
          ),
        );
      } else {
        setRecoveryMessage(
          result.error ||
            text(
              "回执暂时不可查询，原操作号已保留。",
              "Le reçu est momentanément indisponible. L’identifiant d’origine est conservé.",
            ),
        );
      }
    } catch {
      if (mounted.current)
        setRecoveryMessage(
          text(
            "回执查询暂时失败，原操作号已保留。请稍后重查。",
            "La recherche du reçu a échoué. L’identifiant est conservé ; réessayez plus tard.",
          ),
        );
    } finally {
      recovering.current = false;
      if (mounted.current) {
        setRecoveryBusy(false);
        requestAnimationFrame(() => feedback.current?.focus());
      }
    }
  }

  return (
    <main className={styles.workbench}>
      <header className={styles.header}>
        <Link href={returnHref} className={styles.back}>
          <ArrowLeft aria-hidden="true" />
          {text("返回原合同", "Revenir au contrat")}
        </Link>
        <div className={styles.titleRow}>
          <div>
            <p className={styles.eyebrow}>{text("长租 · 实收登记", "LOCATION · ENCAISSEMENT")}</p>
            <h1>{text("把这笔收款，准确入账", "Enregistrer un encaissement vérifié")}</h1>
            <p className={styles.subtitle}>
              {text(
                "核对实收，再分配到已有账单；不把应收当作已收。",
                "Vérifiez la réception réelle puis affectez-la aux créances existantes.",
              )}
            </p>
          </div>
          <span className={styles.headerBadge}>
            <ReceiptText aria-hidden="true" />
            {text("合同收款", "Encaissement du bail")}
          </span>
        </div>
        <div className={styles.context}>
          <strong>
            {buildingLabel} · {unit.unit_no}
          </strong>
          <span>{customer.name}</span>
          <span className={styles.contractNo}>{contract.contract_no}</span>
        </div>
      </header>

      <div ref={feedback} tabIndex={-1} className={styles.feedback}>
        {!writeReady ? (
          <section role="status" className={styles.warning}>
            <p>
              {text(
                "当前收款服务尚未启用，本页可预览核对，不能提交入账。",
                "Le service d’encaissement n’est pas encore activé. Cette page permet la saisie de prévisualisation et la vérification, mais aucun enregistrement.",
              )}
            </p>
          </section>
        ) : null}
        {phase === "checking" ? (
          <p role="status" className={styles.hint}>
            {text(
              "正在核对本机是否有未完成的收款操作…",
              "Vérification des opérations d’encaissement en attente sur cet appareil…",
            )}
          </p>
        ) : null}
        {phase === "success" && receipt ? (
          <section role="status" className={styles.success}>
            <CheckCircle2 aria-hidden="true" />
            <div>
              <h2>{text("已完成入账", "Encaissement enregistré")}</h2>
              <p>{text("以下是服务器确认的实际入账结果。", "Résultat confirmé par le serveur.")}</p>
              <p className={styles.receiptTotal}>{money(receipt.totalAmount, receipt.currency)}</p>
              <dl className={styles.receiptFacts}>
                <div>
                  <dt>{text("系统凭证号", "Références système")}</dt>
                  <dd>{receipt.referenceNos.join(" · ")}</dd>
                </div>
                <div>
                  <dt>{text("操作号", "Identifiant de l’opération")}</dt>
                  <dd>{receipt.requestId}</dd>
                </div>
                <div>
                  <dt>{text("入账前登记覆盖至", "Couverture enregistrée avant")}</dt>
                  <dd>{receipt.paidThroughBefore ?? text("未登记", "Non renseignée")}</dd>
                </div>
                <div>
                  <dt>{text("入账后登记覆盖至", "Couverture enregistrée après")}</dt>
                  <dd>{receipt.paidThroughAfter ?? text("未登记", "Non renseignée")}</dd>
                </div>
              </dl>
              <details className={styles.technicalReceipt}>
                <summary>
                  {text("查看收款记录编号", "Voir les identifiants des encaissements")}
                </summary>
                <ul>
                  {receipt.paymentIds.map((paymentId) => (
                    <li key={paymentId}>{paymentId}</li>
                  ))}
                </ul>
              </details>
              <ul className={styles.receiptLines}>
                {receipt.allocations.map((allocation) => {
                  const bill = bills.find((item) => item.id === allocation.receivableId);
                  return (
                    <li key={allocation.receivableId}>
                      <span>{bill?.title || allocation.receivableId}</span>
                      <strong>{money(allocation.amount, receipt.currency)}</strong>
                    </li>
                  );
                })}
              </ul>
              <div className={styles.receiptLinks}>
                <Link href={returnHref}>
                  {text("返回合同查看", "Revenir au contrat")}
                  <ArrowUpRight aria-hidden="true" />
                </Link>
                {receipt.referenceNos[0] ? (
                  <Link
                    href={`${locale === "fr" ? "/fr" : ""}/finance?kind=ledger&search=${encodeURIComponent(receipt.referenceNos[0])}`}
                  >
                    {text("按凭证号查看财务记录", "Rechercher la référence dans le journal")}
                    <ArrowUpRight aria-hidden="true" />
                  </Link>
                ) : null}
              </div>
              <p className={styles.hint}>
                {text(
                  `已确认 ${receipt.paymentIds.length} 条收款记录；${receipt.paidThroughBefore === receipt.paidThroughAfter ? "登记覆盖日期未变更" : "登记覆盖日期已按本次核实的完整账期同步"}。下期账单安排待确认，本次未生成新应收。`,
                  `${receipt.paymentIds.length} écriture(s) confirmée(s). ${receipt.paidThroughBefore === receipt.paidThroughAfter ? "La couverture enregistrée n’a pas changé" : "La couverture enregistrée a été mise à jour selon les périodes complètes vérifiées"}. Les prochaines créances restent à vérifier ; aucune nouvelle créance n’a été créée.`,
                )}
              </p>
            </div>
          </section>
        ) : null}
        {phase === "unknown" ? (
          <section role="alert" className={styles.warning}>
            <h2>
              {text("暂时无法确认是否已经入账", "Résultat de l’enregistrement encore inconnu")}
            </h2>
            <p>
              {text(
                "内容已锁定。请按原操作重试，系统将使用同一操作号核对，不要另起一笔。",
                "Le contenu est verrouillé. Réessayez avec la même opération ; ne créez pas un nouvel encaissement.",
              )}
            </p>
            <p className={styles.errorDetail}>{message}</p>
            {pendingRequestId ? (
              <>
                <p className={styles.pendingId}>
                  {text("待核操作号", "Opération à vérifier")} : <code>{pendingRequestId}</code>
                </p>
                <button
                  className={styles.retry}
                  type="button"
                  disabled={recoveryBusy}
                  onClick={() => void recoverReceipt()}
                >
                  {recoveryBusy
                    ? text("正在查询回执…", "Recherche du reçu…")
                    : text("查询已入账回执", "Rechercher le reçu enregistré")}
                </button>
              </>
            ) : null}
            {pendingInput.current ? (
              <button
                className={styles.retry}
                type="button"
                disabled={recoveryBusy || !writeReady}
                onClick={() => void submit()}
              >
                {text("按原操作号核对 / 重试", "Vérifier / Réessayer la même opération")}
              </button>
            ) : (
              <p>
                {text(
                  "重新打开页面后不会还原敏感表单内容；只能先核对原操作回执，不能凭空重建一笔收款。",
                  "Après réouverture, les données sensibles du formulaire ne sont pas restaurées. Vérifiez le reçu d’origine ; ne reconstituez pas un nouveau paiement.",
                )}
              </p>
            )}
            {recoveryMessage ? <p role="status">{recoveryMessage}</p> : null}
          </section>
        ) : null}
        {phase === "rejected" ? (
          <section role="alert" className={styles.warning}>
            <h2>{text("本次未提交成功", "Cette tentative n’a pas été enregistrée")}</h2>
            <p>{message}</p>
            <p>
              {text(
                "如提示账单已变化，请返回合同重新读取后再办理。",
                "Si les créances ont changé, revenez au contrat pour les recharger avant de poursuivre.",
              )}
            </p>
          </section>
        ) : null}
        {issues.length || (attempted && !confirmed && phase === "editing") ? (
          <div role="alert" className={styles.validation}>
            <strong>{text("还有几项需要核对", "Vérifications nécessaires")}</strong>
            <ul>
              {[...new Set(issues.map((issue) => issue.code))].map((code) => (
                <li key={code}>
                  {issueLabels[code] ||
                    text("请核对填写内容。", "Vérifiez les informations saisies.")}
                </li>
              ))}
              {!confirmed ? (
                <li>
                  {text(
                    "请确认这笔钱已经实际收到。",
                    "Confirmez que cette somme a réellement été reçue.",
                  )}
                </li>
              ) : null}
            </ul>
          </div>
        ) : null}
      </div>

      {phase !== "success" ? (
        <form className={styles.layout} onSubmit={(event) => void submit(event)} noValidate>
          <fieldset disabled={locked} className={styles.fields}>
            <section className={styles.panel} aria-labelledby={`${id}-amount-heading`}>
              <div className={styles.panelTitle}>
                <span className={styles.step}>1</span>
                <div>
                  <h2 id={`${id}-amount-heading`}>
                    {text("这次实际收到了多少", "Quel montant a réellement été reçu ?")}
                  </h2>
                  <p>
                    {text(
                      "只填写已经收到的钱，不是合同金额或待收金额。",
                      "Uniquement la somme effectivement reçue, pas le montant prévu ou à recevoir.",
                    )}
                  </p>
                </div>
              </div>
              <div className={styles.amountControls}>
                <label className={styles.field}>
                  <span>{text("收款币种", "Devise reçue")}</span>
                  <select
                    value={draft.currency}
                    onChange={(event) =>
                      changeCurrency(event.target.value as LeaseCollectionDraft["currency"])
                    }
                  >
                    {currencies.map((currency) => (
                      <option value={currency} key={currency}>
                        {currency === "XOF" ? text("XOF · 西法", "XOF · Franc CFA") : currency}
                      </option>
                    ))}
                  </select>
                </label>
                {draft.currency === "XOF" ? (
                  <div
                    className={styles.unitChoice}
                    role="group"
                    aria-label={text("金额单位", "Unité du montant")}
                  >
                    <button
                      type="button"
                      aria-pressed={draft.amountUnit === "unit"}
                      onClick={() => changeAmountUnit("unit")}
                    >
                      XOF
                    </button>
                    <button
                      type="button"
                      aria-pressed={draft.amountUnit === "wan"}
                      onClick={() => changeAmountUnit("wan")}
                    >
                      {text("万西法", "10 000 XOF")}
                    </button>
                  </div>
                ) : (
                  <p className={styles.hint}>
                    {text(
                      "按原币入账，不折算为西法。物业费请另笔登记。",
                      "Enregistrement dans la devise d’origine, sans conversion XOF. Enregistrez les charges séparément.",
                    )}
                  </p>
                )}
              </div>
              <label className={`${styles.field} ${styles.amountField}`} htmlFor={`${id}-amount`}>
                <span>{text("本次实收金额", "Montant encaissé")}</span>
                <div className={styles.amountInput}>
                  <input
                    id={`${id}-amount`}
                    inputMode="decimal"
                    autoComplete="off"
                    value={draft.amount}
                    onChange={(event) => update("amount", event.target.value)}
                    placeholder="0"
                    aria-describedby={`${id}-amount-help`}
                  />
                  <span>
                    {draft.amountUnit === "wan" ? text("万西法", "× 10 000 XOF") : draft.currency}
                  </span>
                </div>
              </label>
              <p id={`${id}-amount-help`} className={styles.hint}>
                {draft.amountUnit === "wan"
                  ? text(`实际入账：${money(amount)}`, `Montant enregistré : ${money(amount)}`)
                  : text(
                      "金额使用币种基础单位，不做隐式换算。",
                      "Montant en unité de base, sans conversion implicite.",
                    )}
              </p>
              <div className={styles.fieldRow}>
                <label className={styles.field}>
                  <span>{text("实际收款日期", "Date d’encaissement réelle")}</span>
                  <input
                    type="date"
                    max={today}
                    value={draft.paymentDate}
                    onChange={(event) => update("paymentDate", event.target.value)}
                  />
                </label>
                <label className={styles.field}>
                  <span>{text("实际收款方式", "Moyen d’encaissement réel")}</span>
                  <select
                    value={draft.paymentMethod}
                    onChange={(event) =>
                      update(
                        "paymentMethod",
                        event.target.value as LeaseCollectionDraft["paymentMethod"],
                      )
                    }
                  >
                    <option value="">
                      {text("请选择，不预设", "Choisir, aucune valeur présélectionnée")}
                    </option>
                    <option value="cash">{text("现金", "Espèces")}</option>
                    <option value="bank_transfer">{text("银行转账", "Virement bancaire")}</option>
                    <option value="check">{text("支票", "Chèque")}</option>
                    <option value="other">{text("其他实际收款", "Autre encaissement réel")}</option>
                  </select>
                </label>
              </div>
            </section>

            <section className={styles.panel} aria-labelledby={`${id}-bills-heading`}>
              <div className={styles.panelTitle}>
                <span className={styles.step}>2</span>
                <div>
                  <h2 id={`${id}-bills-heading`}>
                    {text("这笔钱，用来结哪些账单", "À quelles créances affecter ce paiement ?")}
                  </h2>
                  <p>
                    {text(
                      "只分配到已有应收，可以部分核销。勾选后请核对每笔金额。",
                      "Créances existantes uniquement, affectation partielle possible. Vérifiez chaque montant après sélection.",
                    )}
                  </p>
                </div>
              </div>
              {currencyBills.length ? (
                <>
                  <div className={styles.bills}>
                    {visibleBills.map((bill) => {
                      const selected = bill.id in draft.allocations;
                      const period =
                        bill.servicePeriodStart && bill.servicePeriodEnd
                          ? `${bill.servicePeriodStart} — ${bill.servicePeriodEnd}`
                          : bill.servicePeriodEnd
                            ? text(
                                `开始待确认 — ${bill.servicePeriodEnd}`,
                                `Début à confirmer — ${bill.servicePeriodEnd}`,
                              )
                            : text("账期待确认", "Période à confirmer");
                      return (
                        <div
                          key={bill.id}
                          className={`${styles.bill} ${selected ? styles.billSelected : ""}`}
                        >
                          <label className={styles.billSelection}>
                            <input
                              type="checkbox"
                              checked={selected}
                              onChange={() => toggleBill(bill.id, bill.outstanding)}
                            />
                            <div className={styles.billInfo}>
                              <span className={styles.billCategory}>
                                {bill.category === "lease_rent"
                                  ? text("租金", "Loyer")
                                  : text("物业费", "Charges")}
                              </span>
                              <strong>{bill.title}</strong>
                              <p>{period}</p>
                              <span className={styles.hint}>
                                {text("到期日", "Échéance")} {bill.dueDate}
                              </span>
                            </div>
                            <div className={styles.billBalance}>
                              <span>{text("当前未收", "Solde à recevoir")}</span>
                              <strong>{money(bill.outstanding, bill.currency)}</strong>
                            </div>
                          </label>
                          {selected ? (
                            <label className={`${styles.field} ${styles.allocationField}`}>
                              <span>
                                {text("本次核销金额", "Montant affecté")}
                                <span className={styles.hint}> · {bill.currency}</span>
                              </span>
                              <input
                                inputMode="decimal"
                                autoComplete="off"
                                value={draft.allocations[bill.id]}
                                onChange={(event) =>
                                  update("allocations", {
                                    ...draft.allocations,
                                    [bill.id]: event.target.value,
                                  })
                                }
                                aria-label={text(
                                  `${bill.title} 本次核销金额`,
                                  `${bill.title} · Montant affecté`,
                                )}
                              />
                            </label>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                  {currencyBills.length > 3 ? (
                    <button
                      type="button"
                      className={styles.textButton}
                      onClick={() => setShowAll(!showAll)}
                    >
                      {showAll
                        ? text("收起未选账单", "Réduire les créances non sélectionnées")
                        : text(
                            `查看全部 ${currencyBills.length} 笔账单`,
                            `Voir les ${currencyBills.length} créances`,
                          )}
                    </button>
                  ) : null}
                  <div className={styles.allocationTotal}>
                    <span>
                      {text(
                        `已选 ${selectedBills.length} 笔 · 核销合计`,
                        `${selectedBills.length} créance(s) · Total affecté`,
                      )}
                    </span>
                    <strong>{money(allocated)}</strong>
                    <button
                      type="button"
                      onClick={() => {
                        if (allocated !== null && allocated > 0)
                          update("amount", formatCollectionMoneyInput(allocated, draft.amountUnit));
                      }}
                      disabled={allocated === null || allocated <= 0}
                    >
                      {text("用已选合计填写实收", "Utiliser ce total comme montant reçu")}
                    </button>
                  </div>
                </>
              ) : (
                <div className={styles.empty}>
                  <ReceiptText aria-hidden="true" />
                  <strong>
                    {text(
                      `没有可核销的 ${draft.currency} 账单`,
                      `Aucune créance disponible en ${draft.currency}`,
                    )}
                  </strong>
                  <p>
                    {text(
                      "先返回合同核对应收。本页不会补建账单，也不会把无账期的收款擅自分账。",
                      "Vérifiez d’abord les créances du contrat. Cette page ne crée pas de créance et ne devine pas l’affectation d’un paiement.",
                    )}
                  </p>
                  {bills.some((bill) => bill.currency !== draft.currency) ? (
                    <p>
                      {text(
                        `另有 ${[...new Set(bills.filter((bill) => bill.currency !== draft.currency).map((bill) => bill.currency))].join(" / ")} 账单，请切换上方收款币种查看；不同币种分笔办理。`,
                        `Des créances existent en ${[...new Set(bills.filter((bill) => bill.currency !== draft.currency).map((bill) => bill.currency))].join(" / ")}. Changez la devise ci-dessus ; traitez chaque devise séparément.`,
                      )}
                    </p>
                  ) : null}
                </div>
              )}
              {excludedCount > 0 ? (
                <p className={styles.exclusion}>
                  {text(
                    `${excludedCount} 笔币种、金额或归属资料待核的未结账单未作为可选项。`,
                    `${excludedCount} créance(s) ouvertes dont la devise, le montant ou le rattachement reste à vérifier ne sont pas proposées.`,
                  )}
                </p>
              ) : null}
              <div className={styles.coverage}>
                <label className={styles.coverageChoice}>
                  <input
                    type="checkbox"
                    checked={syncPaidThrough}
                    disabled={locked || !coverageProposal}
                    onChange={(event) => update("syncPaidThrough", event.target.checked)}
                  />
                  <span>
                    <strong>
                      {text(
                        "同时更新租金登记覆盖日期",
                        "Mettre aussi à jour la couverture du loyer",
                      )}
                    </strong>
                    {coverageProposal ? (
                      <span className={styles.coverageDates}>
                        {coverageProposal.expectedPaidThroughDate}{" "}
                        <ArrowUpRight aria-hidden="true" /> {coverageProposal.throughDate}
                      </span>
                    ) : null}
                  </span>
                </label>
                <p>
                  {coverageProposal
                    ? text(
                        "已有账期完整、连续且本次将结清。只有明确勾选才同步；服务器会再次核实。",
                        "Les périodes existantes sont complètes, continues et seront soldées. Mise à jour uniquement si vous cochez cette option, après revérification du serveur.",
                      )
                    : text(
                        "只有已核实完整账期、连续全额核销且本次含租金，才可同步。不满足时仍可登记实收，登记覆盖日期保持不变。",
                        "Cette option nécessite des périodes vérifiées, complètes et continues, entièrement soldées, avec du loyer dans ce paiement. Sinon, l’encaissement reste possible sans changer la couverture.",
                      )}
                </p>
                <p>
                  {text(
                    "下期账单安排待确认；本次不会推算或生成下期应收。",
                    "Les prochaines créances restent à vérifier ; cette opération ne les calcule ni ne les crée.",
                  )}
                </p>
              </div>
            </section>

            <details className={styles.panel}>
              <summary className={styles.detailsTitle}>
                {text("凭证与收款人信息", "Justificatif et encaisseur")}
                <span>
                  {text("按已知事实补充，不代填", "Renseigner uniquement les faits connus")}
                </span>
              </summary>
              <div className={styles.detailsBody}>
                <label className={styles.field}>
                  <span>{text("原始凭证 / 收据号", "N° du justificatif / reçu d’origine")}</span>
                  <input
                    value={draft.externalReceiptNo}
                    maxLength={200}
                    onChange={(event) => update("externalReceiptNo", event.target.value)}
                    placeholder={text(
                      "可留空，不是系统生成的凭证号",
                      "Facultatif, distinct de la référence système",
                    )}
                  />
                </label>
                <div className={styles.fieldRow}>
                  <label className={styles.field}>
                    <span>{text("实际收款人", "Personne ayant reçu les fonds")}</span>
                    <input
                      value={draft.actualCollector}
                      maxLength={100}
                      onChange={(event) => update("actualCollector", event.target.value)}
                      placeholder={text(
                        "不知道就留空，不能用录入人代替",
                        "Laisser vide si inconnu, ne pas remplacer par l’opérateur",
                      )}
                    />
                  </label>
                  <label className={styles.field}>
                    <span>{text("收款人核实依据", "Source de vérification de l’encaisseur")}</span>
                    <input
                      value={draft.collectorBasis}
                      maxLength={1000}
                      onChange={(event) => update("collectorBasis", event.target.value)}
                      placeholder={text(
                        "例如：收据签名、本人确认",
                        "Ex. signature du reçu, confirmation de la personne",
                      )}
                    />
                  </label>
                </div>
                <label className={styles.field}>
                  <span>{text("备注", "Note")}</span>
                  <textarea
                    value={draft.notes}
                    rows={3}
                    maxLength={2000}
                    onChange={(event) => update("notes", event.target.value)}
                    placeholder={text(
                      "可补充凭证来源和需要保留的说明",
                      "Origine du justificatif et précisions utiles",
                    )}
                  />
                </label>
              </div>
            </details>
          </fieldset>

          <aside
            className={styles.review}
            aria-label={text("本次入账核对", "Vérification de l’encaissement")}
          >
            <div className={styles.reviewHeader}>
              <span className={styles.eyebrow}>
                {text("入账前，最后核对", "VÉRIFICATION AVANT ENREGISTREMENT")}
              </span>
              <h2>{text("这一笔，不多也不少", "Une affectation exacte")}</h2>
            </div>
            <div className={styles.reviewBody}>
              <span className={styles.hint}>{text("实际收到", "Somme reçue")}</span>
              <p className={styles.reviewAmount}>{money(amount)}</p>
              <dl className={styles.reviewLines}>
                <div>
                  <dt>{text("分配租金", "Affecté au loyer")}</dt>
                  <dd>{money(categoryAmount("lease_rent"))}</dd>
                </div>
                <div>
                  <dt>{text("分配物业费", "Affecté aux charges")}</dt>
                  <dd>{money(categoryAmount("property_fee"))}</dd>
                </div>
                <div
                  className={styles.difference}
                  data-balanced={difference === 0 && amount !== null && amount > 0}
                >
                  <dt>{text("未分配差额", "Écart non affecté")}</dt>
                  <dd>
                    {difference === 0 && amount !== null && amount > 0 ? (
                      <Check aria-hidden="true" />
                    ) : null}
                    {money(difference)}
                  </dd>
                </div>
                <div>
                  <dt>{text("登记覆盖至", "Couverture enregistrée")}</dt>
                  <dd>
                    {syncPaidThrough && coverageProposal
                      ? coverageProposal.throughDate
                      : text("不变更", "Inchangée")}
                  </dd>
                </div>
              </dl>
              <div className={styles.operator}>
                <span>{text("当前登录录入人", "Opérateur connecté")}</span>
                <strong>{recordedByLabel}</strong>
                <p>
                  {text(
                    "录入人不等于实际收款人；身份随操作审计保存。",
                    "L’opérateur n’est pas nécessairement l’encaisseur. Son identité est conservée dans l’audit.",
                  )}
                </p>
              </div>
              <p className={styles.boundary}>
                {text(
                  syncPaidThrough
                    ? "本次登记实收并核销所选应收，并按你明确勾选的完整账期同步登记覆盖日期；不新增账单，也不自动换汇。"
                    : "本次仅登记实收并核销所选应收，登记覆盖日期不变；不新增账单，也不自动换汇。",
                  syncPaidThrough
                    ? "Cette opération enregistre le paiement, rapproche les créances choisies et met à jour la couverture selon les périodes complètes expressément choisies. Aucune nouvelle créance ni conversion de devises."
                    : "Cette opération enregistre le paiement et rapproche les créances choisies sans changer la couverture. Aucune nouvelle créance ni conversion de devises.",
                )}
              </p>
              <label className={styles.confirm}>
                <input
                  type="checkbox"
                  checked={confirmed}
                  disabled={locked}
                  onChange={(event) => setConfirmed(event.target.checked)}
                />
                <span>
                  {text(
                    "我已核实，这笔钱已经实际收到，金额、币种及分配无误。",
                    "Je confirme la réception réelle de cette somme, la devise, le montant et son affectation.",
                  )}
                </span>
              </label>
              <button
                type="submit"
                className={styles.submit}
                disabled={!writeReady || locked || currencyBills.length === 0}
              >
                {phase === "submitting" ? (
                  <Loader2 className={styles.spinner} aria-hidden="true" />
                ) : (
                  <CheckCircle2 aria-hidden="true" />
                )}
                {phase === "submitting"
                  ? text("正在核验并入账…", "Vérification et enregistrement…")
                  : text("确认实收并入账", "Confirmer et enregistrer")}
              </button>
              <p className={styles.hint}>
                {text(
                  "服务器将重新核验余额；发生变化时不会按旧金额强行入账。",
                  "Le serveur vérifie à nouveau les soldes. Toute modification bloque l’affectation des anciens montants.",
                )}
              </p>
            </div>
          </aside>
        </form>
      ) : null}
    </main>
  );
}
