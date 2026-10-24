export type CimacBillingTab = "bills" | "receipts" | "meters" | "rules";

export interface CimacBillingQuery {
  customerId?: string;
  search: string;
  customerPage: number;
  tab: CimacBillingTab;
}

const identifier = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const tabs: CimacBillingTab[] = ["bills", "receipts", "meters", "rules"];

export function parseCimacBillingQuery(
  params: Record<string, string | string[] | undefined>,
): CimacBillingQuery {
  const one = (key: string) => {
    const value = params[key];
    if (Array.isArray(value)) throw new Error("InvalidCimacBillingQuery");
    return value?.trim() || "";
  };
  const customerId = one("customerId");
  const search = one("search");
  const page = one("customerPage") || "1";
  const tab = one("tab") || "bills";
  if (
    (customerId && !identifier.test(customerId)) ||
    search.length > 120 ||
    !/^[1-9]\d{0,6}$/.test(page) ||
    Number(page) > 2_000_000 ||
    !tabs.includes(tab as CimacBillingTab)
  )
    throw new Error("InvalidCimacBillingQuery");
  return {
    ...(customerId ? { customerId: customerId.toLowerCase() } : {}),
    search,
    customerPage: Number(page),
    tab: tab as CimacBillingTab,
  };
}

/** A normal URL is also a stable back/refresh link; no financial facts in it. */
export function cimacBillingHref(
  query: CimacBillingQuery,
  locale: "zh" | "fr",
  patch: Partial<CimacBillingQuery> = {},
) {
  const next = { ...query, ...patch };
  const params = new URLSearchParams({ view: "customers" });
  if (next.customerId) params.set("customerId", next.customerId);
  if (next.search) params.set("search", next.search);
  if (next.customerPage !== 1) params.set("customerPage", String(next.customerPage));
  if (next.tab !== "bills") params.set("tab", next.tab);
  return `${locale === "fr" ? "/fr" : ""}/finance?${params}`;
}

/** Existing ledger/date/building links retain their original behavior. */
export function wantsCimacCustomerWorkspace(
  params: Record<string, string | string[] | undefined>,
  cimacProjectId: string | undefined,
) {
  if (params.view === "customers") return true;
  if (!cimacProjectId || params.view || params.kind) return false;
  if (params.projectId && params.projectId !== cimacProjectId) return false;
  return ![
    "buildingId",
    "dateFrom",
    "dateTo",
    "direction",
    "category",
    "status",
    "management",
    "outstandingOnly",
    "page",
  ].some((key) => params[key] !== undefined);
}
