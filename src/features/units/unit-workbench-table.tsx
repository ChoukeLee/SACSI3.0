"use client";

import { ArrowRight } from "lucide-react";
import type { Locale } from "@/lib/i18n";
import { dictionaries } from "@/lib/i18n";
import { cn, compareFloorLabels } from "@/lib/utils";
import { conditionLabel } from "./operational-position";
import {
  unitNeedsVerification,
  unitOccupancyText,
  type UnitWorkbenchRecord,
} from "./unit-workbench-model";
import styles from "./unit-workbench.module.css";

function attention(record: UnitWorkbenchRecord, locale: Locale) {
  const zh = locale === "zh",
    position = record.position;
  if (position?.daily_occupied && position.lease_occupied)
    return { label: zh ? "占用冲突" : "Occupation conflictuelle", critical: true };
  if (position?.operational_condition === "locked")
    return { label: conditionLabel("locked", locale), critical: true };
  if (position?.operational_condition === "maintenance")
    return { label: conditionLabel("maintenance", locale), critical: false };
  if (position?.cleaning_pending) return { label: zh ? "待保洁" : "À nettoyer", critical: false };
  if (unitNeedsVerification(record))
    return { label: zh ? "待核实" : "À vérifier", critical: false };
  return null;
}

/** Complete filtered assets are grouped by floor; ownership never substitutes for occupancy. */
export function UnitFloorIndex({
  rows,
  selectedId,
  locale,
  disabled = false,
  onSelect,
}: {
  rows: UnitWorkbenchRecord[];
  selectedId: string | null;
  locale: Locale;
  disabled?: boolean;
  onSelect: (record: UnitWorkbenchRecord) => void;
}) {
  const zh = locale === "zh",
    t = dictionaries[locale].units;
  const floorLabel = (record: UnitWorkbenchRecord) =>
    record.unit.floor_label?.trim() || (zh ? "楼层待登记" : "Étage à renseigner");
  const floors = [...new Set(rows.map(floorLabel))].sort(compareFloorLabels);
  return (
    <div className={styles.floorIndex} aria-label={zh ? "楼层资产" : "Actifs par étage"}>
      {floors.map((floor) => (
        <section className={styles.floorGroup} key={floor} aria-label={floor}>
          <header className={styles.floorHeading}>
            <h2>{floor}</h2>
            <span>
              {rows.filter((row) => floorLabel(row) === floor).length} {zh ? "项资产" : "actifs"}
            </span>
          </header>
          <div className={styles.assetCards}>
            {rows
              .filter((row) => floorLabel(row) === floor)
              .sort(
                (a, b) =>
                  a.unit.unit_no.localeCompare(b.unit.unit_no, undefined, { numeric: true }) ||
                  a.unit.id.localeCompare(b.unit.id),
              )
              .map((record) => {
                const { unit, position } = record,
                  warning = attention(record, locale);
                return (
                  <button
                    type="button"
                    key={unit.id}
                    data-unit-card-id={unit.id}
                    className={cn(
                      styles.assetCard,
                      warning && styles.attentionCard,
                      warning?.critical && styles.criticalCard,
                    )}
                    disabled={disabled}
                    aria-label={zh ? `查看资产 ${unit.unit_no}` : `Voir l’actif ${unit.unit_no}`}
                    aria-describedby={`asset-use-${unit.id}${warning ? ` asset-attention-${unit.id}` : ""}`}
                    aria-pressed={unit.id === selectedId}
                    data-occupied={!!position?.daily_occupied || !!position?.lease_occupied}
                    data-unknown={unitNeedsVerification(record)}
                    onClick={() => onSelect(record)}
                  >
                    <span className={styles.assetCardHeading}>
                      <strong>{unit.unit_no}</strong>
                      {position?.ownership === "sold" ? (
                        <small className={styles.soldMark}>{zh ? "已售" : "Vendu"}</small>
                      ) : null}
                    </span>
                    <span className={styles.assetType}>{t.kinds[unit.kind]}</span>
                    <span id={`asset-use-${unit.id}`} className={styles.assetUse}>
                      {unitOccupancyText(record, locale)}
                    </span>
                    <span className={styles.assetCardFooter}>
                      <span
                        id={`asset-attention-${unit.id}`}
                        className={
                          warning
                            ? cn(styles.attentionMark, warning.critical && styles.criticalMark)
                            : styles.detailHint
                        }
                      >
                        {warning?.label ?? (zh ? "查看详情" : "Voir les détails")}
                      </span>
                      <ArrowRight size={15} aria-hidden="true" />
                    </span>
                  </button>
                );
              })}
          </div>
        </section>
      ))}
    </div>
  );
}
