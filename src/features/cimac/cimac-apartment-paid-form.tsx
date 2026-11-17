"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { Locale } from "@/lib/i18n";
import type { CimacApartmentRoom } from "./cimac-apartment-model";
import {
  parseApartmentPaidRequest,
  paidQuarterEnd,
  type ApartmentPaidRequest,
} from "./cimac-apartment-paid-model";
import {
  checkApartmentPaidStatus,
  executeApartmentPaidReceipt,
} from "./cimac-apartment-paid-actions";
import styles from "./cimac-apartment-workbench.module.css";

interface Props {
  rooms: CimacApartmentRoom[];
  selectedUnitId: string;
  projectId: string;
  buildingId: string;
  locale: Locale;
}
interface Marker {
  version: 1;
  requestId: string;
  fingerprint: string;
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function stored(key: string): Marker | null {
  try {
    const m = JSON.parse(sessionStorage.getItem(key) ?? "null");
    return m?.version === 1 &&
      uuid.test(m.requestId ?? "") &&
      /^[0-9a-f]{64}$/.test(m.fingerprint ?? "")
      ? { version: 1, requestId: m.requestId, fingerprint: m.fingerprint }
      : null;
  } catch {
    return null;
  }
}
function remember(key: string, marker: Marker | null) {
  try {
    if (marker) sessionStorage.setItem(key, JSON.stringify(marker));
    else sessionStorage.removeItem(key);
  } catch {
    /* The exact request also remains in memory. */
  }
}
async function digest(request: ApartmentPaidRequest) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(request))),
    ),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
}
const amount = (n: number) => `${new Intl.NumberFormat("zh-CN").format(n)} XOF（${n / 10000}万）`;

/** One physical receipt, explicitly split into deposit and prepaid rent for each room. */
export function CimacApartmentPaidForm({
  rooms,
  selectedUnitId,
  projectId,
  buildingId,
  locale,
}: Props) {
  const zh = locale === "zh",
    router = useRouter(),
    id = useId();
  const key = `cimac-apartment-paid:${projectId}:${buildingId}`;
  const eligible = rooms.filter(
    (r) =>
      r.registered &&
      r.unitId &&
      r.unitUpdatedAt &&
      !r.reservation &&
      !r.paidReservation &&
      r.constructionStatus === "operational" &&
      r.operationalCondition === "normal" &&
      r.occupancyState !== "occupied",
  );
  const [open, setOpen] = useState(false),
    [chosen, setChosen] = useState<string[]>([selectedUnitId]);
  const [review, setReview] = useState<ApartmentPaidRequest | null>(null),
    [marker, setMarker] = useState<Marker | null>(null);
  const [loaded, setLoaded] = useState(false),
    [busy, setBusy] = useState(false),
    [saved, setSaved] = useState(false),
    [error, setError] = useState("");
  const pending = useRef<ApartmentPaidRequest | null>(null),
    uncertain = useRef(false),
    guard = useRef(false),
    mounted = useRef(true);
  const activeRooms = eligible.filter((r) => chosen.includes(r.unitId!));
  const total = activeRooms.reduce((sum, r) => sum + r.monthlyRentXof * 5, 0);
  useEffect(() => {
    mounted.current = true;
    setMarker(stored(key));
    setLoaded(true);
    return () => {
      mounted.current = false;
    };
  }, [key]);
  function prepare(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    try {
      const form = new FormData(event.currentTarget),
        get = (k: string) => String(form.get(k) ?? "").trim();
      const start = get("agreementStartDate"),
        external = get("externalReceiptNo");
      const input = parseApartmentPaidRequest({
        requestId: crypto.randomUUID(),
        originalInstruction: zh
          ? "按核对页明确登记一位客户多房同一收据已收押金及预付租金；约定租期不代表实际入住。"
          : "Enregistrer le dépôt et le loyer prépayé d’un reçu unique ; aucune entrée réelle n’est déclarée.",
        customerName: get("customerName"),
        agreementStartDate: start,
        agreementEndDate: get("agreementEndDate"),
        paidPeriodStart: start,
        paidPeriodEnd: paidQuarterEnd(start),
        paymentDate: get("paymentDate"),
        paymentMethod: get("paymentMethod"),
        currency: "XOF",
        sourceRef: get("sourceRef"),
        ...(external ? { externalReceiptNo: external } : {}),
        reason: get("reason"),
        totalAmountXof: Number(get("totalAmountXof")),
        rooms: activeRooms.map((r) => ({
          unitId: r.unitId,
          expectedUnitUpdatedAt: r.unitUpdatedAt,
          expectedHoldId: null,
          expectedHoldUpdatedAt: null,
          monthlyRentXof: r.monthlyRentXof,
          depositMonths: 2,
          rentPrepayMonths: 3,
          depositAmountXof: r.monthlyRentXof * 2,
          rentAmountXof: r.monthlyRentXof * 3,
        })),
      });
      setReview(input);
    } catch {
      setError(
        zh
          ? "请核对必填资料、完整月租期、付款日期及实际收据总额；押2付3合计必须相符。"
          : "Vérifiez les champs, dates et total réel du reçu (dépôt 2 mois + loyer 3 mois).",
      );
    }
  }
  async function submit() {
    const request = pending.current ?? review;
    if (!request || guard.current) return;
    guard.current = true;
    setBusy(true);
    setError("");
    try {
      if (!pending.current) {
        const m = {
          version: 1 as const,
          requestId: request.requestId,
          fingerprint: await digest(request),
        };
        pending.current = request;
        remember(key, m);
        if (mounted.current) setMarker(m);
      }
      const result = await executeApartmentPaidReceipt(request);
      if (!mounted.current) return;
      if (result.success) {
        remember(key, null);
        setMarker(null);
        pending.current = null;
        setSaved(true);
        router.refresh();
      } else {
        setError(result.error);
        if (result.outcome === "rejected" && !uncertain.current) {
          remember(key, null);
          setMarker(null);
          pending.current = null;
          setReview(null);
        }
        if (result.outcome !== "rejected") uncertain.current = true;
      }
    } catch {
      uncertain.current = true;
      if (mounted.current)
        setError(
          zh
            ? "结果尚未核实。请查询原请求或原样重试，不要另建收据。"
            : "Résultat inconnu. Vérifiez ou réessayez la même demande.",
        );
    } finally {
      guard.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  async function check() {
    if (!marker || guard.current) return;
    guard.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await checkApartmentPaidStatus(marker.requestId);
      if (!mounted.current) return;
      if (result.success && result.found) {
        remember(key, null);
        setMarker(null);
        pending.current = null;
        setSaved(true);
        router.refresh();
      } else
        setError(
          result.success
            ? zh
              ? "尚未查到已完成记录；保留原请求号，不能据此换号重录。"
              : "Aucun résultat confirmé ; conservez l’identifiant initial."
            : result.error,
        );
    } catch {
      if (mounted.current)
        setError(zh ? "查询未完成，请稍后保留原请求号重试。" : "Vérification indisponible.");
    } finally {
      guard.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  if (saved)
    return (
      <section className={styles.reservationForm}>
        <p role="status">
          {zh
            ? "已收押租预订已核验保存，房间资料正在刷新；实际入住仍待补充。"
            : "Réservation payée vérifiée ; actualisation en cours. Entrée réelle à compléter."}
        </p>
      </section>
    );
  return (
    <section
      className={styles.reservationForm}
      aria-label={zh ? "已收押租预订" : "Réservation payée"}
    >
      <h3>{zh ? "已收押租预订" : "Réservation payée"}</h3>
      <p>
        {zh
          ? "一位客户、多间房、一张收据。仅登记押金和首季租金；物业费另行核实。约定起租不表示实际入住。"
          : "Un client, plusieurs logements, un reçu : dépôt et premier trimestre. Charges séparées ; l’entrée réelle reste à confirmer."}
      </p>
      {!open && !marker ? (
        <button
          type="button"
          className={styles.primaryButton}
          disabled={!loaded || !eligible.length}
          onClick={() => setOpen(true)}
        >
          {zh ? "登记已收押租" : "Enregistrer le dépôt et loyer reçus"}
        </button>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
      {marker ? (
        <div>
          <p>
            {zh ? "待核原请求号：" : "Demande en attente : "}
            {marker.requestId}
          </p>
          <div className={styles.reservationButtons}>
            <button type="button" disabled={busy} onClick={() => void check()}>
              {zh ? "查询原请求" : "Vérifier la demande"}
            </button>
            {pending.current ? (
              <button type="button" disabled={busy} onClick={() => void submit()}>
                {zh ? "原样重试" : "Réessayer à l’identique"}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
      {open && !marker && !review ? (
        <form onSubmit={prepare} className={styles.paidFields}>
          <fieldset>
            <legend>
              {zh
                ? "选择房间（须先取消旧未付款预留）"
                : "Logements (annuler les anciens blocages non payés)"}
            </legend>
            <div className={styles.paidRoomChoices}>
              {eligible.map((r) => (
                <label key={r.unitId}>
                  <input
                    type="checkbox"
                    checked={chosen.includes(r.unitId!)}
                    onChange={(e) =>
                      setChosen((v) =>
                        e.target.checked ? [...v, r.unitId!] : v.filter((n) => n !== r.unitId),
                      )
                    }
                  />
                  {r.unitNo}
                </label>
              ))}
            </div>
          </fieldset>
          <label htmlFor={`${id}-name`}>
            {zh ? "客户姓名" : "Nom du client"}
            <input id={`${id}-name`} name="customerName" required maxLength={200} />
          </label>
          <label>
            {zh ? "约定起租日（每月1日）" : "Début convenu (1er du mois)"}
            <input name="agreementStartDate" type="date" required />
          </label>
          <label>
            {zh ? "约定合同到期日（月末）" : "Fin convenue du contrat (fin de mois)"}
            <input name="agreementEndDate" type="date" required />
          </label>
          <label>
            {zh ? "实际收款日" : "Date réelle de réception"}
            <input name="paymentDate" type="date" required />
          </label>
          <label>
            {zh ? "收款方式" : "Mode de paiement"}
            <select name="paymentMethod" required defaultValue="">
              <option value="">{zh ? "请选择" : "Choisir"}</option>
              <option value="cash">{zh ? "现金" : "Espèces"}</option>
              <option value="bank_transfer">{zh ? "转账" : "Virement"}</option>
              <option value="check">{zh ? "支票" : "Chèque"}</option>
              <option value="other">{zh ? "其他" : "Autre"}</option>
            </select>
          </label>
          <p>
            {zh ? "所选房间押2付3测算：" : "Estimation dépôt 2 mois + loyer 3 mois : "}
            {amount(total)}
          </p>
          <label>
            {zh ? "实际收据总额（西法元，不是万）" : "Montant réel du reçu (XOF, unité entière)"}
            <input
              name="totalAmountXof"
              type="number"
              min={1}
              max={999999999999}
              step={1}
              required
            />
          </label>
          <label>
            {zh ? "凭据来源" : "Source justificative"}
            <input name="sourceRef" required maxLength={500} />
          </label>
          <label>
            {zh ? "外部收据号（可选，仅作来源）" : "N° du reçu externe (facultatif)"}
            <input name="externalReceiptNo" maxLength={100} />
          </label>
          <label>
            {zh ? "登记说明" : "Motif"}
            <textarea name="reason" required maxLength={2000} />
          </label>
          <button className={styles.primaryButton} type="submit">
            {zh ? "核对收款及分房金额" : "Vérifier le reçu et les répartitions"}
          </button>
        </form>
      ) : null}
      {review && !marker ? (
        <div className={styles.paidReview} aria-label={zh ? "收款核对" : "Vérification du reçu"}>
          <p>
            {zh ? "登记参考号：" : "Référence d’enregistrement : "}
            {review.requestId}
          </p>
          <p>
            <strong>{review.customerName}</strong> ·{" "}
            {review.rooms.map((r) => rooms.find((x) => x.unitId === r.unitId)?.unitNo).join("、")}
          </p>
          <p>
            {zh ? "约定租期：" : "Période convenue : "}
            {review.agreementStartDate} — {review.agreementEndDate}
          </p>
          <p>
            {zh ? "首季租金已付期间：" : "Loyer prépayé : "}
            {review.paidPeriodStart} — {review.paidPeriodEnd}
          </p>
          {review.rooms.map((r) => (
            <p key={r.unitId}>
              {rooms.find((x) => x.unitId === r.unitId)?.unitNo} · {zh ? "押金" : "Dépôt"}{" "}
              {amount(r.depositAmountXof)} + {zh ? "租金" : "Loyer"} {amount(r.rentAmountXof)}
            </p>
          ))}
          <p>
            {review.paymentDate} ·{" "}
            {
              {
                cash: zh ? "现金" : "Espèces",
                bank_transfer: zh ? "转账" : "Virement",
                check: zh ? "支票" : "Chèque",
                other: zh ? "其他" : "Autre",
              }[review.paymentMethod]
            }
          </p>
          <p>
            <strong>
              {zh ? "同一张收据实收合计：" : "Total réel du reçu unique : "}
              {amount(review.totalAmountXof)}
            </strong>
          </p>
          <p>
            {review.sourceRef}
            {review.externalReceiptNo ? ` · ${review.externalReceiptNo}` : ""}
          </p>
          <p>{review.reason}</p>
          <p>
            {zh
              ? "实际入住仍待补充。确认后不会替代入住登记。"
              : "L’entrée réelle reste à compléter séparément."}
          </p>
          <div className={styles.reservationButtons}>
            <button type="button" disabled={busy} onClick={() => setReview(null)}>
              {zh ? "返回修改" : "Modifier"}
            </button>
            <button
              className={styles.primaryButton}
              type="button"
              disabled={busy}
              onClick={() => void submit()}
            >
              {busy
                ? zh
                  ? "正在登记"
                  : "Enregistrement…"
                : zh
                  ? "确认登记已收押租"
                  : "Confirmer le reçu"}
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
