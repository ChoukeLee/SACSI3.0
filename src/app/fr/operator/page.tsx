import { OperatorInboxPage } from "@/features/business-actions/operator-inbox-page";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return <OperatorInboxPage params={await searchParams} locale="fr" />;
}
