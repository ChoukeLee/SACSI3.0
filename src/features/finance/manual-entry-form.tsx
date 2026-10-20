"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { addLedgerEntry } from "./actions";
import { runFinanceRequest } from "./finance-request";
import { directionDisplayLabel } from "@/lib/display-labels";

export function ManualEntryForm({
  buildings,
  units,
  zh,
  buildingId,
  showBuilding = true,
  onPendingChange,
  onSaved,
}: {
  buildings: { id: string; display_name: string; code: string }[];
  units: { id: string; building_id: string; unit_no: string }[];
  zh: boolean;
  buildingId?: string;
  showBuilding?: boolean;
  onPendingChange?: (pending: boolean) => void;
  onSaved?: () => void;
}) {
  const [selectedBuilding, setSelectedBuilding] = useState(buildings[0]?.id ?? "");
  const building = buildingId ?? selectedBuilding;
  const [unitId, setUnitId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const guard = useRef(false);
  const router = useRouter();
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (guard.current) return;
    guard.current = true;
    setBusy(true);
    onPendingChange?.(true);
    setError("");
    const form = event.currentTarget;
    const values = new FormData(form);
    const payload = {
      buildingId: building,
      unitId: String(values.get("unitId") || "") || undefined,
      entryDate: String(values.get("date")),
      direction: String(values.get("direction")) as
        "income" | "expense" | "liability_in" | "liability_out",
      category: String(values.get("category")),
      amount: Number(values.get("amount")),
      currency: "XOF" as const,
      exchangeRateToXof: 1,
      description: String(values.get("description")),
      receiptNo: String(values.get("receiptNo")) || undefined,
    };
    try {
      const result = await runFinanceRequest("manual_entry", building, payload, (requestId) =>
        addLedgerEntry({ ...payload, requestId }),
      );
      if (!result.success) setError(result.error ?? "Failed");
      else {
        form.reset();
        setUnitId("");
        router.refresh();
        onSaved?.();
      }
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Failed");
    } finally {
      guard.current = false;
      setBusy(false);
      onPendingChange?.(false);
    }
  }
  const input = "rounded-md border bg-background p-2 text-sm";
  return (
    <form
      aria-label={zh ? "非业务收支表单" : "Formulaire d’écriture hors métier"}
      onSubmit={submit}
      className="grid gap-4 sm:grid-cols-2"
    >
      {showBuilding &&
        (buildingId ? (
          <div className="text-sm">
            <p className="mb-1 text-muted-foreground">
              {zh ? "记账楼栋" : "Bâtiment de l’écriture"}
            </p>
            <p className="font-medium">
              {buildings.find((row) => row.id === building)?.display_name ||
                buildings.find((row) => row.id === building)?.code ||
                "—"}
            </p>
          </div>
        ) : (
          <label className="space-y-1 text-sm">
            {zh ? "楼栋" : "Bâtiment"}
            <select
              disabled={busy}
              value={building}
              onChange={(e) => {
                setSelectedBuilding(e.target.value);
                setUnitId("");
              }}
              className={`${input} w-full`}
            >
              {buildings.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.display_name || b.code}
                </option>
              ))}
            </select>
          </label>
        ))}
      <label className="space-y-1 text-sm">
        {zh ? "房号" : "Lot"}
        <select
          name="unitId"
          value={unitId}
          onChange={(event) => setUnitId(event.target.value)}
          className={`${input} w-full`}
          disabled={busy}
        >
          <option value="">—</option>
          {units
            .filter((u) => u.building_id === building)
            .map((u) => (
              <option key={u.id} value={u.id}>
                {u.unit_no}
              </option>
            ))}
        </select>
      </label>
      <label className="space-y-1 text-sm">
        {zh ? "日期" : "Date"}
        <input
          name="date"
          type="date"
          required
          defaultValue={new Date().toISOString().slice(0, 10)}
          className={`${input} w-full`}
          disabled={busy}
        />
      </label>
      <label className="space-y-1 text-sm">
        {zh ? "方向" : "Direction"}
        <select name="direction" className={`${input} w-full`} disabled={busy}>
          {["income", "expense", "liability_in", "liability_out"].map((v) => (
            <option key={v} value={v}>
              {directionDisplayLabel(v, zh ? "zh" : "fr")}
            </option>
          ))}
        </select>
      </label>
      <label className="space-y-1 text-sm">
        {zh ? "类别" : "Catégorie"}
        <input
          name="category"
          required
          defaultValue="other_income"
          maxLength={100}
          className={`${input} w-full`}
          disabled={busy}
        />
      </label>
      <label className="space-y-1 text-sm">
        {zh ? "金额 · XOF" : "Montant · XOF"}
        <input
          name="amount"
          type="number"
          min="0.01"
          step="0.01"
          required
          className={`${input} w-full`}
          disabled={busy}
        />
      </label>
      <label className="space-y-1 text-sm sm:col-span-2">
        {zh ? "说明" : "Description"}
        <input name="description" maxLength={500} className={`${input} w-full`} disabled={busy} />
      </label>
      <label className="space-y-1 text-sm sm:col-span-2">
        {zh ? "收据号（可选）" : "Reçu (facultatif)"}
        <input name="receiptNo" maxLength={100} className={`${input} w-full`} disabled={busy} />
      </label>
      <button
        type="submit"
        disabled={busy || !building}
        className="min-h-10 rounded-md bg-primary p-2 text-sm font-medium text-primary-foreground disabled:opacity-50 sm:col-span-2"
      >
        {busy ? "…" : zh ? "保存" : "Enregistrer"}
      </button>
      {error && (
        <p role="alert" className="text-sm text-red-600 sm:col-span-2">
          {error}
        </p>
      )}
    </form>
  );
}
