import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";

export interface AuditInput {
  action: string;
  entityType: string;
  entityId?: string | null;
  entityLabel?: string | null;
  beforeData?: Record<string, unknown> | null;
  afterData?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
}

/**
 * Write an audit log entry and attach the current actor when available.
 *
 * The deployed database may still use the original audit_logs schema, which
 * only has actor_id/action/entity_type/entity_id/metadata/created_at. When the
 * enhanced columns are missing, keep actor and label details inside metadata so
 * operational logs are still recorded and searchable.
 */
export async function writeAuditLog(input: AuditInput): Promise<void> {
  try {
    const supabase = await createClient();
    const user = await getCurrentUser();

    const metadata = {
      ...(input.metadata ?? {}),
      actor_email: user?.email ?? null,
      actor_role: user?.role ?? null,
      actor_display_name: user?.displayName ?? null,
      entity_label: input.entityLabel ?? null,
      before_data: input.beforeData ?? null,
      after_data: input.afterData ?? null,
    };

    const enhancedPayload = {
      actor_id: user?.id ?? null,
      actor_email: user?.email ?? null,
      actor_role: user?.role ?? null,
      action: input.action,
      entity_type: input.entityType,
      entity_id: input.entityId ?? null,
      entity_label: input.entityLabel ?? null,
      before_data: input.beforeData ?? null,
      after_data: input.afterData ?? null,
      metadata,
    };

    const { error } = await supabase.from("audit_logs").insert(enhancedPayload);
    if (!error) return;

    const isLegacySchema =
      error.code === "42703" ||
      error.message.includes("actor_email") ||
      error.message.includes("actor_role") ||
      error.message.includes("entity_label") ||
      error.message.includes("before_data") ||
      error.message.includes("after_data");

    if (!isLegacySchema) {
      throw error;
    }

    const { error: fallbackError } = await supabase.from("audit_logs").insert({
      actor_id: user?.id ?? null,
      action: input.action,
      entity_type: input.entityType,
      entity_id: input.entityId ?? null,
      metadata,
    });

    if (fallbackError) {
      throw fallbackError;
    }
  } catch (err) {
    console.error("Audit log write error:", err);
    throw err;
  }
}

export function diffSummary(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown> | null | undefined,
): string | null {
  if (!before || !after) return null;
  const changes: string[] = [];
  const allKeys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const k of allKeys) {
    const b = before[k];
    const a = after[k];
    if (JSON.stringify(b) !== JSON.stringify(a)) {
      changes.push(`${k}: ${String(b ?? "-")} -> ${String(a ?? "-")}`);
    }
  }
  return changes.length > 0 ? changes.join("; ") : null;
}

export const EntityType = {
  DAILY_BOOKING: "daily_booking",
  LEASE_CONTRACT: "lease_contract",
  SALE_CONTRACT: "sale_contract",
  UNIT: "unit",
  CUSTOMER: "customer",
  PAYMENT: "payment",
  RECEIVABLE: "receivable",
  LEDGER_ENTRY: "ledger_entry",
  USER: "user",
  BUILDING: "building",
  SETTLEMENT: "lease_settlement",
} as const;

export const AuditAction = {
  CREATE: "create",
  UPDATE: "update",
  DELETE: "delete",
  ACTIVATE: "activate",
  TERMINATE: "terminate",
  CHECK_IN: "check_in",
  CHECK_OUT: "check_out",
  CANCEL: "cancel",
  PAYMENT: "payment",
  MOVE_OUT: "move_out",
  STATUS_CHANGE: "status_change",
  ROLE_CHANGE: "role_change",
  GENERATE: "generate",
} as const;
