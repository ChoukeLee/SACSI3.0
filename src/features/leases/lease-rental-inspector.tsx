"use client";

import { useId, useState, type ReactNode } from "react";
import Link from "next/link";
import { Printer, X } from "lucide-react";
import { RecordDetailTabs } from "@/components/ui/record-detail-tabs";
import {
  paymentBelongsToContract,
  readCimacContractAllocation,
} from "@/features/contracts/cimac-contract-allocation";
import {
  classifyContractCashPayment,
  summarizeContractCash,
} from "@/features/contracts/contract-cash-model";
import { buildContractReceivableSummaries } from "@/features/contracts/contract-list-model";
import {
  formatPropertyMoney,
  formatPropertyXof,
  propertyLeaseRentLabel,
  propertyPaymentDisplay,
} from "@/lib/property-money";
import { nativeLease, nativeReceivableSummary } from "@/lib/native-money";
import { financialBusinessLabel } from "@/lib/display-labels";
import { dictionaries, type Locale } from "@/lib/i18n";
import type { PaymentRow, LeaseContractRow, ReceivableRow } from "@/types/database";
import {
  getOriginalMonthlyRent,
  getRecordedOriginalPayment,
  leaseTenantDisplayName,
} from "./lease-display-model";
import { getLeaseFinancialConfigBySourceType } from "./lease-financial-entry-types";
import { NativeLeaseFinance } from "./native-lease-finance";
import { summarizeLeaseReceiptKinds } from "./lease-receipt-summary";
import type { LeaseWorkbenchInspectorProps } from "./lease-workbench-inspector";
import styles from "./lease-workbench.module.css";

type Tab = "overview" | "payments" | "info" | "history";
const fact = (label: string, children: ReactNode) => (
  <div>
    <dt>{label}</dt>
    <dd>{children}</dd>
  </div>
);

/** SACSI viewing surface. Its caller retains all fresh-detail and operation guards. */
export function LeaseRentalInspector({
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
  initialSection = "overview",
  embedded = false,
  actions,
  financeTools,
  operationError,
  busy = false,
  collectionHref,
  historyContent,
  receiptLedger,
  onPrint,
  onClose,
}: LeaseWorkbenchInspectorProps) {
  const [tab, setTab] = useState<Tab>(initialSection === "finance" ? "payments" : "overview");
  const id = useId();
  const zh = locale === "zh";
  const text = (cn: string, fr: string) => (zh ? cn : fr);
  if (!contract || loading || error)
    return (
      <aside
        className={styles.rentalInspector}
        aria-label={text("租赁资料", "Dossier de location")}
        aria-busy={loading}
      >
        <div className={styles.rentalEmpty}>
          <h2 role={error ? "alert" : loading ? "status" : undefined}>
            {error
              ? text("租赁资料暂时无法读取", "Dossier momentanément indisponible")
              : loading
                ? text("正在读取租赁资料…", "Chargement de la location…")
                : text("选择房间，查看租赁与收支", "Choisissez un lot")}
          </h2>
          <p>
            {error
              ? text(
                  "未展示上一条记录与旧金额，请重新选择或稍后重试。",
                  "Aucun ancien dossier ou montant n’est affiché. Réessayez.",
                )
              : loading
                ? text(
                    "正在核对租赁资料与实时收付款。",
                    "Vérification du dossier et des paiements.",
                  )
                : text(
                    "查看已登记的租客、租金、交租日期和收付款，纸质合同资料可以后补。",
                    "Consultez le locataire, le loyer et les paiements enregistrés. Le bail papier peut être ajouté plus tard.",
                  )}
          </p>
        </div>
        {operationError ? (
          <p role="alert" className={styles.rentalError}>
            {operationError}
          </p>
        ) : null}
      </aside>
    );

  const rows = payments.filter((p) => paymentBelongsToContract(p, contract.id));
  const bills = receivables.filter(
    (r) => r.source_type === "lease_contract" && r.source_id === contract.id,
  );
  const financial =
    summary ?? buildContractReceivableSummaries(bills, "lease_contract", today).get(contract.id);
  const known = !!financial && financial.count > 0;
  const cash = summarizeContractCash(rows);
  const receiptKinds = summarizeLeaseReceiptKinds(contract, rows, {
    ledgerEntries: receiptLedger,
    buildingId: unit?.building_id,
  });
  const auxiliary = [
    {
      key: "depositReceived",
      label: text("另收押金", "Caution reçue"),
      values: receiptKinds.depositReceived,
    },
    {
      key: "depositReturned",
      label: text("已退押金", "Caution remboursée"),
      values: receiptKinds.depositReturned,
    },
    {
      key: "agencyReceived",
      label: text("另收中介费", "Commissions reçues"),
      values: receiptKinds.agencyReceived,
    },
    {
      key: "agencyPaid",
      label: text("中介费支出", "Commissions versées"),
      values: receiptKinds.agencyPaid,
    },
    {
      key: "otherReceived",
      label: text("其他收款", "Autres encaissements"),
      values: receiptKinds.otherReceived,
    },
    {
      key: "otherPaid",
      label: text("其他支出", "Autres décaissements"),
      values: receiptKinds.otherPaid,
    },
    {
      key: "rentRefunded",
      label: text("租金退款", "Loyers remboursés"),
      values: receiptKinds.rentRefunded,
    },
  ].filter((item) => item.values === null || item.values.length > 0);
  const nonCashCount =
    cash.nonCashCount +
    rows.filter((row) => row.native_settlement && row.payment_method === "offset").length;
  const money = (n: number | null | undefined) => formatPropertyXof(n, locale);
  const isNative = nativeLease(contract);
  const nativeBills = bills.filter(
    (r) =>
      r.category === "lease_rent" &&
      r.currency === contract.rent_currency &&
      r.amount_native != null &&
      r.status !== "cancelled" &&
      (r.management_status ?? "managed") === "managed",
  );
  const nativeSummary = nativeReceivableSummary(
    nativeBills,
    contract.rent_currency ?? "XOF",
    today,
  );
  const nativeMoney = (n: number) =>
    formatPropertyMoney(n, contract.rent_currency!, locale) + " " + contract.rent_currency;
  const balanceKnown = isNative ? nativeBills.length > 0 : known;
  const outstanding = isNative ? nativeSummary.outstanding : financial?.outstanding;
  const overdue = isNative ? nativeSummary.overdue : financial?.overdue;
  const balanceLabel = balanceKnown
    ? isNative
      ? nativeMoney(outstanding!)
      : money(outstanding)
    : text("暂无已核应收", "Aucune créance vérifiée");
  const endKnown = !!contract.expected_end_date && contract.expected_end_confirmed !== false;
  const endLabel = !endKnown
    ? text("待确认", "À confirmer")
    : contract.expected_end_date >= "2099-01-01"
      ? text("长期", "Long terme")
      : contract.expected_end_date;
  const status =
    dictionaries[locale].leases.contractStatus[contract.status] ?? text("待核对", "À vérifier");
  const cycleLabels = dictionaries[locale].leases.paymentCycle;
  const cycle =
    cycleLabels[contract.payment_cycle as keyof typeof cycleLabels] ??
    text("待确认", "À confirmer");
  const originalMonthlyRent = getOriginalMonthlyRent(contract, rows);
  const historical =
    contract.status === "terminated" ||
    contract.status === "expired" ||
    (!!contract.actual_end_date && contract.actual_end_date <= today);
  const upcoming =
    !historical && balanceKnown
      ? upcomingVerifiedBill(bills, isNative ? contract.rent_currency! : "XOF", today)
      : null;
  const depositReceived = receiptKinds.depositReceived;
  const invalidDepositRecord = rows.some(
    (row) =>
      row.source_type.startsWith("lease_deposit") &&
      !row.native_settlement &&
      classifyContractCashPayment(row).kind === "excluded",
  );
  const depositNeedsReview =
    invalidDepositRecord ||
    (depositReceived !== null &&
      (contract.deposit_received !== depositReceived.length > 0 ||
        receiptKinds.depositReturned?.some(
          (returned) =>
            returned.amount >
            (depositReceived.find((received) => received.currency === returned.currency)?.amount ??
              0),
        )));
  const ordered = [...rows].sort(
    (a, b) =>
      b.payment_date.localeCompare(a.payment_date) ||
      (b.created_at ?? "").localeCompare(a.created_at ?? "") ||
      b.id.localeCompare(a.id),
  );
  const disclosureTitle = text("更多操作", "Autres opérations");
  const rentReceived = fact(
    text("已收租金", "Loyers encaissés"),
    <RentalReceiptAmounts values={receiptKinds.rentReceived} locale={locale} />,
  );
  const rentReceiptNote = (
    <p className={styles.rentalNote}>
      {text("不含押金、中介费及其他收款。", "Hors caution, commissions et autres encaissements.")}
    </p>
  );
  const auxiliaryReceipts = auxiliary.length ? (
    <dl className={styles.rentalAuxiliary}>
      {auxiliary.map((item) => (
        <div key={item.key}>
          <dt>{item.label}</dt>
          <dd>
            <RentalReceiptAmounts values={item.values} locale={locale} />
          </dd>
        </div>
      ))}
    </dl>
  ) : null;
  const receiptReview = receiptKinds.reviewReasons.length ? (
    <p className={styles.rentalReview}>
      {text(
        "收付款分类有待核事项，可查看逐笔依据。",
        "Certains mouvements restent à vérifier ; consultez leurs justificatifs.",
      )}
    </p>
  ) : null;

  return (
    <aside
      className={styles.rentalInspector}
      aria-label={text("租赁资料", "Dossier de location")}
      aria-busy={loading}
    >
      {!embedded ? (
        <header className={styles.rentalStandaloneHeader}>
          <h2>
            {buildingLabel ? buildingLabel + " · " : ""}
            {unit?.unit_no ?? text("租赁资料", "Dossier de location")}
          </h2>
          {onClose ? (
            <button
              type="button"
              aria-label={text("关闭预览", "Fermer l’aperçu")}
              onClick={onClose}
              disabled={busy}
            >
              <X size={16} />
            </button>
          ) : null}
        </header>
      ) : null}
      <RecordDetailTabs
        id={id}
        label={text("租赁资料内容", "Détails de la location")}
        value={tab}
        onChange={(value) => setTab(value as Tab)}
        items={[
          { value: "overview", label: text("概览", "Aperçu") },
          { value: "payments", label: text("收付款", "Paiements") },
          { value: "info", label: text("资料", "Informations") },
          { value: "history", label: text("历史", "Historique") },
        ]}
      />
      <div
        className={styles.rentalPanel}
        role="tabpanel"
        id={id + "-panel-" + tab}
        aria-labelledby={id + "-tab-" + tab}
        tabIndex={0}
      >
        {tab === "overview" ? (
          <>
            <div className={styles.rentalParty}>
              <span>{text("租客", "Locataire")}</span>
              <strong>
                {leaseTenantDisplayName(unit, customer?.name) ||
                  text("租客待登记", "Locataire à compléter")}
              </strong>
              {customer?.phone ? <span>{customer.phone}</span> : null}
              <span className={styles.rentalState}>{status}</span>
            </div>
            <dl className={styles.rentalFacts}>
              {fact(
                text("月租金", "Loyer mensuel"),
                <>
                  {propertyLeaseRentLabel(contract, locale)}
                  {originalMonthlyRent ? (
                    <small>
                      {text("原币约 ", "Devise d’origine env. ")}
                      {formatPropertyMoney(
                        originalMonthlyRent.amount,
                        originalMonthlyRent.currency,
                        locale,
                      )}
                      /{text("月", "mois")}
                    </small>
                  ) : null}
                </>,
              )}
            </dl>
            <dl className={styles.rentalSummary}>
              {rentReceived}
              {fact(text("已核应收未收", "Créances restant dues"), balanceLabel)}
            </dl>
            {rentReceiptNote}
            {balanceKnown && (overdue ?? 0) > 0 ? (
              <p className={styles.rentalOverdue}>
                {text("已核应收逾期", "Créances en retard")} ·{" "}
                {isNative ? nativeMoney(overdue!) : money(overdue)}
              </p>
            ) : upcoming ? (
              <p className={styles.rentalReview}>
                {upcoming.days === 0
                  ? text("今日应缴", "Dû aujourd’hui")
                  : text("15天内应缴", "Dû sous 15 jours")}{" "}
                · {upcoming.date}
              </p>
            ) : null}
            <dl className={styles.rentalFacts}>
              {fact(
                text("租金已交至（登记）", "Loyer couvert jusqu’au (enregistré)"),
                contract.paid_through_date || text("未登记", "Non renseigné"),
              )}
            </dl>
            {auxiliaryReceipts}
            {receiptReview}
            {historical ? (
              <p className={styles.rentalNote}>
                {text(
                  "该次租赁的未结清款仍归原租客，不与后续租客合并。",
                  "Ces montants concernent uniquement cette ancienne location, séparément des locataires suivants.",
                )}
              </p>
            ) : null}
            <button type="button" className={styles.rentalLink} onClick={() => setTab("payments")}>
              {text("查看收付款", "Voir les paiements")}
            </button>
          </>
        ) : tab === "payments" ? (
          <>
            {historical ? (
              <p className={styles.rentalNote}>
                {text(
                  "该次租赁的未结清款仍归原租客，不与后续租客合并。",
                  "Ces écritures concernent uniquement cette ancienne location, séparément des locataires suivants.",
                )}
              </p>
            ) : null}
            <section className={styles.rentalSection}>
              <h3>{text("收付款分类", "Répartition des paiements")}</h3>
              <dl className={styles.rentalFacts}>{rentReceived}</dl>
              {rentReceiptNote}
              {auxiliaryReceipts}
              {receiptReview}
              {depositReceived?.length || receiptKinds.depositReturned?.length ? (
                <p className={styles.rentalNote}>
                  {text(
                    "押金不计入经营收入；可退金额需在退租结算中核实扣减与原始凭证。",
                    "La caution est distincte des recettes d’exploitation. Vérifiez retenues et justificatifs avant tout remboursement.",
                  )}
                </p>
              ) : null}
              {depositNeedsReview ? (
                <p className={styles.rentalReview}>
                  {text(
                    "押金标记与已录收退记录存在待核差异，请核对后办理。",
                    "Écart à vérifier entre l’indicateur de caution et les écritures enregistrées.",
                  )}
                </p>
              ) : null}
              {cash.excludedCount > 0 || nonCashCount > 0 ? (
                <p className={styles.rentalReview}>
                  {text(
                    cash.excludedCount +
                      " 笔待核记录未计入现金汇总；" +
                      nonCashCount +
                      " 笔非现金变动。",
                    cash.excludedCount +
                      " écritures à vérifier exclues du cash ; " +
                      nonCashCount +
                      " mouvements hors caisse.",
                  )}
                </p>
              ) : null}
            </section>
            <RentalPaymentTable
              contract={contract}
              payments={ordered}
              locale={locale}
              verifiedLegacyRentIds={receiptKinds.verifiedLegacyRentIds}
            />
            <section className={styles.rentalSection}>
              <h3>{text("应收与付款安排", "Créances et échéances")}</h3>
              <NativeLeaseFinance
                contract={contract}
                payments={rows}
                receivables={bills}
                locale={locale}
                today={today}
                showRentReceipts={false}
              />
              <dl className={styles.rentalFacts}>
                {fact(
                  text("已核应收 · 当前未收", "Créances vérifiées · Solde actuel"),
                  known ? money(financial!.outstanding) : "—",
                )}
                {fact(
                  text("其中已逾期", "Dont en retard"),
                  known ? money(financial!.overdue) : "—",
                )}
                {fact(
                  text("最早未结到期", "Première échéance ouverte"),
                  known && financial!.nextDue ? financial!.nextDue : "—",
                )}
                {fact(
                  text("应收已核销", "Créances rapprochées"),
                  known ? money(financial!.paid) : "—",
                )}
              </dl>
              <p className={styles.rentalNote}>
                {known
                  ? text(
                      "应收核销与现金收款是不同口径；非现金抵扣不计入实收。",
                      "Le rapprochement des créances est distinct des encaissements. Les compensations ne sont pas du cash.",
                    )
                  : text(
                      "未有已核应收，不代表没有欠款。",
                      "Aucune créance vérifiée ne signifie pas aucune dette.",
                    )}
              </p>
            </section>
          </>
        ) : tab === "info" ? (
          <>
            <section className={styles.rentalSection}>
              <h3>{text("租期与登记资料", "Période et informations enregistrées")}</h3>
              <dl className={styles.rentalFacts}>
                {fact(
                  text("登记租期", "Période enregistrée"),
                  (contract.start_date || text("起租待补", "Début à compléter")) + " → " + endLabel,
                )}
                {contract.actual_end_date
                  ? fact(text("实际结束", "Fin réelle"), contract.actual_end_date)
                  : null}
                {fact(text("支付周期", "Règlement"), cycle)}
                {fact(
                  text("约定付款日", "Jour de règlement"),
                  contract.payment_day
                    ? contract.payment_day + text(" 号", " du mois")
                    : text("待确认", "À confirmer"),
                )}
                {fact(
                  text("登记押金", "Caution enregistrée"),
                  isNative && Number(contract.deposit_amount_xof) === 0
                    ? text("原币押金待核", "Caution en devise à vérifier")
                    : money(contract.deposit_amount_xof),
                )}
                {fact(
                  text("押金登记状态", "Indicateur de caution"),
                  contract.deposit_received
                    ? text("标记已收，须核凭证", "Indiquée reçue, justificatif à vérifier")
                    : text("未标记实收", "Réception non indiquée"),
                )}
                {contract.rent_free_days > 0
                  ? fact(text("免租天数", "Jours de franchise"), contract.rent_free_days)
                  : null}
                {fact(
                  text("记录编号", "Référence"),
                  contract.contract_no || text("未填写", "Non renseignée"),
                )}
                {fact(
                  text("签约人", "Signataire"),
                  contract.signer_name || text("未登记", "Non renseigné"),
                )}
                {fact(
                  text("合同附件", "Pièce jointe"),
                  contract.attachment_url
                    ? text("已有登记", "Référencée")
                    : text("未登记", "Non renseignée"),
                )}
              </dl>
              <p className={styles.rentalNote}>
                {text(
                  "登记已交至、押金标记不等于实收。租期到期不代表已搬离；未附纸质合同不影响查看已登记资料。",
                  "La couverture et l’indicateur de caution ne prouvent pas un encaissement. La fin prévue ne confirme pas un départ ; l’absence de bail papier ne masque pas les données enregistrées.",
                )}
              </p>
            </section>
          </>
        ) : (
          <>
            <section className={styles.rentalSection}>
              <h3>{text("本次租赁记录", "Location sélectionnée")}</h3>
              <dl className={styles.rentalFacts}>
                {fact(text("登记状态", "État enregistré"), status)}
                {fact(
                  text("登记租期", "Période enregistrée"),
                  (contract.start_date || text("起租待补", "Début à compléter")) + " → " + endLabel,
                )}
                {contract.actual_end_date
                  ? fact(text("实际结束", "Fin réelle"), contract.actual_end_date)
                  : null}
              </dl>
            </section>
            {historyContent}
            <p className={styles.rentalNote}>
              {text(
                "收付款及原收据、校正链见收付款页，不作为完整操作审计。",
                "Les paiements, reçus et corrections figurent dans Paiements ; ils ne constituent pas un audit complet.",
              )}
            </p>
          </>
        )}
      </div>
      {operationError ? (
        <p role="alert" className={styles.rentalError}>
          {operationError}
        </p>
      ) : null}
      <details className={styles.rentalMore}>
        <summary>{disclosureTitle}</summary>
        <fieldset disabled={busy} className={styles.rentalOperations}>
          {contract.status === "active" && collectionHref ? (
            <Link
              href={collectionHref}
              aria-disabled={busy || undefined}
              tabIndex={busy ? -1 : undefined}
              onClick={(event) => {
                if (busy) event.preventDefault();
              }}
            >
              {text("手工登记租金/物业费", "Saisir manuellement loyer / charges")}
            </Link>
          ) : null}
          {actions}
          {financeTools}
          <button type="button" onClick={onPrint} disabled={busy}>
            <Printer size={14} aria-hidden="true" />
            {text("打印登记合同", "Imprimer le contrat enregistré")}
          </button>
        </fieldset>
      </details>
    </aside>
  );
}

function upcomingVerifiedBill(rows: ReceivableRow[], currency: string, today: string) {
  const day = (date: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
    const timestamp = Date.parse(date + "T00:00:00Z");
    return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === date
      ? timestamp / 86400000
      : null;
  };
  const current = day(today);
  if (current === null) return null;
  const candidates = rows.flatMap((row) => {
    if (
      row.currency !== currency ||
      row.status === "cancelled" ||
      row.status === "paid" ||
      (row.management_status ?? "managed") !== "managed"
    )
      return [];
    const rawAmount = currency === "XOF" ? row.amount_xof : row.amount_native;
    const rawPaid = currency === "XOF" ? row.paid_amount_xof : row.paid_amount_native;
    if (rawAmount == null || rawPaid == null) return [];
    const amount = Number(rawAmount),
      paid = Number(rawPaid),
      due = day(row.due_date);
    if (
      !Number.isFinite(amount) ||
      !Number.isFinite(paid) ||
      amount <= 0 ||
      paid < 0 ||
      paid >= amount ||
      due === null
    )
      return [];
    const days = due - current;
    return Number.isInteger(days) && days >= 0 && days <= 15 ? [{ date: row.due_date, days }] : [];
  });
  return candidates.sort((a, b) => a.date.localeCompare(b.date))[0] ?? null;
}

function RentalReceiptAmounts({
  values,
  locale,
}: {
  values: ReturnType<typeof summarizeLeaseReceiptKinds>["rentReceived"];
  locale: Locale;
}) {
  if (values === null) return <>{locale === "zh" ? "待核" : "À vérifier"}</>;
  if (!values.length) return <>{locale === "zh" ? "未见记录" : "Aucun enregistrement"}</>;
  return (
    <>
      {values.map((value) => (
        <span className="block" key={value.currency}>
          {formatPropertyMoney(value.amount, value.currency, locale)}
          {value.currency !== "XOF" ? ` ${value.currency}` : ""}
        </span>
      ))}
    </>
  );
}

function RentalPaymentTable({
  contract,
  payments,
  locale,
  verifiedLegacyRentIds,
}: {
  contract: LeaseContractRow;
  payments: PaymentRow[];
  locale: Locale;
  verifiedLegacyRentIds: ReadonlySet<string>;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const id = useId(),
    zh = locale === "zh",
    text = (cn: string, fr: string) => (zh ? cn : fr);
  const categories = dictionaries[locale].finance.categories;
  const selected = payments.find((p) => p.id === selectedId);
  const describe = (p: PaymentRow) => {
    const allocation = readCimacContractAllocation(p, contract.id, contract.customer_id);
    const line = classifyContractCashPayment(p),
      original = getRecordedOriginalPayment(p),
      display = propertyPaymentDisplay(p, locale),
      config = getLeaseFinancialConfigBySourceType(
        verifiedLegacyRentIds.has(p.id) ? "lease_rent" : p.source_type,
      );
    const nonCashCategory =
      p.source_type === "lease_duplicate_void"
        ? p.source_type
        : p.source_type === "lease_other_expense" && p.payment_method === "offset"
          ? "lease_internal_offset"
          : null;
    const label = nonCashCategory
      ? financialBusinessLabel(nonCashCategory, locale)
      : allocation
        ? allocation.adjustmentKind === "refund"
          ? text("客户总账 · 本合同实际退款", "Compte client · remboursement réel de ce contrat")
          : allocation.adjustmentKind === "reversal"
            ? text(
                "客户总账 · 本合同错误收款冲正（非现金）",
                "Compte client · contrepassation d’erreur (hors caisse)",
              )
            : text("客户总账 · 本合同分配", "Compte client · part de ce contrat")
        : config
          ? text(config.labelZh, config.labelFr)
          : p.source_type === "lease_deposit_deduction"
            ? text("押金扣款", "Retenue sur dépôt")
            : p.source_type === "lease_rent_refund"
              ? text("租金退款", "Remboursement de loyer")
              : (categories[p.source_type as keyof typeof categories] ??
                text("其他财务记录", "Autre écriture"));
    const sign =
      allocation?.adjustmentKind || line.kind === "expense" || line.kind === "deposit_out"
        ? "−"
        : line.kind === "income" || line.kind === "deposit_in"
          ? "+"
          : "";
    const amount = allocation
      ? formatPropertyXof(Math.abs(Number(allocation.amount)), locale)
      : original
        ? formatPropertyMoney(original.amount, original.currency, locale)
        : display.primary;
    return { allocation, line, original, display, label, amount: sign + amount };
  };
  const detail = selected ? describe(selected) : null;
  return (
    <section className={styles.rentalSection}>
      <h3>{text("收付款记录", "Mouvements de paiement")}</h3>
      <p className={styles.rentalNote}>
        {text("以下为这次租赁的已登记收付款。", "Paiements enregistrés pour cette location.")}
      </p>
      <table className={styles.rentalPayments}>
        <caption className="sr-only">
          {text("本次租赁的收付款", "Paiements de cette location")}
        </caption>
        <thead>
          <tr>
            <th>{text("日期", "Date")}</th>
            <th>{text("款项", "Nature")}</th>
            <th>{text("金额", "Montant")}</th>
            <th>{text("依据", "Source")}</th>
          </tr>
        </thead>
        <tbody>
          {payments.map((p) => {
            const row = describe(p);
            return (
              <tr key={p.id} data-lease-payment-id={p.id}>
                <td>
                  <time dateTime={p.payment_date}>{p.payment_date}</time>
                </td>
                <td>{row.label}</td>
                <td>{row.amount}</td>
                <td>
                  <button
                    type="button"
                    aria-expanded={selectedId === p.id}
                    aria-controls={id}
                    aria-label={
                      text("查看依据 ", "Voir la source ") + p.payment_date + " " + row.label
                    }
                    onClick={() => setSelectedId(selectedId === p.id ? null : p.id)}
                  >
                    {text("查看", "Voir")}
                  </button>
                </td>
              </tr>
            );
          })}
          {!payments.length ? (
            <tr>
              <td colSpan={4}>{text("暂无财务记录", "Aucune écriture financière")}</td>
            </tr>
          ) : null}
        </tbody>
      </table>
      <p className={styles.rentalNote}>
        {text("共 " + payments.length + " 笔财务记录", payments.length + " écritures financières")}
      </p>
      {selected && detail ? (
        <div
          id={id}
          className={styles.rentalEvidence}
          aria-label={text("收付款依据", "Justificatif du paiement")}
        >
          <p>
            {detail.label} · {selected.payment_date}
          </p>
          {detail.allocation ? (
            <p>
              {detail.allocation.adjustmentKind
                ? text(
                    detail.allocation.adjustmentKind === "refund"
                      ? "仅登记本合同已实际退回的份额，恢复相应应收，不自动免除合同义务。"
                      : "仅纠正本合同原错误收款份额，恢复相应应收；非实际退款。",
                    detail.allocation.adjustmentKind === "refund"
                      ? "Seule la part réellement remboursée de ce contrat est enregistrée. Créances rétablies, sans remise des obligations."
                      : "Seule la part erronée de ce contrat est contrepassée. Créances rétablies, sans remboursement réel.",
                  )
                : text(
                    "仅计入本合同已核销份额；同一原始收据可能覆盖多份合同，不复制整笔实收。",
                    "Seule la part imputée à ce contrat est comptée. Le reçu d’origine peut couvrir plusieurs contrats ; son total n’est pas dupliqué.",
                  )}
            </p>
          ) : null}
          {detail.line.kind === "excluded" ? (
            <p>
              {detail.line.reason === "voided_duplicate"
                ? text("重复登记已作废，保留原记录。", "Écriture en double annulée et conservée.")
                : selected.native_settlement
                  ? detail.display.secondary
                  : detail.line.reason === "non_cash_offset"
                    ? text("非现金抵扣，不计入现金", "Compensation hors caisse")
                    : text("待核对，不计入现金", "À vérifier, exclu du cash")}
            </p>
          ) : detail.display.secondary || detail.original ? (
            <p>
              {text("折合 ", "Équiv. ")}
              {formatPropertyXof(detail.line.amountXof, locale)}
            </p>
          ) : null}
          <p>
            {detail.allocation?.adjustmentKind
              ? text("录入账号", "Opérateur")
              : text("实收人", "Encaisseur")}
            :{" "}
            {(detail.allocation?.adjustmentKind
              ? selected.recorded_by
              : selected.actual_collector) || text("待核对", "À vérifier")}
          </p>
          {selected.receipt_no ? (
            <p>
              {text("收据", "Reçu")}：{selected.receipt_no}
            </p>
          ) : null}
          {selected.notes ? <p>{selected.notes}</p> : null}
          {detail.allocation?.originalPaymentId && contract.customer_id ? (
            <Link
              href={
                (locale === "fr" ? "/fr" : "") +
                "/finance?view=customers&customerId=" +
                encodeURIComponent(contract.customer_id) +
                "&tab=receipts#cimac-payment-" +
                detail.allocation.originalPaymentId
              }
            >
              {text("查看原收款及校正链", "Voir le reçu d’origine et ses corrections")} ↗
            </Link>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
