import "server-only";
import { notFound } from "next/navigation";
import type { Locale } from "@/lib/i18n";
import { hasPermission } from "@/lib/auth";
import { getCimacWorkspaceContext, type CimacPageProps } from "./cimac-workspace-pages";
import { parseCimacApartmentQuery, type CimacApartmentQuery } from "./cimac-apartment-model";
import { readCimacApartments } from "./cimac-apartment-read";
import { CimacApartmentWorkbench } from "./cimac-apartment-workbench";
import { CimacWorkspaceReadError } from "./cimac-workspace-types";

export async function CimacApartmentsPage({
  searchParams,
  locale,
}: CimacPageProps & { locale: Locale }) {
  const { client, scope, user } = await getCimacWorkspaceContext();
  let initialQuery: CimacApartmentQuery;
  try {
    initialQuery = parseCimacApartmentQuery(await searchParams);
  } catch {
    notFound();
  }
  try {
    const data = await readCimacApartments(client, scope);
    return (
      <CimacApartmentWorkbench
        data={data}
        locale={locale}
        initialQuery={initialQuery}
        canInitialize={user.role === "admin" && hasPermission(user, "units:write")}
      />
    );
  } catch (error) {
    if (error instanceof CimacWorkspaceReadError && error.status === 403) notFound();
    throw error;
  }
}
