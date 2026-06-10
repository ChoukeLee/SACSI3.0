import type { createClient } from "@/lib/supabase/server";

export interface AuditLogRow {
  id: string;
  created_at: string;
  actor_id: string | null;
  actor_email: string | null;
  actor_role: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  entity_label: string | null;
  before_data: Record<string, unknown> | null;
  after_data: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
}

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

export async function enrichAuditLogsWithUnitNumbers(
  supabase: SupabaseServerClient,
  logs: AuditLogRow[],
) {
  const unitByEntity = new Map<string, string>();

  await Promise.all([
    collectUnitIds(supabase, logs, unitByEntity, "daily_booking", "daily_bookings"),
    collectUnitIds(supabase, logs, unitByEntity, "lease_contract", "lease_contracts"),
    collectUnitIds(supabase, logs, unitByEntity, "sale_contract", "sale_contracts"),
    collectUnitIds(supabase, logs, unitByEntity, "receivable", "receivables"),
    collectUnitIds(supabase, logs, unitByEntity, "payment", "payments"),
    collectUnitIds(supabase, logs, unitByEntity, "ledger_entry", "ledger_entries"),
    collectUnitIds(supabase, logs, unitByEntity, "cleaning_task", "cleaning_tasks"),
    collectUnitIds(supabase, logs, unitByEntity, "unit", "units", "id"),
  ]);

  const unitIds = new Set<string>();
  for (const log of logs) {
    const metadataUnitId = metadataString(log, "unit_id");
    if (metadataUnitId) unitIds.add(metadataUnitId);
    const entityUnitId = log.entity_id ? unitByEntity.get(entityKey(log.entity_type, log.entity_id)) : null;
    if (entityUnitId) unitIds.add(entityUnitId);
  }

  const unitIdToNo = new Map<string, string>();
  if (unitIds.size > 0) {
    const { data: units } = await supabase
      .from("units")
      .select("id, unit_no")
      .in("id", Array.from(unitIds));

    for (const unit of units ?? []) {
      if (unit.id && unit.unit_no) {
        unitIdToNo.set(String(unit.id), String(unit.unit_no));
      }
    }
  }

  return logs.map((log) => {
    if (metadataString(log, "unit_no")) return log;

    const metadataUnitId = metadataString(log, "unit_id");
    const entityUnitId = log.entity_id ? unitByEntity.get(entityKey(log.entity_type, log.entity_id)) ?? "" : "";
    const unitNo = unitIdToNo.get(metadataUnitId) ?? unitIdToNo.get(entityUnitId);
    if (!unitNo) return log;

    return {
      ...log,
      metadata: {
        ...(log.metadata ?? {}),
        unit_no: unitNo,
      },
    };
  });
}

async function collectUnitIds(
  supabase: SupabaseServerClient,
  logs: AuditLogRow[],
  unitByEntity: Map<string, string>,
  entityType: string,
  table: string,
  unitColumn = "unit_id",
) {
  const ids = Array.from(new Set(logs
    .filter((log) => log.entity_type === entityType && log.entity_id)
    .map((log) => log.entity_id as string)));
  if (ids.length === 0) return;

  const { data } = await (supabase as unknown as {
    from: (tableName: string) => {
      select: (columns: string) => {
        in: (column: string, values: string[]) => Promise<{ data: Record<string, unknown>[] | null }>;
      };
    };
  })
    .from(table)
    .select(`id, ${unitColumn}`)
    .in("id", ids);

  for (const row of data ?? []) {
    const id = String(row.id ?? "");
    const unitId = String(row[unitColumn] ?? "");
    if (id && unitId) unitByEntity.set(entityKey(entityType, id), unitId);
  }
}

function metadataString(log: AuditLogRow, key: string) {
  const value = log.metadata?.[key];
  return value == null ? "" : String(value);
}

function entityKey(entityType: string, entityId: string) {
  return `${entityType}:${entityId}`;
}
