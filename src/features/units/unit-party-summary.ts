/** Current parties from the authorized unit catalogue, never inferred from legacy agent IDs. */
export interface UnitPartySummary {
  dailyCustomerName?: string;
  dailyDateText?: string;
  dailyStatus?: string;
  leaseCustomerName?: string;
  leaseEndDate?: string;
  leaseEndConfirmed?: boolean;
  pendingLeaseCustomerName?: string;
  pendingLeaseEndDate?: string;
  pendingLeaseEndConfirmed?: boolean;
  saleCustomerName?: string;
}
