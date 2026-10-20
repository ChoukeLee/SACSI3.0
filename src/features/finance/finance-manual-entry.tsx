"use client";

import { useEffect, useState } from "react";
import { Loader2, Plus } from "lucide-react";
import { RightDrawer } from "@/components/ui/operational";
import { Button } from "@/components/ui/button";
import { ManualEntryForm } from "./manual-entry-form";

type Building = { id: string; project_id: string; display_name: string; code: string };
type Unit = { id: string; building_id: string; unit_no: string };
type Options = {
  scope: { projectId: string | null; buildingId: string | null };
  buildings: Building[];
  units: Unit[];
};
type Props = {
  locale: "zh" | "fr";
  canWrite: boolean;
  projectId?: string;
  buildingId?: string;
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const validId = (value: unknown): value is string => typeof value === "string" && uuid.test(value);

function decodeOptions(
  value: unknown,
  projectId: string | null,
  buildingId: string | null,
): Options {
  if (!value || typeof value !== "object") throw new Error("invalidManualEntryOptions");
  const data = value as Options;
  if (
    !data.scope ||
    data.scope.projectId !== projectId ||
    data.scope.buildingId !== buildingId ||
    !Array.isArray(data.buildings) ||
    !Array.isArray(data.units) ||
    data.buildings.some(
      (building) =>
        !building ||
        !validId(building.id) ||
        !validId(building.project_id) ||
        typeof building.display_name !== "string" ||
        typeof building.code !== "string" ||
        (projectId && building.project_id !== projectId) ||
        (buildingId && building.id !== buildingId),
    ) ||
    new Set(data.buildings.map((building) => building.id)).size !== data.buildings.length ||
    (buildingId && data.buildings.length !== 1) ||
    (!buildingId && data.units.length !== 0) ||
    data.units.some(
      (unit) =>
        !unit ||
        !validId(unit.id) ||
        typeof unit.unit_no !== "string" ||
        unit.building_id !== buildingId,
    ) ||
    new Set(data.units.map((unit) => unit.id)).size !== data.units.length
  )
    throw new Error("invalidManualEntryOptions");
  return data;
}

/** No metadata request or manual-write control is mounted for a read-only viewer. */
export function FinanceManualEntry(props: Props) {
  if (!props.canWrite) return null;
  return (
    <ScopedManualEntry key={`${props.projectId ?? ""}:${props.buildingId ?? ""}`} {...props} />
  );
}

function ScopedManualEntry({ locale, projectId, buildingId }: Props) {
  const zh = locale === "zh";
  const text = (chinese: string, french: string) => (zh ? chinese : french);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [selectedBuilding, setSelectedBuilding] = useState(buildingId?.toLowerCase() ?? "");
  const [catalog, setCatalog] = useState<Building[]>([]);
  const [loaded, setLoaded] = useState<{ key: string; data: Options } | null>(null);
  const [error, setError] = useState<{ key: string; code: string } | null>(null);
  const [retry, setRetry] = useState(0);
  const scopedProjectId = projectId?.toLowerCase() ?? null;
  const scopedBuildingId = selectedBuilding || null;
  const search = new URLSearchParams();
  if (scopedProjectId) search.set("projectId", scopedProjectId);
  if (scopedBuildingId) search.set("buildingId", scopedBuildingId);
  const endpoint = `/api/finance/manual-options${search.size ? `?${search}` : ""}`;
  const key = `${endpoint}:${retry}`;
  const data = open && loaded?.key === key ? loaded.data : null;
  const currentError = error?.key === key ? error.code : null;
  const loading = open && !data && !currentError;

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    let active = true;
    async function load() {
      try {
        const response = await fetch(endpoint, {
          cache: "no-store",
          credentials: "same-origin",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`manualEntryOptions:${response.status}`);
        const result = decodeOptions(await response.json(), scopedProjectId, scopedBuildingId);
        if (!active || controller.signal.aborted) return;
        if (!scopedBuildingId || buildingId) setCatalog(result.buildings);
        setLoaded({ key, data: result });
      } catch (cause) {
        if (active && !controller.signal.aborted)
          setError({ key, code: cause instanceof Error ? cause.message : "manualEntryOptions" });
      }
    }
    void load();
    return () => {
      active = false;
      controller.abort();
    };
  }, [open, endpoint, key, scopedProjectId, scopedBuildingId, buildingId]);

  function close() {
    setOpen(false);
    setLoaded(null);
    setError(null);
    setCatalog([]);
    setSelectedBuilding(buildingId?.toLowerCase() ?? "");
  }

  return (
    <>
      <Button variant="outline" type="button" onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" aria-hidden="true" />
        {text("手工记账", "Écriture manuelle")}
      </Button>
      <RightDrawer
        open={open}
        onClose={() => {
          if (!saving) close();
        }}
        title={text("手工记账", "Écriture manuelle")}
        subtitle={text(
          "仅登记非业务收支；业务收款请回到相应合同或订单办理。",
          "Écritures hors encaissements métier ; utilisez le contrat ou la réservation pour ceux-ci.",
        )}
        width="wide"
      >
        {!buildingId && catalog.length > 0 && (
          <label className="mb-4 block space-y-2 text-sm">
            <span>{text("记账楼栋", "Bâtiment de l'écriture")}</span>
            <select
              className="w-full rounded-md border bg-background p-2"
              value={selectedBuilding}
              disabled={saving}
              onChange={(event) => {
                setSelectedBuilding(event.target.value);
                setLoaded(null);
                setError(null);
              }}
            >
              <option value="">{text("请先选择楼栋", "Choisissez un bâtiment")}</option>
              {catalog.map((building) => (
                <option key={building.id} value={building.id}>
                  {building.display_name || building.code}
                </option>
              ))}
            </select>
          </label>
        )}
        {loading && (
          <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            {text("读取授权楼栋与房源…", "Chargement des bâtiments et lots autorisés…")}
          </p>
        )}
        {currentError && (
          <div role="alert" className="space-y-3 rounded-lg border p-4 text-sm">
            <p>
              {currentError === "manualEntryOptions:403"
                ? text(
                    "当前账号无手工记账权限。",
                    "Ce compte ne peut pas créer d'écriture manuelle.",
                  )
                : currentError === "manualEntryOptions:404"
                  ? text("所选楼栋不在当前授权范围内。", "Bâtiment absent du périmètre autorisé.")
                  : text(
                      "记账选项暂时无法读取，请重试。未加载完成前不能提交。",
                      "Options indisponibles. Réessayez ; aucun enregistrement avant leur chargement.",
                    )}
            </p>
            <Button
              variant="outline"
              size="sm"
              type="button"
              onClick={() => setRetry((value) => value + 1)}
            >
              {text("重新读取", "Recharger")}
            </Button>
          </div>
        )}
        {data && !data.buildings.length && (
          <p role="status" className="text-sm text-muted-foreground">
            {text("当前没有可记账的授权楼栋。", "Aucun bâtiment autorisé pour cette écriture.")}
          </p>
        )}
        {data && !scopedBuildingId && data.buildings.length > 0 && (
          <p className="text-sm text-muted-foreground">
            {text(
              "选择楼栋后才读取该楼栋房源。",
              "Les lots sont chargés après sélection du bâtiment.",
            )}
          </p>
        )}
        {data && scopedBuildingId && (
          <ManualEntryForm
            key={key}
            buildings={data.buildings}
            units={data.units}
            zh={zh}
            buildingId={scopedBuildingId}
            showBuilding={!!buildingId}
            onPendingChange={setSaving}
            onSaved={close}
          />
        )}
      </RightDrawer>
    </>
  );
}
