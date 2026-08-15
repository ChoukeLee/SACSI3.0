import "server-only";

import { createClient } from "@/lib/supabase/server";
import { fetchAllPages } from "@/lib/supabase/fetch-all";
import { sortUnits } from "@/lib/utils";
import type { CustomerRow, LeaseContractRow, PaymentRow, ReceivableRow, UnitRow } from "@/types/database";

const LEASE_PAYMENT_TYPES = [
  "lease_rent",
  "lease_deposit",
  "lease_contract",
  "property_fee",
  "lease_agency_income",
  "lease_agency_expense",
  "lease_furniture_income",
  "lease_deposit_refund",
  "lease_deposit_deduction",
  "lease_rent_refund",
  "lease_other_income",
  "lease_other_expense",
];

const CONTRACT_FIELDS = [
  "id", "unit_id", "customer_id", "contract_no", "start_date", "expected_end_date",
  "expected_end_confirmed", "paid_through_date", "actual_end_date", "payment_cycle", "payment_day",
  "monthly_rent_xof", "deposit_amount_xof", "deposit_received", "rent_free_days", "signer_name",
  "attachment_url", "status",
].join(",");

const PAYMENT_FIELDS = [
  "id", "source_type", "source_id", "payment_date", "amount", "currency",
  "exchange_rate_to_xof", "receipt_no", "notes",
].join(",");

const RECEIVABLE_FIELDS = [
  "id", "source_type", "source_id", "category", "title", "due_date",
  "amount_xof", "paid_amount_xof", "status", "management_status", "currency", "notes",
].join(",");

const UNIT_FIELDS = [
  "id", "building_id", "code", "unit_no", "floor_label", "kind", "status",
  "area_sqm", "layout", "furnishing", "notes",
  "unit_business_flags(business_type,is_enabled,default_price_xof)",
].join(",");

export async function loadLeasePageData() {
  const supabase = await createClient();

  // None of these datasets depends on another. Starting them together removes
  // the former buildings-first round trip from every lease-page navigation.
  const [buildingsRes, contracts, unitsRes, customersRes, payments, receivables] = await Promise.all([
    supabase.from("buildings").select("id, code, display_name").eq("is_active", true).order("code"),
    fetchAllPages(
      (from, to) => supabase.from("lease_contracts")
        .select(CONTRACT_FIELDS)
        .order("start_date", { ascending: false })
        .order("id", { ascending: false })
        .range(from, to),
      "lease page contracts",
    ),
    supabase.from("units").select(UNIT_FIELDS).order("unit_no"),
    supabase.from("customers").select("id, name, phone, notes, is_blacklisted").order("name"),
    fetchAllPages(
      (from, to) => supabase.from("payments")
        .select(PAYMENT_FIELDS)
        .in("source_type", LEASE_PAYMENT_TYPES)
        .order("payment_date", { ascending: false })
        .order("id", { ascending: false })
        .range(from, to),
      "lease page payments",
    ),
    fetchAllPages(
      (from, to) => supabase.from("receivables")
        .select(RECEIVABLE_FIELDS)
        .eq("source_type", "lease_contract")
        .order("due_date", { ascending: false })
        .order("id", { ascending: false })
        .range(from, to),
      "lease page receivables",
    ),
  ]);

  if (buildingsRes.error) throw new Error(`Failed to load lease buildings: ${buildingsRes.error.message}`);
  if (unitsRes.error) throw new Error(`Failed to load lease units: ${unitsRes.error.message}`);
  if (customersRes.error) throw new Error(`Failed to load lease customers: ${customersRes.error.message}`);

  const buildings = buildingsRes.data ?? [];
  const activeBuildingIds = new Set(buildings.map((building) => building.id));
  const rawUnits = (unitsRes.data ?? []) as unknown as Array<UnitRow & {
    unit_business_flags?: Array<{ business_type: string; is_enabled: boolean; default_price_xof: number | null }>;
  }>;
  const units = sortUnits((rawUnits
    .filter((unit) => activeBuildingIds.has(unit.building_id))
    .map((unit) => unit.code === "SACSI7-STOREFRONT" ? {
      ...unit,
      unit_business_flags: [
        ...(unit.unit_business_flags ?? []),
        { business_type: "long_lease", is_enabled: true, default_price_xof: 1_200_000 },
      ],
    } : unit)) as unknown as UnitRow[]);

  return {
    buildings,
    contracts: contracts as unknown as LeaseContractRow[],
    units,
    customers: (customersRes.data ?? []) as unknown as CustomerRow[],
    payments: payments as unknown as PaymentRow[],
    receivables: receivables as unknown as ReceivableRow[],
  };
}
