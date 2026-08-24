import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { dictionaries } from "@/lib/i18n";
import { getBuildings, getCimacOverview, getProjects } from "./management-data";
import { UnitDataSection } from "./management-sections";
import { ManagementPageShell } from "./management-page-shell";
import { CimacProjectOverview, ProjectPortfolioCards } from "./management-projects";
import {
  FinanceStripSkeleton, StatusOverviewSkeleton,
  RoomBoardSkeleton,
} from "./management-skeletons";
import type { BuildingRow } from "@/types/database";


export default async function ManagementPage({ searchParams }: { searchParams: Promise<{ project?: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const [buildings, projects, cimac, params] = await Promise.all([
    getBuildings() as Promise<BuildingRow[]>,
    getProjects(),
    getCimacOverview(),
    searchParams,
  ]);
  const requestedProject = String(params.project ?? "SACSI").toUpperCase();
  const selectedProject = projects.find((project) => project.code === requestedProject)
    ?? projects.find((project) => project.code === "SACSI")
    ?? projects[0];
  const selectedProjectCode = selectedProject?.code ?? "SACSI";
  const projectBuildings = buildings.filter((building) => building.project_id === selectedProject?.id);
  const t = dictionaries.zh.management;

  return (
    <ManagementPageShell
      buildings={projectBuildings}
      locale="zh"
      t={t}
      projectName={selectedProjectCode === "CIMAC" ? "科建建材城" : "SACSI 公寓项目"}
      description={selectedProjectCode === "CIMAC" ? "建设、资产和租赁准备情况 · 只租不卖" : "财务、房态和楼栋经营信息"}
    >
      <ProjectPortfolioCards projects={projects} buildings={buildings} cimac={cimac} selectedProjectCode={selectedProjectCode} locale="zh" />

      {selectedProjectCode === "CIMAC" && cimac ? (
        <CimacProjectOverview overview={cimac} locale="zh" />
      ) : (
        <Suspense
          fallback={
            <div className="flex flex-col gap-4">
              <FinanceStripSkeleton />
              <StatusOverviewSkeleton />
              <RoomBoardSkeleton />
            </div>
          }
        >
          <UnitDataSection buildings={projectBuildings} locale="zh" t={t} />
        </Suspense>
      )}

    </ManagementPageShell>
  );
}
