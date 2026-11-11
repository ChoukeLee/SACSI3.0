import { Suspense } from "react";
import Link from "next/link";
import { redirect, unstable_rethrow } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { routeFor, type Locale } from "@/lib/i18n";
import { getProjects } from "@/app/management/management-data";
import { OperationalPageSkeleton } from "@/components/operational-page-skeleton";
import { getOperatingSnapshot } from "./operating-data";
import { OperatingDashboard } from "./operating-dashboard";
import { loadRentalHomeData } from "./rental-first-data";
import styles from "./operating.module.css";

export async function ManagementPageContent({
  locale,
  params,
}: {
  locale: Locale;
  params: { project?: string; month?: string };
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!["admin", "boss", "finance"].includes(user.role)) redirect(routeFor(locale, "/leases"));
  const authorizedProjects = await getProjects();
  const requested = params.project?.toUpperCase() ?? "SACSI";
  if (
    requested === "CIMAC" ||
    authorizedProjects.some((item) => item.code === "CIMAC" && item.id.toUpperCase() === requested)
  )
    redirect(routeFor(locale, "/cimac"));
  const projects = authorizedProjects.filter((item) => item.code !== "CIMAC");
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
          <h1>{zh ? "租赁经营" : "Activité locative"}</h1>
          <p>
            {zh
              ? "先处理租金，再看月度收支。"
              : "Suivre les loyers, puis les encaissements et dépenses du mois."}
          </p>
        </div>
      </header>
      <nav
        className={styles.context}
        aria-label={zh ? "项目范围" : "Périmètre du projet"}
        hidden={projects.length <= 1}
        style={projects.length <= 1 ? { display: "none" } : undefined}
      >
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
          viewerId={user.id}
          month={params.month}
        />
      </Suspense>
    </main>
  );
}
export async function DashboardSection(props: {
  projectId: string;
  allowsSale: boolean;
  allowsDaily: boolean;
  locale: Locale;
  financeMode: boolean;
  viewerId?: string;
  month?: string;
}) {
  let snapshot: Awaited<ReturnType<typeof getOperatingSnapshot>>;
  try {
    snapshot = await getOperatingSnapshot(props.projectId);
  } catch (error) {
    // Preserve Next.js redirects/auth/static-render interruptions. Only this
    // section's unavailable data becomes a local unknown state.
    unstable_rethrow(error);
    return <ManagementSectionUnavailable locale={props.locale} projectId={props.projectId} />;
  }
  const rentalPriority = props.viewerId
    ? await loadRentalHomeData({
        projectId: props.projectId,
        viewerId: props.viewerId,
        locale: props.locale,
        today: snapshot.asOf ?? new Date().toISOString().slice(0, 10),
        requestedMonth: props.month,
      })
    : undefined;
  return <OperatingDashboard snapshot={snapshot} {...props} rentalPriority={rentalPriority} />;
}
function ManagementSectionUnavailable({
  locale,
  projectId,
}: {
  locale: Locale;
  projectId: string;
}) {
  const zh = locale === "zh";
  const title = zh ? "经营汇总暂不可用" : "Synthèse temporairement indisponible";
  const href = `/finance?${new URLSearchParams({ projectId })}`;
  return (
    <section className={`${styles.surface} mt-6`} role="status" aria-label={title}>
      <h2 className="text-base font-semibold">{title}</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        {zh
          ? "数据状态：未知。暂时无法读取此部分数据，因此不展示金额、数量或业务判断。其他工作区仍可使用。"
          : "État des données : inconnu. Cette section ne peut pas être chargée ; aucun montant, nombre ou diagnostic n’est affiché. Les autres espaces restent accessibles."}
      </p>
      <p className="mt-2 text-sm text-muted-foreground">
        {zh
          ? "请稍后刷新重试，或先进入对应工作区核对。"
          : "Actualisez la page plus tard ou consultez l’espace correspondant."}
      </p>
      <Link
        className="mt-3 inline-block text-sm text-blue-700 underline-offset-4 hover:underline dark:text-blue-300"
        href={routeFor(locale, href)}
      >
        {zh ? "打开财务工作区" : "Ouvrir l’espace finance"} ↗
      </Link>
    </section>
  );
}
