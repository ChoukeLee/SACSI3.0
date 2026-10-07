import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllPages } from "@/lib/supabase/fetch-all";
import type { CollectionRequest } from "./operator-batch";

/** Read-only preflight, not a global uniqueness guarantee or a guessed image hash.
 * Existing request recovery remains available through the status endpoint.
 * A shared receipt across rows in a NEW batch is permitted; prior posted entries
 * on the same target require reconciliation, including refunded/corrected ones.
 */
export async function checkCollectionReceipts(
  db: Pick<SupabaseClient, "from">,
  request: CollectionRequest,
) {
  const rows = request.rows.filter((row) => row.receiptNo?.trim());
  if (!rows.length) return;
  let payments: Array<{ source_id: string | null; receipt_no: string | null }>;
  try {
    payments = await fetchAllPages<{ source_id: string | null; receipt_no: string | null }>(
      (from, to) =>
        db
          .from("payments")
          .select("source_id,receipt_no", { count: "exact" })
          .in("source_id", [...new Set(rows.map((row) => row.targetId.toLowerCase()))])
          .not("receipt_no", "is", null)
          .order("id")
          .range(from, to),
      "collection receipt history",
    );
  } catch {
    throw new Error("collectionDuplicateCheckUnavailable");
  }
  const normalize = (value: string) => value.trim().normalize("NFC");
  if (
    rows.some((row) =>
      payments.some(
        (payment) =>
          payment.source_id?.toLowerCase() === row.targetId.toLowerCase() &&
          typeof payment.receipt_no === "string" &&
          normalize(payment.receipt_no) === normalize(row.receiptNo!),
      ),
    )
  ) {
    throw new Error("duplicateCollectionReceipt");
  }
}
