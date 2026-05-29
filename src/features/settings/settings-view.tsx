"use client";

import { useState } from "react";
import { Plus, Building2, Tag, Building, Languages, Moon, ShieldCheck } from "lucide-react";
import type { Locale } from "@/lib/i18n";
import { dictionaries, routeFor } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import Link from "next/link";
import type { BuildingRow } from "@/types/database";
import { addBuilding, toggleBuildingActive, toggleBuildingPaused } from "./actions";

interface SettingsViewProps {
  buildings: BuildingRow[];
  locale: Locale;
}

const inputClass = "w-full rounded-md border bg-card px-3 py-2 text-sm shadow-sm transition-colors hover:border-ring/30 focus:outline-none focus:ring-2 focus:ring-ring/20";
const labelClass = "block mb-1 text-xs font-semibold text-muted-foreground";

export function SettingsView({ buildings, locale }: SettingsViewProps) {
  const t = dictionaries[locale].settings;
  const zh = locale === "zh";
  const [showNewBuilding, setShowNewBuilding] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const [bCode, setBCode] = useState("");
  const [bName, setBName] = useState("");
  const [bFloors, setBFloors] = useState(6);
  const [bElevators, setBElevators] = useState(0);

  const handleAddBuilding = async () => {
    if (!bCode.trim()) { setError(t.buildings.codeRequired); return; }
    setSaving(true); setError("");
    const result = await addBuilding({ code: bCode.trim(), displayName: bName.trim() || bCode, floorsAboveGround: bFloors, elevatorCount: bElevators });
    setSaving(false);
    if (result.success) { setShowNewBuilding(false); setBCode(""); setBName(""); }
    else setError(result.error ?? "Failed");
  };

  const handleToggleActive = async (id: string, active: boolean) => { await toggleBuildingActive(id, !active); };
  const handleTogglePaused = async (id: string, paused: boolean) => { await toggleBuildingPaused(id, !paused); };

  return (
    <div className="space-y-6">
      {/* 1. Buildings */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Building2 className="h-5 w-5 text-primary" />
            {t.buildings.title}
          </CardTitle>
          <Button size="sm" onClick={() => setShowNewBuilding(true)}>
            <Plus className="h-4 w-4" />{t.buildings.add}
          </Button>
        </CardHeader>
        <CardContent>
          {buildings.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">{t.buildings.noBuildings}</p>
          ) : (
            <div className="overflow-hidden rounded-md border">
              <table className="w-full text-left text-[13px]">
                <thead className="border-b bg-muted text-xs font-semibold uppercase tracking-[0.04em] text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2.5">{t.buildings.code}</th>
                    <th className="px-4 py-2.5">{t.buildings.displayName}</th>
                    <th className="px-4 py-2.5">{t.buildings.floors}</th>
                    <th className="px-4 py-2.5">{t.buildings.elevators}</th>
                    <th className="px-4 py-2.5">{t.buildings.active}</th>
                    <th className="px-4 py-2.5">{t.buildings.paused}</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {buildings.map((b) => (
                    <tr key={b.id} className="transition-colors hover:bg-accent/50">
                      <td className="px-4 py-2.5 font-mono font-semibold">{b.code}</td>
                      <td className="px-4 py-2.5">{b.display_name}</td>
                      <td className="px-4 py-2.5 text-muted-foreground">{b.floors_above_ground}</td>
                      <td className="px-4 py-2.5 text-muted-foreground">{b.elevator_count}</td>
                      <td className="px-4 py-2.5">
                        <button onClick={() => handleToggleActive(b.id, b.is_active)}
                          className={cn("rounded-full px-2.5 py-0.5 text-xs font-bold", b.is_active ? "bg-emerald-100 text-emerald-700" : "bg-muted text-muted-foreground")}>{b.is_active ? "✓" : "✗"}</button>
                      </td>
                      <td className="px-4 py-2.5">
                        <button onClick={() => handleTogglePaused(b.id, b.business_paused)}
                          className={cn("rounded-full px-2.5 py-0.5 text-xs font-bold", b.business_paused ? "bg-rose-100 text-rose-700" : "bg-muted text-muted-foreground")}>{b.business_paused ? (zh ? "暂停" : "Suspendu") : (zh ? "正常" : "Actif")}</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {showNewBuilding && (
            <div className="mt-4 rounded-md border border-dashed p-4 bg-muted/30">
              <div className="grid grid-cols-4 gap-3">
                <div><label className={labelClass}>{t.buildings.code}</label><input value={bCode} onChange={(e) => setBCode(e.target.value)} className={inputClass} placeholder="SASCI3" /></div>
                <div><label className={labelClass}>{t.buildings.displayName}</label><input value={bName} onChange={(e) => setBName(e.target.value)} className={inputClass} placeholder="3#公寓" /></div>
                <div><label className={labelClass}>{t.buildings.floors}</label><input type="number" value={bFloors} onChange={(e) => setBFloors(Number(e.target.value))} className={inputClass} /></div>
                <div><label className={labelClass}>{t.buildings.elevators}</label><input type="number" value={bElevators} onChange={(e) => setBElevators(Number(e.target.value))} className={inputClass} /></div>
              </div>
              {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
              <div className="mt-3 flex items-center gap-2">
                <Button size="sm" onClick={handleAddBuilding} disabled={saving}>{saving ? "..." : t.buildings.confirmAdd}</Button>
                <Button size="sm" variant="ghost" onClick={() => setShowNewBuilding(false)}>{zh ? "取消" : "Annuler"}</Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 2. Pricing */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Tag className="h-5 w-5 text-primary" />
            {t.pricing.title}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-md border p-4">
              <label className="text-sm font-bold">{t.pricing.dailyDefault}</label>
              <p className="text-xs text-muted-foreground mt-0.5">{t.pricing.dailyDefaultDesc}</p>
              <div className="mt-2 flex items-center gap-2">
                <input type="number" defaultValue={40000} className="w-32 rounded-md border bg-card px-3 py-2 text-sm" />
                <span className="text-sm text-muted-foreground">XOF</span>
              </div>
            </div>
            <div className="rounded-md border p-4">
              <label className="text-sm font-bold">{t.pricing.lateRate}</label>
              <p className="text-xs text-muted-foreground mt-0.5">{t.pricing.lateRateDesc}</p>
              <div className="mt-2 flex items-center gap-2">
                <input type="number" defaultValue={5} className="w-24 rounded-md border bg-card px-3 py-2 text-sm" />
                <span className="text-sm text-muted-foreground">/10000/天</span>
              </div>
            </div>
          </div>
          <Button variant="outline" size="sm" disabled className="mt-4">{t.pricing.save}</Button>
        </CardContent>
      </Card>

      {/* 3. Company Info */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Building className="h-5 w-5 text-primary" />
            {t.company.title}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground mb-3">{t.company.desc}</p>
          <div className="grid gap-3 md:grid-cols-2">
            <div><label className={labelClass}>{t.company.name}</label><input className={inputClass} placeholder="科建地产" /></div>
            <div><label className={labelClass}>{t.company.phone}</label><input className={inputClass} placeholder="+225 XX XX XX XX" /></div>
          </div>
          <div className="mt-3"><label className={labelClass}>{t.company.address}</label><input className={inputClass} placeholder="Abidjan, Côte d'Ivoire" /></div>
          <Button variant="outline" size="sm" disabled className="mt-4">{t.company.save}</Button>
        </CardContent>
      </Card>

      {/* 4. Language */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Languages className="h-5 w-5 text-primary" />
            {t.language.title}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-4">
            <span className="text-sm text-muted-foreground">{t.language.current}: <strong>{locale === "zh" ? t.language.zh : t.language.fr}</strong></span>
            <Button asChild variant="outline" size="sm">
              <Link href={routeFor(locale === "zh" ? "fr" : "zh", "/settings")}>{locale === "zh" ? t.language.fr : t.language.zh}</Link>
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* 5. Dark Mode */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Moon className="h-5 w-5 text-primary" />
            {t.darkMode.title}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Button variant="outline" size="sm" disabled>{t.darkMode.placeholder}</Button>
        </CardContent>
      </Card>

      {/* 6. Audit Logs */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldCheck className="h-5 w-5 text-primary" />
            {zh ? "审计日志" : "Journal d'audit"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground mb-3">
            {zh
              ? "查看系统关键操作的变更历史：谁在什么时候创建、修改、删除了什么。仅管理员和老板可见。"
              : "Historique des opérations clés : qui a fait quoi, quand et sur quel objet. Admin et propriétaire uniquement."
            }
          </p>
          <Button asChild>
            <Link href={routeFor(locale, "/settings/audit-logs")}>
              <ShieldCheck className="h-4 w-4" />
              {zh ? "查看审计日志" : "Voir le journal"}
            </Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
