"use client";

import { useMemo, useState, useTransition } from "react";
import { Check, RotateCw, Save, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { updateSystemSetting } from "./settings-server";

interface Props {
  settings: Record<string, string>;
  isAdmin: boolean;
  locale: "zh" | "fr";
}

type FieldType = "text" | "number" | "boolean" | "select";

interface SettingDef {
  key: string;
  type: FieldType;
  zh: string;
  fr: string;
  descriptionZh: string;
  descriptionFr: string;
  placeholder?: string;
  options?: { value: string; zh: string; fr: string }[];
}

interface SettingGroup {
  key: string;
  zh: string;
  fr: string;
  descriptionZh: string;
  descriptionFr: string;
  fields: SettingDef[];
}

const unitStatusOptions = [
  { value: "available", zh: "可预订", fr: "Disponible" },
  { value: "reserved", zh: "预订", fr: "Réservé" },
  { value: "daily_occupied", zh: "日租中", fr: "Occupé jour" },
  { value: "cleaning_pending", zh: "待保洁", fr: "Ménage" },
  { value: "maintenance", zh: "维修", fr: "Maintenance" },
  { value: "locked", zh: "锁定", fr: "Bloqué" },
];

const GROUPS: SettingGroup[] = [
  {
    key: "daily_rules",
    zh: "日租规则",
    fr: "Règles jour",
    descriptionZh: "控制日租业务里最常变化的默认规则。",
    descriptionFr: "Règles par défaut pour la location journalière.",
    fields: [
      {
        key: "default_daily_price",
        type: "number",
        zh: "默认日租价",
        fr: "Prix journalier par défaut",
        descriptionZh: "新建日租时，如果房间没有单独价格，默认使用此金额。",
        descriptionFr: "Prix utilisé si le logement n'a pas de tarif dédié.",
        placeholder: "40000",
      },
      {
        key: "open_checkout_alert_days",
        type: "number",
        zh: "开放入住提醒天数",
        fr: "Alerte séjour ouvert",
        descriptionZh: "开放式入住超过多少天后提醒管理员复核。",
        descriptionFr: "Nombre de jours avant alerte pour séjour ouvert.",
        placeholder: "3",
      },
      {
        key: "checkout_default_unit_status",
        type: "select",
        zh: "退房后的默认房态",
        fr: "Statut après départ",
        descriptionZh: "日租退房后，房间默认进入哪个状态。",
        descriptionFr: "Statut appliqué après un départ journalier.",
        options: unitStatusOptions,
      },
      {
        key: "undo_checkin_target_status",
        type: "select",
        zh: "撤销误入住后的房态",
        fr: "Statut après annulation arrivée",
        descriptionZh: "误点入住后回退时，房间默认改成哪个状态。",
        descriptionFr: "Statut après correction d'une arrivée erronée.",
        options: unitStatusOptions,
      },
    ],
  },
  {
    key: "finance_rules",
    zh: "财务规则",
    fr: "Règles finance",
    descriptionZh: "控制应收、欠款和流水的通用规则。",
    descriptionFr: "Règles pour créances, dettes et journal.",
    fields: [
      {
        key: "overdue_grace_days",
        type: "number",
        zh: "逾期宽限天数",
        fr: "Délai de grâce",
        descriptionZh: "应收超过到期日多少天后算逾期。",
        descriptionFr: "Jours avant de considérer une créance en retard.",
        placeholder: "0",
      },
      {
        key: "receivable_auto_sync",
        type: "boolean",
        zh: "自动同步应收",
        fr: "Synchronisation automatique",
        descriptionZh: "订单金额变化后，是否自动同步对应应收。",
        descriptionFr: "Synchroniser les créances quand le montant change.",
      },
      {
        key: "ledger_description_style",
        type: "select",
        zh: "流水说明格式",
        fr: "Format du libellé",
        descriptionZh: "财务流水说明是否显示简洁业务文本。",
        descriptionFr: "Style du libellé dans le journal financier.",
        options: [
          { value: "compact", zh: "简洁", fr: "Compact" },
          { value: "detailed", zh: "详细", fr: "Détaillé" },
        ],
      },
    ],
  },
  {
    key: "print_rules",
    zh: "单据与打印",
    fr: "Documents et impression",
    descriptionZh: "控制收据、合同和打印抬头。",
    descriptionFr: "Préfixes et textes d'impression.",
    fields: [
      {
        key: "receipt_number_prefix",
        type: "text",
        zh: "收据编号前缀",
        fr: "Préfixe reçu",
        descriptionZh: "系统生成电子收据编号时使用的前缀。",
        descriptionFr: "Préfixe des reçus générés.",
        placeholder: "ZH",
      },
      {
        key: "contract_prefix",
        type: "text",
        zh: "合同编号前缀",
        fr: "Préfixe contrat",
        descriptionZh: "新合同编号默认前缀。",
        descriptionFr: "Préfixe par défaut des contrats.",
        placeholder: "SACSI",
      },
      {
        key: "print_company_name",
        type: "text",
        zh: "打印公司名称",
        fr: "Nom société imprimé",
        descriptionZh: "打印收据和单据时显示的公司名称。",
        descriptionFr: "Nom affiché sur les documents imprimés.",
        placeholder: "科建地产",
      },
      {
        key: "print_footer_text",
        type: "text",
        zh: "打印页脚",
        fr: "Pied de page",
        descriptionZh: "打印单据底部显示的文字。",
        descriptionFr: "Texte en bas des documents.",
      },
    ],
  },
  {
    key: "reminder_rules",
    zh: "提醒规则",
    fr: "Rappels",
    descriptionZh: "控制合同、应收和待办提醒。",
    descriptionFr: "Règles pour les rappels.",
    fields: [
      {
        key: "lease_expiry_warning_days",
        type: "number",
        zh: "长租到期提前提醒",
        fr: "Alerte fin de bail",
        descriptionZh: "长租合同到期前多少天提醒。",
        descriptionFr: "Jours avant la fin du bail.",
        placeholder: "30",
      },
      {
        key: "receivable_overdue_warning_days",
        type: "number",
        zh: "应收逾期提醒",
        fr: "Alerte créance",
        descriptionZh: "应收逾期多少天后提醒。",
        descriptionFr: "Jours avant alerte d'impayé.",
        placeholder: "1",
      },
    ],
  },
];

export function SystemSettingsPanel({ settings, isAdmin, locale }: Props) {
  const zh = locale === "zh";
  const [values, setValues] = useState<Record<string, string>>(settings);
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [savedKey, setSavedKey] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();

  const allFields = useMemo(() => GROUPS.flatMap((group) => group.fields), []);

  const save = (field: SettingDef) => {
    setError("");
    setSavedKey(null);
    setPendingKey(field.key);
    startTransition(async () => {
      const rawValue = values[field.key] ?? "";
      const nextValue =
        field.type === "number" ? Number(rawValue || 0)
        : field.type === "boolean" ? rawValue === "true"
        : rawValue;

      const result = await updateSystemSetting(field.key, nextValue);
      setPendingKey(null);
      if (!result.success) {
        setError(result.error ?? (zh ? "保存失败。" : "Échec de l'enregistrement."));
        return;
      }
      setSavedKey(field.key);
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Settings2 className="h-5 w-5 text-primary" />
          {zh ? "业务规则配置" : "Configuration métier"}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <p className="text-sm text-muted-foreground">
          {zh
            ? "把经常变化的业务规则放在这里调整。代码负责底层一致性，规则负责日常运营口径。"
            : "Les règles variables sont configurées ici; le code garde la cohérence de base."}
        </p>

        {error && <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">{error}</p>}

        {GROUPS.map((group) => (
          <section key={group.key} className="rounded-xl border bg-background/40">
            <div className="border-b px-4 py-3">
              <h3 className="text-sm font-medium">{zh ? group.zh : group.fr}</h3>
              <p className="mt-1 text-xs text-muted-foreground">{zh ? group.descriptionZh : group.descriptionFr}</p>
            </div>
            <div className="grid gap-3 p-4 lg:grid-cols-2">
              {group.fields.map((field) => (
                <div key={field.key} className="rounded-lg border bg-card p-3 shadow-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{zh ? field.zh : field.fr}</p>
                      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                        {zh ? field.descriptionZh : field.descriptionFr}
                      </p>
                    </div>
                    <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                      {field.key}
                    </span>
                  </div>

                  <div className="mt-3 flex items-center gap-2">
                    <SettingInput
                      field={field}
                      value={values[field.key] ?? defaultValueFor(field)}
                      disabled={!isAdmin || pendingKey === field.key}
                      locale={locale}
                      onChange={(value) => setValues((prev) => ({ ...prev, [field.key]: value }))}
                    />
                    {isAdmin && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => save(field)}
                        disabled={isPending || pendingKey === field.key}
                        className="shrink-0"
                      >
                        {pendingKey === field.key ? <RotateCw className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                        {zh ? "保存" : "Enregistrer"}
                      </Button>
                    )}
                    {savedKey === field.key && (
                      <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700">
                        <Check className="h-3.5 w-3.5" />
                        {zh ? "已保存" : "Sauvé"}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))}

        <p className="text-xs text-muted-foreground">
          {zh
            ? `当前显示 ${allFields.length} 项规则。后续新增业务口径时，优先加到这里，而不是直接写死在页面里。`
            : `${allFields.length} règles affichées. Les nouvelles règles métier seront ajoutées ici en priorité.`}
        </p>
      </CardContent>
    </Card>
  );
}

function SettingInput({
  field,
  value,
  disabled,
  locale,
  onChange,
}: {
  field: SettingDef;
  value: string;
  disabled: boolean;
  locale: "zh" | "fr";
  onChange: (value: string) => void;
}) {
  const baseClass = "h-9 min-w-0 flex-1 rounded-md border bg-background px-3 text-sm shadow-sm outline-none transition focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/20 disabled:cursor-not-allowed disabled:opacity-60";

  if (field.type === "select") {
    return (
      <select value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} className={baseClass}>
        {(field.options ?? []).map((option) => (
          <option key={option.value} value={option.value}>
            {locale === "zh" ? option.zh : option.fr}
          </option>
        ))}
      </select>
    );
  }

  if (field.type === "boolean") {
    return (
      <select value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} className={baseClass}>
        <option value="true">{locale === "zh" ? "开启" : "Activé"}</option>
        <option value="false">{locale === "zh" ? "关闭" : "Désactivé"}</option>
      </select>
    );
  }

  return (
    <input
      type={field.type === "number" ? "number" : "text"}
      value={value}
      disabled={disabled}
      placeholder={field.placeholder}
      onChange={(e) => onChange(e.target.value)}
      className={cn(baseClass, field.type === "number" && "max-w-[180px]")}
    />
  );
}

function defaultValueFor(field: SettingDef) {
  if (field.type === "boolean") return "true";
  if (field.type === "select") return field.options?.[0]?.value ?? "";
  return "";
}
