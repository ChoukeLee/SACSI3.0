import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { dictionaries } from "@/lib/i18n";
import { getBuildings, getCimacOverview, getProjects } from "@/app/management/management-data";
import { FinanceSection, UnitDataSection } from "@/app/management/management-sections";
import { ManagementPageShell } from "@/app/management/management-page-shell";
import { CimacProjectOverview, ProjectPortfolioCards } from "@/app/management/management-projects";
import {
  FinanceStripSkeleton, StatusOverviewSkeleton,
  RoomBoardSkeleton,
} from "@/app/management/management-skeletons";
import type { BuildingRow } from "@/types/database";


export default async function FrenchManagementPage({ searchParams }: { searchParams: Promise<{ project?: string }> }) {
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
  const t = dictionaries.fr.management;

  return (
    <ManagementPageShell
      buildings={projectBuildings}
      locale="fr"
      t={t}
      projectName={selectedProjectCode === "CIMAC" ? "CIMAC" : "Projet résidentiel SACSI"}
      description={selectedProjectCode === "CIMAC" ? "Construction, actifs et préparation locative · location uniquement" : "Finance, occupation et immeubles"}
    >
      <ProjectPortfolioCards projects={projects} buildings={buildings} cimac={cimac} selectedProjectCode={selectedProjectCode} locale="fr" />

      {selectedProjectCode === "CIMAC" && cimac ? (
        <CimacProjectOverview overview={cimac} locale="fr" />
      ) : (
        <>
          <Suspense fallback={<FinanceStripSkeleton />}>
            <FinanceSection locale="fr" t={t} buildings={projectBuildings} />
          </Suspense>
          <Suspense
            fallback={
              <div className="flex flex-col gap-4">
                <StatusOverviewSkeleton />
                <RoomBoardSkeleton />
              </div>
            }
          >
            <UnitDataSection buildings={projectBuildings} locale="fr" t={t} />
          </Suspense>
        </>
      )}

    </ManagementPageShell>
  );
}

