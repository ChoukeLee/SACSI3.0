"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RotateCw, ShieldCheck, Wrench } from "lucide-react";
import type { Locale } from "@/lib/i18n";
import type { UnitStatus } from "@/types/domain";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { runBusinessRepair, type BusinessRepairAction } from "./business-repair-actions";

interface Props {
  locale: Locale;
  userRole?: string;
}

const actions: { value: BusinessRepairAction; zh: string; fr: string; descriptionZh: string; descriptionFr: string }[] = [
  {
    value: "sync_daily_finance",
    zh: "同步日租账款",
    fr: "Synchroniser finance jour",
    descriptionZh: "修正最近日租订单的应收、已收和结算状态。",
    descriptionFr: "Recalcule les créances et paiements du dernier séjour.",
  },
  {
    value: "set_unit_status",
    zh: "手动修正房态",
    fr: "Corriger le statut",
    descriptionZh: "把房间改为可预订、待保洁、维修等状态。",
    descriptionFr: "Change le statut du logement.",
  },
  {
    value: "create_cleaning_task",
    zh: "补建清洁任务",
    fr: "Créer tâche ménage",
    descriptionZh: "退房后漏生成清洁任务时使用，并把房间改为待保洁。",
    descriptionFr: "Crée une tâche ménage manquante.",
  },
  {
    value: "undo_check_in",
    zh: "撤销误入住",
    fr: "Annuler arrivée erronée",
    descriptionZh: "客人实际没来住时，把入住中订单回退为已确认。",
    descriptionFr: "Repasse une arrivée erronée en confirmé.",
  },
];

const statuses: { value: UnitStatus; zh: string; fr: string }[] = [
  { value: "available", zh: "可预订", fr: "Disponible" },
  { value: "reserved", zh: "预订", fr: "Réservé" },
  { value: "daily_occupied", zh: "日租中", fr: "Occupé jour" },
  { value: "cleaning_pending", zh: "待保洁", fr: "Ménage" },
  { value: "maintenance", zh: "维修", fr: "Maintenance" },
  { value: "locked", zh: "锁定", fr: "Bloqué" },
];

export function BusinessRepairCenter({ locale, userRole }: Props) {
  const zh = locale === "zh";
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [unitNo, setUnitNo] = useState("");
  const [action, setAction] = useState<BusinessRepairAction>("sync_daily_finance");
  const [targetStatus, setTargetStatus] = useState<UnitStatus>("cleaning_pending");
  const [note, setNote] = useState("");
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const isAdmin = userRole === "admin";

  const selectedAction = actions.find((item) => item.value === action) ?? actions[0];

  const submit = () => {
    setMessage(null);
    startTransition(async () => {
      const result = await runBusinessRepair({
        action,
        unitNo,
        targetStatus: action === "set_unit_status" ? targetStatus : undefined,
        note: note.trim() || undefined,
      });
      setMessage({ tone: result.success ? "ok" : "error", text: result.message });
      if (result.success) router.refresh();
    });
  };

  return (
    <section className="rounded-2xl border bg-card shadow-sm">
      <div className="flex flex-col gap-3 border-b px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-start gap-3">
          <div className="rounded-xl bg-primary/10 p-2 text-primary">
            <Wrench className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-base font-bold">{zh ? "业务修正中心" : "Centre de correction"}</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {zh ? "把高频运营纠错从代码和数据库操作中拿出来，所有动作都会写入审计日志。" : "Corriger les cas opérationnels fréquents avec audit."}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 rounded-full bg-muted px-3 py-1.5 text-xs font-semibold text-muted-foreground">
          <ShieldCheck className="h-3.5 w-3.5" />
          {zh ? "仅管理员可执行" : "Admin uniquement"}
        </div>
      </div>

      <div className="grid gap-4 px-5 py-5 xl:grid-cols-[1.2fr_1fr]">
        <div className="grid gap-3 md:grid-cols-[160px_220px_1fr]">
          <label className="space-y-1.5">
            <span className="text-xs font-semibold text-muted-foreground">{zh ? "房号" : "Chambre"}</span>
            <input
              value={unitNo}
              onChange={(e) => setUnitNo(e.target.value)}
              placeholder={zh ? "例如 1201" : "ex. 1201"}
              className="h-10 w-full rounded-lg border bg-background px-3 text-sm shadow-sm outline-none transition focus:ring-2 focus:ring-ring/20"
            />
          </label>

          <label className="space-y-1.5">
            <span className="text-xs font-semibold text-muted-foreground">{zh ? "修正动作" : "Action"}</span>
            <select
              value={action}
              onChange={(e) => setAction(e.target.value as BusinessRepairAction)}
              className="h-10 w-full rounded-lg border bg-background px-3 text-sm shadow-sm outline-none transition focus:ring-2 focus:ring-ring/20"
            >
              {actions.map((item) => (
                <option key={item.value} value={item.value}>{zh ? item.zh : item.fr}</option>
              ))}
            </select>
          </label>

          {action === "set_unit_status" ? (
            <label className="space-y-1.5">
              <span className="text-xs font-semibold text-muted-foreground">{zh ? "目标房态" : "Statut cible"}</span>
              <select
                value={targetStatus}
                onChange={(e) => setTargetStatus(e.target.value as UnitStatus)}
                className="h-10 w-full rounded-lg border bg-background px-3 text-sm shadow-sm outline-none transition focus:ring-2 focus:ring-ring/20"
              >
                {statuses.map((item) => (
                  <option key={item.value} value={item.value}>{zh ? item.zh : item.fr}</option>
                ))}
              </select>
            </label>
          ) : (
            <label className="space-y-1.5">
              <span className="text-xs font-semibold text-muted-foreground">{zh ? "备注" : "Note"}</span>
              <input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder={zh ? "可选，说明为什么修正" : "Optionnel"}
                className="h-10 w-full rounded-lg border bg-background px-3 text-sm shadow-sm outline-none transition focus:ring-2 focus:ring-ring/20"
              />
            </label>
          )}
        </div>

        <div className="flex flex-col gap-3 rounded-xl bg-muted/40 p-4">
          <div>
            <p className="text-sm font-bold">{zh ? selectedAction.zh : selectedAction.fr}</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              {zh ? selectedAction.descriptionZh : selectedAction.descriptionFr}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={submit} disabled={!isAdmin || isPending || !unitNo.trim()}>
              {isPending ? <RotateCw className="h-4 w-4 animate-spin" /> : <Wrench className="h-4 w-4" />}
              {zh ? "执行修正" : "Exécuter"}
            </Button>
            {message && (
              <span className={cn("text-sm font-semibold", message.tone === "ok" ? "text-emerald-700" : "text-red-600")}>
                {message.text}
              </span>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
