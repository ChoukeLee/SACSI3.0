import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import {
  AuditWorkbenchReadError,
  decodeAuditWorkbench,
  decodeAuditWorkbenchExport,
  decodeAuditWorkbenchLog,
  parseAuditWorkbenchQuery,
  validAuditWorkbenchId,
} from "./audit-workbench-model";
import type { AuditWorkbenchQuery } from "./audit-workbench-types";
import { auditBusinessSummary } from "./audit-business-summary";

type Reader = Pick<SupabaseClient, "rpc">;
async function read(
  client: Reader,
  query: AuditWorkbenchQuery,
  mode: "list" | "export" | "detail",
  id?: string,
) {
  const { data, error } = await client.rpc("audit_workbench_read_rpc", {
    p_input: query,
    p_mode: mode,
    p_log_id: id ?? null,
  });
  if (error)
    throw new AuditWorkbenchReadError(
      error.code === "42501"
        ? 403
        : error.code === "22023"
          ? 400
          : error.code === "P0002"
            ? 404
            : error.code === "54000"
              ? 413
              : 503,
    );
  return data as unknown;
}
export async function readAuditWorkbench(client: Reader, query: AuditWorkbenchQuery) {
  const parsed = parseAuditWorkbenchQuery(query as unknown as Record<string, unknown>);
  return decodeAuditWorkbench(await read(client, parsed, "list"), parsed);
}
export async function initialAuditWorkbench(input: Record<string, unknown> = {}) {
  return readAuditWorkbench(await createClient(), parseAuditWorkbenchQuery(input));
}
export async function readAuditWorkbenchDetail(client: Reader, id: string) {
  if (!validAuditWorkbenchId(id)) throw new AuditWorkbenchReadError(400);
  const value = await read(client, parseAuditWorkbenchQuery(), "detail", id);
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new AuditWorkbenchReadError();
  const log = decodeAuditWorkbenchLog((value as Record<string, unknown>).log, true);
  if (log.id !== id) throw new AuditWorkbenchReadError();
  return { log };
}
export async function readAuditWorkbenchExport(client: Reader, query: AuditWorkbenchQuery) {
  const parsed = parseAuditWorkbenchQuery(query as unknown as Record<string, unknown>);
  return decodeAuditWorkbenchExport(await read(client, parsed, "export"), parsed);
}

/** Every field is a safe fixed projection; no raw JSON, instructions or credentials. */
export function auditWorkbenchCsv(
  rows: Awaited<ReturnType<typeof readAuditWorkbenchExport>>["rows"],
) {
  const cell = (value: unknown) => {
    let text =
      typeof value === "string" || typeof value === "number"
        ? String(value).replace(/\r\n?/g, "\n")
        : "";
    if (/^[\s\uFEFF]*[=+@-]/.test(text) || /^[\t\n]/.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
  };
  const columns = [
    "id",
    "time_utc",
    "recorded_account_id",
    "recorded_account_email",
    "recorded_role",
    "current_account_name_supplement",
    "action",
    "entity_type",
    "entity_id",
    "entity_label",
    "room_reference",
    "current_contract_reference_supplement",
    "recorded_channel",
    "identity_status",
    "request_id",
    "currency",
    "confirmed_total_amount",
    "recorded_actual_collector",
    "recorded_collector_basis",
    "external_receipt_no",
    "recorded_business_amount",
  ];
  return (
    "\uFEFF" +
    [
      columns,
      ...rows.map((row) => {
        const meta = row.metadata ?? {};
        const result =
          meta.collection_result &&
          typeof meta.collection_result === "object" &&
          !Array.isArray(meta.collection_result)
            ? (meta.collection_result as Record<string, unknown>)
            : {};
        const input =
          meta.collection_input &&
          typeof meta.collection_input === "object" &&
          !Array.isArray(meta.collection_input)
            ? (meta.collection_input as Record<string, unknown>)
            : {};
        const channel = [
          "external_codex",
          "sacsi_web",
          "explicit_user_authorized_maintenance",
        ].includes(String(meta.channel))
          ? meta.channel
          : "unknown";
        const identity =
          row.actor_id || row.actor_email?.trim()
            ? "account_recorded"
            : channel === "explicit_user_authorized_maintenance"
              ? "maintenance_without_account"
              : "missing_account";
        return [
          row.id,
          row.created_at,
          row.actor_id,
          row.actor_email,
          row.actor_role,
          row.resolved_actor_display_name,
          row.action,
          row.entity_type,
          row.entity_id,
          row.entity_label,
          meta.unit_no ?? meta.room_no,
          meta.resolved_contract_no,
          channel,
          identity,
          result.requestId ?? meta.request_id,
          result.currency,
          result.totalAmount,
          input.actualCollector,
          input.collectorBasis,
          input.externalReceiptNo,
          auditBusinessSummary(row, "zh").paymentAmount,
        ];
      }),
    ]
      .map((row) => row.map(cell).join(","))
      .join("\r\n")
  );
}
