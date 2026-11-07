"use client";

import { useMemo, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ArrowDownToLine, CircleCheck, Plus } from "lucide-react";
import {
  assetOperationsCsv,
  assetReportPeriod,
  buildAssetOperationsReport,
  type AssetOperationAsset,
  type AssetOperationKind,
  type AssetOperationCategory,
  type AssetOperationsData,
  type AssetReportPeriod,
} from "./asset-operations-model";
import {
  confirmAssetOperationAsset,
  confirmAssetOperationEntry,
  createAssetOperationEntry,
  importAssetOperationCatalog,
  voidAssetOperationEntry,
  type AssetOperationCatalogRow,
} from "./asset-operations-actions";
import type { AssetOperationEntry } from "./asset-operations-model";
import type { CurrencyCode } from "@/types/domain";
import styles from "./asset-operations-workspace.module.css";

type Locale = "zh" | "fr";

function groupLabel(group: string, zh: boolean) {
  return group === "old_warehouse"
    ? zh
      ? "老仓库"
      : "Anciens entrepôts"
    : group === "new_warehouse"
      ? zh
        ? "新仓库"
        : "Nouveaux entrepôts"
      : group;
}

function kindLabel(kind: AssetOperationKind, zh: boolean) {
  const labels = {
    income: ["经营收入", "Recette d’exploitation"],
    expense: ["经营成本", "Coût d’exploitation"],
    deposit_in: ["押金收取", "Dépôt reçu"],
    deposit_out: ["押金退还", "Dépôt remboursé"],
  };
  return labels[kind][zh ? 0 : 1];
}

const categoryLabels: Record<AssetOperationCategory, [string, string]> = {
  rent: ["租金", "Loyer"],
  property_fee: ["物业费", "Charges immobilières"],
  maintenance: ["维修", "Entretien"],
  utilities: ["水电", "Eau et électricité"],
  cleaning: ["保洁", "Nettoyage"],
  security: ["安保", "Sécurité"],
  payroll: ["人工工资", "Salaires"],
  tax: ["税费", "Taxes"],
  commission: ["佣金", "Commission"],
  insurance: ["保险", "Assurance"],
  other: ["其他", "Autres"],
  deposit: ["押金", "Dépôt"],
};

function categoryLabel(category: AssetOperationCategory | undefined, zh: boolean) {
  return (categoryLabels[category ?? "other"] ?? categoryLabels.other)[zh ? 0 : 1];
}

function money(value: number, currency: CurrencyCode, locale: Locale) {
  return `${new Intl.NumberFormat(locale === "zh" ? "zh-CN" : "fr-FR", {
    maximumFractionDigits: 2,
  }).format(value)} ${currency}`;
}

function downloadReport(filename: string, headers: string[], rows: (string | number | null)[][]) {
  const url = URL.createObjectURL(
    new Blob([assetOperationsCsv(headers, rows)], { type: "text/csv;charset=utf-8" }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function CatalogImport({ projectId, zh }: { projectId: string; zh: boolean }) {
  const router = useRouter();
  const [manifest, setManifest] = useState<{
    sourceFingerprint: string;
    assets: AssetOperationCatalogRow[];
  } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const requestId = useRef<string | null>(null);
  async function chooseFile(file: File | undefined) {
    setError("");
    setManifest(null);
    requestId.current = null;
    if (!file) return;
    try {
      if (file.size > 2_000_000) throw new Error("FileTooLarge");
      const parsed: unknown = JSON.parse(await file.text());
      if (!parsed || typeof parsed !== "object") throw new Error("InvalidManifest");
      const value = parsed as Record<string, unknown>;
      if (
        value.projectId !== projectId ||
        typeof value.sourceFingerprint !== "string" ||
        !/^[a-f0-9]{64}$/i.test(value.sourceFingerprint) ||
        !Array.isArray(value.assets) ||
        !value.assets.length ||
        value.assets.length > 1000
      )
        throw new Error("InvalidManifest");
      const assets = value.assets.map((row: unknown): AssetOperationCatalogRow => {
        if (!row || typeof row !== "object") throw new Error("InvalidAsset");
        const item = row as Record<string, unknown>;
        if (
          !["sourceKey", "code", "name", "group"].every(
            (key) => typeof item[key] === "string" && String(item[key]).trim(),
          ) ||
          !Array.isArray(item.sourceRefs) ||
          !item.sourceRefs.length ||
          item.sourceRefs.some((ref) => typeof ref !== "string")
        )
          throw new Error("InvalidAsset");
        return {
          sourceKey: String(item.sourceKey),
          code: String(item.code),
          name: String(item.name),
          group: String(item.group),
          sourceRefs: item.sourceRefs as string[],
          unitId: typeof item.unitId === "string" ? item.unitId : null,
          monthlyRentNative:
            typeof item.monthlyRentNative === "number" ? item.monthlyRentNative : null,
          rentCurrency: ["XOF", "CNY", "USD"].includes(String(item.rentCurrency))
            ? (item.rentCurrency as CurrencyCode)
            : null,
        };
      });
      setManifest({ sourceFingerprint: value.sourceFingerprint.toLowerCase(), assets });
    } catch {
      setError(
        zh
          ? "无法读取此清单。请选择当前项目已整理的资产JSON文件（不超过2MB）。"
          : "Inventaire illisible. Choisissez le fichier JSON préparé pour ce projet (2 Mo maximum).",
      );
    }
  }
  async function submit() {
    if (!manifest || busy) return;
    requestId.current ??= crypto.randomUUID();
    setBusy(true);
    setError("");
    try {
      const result = await importAssetOperationCatalog({
        ...manifest,
        projectId,
        requestId: requestId.current,
      });
      if (!result.ok)
        setError(
          zh
            ? "未导入。请核对来源版本、重复资产和项目权限。"
            : "Import non effectué. Vérifiez la version source, les doublons et les droits du projet.",
        );
      else {
        setManifest(null);
        requestId.current = null;
        router.refresh();
      }
    } catch {
      setError(
        zh
          ? "导入结果未确认，请使用同一清单重试。"
          : "Résultat non confirmé. Réessayez avec le même inventaire.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className={styles.entryDetails}>
      <summary>{zh ? "接入已整理的资产清单" : "Intégrer l’inventaire préparé"}</summary>
      <p>
        {zh
          ? "仅接入待核资产档案，不生成合同、应收或收付款。相同来源指纹用于防止重复导入。"
          : "Ajoute uniquement des fiches à vérifier, sans contrat, créance ni paiement. L’empreinte de source évite les doublons."}
      </p>
      <label className={styles.upload}>
        {zh ? "选择资产清单" : "Choisir l’inventaire"}
        <input
          type="file"
          accept=".json,application/json"
          disabled={busy}
          onChange={(event) => {
            void chooseFile(event.target.files?.[0]);
          }}
        />
      </label>
      {manifest ? (
        <div className={styles.importPreview}>
          <p>
            {zh ? "待接入资产" : "Actifs à intégrer"} {manifest.assets.length}
          </p>
          <p className={styles.source}>
            {zh ? "来源指纹" : "Empreinte"} {manifest.sourceFingerprint}
          </p>
          <p>
            {manifest.assets
              .slice(0, 5)
              .map((item) => `${item.code} ${item.name}`)
              .join(" · ")}
            {manifest.assets.length > 5 ? " …" : ""}
          </p>
          <button
            type="button"
            onClick={() => {
              void submit();
            }}
            disabled={busy}
          >
            {busy ? "…" : zh ? "导入为待核档案" : "Importer comme fiches à vérifier"}
          </button>
        </div>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
    </details>
  );
}

function EntryVerification({
  entry,
  zh,
  operation = "confirm",
}: {
  entry: AssetOperationEntry;
  zh: boolean;
  operation?: "confirm" | "void";
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const request = useRef<{ key: string; id: string } | null>(null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !entry.updatedAt) return;
    const reason = String(new FormData(event.currentTarget).get("reason") ?? "").trim();
    if (!reason) return;
    const key = `${entry.id}:${entry.updatedAt}:${reason}`;
    if (request.current?.key !== key) request.current = { key, id: crypto.randomUUID() };
    setBusy(true);
    setError("");
    try {
      const result = await (
        operation === "void" ? voidAssetOperationEntry : confirmAssetOperationEntry
      )({
        requestId: request.current.id,
        entryId: entry.id,
        expectedUpdatedAt: entry.updatedAt,
        reason,
      });
      if (result.ok) router.refresh();
      else
        setError(
          zh
            ? "未确认。请刷新并核对资产、凭证和记录版本。"
            : "Non confirmé. Actualisez puis vérifiez l’actif, la pièce et la version.",
        );
    } catch {
      setError(
        zh
          ? "确认结果未知，请保持内容重试。"
          : "Résultat inconnu. Réessayez sans modifier le contenu.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className={styles.verify}>
      <summary>
        {operation === "void"
          ? zh
            ? "作废此记录"
            : "Annuler cette écriture"
          : zh
            ? "核实此记录"
            : "Vérifier l’écriture"}
      </summary>
      <form onSubmit={submit}>
        <label>
          {operation === "void"
            ? zh
              ? "作废原因"
              : "Motif d’annulation"
            : zh
              ? "核实依据"
              : "Justificatif"}
          <input name="reason" required maxLength={500} disabled={busy} />
        </label>
        <button type="submit" disabled={busy}>
          {busy
            ? "…"
            : operation === "void"
              ? zh
                ? "确认作废并保留历史"
                : "Annuler en conservant l’historique"
              : zh
                ? "确认记录"
                : "Confirmer"}
        </button>
        {error ? <p role="alert">{error}</p> : null}
      </form>
    </details>
  );
}

function AssetVerification({ asset, zh }: { asset: AssetOperationAsset; zh: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const request = useRef<{ key: string; id: string } | null>(null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const reason = String(new FormData(event.currentTarget).get("reason") ?? "").trim();
    if (!reason) return;
    const key = `${asset.id}:${asset.updatedAt}:${reason}`;
    if (request.current?.key !== key) request.current = { key, id: crypto.randomUUID() };
    setBusy(true);
    setError("");
    try {
      const result = await confirmAssetOperationAsset({
        assetId: asset.id,
        expectedUpdatedAt: asset.updatedAt,
        requestId: request.current.id,
        reason,
      });
      if (result.ok) router.refresh();
      else
        setError(
          zh
            ? "未保存。请核对权限与资料，刷新后重试。"
            : "Non enregistré. Vérifiez les droits et les données, puis actualisez.",
        );
    } catch {
      setError(
        zh
          ? "保存结果未确认，请使用相同内容重试。"
          : "Résultat non confirmé. Réessayez avec les mêmes informations.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className={styles.verify}>
      <summary>{zh ? "核实此资产" : "Vérifier cet actif"}</summary>
      <form onSubmit={submit}>
        <label>
          {zh ? "核实依据" : "Justificatif de vérification"}
          <input
            name="reason"
            required
            maxLength={500}
            disabled={busy}
            placeholder={zh ? "已核对的合同、产权或现场记录" : "Contrat, titre ou constat vérifié"}
          />
        </label>
        <button type="submit" disabled={busy}>
          <CircleCheck size={14} aria-hidden="true" />
          {busy ? "…" : zh ? "确认资产身份" : "Confirmer l’identité"}
        </button>
        {error ? <p role="alert">{error}</p> : null}
      </form>
    </details>
  );
}

function EntryForm({
  assets,
  zh,
  today,
}: {
  assets: AssetOperationAsset[];
  zh: boolean;
  today: string;
}) {
  const router = useRouter();
  const [assetId, setAssetId] = useState(assets[0]?.id ?? "");
  const [currency, setCurrency] = useState<CurrencyCode>("XOF");
  const [entryKind, setEntryKind] = useState<AssetOperationKind>("expense");
  const [entryCategory, setEntryCategory] = useState<AssetOperationCategory>("other");
  const [recognitionMethod, setRecognitionMethod] = useState<"unallocated" | "daily">(
    "unallocated",
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const request = useRef<{ key: string; id: string } | null>(null);
  const guard = useRef(false);
  const asset = assets.find((item) => item.id === assetId);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (guard.current || !asset) return;
    const form = event.currentTarget;
    const values = new FormData(form);
    const optional = (key: string) => String(values.get(key) ?? "").trim() || null;
    const input = {
      assetId: asset.id,
      expectedUpdatedAt: asset.updatedAt,
      kind: entryKind,
      category: entryCategory,
      amountNative: Number(values.get("amount")),
      currency,
      cashDate: optional("cashDate"),
      periodStart: optional("periodStart"),
      periodEnd: optional("periodEnd"),
      recognitionMethod,
      verification: String(values.get("verification")) as "pending" | "verified",
      sourceRef: String(values.get("sourceRef") ?? "").trim(),
      description: String(values.get("description") ?? "").trim(),
    };
    if (!input.cashDate && !(input.periodStart && input.periodEnd)) {
      setError(
        zh
          ? "请填写实际收付日，或完整的费用／收入归属期间。"
          : "Indiquez la date de paiement ou la période complète de rattachement.",
      );
      return;
    }
    const key = JSON.stringify(input);
    if (request.current?.key !== key) request.current = { key, id: crypto.randomUUID() };
    guard.current = true;
    setBusy(true);
    setError("");
    setSaved(false);
    try {
      const result = await createAssetOperationEntry({ ...input, requestId: request.current.id });
      if (!result.ok) {
        setError(
          zh
            ? "未保存。请核对资产版本、权限、币种精度和凭证来源。"
            : "Non enregistré. Vérifiez la version de l’actif, les droits, la précision et le justificatif.",
        );
      } else {
        request.current = null;
        form.reset();
        setEntryKind("expense");
        setEntryCategory("other");
        setRecognitionMethod("unallocated");
        setSaved(true);
        router.refresh();
      }
    } catch {
      setError(
        zh
          ? "保存结果未确认，请保持内容不变并重试。"
          : "Résultat non confirmé. Réessayez sans modifier les informations.",
      );
    } finally {
      guard.current = false;
      setBusy(false);
    }
  }
  return (
    <details className={styles.entryDetails}>
      <summary>
        <Plus size={16} aria-hidden="true" />
        {zh ? "登记成本或收入" : "Inscrire un coût ou une recette"}
      </summary>
      <p>
        {zh
          ? "按原币登记。收付日与归属期间分别填写；待核记录保留来源，核实后才进入确认金额。"
          : "Conservez la devise d’origine. Distinguez paiement et période ; les écritures à vérifier restent hors des montants confirmés."}
      </p>
      <form className={styles.entryForm} onSubmit={submit}>
        <label>
          {zh ? "资产" : "Actif"}
          <select
            value={assetId}
            onChange={(event) => setAssetId(event.target.value)}
            disabled={busy}
            required
          >
            {assets.map((item) => (
              <option key={item.id} value={item.id}>
                {groupLabel(item.group, zh)} · {item.code} · {item.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          {zh ? "类别" : "Nature"}
          <select
            name="kind"
            value={entryKind}
            disabled={busy}
            onChange={(event) => {
              const next = event.target.value as AssetOperationKind;
              setEntryKind(next);
              if (next === "deposit_in" || next === "deposit_out") {
                setEntryCategory("deposit");
                setRecognitionMethod("unallocated");
              } else if (entryCategory === "deposit") setEntryCategory("other");
            }}
          >
            {(["expense", "income", "deposit_in", "deposit_out"] as const).map((kind) => (
              <option key={kind} value={kind}>
                {kindLabel(kind, zh)}
              </option>
            ))}
          </select>
        </label>
        <label>
          {zh ? "收支分类" : "Catégorie"}
          <select
            name="category"
            value={entryCategory}
            disabled={busy}
            onChange={(event) => setEntryCategory(event.target.value as AssetOperationCategory)}
          >
            {(Object.keys(categoryLabels) as AssetOperationCategory[])
              .filter((category) =>
                entryKind === "deposit_in" || entryKind === "deposit_out"
                  ? category === "deposit"
                  : category !== "deposit",
              )
              .map((category) => (
                <option key={category} value={category}>
                  {categoryLabel(category, zh)}
                </option>
              ))}
          </select>
        </label>
        <label>
          {zh ? "原币" : "Devise"}
          <select
            value={currency}
            onChange={(event) => setCurrency(event.target.value as CurrencyCode)}
            disabled={busy}
          >
            {["XOF", "CNY", "USD"].map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
        <label>
          {zh ? "金额（原币元）" : "Montant en unités de devise"}
          <input type="number" name="amount" required min={0.01} step={0.01} disabled={busy} />
        </label>
        <label>
          {zh ? "实际收付日（未收付留空）" : "Date du paiement (vide si non payé)"}
          <input type="date" name="cashDate" max={today} disabled={busy} />
        </label>
        <label>
          {zh ? "确认状态" : "Vérification"}
          <select name="verification" defaultValue="pending" disabled={busy}>
            <option value="pending">{zh ? "待核实" : "À vérifier"}</option>
            <option value="verified" disabled={asset?.verification !== "verified"}>
              {zh ? "已核实" : "Vérifié"}
            </option>
          </select>
        </label>
        <label>
          {zh ? "归属开始日" : "Début de rattachement"}
          <input type="date" name="periodStart" disabled={busy} />
        </label>
        <label>
          {zh ? "归属结束日（含当日）" : "Fin de rattachement (incluse)"}
          <input type="date" name="periodEnd" disabled={busy} />
        </label>
        <label className={styles.wide}>
          {zh ? "期间分摊方式" : "Méthode de répartition"}
          <select
            name="recognitionMethod"
            value={recognitionMethod}
            onChange={(event) =>
              setRecognitionMethod(event.target.value as "unallocated" | "daily")
            }
            disabled={busy || entryKind === "deposit_in" || entryKind === "deposit_out"}
          >
            <option value="unallocated">
              {zh ? "暂不分摊，保留待核" : "Sans répartition, à vérifier"}
            </option>
            <option value="daily">
              {zh
                ? "明确按覆盖期自然日平均分摊（测算）"
                : "Répartition explicite par jour calendaire (estimation)"}
            </option>
          </select>
        </label>
        <label className={styles.wide}>
          {zh ? "凭证或来源（必填）" : "Justificatif ou source (obligatoire)"}
          <input
            name="sourceRef"
            required
            maxLength={500}
            disabled={busy}
            placeholder={
              zh
                ? "文件名、工作表及单元格，或凭证编号"
                : "Fichier, feuille et cellule, ou référence de pièce"
            }
          />
        </label>
        <label className={styles.wide}>
          {zh ? "费用／收入说明" : "Description"}
          <input name="description" required maxLength={1000} disabled={busy} />
        </label>
        <div className={styles.wide}>
          <button type="submit" disabled={busy || !asset}>
            {busy ? "…" : zh ? "保存记录" : "Enregistrer"}
          </button>
        </div>
        {error ? (
          <p role="alert" className={styles.wide}>
            {error}
          </p>
        ) : null}
        {saved ? (
          <p role="status" className={styles.wide}>
            {zh
              ? "已保存，确认金额按记录状态更新。"
              : "Enregistré. Les montants suivent l’état de vérification."}
          </p>
        ) : null}
      </form>
    </details>
  );
}

export function AssetOperationsWorkspace({
  data,
  locale,
  initialPeriod,
  today,
  canImport,
}: {
  data: AssetOperationsData;
  locale: Locale;
  initialPeriod: AssetReportPeriod;
  today: string;
  canImport: boolean;
}) {
  const zh = locale === "zh";
  const text = (chinese: string, french: string) => (zh ? chinese : french);
  const [mode, setMode] = useState(initialPeriod.mode);
  const [anchor, setAnchor] = useState(initialPeriod.anchor);
  const [end, setEnd] = useState(initialPeriod.end);
  const [group, setGroup] = useState("");
  const [verification, setVerification] = useState("");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const filtered = useMemo(
    () =>
      data.assets.filter(
        (asset) =>
          (!group || asset.group === group) &&
          (!verification || asset.verification === verification) &&
          (!search ||
            `${asset.code} ${asset.name}`
              .toLocaleLowerCase()
              .includes(search.toLocaleLowerCase().trim())),
      ),
    [data.assets, group, verification, search],
  );
  const calculation = useMemo(() => {
    try {
      const period = assetReportPeriod(mode, anchor, end);
      const selectedEntries = category
        ? data.entries.filter((entry) => (entry.category ?? "other") === category)
        : data.entries;
      return {
        report: buildAssetOperationsReport(filtered, selectedEntries, period),
        error: false,
      };
    } catch {
      return { report: null, error: true };
    }
  }, [mode, anchor, end, filtered, data.entries, category]);
  const report = calculation.report;
  const assetMap = useMemo(
    () => new Map(data.assets.map((asset) => [asset.id, asset])),
    [data.assets],
  );
  const groups = Array.from(new Set(data.assets.map((asset) => asset.group))).sort();
  function exportReport() {
    if (!report) return;
    const headers = [
      text("记录类型", "Type"),
      text("期间开始", "Début du rapport"),
      text("期间结束", "Fin du rapport"),
      text("资产", "Actif"),
      text("类别", "Nature"),
      text("收支分类", "Catégorie"),
      text("币种", "Devise"),
      text("金额", "Montant"),
      text("实际收付日", "Date de paiement"),
      text("归属开始", "Début de rattachement"),
      text("归属结束", "Fin de rattachement"),
      text("分摊方式", "Méthode de répartition"),
      text("确认状态", "Vérification"),
      text("来源", "Source"),
      text("说明", "Description"),
      text("作废原因", "Motif d’annulation"),
    ];
    const rows: (string | number | null)[][] = [];
    for (const summary of report.currencies) {
      for (const [label, amount] of [
        [
          text("已录经营现金流入", "Encaissements inscrits"),
          summary.cashFactCount ? summary.cashIncome : null,
        ],
        [
          text("已录经营现金流出", "Décaissements inscrits"),
          summary.cashFactCount ? summary.cashExpense : null,
        ],
        [
          text("已录经营现金净额", "Solde de trésorerie inscrit"),
          summary.cashFactCount ? summary.cashNet : null,
        ],
        [
          text("按日分摊收入（测算）", "Recettes réparties par jour (estimation)"),
          summary.serviceFactCount ? summary.periodIncome : null,
        ],
        [
          text("按日分摊成本（测算）", "Coûts répartis par jour (estimation)"),
          summary.serviceFactCount ? summary.periodExpense : null,
        ],
        [
          text("按日分摊差额（测算）", "Solde réparti par jour (estimation)"),
          summary.serviceFactCount ? summary.periodNet : null,
        ],
        [text("本期押金收取", "Dépôts reçus"), summary.cashFactCount ? summary.depositIn : null],
        [
          text("本期押金退还", "Dépôts remboursés"),
          summary.cashFactCount ? summary.depositOut : null,
        ],
      ] as const)
        rows.push([
          "summary",
          report.period.start,
          report.period.end,
          "",
          label,
          "",
          summary.currency,
          amount,
          "",
          "",
          "",
          "",
          text("资料完整性未确认", "Exhaustivité non confirmée"),
          "",
          "",
          "",
        ]);
    }
    for (const entry of report.entries)
      rows.push([
        "entry",
        report.period.start,
        report.period.end,
        assetMap.get(entry.assetId)?.code ?? entry.assetId,
        kindLabel(entry.kind, zh),
        categoryLabel(entry.category, zh),
        entry.currency,
        entry.amountNative,
        entry.cashDate,
        entry.periodStart,
        entry.periodEnd,
        entry.recognitionMethod === "daily"
          ? text("按日分摊（测算）", "Par jour (estimation)")
          : text("暂不分摊", "Non réparti"),
        entry.voidedAt
          ? text("已作废", "Annulé")
          : entry.verification === "verified" &&
              assetMap.get(entry.assetId)?.verification === "verified"
            ? text("已核实", "Vérifié")
            : text("待核实", "À vérifier"),
        entry.sourceRef,
        entry.description,
        entry.voidReason ?? "",
      ]);
    if (!rows.length)
      rows.push([
        "coverage",
        report.period.start,
        report.period.end,
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        text("无已录记录", "Aucune écriture inscrite"),
        "",
        text("不代表无收支或无欠款", "Ne prouve pas l’absence de flux ou de dette"),
        "",
      ]);
    downloadReport(`SACSI_${mode}_${report.period.start}_${report.period.end}.csv`, headers, rows);
  }
  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>{text("SACSI / 仓库试点", "SACSI / ENTREPÔTS PILOTES")}</p>
          <h1>{text("资产经营台", "Exploitation des actifs")}</h1>
          <p>
            {text(
              "核清资产，记录成本与收入，按周或按月查看经营情况。",
              "Vérifier les actifs, inscrire les coûts et recettes, puis consulter les semaines ou les mois.",
            )}
          </p>
        </div>
        <button onClick={exportReport} disabled={!report}>
          <ArrowDownToLine size={16} aria-hidden="true" />
          {text("导出当前报表", "Exporter le rapport")}
        </button>
      </header>
      <section
        className={styles.filters}
        aria-label={text("资产与期间筛选", "Filtres des actifs et de la période")}
      >
        <label>
          {text("报表期间", "Périodicité")}
          <select
            value={mode}
            onChange={(event) => {
              const next = event.target.value as AssetReportPeriod["mode"];
              setAnchor(
                next === "month"
                  ? anchor.slice(0, 7)
                  : anchor.length === 7
                    ? `${anchor}-01`
                    : anchor,
              );
              setMode(next);
            }}
          >
            <option value="week">{text("周报（周一至周日）", "Semaine (lundi–dimanche)")}</option>
            <option value="month">{text("月报", "Mois")}</option>
            <option value="custom">{text("自定义", "Personnalisée")}</option>
          </select>
        </label>
        <label>
          {mode === "month" ? text("月份", "Mois") : text("日期／开始日", "Date / début")}
          <input
            type={mode === "month" ? "month" : "date"}
            value={anchor}
            onChange={(event) => setAnchor(event.target.value)}
          />
        </label>
        {mode === "custom" ? (
          <label>
            {text("结束日", "Fin")}
            <input
              type="date"
              value={end}
              min={anchor}
              onChange={(event) => setEnd(event.target.value)}
            />
          </label>
        ) : null}
        <label>
          {text("资产组", "Groupe")}
          <select value={group} onChange={(event) => setGroup(event.target.value)}>
            <option value="">{text("全部", "Tous")}</option>
            {groups.map((item) => (
              <option key={item} value={item}>
                {groupLabel(item, zh)}
              </option>
            ))}
          </select>
        </label>
        <label>
          {text("资产核实状态", "État de l’actif")}
          <select value={verification} onChange={(event) => setVerification(event.target.value)}>
            <option value="">{text("全部", "Tous")}</option>
            <option value="pending">{text("待核实", "À vérifier")}</option>
            <option value="verified">{text("已核实", "Vérifié")}</option>
          </select>
        </label>
        <label>
          {text("收支分类", "Catégorie")}
          <select value={category} onChange={(event) => setCategory(event.target.value)}>
            <option value="">{text("全部", "Toutes")}</option>
            {(Object.keys(categoryLabels) as AssetOperationCategory[]).map((item) => (
              <option key={item} value={item}>
                {categoryLabel(item, zh)}
              </option>
            ))}
          </select>
        </label>
        <label>
          {text("资产搜索", "Rechercher un actif")}
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={text("编号或名称", "Code ou nom")}
          />
        </label>
      </section>
      {report ? (
        <p className={styles.period}>
          {report.period.start} — {report.period.end} · {text("所选资产", "Actifs sélectionnés")}{" "}
          {filtered.length}
        </p>
      ) : (
        <p role="alert" className={styles.notice}>
          {text("请选择有效的日期范围。", "Choisissez une période valide.")}
        </p>
      )}
      <aside className={styles.notice}>
        <strong>{text("成本资料完整性未确认", "Exhaustivité des coûts non confirmée")}</strong>
        <p>
          {text(
            "金额仅覆盖已核实且有来源的记录。只有明确选择按日分摊的记录才进入期间测算；已录差额不代表完整利润。押金单列，不计入经营收入。",
            "Les montants couvrent les écritures vérifiées et sourcées. Seule une répartition par jour explicitement choisie alimente l’estimation périodique ; le solde inscrit ne constitue pas un bénéfice complet. Les dépôts sont séparés.",
          )}
        </p>
        {report ? (
          <p>
            {text("待核记录", "Écritures à vérifier")} {report.pendingEntryCount} ·{" "}
            {text("资产待核", "Actifs à vérifier")} {report.pendingAssetCount} ·{" "}
            {text("待分摊记录", "Écritures non réparties")} {report.unallocatedServiceCount} ·{" "}
            {text("日期未定", "Dates manquantes")} {report.undatedEntryCount} ·{" "}
            {text("已作废", "Annulées")} {report.voidedEntryCount} ·{" "}
            {text("未纳入金额", "Écritures exclues")} {report.exclusions.length}
          </p>
        ) : null}
      </aside>
      {report?.currencies.length ? (
        <section
          className={styles.summaries}
          aria-label={text("按原币汇总", "Synthèse par devise")}
        >
          {report.currencies.map((summary) => (
            <article key={summary.currency} className={styles.summary}>
              <h2>{summary.currency}</h2>
              <dl>
                {[
                  [
                    text("已录现金收入", "Encaissements inscrits"),
                    summary.cashFactCount
                      ? money(summary.cashIncome, summary.currency, locale)
                      : "—",
                  ],
                  [
                    text("已录现金支出", "Décaissements inscrits"),
                    summary.cashFactCount
                      ? money(summary.cashExpense, summary.currency, locale)
                      : "—",
                  ],
                  [
                    text("已录现金净额", "Solde de trésorerie inscrit"),
                    summary.cashFactCount ? money(summary.cashNet, summary.currency, locale) : "—",
                  ],
                  [
                    text("按日分摊收入（测算）", "Recettes réparties par jour (estimation)"),
                    summary.serviceFactCount
                      ? money(summary.periodIncome, summary.currency, locale)
                      : "—",
                  ],
                  [
                    text("按日分摊成本（测算）", "Coûts répartis par jour (estimation)"),
                    summary.serviceFactCount
                      ? money(summary.periodExpense, summary.currency, locale)
                      : "—",
                  ],
                  [
                    text("按日分摊差额（测算）", "Solde réparti par jour (estimation)"),
                    summary.serviceFactCount
                      ? money(summary.periodNet, summary.currency, locale)
                      : "—",
                  ],
                  [
                    text("本期押金收／退", "Dépôts reçus / remboursés"),
                    `${money(summary.depositIn, summary.currency, locale)} / ${money(summary.depositOut, summary.currency, locale)}`,
                  ],
                ].map(([label, value]) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
              </dl>
            </article>
          ))}
        </section>
      ) : (
        <p className={styles.empty}>
          {text(
            "所选期间暂无可纳入的已核实收支记录。",
            "Aucune écriture vérifiée à inclure pour cette période.",
          )}
        </p>
      )}
      {canImport ? <CatalogImport projectId={data.projectId} zh={zh} /> : null}
      {data.canWrite && data.assets.length ? (
        <EntryForm assets={data.assets} zh={zh} today={today} />
      ) : null}
      <section className={styles.section}>
        <h2>{text("资产清单与来源", "Inventaire et sources")}</h2>
        {filtered.length ? (
          <div className={styles.tableWrap}>
            <table>
              <thead>
                <tr>
                  <th>{text("资产", "Actif")}</th>
                  <th>{text("资产组", "Groupe")}</th>
                  <th>{text("核对结果", "Rapprochement")}</th>
                  <th>{text("月租标准（测算）", "Loyer mensuel indicatif")}</th>
                  <th>{text("原始来源", "Sources")}</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((asset) => (
                  <tr key={asset.id}>
                    <td>
                      <strong>{asset.code}</strong>
                      <span className={styles.cellSub}>{asset.name}</span>
                    </td>
                    <td>{groupLabel(asset.group, zh)}</td>
                    <td>
                      <span
                        className={
                          asset.verification === "verified" ? styles.verified : styles.pending
                        }
                      >
                        {asset.verification === "verified"
                          ? text("已核实", "Vérifié")
                          : text("待核实", "À vérifier")}
                      </span>
                      <span className={styles.cellSub}>
                        {asset.unitId
                          ? text("已关联系统资产", "Actif système lié")
                          : text("补充资产档案", "Fiche d’actif complémentaire")}
                      </span>
                      {data.canWrite && asset.verification === "pending" ? (
                        <AssetVerification asset={asset} zh={zh} />
                      ) : null}
                    </td>
                    <td>
                      {asset.monthlyRentNative !== null && asset.rentCurrency
                        ? money(asset.monthlyRentNative, asset.rentCurrency, locale)
                        : text("待确认／组合计租", "À confirmer / loyer groupé")}
                    </td>
                    <td className={styles.source}>
                      {asset.sourceRefs.length
                        ? asset.sourceRefs.map((source) => <span key={source}>{source}</span>)
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className={styles.empty}>
            {data.assets.length
              ? text("没有符合筛选条件的资产。", "Aucun actif ne correspond aux filtres.")
              : text(
                  "资产来源尚未接入。完成核对后，将在这里显示清单和待核事项。",
                  "Les sources ne sont pas encore intégrées. L’inventaire et les points à vérifier apparaîtront après rapprochement.",
                )}
          </p>
        )}
      </section>
      <section className={styles.section}>
        <h2>{text("本期收支与归属明细", "Écritures et rattachements de la période")}</h2>
        {report?.entries.length ? (
          <div className={styles.tableWrap}>
            <table>
              <thead>
                <tr>
                  <th>{text("资产 / 类别", "Actif / nature")}</th>
                  <th>{text("原币金额", "Montant d’origine")}</th>
                  <th>{text("实际收付日", "Paiement")}</th>
                  <th>{text("归属期间", "Rattachement")}</th>
                  <th>{text("状态 / 来源", "État / source")}</th>
                </tr>
              </thead>
              <tbody>
                {report.entries.map((entry) => (
                  <tr key={entry.id}>
                    <td>
                      <strong>{assetMap.get(entry.assetId)?.code}</strong>
                      <span className={styles.cellSub}>{kindLabel(entry.kind, zh)}</span>
                      <span className={styles.cellSub}>{categoryLabel(entry.category, zh)}</span>
                      <span className={styles.cellSub}>{entry.description}</span>
                    </td>
                    <td className={styles.number}>
                      {money(entry.amountNative, entry.currency, locale)}
                    </td>
                    <td>{entry.cashDate ?? "—"}</td>
                    <td>
                      {entry.periodStart
                        ? `${entry.periodStart} — ${entry.periodEnd}`
                        : text("未确认", "Non confirmé")}
                    </td>
                    <td>
                      <span
                        className={
                          entry.voidedAt
                            ? styles.voided
                            : entry.verification === "verified" &&
                                assetMap.get(entry.assetId)?.verification === "verified"
                              ? styles.verified
                              : styles.pending
                        }
                      >
                        {entry.voidedAt
                          ? text("已作废", "Annulé")
                          : entry.verification === "verified" &&
                              assetMap.get(entry.assetId)?.verification === "verified"
                            ? text("已核实", "Vérifié")
                            : text("待核实", "À vérifier")}
                      </span>
                      <span className={styles.cellSub}>{entry.sourceRef}</span>
                      {entry.voidedAt ? (
                        <span className={styles.cellSub}>
                          {entry.voidedAt.slice(0, 10)} · {entry.voidReason}
                        </span>
                      ) : null}
                      <span className={styles.cellSub}>
                        {entry.recognitionMethod === "daily"
                          ? text("按日分摊（测算）", "Répartition par jour (estimation)")
                          : text("暂不分摊", "Non réparti")}
                      </span>
                      {data.canWrite &&
                      !entry.voidedAt &&
                      entry.verification === "pending" &&
                      entry.updatedAt &&
                      assetMap.get(entry.assetId)?.verification === "verified" ? (
                        <EntryVerification entry={entry} zh={zh} />
                      ) : null}
                      {data.canWrite && !entry.voidedAt && entry.updatedAt ? (
                        <EntryVerification entry={entry} zh={zh} operation="void" />
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className={styles.empty}>
            {text(
              "暂无本期明细。租金标准不会自动生成实收或欠款。",
              "Aucune écriture pour cette période. Le loyer indicatif ne génère ni encaissement ni dette.",
            )}
          </p>
        )}
        {report?.exclusions.length ? (
          <details>
            <summary>{text("查看未纳入金额的记录", "Voir les écritures exclues")}</summary>
            <ul>
              {report.exclusions.map((item, index) => (
                <li key={`${item.entryId}:${index}`}>
                  {item.entryId} · {item.reason}
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </section>
    </div>
  );
}
