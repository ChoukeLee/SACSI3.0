import Link from "next/link";
import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { buildWorkbenchRecordHref, safeWorkbenchReturnTo } from "@/lib/workbench-links";
import { buildLeaseCollectionHref, validLeaseCollectionId } from "./lease-collection-links";
import { readLeaseCollectionContext } from "./lease-collection-read";
import { LeaseCollectionWorkbench } from "./lease-collection-workbench";

export interface LeaseCollectionRouteProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ returnTo?: string | string[] }>;
}

export async function LeaseCollectionPage({
  params,
  searchParams,
  locale,
  workArea,
}: LeaseCollectionRouteProps & { locale: "zh" | "fr"; workArea?: "sacsi" | "cimac" }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const base = `${locale === "fr" ? "/fr" : ""}/${workArea === "cimac" ? "cimac/contracts" : "leases"}`;
  if (user.role !== "admin" && user.role !== "finance") redirect(base);
  const { id } = await params;
  if (!validLeaseCollectionId(id)) notFound();
  const query = await searchParams;
  const returnTo = safeWorkbenchReturnTo(query.returnTo);
  return (
    <Suspense
      fallback={
        <section aria-busy="true" className="mx-auto max-w-6xl space-y-5 p-2">
          <p role="status" className="text-sm text-muted-foreground">
            {locale === "zh"
              ? "正在核对合同与可收账单…"
              : "Vérification du contrat et des créances…"}
          </p>
          <div className="h-24 animate-pulse rounded-2xl bg-muted" />
          <div className="h-96 animate-pulse rounded-2xl bg-muted" />
        </section>
      }
    >
      <CollectionData
        id={id}
        locale={locale}
        viewerId={user.id}
        recordedByLabel={user.displayName}
        returnTo={returnTo}
        workArea={workArea}
      />
    </Suspense>
  );
}

async function CollectionData({
  id,
  locale,
  recordedByLabel,
  viewerId,
  returnTo,
  workArea,
}: {
  id: string;
  locale: "zh" | "fr";
  recordedByLabel: string;
  viewerId: string;
  returnTo: string | null;
  workArea?: "sacsi" | "cimac";
}) {
  let data: Awaited<ReturnType<typeof readLeaseCollectionContext>>;
  try {
    data = await (workArea
      ? readLeaseCollectionContext(id, locale, workArea)
      : readLeaseCollectionContext(id, locale));
  } catch {
    return (
      <section className="mx-auto max-w-xl rounded-2xl border bg-card p-8">
        <h1 className="text-xl font-semibold" role="alert">
          {locale === "zh" ? "暂时无法核对这份合同" : "Impossible de vérifier ce contrat"}
        </h1>
        <p className="my-4 text-sm leading-6 text-muted-foreground">
          {locale === "zh"
            ? "合同、客户或完整账单读取失败，或当前账号无权访问。未开放收款，也未把读取失败当作没有欠款。"
            : "Le contrat, le client ou les créances complètes ne sont pas accessibles. Aucun encaissement n’a été ouvert et les soldes ne sont pas présumés nuls."}
        </p>
        <Link
          href={
            returnTo ??
            `${locale === "fr" ? "/fr" : ""}/${workArea === "cimac" ? "cimac/contracts" : "leases"}`
          }
          className="text-sm text-blue-600 underline"
        >
          {locale === "zh" ? "返回合同核对" : "Revenir au contrat"}
        </Link>
      </section>
    );
  }
  if (!workArea && data.building.project?.code === "CIMAC")
    redirect(buildLeaseCollectionHref({ contractId: id, locale, returnTo, workArea: "cimac" })!);
  const returnHref =
    returnTo ??
    buildWorkbenchRecordHref({
      workspace: "leases",
      workArea,
      id,
      locale,
      project: data.building.project_id,
      building: data.building.id,
    })!;
  return (
    <LeaseCollectionWorkbench
      workArea={workArea}
      key={id}
      contract={data.contract}
      unit={data.unit}
      customer={data.customer}
      buildingLabel={data.building.display_name || data.building.code}
      receivables={data.receivables}
      recordedByLabel={recordedByLabel}
      viewerId={viewerId}
      returnHref={returnHref}
      locale={locale}
      today={data.today}
      writeReady={data.writeReady}
    />
  );
}
