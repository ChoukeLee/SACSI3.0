"use client";

import { SaleList } from "@/features/sales/sale-list";

export function SaleLazyView(props: React.ComponentProps<typeof SaleList>) {
  return <SaleList {...props} />;
}
