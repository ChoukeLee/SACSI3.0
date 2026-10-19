import "server-only";

import { createClient } from "@/lib/supabase/server";
import { fetchAllPages } from "@/lib/supabase/fetch-all";
import { sortUnits } from "@/lib/utils";
import {
  customerProfileFinancialRows,
  unresolvedCustomerBookings,
} from "./customer-profile-identity";
import type {
  CustomerRow,
  DailyBookingRow,
  LeaseContractRow,
  SaleContractRow,
  ReceivableRow,
  PaymentRow,
  UnitRow,
} from "@/types/database";

export interface ProfileAuditRow {
  id: string;
  created_at: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  metadata: Record<string, unknown> | null;
  actor_id: string | null;
  actor_email: string | null;
}

export interface ProfileAttachmentRow {
  id: string;
  storage_path: string;
  file_type: string;
  ocr_text: string | null;
  metadata: Record<string, unknown> | null;
  paper_archive_status: string;
  uploaded_at: string;
}

export interface CustomerProfileData {
  customer: CustomerRow;
  units: UnitRow[];
  /** Only bookings with an explicit guest relationship. */
  dailyBookings: DailyBookingRow[];
  agentBookings: DailyBookingRow[];
  unresolvedBookings: DailyBookingRow[];
  leaseContracts: LeaseContractRow[];
  saleContracts: SaleContractRow[];
  receivables: ReceivableRow[];
  payments: PaymentRow[];
  auditLogs: ProfileAuditRow[];
  attachments: ProfileAttachmentRow[];
}

function newestFirst<T extends { id: string }>(rows: T[], date: (row: T) => string): T[] {
  return [...new Map(rows.map((row) => [row.id, row])).values()].sort(
    (a, b) => date(b).localeCompare(date(a)) || a.id.localeCompare(b.id),
  );
}

export async function fetchCustomerProfile(
  customerId: string,
): Promise<CustomerProfileData | null> {
  const supabase = await createClient();
  const { data: customer, error } = await supabase
    .from("customers")
    .select("*")
    .eq("id", customerId)
    .maybeSingle();
  if (error) throw new Error("CustomerProfileUnavailable");
  if (!customer) return null;

  const [
    dailyBookings,
    agentBookings,
    legacyBookings,
    leaseContracts,
    saleContracts,
    receivables,
    payments,
    directAttachments,
  ] = await Promise.all([
    fetchAllPages<DailyBookingRow>(
      (from, to) =>
        supabase
          .from("daily_bookings")
          .select("*", { count: "exact" })
          .eq("guest_customer_id", customerId)
          .order("check_in", { ascending: false })
          .order("id")
          .range(from, to),
      "customer guest bookings",
    ),
    fetchAllPages<DailyBookingRow>(
      (from, to) =>
        supabase
          .from("daily_bookings")
          .select("*", { count: "exact" })
          .eq("booking_agent_id", customerId)
          .order("check_in", { ascending: false })
          .order("id")
          .range(from, to),
      "customer agent bookings",
    ),
    fetchAllPages<DailyBookingRow>(
      (from, to) =>
        supabase
          .from("daily_bookings")
          .select("*", { count: "exact" })
          .eq("customer_id", customerId)
          .order("check_in", { ascending: false })
          .order("id")
          .range(from, to),
      "customer unresolved legacy bookings",
    ),
    fetchAllPages<LeaseContractRow>(
      (from, to) =>
        supabase
          .from("lease_contracts")
          .select("*", { count: "exact" })
          .eq("customer_id", customerId)
          .order("start_date", { ascending: false })
          .order("id")
          .range(from, to),
      "customer lease contracts",
    ),
    fetchAllPages<SaleContractRow>(
      (from, to) =>
        supabase
          .from("sale_contracts")
          .select("*", { count: "exact" })
          .eq("customer_id", customerId)
          .order("signed_date", { ascending: false })
          .order("id")
          .range(from, to),
      "customer sale contracts",
    ),
    fetchAllPages<ReceivableRow>(
      (from, to) =>
        supabase
          .from("receivables")
          .select("*", { count: "exact" })
          .eq("customer_id", customerId)
          .order("due_date", { ascending: false })
          .order("id")
          .range(from, to),
      "customer receivables",
    ),
    fetchAllPages<PaymentRow>(
      (from, to) =>
        supabase
          .from("payments")
          .select("*", { count: "exact" })
          .eq("customer_id", customerId)
          .order("payment_date", { ascending: false })
          .order("id")
          .range(from, to),
      "customer payments",
    ),
    fetchAllPages<ProfileAttachmentRow>(
      (from, to) =>
        supabase
          .from("attachments")
          .select(
            "id, storage_path, file_type, ocr_text, metadata, paper_archive_status, uploaded_at",
            { count: "exact" },
          )
          .eq("customer_id", customerId)
          .order("uploaded_at", { ascending: false })
          .order("id")
          .range(from, to),
      "customer attachments",
    ),
  ]);
  const unresolvedBookings = unresolvedCustomerBookings(customerId, legacyBookings);

  const businessIds = [
    ...new Set([...dailyBookings, ...leaseContracts, ...saleContracts].map((row) => row.id)),
  ];
  for (let offset = 0; offset < businessIds.length; offset += 100) {
    const ids = businessIds.slice(offset, offset + 100);
    const [relatedReceivables, relatedPayments] = await Promise.all([
      fetchAllPages<ReceivableRow>(
        (from, to) =>
          supabase
            .from("receivables")
            .select("*", { count: "exact" })
            .in("source_id", ids)
            .order("due_date", { ascending: false })
            .order("id")
            .range(from, to),
        "customer contract receivables",
      ),
      fetchAllPages<PaymentRow>(
        (from, to) =>
          supabase
            .from("payments")
            .select("*", { count: "exact" })
            .in("source_id", ids)
            .order("payment_date", { ascending: false })
            .order("id")
            .range(from, to),
        "customer contract payments",
      ),
    ]);
    receivables.push(...relatedReceivables);
    payments.push(...relatedPayments);
  }
  // Only an explicit guest relationship establishes this customer's daily account.
  // Agent and unresolved legacy relationships remain visible without attributing their debt.
  const customerReceivables = newestFirst(
    customerProfileFinancialRows(customerId, receivables, dailyBookings),
    (row) => row.due_date,
  );
  const customerPayments = newestFirst(
    customerProfileFinancialRows(customerId, payments, dailyBookings),
    (row) => row.payment_date,
  );

  const unitIds = [
    ...new Set(
      [
        ...dailyBookings,
        ...agentBookings,
        ...unresolvedBookings,
        ...leaseContracts,
        ...saleContracts,
      ]
        .map((row) => row.unit_id)
        .filter(Boolean),
    ),
  ];
  const entities = [
    ...new Set([
      customerId,
      ...dailyBookings.map((row) => row.id),
      ...agentBookings.map((row) => row.id),
      ...unresolvedBookings.map((row) => row.id),
      ...leaseContracts.map((row) => row.id),
      ...saleContracts.map((row) => row.id),
      ...receivables.map((row) => row.id),
      ...payments.map((row) => row.id),
    ]),
  ];
  const units: UnitRow[] = [];
  const auditLogs: ProfileAuditRow[] = [];
  const attachments: ProfileAttachmentRow[] = [...directAttachments];
  // Bounded filters avoid oversized PostgREST URLs; every batch remains paged.
  await Promise.all([
    (async () => {
      for (let offset = 0; offset < unitIds.length; offset += 100)
        units.push(
          ...(await fetchAllPages<UnitRow>(
            (from, to) =>
              supabase
                .from("units")
                .select("*", { count: "exact" })
                .in("id", unitIds.slice(offset, offset + 100))
                .order("id")
                .range(from, to),
            "customer units",
          )),
        );
    })(),
    (async () => {
      for (let offset = 0; offset < entities.length; offset += 100)
        auditLogs.push(
          ...(await fetchAllPages<ProfileAuditRow>(
            (from, to) =>
              supabase
                .from("audit_logs")
                .select(
                  "id, created_at, action, entity_type, entity_id, metadata, actor_id, actor_email",
                  {
                    count: "exact",
                  },
                )
                .in("entity_id", entities.slice(offset, offset + 100))
                .order("created_at", { ascending: false })
                .order("id")
                .range(from, to),
            "customer related audit",
          )),
        );
    })(),
    (async () => {
      for (let offset = 0; offset < entities.length; offset += 100)
        attachments.push(
          ...(await fetchAllPages<ProfileAttachmentRow>(
            (from, to) =>
              supabase
                .from("attachments")
                .select(
                  "id, storage_path, file_type, ocr_text, metadata, paper_archive_status, uploaded_at",
                  { count: "exact" },
                )
                .in("linked_id", entities.slice(offset, offset + 100))
                .order("uploaded_at", { ascending: false })
                .order("id")
                .range(from, to),
            "customer related attachments",
          )),
        );
    })(),
  ]);

  return {
    customer: customer as CustomerRow,
    units: sortUnits(units),
    dailyBookings,
    agentBookings,
    unresolvedBookings,
    leaseContracts,
    saleContracts,
    receivables: customerReceivables,
    payments: customerPayments,
    auditLogs: newestFirst(auditLogs, (row) => row.created_at),
    attachments: newestFirst(attachments, (row) => row.uploaded_at),
  };
}
