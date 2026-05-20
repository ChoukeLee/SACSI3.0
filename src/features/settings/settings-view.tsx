"use client";

import { useState } from "react";
import { Plus, X, Building2, Tag, Building, Languages, Moon, ShieldCheck } from "lucide-react";
import type { Locale } from "@/lib/i18n";
import { dictionaries, routeFor } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import Link from "next/link";
import type { BuildingRow } from "@/types/database";
import { addBuilding, toggleBuildingActive, toggleBuildingPaused } from "./actions";

interface SettingsViewProps {
  buildings: BuildingRow[];
  locale: Locale;
}

export function SettingsView({ buildings, locale }: SettingsViewProps) {
  const t = dictionaries[locale].settings;
  const [showNewBuilding, setShowNewBuilding] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const [bCode, setBCode] = useState("");
  const [bName, setBName] = useState("");
  const [bFloors, setBFloors] = useState(6);
  const [bElevators, setBElevators] = useState(0);

  const inputClass = "w-full rounded border border-brand-warm-400 bg-white px-3 py-2 text-sm text-brand-ink-900 focus:outline-none focus:ring-2 focus:ring-brand-orange-500/30";
  const labelClass = "block text-xs font-semibold uppercase tracking-wide text-brand-ink-400 mb-1";

  const handleAddBuilding = async () => {
    if (!bCode.trim()) { setError(t.buildings.codeRequired); return; }
    setSaving(true); setError("");
    const result = await addBuilding({ code: bCode.trim(), displayName: bName.trim() || bCode, floorsAboveGround: bFloors, elevatorCount: bElevators });
    setSaving(false);
    if (result.success) { setShowNewBuilding(false); setBCode(""); setBName(""); }
    else setError(result.error ?? "Failed");
  };

  const handleToggleActive = async (id: string, active: boolean) => {
    await toggleBuildingActive(id, !active);
  };

  const handleTogglePaused = async (id: string, paused: boolean) => {
    await toggleBuildingPaused(id, !paused);
  };

  return (
    <div className="space-y-8">
      {/* 1. Buildings */}
      <section className="rounded-xl border border-brand-warm-400 bg-white p-5 shadow-card">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Building2 className="h-5 w-5 text-brand-orange-600" />
            <h3 className="text-base font-bold text-brand-ink-900">{t.buildings.title}</h3>
          </div>
          <button onClick={() => setShowNewBuilding(true)} className="inline-flex items-center gap-1.5 rounded-lg bg-brand-ink-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-ink-700">
            <Plus className="h-3.5 w-3.5" />{t.buildings.add}
          </button>
        </div>

        {buildings.length === 0 ? (
          <p className="py-8 text-center text-sm text-brand-ink-300">{t.buildings.noBuildings}</p>
        ) : (
          <div className="overflow-hidden rounded border border-brand-warm-400">
            <table className="w-full text-left text-sm">
              <thead className="bg-brand-warm-50 text-xs uppercase tracking-wide text-brand-ink-400">
                <tr>
                  <th className="px-4 py-3">{t.buildings.code}</th>
                  <th className="px-4 py-3">{t.buildings.displayName}</th>
                  <th className="px-4 py-3">{t.buildings.floors}</th>
                  <th className="px-4 py-3">{t.buildings.elevators}</th>
                  <th className="px-4 py-3">{t.buildings.active}</th>
                  <th className="px-4 py-3">{t.buildings.paused}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-brand-warm-400">
                {buildings.map((b) => (
                  <tr key={b.id} className="transition hover:bg-brand-warm-50">
                    <td className="px-4 py-3 font-mono font-semibold text-brand-ink-900">{b.code}</td>
                    <td className="px-4 py-3 text-brand-ink-600">{b.display_name}</td>
                    <td className="px-4 py-3 text-brand-ink-500">{b.floors_above_ground}</td>
                    <td className="px-4 py-3 text-brand-ink-500">{b.elevator_count}</td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => handleToggleActive(b.id, b.is_active)}
                        className={cn("rounded px-2 py-0.5 text-xs font-semibold", b.is_active ? "bg-brand-green-100 text-brand-green-700" : "bg-brand-warm-100 text-brand-ink-300")}
                      >
                        {b.is_active ? "✓" : "✗"}
                      </button>
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => handleTogglePaused(b.id, b.business_paused)}
                        className={cn("rounded px-2 py-0.5 text-xs font-semibold", b.business_paused ? "bg-brand-red-100 text-brand-red-700" : "bg-brand-warm-100 text-brand-ink-300")}
                      >
                        {b.business_paused ? "暂停" : "正常"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* New building form */}
        {showNewBuilding && (
          <div className="mt-4 rounded border border-dashed border-brand-warm-400 bg-brand-warm-50 p-4">
            <div className="grid grid-cols-4 gap-3">
              <div><label className={labelClass}>{t.buildings.code}</label><input value={bCode} onChange={(e) => setBCode(e.target.value)} className={inputClass} placeholder="SASCI3" /></div>
              <div><label className={labelClass}>{t.buildings.displayName}</label><input value={bName} onChange={(e) => setBName(e.target.value)} className={inputClass} placeholder="3#公寓" /></div>
              <div><label className={labelClass}>{t.buildings.floors}</label><input type="number" value={bFloors} onChange={(e) => setBFloors(Number(e.target.value))} className={inputClass} /></div>
              <div><label className={labelClass}>{t.buildings.elevators}</label><input type="number" value={bElevators} onChange={(e) => setBElevators(Number(e.target.value))} className={inputClass} /></div>
            </div>
            {error && <p className="mt-2 text-sm text-brand-red-600">{error}</p>}
            <div className="mt-3 flex items-center gap-2">
              <button onClick={handleAddBuilding} disabled={saving} className="rounded-lg bg-brand-ink-900 px-4 py-1.5 text-xs font-semibold text-white hover:bg-brand-ink-700 disabled:opacity-50">{saving ? "..." : t.buildings.confirmAdd}</button>
              <button onClick={() => setShowNewBuilding(false)} className="rounded px-4 py-1.5 text-xs font-medium text-brand-ink-600 hover:bg-brand-warm-100">取消</button>
            </div>
          </div>
        )}
      </section>

      {/* 2. Pricing */}
      <section className="rounded-xl border border-brand-warm-400 bg-white p-5 shadow-card">
        <div className="flex items-center gap-2 mb-4">
          <Tag className="h-5 w-5 text-brand-orange-600" />
          <h3 className="text-base font-bold text-brand-ink-900">{t.pricing.title}</h3>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded border border-brand-warm-400 p-4">
            <label className="text-sm font-semibold text-brand-ink-900">{t.pricing.dailyDefault}</label>
            <p className="text-xs text-brand-ink-300 mt-0.5">{t.pricing.dailyDefaultDesc}</p>
            <div className="mt-2 flex items-center gap-2">
              <input type="number" defaultValue={40000} className="w-32 rounded border border-brand-warm-400 px-3 py-1.5 text-sm" />
              <span className="text-sm text-brand-ink-400">XOF</span>
            </div>
          </div>
          <div className="rounded border border-brand-warm-400 p-4">
            <label className="text-sm font-semibold text-brand-ink-900">{t.pricing.lateRate}</label>
            <p className="text-xs text-brand-ink-300 mt-0.5">{t.pricing.lateRateDesc}</p>
            <div className="mt-2 flex items-center gap-2">
              <input type="number" defaultValue={5} className="w-24 rounded border border-brand-warm-400 px-3 py-1.5 text-sm" />
              <span className="text-sm text-brand-ink-400">/10000/天</span>
            </div>
          </div>
        </div>
        <button disabled className="mt-4 rounded border border-brand-warm-400 px-4 py-1.5 text-xs font-medium text-brand-ink-300">{t.pricing.save}</button>
      </section>

      {/* 3. Company Info */}
      <section className="rounded-xl border border-brand-warm-400 bg-white p-5 shadow-card">
        <div className="flex items-center gap-2 mb-4">
          <Building className="h-5 w-5 text-brand-orange-600" />
          <h3 className="text-base font-bold text-brand-ink-900">{t.company.title}</h3>
        </div>
        <p className="text-xs text-brand-ink-300 mb-3">{t.company.desc}</p>
        <div className="grid gap-3 md:grid-cols-2">
          <div><label className={labelClass}>{t.company.name}</label><input className={inputClass} placeholder="科建地产" /></div>
          <div><label className={labelClass}>{t.company.phone}</label><input className={inputClass} placeholder="+225 XX XX XX XX" /></div>
        </div>
        <div className="mt-3"><label className={labelClass}>{t.company.address}</label><input className={inputClass} placeholder="Abidjan, Côte d'Ivoire" /></div>
        <button disabled className="mt-4 rounded border border-brand-warm-400 px-4 py-1.5 text-xs font-medium text-brand-ink-300">{t.company.save}</button>
      </section>

      {/* 4. Language */}
      <section className="rounded-xl border border-brand-warm-400 bg-white p-5 shadow-card">
        <div className="flex items-center gap-2 mb-4">
          <Languages className="h-5 w-5 text-brand-orange-600" />
          <h3 className="text-base font-bold text-brand-ink-900">{t.language.title}</h3>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-sm text-brand-ink-500">{t.language.current}: <strong>{locale === "zh" ? t.language.zh : t.language.fr}</strong></span>
          <Link href={routeFor(locale === "zh" ? "fr" : "zh", "/settings")} className="rounded border border-brand-warm-400 px-3 py-1 text-xs font-medium text-brand-orange-600 hover:bg-brand-orange-50">
            {locale === "zh" ? t.language.fr : t.language.zh}
          </Link>
        </div>
      </section>

      {/* 5. Dark Mode */}
      <section className="rounded-xl border border-brand-warm-400 bg-white p-5 shadow-card">
        <div className="flex items-center gap-2 mb-4">
          <Moon className="h-5 w-5 text-brand-orange-600" />
          <h3 className="text-base font-bold text-brand-ink-900">{t.darkMode.title}</h3>
        </div>
        <button disabled className="rounded border border-brand-warm-400 px-4 py-1.5 text-xs font-medium text-brand-ink-300">
          {t.darkMode.placeholder}
        </button>
      </section>

      {/* 6. Audit Logs */}
      <section className="rounded-xl border border-brand-warm-400 bg-white p-5 shadow-card">
        <div className="flex items-center gap-2 mb-4">
          <ShieldCheck className="h-5 w-5 text-brand-orange-600" />
          <h3 className="text-base font-bold text-brand-ink-900">
            {locale === "zh" ? "审计日志" : "Journal d'audit"}
          </h3>
        </div>
        <p className="text-xs text-brand-ink-400 mb-3">
          {locale === "zh"
            ? "查看系统关键操作的变更历史：谁在什么时候创建、修改、删除了什么。仅管理员和老板可见。"
            : "Historique des operations cles : qui a fait quoi, quand et sur quel objet. Admin et proprietaire uniquement."
          }
        </p>
        <Link
          href={routeFor(locale, "/settings/audit-logs")}
          className="inline-flex items-center gap-1.5 rounded-lg bg-brand-ink-900 px-4 py-2 text-xs font-semibold text-white hover:bg-brand-ink-700 transition-colors"
        >
          <ShieldCheck className="h-3.5 w-3.5" />
          {locale === "zh" ? "查看审计日志" : "Voir le journal"}
        </Link>
      </section>
    </div>
  );
}
