import { getCurrentUser, hasPermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { readReceiptDetail } from "@/features/daily-rentals/receipt-detail-service";
import { ReceiptReadError } from "@/features/daily-rentals/receipt-analysis-service";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "authenticationRequired" }, { status: 401, headers });
  if (!hasPermission(user, "finance:read"))
    return Response.json({ error: "receiptPermissionDenied" }, { status: 403, headers });
  try {
    return Response.json(await readReceiptDetail(await createClient(), (await params).id, user), {
      headers,
    });
  } catch (error) {
    if (error instanceof ReceiptReadError)
      return Response.json({ error: error.message }, { status: error.status, headers });
    return Response.json({ error: "receiptHistoryUnavailable" }, { status: 503, headers });
  }
}
