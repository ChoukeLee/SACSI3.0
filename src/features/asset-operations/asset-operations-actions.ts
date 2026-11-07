"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { captureOperationFailure } from "@/lib/operation-monitoring";
import type { AssetOperationKind } from "./asset-operations-model";
import type { CurrencyCode } from "@/types/domain";

export interface AssetOperationResult {
  ok: boolean;
  error?: string;
  rejected?: boolean;
}

export interface AssetOperationCatalogRow {
  sourceKey: string;
  code: string;
  name: string;
  group: string;
  sourceRefs: string[];
  unitId?: string | null;
  monthlyRentNative?: number | null;
  rentCurrency?: CurrencyCode | null;
}

async function submit(
  operation: string,
  input: unknown,
  requestId: string,
): Promise<AssetOperationResult> {
  const supabase = await createClient();
  const result = await supabase.rpc("asset_operations_write_rpc", {
    p_operation: operation,
    p_input: input,
    p_request_id: requestId,
  });
  if (result.error) {
    const code = result.error.code ?? "";
    const rejected = /^(P0001|42501|22[0-9A-Z]{3}|23[0-9A-Z]{3})$/.test(code);
    if (!rejected)
      captureOperationFailure({ operation: "asset_operations_" + operation, requestId, code });
    return {
      ok: false,
      // Expected business codes are translated by the caller. Do not return
      // database constraint details, source values or infrastructure messages.
      error:
        rejected && /^[a-zA-Z]+$/.test(result.error.message)
          ? result.error.message
          : "assetOperationUnavailable",
      rejected: rejected && result.error.message !== "requestIdConflict",
    };
  }
  if (!result.data?.success)
    return { ok: false, error: "assetOperationResultUnknown", rejected: false };
  revalidatePath("/asset-operations");
  revalidatePath("/fr/asset-operations");
  return { ok: true };
}

export async function createAssetOperationEntry(input: {
  requestId: string;
  assetId: string;
  expectedUpdatedAt: string;
  kind: AssetOperationKind;
  category?:
    | "rent"
    | "property_fee"
    | "maintenance"
    | "utilities"
    | "cleaning"
    | "security"
    | "payroll"
    | "tax"
    | "commission"
    | "insurance"
    | "other"
    | "deposit";
  amountNative: number;
  currency: CurrencyCode;
  cashDate?: string | null;
  periodStart?: string | null;
  periodEnd?: string | null;
  recognitionMethod?: "unallocated" | "daily";
  verification: "pending" | "verified";
  sourceRef: string;
  description?: string;
  paymentId?: string | null;
  ledgerEntryId?: string | null;
}): Promise<AssetOperationResult> {
  await requireRole("admin", "finance");
  const { requestId, ...payload } = input;
  return submit("create_entry", payload, requestId);
}

export async function confirmAssetOperationAsset(input: {
  requestId: string;
  assetId: string;
  expectedUpdatedAt: string;
  reason: string;
}): Promise<AssetOperationResult> {
  await requireRole("admin", "finance");
  const { requestId, ...payload } = input;
  return submit("confirm_asset", payload, requestId);
}

export async function importAssetOperationCatalog(input: {
  requestId: string;
  projectId: string;
  sourceFingerprint: string;
  assets: AssetOperationCatalogRow[];
}): Promise<AssetOperationResult> {
  await requireRole("admin");
  const { requestId, ...payload } = input;
  return submit("import_catalog", payload, requestId);
}

export async function confirmAssetOperationEntry(input: {
  requestId: string;
  entryId: string;
  expectedUpdatedAt: string;
  reason: string;
}): Promise<AssetOperationResult> {
  await requireRole("admin", "finance");
  const { requestId, ...payload } = input;
  return submit("confirm_entry", payload, requestId);
}

export async function voidAssetOperationEntry(input: {
  requestId: string;
  entryId: string;
  expectedUpdatedAt: string;
  reason: string;
}): Promise<AssetOperationResult> {
  await requireRole("admin", "finance");
  const { requestId, ...payload } = input;
  return submit("void_entry", payload, requestId);
}
