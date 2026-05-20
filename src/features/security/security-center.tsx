"use client";

import { useState } from "react";
import { Check, X, AlertTriangle, Download, Shield, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { runSecurityCheck, downloadBackup } from "./security-service";
import type { SecurityCheckItem } from "./security-types";

interface Props { locale: "zh" | "fr"; }

export function SecurityCenter({ locale }: Props) {
  const [checks, setChecks] = useState<SecurityCheckItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [backupLoading, setBackupLoading] = useState(false);
  const [backupMsg, setBackupMsg] = useState("");

  const handleCheck = async () => {
    setLoading(true);
    const results = await runSecurityCheck();
    setChecks(results);
    setLoading(false);
  };

  const handleBackup = async () => {
    setBackupLoading(true); setBackupMsg("");
    try {
      const backup = await downloadBackup();
      const blob = new Blob([backup.csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = backup.filename;
      a.click();
      URL.revokeObjectURL(url);
      setBackupMsg(locale === "zh"
        ? `已导出 ${backup.tableCount} 张表，共 ${backup.rowCount} 条记录`
        : `${backup.tableCount} tables, ${backup.rowCount} lignes exportees`);
    } catch { setBackupMsg(locale === "zh" ? "备份失败" : "Echec"); }
    setBackupLoading(false);
  };

  const L = {
    title: locale === "zh" ? "安全中心" : "Securite",
    runCheck: locale === "zh" ? "运行安全检查" : "Lancer verification",
    backup: locale === "zh" ? "生成备份包" : "Generer sauvegarde",
    backupDesc: locale === "zh" ? "导出核心业务数据为 CSV 文件（不含密码/token/session）" : "Exporter les donnees metier en CSV (sans donnees sensibles)",
  };

  return (
    <div className="max-w-3xl space-y-4">
      {/* Security checks */}
      <div className="rounded-xl border border-brand-warm-300 bg-white p-5 shadow-natural space-y-3">
        <div className="flex items-center gap-2"><Shield className="h-5 w-5 text-brand-orange-600" /><h3 className="text-base font-bold text-brand-ink-900">{L.title}</h3></div>
        <button onClick={handleCheck} disabled={loading}
          className="rounded-lg bg-brand-ink-900 px-4 py-2 text-xs font-semibold text-white hover:bg-brand-ink-700 disabled:opacity-50 inline-flex items-center gap-2">
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Shield className="h-3.5 w-3.5" />}{L.runCheck}
        </button>
        {checks.length > 0 && (
          <div className="space-y-1.5">
            {checks.map(c => (
              <div key={c.id} className={cn("flex items-start gap-2 rounded border px-3 py-2 text-xs", c.status === "pass" ? "border-brand-green-200 bg-green-50" : c.status === "warn" ? "border-brand-amber-200 bg-amber-50" : "border-brand-red-200 bg-red-50")}>
                {c.status === "pass" ? <Check className="h-4 w-4 shrink-0 text-brand-green-600 mt-0.5" /> : c.status === "warn" ? <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 mt-0.5" /> : <X className="h-4 w-4 shrink-0 text-brand-red-600 mt-0.5" />}
                <div>
                  <p className="font-semibold text-brand-ink-800">{c.label}</p>
                  <p className="text-brand-ink-500">{c.detail}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Backup */}
      <div className="rounded-xl border border-brand-warm-300 bg-white p-5 shadow-natural space-y-3">
        <div className="flex items-center gap-2"><Download className="h-5 w-5 text-brand-orange-600" /><h3 className="text-base font-bold text-brand-ink-900">{locale === "zh" ? "数据备份" : "Sauvegarde"}</h3></div>
        <p className="text-xs text-brand-ink-400">{L.backupDesc}</p>
        <button onClick={handleBackup} disabled={backupLoading}
          className="rounded-lg bg-brand-ink-900 px-4 py-2 text-xs font-semibold text-white hover:bg-brand-ink-700 disabled:opacity-50 inline-flex items-center gap-2">
          {backupLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}{L.backup}
        </button>
        {backupMsg && <p className="text-xs text-brand-green-600">{backupMsg}</p>}
      </div>
    </div>
  );
}
