import {
  LeaseCollectionPage,
  type LeaseCollectionRouteProps,
} from "@/features/leases/lease-collection-page";

export default function Page(props: LeaseCollectionRouteProps) {
  return <LeaseCollectionPage {...props} locale="fr" workArea="cimac" />;
}
