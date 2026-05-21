"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Save, TrendingUp, TrendingDown } from "lucide-react";
import { cn, formatXof } from "@/lib/utils";
import { computeKpiData, KPI_DEFINITIONS } from "@/features/management/kpi-service";
import type { ReceivableRow, UnitRow, DailyBookingRow, LeaseContractRow, SaleContractRow } from "@/types/database";

interface Target {
  id: string; period_type: string; period_start: string; period_end: string;
  metric_key: string; target_value: number; unit: string;
  scope_type: string; scope_value: string | null;
}

interface Props {
  targets: Target[];
  receivables: ReceivableRow[]; units: UnitRow[];
  bookings: DailyBookingRow[]; leases: LeaseContractRow[];
  sales: SaleContractRow[];
  locale: "zh" | "fr"; userRole: string;
}

export function TargetsView({ targets, receivables, units, bookings, leases, sales, locale, userRole }: Props) {
  const router = useRouter();
  const [showForm, setShowForm] = useState(false);
  const [formMetric, setFormMetric] = useState("monthly_receivable");
  const [formValue, setFormValue] = useState("");
  const [formPeriod, setFormPeriod] = useState("monthly");
  const [formMsg, setFormMsg] = useState("");
  const [saving, setSaving] = useState(false);

  const canEdit = userRole === "admin" || userRole === "boss";

  const kpiData = useMemo(() => computeKpiData(receivables, units, bookings, leases, sales), [receivables, units, bookings, leases, sales]);

  const kpiMap: Record<string, number> = {
    monthly_receivable: kpiData.totalReceivable,
    monthly_paid: kpiData.totalPaid,
    collection_rate: kpiData.collectionRate,
    occupancy_rate: kpiData.occupancyRate,
    daily_occupancy_rate: kpiData.dailyOccupancyRate,
    sale_recovery_rate: kpiData.saleRecoveryRate,
    vacancy_rate_max: kpiData.vacancyRate,
    overdue_amount_max: kpiData.totalOverdue,
  };

  const currentTargets = useMemo(() => {
    const monthStart = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}-01`;
    return targets.filter(t => t.period_start <= monthStart && t.period_end >= monthStart);
  }, [targets]);

  const handleSave = async () => {
    if (!formValue || isNaN(Number(formValue))) { setFormMsg("请输入有效数值"); return; }
    setSaving(true);
    const now = new Date();
    const start = formPeriod === "monthly"
      ? `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`
      : formPeriod === "quarterly"
      ? `${now.getFullYear()}-${String(Math.floor(now.getMonth() / 3) * 3 + 1).padStart(2, "0")}-01`
      : `${now.getFullYear()}-01-01`;
    const end = formPeriod === "monthly"
      ? new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10)
      : formPeriod === "quarterly"
      ? new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3 + 3, 0).toISOString().slice(0, 10)
      : `${now.getFullYear()}-12-31`;
    try {
      const resp = await fetch("/api/targets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ period_type: formPeriod, period_start: start, period_end: end, metric_key: formMetric, target_value: Number(formValue), unit: KPI_DEFINITIONS.find(d => d.key === formMetric)?.unit ?? "%", scope_type: "global" }),
      });
      if (resp.ok) { setShowForm(false); setFormMsg(""); setFormValue(""); router.refresh(); }
      else setFormMsg("保存失败");
    } catch { setFormMsg("网络错误"); }
    setSaving(false);
  };

  const handleDelete = async (id: string) => {
    if (!canEdit) return;
    const resp = await fetch(`/api/targets?id=${id}`, { method: "DELETE" });
    if (resp.ok) router.refresh();
  };

  return (
    <div className="space-y-4">
      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {KPI_DEFINITIONS.map(def => {
          const current = kpiMap[def.key] ?? 0;
          const target = currentTargets.find(t => t.metric_key === def.key);
          const rate = target ? (def.isPercentage ? Math.min(100, Math.round((current / Number(target.target_value)) * 100)) : Math.min(100, Math.round((current / Number(target.target_value)) * 100))) : null;
          const displayVal = def.key.endsWith("_max") ? current : current;
          return (
            <div key={def.key} className="rounded-lg border border-slate-200 bg-white p-3">
              <p className="text-[10px] text-slate-500">{locale === "zh" ? def.labelZh : def.labelFr}</p>
              <p className="text-lg font-black tabular-nums text-slate-950">
                {def.isPercentage ? `${displayVal}%` : formatXof(displayVal)}
              </p>
              {target ? (
                <div className="mt-1">
                  <div className="h-1.5 rounded-full bg-brand-neutral-200">
                    <div className={cn("h-full rounded-full", (rate ?? 0) >= 100 ? "bg-brand-green-500" : (rate ?? 0) >= 70 ? "bg-brand-orange" : "bg-brand-red-400")} style={{ width: `${Math.min(100, rate ?? 0)}%` }} />
                  </div>
                  <p className="text-[9px] text-slate-400 mt-0.5">
                    {locale === "zh" ? "目标" : "Cible"}: {def.isPercentage ? `${target.target_value}%` : formatXof(Number(target.target_value))}
                    {" · "}{rate}%
                  </p>
                </div>
              ) : (
                <p className="text-[9px] text-slate-400 mt-1">{locale === "zh" ? "未设置目标" : "Pas d'objectif"}</p>
              )}
            </div>
          );
        })}
      </div>

      {/* Targets list */}
      {canEdit && (
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-bold text-slate-950">{locale === "zh" ? "目标管理" : "Objectifs"}</h3>
            <button onClick={() => setShowForm(!showForm)} className="rounded-lg bg-slate-950 px-3 py-1.5 text-xs font-semibold text-white"><Plus className="inline h-3 w-3 mr-1" />{locale === "zh" ? "新增" : "Ajouter"}</button>
          </div>

          {showForm && (
            <div className="mb-3 rounded border border-brand-orange-200 bg-brand-orange-50 p-3 space-y-2">
              <select value={formPeriod} onChange={e => setFormPeriod(e.target.value)} className="w-full rounded-xl border border-slate-200 px-3 py-1.5 text-sm">
                <option value="monthly">{locale === "zh" ? "月度" : "Mensuel"}</option>
                <option value="quarterly">{locale === "zh" ? "季度" : "Trimestre"}</option>
                <option value="yearly">{locale === "zh" ? "年度" : "Annuel"}</option>
              </select>
              <select value={formMetric} onChange={e => setFormMetric(e.target.value)} className="w-full rounded-xl border border-slate-200 px-3 py-1.5 text-sm">
                {KPI_DEFINITIONS.map(d => <option key={d.key} value={d.key}>{locale === "zh" ? d.labelZh : d.labelFr}</option>)}
              </select>
              <input type="number" value={formValue} onChange={e => setFormValue(e.target.value)} placeholder={locale === "zh" ? "目标值" : "Valeur"} className="w-full rounded-xl border border-slate-200 px-3 py-1.5 text-sm" />
              {formMsg && <p className="text-xs text-brand-red-600">{formMsg}</p>}
              <button onClick={handleSave} disabled={saving} className="rounded-lg bg-slate-950 px-4 py-1.5 text-xs font-semibold text-white"><Save className="inline h-3 w-3 mr-1" />{locale === "zh" ? "保存" : "OK"}</button>
            </div>
          )}

          {targets.length === 0 ? (
            <p className="text-xs text-slate-400">{locale === "zh" ? "暂无目标" : "Aucun"}</p>
          ) : (
            <table className="w-full text-xs"><thead className="text-[10px] uppercase text-slate-500"><tr><th className="px-2 py-1">{locale === "zh" ? "指标" : "KPI"}</th><th className="px-2 py-1">{locale === "zh" ? "期间" : "Periode"}</th><th className="px-2 py-1 text-right">{locale === "zh" ? "目标值" : "Cible"}</th><th className="px-2 py-1"></th></tr></thead>
            <tbody className="divide-y divide-brand-neutral-200">
              {targets.map(t => {
                const def = KPI_DEFINITIONS.find(d => d.key === t.metric_key);
                return <tr key={t.id}><td className="px-2 py-1">{def ? (locale === "zh" ? def.labelZh : def.labelFr) : t.metric_key}</td><td className="px-2 py-1">{t.period_start} ~ {t.period_end}</td><td className="px-2 py-1 text-right font-medium">{def?.isPercentage ? `${t.target_value}%` : formatXof(Number(t.target_value))}</td><td className="px-2 py-1"><button onClick={() => handleDelete(t.id)} className="text-brand-red-500 hover:text-brand-red-700"><Trash2 className="h-3 w-3" /></button></td></tr>;
              })}
            </tbody></table>
          )}
        </div>
      )}
    </div>
  );
}
