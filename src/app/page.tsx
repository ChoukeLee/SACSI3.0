import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { MetricCard } from "@/components/metric-card";
import { PageHeader } from "@/components/page-header";
import { moduleCards } from "@/features/seed/initial-data";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const supabase = await createClient();

  const { data: notifications } = await supabase
    .from("notifications")
    .select("id, title, body, read_at, created_at, due_at")
    .order("created_at", { ascending: false })
    .limit(30);

  return (
    <AppShell notifications={(notifications ?? []) as { id: string; title: string; body: string; read_at: string | null; created_at: string; due_at: string | null }[]}>
      <PageHeader
        title="11#公寓运营仪表盘"
        description="首期只启用 11#公寓，但所有数据结构保留多楼栋扩展字段。这里先承载日租、长租、出售三条业务线的总览入口。"
      />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard title="主楼房源" value="72户" caption="1-12F，每层 101-106" />
        <MetricCard title="日租房源" value="21间" caption="固定房间，统一 40,000 XOF/晚" accent="green" />
        <MetricCard title="业务类型" value="3类" caption="日租、长租、出售" accent="ink" />
        <MetricCard title="扩展楼栋" value="5栋预留" caption="3#/4#/5#/6#/7# 后续导入" />
      </div>

      <section className="mt-8 grid gap-4 lg:grid-cols-2">
        {moduleCards.map((card) => (
          <Link
            key={card.href}
            href={card.href}
            className="rounded-md border border-black/10 bg-white p-5 shadow-soft transition hover:-translate-y-0.5 hover:border-brand-orange"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-lg font-bold text-brand-ink">{card.title}</h3>
                <p className="mt-2 text-sm leading-6 text-slate-600">{card.description}</p>
              </div>
              <span className="rounded bg-orange-50 px-2.5 py-1 text-xs font-semibold text-brand-orange">
                {card.metric}
              </span>
            </div>
          </Link>
        ))}
      </section>
    </AppShell>
  );
}
