"use client";

import { useState } from "react";
import {
  AlertTriangle, Check, X, Loader2, Play, Eye, Download,
  ChevronDown, ChevronUp,
} from "lucide-react";
import { cn } from "@/lib/utils";
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

  const [actionType, setActionType] = useState<BulkActionType | "">("");
  const [status, setStatus] = useState<BulkActionStatus>("idle");
  const [preview, setPreview] = useState<BulkPreview | null>(null);
  const [result, setResult] = useState<BulkResult | null>(null);
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const [extraReason, setExtraReason] = useState("");
  const [extraTargetStatus, setExtraTargetStatus] = useState("available");
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);

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

  const L = {
    title: locale === "zh" ? "批量操作中心" : "Actions en masse",
    selectAction: locale === "zh" ? "选择操作类型" : "Type d'action",
    preview: locale === "zh" ? "预览" : "Apercu",
    execute: locale === "zh" ? "执行" : "Executer",
    reset: locale === "zh" ? "重置" : "Reinitialiser",
    selected: locale === "zh" ? "已选" : "Sel.",
    willChange: locale === "zh" ? "将修改" : "Modif.",
    skipped: locale === "zh" ? "跳过" : "Sautes",
    totalAmount: locale === "zh" ? "涉及金额" : "Montant",
    warnings: locale === "zh" ? "警告" : "Alertes",
    success: locale === "zh" ? "成功" : "Reussi",
    failed: locale === "zh" ? "失败" : "Echec",
    reason: locale === "zh" ? "取消原因" : "Motif",
    targetStatus: locale === "zh" ? "目标房态" : "Statut cible",
    confirmWarning: locale === "zh" ? "此操作为危险操作，请确认后执行" : "Action dangereuse, confirmez",
    noResults: locale === "zh" ? "请先选择操作类型并预览" : "Selectionnez une action",
    done: locale === "zh" ? "完成" : "Termine",
  };

  return (
    <div className="max-w-4xl mx-auto space-y-4">
      {/* Operation selector */}
      <div className="rounded-2xl border border-brand-warm-200 bg-white p-5 shadow-natural space-y-3">
        <label className="block text-xs font-bold text-brand-ink-500">{L.selectAction}</label>
        <select
          value={actionType}
          onChange={e => { setActionType(e.target.value as BulkActionType); reset(); }}
          className="w-full sm:w-96 rounded-xl border border-brand-warm-200 bg-white px-3 py-2 text-sm text-brand-ink-700 shadow-sm transition focus:border-brand-indigo-300 focus:outline-none focus:ring-2 focus:ring-brand-indigo-500/15"
        >
          <option value="">—</option>
          {(["finance","unit","daily","customer"] as const).filter(c => permittedCategories.includes(c)).map(cat => (
            <optgroup key={cat} label={locale === "zh" ? { finance: "财务", unit: "房源", daily: "日租", customer: "客户" }[cat] : { finance: "Finance", unit: "Logements", daily: "Journalier", customer: "Clients" }[cat]}>
              {permittedActions.filter(a => a.category === cat).map(a => (
                <option key={a.type} value={a.type}>{locale === "zh" ? a.labelZh : a.labelFr}</option>
              ))}
            </optgroup>
          ))}
        </select>
        {selectedDef && (
          <p className="text-xs text-brand-ink-500">{locale === "zh" ? selectedDef.descZh : selectedDef.descFr}</p>
        )}

        {/* Extra params for specific actions */}
        {actionType === "daily_cancel_bookings" && (
          <div><label className="text-xs font-semibold text-brand-red-600">{L.reason} *</label>
            <input value={extraReason} onChange={e => setExtraReason(e.target.value)}
              className="w-full sm:w-64 rounded-xl border border-brand-warm-200 bg-white px-3 py-1.5 text-sm text-brand-ink-700 shadow-sm transition focus:border-brand-indigo-300 focus:outline-none focus:ring-2 focus:ring-brand-indigo-500/15" />
          </div>
        )}
        {actionType === "unit_change_status" && (
          <div><label className="text-xs font-semibold text-brand-ink-500">{L.targetStatus}</label>
            <select value={extraTargetStatus} onChange={e => setExtraTargetStatus(e.target.value)}
              className="w-full sm:w-48 rounded-xl border border-brand-warm-200 bg-white px-3 py-1.5 text-sm text-brand-ink-700 shadow-sm transition focus:border-brand-indigo-300 focus:outline-none focus:ring-2 focus:ring-brand-indigo-500/15">
              <option value="available">{locale === "zh" ? "空闲" : "Dispo"}</option>
              <option value="maintenance">{locale === "zh" ? "维修" : "Maint"}</option>
              <option value="locked">{locale === "zh" ? "锁定" : "Bloque"}</option>
            </select>
          </div>
        )}

        <div className="flex gap-2">
          <button onClick={handlePreview} disabled={loading || !actionType}
            className="rounded-xl bg-brand-indigo-500 px-4 py-2 text-xs font-bold text-white shadow-sm transition hover:bg-brand-indigo-600 active:scale-[0.98] disabled:opacity-50 inline-flex items-center gap-2">
            {loading && status === "idle" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Eye className="h-3.5 w-3.5" />}
            {L.preview}
          </button>
          <button onClick={reset} className="rounded-xl border border-brand-warm-200 bg-white px-4 py-2 text-xs font-semibold text-brand-ink-600 shadow-sm transition hover:border-brand-warm-300 hover:bg-brand-warm-50">{L.reset}</button>
        </div>
      </div>

      {/* Preview */}
      {preview && status !== "done" && (
        <div className="rounded-2xl border border-brand-warm-200 bg-white p-5 shadow-natural space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-black text-brand-ink-900">{L.preview}</h3>
            <div className="flex gap-3 text-xs">
              <span className="text-brand-green-600">{L.willChange}: {preview.changeCount}</span>
              <span className="text-brand-amber-600">{L.skipped}: {preview.skipCount}</span>
              {preview.totalAmount > 0 && <span className="text-brand-ink-600">{L.totalAmount}: {preview.totalAmount.toLocaleString()} XOF</span>}
            </div>
          </div>

          {preview.warnings.length > 0 && (
            <div className="rounded border border-brand-amber-200 bg-brand-amber-50 p-2 text-xs text-brand-amber-700">
              {preview.warnings.map((w, i) => <p key={i}><AlertTriangle className="inline h-3 w-3 mr-1" />{w}</p>)}
            </div>
          )}

          <div className="flex items-center gap-2 text-xs">
            <button onClick={toggleAll} className="text-brand-indigo font-medium hover:underline">
              {checkedIds.size === preview.rows.length ? (locale === "zh" ? "取消全选" : "Desel. tout") : (locale === "zh" ? "全选可操作" : "Tout sel.")}
            </button>
            <span className="text-brand-ink-400">{L.selected}: {checkedIds.size} / {preview.rows.length}</span>
          </div>

          <div className="max-h-[300px] overflow-auto rounded-xl border border-brand-warm-200 text-xs">
            <table className="data-table">
              <thead className="sticky top-0 bg-brand-warm-50/90 text-xs font-black uppercase tracking-[0.14em] text-brand-ink-500"><tr>
                <th className="px-2 py-1.5 w-8"></th>
                <th className="px-2 py-1.5 text-left">{locale === "zh" ? "记录" : "Enr."}</th>
                <th className="px-2 py-1.5 text-left">{locale === "zh" ? "结果" : "Resultat"}</th>
              </tr></thead>
              <tbody className="divide-y divide-brand-warm-100">
                {preview.rows.map(r => (
                  <tr key={r.id} className={cn(!r.willChange && "opacity-60")}>
                    <td className="px-2 py-1">
                      <input type="checkbox" checked={checkedIds.has(r.id)} onChange={() => toggleCheck(r.id)} disabled={!r.willChange}
                        className="h-3.5 w-3.5 rounded border-brand-warm-200" />
                    </td>
                    <td className="px-2 py-1 font-medium text-slate-800">{r.label}</td>
                    <td className={cn("px-2 py-1", r.willChange ? "text-brand-green-600" : "text-brand-amber-600")}>
                      {r.willChange ? (locale === "zh" ? "将执行" : "Oui") : r.skipReason}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {selectedDef?.dangerous && (
            <div className="rounded border border-brand-red-200 bg-brand-red-50 p-3 text-xs text-brand-red-700 flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0" />{L.confirmWarning}
            </div>
          )}

          <button
            onClick={handleExecute}
            disabled={loading || checkedIds.size === 0 || (actionType === "daily_cancel_bookings" && !extraReason)}
            className={cn("rounded-lg px-5 py-2.5 text-xs font-semibold text-white disabled:opacity-50 inline-flex items-center gap-2",
              selectedDef?.dangerous ? "bg-brand-red-600 hover:bg-brand-red-700" : "bg-brand-indigo-500 hover:bg-brand-indigo-600")}>
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
            {L.execute} ({checkedIds.size})
          </button>
        </div>
      )}

      {/* Result */}
      {result && (
        <div className={cn("rounded-xl border p-5 shadow-natural space-y-2", result.success ? "bg-brand-green-50 border-brand-green-200" : "bg-brand-amber-50 border-brand-amber-200")}>
          <h3 className="text-sm font-bold flex items-center gap-2">
            {result.success ? <Check className="h-4 w-4 text-brand-green-600" /> : <AlertTriangle className="h-4 w-4 text-brand-amber-600" />}
            {L.done}
          </h3>
          <div className="flex gap-4 text-xs">
            <span className="text-brand-green-600">{L.success}: {result.executed}</span>
            <span className="text-brand-red-600">{L.failed}: {result.failed}</span>
            <span className="text-brand-amber-600">{L.skipped}: {result.skipped}</span>
          </div>
          {result.errors.length > 0 && (
            <div className="max-h-[200px] overflow-auto text-xs space-y-0.5">
              {result.errors.map((e, i) => <p key={i} className="text-brand-red-600">{e}</p>)}
            </div>
          )}
          <button onClick={reset} className="rounded-xl border border-brand-warm-200 bg-white px-4 py-1.5 text-xs font-semibold text-brand-ink-600 shadow-sm transition hover:border-brand-warm-300 hover:bg-brand-warm-50">{L.reset}</button>
        </div>
      )}

      {/* Empty */}
      {status === "idle" && !preview && (
        <div className="rounded-2xl border border-brand-warm-200 bg-white py-16 text-center text-sm font-semibold text-brand-ink-400 shadow-natural">
          {L.noResults}
        </div>
      )}
    </div>
  );
}
