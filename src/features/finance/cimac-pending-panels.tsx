"use client";

import { useRef, useState, type FormEvent } from "react";
import type {
  CimacCustomerAccount,
  CimacFeeTerm,
  CimacFeeTermInput,
  CimacMeterReading,
  CimacMeterReadingInput,
} from "./cimac-billing-types";
import { saveCimacFeeTerms, saveCimacMeterReading } from "./cimac-billing-actions";
import { billingCategory, billingNumber } from "./cimac-billing-display";
import { CimacWriteFeedback, useCimacWrite } from "./cimac-write-form";
import styles from "./cimac-customer-workbench.module.css";

interface PendingPanelProps {
  data: CimacCustomerAccount;
  locale: "zh" | "fr";
  today: string;
  viewerId: string;
  canWrite: boolean;
}
const validDate = (value: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  Number.isFinite(Date.parse(`${value}T00:00:00Z`)) &&
  new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
const decimal = (value: string, scale: number, positive = false): bigint | null => {
  if (!new RegExp(`^(?:0|[1-9]\\d{0,11})(?:\\.\\d{1,${scale}})?$`).test(value)) return null;
  const [integer, fraction = ""] = value.split(".");
  const parsed = BigInt(integer + fraction.padEnd(scale, "0"));
  return positive && parsed === BigInt(0) ? null : parsed;
};
function quantity(value: bigint): string {
  const remainder = String(value % BigInt(1000))
    .padStart(3, "0")
    .replace(/0+$/, "");
  return `${value / BigInt(1000)}${remainder ? `.${remainder}` : ""}`;
}

export function CimacMeterPanel({ data, locale, today, viewerId, canWrite }: PendingPanelProps) {
  const text = (zh: string, fr: string) => (locale === "zh" ? zh : fr);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<CimacMeterReading | null>(null);
  const [contractId, setContractId] = useState("");
  const [meterKind, setMeterKind] = useState<CimacMeterReadingInput["meterKind"]>("water");
  const [meterNo, setMeterNo] = useState("");
  const [month, setMonth] = useState("");
  const [readOn, setReadOn] = useState(today);
  const [previous, setPrevious] = useState("");
  const [current, setCurrent] = useState("");
  const [evidence, setEvidence] = useState("");
  const [notes, setNotes] = useState("");
  const [validation, setValidation] = useState("");
  const submitted = useRef<CimacMeterReadingInput | null>(null);
  const write = useCimacWrite<CimacMeterReadingInput>({
    kind: "meter_reading",
    viewerId,
    customerId: data.selectedCustomerId!,
    locale,
    action: saveCimacMeterReading,
  });
  const leaseContracts = data.contracts.filter((item) => item.kind === "lease");
  const contract = leaseContracts.find((item) => item.id === contractId);
  const units = new Map(data.units.map((unit) => [unit.id, unit]));
  const currentValue = decimal(current, 3),
    previousValue = previous ? decimal(previous, 3) : null;
  const usage =
    currentValue !== null && previousValue !== null && currentValue >= previousValue
      ? quantity(currentValue - previousValue)
      : null;
  function start(record: CimacMeterReading | null) {
    if (write.phase !== "editing" && write.phase !== "rejected" && write.phase !== "success")
      return;
    if (write.phase === "success") write.reset();
    setEditing(record);
    setOpen(true);
    setValidation("");
    setContractId(record?.contractId ?? "");
    setMeterKind(record?.meterKind ?? "water");
    setMeterNo(record?.meterNo ?? "");
    setMonth(record?.serviceMonth.slice(0, 7) ?? "");
    setReadOn(record?.readOn ?? today);
    setPrevious(record?.previousReading ?? "");
    setCurrent(record?.currentReading ?? "");
    setEvidence(record?.evidence ?? "");
    setNotes(record?.notes ?? "");
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!canWrite || write.locked) return;
    let error = "";
    const serviceMonth = `${month}-01`;
    if (
      !contract ||
      !meterNo.trim() ||
      !validDate(serviceMonth) ||
      !validDate(readOn) ||
      readOn > today ||
      readOn < serviceMonth ||
      currentValue === null
    )
      error = text(
        "请填写实际合同、表号、月份、有效抄表日和非负读数（最多三位小数）。",
        "Renseignez le contrat, le compteur, le mois, la date réelle et un relevé positif ou nul, à trois décimales maximum.",
      );
    else if (previous && (previousValue === null || currentValue < previousValue))
      error = text(
        "本期读数不能小于上期；换表或异常需先核实，不能猜用量。",
        "Le relevé actuel ne peut être inférieur au précédent. Vérifiez les remplacements et anomalies sans inventer la consommation.",
      );
    setValidation(error);
    if (error || !contract) return;
    const input: CimacMeterReadingInput = {
      customerId: data.selectedCustomerId!,
      contractId,
      unitId: contract.unitId,
      meterKind,
      meterNo: meterNo.trim(),
      serviceMonth,
      readOn,
      currentReading: current,
      ...(previous ? { previousReading: previous } : {}),
      ...(evidence.trim() ? { evidence: evidence.trim() } : {}),
      ...(notes.trim() ? { notes: notes.trim() } : {}),
      ...(editing ? { id: editing.id, expectedUpdatedAt: editing.updatedAt } : {}),
    };
    submitted.current = input;
    await write.submit(input);
  }
  return (
    <div className={styles.tabPanel}>
      <div className={styles.profileTop}>
        <div>
          <h2>{text("月度水电抄表", "Relevés mensuels des fluides")}</h2>
          <p className={styles.subtitle}>
            {text(
              "逐户独立表；先保存读数和用量，单价待核不出账。",
              "Compteurs individuels ; relevés et consommations conservés, sans facture tant que le tarif reste à vérifier.",
            )}
          </p>
        </div>
        {canWrite ? (
          <button
            className={styles.button}
            type="button"
            disabled={
              write.phase === "checking" ||
              write.phase === "submitting" ||
              write.phase === "unknown" ||
              !leaseContracts.length
            }
            onClick={() => start(null)}
          >
            {text("登记抄表", "Saisir un relevé")}
          </button>
        ) : null}
      </div>
      {!leaseContracts.length ? (
        <p className={styles.note}>
          {text(
            "当前客户没有已关联的租赁合同，暂不能登记抄表。出售合同及其原有业务仍可通过原页面处理。",
            "Aucun bail n’est lié à ce client : saisie des relevés indisponible. Les contrats de vente et leurs opérations existantes restent accessibles sur leur page.",
          )}
        </p>
      ) : null}
      <CimacWriteFeedback
        state={write}
        locale={locale}
        onRetry={() => submitted.current && void write.submit(submitted.current)}
      />
      {open ? (
        <section className={styles.panel}>
          <div className={styles.sectionHead}>
            <h3>
              {editing
                ? text("更正抄表记录 · 保留审计", "Corriger le relevé · audit conservé")
                : text("登记实际抄表", "Enregistrer un relevé réel")}
            </h3>
            <button
              className={styles.quietButton}
              type="button"
              disabled={write.phase === "submitting"}
              onClick={() => setOpen(false)}
            >
              {text("收起", "Fermer")}
            </button>
          </div>
          <form className={styles.form} onSubmit={(event) => void submit(event)}>
            <fieldset className={styles.fieldset} disabled={write.locked || !canWrite}>
              <div className={styles.formColumns}>
                <label className={styles.field}>
                  <span>{text("房屋 / 合同", "Bien / contrat")}</span>
                  <select
                    className={styles.select}
                    value={contractId}
                    disabled={!!editing}
                    onChange={(event) => setContractId(event.target.value)}
                    required
                  >
                    <option value="">{text("请选择实际合同", "Choisir le contrat réel")}</option>
                    {leaseContracts.map((item) => (
                      <option key={item.id} value={item.id}>
                        {units.get(item.unitId)?.unit_no ?? "—"} · {item.contractNo}
                      </option>
                    ))}
                  </select>
                </label>
                <label className={styles.field}>
                  <span>{text("水 / 电", "Eau / électricité")}</span>
                  <select
                    className={styles.select}
                    value={meterKind}
                    disabled={!!editing}
                    onChange={(event) => setMeterKind(event.target.value as typeof meterKind)}
                  >
                    <option value="water">{text("水表 · m³", "Eau · m³")}</option>
                    <option value="electricity">{text("电表 · kWh", "Électricité · kWh")}</option>
                  </select>
                </label>
                <label className={styles.field}>
                  <span>{text("表号", "N° de compteur")}</span>
                  <input
                    className={styles.input}
                    maxLength={100}
                    value={meterNo}
                    disabled={!!editing}
                    onChange={(event) => setMeterNo(event.target.value)}
                    required
                  />
                </label>
                <label className={styles.field}>
                  <span>{text("服务月份", "Mois de service")}</span>
                  <input
                    className={styles.input}
                    type="month"
                    max={today.slice(0, 7)}
                    value={month}
                    disabled={!!editing}
                    onChange={(event) => setMonth(event.target.value)}
                    required
                  />
                </label>
                <label className={styles.field}>
                  <span>{text("实际抄表日期", "Date réelle du relevé")}</span>
                  <input
                    className={styles.input}
                    type="date"
                    min={month ? `${month}-01` : undefined}
                    max={today}
                    value={readOn}
                    onChange={(event) => setReadOn(event.target.value)}
                    required
                  />
                </label>
                <label className={styles.field}>
                  <span>{text("上期读数 · 不知道留空", "Relevé précédent · vide si inconnu")}</span>
                  <input
                    className={styles.input}
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="0.001"
                    value={previous}
                    onChange={(event) => setPrevious(event.target.value)}
                  />
                </label>
                <label className={styles.field}>
                  <span>{text("本期读数", "Relevé actuel")}</span>
                  <input
                    className={styles.input}
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="0.001"
                    value={current}
                    onChange={(event) => setCurrent(event.target.value)}
                    required
                  />
                </label>
                <div className={styles.field}>
                  <span>{text("本期用量", "Consommation")}</span>
                  <p className={styles.usage}>
                    {usage === null
                      ? text("待核，不按零计算", "À vérifier, pas zéro par défaut")
                      : `${billingNumber(usage, locale)} ${meterKind === "water" ? "m³" : "kWh"}`}
                  </p>
                </div>
              </div>
              <label className={styles.field}>
                <span>
                  {text(
                    "现场照片 / 凭证引用，可留空",
                    "Référence photo / justificatif, facultative",
                  )}
                </span>
                <input
                  className={styles.input}
                  maxLength={2000}
                  value={evidence}
                  onChange={(event) => setEvidence(event.target.value)}
                  placeholder={text(
                    "填写已保存照片的位置或凭证编号",
                    "Emplacement d’une photo conservée ou référence du justificatif",
                  )}
                />
              </label>
              <label className={styles.field}>
                <span>{text("备注", "Note")}</span>
                <textarea
                  className={styles.input}
                  maxLength={2000}
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                />
              </label>
            </fieldset>
            {validation ? (
              <p role="alert" className={styles.feedback}>
                {validation}
              </p>
            ) : null}
            <div className={styles.actions}>
              <button
                className={styles.primaryButton}
                type="submit"
                disabled={write.locked || !canWrite}
              >
                {write.phase === "submitting"
                  ? text("正在保存…", "Enregistrement…")
                  : text("保存读数，不生成账单", "Conserver sans facturer")}
              </button>
              <span className={styles.note}>
                {text(
                  "单价、公示及收费规则尚待确认。",
                  "Tarif, publication et modalités de facturation à confirmer.",
                )}
              </span>
            </div>
          </form>
        </section>
      ) : null}
      <section className={styles.panel}>
        <div className={styles.sectionHead}>
          <h3>{text("已保存抄表记录", "Relevés conservés")}</h3>
          <span>{text("费率待核 · 不纳入欠款", "Tarifs à vérifier · hors dettes")}</span>
        </div>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>{text("房屋 / 表号", "Bien / compteur")}</th>
                <th>{text("月份 / 抄表日", "Mois / date")}</th>
                <th className={styles.number}>{text("上期", "Précédent")}</th>
                <th className={styles.number}>{text("本期", "Actuel")}</th>
                <th className={styles.number}>{text("用量", "Consommation")}</th>
                <th>{text("状态 / 操作", "État / action")}</th>
              </tr>
            </thead>
            <tbody>
              {data.meterReadings.length ? (
                data.meterReadings.map((row) => (
                  <tr key={row.id}>
                    <td>
                      {units.get(row.unitId)?.unit_no ?? text("房屋待核", "Lot à vérifier")}
                      <div className={styles.meta}>
                        {row.meterNo} ·{" "}
                        {row.meterKind === "water" ? text("水", "Eau") : text("电", "Électricité")}
                      </div>
                    </td>
                    <td>
                      {row.serviceMonth.slice(0, 7)}
                      <div className={styles.meta}>{row.readOn}</div>
                    </td>
                    <td className={styles.number}>{billingNumber(row.previousReading, locale)}</td>
                    <td className={styles.number}>{billingNumber(row.currentReading, locale)}</td>
                    <td className={styles.number}>
                      {billingNumber(row.usage, locale)} {row.meterKind === "water" ? "m³" : "kWh"}
                    </td>
                    <td>
                      <span className={`${styles.status} ${styles.pending}`}>
                        {text("已登记 · 单价待核", "Conservé · tarif à vérifier")}
                      </span>
                      {canWrite ? (
                        <button
                          className={styles.quietButton}
                          type="button"
                          disabled={
                            write.phase === "checking" ||
                            write.phase === "unknown" ||
                            write.phase === "submitting"
                          }
                          onClick={() => start(row)}
                        >
                          {text("更正", "Corriger")}
                        </button>
                      ) : null}
                      {row.evidence ? (
                        <p className={styles.meta}>
                          {text("凭证引用", "Justificatif")} · {row.evidence}
                        </p>
                      ) : null}
                      {row.notes ? <p className={styles.meta}>{row.notes}</p> : null}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={6} className={styles.empty}>
                    {text(
                      "尚未登记抄表记录。未知读数不按零显示。",
                      "Aucun relevé enregistré. Un relevé inconnu n’est pas présenté comme zéro.",
                    )}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

export function CimacFeeTermsPanel({ data, locale, viewerId, canWrite }: PendingPanelProps) {
  const text = (zh: string, fr: string) => (locale === "zh" ? zh : fr);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<CimacFeeTerm | null>(null);
  const [contractId, setContractId] = useState("");
  const [category, setCategory] = useState<CimacFeeTermInput["category"]>("property_fee");
  const [currency, setCurrency] = useState<CimacFeeTermInput["currency"]>("XOF");
  const [pricingBasis, setPricingBasis] = useState<CimacFeeTermInput["pricingBasis"]>("pending");
  const [rate, setRate] = useState("");
  const [area, setArea] = useState("");
  const [startsOn, setStartsOn] = useState("");
  const [endsOn, setEndsOn] = useState("");
  const [annualStart, setAnnualStart] = useState("");
  const [annualEnd, setAnnualEnd] = useState("");
  const [proration, setProration] = useState<CimacFeeTermInput["proration"]>(
    "daily_pending_convention",
  );
  const [source, setSource] = useState("");
  const [notes, setNotes] = useState("");
  const [validation, setValidation] = useState("");
  const submitted = useRef<CimacFeeTermInput | null>(null);
  const write = useCimacWrite<CimacFeeTermInput>({
    kind: "fee_terms",
    viewerId,
    customerId: data.selectedCustomerId!,
    locale,
    action: saveCimacFeeTerms,
  });
  const leaseContracts = data.contracts.filter((item) => item.kind === "lease");
  const contract = leaseContracts.find((item) => item.id === contractId);
  const units = new Map(data.units.map((unit) => [unit.id, unit]));
  function start(record: CimacFeeTerm | null) {
    if (write.phase !== "editing" && write.phase !== "rejected" && write.phase !== "success")
      return;
    if (write.phase === "success") write.reset();
    setEditing(record);
    setOpen(true);
    setValidation("");
    setContractId(record?.contractId ?? "");
    setCategory(record?.category ?? "property_fee");
    setCurrency(record?.currency ?? "XOF");
    setPricingBasis(record?.pricingBasis ?? "pending");
    setRate(record?.monthlyRate ?? "");
    setArea(record?.chargeableArea ?? "");
    setStartsOn(record?.startsOn ?? "");
    setEndsOn(record?.endsOn ?? "");
    setAnnualStart(record?.annualStartsOn ?? "");
    setAnnualEnd(record?.annualEndsOn ?? "");
    setProration(record?.proration ?? "daily_pending_convention");
    setSource(record?.source ?? "");
    setNotes(record?.notes ?? "");
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!canWrite || write.locked) return;
    let error = "";
    if (!contract || !source.trim())
      error = text(
        "请选择实际合同，并填写约定来源。未明确的金额、面积、日期留空。",
        "Choisissez le contrat et indiquez la source. Laissez vides les montants, surfaces et dates inconnus.",
      );
    else if ((rate && decimal(rate, 2, true) === null) || (area && decimal(area, 3, true) === null))
      error = text(
        "已知单价应大于零且最多两位小数；合同计费面积最多三位小数。",
        "Le tarif connu doit être positif, à deux décimales maximum ; la surface contractuelle à trois décimales.",
      );
    else if (
      [startsOn, endsOn, annualStart, annualEnd].some((value) => value && !validDate(value)) ||
      (startsOn && endsOn && startsOn > endsOn) ||
      (annualStart && annualEnd && annualStart > annualEnd)
    )
      error = text(
        "请核对日期和期间先后；不知道就留空，不默认使用租金起算日。",
        "Vérifiez les dates et leur ordre. Laissez vide si inconnu, sans reprendre la date de début du loyer.",
      );
    setValidation(error);
    if (error || !contract) return;
    const input: CimacFeeTermInput = {
      customerId: data.selectedCustomerId!,
      contractId,
      unitId: contract.unitId,
      category,
      currency,
      pricingBasis,
      proration,
      source: source.trim(),
      ...(rate ? { monthlyRate: rate } : {}),
      ...(area ? { chargeableArea: area } : {}),
      ...(startsOn ? { startsOn } : {}),
      ...(endsOn ? { endsOn } : {}),
      ...(annualStart ? { annualStartsOn: annualStart } : {}),
      ...(annualEnd ? { annualEndsOn: annualEnd } : {}),
      ...(notes.trim() ? { notes: notes.trim() } : {}),
      ...(editing ? { id: editing.id, expectedUpdatedAt: editing.updatedAt } : {}),
    };
    submitted.current = input;
    await write.submit(input);
  }
  return (
    <div className={styles.tabPanel}>
      <div className={styles.profileTop}>
        <div>
          <h2>{text("本客户合同收费约定", "Conventions de facturation du client")}</h2>
          <p className={styles.subtitle}>
            {text(
              "保存合同依据与待核事项，不改原合同，不生成应收。",
              "Conserver les sources et points à vérifier, sans modifier le contrat d’origine ni créer de créance.",
            )}
          </p>
        </div>
        {canWrite ? (
          <button
            className={styles.button}
            type="button"
            disabled={
              write.phase === "checking" ||
              write.phase === "submitting" ||
              write.phase === "unknown" ||
              !leaseContracts.length
            }
            onClick={() => start(null)}
          >
            {text("登记待核约定", "Ajouter une convention à vérifier")}
          </button>
        ) : null}
      </div>
      {!leaseContracts.length ? (
        <p className={styles.note}>
          {text(
            "本次待核收费约定先支持租赁合同。该客户没有已关联的租赁合同；出售合同原有功能保持不变。",
            "Les conventions à vérifier concernent pour l’instant les baux. Aucun bail n’est lié à ce client ; les fonctions existantes des ventes sont conservées.",
          )}
        </p>
      ) : null}
      <CimacWriteFeedback
        state={write}
        locale={locale}
        onRetry={() => submitted.current && void write.submit(submitted.current)}
      />
      {open ? (
        <section className={styles.panel}>
          <div className={styles.sectionHead}>
            <h3>
              {editing
                ? text("补充约定 · 保留原记录审计", "Compléter la convention · audit conservé")
                : text("登记合同收费依据", "Enregistrer une source contractuelle")}
            </h3>
            <button
              className={styles.quietButton}
              type="button"
              disabled={write.phase === "submitting"}
              onClick={() => setOpen(false)}
            >
              {text("收起", "Fermer")}
            </button>
          </div>
          <form className={styles.form} onSubmit={(event) => void submit(event)}>
            <fieldset className={styles.fieldset} disabled={write.locked || !canWrite}>
              <div className={styles.formColumns}>
                <label className={styles.field}>
                  <span>{text("房屋 / 合同", "Bien / contrat")}</span>
                  <select
                    className={styles.select}
                    value={contractId}
                    disabled={!!editing}
                    onChange={(event) => setContractId(event.target.value)}
                    required
                  >
                    <option value="">{text("请选择实际合同", "Choisir le contrat réel")}</option>
                    {leaseContracts.map((item) => (
                      <option key={item.id} value={item.id}>
                        {units.get(item.unitId)?.unit_no ?? "—"} · {item.contractNo}
                      </option>
                    ))}
                  </select>
                </label>
                <label className={styles.field}>
                  <span>{text("费种", "Nature des frais")}</span>
                  <select
                    className={styles.select}
                    value={category}
                    disabled={!!editing}
                    onChange={(event) => setCategory(event.target.value as typeof category)}
                  >
                    {(
                      [
                        "property_fee",
                        "lease_rent",
                        "lease_deposit",
                        "water",
                        "electricity",
                        "management_fee",
                      ] as const
                    ).map((value) => (
                      <option key={value} value={value}>
                        {billingCategory(value, locale)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className={styles.field}>
                  <span>{text("原币", "Devise d’origine")}</span>
                  <select
                    className={styles.select}
                    value={currency}
                    onChange={(event) => setCurrency(event.target.value as typeof currency)}
                  >
                    {["XOF", "USD", "CNY"].map((value) => (
                      <option key={value} value={value}>
                        {value}
                      </option>
                    ))}
                  </select>
                </label>
                <label className={styles.field}>
                  <span>{text("计价方式", "Base de calcul")}</span>
                  <select
                    className={styles.select}
                    value={pricingBasis}
                    onChange={(event) => setPricingBasis(event.target.value as typeof pricingBasis)}
                  >
                    <option value="pending">{text("待核", "À vérifier")}</option>
                    <option value="per_sqm">{text("每平方米每月", "Par m² et par mois")}</option>
                    <option value="per_unit">{text("每户每月", "Par bien et par mois")}</option>
                  </select>
                </label>
                <label className={styles.field}>
                  <span>{text("已知月单价，不知道留空", "Tarif mensuel connu, sinon vide")}</span>
                  <input
                    className={styles.input}
                    type="number"
                    inputMode="decimal"
                    min="0.01"
                    step="0.01"
                    value={rate}
                    onChange={(event) => setRate(event.target.value)}
                  />
                </label>
                <label className={styles.field}>
                  <span>
                    {text(
                      "合同计费面积 · ㎡，不取资产面积代填",
                      "Surface contractuelle · m², sans reprise automatique",
                    )}
                  </span>
                  <input
                    className={styles.input}
                    type="number"
                    inputMode="decimal"
                    min="0.001"
                    step="0.001"
                    value={area}
                    onChange={(event) => setArea(event.target.value)}
                  />
                </label>
                <label className={styles.field}>
                  <span>
                    {text("本费种起算日 · 待核可留空", "Début de ces frais · vide si inconnu")}
                  </span>
                  <input
                    className={styles.input}
                    type="date"
                    value={startsOn}
                    onChange={(event) => setStartsOn(event.target.value)}
                  />
                </label>
                <label className={styles.field}>
                  <span>{text("本费种结束日 · 可留空", "Fin de ces frais · facultative")}</span>
                  <input
                    className={styles.input}
                    type="date"
                    min={startsOn || undefined}
                    value={endsOn}
                    onChange={(event) => setEndsOn(event.target.value)}
                  />
                </label>
                <label className={styles.field}>
                  <span>{text("约定年度开始日 · 可留空", "Début de l’exercice · facultatif")}</span>
                  <input
                    className={styles.input}
                    type="date"
                    value={annualStart}
                    onChange={(event) => setAnnualStart(event.target.value)}
                  />
                </label>
                <label className={styles.field}>
                  <span>{text("约定年度结束日 · 可留空", "Fin de l’exercice · facultative")}</span>
                  <input
                    className={styles.input}
                    type="date"
                    min={annualStart || undefined}
                    value={annualEnd}
                    onChange={(event) => setAnnualEnd(event.target.value)}
                  />
                </label>
                <label className={styles.field}>
                  <span>{text("不足整月处理", "Mois incomplet")}</span>
                  <select
                    className={styles.select}
                    value={proration}
                    onChange={(event) => setProration(event.target.value as typeof proration)}
                  >
                    <option value="daily_pending_convention">
                      {text("按天，分母 / 首尾 / 舍入待核", "Journalier, modalités à vérifier")}
                    </option>
                    <option value="pending">{text("待核", "À vérifier")}</option>
                  </select>
                </label>
              </div>
              <label className={styles.field}>
                <span>{text("约定来源 · 必填", "Source de la convention · obligatoire")}</span>
                <textarea
                  className={styles.input}
                  maxLength={1000}
                  value={source}
                  onChange={(event) => setSource(event.target.value)}
                  placeholder={text(
                    "合同编号、页码、已确认的说明；原文件中的疑点也请保留",
                    "Contrat, page et précision confirmée ; conserver aussi les incohérences de la source",
                  )}
                  required
                />
              </label>
              <label className={styles.field}>
                <span>
                  {text(
                    "待核事项 / 特殊减免条件",
                    "Points à vérifier / exonérations particulières",
                  )}
                </span>
                <textarea
                  className={styles.input}
                  maxLength={2000}
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                />
              </label>
            </fieldset>
            {validation ? (
              <p role="alert" className={styles.feedback}>
                {validation}
              </p>
            ) : null}
            <div className={styles.actions}>
              <button
                className={styles.primaryButton}
                type="submit"
                disabled={write.locked || !canWrite}
              >
                {write.phase === "submitting"
                  ? text("正在保存…", "Enregistrement…")
                  : text("保存为待核约定", "Conserver à vérifier")}
              </button>
              <span className={styles.note}>
                {text(
                  "不会变成欠款，不覆盖历史账单。",
                  "Ne devient pas une dette et ne remplace pas les créances historiques.",
                )}
              </span>
            </div>
          </form>
        </section>
      ) : null}
      <section className={styles.panel}>
        <div className={styles.sectionHead}>
          <h3>{text("已保存的合同依据", "Sources contractuelles conservées")}</h3>
          <span>
            {data.feeTerms.length} {text("项 · 均待核", "éléments · à vérifier")}
          </span>
        </div>
        {data.feeTerms.length ? (
          <dl className={styles.rules}>
            {data.feeTerms.map((row) => (
              <div className={styles.rule} key={row.id}>
                <dt>
                  {units.get(row.unitId)?.unit_no ?? text("房屋待核", "Lot à vérifier")}
                  <p className={styles.meta}>{billingCategory(row.category, locale)}</p>
                </dt>
                <dd>
                  <span className={`${styles.status} ${styles.pending}`}>
                    {text("合同依据待核", "Source à vérifier")}
                  </span>
                  <p className={styles.meta}>
                    {text("月单价", "Tarif mensuel")} {billingNumber(row.monthlyRate, locale)}{" "}
                    {row.currency} · {text("合同计费面积", "Surface contractuelle")}{" "}
                    {billingNumber(row.chargeableArea, locale)} ㎡
                  </p>
                  <p className={styles.meta}>
                    {text("起算日", "Début")} {row.startsOn ?? text("待核", "À vérifier")} ·{" "}
                    {text("结束日", "Fin")} {row.endsOn ?? text("待核", "À vérifier")}
                  </p>
                  <p className={styles.meta}>
                    {text("年度", "Exercice")} {row.annualStartsOn ?? "—"} →{" "}
                    {row.annualEndsOn ?? "—"}
                  </p>
                  <p>{row.source}</p>
                  {row.notes ? <p className={styles.meta}>{row.notes}</p> : null}
                  {canWrite ? (
                    <button
                      className={styles.quietButton}
                      type="button"
                      disabled={
                        write.phase === "checking" ||
                        write.phase === "submitting" ||
                        write.phase === "unknown"
                      }
                      onClick={() => start(row)}
                    >
                      {text("补充 / 更正", "Compléter / corriger")}
                    </button>
                  ) : null}
                </dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className={styles.empty}>
            {text(
              "尚未登记本客户的收费约定。统一参考标准不会自动写入合同。",
              "Aucune convention enregistrée pour ce client. Les références générales ne sont pas copiées automatiquement dans les contrats.",
            )}
          </p>
        )}
      </section>
    </div>
  );
}
