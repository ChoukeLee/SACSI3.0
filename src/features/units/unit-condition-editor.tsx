"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { RightDrawer } from "@/components/ui/operational";
import type { Locale } from "@/lib/i18n";
import type { UnitRow } from "@/types/database";
import { updateUnitStatus } from "./actions";
import { conditionLabel, type UnitPosition } from "./operational-position";

/** A focused operation, not a second asset dossier. Occupancy/ownership stay in business flows. */
export function UnitConditionEditor(props: {
  unit: UnitRow;
  position?: UnitPosition;
  buildingName: string;
  locale: Locale;
  canEdit: boolean;
  onClose: () => void;
  onStatusChanged: () => void;
}) {
  if (!props.canEdit) return null;
  return <ConditionForm key={`${props.unit.id}:${props.unit.updated_at}`} {...props} />;
}

function ConditionForm({
  unit,
  position,
  buildingName,
  locale,
  onClose,
  onStatusChanged,
}: React.ComponentProps<typeof UnitConditionEditor>) {
  const zh = locale === "zh";
  const current =
    position?.operational_condition ??
    unit.operational_condition ??
    (unit.status === "maintenance" || unit.status === "locked" ? unit.status : "normal");
  const [condition, setCondition] = useState<"normal" | "maintenance" | "locked" | "">(
    current === "normal" || current === "maintenance" || current === "locked" ? current : "",
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const guard = useRef(false);
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const unverified = unit.occupancy_verified === false || unit.construction_status === "unverified";
  const choices = [
    {
      value: "normal",
      label: zh ? "正常 / 解除维修或封锁" : "Normal / lever le blocage",
      note: zh
        ? "只恢复运行条件，不自动确认空置或可出租。"
        : "Ne confirme ni la vacance ni la disponibilité à louer.",
    },
    {
      value: "maintenance",
      label: zh ? "维修中" : "En maintenance",
      note: zh ? "标记资产需要维修。" : "Signaler un besoin de maintenance.",
    },
    {
      value: "locked",
      label: zh ? "封锁" : "Bloqué",
      note: zh
        ? "暂停资产使用，保留原有业务记录。"
        : "Suspendre l’utilisation sans modifier l’historique métier.",
    },
  ] as const;

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (guard.current || !condition || condition === current) return;
    guard.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await updateUnitStatus(
        unit.id,
        condition === "normal" ? "available" : condition,
        unit.updated_at,
      );
      if (!active.current) return;
      if (result.success) onStatusChanged();
      else
        setError(
          result.error ??
            (zh
              ? "修改未完成，请核对资产状态后重试。"
              : "Modification non terminée. Vérifiez l’état de l’actif."),
        );
    } catch {
      if (!active.current) return;
      setError(
        zh
          ? "结果尚未确认，请刷新核对运行条件后再试。"
          : "Résultat non confirmé. Actualisez et vérifiez l’état avant de réessayer.",
      );
    } finally {
      guard.current = false;
      if (active.current) setBusy(false);
    }
  }

  return (
    <RightDrawer
      open
      title={zh ? "修改运行条件" : "Modifier l’état opérationnel"}
      subtitle={`${buildingName} · ${unit.unit_no}`}
      onClose={() => {
        if (!guard.current) onClose();
      }}
      width="compact"
    >
      <form
        onSubmit={submit}
        className="space-y-5"
        aria-label={zh ? "运行条件表单" : "Formulaire d’état opérationnel"}
      >
        <div className="flex justify-between gap-4 border-b pb-4 text-sm">
          <span className="text-muted-foreground">{zh ? "当前运行条件" : "État actuel"}</span>
          <strong>{conditionLabel(current, locale)}</strong>
        </div>
        <p className="text-xs leading-6 text-muted-foreground">
          {zh
            ? "本操作不改变权属、入住、合同或保洁状态。系统会重新核验权限、占用及记录版本。"
            : "Sans changement de propriété, séjour, contrat ou nettoyage. Droits, occupation et version seront revérifiés."}
        </p>
        {unverified && (
          <p
            className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-6 text-amber-900"
            role="note"
          >
            {zh
              ? "建设和占用状态尚未核实。只有现场确认已可投入使用后，才能开放为可出租资产。"
              : "Construction et occupation à vérifier sur place avant toute ouverture à la location."}
          </p>
        )}
        <fieldset disabled={busy} className="space-y-2">
          <legend className="mb-3 text-sm font-medium">{zh ? "调整为" : "Nouvel état"}</legend>
          {choices.map((choice) => (
            <label
              key={choice.value}
              className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 has-[:checked]:border-blue-500 has-[:checked]:bg-blue-50/40 dark:has-[:checked]:bg-blue-950/30"
            >
              <input
                type="radio"
                name="condition"
                value={choice.value}
                checked={condition === choice.value}
                onChange={() => setCondition(choice.value)}
                className="mt-1"
              />
              <span className="min-w-0">
                <span className="block text-sm font-medium">{choice.label}</span>
                <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                  {choice.note}
                </span>
              </span>
            </label>
          ))}
        </fieldset>
        {error && (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2 border-t pt-4">
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            {zh ? "取消" : "Annuler"}
          </Button>
          <Button type="submit" disabled={busy || !condition || condition === current}>
            {busy ? (zh ? "保存中…" : "Enregistrement…") : zh ? "确认修改" : "Confirmer"}
          </Button>
        </div>
      </form>
    </RightDrawer>
  );
}
