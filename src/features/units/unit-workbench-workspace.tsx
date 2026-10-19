import { OperationalPageSkeleton } from "@/components/operational-page-skeleton";
import type { Locale } from "@/lib/i18n";
import { loadUnitWorkbench } from "./unit-workbench-service";
import type { UnitWorkbenchSearch } from "./unit-workbench-model";
import { UnitWorkbench } from "./unit-workbench";
import styles from "./unit-workbench.module.css";

export async function UnitWorkbenchWorkspace({
  input,
  locale,
  canEdit,
  viewerId,
}: {
  input: UnitWorkbenchSearch;
  locale: Locale;
  canEdit: boolean;
  viewerId: string;
}) {
  const data = await loadUnitWorkbench(input);
  const key = `${viewerId}:${JSON.stringify(data.query)}:${data.rows.map((row) => `${row.unit.id}:${row.unit.updated_at}`).join(",")}:${data.selected?.unit.updated_at ?? ""}`;
  return <UnitWorkbench key={key} data={data} locale={locale} canEdit={canEdit} />;
}

export function UnitWorkbenchSkeleton({ locale }: { locale: Locale }) {
  return (
    <div className={styles.workbench} aria-busy="true">
      <header className={styles.heading}>
        <div>
          <p className={styles.eyebrow}>ASSET DIRECTORY</p>
          <h1>{locale === "zh" ? "资产目录" : "Répertoire des actifs"}</h1>
          <p className={styles.subtitle}>
            {locale === "zh"
              ? "正在读取授权范围内的资产和独立状态维度…"
              : "Lecture des actifs et états du périmètre autorisé…"}
          </p>
        </div>
      </header>
      <OperationalPageSkeleton kind="records" rows={8} />
    </div>
  );
}
