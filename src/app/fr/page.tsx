import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { MetricCard } from "@/components/metric-card";
import { PageHeader } from "@/components/page-header";
import { dictionaries, routeFor } from "@/lib/i18n";

export default function FrenchDashboardPage() {
  const t = dictionaries.fr.dashboard;

  return (
    <AppShell locale="fr">
      <PageHeader title={t.title} description={t.description} />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard title={t.metrics.mainUnits[0]} value={t.metrics.mainUnits[1]} caption={t.metrics.mainUnits[2]} />
        <MetricCard title={t.metrics.dailyUnits[0]} value={t.metrics.dailyUnits[1]} caption={t.metrics.dailyUnits[2]} accent="green" />
        <MetricCard title={t.metrics.businessTypes[0]} value={t.metrics.businessTypes[1]} caption={t.metrics.businessTypes[2]} accent="ink" />
        <MetricCard title={t.metrics.futureBuildings[0]} value={t.metrics.futureBuildings[1]} caption={t.metrics.futureBuildings[2]} />
      </div>

      <section className="mt-8 grid gap-4 lg:grid-cols-2">
        {t.modules.map(([title, description, metric, href]) => (
          <Link
            key={href}
            href={routeFor("fr", href)}
            className="rounded-md border border-black/10 bg-white p-5 shadow-soft transition hover:-translate-y-0.5 hover:border-brand-orange"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-lg font-bold text-brand-ink">{title}</h3>
                <p className="mt-2 text-sm leading-6 text-slate-600">{description}</p>
              </div>
              <span className="rounded bg-orange-50 px-2.5 py-1 text-xs font-semibold text-brand-orange">
                {metric}
              </span>
            </div>
          </Link>
        ))}
      </section>
    </AppShell>
  );
}
