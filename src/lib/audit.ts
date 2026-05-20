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
 * Write an audit log entry. Does NOT throw — logs errors to console.
 * Auto-fills actor info from the current session.
 */
export async function writeAuditLog(input: AuditInput): Promise<void> {
  try {
    const supabase = await createClient();
    const user = await getCurrentUser();

    const { error } = await supabase.from("audit_logs").insert({
      actor_id: user?.id ?? null,
      actor_email: user?.email ?? null,
      actor_role: user?.role ?? null,
      action: input.action,
      entity_type: input.entityType,
      entity_id: input.entityId ?? null,
      entity_label: input.entityLabel ?? null,
      before_data: input.beforeData ?? null,
      after_data: input.afterData ?? null,
      metadata: input.metadata ?? {},
    });

    if (error) {
      console.error("Audit log write failed:", error.message);
    }
  } catch (err) {
    console.error("Audit log write error:", err);
  }
}

/**
 * Compute a simple diff summary string from before/after objects.
 * Returns null if no changes, or a summary string like "status: available → leased".
 */
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
      changes.push(`${k}: ${String(b ?? "—")} → ${String(a ?? "—")}`);
    }
  }
  return changes.length > 0 ? changes.join("; ") : null;
}

// ── Entity type constants ──
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

// ── Action constants ──
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
