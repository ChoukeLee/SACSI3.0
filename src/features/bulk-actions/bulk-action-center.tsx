"use client";

import { useState } from "react";
import {
  AlertTriangle, Check, X, Loader2, Play, Eye, Download,
  ChevronDown, ChevronUp,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/empty-state";
import {
  BULK_ACTIONS, ROLE_ACTIONS,
  type BulkActionType, type BulkActionStatus, type BulkPreview, type BulkResult,
} from "./bulk-action-types";
import { buildPreview, executeBulk } from "./bulk-action-service";

interface Props { locale: "zh" | "fr"; userRole: string; }

export function BulkActionCenter({ locale, userRole }: Props) {
  const role = userRole as "admin" | "boss" | "finance" | "front_desk";
  const permittedCategories = ROLE_ACTIONS[role] ?? [];
  const permittedActions = BULK_ACTIONS.filter(a => permittedCategories.includes(a.category));
  const zh = locale === "zh";

  const [actionType, setActionType] = useState<BulkActionType | "">("");
  const [status, setStatus] = useState<BulkActionStatus>("idle");
  const [preview, setPreview] = useState<BulkPreview | null>(null);
  const [result, setResult] = useState<BulkResult | null>(null);
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const [extraReason, setExtraReason] = useState("");
  const [extraTargetStatus, setExtraTargetStatus] = useState("available");
  const [loading, setLoading] = useState(false);

  const selectedDef = BULK_ACTIONS.find(a => a.type === actionType);

  const handlePreview = async () => {
    if (!actionType) return;
    setLoading(true); setResult(null);
    const extra: Record<string, string> = {};
    if (actionType === "daily_cancel_bookings" && extraReason) extra.reason = extraReason;
    if (actionType === "unit_change_status") extra.targetStatus = extraTargetStatus;
    const p = await buildPreview(actionType, [...checkedIds], extra);
    setPreview(p); setStatus("preview");
    setLoading(false);
  };

  const handleExecute = async () => {
    if (!actionType) return;
    setLoading(true); setStatus("executing");
    const extra: Record<string, string> = {};
    if (actionType === "daily_cancel_bookings" && extraReason) extra.reason = extraReason;
    if (actionType === "unit_change_status") extra.targetStatus = extraTargetStatus;
    const r = await executeBulk(actionType, [...checkedIds], extra);
    setResult(r); setStatus("done");
    setLoading(false);
  };

  const toggleCheck = (id: string) => {
    setCheckedIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  };
  const toggleAll = () => {
    if (!preview) return;
    if (checkedIds.size === preview.rows.length) setCheckedIds(new Set());
    else setCheckedIds(new Set(preview.rows.filter(r => r.willChange).map(r => r.id)));
  };

  const reset = () => { setStatus("idle"); setPreview(null); setResult(null); setCheckedIds(new Set()); };

  const selectClass = "w-full rounded-md border bg-card px-3 py-2 text-sm shadow-sm transition-colors hover:border-ring/30 focus:outline-none focus:ring-2 focus:ring-ring/20";

  return (
    <div className="max-w-4xl space-y-5">
      {/* Operation selector */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{zh ? "批量操作中心" : "Actions en masse"}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <label className="block text-xs font-semibold text-muted-foreground">{zh ? "选择操作类型" : "Type d'action"}</label>
          <select
            value={actionType}
            onChange={e => { setActionType(e.target.value as BulkActionType); reset(); }}
            className={cn(selectClass, "sm:w-96")}
          >
            <option value="">—</option>
            {(["finance","unit","daily","customer"] as const).filter(c => permittedCategories.includes(c)).map(cat => (
              <optgroup key={cat} label={zh ? { finance: "财务", unit: "房源", daily: "日租", customer: "客户" }[cat] : { finance: "Finance", unit: "Logements", daily: "Journalier", customer: "Clients" }[cat]}>
                {permittedActions.filter(a => a.category === cat).map(a => (
                  <option key={a.type} value={a.type}>{zh ? a.labelZh : a.labelFr}</option>
                ))}
              </optgroup>
            ))}
          </select>
          {selectedDef && (
            <p className="text-sm text-muted-foreground">{zh ? selectedDef.descZh : selectedDef.descFr}</p>
          )}

          {/* Extra params */}
          {actionType === "daily_cancel_bookings" && (
            <div><label className="text-xs font-semibold text-rose-600">{zh ? "取消原因" : "Motif"} *</label>
              <input value={extraReason} onChange={e => setExtraReason(e.target.value)}
                className={cn(selectClass, "sm:w-64")} />
            </div>
          )}
          {actionType === "unit_change_status" && (
            <div><label className="text-xs font-semibold text-muted-foreground">{zh ? "目标房态" : "Statut cible"}</label>
              <select value={extraTargetStatus} onChange={e => setExtraTargetStatus(e.target.value)} className={cn(selectClass, "sm:w-48")}>
                <option value="available">{zh ? "空闲" : "Dispo"}</option>
                <option value="maintenance">{zh ? "维修" : "Maint"}</option>
                <option value="locked">{zh ? "锁定" : "Bloqué"}</option>
              </select>
            </div>
          )}

          <div className="flex gap-2">
            <Button onClick={handlePreview} disabled={loading || !actionType}>
              {loading && status === "idle" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />}
              {zh ? "预览" : "Aperçu"}
            </Button>
            <Button variant="ghost" onClick={reset}>{zh ? "重置" : "Réinitialiser"}</Button>
          </div>
        </CardContent>
      </Card>

      {/* Preview */}
      {preview && status !== "done" && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <CardTitle className="text-base">{zh ? "预览" : "Aperçu"}</CardTitle>
            <div className="flex gap-3 text-sm">
              <span className="text-emerald-600">{zh ? "将修改" : "Modif."}: {preview.changeCount}</span>
              <span className="text-amber-600">{zh ? "跳过" : "Sautés"}: {preview.skipCount}</span>
              {preview.totalAmount > 0 && <span className="text-muted-foreground">{zh ? "涉及金额" : "Montant"}: {preview.totalAmount.toLocaleString()} XOF</span>}
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {preview.warnings.length > 0 && (
              <div className="rounded-md border border-amber-200 bg-amber-50 p-2 text-sm text-amber-700">
                {preview.warnings.map((w, i) => <p key={i}><AlertTriangle className="inline h-3 w-3 mr-1" />{w}</p>)}
              </div>
            )}

            <div className="flex items-center gap-2 text-sm">
              <button onClick={toggleAll} className="text-primary font-medium hover:underline">
                {checkedIds.size === preview.rows.length ? (zh ? "取消全选" : "Désél. tout") : (zh ? "全选可操作" : "Tout sél.")}
              </button>
              <span className="text-muted-foreground">{zh ? "已选" : "Sél."}: {checkedIds.size} / {preview.rows.length}</span>
            </div>

            <div className="max-h-[300px] overflow-auto rounded-md border text-sm">
              <table className="w-full">
                <thead className="sticky top-0 bg-muted text-xs font-semibold uppercase tracking-[0.04em] text-muted-foreground"><tr>
                  <th className="px-3 py-2 w-8" />
                  <th className="px-3 py-2 text-left">{zh ? "记录" : "Enr."}</th>
                  <th className="px-3 py-2 text-left">{zh ? "结果" : "Résultat"}</th>
                </tr></thead>
                <tbody className="divide-y">
                  {preview.rows.map(r => (
                    <tr key={r.id} className={cn(!r.willChange && "opacity-60")}>
                      <td className="px-3 py-2">
                        <input type="checkbox" checked={checkedIds.has(r.id)} onChange={() => toggleCheck(r.id)} disabled={!r.willChange}
                          className="h-3.5 w-3.5 rounded border-muted-foreground/30" />
                      </td>
                      <td className="px-3 py-2 font-medium">{r.label}</td>
                      <td className={cn("px-3 py-2", r.willChange ? "text-emerald-600" : "text-amber-600")}>
                        {r.willChange ? (zh ? "将执行" : "Oui") : r.skipReason}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {selectedDef?.dangerous && (
              <div className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700 flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 shrink-0" />{zh ? "此操作为危险操作，请确认后执行" : "Action dangereuse, confirmez"}
              </div>
            )}

            <Button
              onClick={handleExecute}
              disabled={loading || checkedIds.size === 0 || (actionType === "daily_cancel_bookings" && !extraReason)}
              variant={selectedDef?.dangerous ? "destructive" : "default"}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              {zh ? "执行" : "Exécuter"} ({checkedIds.size})
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Result */}
      {result && (
        <Card className={cn(result.success ? "border-emerald-200 bg-emerald-50/50" : "border-amber-200 bg-amber-50/50")}>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              {result.success ? <Check className="h-4 w-4 text-emerald-600" /> : <AlertTriangle className="h-4 w-4 text-amber-600" />}
              {zh ? "完成" : "Terminé"}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex gap-4 text-sm">
              <span className="text-emerald-600">{zh ? "成功" : "Réussi"}: {result.executed}</span>
              <span className="text-rose-600">{zh ? "失败" : "Échec"}: {result.failed}</span>
              <span className="text-amber-600">{zh ? "跳过" : "Sautés"}: {result.skipped}</span>
            </div>
            {result.errors.length > 0 && (
              <div className="max-h-[200px] overflow-auto text-sm space-y-0.5">
                {result.errors.map((e, i) => <p key={i} className="text-rose-600">{e}</p>)}
              </div>
            )}
            <Button variant="ghost" size="sm" onClick={reset}>{zh ? "重置" : "Réinitialiser"}</Button>
          </CardContent>
        </Card>
      )}

      {/* Empty */}
      {status === "idle" && !preview && (
        <EmptyState title={zh ? "请先选择操作类型并预览" : "Sélectionnez une action"} />
      )}
    </div>
  );
}
