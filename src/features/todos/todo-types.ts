export type TodoPriority = "high" | "medium" | "low";
export type TodoStatus = "open" | "done" | "ignored";
export type TodoRole = "admin" | "boss" | "finance" | "front_desk";
export type TodoSource = "daily" | "lease" | "sale" | "finance" | "system";
export type TodoType =
  // Daily
  | "daily_checkin_today" | "daily_checkout_today" | "daily_open_long"
  | "daily_pending_review"
  // Lease
  | "lease_expiring_30d" | "lease_expired" | "lease_rent_overdue"
  | "lease_deposit_pending" | "lease_moveout_pending"
  // Sale
  | "sale_installment_due" | "sale_installment_overdue"
  | "sale_settled_undelivered" | "sale_missing_transfer"
  // Finance
  | "finance_receivable_today" | "finance_receivable_overdue"
  | "finance_payment_unconfirmed" | "finance_anomaly"
  // System
  | "system_high_risk_action";

export interface TodoItem {
  id: string;
  type: TodoType;
  source: TodoSource;
  title: string;
  description: string;
  sourceId: string | null;
  unitLabel: string;
  customerName: string;
  amount: number;
  dueDate: string;
  priority: TodoPriority;
  status: TodoStatus;
  href: string;
  roles: TodoRole[];
}
