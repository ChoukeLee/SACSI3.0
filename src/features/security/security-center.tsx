"use client";

import { useState } from "react";
import { Check, X, AlertTriangle, Download, Shield, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { runSecurityCheck, downloadBackup } from "./security-service";
import type { SecurityCheckItem } from "./security-types";

interface Props { locale: "zh" | "fr"; }

export function SecurityCenter({ locale }: Props) {
  const zh = locale === "zh";
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
      setBackupMsg(zh
        ? `已导出 ${backup.tableCount} 张表，共 ${backup.rowCount} 条记录`
        : `${backup.tableCount} tables, ${backup.rowCount} lignes exportées`);
    } catch { setBackupMsg(zh ? "备份失败" : "Échec"); }
    setBackupLoading(false);
  };

  return (
    <div className="max-w-3xl space-y-5">
      {/* Security checks */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Shield className="h-5 w-5 text-primary" />
            {zh ? "安全中心" : "Sécurité"}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Button onClick={handleCheck} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Shield className="h-4 w-4" />}
            {zh ? "运行安全检查" : "Lancer vérification"}
          </Button>
          {checks.length > 0 && (
            <div className="space-y-1.5">
              {checks.map(c => (
                <div key={c.id} className={cn("flex items-start gap-2 rounded-md border px-3 py-2 text-sm",
                  c.status === "pass" ? "border-emerald-200 bg-emerald-50/50" : c.status === "warn" ? "border-amber-200 bg-amber-50/50" : "border-rose-200 bg-rose-50/50")}>
                  {c.status === "pass" ? <Check className="h-4 w-4 shrink-0 text-emerald-600 mt-0.5" /> : c.status === "warn" ? <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 mt-0.5" /> : <X className="h-4 w-4 shrink-0 text-rose-600 mt-0.5" />}
                  <div>
                    <p className="font-semibold">{c.label}</p>
                    <p className="text-muted-foreground text-xs">{c.detail}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Backup */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Download className="h-5 w-5 text-primary" />
            {zh ? "数据备份" : "Sauvegarde"}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            {zh ? "导出核心业务数据为 CSV 文件（不含密码/token/session）" : "Exporter les données métier en CSV (sans données sensibles)"}
          </p>
          <Button onClick={handleBackup} disabled={backupLoading}>
            {backupLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            {zh ? "生成备份包" : "Générer sauvegarde"}
          </Button>
          {backupMsg && <p className="text-sm text-emerald-600">{backupMsg}</p>}
        </CardContent>
      </Card>
    </div>
  );
}
