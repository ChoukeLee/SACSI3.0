import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { decodeCimacCollectionAdjustment, parseCimacRequestId } from "./cimac-billing-service";
import type { CimacCollectionAdjustment } from "./cimac-billing-types";

/** Only sealed, scoped adjustment links are authoritative; public allocations remain original facts. */
export async function readCimacCollectionAdjustments(
  client: Pick<SupabaseClient, "rpc">,
  paymentIds: string[],
): Promise<CimacCollectionAdjustment[]> {
  const keys = paymentIds.map(parseCimacRequestId);
  if (new Set(keys).size !== keys.length) throw new Error("CimacAdjustmentReadUnavailable");
  const result: CimacCollectionAdjustment[] = [];
  for (let offset = 0; offset < keys.length; offset += 100) {
    const chunk = keys.slice(offset, offset + 100),
      expected = new Set(chunk);
    const { data, error } = await client.rpc("cimac_collection_adjustments_rpc", {
      p_payment_ids: chunk,
    });
    if (error || !Array.isArray(data) || data.length !== chunk.length)
      throw new Error("CimacAdjustmentReadUnavailable");
    for (const row of data) {
      if (!row || typeof row !== "object" || !expected.delete(row.paymentId))
        throw new Error("CimacAdjustmentReadUnavailable");
      const adjustment = decodeCimacCollectionAdjustment(row.adjustment);
      if (adjustment.paymentId !== row.paymentId) throw new Error("CimacAdjustmentReadUnavailable");
      result.push(adjustment);
    }
    if (expected.size) throw new Error("CimacAdjustmentReadUnavailable");
  }
  return result;
}
