"use client";

import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { CurrencyCode } from "@/types/domain";
import type { AssetOperationAsset, AssetOperationKind } from "./asset-operations-model";
import { importAssetOperationEntries, updateAssetOperationTerms } from "./asset-operations-actions";
import {
  parseAssetEntryImport,
  summarizeAssetEntryImport,
  type AssetEntryImportManifest,
} from "./asset-operations-intake-model";
import styles from "./asset-operations-workspace.module.css";

function kindLabel(kind: AssetOperationKind, zh: boolean) {
  const labels = {
    income: ["经营收入", "Recette d’exploitation"],
    expense: ["经营成本", "Coût d’exploitation"],
    deposit_in: ["押金收取", "Dépôt reçu"],
    deposit_out: ["押金退还", "Dépôt remboursé"],
  };
  return labels[kind][zh ? 0 : 1];
}

export function AssetFinanceImport({
  projectId,
  zh,
  assets,
}: {
  projectId: string;
  zh: boolean;
  assets: AssetOperationAsset[];
}) {
  const router = useRouter();
  const [sourceText, setSourceText] = useState("");
  const [manifest, setManifest] = useState<AssetEntryImportManifest | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const request = useRef<{ key: string; id: string } | null>(null);
  const guard = useRef(false);
  const fileRead = useRef(0);
  function findAsset(row: { assetId?: string; assetSourceKey?: string }) {
    const byId = row.assetId ? assets.find((asset) => asset.id === row.assetId) : undefined;
    const bySource = row.assetSourceKey
      ? assets.find((asset) => asset.sourceKey === row.assetSourceKey)
      : undefined;
    if (
      (row.assetId && !byId) ||
      (row.assetSourceKey && !bySource) ||
      (byId && bySource && byId.id !== bySource.id)
    )
      return undefined;
    return byId ?? bySource;
  }
  function assetLabel(row: { assetId?: string; assetSourceKey?: string }) {
    const asset = findAsset(row);
    return asset ? `${asset.code} · ${asset.name}` : (row.assetSourceKey ?? row.assetId ?? "—");
  }
  function changeText(value: string) {
    setSourceText(value);
    setManifest(null);
    setError("");
    setSaved("");
  }
  async function readFile(file: File | undefined) {
    const version = ++fileRead.current;
    if (!file) return;
    if (file.size > 500_000) {
      setError(
        zh
          ? "请使用不超过500KB的JSON，每批收付与参考月租各最多100项。"
          : "Utilisez un JSON de 500 Ko maximum : 100 écritures et 100 références de loyer au plus.",
      );
      return;
    }
    try {
      const value = await file.text();
      if (fileRead.current === version) changeText(value);
    } catch {
      setError(zh ? "文件读取失败。" : "Lecture du fichier impossible.");
    }
  }
  function preview() {
    setError("");
    setSaved("");
    setManifest(null);
    try {
      if (new TextEncoder().encode(sourceText).byteLength > 500_000)
        throw new Error("FileTooLarge");
      const parsed = parseAssetEntryImport(JSON.parse(sourceText), projectId);
      if ([...parsed.entries, ...parsed.terms].some((row) => !findAsset(row)))
        throw new Error("UnknownAsset");
      setManifest(parsed);
    } catch {
      setError(
        zh
          ? "来源格式未通过检查。收付与参考月租各最多100项；收付须有资产、确切日期、原币金额及来源，月租须有当前版本及依据；不能包含现有付款关联。"
          : "Format invalide : 100 écritures et 100 loyers au plus ; flux sourcés avec actif, date et montant explicites ; références de loyer avec version et justificatif, sans lien de paiement existant.",
      );
    }
  }
  async function submit() {
    if (!manifest || guard.current) return;
    const key = JSON.stringify(manifest);
    if (request.current?.key !== key)
      request.current = { key, id: manifest.requestId ?? crypto.randomUUID() };
    guard.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await importAssetOperationEntries({
        ...manifest,
        requestId: request.current.id,
      });
      if (!result.ok)
        setError(
          zh
            ? "本批未接入。请核对资产、来源重复和版本；结果未知时保持同一清单重试。"
            : "Lot non intégré. Vérifiez les actifs, doublons et versions ; réessayez avec le même lot si le résultat est inconnu.",
        );
      else {
        setSaved(
          zh
            ? `新增${result.importedCount ?? manifest.entries.length}笔待核来源，保留${result.matchedCount ?? 0}笔已有来源，更新${result.updatedTermsCount ?? manifest.terms.length}项参考月租。来源收付仍需逐笔核实。`
            : `${result.importedCount ?? manifest.entries.length} nouvelles écritures à vérifier ; ${result.matchedCount ?? 0} sources existantes conservées ; ${result.updatedTermsCount ?? manifest.terms.length} loyers indicatifs mis à jour.`,
        );
        setManifest(null);
        setSourceText("");
        request.current = null;
        router.refresh();
      }
    } catch {
      setError(
        zh
          ? "接入结果未确认，请保持同一清单重试。"
          : "Résultat non confirmé. Réessayez avec le même lot.",
      );
    } finally {
      guard.current = false;
      setBusy(false);
    }
  }
  const summary = manifest ? summarizeAssetEntryImport(manifest) : null;
  return (
    <details className={styles.entryDetails}>
      <summary>
        {zh ? "接入财务来源（待核）" : "Intégrer des sources financières à vérifier"}
      </summary>
      <p>
        {zh
          ? "收付来源须有明确资产、日期和原币金额，强制待核、暂不分摊，不计入已核实金额。参考月租独立预览，只更新标准，不生成收入。"
          : "Les flux exigent un actif, une date et un montant explicites ; ils restent à vérifier, sans répartition ni montant confirmé. Les loyers indicatifs sont prévisualisés séparément et ne génèrent aucune recette."}
      </p>
      <label className={styles.upload}>
        {zh ? "选择来源JSON文件" : "Choisir le JSON source"}
        <input
          type="file"
          accept=".json,application/json"
          disabled={busy}
          onChange={(event) => {
            void readFile(event.target.files?.[0]);
          }}
        />
      </label>
      <label className={styles.upload}>
        {zh ? "或粘贴已整理的JSON" : "Ou coller le JSON préparé"}
        <textarea
          value={sourceText}
          disabled={busy}
          rows={5}
          maxLength={500000}
          onChange={(event) => {
            ++fileRead.current;
            changeText(event.target.value);
          }}
        />
      </label>
      <button type="button" disabled={busy || !sourceText.trim()} onClick={preview}>
        {zh ? "预览来源" : "Prévisualiser"}
      </button>
      {manifest && summary ? (
        <div className={styles.importPreview}>
          <p>
            {zh ? "待接入收付来源" : "Flux à intégrer"} {manifest.entries.length} ·{" "}
            {zh ? "参考月租更新" : "Loyers indicatifs"} {summary.termCount}
          </p>
          {summary.start ? (
            <p>
              {zh ? "收付日期范围" : "Dates des flux"} {summary.start} — {summary.end}
            </p>
          ) : null}
          {summary.totals.length ? (
            <div className={styles.tableWrap}>
              <table>
                <thead>
                  <tr>
                    <th>{zh ? "原币" : "Devise"}</th>
                    <th>{zh ? "类别" : "Nature"}</th>
                    <th>{zh ? "笔数" : "Nombre"}</th>
                    <th>{zh ? "来源金额（待核）" : "Montant source à vérifier"}</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.totals.map((row) => (
                    <tr key={`${row.currency}:${row.kind}`}>
                      <td>{row.currency}</td>
                      <td>{kindLabel(row.kind, zh)}</td>
                      <td>{row.count}</td>
                      <td>
                        {new Intl.NumberFormat(zh ? "zh-CN" : "fr-FR", {
                          maximumFractionDigits: 2,
                        }).format(row.amount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          {manifest.terms.length ? (
            <div>
              <p>
                {zh
                  ? "参考月租（仅标准，不计入收付合计）"
                  : "Loyers indicatifs, hors totaux des flux"}
              </p>
              {manifest.terms.slice(0, 5).map((term) => (
                <p key={term.assetSourceKey ?? term.assetId} className={styles.cellSub}>
                  {assetLabel(term)} ·{" "}
                  {term.monthlyRentNative === null
                    ? zh
                      ? "待核"
                      : "À vérifier"
                    : `${new Intl.NumberFormat(zh ? "zh-CN" : "fr-FR", { maximumFractionDigits: 2 }).format(term.monthlyRentNative)} ${term.rentCurrency}`}
                </p>
              ))}
            </div>
          ) : null}
          <p className={styles.cellSub} title={manifest.sourceFingerprint}>
            {zh ? "来源指纹" : "Empreinte"} {manifest.sourceFingerprint.slice(0, 12)}…
          </p>
          <p className={styles.cellSub}>
            {manifest.entries
              .slice(0, 5)
              .map((entry) => `${assetLabel(entry)} · ${entry.cashDate}`)
              .join(" / ")}
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              void submit();
            }}
          >
            {busy
              ? "…"
              : zh
                ? "确认更新参考月租并接入待核收付"
                : "Mettre à jour les références et intégrer les flux à vérifier"}
          </button>
        </div>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
      {saved ? <p role="status">{saved}</p> : null}
    </details>
  );
}

export function AssetTermsEditor({ asset, zh }: { asset: AssetOperationAsset; zh: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const request = useRef<{ key: string; id: string } | null>(null);
  const guard = useRef(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (guard.current) return;
    const fields = new FormData(event.currentTarget);
    const raw = String(fields.get("monthlyRent") ?? "").trim();
    const input = {
      assetId: asset.id,
      expectedUpdatedAt: asset.updatedAt,
      monthlyRentNative: raw ? Number(raw) : null,
      rentCurrency: raw ? (String(fields.get("currency")) as CurrencyCode) : null,
      reason: String(fields.get("reason") ?? "").trim(),
    };
    if (
      !input.reason ||
      (input.monthlyRentNative !== null &&
        (!Number.isFinite(input.monthlyRentNative) || input.monthlyRentNative <= 0))
    )
      return;
    const key = JSON.stringify(input);
    if (request.current?.key !== key) request.current = { key, id: crypto.randomUUID() };
    guard.current = true;
    setBusy(true);
    setError("");
    setSaved(false);
    try {
      const result = await updateAssetOperationTerms({ ...input, requestId: request.current.id });
      if (!result.ok)
        setError(
          zh
            ? "未保存，请刷新核对资产版本和依据。"
            : "Non enregistré. Actualisez et vérifiez la version et le justificatif.",
        );
      else {
        request.current = null;
        setSaved(true);
        router.refresh();
      }
    } catch {
      setError(
        zh
          ? "保存结果未知，请保持同一内容重试。"
          : "Résultat inconnu. Réessayez sans modifier le contenu.",
      );
    } finally {
      guard.current = false;
      setBusy(false);
    }
  }
  return (
    <details className={styles.verify}>
      <summary>{zh ? "维护参考月租" : "Modifier le loyer indicatif"}</summary>
      <form key={asset.updatedAt} onSubmit={submit}>
        <label>
          {zh ? "月租（原币元，留空为待核）" : "Loyer mensuel (vide si à vérifier)"}
          <input
            type="number"
            name="monthlyRent"
            min="0.01"
            step="0.01"
            defaultValue={asset.monthlyRentNative ?? ""}
            disabled={busy}
          />
        </label>
        <label>
          {zh ? "原币" : "Devise"}
          <select name="currency" defaultValue={asset.rentCurrency ?? "XOF"} disabled={busy}>
            {["XOF", "CNY", "USD"].map((currency) => (
              <option key={currency}>{currency}</option>
            ))}
          </select>
        </label>
        <label>
          {zh ? "修改依据（必填）" : "Justificatif (obligatoire)"}
          <input name="reason" required maxLength={500} disabled={busy} />
        </label>
        <p className={styles.cellSub}>
          {zh
            ? "只维护参考标准，不生成应收或实收；组合计租须先核清范围。"
            : "Référence uniquement, sans créance ni encaissement. Vérifiez le périmètre des loyers groupés."}
        </p>
        <button type="submit" disabled={busy}>
          {busy ? "…" : zh ? "保存参考月租" : "Enregistrer la référence"}
        </button>
        {error ? <p role="alert">{error}</p> : null}
        {saved ? (
          <p role="status">{zh ? "参考月租已保存。" : "Loyer indicatif enregistré."}</p>
        ) : null}
      </form>
    </details>
  );
}
