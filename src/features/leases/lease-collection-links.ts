import { safeWorkbenchReturnTo } from "@/lib/workbench-links";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** A collection target is an immutable contract ID, never a room/name search. */
export function buildLeaseCollectionHref({
  contractId,
  locale = "zh",
  returnTo,
  workArea = "sacsi",
}: {
  contractId: string;
  locale?: "zh" | "fr";
  returnTo?: string | null;
  workArea?: "sacsi" | "cimac";
}): string | null {
  if (!uuid.test(contractId)) return null;
  const safeReturn = safeWorkbenchReturnTo(returnTo);
  const params = new URLSearchParams();
  if (safeReturn) params.set("returnTo", safeReturn);
  return `${locale === "fr" ? "/fr" : ""}/${workArea === "cimac" ? "cimac/contracts" : "leases"}/${contractId}/collect${params.size ? `?${params}` : ""}`;
}

export function validLeaseCollectionId(value: string): boolean {
  return uuid.test(value);
}
