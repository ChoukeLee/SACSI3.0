"use client";

import { LeaseLedger } from "@/features/leases/lease-ledger";

export function LeaseLazyView(props: React.ComponentProps<typeof LeaseLedger>) {
  return <LeaseLedger {...props} />;
}
