"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Save } from "lucide-react";
import { cn, formatXof } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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

const inputClass = "w-full rounded-md border bg-card px-3 py-2 text-sm shadow-sm transition-colors hover:border-ring/30 focus:outline-none focus:ring-2 focus:ring-ring/20";

export function TargetsView({ targets, receivables, units, bookings, leases, sales, locale, userRole }: Props) {
  const router = useRouter();
  const zh = locale === "zh";
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
    if (!formValue || isNaN(Number(formValue))) { setFormMsg(zh ? "请输入有效数值" : "Valeur invalide"); return; }
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
      else setFormMsg(zh ? "保存失败" : "Échec");
    } catch { setFormMsg(zh ? "网络错误" : "Erreur réseau"); }
    setSaving(false);
  };

  const handleDelete = async (id: string) => {
    if (!canEdit) return;
    const resp = await fetch(`/api/targets?id=${id}`, { method: "DELETE" });
    if (resp.ok) router.refresh();
  };

  return (
    <div className="space-y-5">
      {/* KPI Cards */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {KPI_DEFINITIONS.map(def => {
          const current = kpiMap[def.key] ?? 0;
          const target = currentTargets.find(t => t.metric_key === def.key);
          const rate = target ? Math.min(100, Math.round((current / Number(target.target_value)) * 100)) : null;
          const dot = target
            ? ((rate ?? 0) >= 100 ? "bg-accentGreen-500" : (rate ?? 0) >= 70 ? "bg-accentAmber-500" : "bg-accentRed-500")
            : "bg-muted-foreground/40";
          return (
            <StatTile
              key={def.key}
              label={zh ? def.labelZh : def.labelFr}
              value={def.isPercentage ? `${current}%` : formatXof(current)}
              caption={target ? `${zh ? "目标" : "Cible"}: ${def.isPercentage ? `${target.target_value}%` : formatXof(Number(target.target_value))} - ${rate}%` : (zh ? "未设置目标" : "Pas d'objectif")}
              dot={dot}
            />
          );
        })}
      </div>

      {/* Targets management */}
      {canEdit && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <CardTitle className="text-base">{zh ? "目标管理" : "Objectifs"}</CardTitle>
            <Button size="sm" onClick={() => setShowForm(!showForm)}>
              <Plus className="h-4 w-4" />{zh ? "新增" : "Ajouter"}
            </Button>
          </CardHeader>
          <CardContent>
            {showForm && (
              <div className="mb-3 rounded-md border bg-muted/30 p-3 space-y-2">
                <select value={formPeriod} onChange={e => setFormPeriod(e.target.value)} className={inputClass}>
                  <option value="monthly">{zh ? "月度" : "Mensuel"}</option>
                  <option value="quarterly">{zh ? "季度" : "Trimestre"}</option>
                  <option value="yearly">{zh ? "年度" : "Annuel"}</option>
                </select>
                <select value={formMetric} onChange={e => setFormMetric(e.target.value)} className={inputClass}>
                  {KPI_DEFINITIONS.map(d => <option key={d.key} value={d.key}>{zh ? d.labelZh : d.labelFr}</option>)}
                </select>
                <input type="number" value={formValue} onChange={e => setFormValue(e.target.value)} placeholder={zh ? "目标值" : "Valeur"} className={inputClass} />
                {formMsg && <p className="text-sm text-destructive">{formMsg}</p>}
                <Button size="sm" onClick={handleSave} disabled={saving}><Save className="h-4 w-4" />{zh ? "保存" : "OK"}</Button>
              </div>
            )}

            {targets.length === 0 ? (
              <p className="text-sm text-muted-foreground">{zh ? "暂无目标" : "Aucun"}</p>
            ) : (
              <div className="overflow-hidden rounded-md border">
                <table className="w-full text-left text-[13px]">
                  <thead className="border-b bg-muted text-xs font-semibold uppercase tracking-[0.04em] text-muted-foreground">
                    <tr>
                      <th className="px-4 py-2.5">{zh ? "指标" : "KPI"}</th>
                      <th className="px-4 py-2.5">{zh ? "期间" : "Période"}</th>
                      <th className="px-4 py-2.5 text-right">{zh ? "目标值" : "Cible"}</th>
                      <th className="px-4 py-2.5 w-10" />
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {targets.map(t => {
                      const def = KPI_DEFINITIONS.find(d => d.key === t.metric_key);
                      return (
                        <tr key={t.id} className="transition-colors hover:bg-accent/50">
                          <td className="px-4 py-2.5">{def ? (zh ? def.labelZh : def.labelFr) : t.metric_key}</td>
                          <td className="px-4 py-2.5 text-muted-foreground">{t.period_start} ~ {t.period_end}</td>
                          <td className="px-4 py-2.5 text-right tabular-nums font-medium">{def?.isPercentage ? `${t.target_value}%` : formatXof(Number(t.target_value))}</td>
                          <td className="px-4 py-2.5">
                            <button onClick={() => handleDelete(t.id)} className="text-rose-500 hover:text-rose-700 p-1 rounded"><Trash2 className="h-3.5 w-3.5" /></button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function StatTile({ label, value, caption, dot }: { label: string; value: string; caption?: string; dot: string }) {
  return (
    <div className="flex items-center gap-2.5 rounded-xl border border-border/60 bg-card px-3.5 py-3 shadow-sm">
      <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", dot)} />
      <div className="min-w-0">
        <p className="text-xl font-bold leading-none tracking-tight tabular-nums">{value}</p>
        <p className="mt-0.5 text-[11px] leading-tight text-muted-foreground">{label}</p>
        {caption && <p className="mt-1 truncate text-[11px] text-muted-foreground/80">{caption}</p>}
      </div>
    </div>
  );
}
