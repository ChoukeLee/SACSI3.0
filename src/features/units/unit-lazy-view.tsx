"use client";

import dynamic from "next/dynamic";
import { OperationalPageSkeleton } from "@/components/operational-page-skeleton";

const UnitList = dynamic(() => import("@/features/units/unit-list").then((mod) => ({ default: mod.UnitList })), {
  loading: () => <OperationalPageSkeleton kind="records" rows={8} />,
  ssr: false,
});

export function UnitLazyView(props: React.ComponentProps<typeof UnitList>) {
  return <UnitList {...props} />;
}
