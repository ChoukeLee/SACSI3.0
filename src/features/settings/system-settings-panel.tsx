"use client";

import { useState } from "react";
import { Save, Settings2 } from "lucide-react";
import { updateSystemSetting } from "./settings-server";

interface Props { settings: Record<string, string>; isAdmin: boolean; locale: "zh" | "fr"; }

const CATEGORIES: Record<string, { labelZh: string; labelFr: string; keys: string[] }> = {
  general: { labelZh: "基础信息", labelFr: "General", keys: ["company_name", "project_name", "default_currency"] },
  daily_rules: { labelZh: "日租规则", labelFr: "Regles jour", keys: ["default_daily_price", "open_checkout_alert_days"] },
  unit_rules: { labelZh: "房源类型", labelFr: "Types lots", keys: ["accommodation_unit_types"] },
  finance_rules: { labelZh: "财务规则", labelFr: "Regles finance", keys: ["overdue_grace_days"] },
  reminder_rules: { labelZh: "提醒规则", labelFr: "Rappels", keys: ["lease_expiry_warning_days", "receivable_overdue_warning_days"] },
  print_rules: { labelZh: "单据/打印", labelFr: "Impression", keys: ["receipt_number_prefix", "contract_prefix", "print_company_name", "print_footer_text"] },
};

export function SystemSettingsPanel({ settings, isAdmin, locale }: Props) {
  const [values, setValues] = useState<Record<string, string>>(settings);
  const [editing, setEditing] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  const handleSave = async (key: string) => {
    setSaving(true); setMsg("");
    const result = await updateSystemSetting(key, editValue);
    if (result.success) { setValues(v => ({ ...v, [key]: editValue })); setEditing(null); }
    else setMsg(result.error ?? "Failed");
    setSaving(false);
  };

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-natural">
      <div className="flex items-center gap-2 mb-4">
        <Settings2 className="h-5 w-5 text-brand-orange-600" />
        <h3 className="text-sm font-black text-slate-950">{locale === "zh" ? "系统配置" : "Configuration"}</h3>
      </div>
      {msg && <p className="text-xs text-brand-green-600 mb-2">{msg}</p>}
      <div className="space-y-4">
        {Object.entries(CATEGORIES).map(([cat, catDef]) => (
          <div key={cat}>
            <p className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-500 mb-2">{locale === "zh" ? catDef.labelZh : catDef.labelFr}</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {catDef.keys.map(key => (
                <div key={key} className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                  <span className="text-xs text-slate-700 truncate mr-2">{key}</span>
                  {editing === key ? (
                    <div className="flex items-center gap-1">
                      <input value={editValue} onChange={e => setEditValue(e.target.value)}
                        className="w-24 sm:w-32 rounded-xl border border-slate-200 bg-white px-2 py-0.5 text-xs" />
                      <button onClick={() => handleSave(key)} disabled={saving}
                        className="rounded-xl bg-slate-950 p-1.5 text-white shadow-sm hover:bg-slate-800"><Save className="h-3 w-3" /></button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-slate-900">{values[key] ?? "—"}</span>
                      {isAdmin && <button onClick={() => { setEditing(key); setEditValue(values[key] ?? ""); }}
                        className="text-[10px] text-brand-orange-600 hover:underline">{locale === "zh" ? "编辑" : "Edit"}</button>}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
