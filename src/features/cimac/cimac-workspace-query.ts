import { customerDirectoryFilters } from "@/features/customers/customer-directory-model";
import type {
  CimacWorkspaceQuery,
  CimacWorkspaceSection,
  CimacWorkspaceTab,
} from "./cimac-workspace-types";
import { CimacWorkspaceReadError } from "./cimac-workspace-types";

export const cimacWorkspaceUuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function cimacWorkspaceId(value: unknown): string {
  if (typeof value !== "string" || !cimacWorkspaceUuid.test(value))
    throw new CimacWorkspaceReadError(400);
  return value.toLowerCase();
}
const controls = /[\u0000-\u001f\u007f]/;
const queryKeys = [
  "membershipStatus",
  "project",
  "q",
  "building",
  "kind",
  "filter",
  "page",
  "relationPage",
  "tab",
  "returnTo",
  "accountTab",
];
const assetFilters = [
  "all",
  "occupied",
  "unoccupied",
  "attention",
  "construction_pending",
  "construction_unverified",
  "occupancy_unverified",
  "maintenance",
  "locked",
];
const kinds = ["apartment", "parking", "storefront", "office", "warehouse"];
export function safeCimacReturnTo(value: unknown): string | null {
  if (
    typeof value !== "string" ||
    !value ||
    value.length > 2048 ||
    value !== value.trim() ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\") ||
    controls.test(value)
  )
    return null;
  let url: URL;
  try {
    url = new URL(value, "https://cimac.invalid");
  } catch {
    return null;
  }
  if (
    url.origin !== "https://cimac.invalid" ||
    url.username ||
    url.password ||
    !/^\/(?:fr\/)?cimac(?:\/(?:customers|assets)(?:\/[0-9a-f-]{36})?|\/contracts(?:\/[0-9a-f-]{36}\/collect|\/history\/sales\/[0-9a-f-]{36})?|\/(?:finance|reports|map))?$/.test(
      url.pathname,
    )
  )
    return null;
  const last = url.pathname.split("/").at(-1);
  if (last && last.length === 36 && !cimacWorkspaceUuid.test(last)) return null;
  for (const [key, parameter] of [...url.searchParams]) {
    if (key === "returnTo") {
      url.searchParams.delete(key);
      continue;
    }
    if (
      ![
        ...queryKeys,
        "contract",
        "status",
        "sort",
        "direction",
        "projectId",
        "buildingId",
        "view",
        "dateFrom",
        "dateTo",
        "category",
        "management",
        "outstandingOnly",
        "search",
        "month",
        "metric",
      ].includes(key) ||
      controls.test(parameter) ||
      url.searchParams.getAll(key).length !== 1
    )
      return null;
  }
  return `${url.pathname}${url.search}${url.hash}`;
}
export function parseCimacWorkspaceQuery(
  raw: Record<string, unknown> = {},
  section: CimacWorkspaceSection = "assets",
): CimacWorkspaceQuery {
  if (
    Object.keys(raw).some((key) => !queryKeys.includes(key)) ||
    Object.values(raw).some(
      (v) => typeof v !== "string" && typeof v !== "number" && v !== undefined,
    )
  )
    throw new CimacWorkspaceReadError(400);
  const value = (key: string, limit = 200) => {
    const v = raw[key];
    if (v === undefined) return "";
    if (typeof v !== "string" || v.length > limit || controls.test(v))
      throw new CimacWorkspaceReadError(400);
    return v.trim();
  };
  const page = (key: string) => {
    const v = raw[key] ?? "1";
    if (!/^[1-9]\d{0,5}$/.test(String(v)) || Number(v) > 100000)
      throw new CimacWorkspaceReadError(400);
    return Number(v);
  };
  const project = value("project", 40) || "CIMAC",
    building = value("building", 36),
    kind = value("kind", 24),
    filter = value("filter", 32) || "all",
    tab = value("tab", 20) || "overview",
    returnValue = raw.returnTo;
  if (raw.project !== undefined && !value("project", 40)) throw new CimacWorkspaceReadError(400);
  if (
    (project !== "CIMAC" && !cimacWorkspaceUuid.test(project)) ||
    (building && !cimacWorkspaceUuid.test(building)) ||
    (kind && !kinds.includes(kind)) ||
    !(section === "customers" ? customerDirectoryFilters : assetFilters).includes(
      filter as never,
    ) ||
    !(
      section === "customers"
        ? ["overview", "contracts", "account", "records"]
        : ["overview", "contracts", "service", "records"]
    ).includes(tab) ||
    (section === "customers" && kind)
  )
    throw new CimacWorkspaceReadError(400);
  const returnTo = returnValue === undefined ? null : safeCimacReturnTo(returnValue);
  if (returnValue !== undefined && !returnTo) throw new CimacWorkspaceReadError(400);
  const accountTab = value("accountTab", 16) || "bills";
  const membershipStatus = value("membershipStatus", 16) || "current";
  if (
    (raw.membershipStatus !== undefined && section !== "customers") ||
    !["current", "archived"].includes(membershipStatus)
  )
    throw new CimacWorkspaceReadError(400);
  if (
    (raw.accountTab !== undefined && section !== "customers") ||
    !["bills", "receipts", "meters", "rules"].includes(accountTab)
  )
    throw new CimacWorkspaceReadError(400);
  return {
    project: project === "CIMAC" ? project : project.toLowerCase(),
    q: value("q"),
    building: building.toLowerCase(),
    kind,
    filter,
    page: page("page"),
    relationPage: page("relationPage"),
    tab: tab as CimacWorkspaceTab,
    returnTo,
    ...(section === "customers"
      ? {
          accountTab: accountTab as NonNullable<CimacWorkspaceQuery["accountTab"]>,
          membershipStatus: membershipStatus as "current" | "archived",
        }
      : {}),
  };
}
export function cimacWorkspaceHref(
  section: CimacWorkspaceSection,
  locale: "zh" | "fr" = "zh",
  query: Partial<CimacWorkspaceQuery> = {},
  id?: string,
): string {
  const target = id ? `/${cimacWorkspaceId(id)}` : "";
  if (section === "home" && target) throw new CimacWorkspaceReadError(400);
  const path = `${locale === "fr" ? "/fr" : ""}/cimac${section === "home" ? "" : `/${section}`}${target}`;
  const params = new URLSearchParams();
  for (const key of queryKeys) {
    const v = query[key as keyof CimacWorkspaceQuery];
    if (
      v === undefined ||
      v === null ||
      v === "" ||
      (key === "project" && v === "CIMAC") ||
      ((key === "page" || key === "relationPage") && v === 1) ||
      (key === "tab" && v === "overview") ||
      (key === "filter" && v === "all") ||
      (key === "accountTab" && v === "bills") ||
      (key === "membershipStatus" && v === "current")
    )
      continue;
    params.set(key, String(v));
  }
  const parsed = parseCimacWorkspaceQuery(Object.fromEntries(params), section);
  void parsed;
  return `${path}${params.size ? `?${params}` : ""}`;
}
