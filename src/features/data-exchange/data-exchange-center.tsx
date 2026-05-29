"use client";

import { useState } from "react";
import { Download, Upload, FileText, AlertTriangle, Check, X, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
  const zh = locale === "zh";

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
    setExpMsg(zh ? `已导出 ${csv.split("\n").length - 1} 条` : `${csv.split("\n").length - 1} lignes exportées`);
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

  const selectClass = "h-9 rounded-md border bg-card px-3 py-2 text-sm shadow-sm transition-colors hover:border-ring/30 focus:outline-none focus:ring-2 focus:ring-ring/20";

  const tabs = [
    { key: "export" as Tab, label: zh ? "导出" : "Export" },
    { key: "import" as Tab, label: zh ? "导入" : "Import" },
  ];

  return (
    <div className="max-w-4xl space-y-5">
      {/* Tabs */}
      <nav className="flex gap-1 rounded-xl border bg-card p-1.5 shadow-sm w-fit">
        {tabs.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={cn("rounded-md px-4 py-2 text-sm font-semibold transition",
              tab === t.key ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-accent hover:text-accent-foreground")}>
            {t.label}
          </button>
        ))}
      </nav>

      {/* Export Tab */}
      {tab === "export" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{zh ? "导出数据" : "Export données"}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-muted-foreground mb-1.5">{zh ? "数据类型" : "Type"}</label>
              <select value={expType} onChange={e => setExpType(e.target.value as ExportDataType)} className={cn(selectClass, "w-full sm:w-64")}>
                {exportTypes.map(t => <option key={t} value={t}>{exportLabels[t]}</option>)}
              </select>
            </div>
            <Button onClick={handleExport} disabled={expLoading}>
              {expLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              {zh ? "导出 CSV" : "Exporter CSV"}
            </Button>
            {expMsg && <p className="text-sm text-emerald-600">{expMsg}</p>}
          </CardContent>
        </Card>
      )}

      {/* Import Tab */}
      {tab === "import" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{zh ? "导入数据" : "Import données"}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label className="block text-xs font-semibold text-muted-foreground mb-1.5">{zh ? "数据类型" : "Type"}</label>
                <select value={impType} onChange={e => { setImpType(e.target.value as ImportDataType); setImpResult(null); setImpSubmitResult(null); }} className={cn(selectClass, "w-full sm:w-48")}>
                  {importTypes.map(t => <option key={t} value={t}>{importLabels[t]}</option>)}
                </select>
              </div>
              <Button variant="outline" size="sm" onClick={handleDownloadTemplate}>
                <Download className="h-4 w-4" />{zh ? "下载模板" : "Modèle"}
              </Button>
            </div>

            <div>
              <label className="block text-xs font-semibold text-muted-foreground mb-1.5">{zh ? "粘贴 CSV 内容" : "Coller CSV"}</label>
              <textarea
                value={impText}
                onChange={e => { setImpText(e.target.value); setImpResult(null); setImpSubmitResult(null); }}
                rows={8}
                placeholder={zh ? "将 CSV 内容粘贴到此处..." : "Collez le contenu CSV ici..."}
                className="w-full rounded-md border bg-card px-3 py-2 text-sm font-mono shadow-sm transition-colors hover:border-ring/30 focus:outline-none focus:ring-2 focus:ring-ring/20"
              />
            </div>

            <div className="flex gap-2">
              <Button onClick={handlePreview} disabled={impLoading || !impText.trim()}>
                {impLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
                {zh ? "预览校验" : "Valider"}
              </Button>
              {impResult?.canSubmit && (
                <Button onClick={handleSubmit} disabled={impLoading} variant="default" className="bg-emerald-600 hover:bg-emerald-700">
                  {impLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                  {zh ? "确认导入" : "Importer"}
                </Button>
              )}
            </div>

            {/* Preview results */}
            {impResult && (
              <div className="space-y-2">
                <div className="flex gap-3 text-sm">
                  <span className="text-emerald-600 flex items-center gap-1"><Check className="h-4 w-4" />{impResult.okCount} OK</span>
                  <span className="text-amber-600 flex items-center gap-1"><AlertTriangle className="h-4 w-4" />{impResult.warnCount} {zh ? "警告" : "alertes"}</span>
                  <span className="text-rose-600 flex items-center gap-1"><X className="h-4 w-4" />{impResult.errCount} {zh ? "错误" : "erreurs"}</span>
                </div>
                {impResult.errCount > 0 && <p className="text-sm text-rose-600">{zh ? "存在错误行，无法提交导入" : "Erreurs détectées, import impossible"}</p>}

                <div className="overflow-auto max-h-[300px] rounded-md border text-sm">
                  <table className="w-full">
                    <thead className="sticky top-0 bg-muted text-xs font-semibold uppercase tracking-[0.04em] text-muted-foreground"><tr>
                      <th className="px-3 py-2 text-left">{zh ? "行" : "#"}</th>
                      <th className="px-3 py-2 text-left">{zh ? "数据" : "Données"}</th>
                      <th className="px-3 py-2 text-left">{zh ? "结果" : "Résultat"}</th>
                    </tr></thead>
                    <tbody className="divide-y">
                      {impResult.rows.map(r => (
                        <tr key={r.row} className={cn(r.status === "error" ? "bg-rose-50/30" : r.status === "warning" ? "bg-amber-50/30" : "")}>
                          <td className="px-3 py-2 font-mono">{r.row}</td>
                          <td className="px-3 py-2 text-muted-foreground max-w-[300px] truncate">{Object.values(r.data).join(", ")}</td>
                          <td className={cn("px-3 py-2", r.status === "error" ? "text-rose-600" : r.status === "warning" ? "text-amber-600" : "text-emerald-600")}>{r.message}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Submit result */}
            {impSubmitResult && (
              <div className={cn("rounded-md p-4 text-sm", impSubmitResult.success ? "bg-emerald-50 border border-emerald-200" : "bg-amber-50 border border-amber-200")}>
                <p className="font-bold">{impSubmitResult.success ? (zh ? "导入成功" : "Import réussi") : (zh ? "导入完成（有错误）" : "Import terminé (erreurs)")}</p>
                <p className="text-xs mt-1">{zh ? `成功 ${impSubmitResult.inserted} 条，失败 ${impSubmitResult.errors} 条` : `${impSubmitResult.inserted} ok, ${impSubmitResult.errors} erreurs`}</p>
                {impSubmitResult.messages.length > 0 && (
                  <ul className="mt-2 text-xs space-y-0.5 max-h-[200px] overflow-auto">
                    {impSubmitResult.messages.map((m, i) => <li key={i} className="text-rose-600">{m}</li>)}
                  </ul>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
