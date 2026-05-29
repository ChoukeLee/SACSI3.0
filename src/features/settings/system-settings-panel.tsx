"use client";

import { useState } from "react";
import { Save, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { updateSystemSetting } from "./settings-server";

interface Props { settings: Record<string, string>; isAdmin: boolean; locale: "zh" | "fr"; }

const CATEGORIES: Record<string, { labelZh: string; labelFr: string; keys: string[] }> = {
  general: { labelZh: "基础信息", labelFr: "Général", keys: ["company_name", "project_name", "default_currency"] },
  daily_rules: { labelZh: "日租规则", labelFr: "Règles jour", keys: ["default_daily_price", "open_checkout_alert_days"] },
  unit_rules: { labelZh: "房源类型", labelFr: "Types lots", keys: ["accommodation_unit_types"] },
  finance_rules: { labelZh: "财务规则", labelFr: "Règles finance", keys: ["overdue_grace_days"] },
  reminder_rules: { labelZh: "提醒规则", labelFr: "Rappels", keys: ["lease_expiry_warning_days", "receivable_overdue_warning_days"] },
  print_rules: { labelZh: "单据/打印", labelFr: "Impression", keys: ["receipt_number_prefix", "contract_prefix", "print_company_name", "print_footer_text"] },
};

export function SystemSettingsPanel({ settings, isAdmin, locale }: Props) {
  const zh = locale === "zh";
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
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Settings2 className="h-5 w-5 text-primary" />
          {zh ? "系统配置" : "Configuration"}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {msg && <p className="text-sm text-emerald-600 mb-3">{msg}</p>}
        <div className="space-y-4">
          {Object.entries(CATEGORIES).map(([cat, catDef]) => (
            <div key={cat}>
              <p className="text-xs font-semibold uppercase tracking-[0.04em] text-muted-foreground mb-2">{zh ? catDef.labelZh : catDef.labelFr}</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {catDef.keys.map(key => (
                  <div key={key} className="flex items-center justify-between rounded-md border bg-muted/30 px-3 py-2">
                    <span className="text-sm text-muted-foreground truncate mr-2">{key}</span>
                    {editing === key ? (
                      <div className="flex items-center gap-1">
                        <input value={editValue} onChange={e => setEditValue(e.target.value)}
                          className="w-24 sm:w-32 rounded-md border bg-card px-2 py-1 text-sm" />
                        <Button size="icon" variant="ghost" onClick={() => handleSave(key)} disabled={saving} className="h-7 w-7"><Save className="h-3 w-3" /></Button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold">{values[key] ?? "—"}</span>
                        {isAdmin && <button onClick={() => { setEditing(key); setEditValue(values[key] ?? ""); }}
                          className="text-sm text-primary hover:underline">{zh ? "编辑" : "Éditer"}</button>}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
