"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { addLedgerEntry } from "./actions";
import { runFinanceRequest } from "./finance-request";

export function ManualEntryForm({
  buildings,
  units,
  zh,
}: {
  buildings: { id: string; display_name: string; code: string }[];
  units: { id: string; building_id: string; unit_no: string }[];
  zh: boolean;
}) {
  const [building, setBuilding] = useState(buildings[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const guard = useRef(false);
  const router = useRouter();
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (guard.current) return;
    guard.current = true;
    setBusy(true);
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
        router.refresh();
      }
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Failed");
    } finally {
      guard.current = false;
      setBusy(false);
    }
  }
  const input = "rounded-md border bg-background p-2 text-sm";
  return (
    <details className="rounded-xl border bg-card p-4">
      <summary className="cursor-pointer font-medium">
        {zh ? "手工记账（非业务收款请使用此处）" : "Écriture manuelle"}
      </summary>
      <form onSubmit={submit} className="mt-4 grid gap-3 sm:grid-cols-3">
        <label>
          {zh ? "楼栋" : "Bâtiment"}
          <select
            disabled={busy}
            value={building}
            onChange={(e) => setBuilding(e.target.value)}
            className={`${input} w-full`}
          >
            {buildings.map((b) => (
              <option key={b.id} value={b.id}>
                {b.display_name || b.code}
              </option>
            ))}
          </select>
        </label>
        <label>
          {zh ? "房号" : "Lot"}
          <select name="unitId" className={`${input} w-full`} disabled={busy}>
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
        <label>
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
        <label>
          {zh ? "方向" : "Direction"}
          <select name="direction" className={`${input} w-full`} disabled={busy}>
            {["income", "expense", "liability_in", "liability_out"].map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
        </label>
        <label>
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
        <label>
          XOF
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
        <label>
          {zh ? "说明" : "Description"}
          <input name="description" maxLength={500} className={`${input} w-full`} disabled={busy} />
        </label>
        <label>
          {zh ? "收据号（可选）" : "Reçu (facultatif)"}
          <input name="receiptNo" maxLength={100} className={`${input} w-full`} disabled={busy} />
        </label>
        <button
          disabled={busy || !building}
          className="rounded-md bg-primary p-2 text-primary-foreground"
        >
          {busy ? "…" : zh ? "保存" : "Enregistrer"}
        </button>
        {error && (
          <p role="alert" className="text-red-600 sm:col-span-3">
            {error}
          </p>
        )}
      </form>
    </details>
  );
}
