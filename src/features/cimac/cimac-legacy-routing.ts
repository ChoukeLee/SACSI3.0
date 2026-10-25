/** Compatibility links only: project membership must be resolved by the server. */
import { safeWorkbenchReturnTo } from "@/lib/workbench-links";

export type LegacyBusinessArea =
  "management" | "leases" | "sales" | "customers" | "units" | "finance" | "reports";
export type LegacyBusinessParams = Record<string, string | string[] | undefined>;
const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;

export function cimacLegacyHref(
  area: LegacyBusinessArea,
  params: LegacyBusinessParams,
  locale: "zh" | "fr",
) {
  const base = `${locale === "fr" ? "/fr" : ""}/cimac`;
  const target = new URLSearchParams();
  const copy = (from: string, to = from) => {
    const value = params[from];
    if (Array.isArray(value)) throw new Error("BusinessWorkspaceScopeUnavailable");
    if (value) target.set(to, value);
  };
  const tail = (path: string) => `${base}${path}${target.size ? `?${target}` : ""}`;
  const returnTo = safeWorkbenchReturnTo(params.returnTo);
  if (returnTo && /^\/(?:fr\/)?cimac(?:\/|\?|$)/.test(returnTo)) target.set("returnTo", returnTo);
  if (area === "management") return base;
  if (area === "customers" || area === "units") {
    const id = params[area === "customers" ? "customer" : "unit"];
    if (id && (Array.isArray(id) || !uuid.test(id)))
      throw new Error("BusinessWorkspaceScopeUnavailable");
    copy(params.building ? "building" : "buildingId", "building");
    if (id) return tail(`/${area === "customers" ? "customers" : "assets"}/${id}`);
    for (const key of ["q", "page"]) copy(key);
    if (params.filter) {
      const filter = params.filter;
      if (Array.isArray(filter)) throw new Error("BusinessWorkspaceScopeUnavailable");
      // Old asset filters have different enums. Preserve their meaning where supported.
      const assetFilters: Record<string, string> = {
        all: "all",
        occupied: "occupied",
        unoccupied: "unoccupied",
        attention: "attention",
        maintenance: "maintenance",
        locked: "locked",
        cleaning: "attention",
        sold: "attention",
      };
      const mapped = area === "units" ? assetFilters[filter] : filter;
      if (mapped) target.set("filter", mapped);
    }
    if (area === "units") copy("kind");
    return tail(area === "customers" ? "/customers" : "/assets");
  }
  if (area === "leases") {
    for (const key of ["contract", "building"]) copy(key);
    return tail("/contracts");
  }
  // CIMAC is lease-only. Preserve historical sales in a read-only archive.
  if (area === "sales") {
    const contract = params.contract;
    if (contract && (Array.isArray(contract) || !uuid.test(contract)))
      throw new Error("BusinessWorkspaceScopeUnavailable");
    return tail(contract ? `/contracts/history/sales/${contract}` : "/assets");
  }
  if (area === "reports") {
    for (const key of [
      "kind",
      "month",
      "page",
      "search",
      "direction",
      "management",
      "outstandingOnly",
    ])
      copy(key);
    return tail("/reports");
  }
  const customerId = params.customerId ?? params.customer;
  if (customerId && (Array.isArray(customerId) || !uuid.test(customerId)))
    throw new Error("BusinessWorkspaceScopeUnavailable");
  if (customerId && (!params.kind || params.view === "customers")) {
    target.set("tab", "account");
    if (params.tab && typeof params.tab === "string") target.set("accountTab", params.tab);
    return tail(`/customers/${customerId}`);
  }
  if (
    params.view === "customers" ||
    (!params.kind &&
      !params.view &&
      ![
        "buildingId",
        "dateFrom",
        "dateTo",
        "direction",
        "category",
        "status",
        "management",
        "outstandingOnly",
        "page",
      ].some((key) => params[key]))
  ) {
    copy(params.q ? "q" : "search", "q");
    copy("customerPage", "page");
    return tail("/finance");
  }
  for (const key of [
    "kind",
    "view",
    "buildingId",
    "dateFrom",
    "dateTo",
    "direction",
    "category",
    "status",
    "management",
    "outstandingOnly",
    "page",
    "search",
  ])
    copy(key);
  if (!target.has("kind") && !params.view) target.set("kind", "ledger");
  return tail("/finance");
}
