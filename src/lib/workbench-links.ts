/** Stable, same-origin links between business workbenches. No names or occupants are inferred. */
export type WorkbenchRecordWorkspace = "sales" | "leases" | "customers" | "units";

export interface WorkbenchRecordLink {
  workspace: WorkbenchRecordWorkspace;
  id: string;
  locale?: "zh" | "fr";
  project?: string | null;
  building?: string | null;
  returnTo?: string | null;
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const targetKeys: Record<WorkbenchRecordWorkspace, string> = {
  sales: "contract",
  leases: "contract",
  customers: "customer",
  units: "unit",
};
const controlCharacters = /[\u0000-\u001f\u007f]/;
const returnOrigin = "https://workbench.invalid";
const directBusinessPaths = new Set([
  "management",
  "sales",
  "leases",
  "customers",
  "units",
  "finance",
  "reports",
  "daily-rentals",
  "daily-rentals/receipts",
]);
const sensitiveParameters = new Set([
  "token",
  "access_token",
  "refresh_token",
  "password",
  "authorization",
  "code",
]);

/**
 * Only existing business GET pages are valid return destinations. In particular,
 * this is not a general-purpose redirect URL and cannot point to login/API/actions.
 * Nested returnTo is removed so multi-workbench navigation does not grow forever.
 */
export function safeWorkbenchReturnTo(value: unknown): string | null {
  if (
    typeof value !== "string" ||
    !value ||
    value.length > 2400 ||
    value !== value.trim() ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\") ||
    controlCharacters.test(value)
  )
    return null;
  let url: URL;
  try {
    url = new URL(value, returnOrigin);
  } catch {
    return null;
  }
  if (url.origin !== returnOrigin || url.username || url.password) return null;
  const path = url.pathname.replace(/^\/fr\//, "/").slice(1);
  const detail = path.match(/^(customers|units)\/([^/]+)$/);
  if (!directBusinessPaths.has(path) && !(detail && uuid.test(detail[2]))) return null;
  for (const [key, parameter] of [...url.searchParams.entries()]) {
    if (sensitiveParameters.has(key.toLowerCase()) || controlCharacters.test(parameter))
      return null;
    if (key.toLowerCase() === "returnto") url.searchParams.delete(key);
  }
  return `${url.pathname}${url.search}${url.hash}`;
}

export function buildWorkbenchRecordHref({
  workspace,
  id,
  locale = "zh",
  project,
  building,
  returnTo,
}: WorkbenchRecordLink): string | null {
  if (!uuid.test(id) || !Object.prototype.hasOwnProperty.call(targetKeys, workspace)) return null;
  const params = new URLSearchParams();
  params.set(targetKeys[workspace], id);
  if (project && uuid.test(project)) params.set("project", project);
  if (building && uuid.test(building)) params.set("building", building);
  const safeReturn = safeWorkbenchReturnTo(returnTo);
  if (safeReturn) params.set("returnTo", safeReturn);
  return `${locale === "fr" ? "/fr" : ""}/${workspace}?${params}`;
}
