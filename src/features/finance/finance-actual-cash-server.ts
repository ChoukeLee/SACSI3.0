import "server-only";
import { cache } from "react";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { fetchAllPages } from "@/lib/supabase/fetch-all";
import type { PaymentRow } from "@/types/database";
import { fetchAssetOperations } from "@/features/asset-operations/asset-operations-server";
import { buildOperatingAssetDirectory } from "@/features/asset-operations/operating-asset-directory-model";
import { parseFinanceRead } from "./finance-read";
import { buildFinanceActualCash, type ActualCashAssetLink } from "./finance-actual-cash-model";
import type { FinanceReadResult } from "./finance-read";

export interface FinanceActualCashScope {
  projectId: string;
  dateFrom: string;
  dateTo: string;
  buildingId?: string;
}

type RawCashLedger = FinanceReadResult["rows"][number] & {
  payment?: PaymentRow | null;
  building?: { id: string; display_name: string; project_id: string } | null;
  unit?: {
    id: string;
    unit_no: string;
    building_id: string;
    building?: { id: string; display_name: string; project_id: string };
  } | null;
};
const paymentColumns =
  "id,unit_id,customer_id,source_type,source_id,payment_date,amount,currency,exchange_rate_to_xof,native_settlement,payment_method,reversal_of_payment_id,request_kind,receipt_no,notes,created_at";
const ledgerColumns =
  "id,payment_id,building_id,unit_id,entry_date,direction,category,amount_xof,currency,amount_native,description";

const read = cache(
  async (projectId: string, dateFrom: string, dateTo: string, buildingId?: string) => {
    await requireRole("admin", "boss", "finance");
    const client = await createClient();
    const project = await client.from("projects").select("id,code").eq("id", projectId).single();
    if (project.error || project.data?.code !== "SACSI")
      throw new Error("ActualCashScopeUnavailable");
    parseFinanceRead({ projectId, dateFrom, dateTo, buildingId, kind: "ledger" });
    if (buildingId) {
      const building = await client
        .from("buildings")
        .select("id,project_id")
        .eq("id", buildingId)
        .single();
      if (building.error || building.data?.project_id !== projectId)
        throw new Error("ActualCashScopeUnavailable");
    }
    const readLedger = (unitOnly: boolean, standalone: boolean) =>
      fetchAllPages<RawCashLedger>((from, to) => {
        const scope = unitOnly
          ? "unit:units!inner(id,unit_no,building_id,building:buildings!inner(id,display_name,project_id))"
          : "building:buildings!inner(id,display_name,project_id),unit:units(id,unit_no,building_id)";
        let request = client
          .from("ledger_entries")
          .select(
            `${ledgerColumns},${scope}${standalone ? "" : `,payment:payments!inner(${paymentColumns})`}`,
          )
          .eq(unitOnly ? "unit.building.project_id" : "building.project_id", projectId);
        if (unitOnly) request = request.is("building_id", null);
        request = standalone
          ? request.is("payment_id", null).gte("entry_date", dateFrom).lte("entry_date", dateTo)
          : request.gte("payment.payment_date", dateFrom).lte("payment.payment_date", dateTo);
        return request
          .order("id")
          .range(from, to)
          .overrideTypes<RawCashLedger[], { merge: false }>();
      }, "actual cash project ledger evidence");
    const batches = await Promise.all([
      readLedger(false, false),
      readLedger(true, false),
      readLedger(false, true),
      readLedger(true, true),
    ]);
    const allRows = batches.flat();
    if (allRows.length > 20_000 || new Set(allRows.map((row) => row.id)).size !== allRows.length)
      throw new Error("ActualCashRangeTooLarge");
    const ledger = allRows.map((row) => {
      const building = row.building ?? row.unit?.building;
      if (!building || building.project_id !== projectId || !row.id)
        throw new Error("ActualCashScopeUnavailable");
      return {
        id: row.id,
        payment_id: row.payment_id,
        building_id: row.building_id,
        unit_id: row.unit_id,
        entry_date: row.entry_date,
        direction: row.direction,
        category: row.category,
        amount_xof: row.amount_xof,
        currency: row.currency,
        amount_native: row.amount_native,
        description: row.description,
        effective_building_id: building.id,
        building_label: building.display_name,
        unit_label: row.unit?.unit_no ?? null,
      };
    });
    const paymentMap = new Map<string, PaymentRow>();
    for (const row of allRows) {
      if (!row.payment) continue;
      if (row.payment.id !== row.payment_id) throw new Error("ActualCashReadUnavailable");
      const previous = paymentMap.get(row.payment.id);
      if (previous && JSON.stringify(previous) !== JSON.stringify(row.payment))
        throw new Error("ActualCashSnapshotChanged");
      paymentMap.set(row.payment.id, row.payment);
    }
    const paymentIds = [...paymentMap.keys()];
    const reversedPaymentIds: string[] = [];
    for (let offset = 0; offset < paymentIds.length; offset += 100) {
      const reversals = await fetchAllPages<{ id: string; reversal_of_payment_id: string }>(
        (from, to) =>
          client
            .from("payments")
            .select("id,reversal_of_payment_id")
            .in("reversal_of_payment_id", paymentIds.slice(offset, offset + 100))
            .order("id")
            .range(from, to),
        "actual cash reversal evidence",
      );
      reversedPaymentIds.push(...reversals.map((row) => row.reversal_of_payment_id));
    }
    // A building view never allocates a cross-building group by guesswork.
    const paymentBuildings = new Map<string, Set<string>>();
    for (const row of ledger)
      if (typeof row.payment_id === "string") {
        const ids = paymentBuildings.get(row.payment_id) ?? new Set<string>();
        ids.add(row.effective_building_id);
        paymentBuildings.set(row.payment_id, ids);
      }
    const scopedLedger = buildingId
      ? ledger.filter((row) =>
          row.payment_id
            ? paymentBuildings.get(String(row.payment_id))?.has(buildingId)
            : row.effective_building_id === buildingId,
        )
      : ledger;
    const ambiguousPaymentIds = buildingId
      ? [...paymentBuildings]
          .filter(([, ids]) => ids.has(buildingId) && ids.size > 1)
          .map(([id]) => id)
      : [];
    const operations = await fetchAssetOperations({ projectId });
    const directory = buildOperatingAssetDirectory(operations, {
      sacsiProjectId: projectId,
      applyExcelConfirmation: true,
      includeCanonical: true,
    });
    const matchingUnitIds = new Set<string>();
    if (buildingId) {
      const unitIds = [
        ...new Set(directory.assets.flatMap((asset) => (asset.unitId ? [asset.unitId] : []))),
      ];
      for (let offset = 0; offset < unitIds.length; offset += 100) {
        const attributedUnits: { id: string; building_id: string }[] = await fetchAllPages<{
          id: string;
          building_id: string;
        }>(
          (from, to) =>
            client
              .from("units")
              .select("id,building_id")
              .in("id", unitIds.slice(offset, offset + 100))
              .eq("building_id", buildingId)
              .order("id")
              .range(from, to),
          "actual cash operating building attribution",
        );
        for (const unit of attributedUnits) {
          if (unit.building_id !== buildingId || !unitIds.includes(unit.id))
            throw new Error("ActualCashScopeUnavailable");
          matchingUnitIds.add(unit.id);
        }
      }
    }
    const scopedAssets = buildingId
      ? directory.assets.filter((asset) => asset.unitId && matchingUnitIds.has(asset.unitId))
      : directory.assets;
    const scopedAssetIds = new Set(scopedAssets.map((asset) => asset.id));
    const operationDirectory = {
      ...directory,
      assets: scopedAssets,
      entries: directory.entries.filter((entry) => scopedAssetIds.has(entry.assetId)),
    };
    const operationLinks: ActualCashAssetLink[] = [];
    for (let offset = 0; offset < operationDirectory.assets.length; offset += 100) {
      const ids = operationDirectory.assets.slice(offset, offset + 100).map((asset) => asset.id);
      const rows = await fetchAllPages<ActualCashAssetLink>(
        (from, to) =>
          client
            .from("asset_operation_entries")
            .select("id,payment_id,ledger_entry_id")
            .in("asset_id", ids)
            .order("id")
            .range(from, to),
        "actual cash operating source links",
      );
      operationLinks.push(...rows);
    }
    const periodEntryIds = new Set(
      operationDirectory.entries
        .filter((entry) => entry.cashDate && entry.cashDate >= dateFrom && entry.cashDate <= dateTo)
        .map((entry) => entry.id),
    );
    const extraPaymentIds = [
      ...new Set(
        operationLinks
          .filter(
            (link) =>
              periodEntryIds.has(link.id) && link.payment_id && !paymentMap.has(link.payment_id),
          )
          .map((link) => link.payment_id!),
      ),
    ];
    for (let offset = 0; offset < extraPaymentIds.length; offset += 100) {
      const ids = extraPaymentIds.slice(offset, offset + 100);
      const response = await client.from("payments").select(paymentColumns).in("id", ids);
      if (response.error || !Array.isArray(response.data))
        throw new Error("ActualCashReadUnavailable");
      for (const payment of response.data) {
        if (!ids.includes(payment.id)) throw new Error("ActualCashReadUnavailable");
        paymentMap.set(payment.id, payment as PaymentRow);
      }
      const reversals = await fetchAllPages<{ id: string; reversal_of_payment_id: string }>(
        (from, to) =>
          client
            .from("payments")
            .select("id,reversal_of_payment_id")
            .in("reversal_of_payment_id", ids)
            .order("id")
            .range(from, to),
        "actual cash operating reversal evidence",
      );
      reversedPaymentIds.push(...reversals.map((row) => row.reversal_of_payment_id));
    }
    const payments = [...paymentMap.values()].filter(
      (payment) => !ambiguousPaymentIds.includes(payment.id),
    );
    return buildFinanceActualCash({
      projectId,
      dateFrom,
      dateTo,
      ledger: scopedLedger,
      payments,
      reversedPaymentIds,
      operations: operationDirectory,
      operationLinks,
    });
  },
);

/** Authenticated read model shared by the home page and the SACSI cash workspace. */
export function getFinanceActualCash({
  projectId,
  dateFrom,
  dateTo,
  buildingId,
}: FinanceActualCashScope) {
  return read(projectId, dateFrom, dateTo, buildingId);
}
