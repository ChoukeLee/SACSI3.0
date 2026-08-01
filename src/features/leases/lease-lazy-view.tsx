"use client";

import { LeaseList } from "@/features/leases/lease-list";

export function LeaseLazyView(props: React.ComponentProps<typeof LeaseList>) {
  return <LeaseList {...props} />;
}
