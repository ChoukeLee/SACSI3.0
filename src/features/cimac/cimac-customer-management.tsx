"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type {
  CustomerDirectoryProfile,
  CustomerRelation,
} from "@/features/customers/customer-directory-model";
import { manageCimacCustomer, readCimacCustomerLinkOptions } from "./cimac-profile-actions";
import type { CimacCustomerLinkInput } from "./cimac-customer-management-model";
import styles from "./cimac-workspace.module.css";

export function CimacCustomerManagement({
  profile,
  relations,
  locale,
}: {
  profile: CustomerDirectoryProfile;
  relations: CustomerRelation[];
  locale: "zh" | "fr";
}) {
  const zh = locale === "zh";
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [requestId, setRequestId] = useState("");
  const [options, setOptions] = useState<{ id: string; label: string }[]>([]);
  const [membership, setMembership] = useState<"current" | "archived">(
    profile.membershipStatus ?? "current",
  );
  const [unitId, setUnitId] = useState("");
  const [brand, setBrand] = useState("");
  const [kind, setKind] = useState<CimacCustomerLinkInput["relationshipKind"]>("reservation");
  const [signing, setSigning] = useState<CimacCustomerLinkInput["signingState"]>("unconfirmed");
  const [signedDate, setSignedDate] = useState("");
  const [source, setSource] = useState("");
  const changed = () => {
    setSaved(false);
  };
  async function show() {
    setOpen(true);
    setBusy(true);
    setError("");
    changed();
    if (!requestId) setRequestId(crypto.randomUUID());
    try {
      const result = await readCimacCustomerLinkOptions();
      if (result.success && result.data) setOptions(result.data);
      else setError(result.error || (zh ? "铺位列表读取失败" : "Lots indisponibles"));
    } catch {
      setError(zh ? "铺位列表读取失败，请重试。" : "Impossible de charger les lots.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className={styles.stack}>
      <button
        className={styles.button}
        type="button"
        onClick={() => (open ? setOpen(false) : void show())}
      >
        {zh ? "维护园区名册与铺位关联" : "Gérer le répertoire et les lots"}
      </button>
      {saved ? <p role="status">{zh ? "园区资料已保存" : "Données du parc enregistrées"}</p> : null}
      {open ? (
        <form
          className={styles.stack}
          aria-label={zh ? "园区客户关系维护" : "Relations client du parc"}
          onSubmit={async (event) => {
            event.preventDefault();
            if (busy) return;
            setBusy(true);
            setError("");
            try {
              const result = await manageCimacCustomer(
                requestId,
                profile.id,
                profile.updated_at,
                membership,
                unitId
                  ? {
                      unitId,
                      brand: brand.trim() || null,
                      relationshipKind: kind,
                      signingState: signing,
                      signedDate: signedDate || null,
                      sourceReference: source.trim(),
                    }
                  : undefined,
              );
              if (result.success) {
                setOpen(false);
                setSaved(true);
                setRequestId("");
                router.refresh();
              } else setError(result.error || (zh ? "保存失败" : "Échec de l’enregistrement"));
            } catch {
              setError(zh ? "保存失败，请刷新核对后重试。" : "Échec, actualisez puis réessayez.");
            } finally {
              setBusy(false);
            }
          }}
        >
          <p>
            {zh
              ? "归档仅从建材城当前名册隐藏，保留客户及历史账务。关联资料的生效不代表已起租或已收款。"
              : "L’archivage masque la fiche du répertoire courant CIMAC et conserve l’historique. Un contrat confirmé ne prouve ni début du loyer ni encaissement."}
          </p>
          <label className={styles.field}>
            {zh ? "园区名册状态" : "État du répertoire"}
            <select
              className={styles.input}
              value={membership}
              disabled={busy}
              onChange={(e) => {
                setMembership(e.target.value as "current" | "archived");
                changed();
              }}
            >
              <option value="current">{zh ? "当前客户" : "Client courant"}</option>
              <option value="archived">{zh ? "归档客户" : "Client archivé"}</option>
            </select>
          </label>
          <label className={styles.field}>
            {zh ? "新增或更新关联铺位" : "Ajouter ou actualiser un lot lié"}
            <select
              className={styles.input}
              value={unitId}
              disabled={busy}
              onChange={(e) => {
                const id = e.target.value,
                  relation = relations.find((r) => r.unitId === id);
                setUnitId(id);
                setBrand(relation?.brand ?? "");
                setSource(relation?.sourceReference ?? "");
                setKind(relation?.relationshipKind ?? "reservation");
                setSigning(relation?.signingState ?? "unconfirmed");
                setSignedDate(relation?.signedDate ?? "");
                changed();
              }}
            >
              <option value="">{zh ? "仅维护名册状态" : "État du répertoire uniquement"}</option>
              {options.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          {unitId ? (
            <>
              <label className={styles.field}>
                {zh ? "此铺经营品牌" : "Marque de ce lot"}
                <input
                  className={styles.input}
                  maxLength={250}
                  value={brand}
                  onChange={(e) => {
                    setBrand(e.target.value);
                    changed();
                  }}
                />
              </label>
              <label className={styles.field}>
                {zh ? "关系资料" : "Nature du lien"}
                <select
                  className={styles.input}
                  value={kind}
                  onChange={(e) => {
                    setKind(e.target.value as typeof kind);
                    changed();
                  }}
                >
                  <option value="reservation">{zh ? "预留铺位" : "Lot réservé"}</option>
                  <option value="signed_contract">{zh ? "签约资料" : "Dossier contractuel"}</option>
                </select>
              </label>
              <label className={styles.field}>
                {zh ? "签署确认" : "Confirmation de signature"}
                <select
                  className={styles.input}
                  value={signing}
                  onChange={(e) => {
                    setSigning(e.target.value as typeof signing);
                    changed();
                  }}
                >
                  <option value="unconfirmed">{zh ? "待核" : "À vérifier"}</option>
                  <option value="signed_effective">
                    {zh ? "合同已确认生效" : "Contrat confirmé en vigueur"}
                  </option>
                </select>
              </label>
              <label className={styles.field}>
                {zh ? "真实签署日期（未知留空）" : "Date réelle de signature (facultative)"}
                <input
                  className={styles.input}
                  type="date"
                  value={signedDate}
                  onChange={(e) => {
                    setSignedDate(e.target.value);
                    changed();
                  }}
                />
              </label>
              <label className={styles.field}>
                {zh ? "合同或来源资料" : "Contrat ou pièce source"}
                <input
                  required
                  className={styles.input}
                  maxLength={2000}
                  value={source}
                  onChange={(e) => {
                    setSource(e.target.value);
                    changed();
                  }}
                />
              </label>
            </>
          ) : null}
          {error ? <p role="alert">{error}</p> : null}
          <button className={styles.button} type="submit" disabled={busy}>
            {busy ? (zh ? "处理中…" : "En cours…") : zh ? "保存园区资料" : "Enregistrer"}
          </button>
        </form>
      ) : null}
    </div>
  );
}
