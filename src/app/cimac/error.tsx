"use client";
import { CimacWorkspaceFeedback } from "@/components/cimac-workspace-feedback";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return <CimacWorkspaceFeedback reset={reset} />;
}
