"use client";

import dynamic from "next/dynamic";
import { OperationalPageSkeleton } from "@/components/operational-page-skeleton";

const LeaseLedger = dynamic(() => import("@/features/leases/lease-ledger").then((mod) => ({ default: mod.LeaseLedger })), {
  loading: () => <OperationalPageSkeleton kind="records" rows={8} />,
  ssr: false,
});

export function LeaseLazyView(props: React.ComponentProps<typeof LeaseLedger>) {
  return <LeaseLedger {...props} />;
}
