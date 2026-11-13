"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { captureOperationFailure } from "@/lib/operation-monitoring";
import {
  isOwnerSettlementId,
  ownerSettlementBusinessErrors,
  parseOwnerSettlementInput,
  readOwnerSettlementContext,
  verifyOwnerSettlementResult,
  type OwnerSettlementContextResult,
  type OwnerSettlementResult,
} from "./owner-settlement-model";

export async function getOwnerSettlementContext(
  assetId: string,
): Promise<OwnerSettlementContextResult> {
  await requireRole("admin", "finance");
  if (!isOwnerSettlementId(assetId))
    return { ok: false, error: "invalidOwnerSettlement", rejected: true };
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("asset_operations_owner_settlement_context_rpc", {
      p_asset_id: assetId,
    });
    if (error)
      return {
        ok: false,
        error: ownerSettlementBusinessErrors.includes(error.message)
          ? error.message
          : "ownerSettlementContextUnavailable",
        rejected: true,
      };
    return { ok: true, context: readOwnerSettlementContext(data, assetId) };
  } catch {
    return { ok: false, error: "ownerSettlementContextUnavailable", rejected: true };
  }
}

export async function recordOwnerSettlement(
  input: unknown,
  requestId: string,
): Promise<OwnerSettlementResult> {
  const actor = await requireRole("admin", "finance");
  let payload;
  try {
    if (!isOwnerSettlementId(requestId)) throw new Error("invalidOwnerSettlement");
    payload = parseOwnerSettlementInput(input, new Date().toISOString().slice(0, 10));
  } catch (error) {
    const message = error instanceof Error ? error.message : "invalidOwnerSettlement";
    return {
      ok: false,
      error: ownerSettlementBusinessErrors.includes(message) ? message : "invalidOwnerSettlement",
      rejected: true,
    };
  }
  try {
    const supabase = await createClient();
    const result = await supabase.rpc("asset_operations_record_owner_settlement_rpc", {
      p_input: payload,
      p_request_id: requestId,
    });
    if (result.error) {
      const rejected = /^(P0001|42501|22[0-9A-Z]{3}|23[0-9A-Z]{3})$/.test(result.error.code ?? "");
      const business = ownerSettlementBusinessErrors.includes(result.error.message);
      if (!rejected)
        captureOperationFailure({
          operation: "asset_operations_owner_settlement",
          requestId,
          code: result.error.code ?? "",
        });
      return {
        ok: false,
        error: rejected && business ? result.error.message : "assetOperationResultUnknown",
        rejected: rejected && business,
      };
    }
    const verified = verifyOwnerSettlementResult(result.data, payload, requestId, actor.id);
    for (const path of [
      "/asset-operations",
      "/fr/asset-operations",
      "/units",
      "/fr/units",
      "/leases",
      "/fr/leases",
      "/finance",
      "/fr/finance",
      "/management",
      "/fr/management",
    ])
      revalidatePath(path);
    return { ok: true, ...verified };
  } catch {
    captureOperationFailure({
      operation: "asset_operations_owner_settlement",
      requestId,
      code: "result_unknown",
    });
    return { ok: false, error: "assetOperationResultUnknown", rejected: false };
  }
}
