import "server-only";

import { Suspense } from "react";
import { notFound } from "next/navigation";
import {
  getCimacWorkspaceContext,
  type CimacPageProps,
} from "@/features/cimac/cimac-workspace-pages";
import { OperationalPageSkeleton } from "@/components/operational-page-skeleton";
import { loadLeaseWorkspace } from "./lease-workspace-data";
import { LeaseLazyView } from "./lease-lazy-view";

/** Shared business engine, native park route. Never render the legacy route page. */
export async function CimacContractsPage({
  searchParams,
  locale,
}: CimacPageProps & { locale: "zh" | "fr" }) {
  const { user, scope, client } = await getCimacWorkspaceContext();
  const params = await searchParams;
  if (
    Object.keys(params).some(
      (key) => !["project", "building", "contract", "customer", "returnTo"].includes(key),
    ) ||
    Object.values(params).some((value) => Array.isArray(value))
  )
    notFound();
  const project = params.project as string | undefined;
  const building = params.building as string | undefined;
  const customer = params.customer as string | undefined;
  let customerName: string | undefined;
  if (
    (project && project !== "CIMAC" && project !== scope.project.id) ||
    (building && !scope.buildings.some((row) => row.id === building))
  )
    notFound();
  if (customer !== undefined) {
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        customer,
      ) ||
      params.contract ||
      !["admin", "rental_sales", "finance"].includes(user.role)
    )
      notFound();
    // A newly registered shared identity has no park contract yet. Verify only
    // current-user visibility; the project relationship is created by a later,
    // explicitly submitted contract, never by opening this URL.
    const visible = await client
      .from("customers")
      .select("id,name")
      .eq("id", customer)
      .maybeSingle();
    if (visible.error) throw new Error("CimacContractCustomerUnavailable");
    if (visible.data?.id !== customer) notFound();
    customerName =
      typeof visible.data.name === "string" && visible.data.name.trim()
        ? visible.data.name
        : customer;
  }
  return (
    <Suspense fallback={<OperationalPageSkeleton kind="records" rows={8} />}>
      <ContractData
        viewerId={user.id}
        role={user.role}
        projectId={scope.project.id}
        building={building}
        contract={params.contract as string | undefined}
        customer={customer}
        customerName={customerName}
        returnTo={params.returnTo as string | undefined}
        locale={locale}
      />
    </Suspense>
  );
}

async function ContractData({
  viewerId,
  role,
  projectId,
  building,
  contract,
  customer,
  customerName,
  returnTo,
  locale,
}: {
  viewerId: string;
  role: string;
  projectId: string;
  building?: string;
  contract?: string;
  customer?: string;
  customerName?: string;
  returnTo?: string;
  locale: "zh" | "fr";
}) {
  const data = await loadLeaseWorkspace(locale, projectId, viewerId, building, "cimac");
  return (
    <LeaseLazyView
      key={`cimac:${viewerId}`}
      {...data}
      workArea="cimac"
      initialProject={projectId}
      initialBuilding={building}
      initialContract={contract}
      initialCustomer={customer}
      initialCustomerName={customerName}
      returnTo={returnTo}
      locale={locale}
      canCreate={role === "admin" || role === "rental_sales"}
      canRecordFinance={role === "admin" || role === "finance"}
      canCorrectRentPeriod={role === "admin"}
      canActivate={role === "admin" || role === "rental_sales"}
      canMoveOut={role === "admin" || role === "finance"}
    />
  );
}
