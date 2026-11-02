"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { Locale } from "@/lib/i18n";
import type { CimacApartmentRoom } from "./cimac-apartment-model";
import type {
  CimacApartmentReservationOperation,
  CimacApartmentReservationRequest,
} from "./cimac-apartment-reservation-model";
import {
  checkCimacApartmentReservationStatus,
  executeCimacApartmentReservations,
} from "./cimac-apartment-reservation-actions";
import styles from "./cimac-apartment-workbench.module.css";

interface Props {
  room: CimacApartmentRoom;
  projectId: string;
  buildingId: string;
  locale: Locale;
}
interface PendingMarker {
  version: 1;
  requestId: string;
  fingerprint: string;
}
class ReservationInputError extends Error {}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const stamp = (value: unknown): value is string =>
  typeof value === "string" &&
  /^\d{4}-\d{2}-\d{2}T/.test(value) &&
  Number.isFinite(Date.parse(value));

function readMarker(key: string): PendingMarker | null {
  try {
    const marker = JSON.parse(sessionStorage.getItem(key) ?? "null");
    return marker?.version === 1 &&
      uuid.test(marker.requestId ?? "") &&
      /^[0-9a-f]{64}$/.test(marker.fingerprint ?? "")
      ? { version: 1, requestId: marker.requestId.toLowerCase(), fingerprint: marker.fingerprint }
      : null;
  } catch {
    return null;
  }
}
function writeMarker(key: string, marker: PendingMarker | null) {
  try {
    if (marker) sessionStorage.setItem(key, JSON.stringify(marker));
    else sessionStorage.removeItem(key);
  } catch {
    // The original request remains available in memory if browser storage is disabled.
  }
}
async function fingerprint(input: CimacApartmentReservationRequest) {
  const bytes = new TextEncoder().encode(JSON.stringify(input));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** No name or reason is persisted in browser storage, only the request ID and SHA-256. */
export function CimacApartmentReservationForm({ room, projectId, buildingId, locale }: Props) {
  const zh = locale === "zh";
  const router = useRouter();
  const inputId = useId();
  const [mode, setMode] = useState<CimacApartmentReservationOperation | null>(null);
  const [name, setName] = useState(room.reservation?.reserverName ?? "");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [marker, setMarker] = useState<PendingMarker | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saved, setSaved] = useState(false);
  const pending = useRef<CimacApartmentReservationRequest | null>(null);
  const guard = useRef(false);
  const mounted = useRef(true);
  const nameInput = useRef<HTMLInputElement>(null);
  const reasonInput = useRef<HTMLTextAreaElement>(null);
  const storageKey = `cimac-apartment-reservation:${projectId}:${buildingId}:${room.unitId}`;
  const reservation = room.reservation?.status === "reserved" ? room.reservation : null;

  useEffect(() => {
    mounted.current = true;
    setMarker(readMarker(storageKey));
    setLoaded(true);
    return () => {
      mounted.current = false;
    };
  }, [storageKey]);
  useEffect(() => {
    if (mode === "cancel") reasonInput.current?.focus();
    else if (mode) nameInput.current?.focus();
  }, [mode]);

  function prepare(): CimacApartmentReservationRequest {
    if (!room.unitId || !room.unitUpdatedAt || !mode) throw new Error("missing_room_version");
    const trimmedName = name.trim();
    const trimmedReason = reason.trim();
    if (
      mode !== "cancel" &&
      (!trimmedName || trimmedName.length > 200 || /[\u0000-\u001f\u007f]/.test(trimmedName))
    )
      throw new ReservationInputError(
        zh ? "请填写预订人，最多200字。" : "Renseignez le réservataire, 200 caractères maximum.",
      );
    if (
      mode !== "reserve" &&
      (!trimmedReason ||
        trimmedReason.length > 2000 ||
        /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(trimmedReason))
    )
      throw new ReservationInputError(
        zh ? "请填写修改或取消理由，最多2000字。" : "Précisez le motif, 2 000 caractères maximum.",
      );
    const annotation =
      mode === "reserve"
        ? "按页面明确指令登记房间预留；未付款，入住日期和租期待定。"
        : trimmedReason;
    const originalInstruction =
      mode === "reserve"
        ? `建材城17栋${room.unitNo}预留给${trimmedName}；未付款，入住日期和租期待定。`
        : mode === "cancel"
          ? `取消建材城17栋${room.unitNo}的房间预留。理由：${trimmedReason}`
          : `将建材城17栋${room.unitNo}的预订人更正为${trimmedName}。理由：${trimmedReason}`;
    return {
      requestId: crypto.randomUUID(),
      originalInstruction,
      operations: [
        {
          type: mode,
          unitId: room.unitId,
          expectedUnitUpdatedAt: room.unitUpdatedAt,
          expectedReservationId: reservation?.id ?? null,
          expectedReservationUpdatedAt: reservation?.updatedAt ?? null,
          reserverName: mode === "cancel" ? null : trimmedName,
          reason: annotation,
        },
      ],
    };
  }

  async function submit(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    if (guard.current || checking || saved || !loaded || (marker && !pending.current)) return;
    guard.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      let input = pending.current;
      if (!input) {
        input = prepare();
        const nextMarker: PendingMarker = {
          version: 1,
          requestId: input.requestId,
          fingerprint: await fingerprint(input),
        };
        pending.current = input;
        writeMarker(storageKey, nextMarker);
        if (mounted.current) setMarker(nextMarker);
      }
      const result = await executeCimacApartmentReservations(input);
      if (!mounted.current) return;
      if (!result.success) {
        if (result.outcome === "rejected") {
          writeMarker(storageKey, null);
          pending.current = null;
          setMarker(null);
          setMode(null);
          router.refresh();
        }
        setError(
          zh
            ? result.error
            : "Demande refusée ou résultat non confirmé. Vérifiez la fiche et l’identifiant d’origine.",
        );
        return;
      }
      const operation = input.operations[0];
      const returned = result.rooms.length === 1 ? result.rooms[0] : null;
      const expectedName =
        operation.type === "cancel" ? reservation?.reserverName : operation.reserverName;
      if (
        result.requestId !== input.requestId ||
        typeof result.idempotent !== "boolean" ||
        !returned ||
        returned.unitId !== room.unitId ||
        returned.unitNo !== room.unitNo ||
        returned.status !== (operation.type === "cancel" ? "cancelled" : "reserved") ||
        returned.reserverName !== expectedName ||
        returned.paymentStatus !== "unpaid" ||
        !uuid.test(returned.reservationId) ||
        !stamp(returned.updatedAt) ||
        (operation.type !== "reserve" && returned.reservationId !== reservation?.id)
      ) {
        setError(
          zh
            ? "结果尚未核实，请按原请求核对或重试。"
            : "Résultat non vérifié. Contrôlez ou réessayez la demande d’origine.",
        );
        return;
      }
      writeMarker(storageKey, null);
      setMarker(null);
      setSaved(true);
      setNotice(
        zh
          ? "预留记录已核验保存，实际入住与账务未改动。"
          : "Réservation vérifiée et enregistrée ; séjour réel et comptabilité inchangés.",
      );
      router.refresh();
    } catch (failure) {
      if (mounted.current)
        setError(
          pending.current
            ? zh
              ? "结果尚未确认，请按原请求核对，不要重复登记。"
              : "Résultat non confirmé. Contrôlez la demande d’origine, sans doublon."
            : failure instanceof ReservationInputError
              ? failure.message
              : zh
                ? "房间资料已变化或无法准备请求，请刷新后重试。"
                : "Actualisez la fiche avant de préparer une nouvelle demande.",
        );
    } finally {
      guard.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  async function checkOriginal() {
    if (!marker || guard.current || checking) return;
    guard.current = true;
    setChecking(true);
    setError("");
    try {
      const result = await checkCimacApartmentReservationStatus(marker.requestId);
      if (!mounted.current) return;
      if (
        !result.success ||
        result.requestId !== marker.requestId ||
        result.verified !== false ||
        typeof result.found !== "boolean"
      ) {
        setError(
          !result.success && zh
            ? result.error
            : zh
              ? "暂时无法核对原请求，请保留编号。"
              : "Conservez l’identifiant : vérification indisponible.",
        );
        return;
      }
      if (!result.found) {
        setNotice(
          zh
            ? "尚未查到原请求完成记录，请保留编号，不要换号重录。"
            : "Aucune exécution retrouvée. Conservez l’identifiant sans recréer la demande.",
        );
        return;
      }
      writeMarker(storageKey, null);
      pending.current = null;
      setMarker(null);
      setMode(null);
      setNotice(
        zh
          ? "已查到原请求完成记录，已刷新；请核对当前房态。"
          : "Exécution d’origine retrouvée. Fiche actualisée : contrôlez l’état actuel.",
      );
      router.refresh();
    } catch {
      if (mounted.current)
        setError(
          zh
            ? "暂时无法核对原请求，请保留编号。"
            : "Conservez l’identifiant : vérification indisponible.",
        );
    } finally {
      guard.current = false;
      if (mounted.current) setChecking(false);
    }
  }

  if (!room.registered || !room.unitId || !room.unitUpdatedAt) return null;
  const locked = busy || checking || saved || Boolean(marker);
  return (
    <section
      className={styles.reservationOperations}
      aria-label={zh ? "房间预留操作" : "Gestion de la réservation"}
    >
      {!mode && !marker ? (
        <div className={styles.reservationButtons}>
          {reservation ? (
            <>
              <button
                type="button"
                disabled={!loaded || saved}
                onClick={() => {
                  setMode("correct_name");
                  setError("");
                  setNotice("");
                }}
              >
                {zh ? "更正预订人" : "Corriger le réservataire"}
              </button>
              <button
                type="button"
                disabled={!loaded || saved}
                onClick={() => {
                  setMode("cancel");
                  setError("");
                  setNotice("");
                }}
              >
                {zh ? "取消预留" : "Annuler la réservation"}
              </button>
            </>
          ) : (
            <button
              type="button"
              disabled={!loaded || saved}
              onClick={() => {
                setMode("reserve");
                setName("");
                setError("");
                setNotice("");
              }}
            >
              {zh ? "登记房间预留" : "Réserver ce logement"}
            </button>
          )}
        </div>
      ) : null}
      {mode ? (
        <form onSubmit={(event) => void submit(event)} className={styles.reservationForm}>
          <h3>
            {zh
              ? mode === "reserve"
                ? "登记房间预留"
                : mode === "cancel"
                  ? "取消房间预留"
                  : "更正预订人"
              : mode === "reserve"
                ? "Réserver le logement"
                : mode === "cancel"
                  ? "Annuler la réservation"
                  : "Corriger le réservataire"}
          </h3>
          <p className={styles.small}>
            {zh
              ? "未付款 · 入住日期与租期待定；预留不表示已入住。"
              : "Non payé · arrivée et durée à préciser ; réservation sans séjour réel."}
          </p>
          {mode !== "cancel" ? (
            <label htmlFor={`${inputId}-name`}>
              {zh ? "预订人" : "Réservataire"}
              <input
                ref={nameInput}
                id={`${inputId}-name`}
                autoComplete="off"
                value={name}
                maxLength={200}
                disabled={locked}
                required
                onChange={(event) => setName(event.target.value)}
              />
            </label>
          ) : (
            <p className={styles.small}>{reservation?.reserverName}</p>
          )}
          {mode !== "reserve" ? (
            <label htmlFor={`${inputId}-reason`}>
              {zh ? "理由" : "Motif"}
              <textarea
                ref={reasonInput}
                id={`${inputId}-reason`}
                value={reason}
                maxLength={2000}
                rows={2}
                disabled={locked}
                required
                onChange={(event) => setReason(event.target.value)}
              />
            </label>
          ) : null}
          {!marker ? (
            <div className={styles.reservationButtons}>
              <button
                className={styles.reservationSubmit}
                type="submit"
                disabled={busy || checking || saved || !loaded}
              >
                {busy
                  ? zh
                    ? "正在登记…"
                    : "Enregistrement…"
                  : zh
                    ? mode === "reserve"
                      ? "登记预留"
                      : mode === "cancel"
                        ? "确认取消预留"
                        : "保存预订人"
                    : mode === "reserve"
                      ? "Enregistrer"
                      : mode === "cancel"
                        ? "Confirmer l’annulation"
                        : "Enregistrer le nom"}
              </button>
              <button
                type="button"
                disabled={busy || checking || saved}
                onClick={() => setMode(null)}
              >
                {zh ? "返回" : "Retour"}
              </button>
            </div>
          ) : null}
        </form>
      ) : null}
      {marker ? (
        <div className={styles.reservationRecovery}>
          <p>
            {zh ? "原请求编号：" : "Demande d’origine : "}
            <code>{marker.requestId}</code>
          </p>
          <div className={styles.reservationButtons}>
            {pending.current ? (
              <button type="button" disabled={busy || checking} onClick={() => void submit()}>
                {busy
                  ? zh
                    ? "正在核验…"
                    : "Vérification…"
                  : zh
                    ? "按原请求重试"
                    : "Réessayer la demande d’origine"}
              </button>
            ) : null}
            <button type="button" disabled={busy || checking} onClick={() => void checkOriginal()}>
              {checking
                ? zh
                  ? "正在查询…"
                  : "Recherche…"
                : zh
                  ? "核对原请求"
                  : "Vérifier la demande"}
            </button>
          </div>
        </div>
      ) : null}
      {error ? (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      ) : null}
      {notice ? (
        <p role="status" className={styles.small}>
          {notice}
        </p>
      ) : null}
    </section>
  );
}
