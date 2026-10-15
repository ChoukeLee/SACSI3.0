import { redirect } from "next/navigation";
import { getCurrentUser, hasPermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { parseReceiptQuery, ReceiptQueryError } from "./receipt-analysis-query";
import { readReceiptAnalysis, ReceiptReadError } from "./receipt-analysis-service";
import { ReceiptAnalysisView } from "./receipt-analysis-view";
import type { ReceiptAnalysis } from "./receipt-analysis-types";
import { DailyReceiptsNav } from "./daily-receipts-nav";

export async function ReceiptAnalysisPage({
  locale,
  params,
}: {
  locale: "zh" | "fr";
  params: Record<string, string | string[] | undefined>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!hasPermission(user, "finance:read"))
    redirect(locale === "zh" ? "/daily-rentals" : "/fr/daily-rentals");
  let initialData: ReceiptAnalysis | null = null,
    initialError: string | undefined;
  try {
    const query = parseReceiptQuery({ ...params, export: undefined });
    initialData = await readReceiptAnalysis(await createClient(), query);
  } catch (error) {
    initialError =
      error instanceof ReceiptQueryError || error instanceof ReceiptReadError
        ? error.message
        : "receiptHistoryUnavailable";
  }
  return (
    <>
      <DailyReceiptsNav locale={locale} active="receipts" userRole={user.role} />
      <ReceiptAnalysisView locale={locale} initialData={initialData} initialError={initialError} />
    </>
  );
}
