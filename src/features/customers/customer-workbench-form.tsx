"use client";

import { useState } from "react";
import { RightDrawer } from "@/components/ui/operational";
import { createCustomer, updateCustomer, type CustomerFormInput } from "./actions";
import type { CustomerDirectoryProfile } from "./customer-directory-model";
import styles from "./customer-workbench.module.css";

export function CustomerWorkbenchForm({
  profile,
  locale,
  onClose,
  onSaved,
}: {
  profile: CustomerDirectoryProfile | null;
  locale: "zh" | "fr";
  onClose: () => void;
  onSaved: (id: string, created: boolean) => void;
}) {
  const zh = locale === "zh";
  const text = (a: string, b: string) => (zh ? a : b);
  const [name, setName] = useState(profile?.name ?? "");
  const [phone, setPhone] = useState(profile?.phone ?? "");
  const [gender, setGender] = useState(profile?.gender ?? "");
  const [documentType, setDocumentType] = useState(profile?.document_type ?? "");
  const [documentNo, setDocumentNo] = useState("");
  const [notes, setNotes] = useState(profile?.notes ?? "");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    if (name.trim().length < 2) {
      setError(
        text("姓名 / 企业名称至少需要 2 个字符。", "Le nom doit comporter au moins 2 caractères."),
      );
      return;
    }
    setSaving(true);
    setError("");
    const input: CustomerFormInput = {
      name: name.trim(),
      phone: phone.trim() || null,
      gender: gender || null,
      document_type: documentType || null,
      notes: notes || null,
    };
    // Blank means unchanged on edit. Risk flags and business relationships are never submitted.
    if (documentNo.trim()) input.document_no_plain = documentNo.trim();
    try {
      const result = profile
        ? await updateCustomer(profile.id, input)
        : await createCustomer(input);
      if (!result.success || !result.data)
        throw new Error(result.error || text("保存失败，请重试。", "Échec de l'enregistrement."));
      onSaved(result.data.id, !profile);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : text("保存失败，请重试。", "Échec de l'enregistrement."),
      );
      setSaving(false);
    }
  }
  return (
    <RightDrawer
      open
      onClose={() => {
        if (!saving) onClose();
      }}
      title={
        profile
          ? text("编辑客户资料", "Modifier les coordonnées")
          : text("新建客户档案", "Nouveau dossier client")
      }
      subtitle={text(
        "只修改此档案资料；不会改写合同、收款或业务身份。",
        "Coordonnées uniquement : contrats, paiements et rôles métier restent inchangés.",
      )}
      width="wide"
    >
      <form onSubmit={save} className={styles.form}>
        <label>
          {text("姓名 / 企业名称", "Nom / entreprise")}
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            minLength={2}
            disabled={saving}
          />
        </label>
        <label>
          {text("联系电话", "Téléphone")}
          <input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            disabled={saving}
          />
        </label>
        <label>
          {text("性别（如适用）", "Genre (si applicable)")}
          <select value={gender} onChange={(e) => setGender(e.target.value)} disabled={saving}>
            <option value="">{text("未登记", "Non renseigné")}</option>
            <option value="male">{text("男", "Homme")}</option>
            <option value="female">{text("女", "Femme")}</option>
            <option value="other">{text("其他", "Autre")}</option>
            {gender && !["male", "female", "other"].includes(gender) && (
              <option value={gender}>{gender}</option>
            )}
          </select>
        </label>
        <label>
          {text("证件类型", "Type de pièce")}
          <select
            value={documentType}
            onChange={(e) => setDocumentType(e.target.value)}
            disabled={saving}
          >
            <option value="">{text("未登记", "Non renseigné")}</option>
            <option value="id_card">{text("身份证", "Carte d'identité")}</option>
            <option value="passport">{text("护照", "Passeport")}</option>
            <option value="drivers_license">{text("驾照", "Permis")}</option>
            {documentType && !["id_card", "passport", "drivers_license"].includes(documentType) && (
              <option value={documentType}>{documentType}</option>
            )}
          </select>
        </label>
        <label>
          {text("证件号码", "Numéro de pièce")}
          <input
            value={documentNo}
            onChange={(e) => setDocumentNo(e.target.value)}
            autoComplete="off"
            disabled={saving}
          />
          <span className={styles.hint}>
            {profile
              ? text("留空保留原证件号码。", "Laissez vide pour conserver le numéro existant.")
              : text("无明确资料时可以留空。", "Laissez vide sans justificatif confirmé.")}
          </span>
        </label>
        <label>
          {text("备注 / 资料依据", "Remarques / justificatifs")}
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} disabled={saving} />
        </label>
        {!profile && (
          <p className={styles.callout}>
            {text(
              "新档案不会自动认定为承租人、买方或住客，也不会按姓名自动合并。请在明确业务中建立关联。",
              "Aucun rôle ni rapprochement par nom n'est créé automatiquement ; associez ce client à une opération explicite.",
            )}
          </p>
        )}
        {error && (
          <p role="alert" className={styles.error}>
            {error}
          </p>
        )}
        <div className={styles.formActions}>
          <button type="button" className={styles.secondary} onClick={onClose} disabled={saving}>
            {text("取消", "Annuler")}
          </button>
          <button type="submit" className={styles.primary} disabled={saving}>
            {saving ? text("正在保存…", "Enregistrement…") : text("保存资料", "Enregistrer")}
          </button>
        </div>
      </form>
    </RightDrawer>
  );
}
