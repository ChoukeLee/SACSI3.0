export interface CustomerSummary {
  id: string;
  name: string;
  phone: string | null;
  is_blacklisted: boolean;
  has_active_lease_contract?: boolean;
  has_active_sale_contract?: boolean;
}

export function decodeDailyCustomers(value: unknown): CustomerSummary[] {
  if (
    !Array.isArray(value) ||
    value.some(
      (customer) =>
        !customer ||
        typeof customer.id !== "string" ||
        typeof customer.name !== "string" ||
        (customer.phone !== null && typeof customer.phone !== "string") ||
        typeof customer.is_blacklisted !== "boolean" ||
        typeof customer.has_active_lease_contract !== "boolean" ||
        typeof customer.has_active_sale_contract !== "boolean",
    )
  )
    throw new Error("dailyCustomersUnavailable");
  if (new Set(value.map((customer) => customer.id)).size !== value.length)
    throw new Error("dailyCustomersUnavailable");
  return value as CustomerSummary[];
}
