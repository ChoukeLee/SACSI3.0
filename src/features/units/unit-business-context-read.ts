import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { UnitBusinessContext, UnitBusinessRelation } from "./unit-workbench-model";

export class UnitBusinessContextError extends Error {
  constructor(public status = 503) {
    super("UnitBusinessContextUnavailable");
  }
}
type Client = Pick<SupabaseClient, "from">;
type Party = { name: string } | { name: string }[] | null;
const name = (party: Party) => (Array.isArray(party) ? party[0]?.name : party?.name) ?? null;
const sources = [
  {
    table: "lease_contracts",
    type: "lease",
    columns:
      "id,unit_id,customer_id,contract_no,status,start_date,actual_end_date,expected_end_date,expected_end_confirmed,created_at,customer:customers(name)",
  },
  {
    table: "sale_contracts",
    type: "sale",
    columns:
      "id,unit_id,customer_id,contract_no,status,signed_date,created_at,customer:customers(name)",
  },
  {
    table: "daily_bookings",
    type: "daily",
    columns:
      "id,unit_id,guest_customer_id,guest_name,booking_agent_id,status,check_in,check_out,checkout_mode,actual_check_out,created_at,guest:customers!daily_bookings_guest_customer_id_fkey(name),agent:customers!daily_bookings_booking_agent_id_fkey(name)",
  },
] as const;
type ContextRow = {
  id: string;
  unit_id: string;
  customer_id?: string;
  contract_no?: string;
  status: string;
  start_date?: string;
  signed_date?: string;
  expected_end_date?: string;
  actual_end_date?: string | null;
  expected_end_confirmed?: boolean;
  customer?: Party;
  guest_customer_id?: string | null;
  guest_name?: string | null;
  booking_agent_id?: string | null;
  check_in?: string;
  check_out?: string | null;
  checkout_mode?: string;
  actual_check_out?: string | null;
  guest?: Party;
  agent?: Party;
};

/** Exact asset identity and current RLS are checked before any history is read. Each response contains at most 30 explicit business relationships. */
export async function readUnitBusinessContext(
  client: Client,
  unitId: string,
  page: number,
  scope?: { project?: string; building?: string },
): Promise<UnitBusinessContext> {
  const unitResult = await client
    .from("units")
    .select("id,building_id")
    .eq("id", unitId)
    .maybeSingle();
  if (unitResult.error) throw new UnitBusinessContextError();
  if (!unitResult.data) throw new UnitBusinessContextError(404);
  const unit = unitResult.data as { id: string; building_id: string };
  const buildingResult = await client
    .from("buildings")
    .select("id,project_id")
    .eq("id", unit.building_id)
    .maybeSingle();
  if (buildingResult.error) throw new UnitBusinessContextError();
  const building = buildingResult.data as { id: string; project_id: string } | null;
  if (
    !building ||
    (scope?.building && building.id !== scope.building) ||
    (scope?.project && building.project_id !== scope.project)
  )
    throw new UnitBusinessContextError(404);
  const counts = await Promise.all(
    sources.map(async (source) => {
      const result = await client
        .from(source.table)
        .select("id", { count: "exact", head: true })
        .eq("unit_id", unit.id);
      if (
        result.error ||
        result.count === null ||
        !Number.isSafeInteger(result.count) ||
        result.count < 0
      )
        throw new UnitBusinessContextError();
      return result.count;
    }),
  );
  const total = counts.reduce((sum, count) => sum + count, 0);
  const from = (page - 1) * 30;
  if (page > 1 && from >= total) throw new UnitBusinessContextError(404);
  let offset = 0;
  const reads = sources.map(async (source, index) => {
    const sourceOffset = offset;
    offset += counts[index];
    const first = Math.max(0, from - sourceOffset);
    const last = Math.min(counts[index] - 1, from + 29 - sourceOffset);
    if (last < first) return [];
    const result = await client
      .from(source.table)
      .select(source.columns)
      .eq("unit_id", unit.id)
      .order("created_at", { ascending: false })
      .order("id")
      .range(first, last);
    if (result.error || !result.data || result.data.length !== last - first + 1)
      throw new UnitBusinessContextError();
    return (result.data as unknown as ContextRow[]).map((row): UnitBusinessRelation => {
      if (row.unit_id !== unit.id) throw new UnitBusinessContextError();
      const actualEnd =
        source.type === "lease"
          ? row.actual_end_date
          : source.type === "daily"
            ? row.actual_check_out
            : null;
      const expectedEnd =
        source.type === "lease"
          ? row.expected_end_confirmed !== false &&
            row.expected_end_date &&
            row.expected_end_date < "2099-01-01"
            ? row.expected_end_date
            : null
          : source.type === "daily" && row.checkout_mode !== "open"
            ? row.check_out
            : null;
      const end = actualEnd ?? expectedEnd ?? null;
      return {
        id: row.id,
        type: source.type,
        contractNo: row.contract_no ?? null,
        status: row.status,
        start: row.start_date ?? row.signed_date ?? row.check_in ?? null,
        end,
        endDateKind: actualEnd ? "actual" : expectedEnd ? "expected" : null,
        endConfirmed: end !== null,
        customerId:
          source.type === "daily" ? (row.guest_customer_id ?? null) : (row.customer_id ?? null),
        customerName:
          source.type === "daily"
            ? (name(row.guest ?? null) ?? row.guest_name?.trim() ?? null)
            : name(row.customer ?? null),
        agentId: source.type === "daily" ? (row.booking_agent_id ?? null) : null,
        agentName: source.type === "daily" ? name(row.agent ?? null) : null,
      };
    });
  });
  return {
    unitId: unit.id,
    buildingId: building.id,
    projectId: building.project_id,
    relations: (await Promise.all(reads)).flat(),
    total,
    page,
  };
}
