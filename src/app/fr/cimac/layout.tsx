import type { Metadata } from "next";
import { CimacWorkspaceLayout } from "@/features/cimac/cimac-workspace-pages";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "CIMAC · Espace du parc commercial" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return <CimacWorkspaceLayout locale="fr">{children}</CimacWorkspaceLayout>;
}
