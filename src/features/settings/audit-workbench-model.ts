import type { AuditLogRow } from "./audit-log-enrichment";
import type {
  AuditWorkbenchExport,
  AuditWorkbenchFilters,
  AuditWorkbenchQuery,
  AuditWorkbenchResult,
} from "./audit-workbench-types";

export class AuditWorkbenchReadError extends Error {
  constructor(public status: 400 | 403 | 404 | 413 | 503 = 503) {
    super(
      status === 400
        ? "invalidAuditWorkbench"
        : status === 403
          ? "auditWorkbenchPermissionDenied"
          : status === 404
            ? "auditWorkbenchNotFound"
            : status === 413
              ? "auditWorkbenchExportTooLarge"
              : "auditWorkbenchUnavailable",
    );
  }
}
export const auditWorkbenchFilterKeys = [
  "dateFrom",
  "dateTo",
  "action",
  "entityType",
  "actor",
  "channel",
  "identity",
  "search",
] as const;
const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
export function validAuditWorkbenchId(value: unknown): value is string {
  return typeof value === "string" && uuid.test(value);
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new AuditWorkbenchReadError();
  return value as Record<string, unknown>;
}
function date(value: string) {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !value.startsWith("0000") &&
    !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) &&
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value
  );
}
export function parseAuditWorkbenchQuery(input: Record<string, unknown> = {}): AuditWorkbenchQuery {
  if (
    Object.keys(input).some(
      (key) =>
        ![...auditWorkbenchFilterKeys, "page"].includes(
          key as (typeof auditWorkbenchFilterKeys)[number],
        ),
    )
  )
    throw new AuditWorkbenchReadError(400);
  const filters = {} as AuditWorkbenchFilters;
  for (const key of auditWorkbenchFilterKeys) {
    const value = Object.hasOwn(input, key) ? input[key] : "";
    if (
      typeof value !== "string" ||
      value.length > (key === "search" || key === "actor" ? 200 : 100) ||
      /[\u0000-\u001f\u007f]/.test(value)
    )
      throw new AuditWorkbenchReadError(400);
    filters[key] = value.trim();
  }
  if (
    (filters.dateFrom && !date(filters.dateFrom)) ||
    (filters.dateTo && !date(filters.dateTo)) ||
    (filters.dateFrom && filters.dateTo && filters.dateFrom > filters.dateTo)
  )
    throw new AuditWorkbenchReadError(400);
  if (
    filters.channel &&
    !["external_codex", "sacsi_web", "explicit_user_authorized_maintenance", "unknown"].includes(
      filters.channel,
    )
  )
    throw new AuditWorkbenchReadError(400);
  if (
    filters.identity &&
    !["account_recorded", "missing_account", "maintenance_without_account"].includes(
      filters.identity,
    )
  )
    throw new AuditWorkbenchReadError(400);
  const rawPage = Object.hasOwn(input, "page") ? input.page : 1;
  if (!(
    (typeof rawPage === "number" && Number.isInteger(rawPage)) ||
    (typeof rawPage === "string" && /^[1-9]\d{0,5}$/.test(rawPage))
  ))
    throw new AuditWorkbenchReadError(400);
  const page = Number(rawPage);
  if (!Number.isSafeInteger(page) || page < 1 || page > 100000)
    throw new AuditWorkbenchReadError(400);
  return { ...filters, page };
}
export function auditWorkbenchSearchParams(
  query: AuditWorkbenchQuery | AuditWorkbenchFilters,
): URLSearchParams {
  const result = new URLSearchParams();
  for (const key of auditWorkbenchFilterKeys) if (query[key]) result.set(key, query[key]);
  if ("page" in query && query.page !== 1) result.set("page", String(query.page));
  return result;
}
function integer(value: unknown) {
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw new AuditWorkbenchReadError();
  return value as number;
}
export function decodeAuditWorkbenchLog(value: unknown, detail = false): AuditLogRow {
  const row = object(value);
  if (
    !validAuditWorkbenchId(row.id) ||
    typeof row.created_at !== "string" ||
    !Number.isFinite(Date.parse(row.created_at)) ||
    typeof row.action !== "string" ||
    typeof row.entity_type !== "string"
  )
    throw new AuditWorkbenchReadError();
  for (const key of ["actor_id", "entity_id"])
    if (row[key] !== null && !validAuditWorkbenchId(row[key])) throw new AuditWorkbenchReadError();
  for (const key of [
    "actor_email",
    "actor_role",
    "entity_label",
    "resolved_actor_display_name",
    "resolved_booking_agent_name",
  ])
    if (row[key] !== null && typeof row[key] !== "string") throw new AuditWorkbenchReadError();
  for (const key of ["metadata", "before_data", "after_data"])
    if (row[key] !== null) object(row[key]);
  if (!detail && (row.before_data !== null || row.after_data !== null))
    throw new AuditWorkbenchReadError();
  if (!row.actor_id && !row.actor_email && row.resolved_actor_display_name)
    throw new AuditWorkbenchReadError();
  return row as unknown as AuditLogRow;
}
function decodeFilters(value: unknown, query: AuditWorkbenchQuery) {
  const parsed = parseAuditWorkbenchQuery(object(value));
  for (const key of auditWorkbenchFilterKeys)
    if (parsed[key] !== query[key]) throw new AuditWorkbenchReadError();
  const { page: _page, ...filters } = parsed;
  return filters;
}
export function decodeAuditWorkbench(
  value: unknown,
  query: AuditWorkbenchQuery,
): AuditWorkbenchResult {
  const result = object(value),
    summary = object(result.summary),
    options = object(result.options);
  const total = integer(result.total),
    page = integer(result.page);
  if (
    page !== query.page ||
    result.pageSize !== 30 ||
    !Array.isArray(result.rows) ||
    result.rows.length !== Math.min(30, Math.max(0, total - (page - 1) * 30))
  )
    throw new AuditWorkbenchReadError();
  const counts = {
    total: integer(summary.total),
    recorded: integer(summary.recorded),
    missingIdentity: integer(summary.missingIdentity),
    maintenance: integer(summary.maintenance),
  };
  if (
    counts.total !== total ||
    counts.recorded + counts.missingIdentity + counts.maintenance !== total
  )
    throw new AuditWorkbenchReadError();
  if (
    !Array.isArray(options.actions) ||
    !Array.isArray(options.entityTypes) ||
    !Array.isArray(options.actors) ||
    [...options.actions, ...options.entityTypes].some((v) => typeof v !== "string")
  )
    throw new AuditWorkbenchReadError();
  const actors = options.actors.map((value) => {
    const actor = object(value);
    if (typeof actor.key !== "string" || typeof actor.label !== "string")
      throw new AuditWorkbenchReadError();
    return { key: actor.key, label: actor.label };
  });
  const rows = result.rows.map((row) => decodeAuditWorkbenchLog(row));
  if (new Set(rows.map((row) => row.id)).size !== rows.length) throw new AuditWorkbenchReadError();
  return {
    rows,
    total,
    page,
    pageSize: 30,
    filters: decodeFilters(result.filters, query),
    summary: counts,
    options: {
      actions: options.actions as string[],
      entityTypes: options.entityTypes as string[],
      actors,
    },
  };
}
export function decodeAuditWorkbenchExport(
  value: unknown,
  query: AuditWorkbenchQuery,
): AuditWorkbenchExport {
  const result = object(value),
    total = integer(result.total);
  if (!Array.isArray(result.rows) || result.rows.length !== total || total > 100000)
    throw new AuditWorkbenchReadError();
  const rows = result.rows.map((row) => decodeAuditWorkbenchLog(row));
  if (new Set(rows.map((row) => row.id)).size !== total) throw new AuditWorkbenchReadError();
  return { rows, total, filters: decodeFilters(result.filters, query) };
}
