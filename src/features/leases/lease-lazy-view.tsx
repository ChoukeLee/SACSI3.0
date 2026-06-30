"use client";

import dynamic from "next/dynamic";
import { OperationalPageSkeleton } from "@/components/operational-page-skeleton";

const LeaseList = dynamic(() => import("@/features/leases/lease-list").then((mod) => ({ default: mod.LeaseList })), {
  loading: () => <OperationalPageSkeleton kind="records" rows={8} />,
  ssr: false,
});

export function LeaseLazyView(props: React.ComponentProps<typeof LeaseList>) {
  return <LeaseList {...props} />;
}
