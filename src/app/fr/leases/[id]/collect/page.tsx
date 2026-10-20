import {
  LeaseCollectionPage,
  type LeaseCollectionRouteProps,
} from "@/features/leases/lease-collection-page";

export const dynamic = "force-dynamic";

export default function CollectLeasePage(props: LeaseCollectionRouteProps) {
  return <LeaseCollectionPage {...props} locale="fr" />;
}
