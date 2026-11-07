import { AssetOperationsPage } from "@/features/asset-operations/asset-operations-page";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function Page() {
  return <AssetOperationsPage locale="fr" />;
}
