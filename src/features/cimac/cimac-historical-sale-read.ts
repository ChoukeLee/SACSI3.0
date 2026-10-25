import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  CustomerRow,
  PaymentRow,
  ReceivableRow,
  SaleContractRow,
  SalePaymentScheduleRow,
  UnitRow,
} from "@/types/database";
import { CimacWorkspaceReadError, type CimacWorkspaceScope } from "./cimac-workspace-types";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const paymentTypes = [
  "sale",
  "sale_contract",
  "property_fee",
  "parking_fee",
  "sale_registration_fee",
  "sale_agency_income",
  "sale_agency_expense",
  "sale_other_income",
  "sale_other_expense",
  "sale_refund",
];
const numeric = (value: unknown) =>
  (typeof value === "number" || (typeof value === "string" && value.trim() !== "")) &&
  Number.isFinite(Number(value));
function complete<T>(result: { data: T[] | null; count: number | null; error: unknown }) {
  if (result.error || !result.data || result.count === null || result.count !== result.data.length)
    throw new CimacWorkspaceReadError(503);
  return result.data;
}

/** Historical access does not depend on today's allows_sale flag, and never enables a sale write. */
export async function readCimacHistoricalSale(
  client: Pick<SupabaseClient, "from">,
  scope: CimacWorkspaceScope,
  id: string,
) {
  if (!uuid.test(id)) throw new CimacWorkspaceReadError(400);
  const contractResult = await client.from("sale_contracts").select("*").eq("id", id).maybeSingle();
  if (contractResult.error) throw new CimacWorkspaceReadError(503);
  const contract = contractResult.data as SaleContractRow | null;
  if (
    !contract ||
    contract.id !== id ||
    !uuid.test(contract.unit_id) ||
    !uuid.test(contract.customer_id)
  )
    throw new CimacWorkspaceReadError(404);
  const unitResult = await client
    .from("units")
    .select("*")
    .eq("id", contract.unit_id)
    .maybeSingle();
  if (unitResult.error) throw new CimacWorkspaceReadError(503);
  const unit = unitResult.data as UnitRow | null;
  if (
    !unit ||
    unit.id !== contract.unit_id ||
    !scope.buildings.some((building) => building.id === unit.building_id)
  )
    throw new CimacWorkspaceReadError(403);
  // Recheck the authoritative project relationship before reading any money.
  const buildingResult = await client
    .from("buildings")
    .select("id,project_id")
    .eq("id", unit.building_id)
    .eq("project_id", scope.project.id)
    .maybeSingle();
  if (buildingResult.error) throw new CimacWorkspaceReadError(503);
  if (
    scope.project.code !== "CIMAC" ||
    buildingResult.data?.id !== unit.building_id ||
    buildingResult.data?.project_id !== scope.project.id
  )
    throw new CimacWorkspaceReadError(403);
  const [customerResult, paymentResult, receivableResult, scheduleResult] = await Promise.all([
    client.from("customers").select("*").eq("id", contract.customer_id).maybeSingle(),
    client
      .from("payments")
      .select("*", { count: "exact" })
      .eq("source_id", id)
      .in("source_type", paymentTypes)
      .order("payment_date", { ascending: false })
      .range(0, 4999),
    client
      .from("receivables")
      .select("*", { count: "exact" })
      .eq("source_id", id)
      .eq("source_type", "sale_contract")
      .order("due_date")
      .range(0, 4999),
    client
      .from("sale_payment_schedule")
      .select("*", { count: "exact" })
      .eq("sale_contract_id", id)
      .order("installment_no")
      .range(0, 999),
  ]);
  const customer = customerResult.data as CustomerRow | null;
  if (customerResult.error || !customer || customer.id !== contract.customer_id)
    throw new CimacWorkspaceReadError(503);
  const payments = complete(paymentResult) as PaymentRow[];
  const receivables = complete(receivableResult) as ReceivableRow[];
  const schedules = complete(scheduleResult) as SalePaymentScheduleRow[];
  if (
    (contract.total_amount_xof !== null && !numeric(contract.total_amount_xof)) ||
    payments.some(
      (row) =>
        row.source_id !== id ||
        !paymentTypes.includes(row.source_type) ||
        !numeric(row.amount) ||
        !row.currency ||
        (row.unit_id && row.unit_id !== unit.id) ||
        (row.customer_id && row.customer_id !== customer.id),
    ) ||
    receivables.some(
      (row) =>
        row.source_id !== id ||
        row.source_type !== "sale_contract" ||
        !numeric(row.amount_xof) ||
        !numeric(row.paid_amount_xof) ||
        (row.amount_native != null && !numeric(row.amount_native)) ||
        (row.paid_amount_native != null && !numeric(row.paid_amount_native)),
    ) ||
    schedules.some((row) => row.sale_contract_id !== id || !numeric(row.amount_xof))
  )
    throw new CimacWorkspaceReadError(503);
  return { contract, unit, customer, payments, receivables, schedules };
}
