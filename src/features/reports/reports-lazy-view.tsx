"use client";

import dynamic from "next/dynamic";
import { OperationalPageSkeleton } from "@/components/operational-page-skeleton";

const ReportsView = dynamic(() => import("@/features/reports/reports-view").then((mod) => ({ default: mod.ReportsView })), {
  loading: () => <OperationalPageSkeleton kind="dashboard" rows={6} />,
  ssr: false,
});

export function ReportsLazyView(props: React.ComponentProps<typeof ReportsView>) {
  return <ReportsView {...props} />;
}
