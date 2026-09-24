export interface CustomerSummary {
  id: string;
  name: string;
  phone: string | null;
  is_blacklisted: boolean;
  has_active_lease_contract?: boolean;
  has_active_sale_contract?: boolean;
}
