"use client";

import type { Locale } from "@/lib/i18n";
import { dictionaries } from "@/lib/i18n";
import { cn, compareFloorLabels } from "@/lib/utils";
import { conditionLabel } from "./operational-position";
import {
  constructionLabel,
  unitNeedsVerification,
  unitOccupancyText,
  type UnitWorkbenchRecord,
} from "./unit-workbench-model";
import styles from "./unit-workbench.module.css";

export function UnitWorkbenchRow({
  record,
  locale,
  selected,
  onSelect,
  allowsSale,
}: {
  record: UnitWorkbenchRecord;
  locale: Locale;
  selected: boolean;
  onSelect: () => void;
  allowsSale: boolean;
}) {
  const zh = locale === "zh";
  const { unit, position } = record;
  const t = dictionaries[locale].units;
  const enabled = record.flags.filter(
    (flag) => flag.is_enabled && (allowsSale || flag.business_type !== "sale"),
  );
  const occupied = !!position?.daily_occupied || !!position?.lease_occupied;
  return (
    <tr data-selected={selected}>
      <td data-label={zh ? "资产 / 业务" : "Actif / activité"}>
        <button
          className={styles.record}
          type="button"
          aria-label={zh ? `查看资产 ${unit.unit_no}` : `Voir l’actif ${unit.unit_no}`}
          aria-pressed={selected}
          onClick={onSelect}
        >
          {unit.unit_no}
        </button>
        <span className={styles.sub}>
          {t.kinds[unit.kind]} · {unit.floor_label}
        </span>
        <span className={styles.sub}>
          {unit.area_sqm == null
            ? zh
              ? "面积待核"
              : "Surface à vérifier"
            : `${Number(unit.area_sqm)} m²`}
        </span>
        <span className={styles.sub}>
          {!record.flags.length ||
          (!allowsSale &&
            record.flags.some((flag) => flag.business_type === "sale" && flag.is_enabled))
            ? zh
              ? "业务配置待核对"
              : "Configuration à vérifier"
            : enabled.length
              ? enabled.map((flag) => t.businessTypes[flag.business_type]).join(" · ")
              : zh
                ? "业务未启用"
                : "Activités désactivées"}
        </span>
      </td>
      <td data-label={zh ? "权属" : "Propriété"}>
        <span className={cn(styles.badge, position?.ownership !== "sold" && styles.warn)}>
          {position?.ownership === "sold"
            ? zh
              ? "已售"
              : "Vendu"
            : zh
              ? "权属未明确"
              : "Non précisée"}
        </span>
      </td>
      <td data-label={zh ? "实际占用" : "Occupation"}>
        <span
          className={cn(
            styles.badge,
            occupied
              ? styles.occupied
              : unitNeedsVerification(record) || position?.lease_pending
                ? styles.warn
                : undefined,
          )}
        >
          {unitOccupancyText(record, locale)}
        </span>
      </td>
      <td data-label={zh ? "运行条件" : "État"}>
        <span
          className={cn(styles.badge, position?.operational_condition !== "normal" && styles.warn)}
        >
          {conditionLabel(position?.operational_condition, locale)}
        </span>
        <span className={styles.sub}>{constructionLabel(unit.construction_status, locale)}</span>
        {position?.cleaning_pending ? (
          <span className={cn(styles.sub, styles.warn)}>{zh ? "待保洁" : "À nettoyer"}</span>
        ) : null}
      </td>
    </tr>
  );
}

export function UnitFloorIndex({
  rows,
  selectedId,
  locale,
  onSelect,
}: {
  rows: UnitWorkbenchRecord[];
  selectedId: string | null;
  locale: Locale;
  onSelect: (record: UnitWorkbenchRecord) => void;
}) {
  const zh = locale === "zh";
  const floors = [...new Set(rows.map((row) => row.unit.floor_label))].sort(compareFloorLabels);
  return (
    <div className={styles.floorIndex}>
      <p className={styles.note}>
        {zh
          ? "楼层索引 · 仅当前分页，房号排列不表示真实空间位置。"
          : "Index des étages · page actuelle, pas la position physique des locaux."}
      </p>
      {floors.map((floor) => (
        <div className={styles.floorRow} key={floor}>
          <span className={styles.floorLabel}>{floor}</span>
          <div className={styles.rooms}>
            {rows
              .filter((row) => row.unit.floor_label === floor)
              .map((record) => (
                <button
                  type="button"
                  key={record.unit.id}
                  className={styles.room}
                  data-occupied={
                    !!record.position?.daily_occupied || !!record.position?.lease_occupied
                  }
                  data-unknown={unitNeedsVerification(record)}
                  aria-pressed={record.unit.id === selectedId}
                  aria-label={`${record.unit.unit_no} · ${unitOccupancyText(record, locale)} · ${conditionLabel(record.position?.operational_condition, locale)}`}
                  onClick={() => onSelect(record)}
                >
                  {record.unit.unit_no}
                </button>
              ))}
          </div>
        </div>
      ))}
    </div>
  );
}
