import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/auth";
import type { ReceiptDetailData } from "./receipt-analysis-types";
import { parseReceiptQuery } from "./receipt-analysis-query";
import { readReceiptAnalysis, ReceiptReadError } from "./receipt-analysis-service";

export async function readReceiptDetail(
  client: SupabaseClient,
  id: string,
  user: CurrentUser,
): Promise<ReceiptDetailData> {
  if (!hasPermission(user, "finance:read"))
    throw new ReceiptReadError("receiptPermissionDenied", 403);
  if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(id))
    throw new ReceiptReadError("invalidReceiptFilter", 400);
  // A raw payment row is not sufficient authorization: legacy NULL unit_id is
  // allowed by old RLS. Re-check the exact record through the scoped RPC before
  // retrieving any booking, archive or audit information.
  const payment = await client
    .from("payments")
    .select("payment_date")
    .eq("id", id)
    .eq("source_type", "daily_booking")
    .maybeSingle();
  if (payment.error) throw new ReceiptReadError("receiptHistoryUnavailable");
  if (!payment.data) throw new ReceiptReadError("receiptNotFound", 404);
  const query = parseReceiptQuery({
    dateFrom: payment.data.payment_date,
    dateTo: payment.data.payment_date,
  });
  const report = await readReceiptAnalysis(client, {
    ...query,
    input: { ...query.input, paymentId: id },
  } as ReturnType<typeof parseReceiptQuery>);
  const row = report.rows.find((row) => row.id.toLowerCase() === id.toLowerCase());
  if (!row) throw new ReceiptReadError("receiptNotFound", 404);
  const auditAllowed = hasPermission(user, "audit_logs:read");
  const [booking, attachments, audit] = await Promise.all([
    row.bookingId
      ? client
          .from("daily_bookings")
          .select("check_in,check_out,actual_check_out,status")
          .eq("id", row.bookingId)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    client
      .from("attachments")
      .select("id,bucket,storage_path,file_type,paper_archive_status,unit_id")
      .eq("linked_type", "payment")
      .eq("linked_id", id)
      .order("uploaded_at", { ascending: false })
      .limit(21),
    auditAllowed
      ? client
          .from("audit_logs")
          .select("id,created_at,action,actor_id,actor_email")
          .in("entity_id", [
            ...new Set([id, row.bookingId].filter((value): value is string => Boolean(value))),
          ])
          .in("entity_type", ["payment", "payments", "daily_booking", "daily_bookings"])
          .order("created_at", { ascending: false })
          .limit(20)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (booking.error) throw new ReceiptReadError("receiptHistoryUnavailable");
  let attachmentsUnavailable = Boolean(attachments.error || (attachments.data?.length ?? 0) > 20);
  const signed = await Promise.all(
    (attachments.error ? [] : (attachments.data ?? [])).slice(0, 20).map(async (attachment) => {
      let url: string | null = null;
      if (
        attachment.bucket === "receipts" &&
        (!attachment.unit_id || attachment.unit_id === row.unitId) &&
        typeof attachment.storage_path === "string" &&
        !attachment.storage_path.split("/").includes("..")
      ) {
        try {
          const result = await client.storage
            .from("receipts")
            .createSignedUrl(attachment.storage_path, 300);
          if (!result.error && result.data?.signedUrl) {
            const candidate = new URL(result.data.signedUrl),
              expected = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "");
            if (
              candidate.protocol === "https:" &&
              candidate.origin === expected.origin &&
              candidate.pathname.startsWith("/storage/v1/object/sign/receipts/")
            )
              url = candidate.href;
          }
        } catch {
          /* An unavailable image does not erase its archive record. */
        }
      }
      if (!url) attachmentsUnavailable = true;
      return {
        id: attachment.id,
        url,
        fileType: attachment.file_type,
        archiveStatus: attachment.paper_archive_status,
      };
    }),
  );
  return {
    booking: booking.data
      ? {
          checkIn: booking.data.check_in,
          checkOut: booking.data.actual_check_out ?? booking.data.check_out,
          status: booking.data.status,
        }
      : null,
    attachments: signed,
    audit: audit.error
      ? []
      : (audit.data ?? []).map((log) => ({
          id: log.id,
          createdAt: log.created_at,
          action: log.action,
          actorId: log.actor_id,
          actorName: log.actor_id ? log.actor_email : null,
        })),
    auditAllowed,
    attachmentsUnavailable,
    auditUnavailable: Boolean(audit.error),
  };
}
