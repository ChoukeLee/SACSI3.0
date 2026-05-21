"use client";

import { useState } from "react";
import { Download, Upload, FileText, AlertTriangle, Check, X, Loader2 } from "lucide-react";
import { cn, formatXof } from "@/lib/utils";
import type {
  ExportDataType, ImportDataType, ImportResult, ImportSubmitResult,
} from "./data-exchange-types";
import {
  EXPORT_LABELS, IMPORT_LABELS, ROLE_EXPORT_TYPES, ROLE_IMPORT_TYPES,
} from "./data-exchange-types";
import { exportData } from "./export-service";
import { previewImport, submitImport, getImportTemplate } from "./import-service";

type Tab = "export" | "import";

interface Props {
  locale: "zh" | "fr";
  userRole: string;
}

export function DataExchangeCenter({ locale, userRole }: Props) {
  const role = userRole as "admin" | "boss" | "finance" | "front_desk";
  const exportTypes = ROLE_EXPORT_TYPES[role] ?? [];
  const importTypes = ROLE_IMPORT_TYPES[role] ?? [];
  const exportLabels = EXPORT_LABELS[locale];
  const importLabels = IMPORT_LABELS[locale];

  const [tab, setTab] = useState<Tab>("export");

  // Export state
  const [expType, setExpType] = useState<ExportDataType>(exportTypes[0] ?? "customers");
  const [expLoading, setExpLoading] = useState(false);
  const [expMsg, setExpMsg] = useState("");

  // Import state
  const [impType, setImpType] = useState<ImportDataType>(importTypes[0] ?? "customers");
  const [impText, setImpText] = useState("");
  const [impResult, setImpResult] = useState<ImportResult | null>(null);
  const [impSubmitResult, setImpSubmitResult] = useState<ImportSubmitResult | null>(null);
  const [impLoading, setImpLoading] = useState(false);

  const handleExport = async () => {
    setExpLoading(true); setExpMsg("");
    const csv = await exportData(expType);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${expType}_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    setExpMsg(locale === "zh" ? `å·²å¯¼å‡º ${csv.split("\n").length - 1} æ¡` : `${csv.split("\n").length - 1} lignes exportees`);
    setExpLoading(false);
  };

  const handlePreview = async () => {
    if (!impText.trim()) return;
    setImpLoading(true); setImpResult(null); setImpSubmitResult(null);
    const res = await previewImport(impType, impText);
    setImpResult(res);
    setImpLoading(false);
  };

  const handleSubmit = async () => {
    if (!impResult?.canSubmit) return;
    setImpLoading(true);
    const res = await submitImport(impType, impText);
    setImpSubmitResult(res);
    setImpLoading(false);
  };

  const handleDownloadTemplate = async () => {
    const csv = await getImportTemplate(impType);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `template_${impType}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const btn = "rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 shadow-sm transition hover:border-slate-300 hover:bg-slate-50";
  const primaryBtn = "rounded-xl bg-slate-950 px-4 py-2 text-xs font-bold text-white shadow-sm transition hover:bg-slate-800 active:scale-[0.98] disabled:opacity-50";

  return (
    <div className="max-w-4xl mx-auto space-y-4">
      {/* Tabs */}
      <div className="flex gap-1 rounded-xl border border-slate-200 bg-slate-100 p-1 w-fit">
        {(["export", "import"] as Tab[]).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={cn("rounded-md px-4 py-1.5 text-[13px] font-semibold transition-colors", tab === t ? "bg-white text-slate-950 shadow-sm" : "text-slate-500")}>
            {t === "export" ? (locale === "zh" ? "å¯¼å‡º" : "Export") : (locale === "zh" ? "å¯¼å…¥" : "Import")}
          </button>
        ))}
      </div>

      {/* â”€â”€ Export Tab â”€â”€ */}
      {tab === "export" && (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-natural space-y-4">
          <div>
            <label className="block text-[11px] font-bold text-slate-500 mb-1.5">{locale === "zh" ? "æ•°æ®ç±»åž‹" : "Type"}</label>
            <select value={expType} onChange={e => setExpType(e.target.value as ExportDataType)} className={cn(btn, "w-full sm:w-64")}>
              {exportTypes.map(t => <option key={t} value={t}>{exportLabels[t]}</option>)}
            </select>
          </div>
          <button onClick={handleExport} disabled={expLoading} className={cn(primaryBtn, "inline-flex items-center gap-2")}>
            {expLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
            {locale === "zh" ? "å¯¼å‡º CSV" : "Exporter CSV"}
          </button>
          {expMsg && <p className="text-xs text-brand-green-600">{expMsg}</p>}
        </div>
      )}

      {/* â”€â”€ Import Tab â”€â”€ */}
      {tab === "import" && (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-natural space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="block text-[11px] font-bold text-slate-500 mb-1.5">{locale === "zh" ? "æ•°æ®ç±»åž‹" : "Type"}</label>
              <select value={impType} onChange={e => { setImpType(e.target.value as ImportDataType); setImpResult(null); setImpSubmitResult(null); }} className={cn(btn, "w-full sm:w-48")}>
                {importTypes.map(t => <option key={t} value={t}>{importLabels[t]}</option>)}
              </select>
            </div>
            <button onClick={handleDownloadTemplate} className={cn(btn, "inline-flex items-center gap-1.5 text-brand-orange-600 border-brand-orange-200 hover:bg-brand-orange-50")}>
              <Download className="h-3.5 w-3.5" />{locale === "zh" ? "ä¸‹è½½æ¨¡æ¿" : "Modele"}
            </button>
          </div>

          <div>
            <label className="block text-[11px] font-bold text-slate-500 mb-1.5">{locale === "zh" ? "ç²˜è´´ CSV å†…å®¹" : "Coller CSV"}</label>
            <textarea
              value={impText}
              onChange={e => { setImpText(e.target.value); setImpResult(null); setImpSubmitResult(null); }}
              rows={8}
              placeholder={locale === "zh" ? "å°† CSV å†…å®¹ç²˜è´´åˆ°æ­¤å¤„..." : "Collez le contenu CSV ici..."}
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-mono text-slate-700 shadow-sm transition focus:border-brand-orange-300 focus:outline-none focus:ring-2 focus:ring-brand-orange-500/20"
            />
          </div>

          <div className="flex gap-2">
            <button onClick={handlePreview} disabled={impLoading || !impText.trim()}
              className={cn(primaryBtn, "inline-flex items-center gap-2")}>
              {impLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileText className="h-3.5 w-3.5" />}
              {locale === "zh" ? "é¢„è§ˆæ ¡éªŒ" : "Valider"}
            </button>
            {impResult?.canSubmit && (
              <button onClick={handleSubmit} disabled={impLoading}
                className={cn(primaryBtn, "bg-brand-green-600 hover:bg-brand-green-700 inline-flex items-center gap-2")}>
                {impLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                {locale === "zh" ? "ç¡®è®¤å¯¼å…¥" : "Importer"}
              </button>
            )}
          </div>

          {/* Preview results */}
          {impResult && (
            <div className="space-y-2">
              <div className="flex gap-3 text-xs">
                <span className="text-brand-green-600 flex items-center gap-1"><Check className="h-3 w-3" />{impResult.okCount} OK</span>
                <span className="text-brand-amber-600 flex items-center gap-1"><AlertTriangle className="h-3 w-3" />{impResult.warnCount} {locale === "zh" ? "è­¦å‘Š" : "alertes"}</span>
                <span className="text-brand-red-600 flex items-center gap-1"><X className="h-3 w-3" />{impResult.errCount} {locale === "zh" ? "é”™è¯¯" : "erreurs"}</span>
              </div>
              {impResult.errCount > 0 && <p className="text-xs text-brand-red-600">{locale === "zh" ? "å­˜åœ¨é”™è¯¯è¡Œï¼Œæ— æ³•æäº¤å¯¼å…¥" : "Erreurs detectees, import impossible"}</p>}

              <div className="overflow-auto max-h-[300px] rounded-xl border border-slate-200 text-xs">
                <table className="data-table">
                  <thead className="sticky top-0 bg-slate-50/90 text-[10px] font-black uppercase tracking-[0.14em] text-slate-500"><tr>
                    <th className="px-2 py-1.5 text-left">{locale === "zh" ? "è¡Œ" : "#"}</th>
                    <th className="px-2 py-1.5 text-left">{locale === "zh" ? "æ•°æ®" : "Donnees"}</th>
                    <th className="px-2 py-1.5 text-left">{locale === "zh" ? "ç»“æžœ" : "Resultat"}</th>
                  </tr></thead>
                  <tbody className="divide-y divide-slate-100">
                    {impResult.rows.map(r => (
                      <tr key={r.row} className={cn(r.status === "error" ? "bg-brand-red-50/30" : r.status === "warning" ? "bg-brand-amber-50/30" : "")}>
                        <td className="px-2 py-1.5 font-mono">{r.row}</td>
                        <td className="px-2 py-1.5 text-slate-600 max-w-[300px] truncate">{Object.values(r.data).join(", ")}</td>
                        <td className={cn("px-2 py-1.5", r.status === "error" ? "text-brand-red-600" : r.status === "warning" ? "text-brand-amber-600" : "text-brand-green-600")}>{r.message}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Submit result */}
          {impSubmitResult && (
            <div className={cn("rounded-lg p-4 text-sm", impSubmitResult.success ? "bg-brand-green-50 border border-brand-green-200" : "bg-brand-amber-50 border border-brand-amber-200")}>
              <p className="font-bold">{impSubmitResult.success ? (locale === "zh" ? "å¯¼å…¥æˆåŠŸ" : "Import reussi") : (locale === "zh" ? "å¯¼å…¥å®Œæˆï¼ˆæœ‰é”™è¯¯ï¼‰" : "Import termine (erreurs)")}</p>
              <p className="text-xs mt-1">{locale === "zh" ? `æˆåŠŸ ${impSubmitResult.inserted} æ¡ï¼Œå¤±è´¥ ${impSubmitResult.errors} æ¡` : `${impSubmitResult.inserted} ok, ${impSubmitResult.errors} erreurs`}</p>
              {impSubmitResult.messages.length > 0 && (
                <ul className="mt-2 text-xs space-y-0.5 max-h-[200px] overflow-auto">
                  {impSubmitResult.messages.map((m, i) => <li key={i} className="text-brand-red-600">{m}</li>)}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
