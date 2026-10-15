import "server-only";

import { fetchAllPages } from "@/lib/supabase/fetch-all";
import { createClient } from "@/lib/supabase/server";
import type { ProfileAuditRow } from "@/features/customers/customer-profile-service";
import type { UnitPosition } from "./operational-position";
export type { UnitPosition } from "./operational-position";
import type {
  CustomerRow,
  DailyBookingRow,
  LeaseContractRow,
  PaymentRow,
  ReceivableRow,
  SaleContractRow,
  UnitRow,
} from "@/types/database";

export interface UnitProfileData {
  unit: UnitRow;
  position?: UnitPosition;

  buildingName: string;
  dailyBookings: DailyBookingRow[];
  leaseContracts: LeaseContractRow[];
  saleContracts: SaleContractRow[];
  receivables: ReceivableRow[];
  payments: PaymentRow[];
  customers: CustomerRow[];
  auditLogs: ProfileAuditRow[];
}

function newestFirst<T extends { id: string }>(rows: T[], date: (row: T) => string): T[] {
  return [...new Map(rows.map((row) => [row.id, row])).values()].sort(
    (a, b) => date(b).localeCompare(date(a)) || a.id.localeCompare(b.id),
  );
}

export async function fetchUnitProfile(unitId: string): Promise<UnitProfileData | null> {
  const supabase = await createClient();
  const { data: unit, error: unitError } = await supabase
    .from("units")
    .select("*")
    .eq("id", unitId)
    .maybeSingle();
  if (unitError) throw new Error("UnitProfileUnavailable");
  if (!unit) return null;
  const [
    buildingResult,
    positionResult,
    dailyBookings,
    leaseContracts,
    saleContracts,
    receivables,
    payments,
  ] = await Promise.all([
    supabase.from("buildings").select("display_name, code").eq("id", unit.building_id).single(),
    supabase.from("unit_operational_position").select("*").eq("id", unitId).single(),
    fetchAllPages<DailyBookingRow>(
      (from, to) =>
        supabase
          .from("daily_bookings")
          .select("*", { count: "exact" })
          .eq("unit_id", unitId)
          .order("check_in", { ascending: false })
          .order("id")
          .range(from, to),
      "daily bookings",
    ),
    fetchAllPages<LeaseContractRow>(
      (from, to) =>
        supabase
          .from("lease_contracts")
          .select("*", { count: "exact" })
          .eq("unit_id", unitId)
          .order("start_date", { ascending: false })
          .order("id")
          .range(from, to),
      "lease contracts",
    ),
    fetchAllPages<SaleContractRow>(
      (from, to) =>
        supabase
          .from("sale_contracts")
          .select("*", { count: "exact" })
          .eq("unit_id", unitId)
          .order("signed_date", { ascending: false })
          .order("id")
          .range(from, to),
      "sale contracts",
    ),
    fetchAllPages<ReceivableRow>(
      (from, to) =>
        supabase
          .from("receivables")
          .select("*", { count: "exact" })
          .eq("unit_id", unitId)
          .order("due_date", { ascending: false })
          .order("id")
          .range(from, to),
      "receivables",
    ),
    fetchAllPages<PaymentRow>(
      (from, to) =>
        supabase
          .from("payments")
          .select("*", { count: "exact" })
          .eq("unit_id", unitId)
          .order("payment_date", { ascending: false })
          .order("id")
          .range(from, to),
      "payments",
    ),
  ]);
  if (buildingResult.error || positionResult.error) throw new Error("UnitProfileUnavailable");

  // A historical financial row may omit unit_id but retain its explicit business
  // relationship. Never override a recorded non-null unit (e.g. a corrected room),
  // join across source domains by UUID alone, or infer from date/customer/amount.
  const sourceGroups = [
    {
      receivableType: "daily_booking",
      ids: dailyBookings.map((row) => row.id),
      paymentTypes: ["daily_booking"],
    },
    {
      receivableType: "lease_contract",
      ids: leaseContracts.map((row) => row.id),
      paymentTypes: [
        "lease_contract",
        "lease_rent",
        "lease_deposit",
        "lease_deposit_refund",
        "lease_deposit_deduction",
        "lease_rent_refund",
        "lease_agency_income",
        "lease_agency_expense",
        "lease_furniture_income",
        "lease_other_income",
        "lease_other_expense",
      ],
    },
    {
      receivableType: "sale_contract",
      ids: saleContracts.map((row) => row.id),
      paymentTypes: [
        "sale",
        "sale_contract",
        "sale_refund",
        "sale_registration_fee",
        "sale_agency_income",
        "sale_agency_expense",
        "sale_other_income",
        "sale_other_expense",
      ],
    },
  ];
  await Promise.all(
    sourceGroups.map(async (group) => {
      for (let offset = 0; offset < group.ids.length; offset += 100) {
        const ids = group.ids.slice(offset, offset + 100);
        const [relatedReceivables, relatedPayments] = await Promise.all([
          fetchAllPages<ReceivableRow>(
            (from, to) =>
              supabase
                .from("receivables")
                .select("*", { count: "exact" })
                .is("unit_id", null)
                .eq("source_type", group.receivableType)
                .in("source_id", ids)
                .order("due_date", { ascending: false })
                .order("id")
                .range(from, to),
            "unit source receivables",
          ),
          fetchAllPages<PaymentRow>(
            (from, to) =>
              supabase
                .from("payments")
                .select("*", { count: "exact" })
                .is("unit_id", null)
                .in("source_type", group.paymentTypes)
                .in("source_id", ids)
                .order("payment_date", { ascending: false })
                .order("id")
                .range(from, to),
            "unit source payments",
          ),
        ]);
        receivables.push(
          ...relatedReceivables.filter(
            (row) => row.building_id === null || row.building_id === unit.building_id,
          ),
        );
        payments.push(...relatedPayments);
      }
    }),
  );

  // Property/parking fee sources can refer to either lease or sale contracts.
  // Resolve both domains under existing RLS and reject conflicting unit links.
  const feeSources = [...new Set([...leaseContracts, ...saleContracts].map((row) => row.id))];
  for (let offset = 0; offset < feeSources.length; offset += 100) {
    const ids = feeSources.slice(offset, offset + 100);
    const fees = await fetchAllPages<PaymentRow>(
      (from, to) =>
        supabase
          .from("payments")
          .select("*", { count: "exact" })
          .is("unit_id", null)
          .in("source_type", ["property_fee", "parking_fee"])
          .in("source_id", ids)
          .order("payment_date", { ascending: false })
          .order("id")
          .range(from, to),
      "unit source fees",
    );
    if (!fees.length) continue;
    const linkedIds = [...new Set(fees.flatMap((row) => (row.source_id ? [row.source_id] : [])))];
    const links = await Promise.all(
      ["lease_contracts", "sale_contracts"].map((table) =>
        fetchAllPages<{ id: string; unit_id: string }>(
          (from, to) =>
            supabase
              .from(table)
              .select("id,unit_id", { count: "exact" })
              .in("id", linkedIds)
              .order("id")
              .range(from, to),
          "unit fee source contracts",
        ),
      ),
    );
    const unitsBySource = new Map<string, Set<string>>();
    for (const contract of links.flat()) {
      const targets = unitsBySource.get(contract.id) ?? new Set<string>();
      targets.add(contract.unit_id);
      unitsBySource.set(contract.id, targets);
    }
    payments.push(
      ...fees.filter((row) => {
        const targets = row.source_id ? unitsBySource.get(row.source_id) : undefined;
        return targets?.size === 1 && targets.has(unitId);
      }),
    );
  }
  const completeReceivables = newestFirst(receivables, (row) => row.due_date);
  const completePayments = newestFirst(payments, (row) => row.payment_date);

  const customerIds = new Set<string>();
  for (const row of dailyBookings) {
    if (row.customer_id) customerIds.add(row.customer_id);
    if (row.guest_customer_id) customerIds.add(row.guest_customer_id);
    if (row.booking_agent_id) customerIds.add(row.booking_agent_id);
  }
  for (const row of [...leaseContracts, ...saleContracts])
    if (row.customer_id) customerIds.add(row.customer_id);
  // Avoid oversized URL filters; each batch remains ordered and fully paged.
  const ids = [...customerIds];
  const customers: CustomerRow[] = [];
  for (let offset = 0; offset < ids.length; offset += 100)
    customers.push(
      ...(await fetchAllPages<CustomerRow>(
        (from, to) =>
          supabase
            .from("customers")
            .select("*", { count: "exact" })
            .in("id", ids.slice(offset, offset + 100))
            .order("id")
            .range(from, to),
        "customers",
      )),
    );
  const entityIds = [
    ...new Set([
      unitId,
      ...dailyBookings.map((row) => row.id),
      ...leaseContracts.map((row) => row.id),
      ...saleContracts.map((row) => row.id),
      ...completeReceivables.map((row) => row.id),
      ...completePayments.map((row) => row.id),
    ]),
  ];
  const auditLogs: ProfileAuditRow[] = [];
  for (let offset = 0; offset < entityIds.length; offset += 100)
    auditLogs.push(
      ...(await fetchAllPages<ProfileAuditRow>(
        (from, to) =>
          supabase
            .from("audit_logs")
            .select(
              "id, created_at, action, entity_type, entity_id, metadata, actor_id, actor_email",
              { count: "exact" },
            )
            .in("entity_id", entityIds.slice(offset, offset + 100))
            .order("created_at", { ascending: false })
            .order("id")
            .range(from, to),
        "unit related audit",
      )),
    );
  auditLogs.sort((a, b) => b.created_at.localeCompare(a.created_at) || a.id.localeCompare(b.id));
  return {
    unit: unit as UnitRow,
    position: positionResult.data as UnitPosition,
    buildingName: buildingResult.data?.display_name ?? buildingResult.data?.code ?? "-",
    dailyBookings,
    leaseContracts,
    saleContracts,
    receivables: completeReceivables,
    payments: completePayments,
    customers,
    auditLogs,
  };
}
