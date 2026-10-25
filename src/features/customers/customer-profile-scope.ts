import type { CustomerProfileData } from "./customer-profile-service";

/** Shared identity is retained; only explicitly attributed business is shown. */
export function scopeCustomerProfile(
  data: CustomerProfileData,
  buildingIds: readonly string[],
): CustomerProfileData {
  const buildings = new Set(buildingIds);
  const units = data.units.filter((row) => buildings.has(row.building_id));
  const unitIds = new Set(units.map((row) => row.id));
  const byUnit = <T extends { unit_id: string }>(rows: T[]) =>
    rows.filter((row) => unitIds.has(row.unit_id));
  const dailyBookings = byUnit(data.dailyBookings),
    agentBookings = byUnit(data.agentBookings),
    unresolvedBookings = byUnit(data.unresolvedBookings);
  const leaseContracts = byUnit(data.leaseContracts),
    saleContracts = byUnit(data.saleContracts);
  const ids = (rows: { id: string }[]) => new Set(rows.map((row) => row.id));
  // UUIDs are unique inside a table, not across entity types. Never join by UUID alone.
  const attributed: Record<string, Set<string>> = {
    daily_booking: ids([...dailyBookings, ...agentBookings, ...unresolvedBookings]),
    lease_contract: ids(leaseContracts),
    sale_contract: ids(saleContracts),
    unit: unitIds,
    customer: new Set([data.customer.id]),
  };
  const known: Record<string, Set<string>> = {
    daily_booking: ids([...data.dailyBookings, ...data.agentBookings, ...data.unresolvedBookings]),
    lease_contract: ids(data.leaseContracts),
    sale_contract: ids(data.saleContracts),
    unit: ids(data.units),
    customer: new Set([data.customer.id]),
  };
  const sourceKind = (type: string) => {
    if (type === "daily_booking") return type;
    if (
      [
        "lease_contract",
        "lease_rent",
        "lease_deposit",
        "lease_deposit_refund",
        "lease_deposit_deduction",
        "lease_move_out_collection",
      ].includes(type)
    )
      return "lease_contract";
    if (["sale_contract", "sale_payment"].includes(type)) return "sale_contract";
    return null;
  };
  const financial = <
    T extends {
      unit_id: string | null;
      source_type: string;
      source_id: string | null;
      building_id?: string | null;
    },
  >(
    rows: T[],
  ) =>
    rows.filter((row) => {
      if (row.unit_id && !unitIds.has(row.unit_id)) return false;
      if (row.building_id && !buildings.has(row.building_id)) return false;
      const kind = sourceKind(row.source_type);
      if (kind && row.source_id && !attributed[kind].has(row.source_id)) return false;
      return !!(
        (row.unit_id && unitIds.has(row.unit_id)) ||
        (row.building_id && buildings.has(row.building_id)) ||
        (kind && row.source_id && attributed[kind].has(row.source_id))
      );
    });
  const receivables = financial(data.receivables),
    payments = financial(data.payments);
  attributed.receivable = ids(receivables);
  attributed.payment = ids(payments);
  known.receivable = ids(data.receivables);
  known.payment = ids(data.payments);
  return {
    ...data,
    units,
    dailyBookings,
    agentBookings,
    unresolvedBookings,
    leaseContracts,
    saleContracts,
    receivables,
    payments,
    auditLogs: data.auditLogs
      .filter((row) => !!row.entity_id && !!attributed[row.entity_type]?.has(row.entity_id))
      .map((row) => (row.entity_type === "customer" ? { ...row, metadata: null } : row)),
    attachments: data.attachments.filter((row) => {
      if (row.unit_id && !unitIds.has(row.unit_id)) return false;
      if (
        row.linked_id &&
        row.linked_type &&
        known[row.linked_type]?.has(row.linked_id) &&
        !attributed[row.linked_type]?.has(row.linked_id)
      )
        return false;
      if (
        row.linked_id &&
        !row.linked_type &&
        Object.keys(known).some(
          (type) => known[type].has(row.linked_id!) && !attributed[type]?.has(row.linked_id!),
        )
      )
        return false;
      return !!(
        (row.unit_id && unitIds.has(row.unit_id)) ||
        (row.linked_id &&
          row.linked_type &&
          row.linked_type !== "customer" &&
          attributed[row.linked_type]?.has(row.linked_id))
      );
    }),
    projectScope: "SACSI",
  };
}
