import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { routeFor, type Locale } from "@/lib/i18n";
import { getCimacOverview, getProjects } from "@/app/management/management-data";
import { CimacProjectOverview } from "@/app/management/management-projects";
import { OperationalPageSkeleton } from "@/components/operational-page-skeleton";
import { getOperatingSnapshot } from "./operating-data";
import { OperatingDashboard } from "./operating-dashboard";
import styles from "./operating.module.css";

export async function ManagementPageContent({
  locale,
  params,
}: {
  locale: Locale;
  params: { project?: string };
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!["admin", "boss", "finance"].includes(user.role)) redirect(routeFor(locale, "/leases"));
  const projects = await getProjects();
  const requested = params.project?.toUpperCase() ?? "SACSI";
  const project =
    projects.find((item) => item.code === requested) ??
    projects.find((item) => item.code === "SACSI") ??
    projects[0];
  const zh = locale === "zh";
  if (!project)
    return (
      <p>
        {zh
          ? "当前账号未配置可访问项目，请联系管理员。"
          : "Aucun projet accessible. Contactez l’administrateur."}
      </p>
    );
  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <div className={styles.eyebrow}>
            {zh ? "经营总览" : "Pilotage de l’activité"} · {project.code}
          </div>
          <h1>
            {zh
              ? project.code === "CIMAC"
                ? "科建建材城"
                : "SACSI 经营驾驶舱"
              : project.code === "CIMAC"
                ? "CIMAC · pilotage"
                : "SACSI · pilotage"}
          </h1>
          <p>
            {project.code === "CIMAC"
              ? zh
                ? "建设与交付、租赁准备、收款跟进 · 只租不卖"
                : "Construction, livraison, location et encaissements · location uniquement"
              : zh
                ? "长租、出售与资产经营，先看全局，再处理具体事项"
                : "Locations, ventes et actifs : une vue d’ensemble, puis les actions"}
          </p>
        </div>
      </header>
      <nav className={styles.context} aria-label={zh ? "项目范围" : "Périmètre du projet"}>
        {projects.map((item) => (
          <Link
            key={item.id}
            href={routeFor(locale, `/management?project=${item.code}`)}
            aria-current={item.id === project.id ? "page" : undefined}
          >
            {item.code === "CIMAC" && zh ? "科建建材城 CIMAC" : item.code}
          </Link>
        ))}
        <span>
          {zh ? "当前账号授权范围 · 本月截至今日" : "Périmètre autorisé · mois arrêté à ce jour"}
        </span>
      </nav>
      <Suspense fallback={<OperationalPageSkeleton kind="dashboard" />}>
        <DashboardSection
          projectId={project.id}
          allowsSale={project.allows_sale}
          allowsDaily={project.allows_daily_rental}
          locale={locale}
          financeMode={user.role === "finance"}
        />
      </Suspense>
      {project.code === "CIMAC" && (
        <Suspense fallback={<OperationalPageSkeleton kind="records" rows={4} />}>
          <CimacSection locale={locale} />
        </Suspense>
      )}
    </main>
  );
}
async function DashboardSection(props: {
  projectId: string;
  allowsSale: boolean;
  allowsDaily: boolean;
  locale: Locale;
  financeMode: boolean;
}) {
  const snapshot = await getOperatingSnapshot(props.projectId);
  return <OperatingDashboard snapshot={snapshot} {...props} />;
}
async function CimacSection({ locale }: { locale: Locale }) {
  const overview = await getCimacOverview();
  if (!overview) return null;
  return (
    <div className="mt-6">
      <CimacProjectOverview overview={overview} locale={locale} />
    </div>
  );
}
