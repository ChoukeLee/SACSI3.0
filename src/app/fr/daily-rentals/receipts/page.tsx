import { ReceiptAnalysisPage } from "@/features/daily-rentals/receipt-analysis-page";
export const dynamic = "force-dynamic";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return <ReceiptAnalysisPage locale="fr" params={await searchParams} />;
}
