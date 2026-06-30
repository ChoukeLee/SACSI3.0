"use client";

import dynamic from "next/dynamic";
import { OperationalPageSkeleton } from "@/components/operational-page-skeleton";

const SaleList = dynamic(() => import("@/features/sales/sale-list").then((mod) => ({ default: mod.SaleList })), {
  loading: () => <OperationalPageSkeleton kind="records" rows={8} />,
  ssr: false,
});

export function SaleLazyView(props: React.ComponentProps<typeof SaleList>) {
  return <SaleList {...props} />;
}
