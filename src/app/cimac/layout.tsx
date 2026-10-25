import type { Metadata } from "next";
import { CimacWorkspaceLayout } from "@/features/cimac/cimac-workspace-pages";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "CIMAC 科建建材城 · 园区工作区" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return <CimacWorkspaceLayout locale="zh">{children}</CimacWorkspaceLayout>;
}
