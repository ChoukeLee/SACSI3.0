"use client";

import dynamic from "next/dynamic";
import { OperationalPageSkeleton } from "@/components/operational-page-skeleton";

const CustomerList = dynamic(() => import("@/features/customers/customer-list").then((mod) => ({ default: mod.CustomerList })), {
  loading: () => <OperationalPageSkeleton kind="records" rows={8} />,
  ssr: false,
});

export function CustomerLazyView(props: React.ComponentProps<typeof CustomerList>) {
  return <CustomerList {...props} />;
}
