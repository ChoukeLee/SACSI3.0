import type {
  DailyBookingRow, LeaseContractRow, SaleContractRow,
  ReceivableRow, UnitRow, CustomerRow,
} from "@/types/database";
import type { TodoItem, TodoRole, TodoPriority } from "./todo-types";

const today = new Date().toISOString().slice(0, 10);
const weekLater = (() => { const d = new Date(); d.setDate(d.getDate() + 7); return d.toISOString().slice(0, 10); })();
const monthLater = (() => { const d = new Date(); d.setDate(d.getDate() + 30); return d.toISOString().slice(0, 10); })();

function u(units: UnitRow[], id?: string | null): UnitRow | undefined {
  return id ? units.find(u => u.id === id) : undefined;
}
function cust(customers: CustomerRow[], id?: string | null): CustomerRow | undefined {
  return id ? customers.find(c => c.id === id) : undefined;
}

function makeId(prefix: string, id: string) { return `${prefix}_${id}`; }

interface DataInput {
  dailyBookings: DailyBookingRow[];
  leaseContracts: LeaseContractRow[];
  saleContracts: SaleContractRow[];
  receivables: ReceivableRow[];
  units: UnitRow[];
  customers: CustomerRow[];
  targetRole?: TodoRole;
}

export function computeTodos(input: DataInput): TodoItem[] {
  const { dailyBookings, leaseContracts, saleContracts, receivables, units, customers, targetRole } = input;
  const todos: TodoItem[] = [];

  // ── Daily: pending review ──
  for (const b of dailyBookings) {
    if (b.status !== "pending_review") continue;
    const unit = u(units, b.unit_id);
    const c = cust(customers, b.customer_id);
    todos.push({
      id: makeId("daily_pending", b.id), type: "daily_pending_review", source: "daily",
      title: `待确认预订 ${unit?.unit_no ?? ""} ${b.check_in}`,
      description: `客户 ${c?.name ?? "—"}${c?.phone ? ` (${c.phone})` : ""}，入住 ${b.check_in}`,
      sourceId: b.id, unitLabel: unit?.unit_no ?? "", customerName: c?.name ?? "",
      amount: Number(b.total_amount_xof), dueDate: b.check_in,
      priority: "medium", status: "open",
      href: "/daily-rentals",
      roles: ["admin", "front_desk", "boss"],
    });
  }

  // ── Daily: check-in today ──
  for (const b of dailyBookings) {
    if ((b.status !== "confirmed" && b.status !== "pending_review") || b.check_in !== today) continue;
    const unit = u(units, b.unit_id);
    const c = cust(customers, b.customer_id);
    todos.push({
      id: makeId("daily_checkin", b.id), type: "daily_checkin_today", source: "daily",
      title: `今日待入住 ${unit?.unit_no ?? ""} ${b.check_in}`,
      description: `客户 ${c?.name ?? "—"}，${b.checkout_mode === "open" ? "开放式入住" : `预计退房 ${b.check_out ?? "—"}`}`,
      sourceId: b.id, unitLabel: unit?.unit_no ?? "", customerName: c?.name ?? "",
      amount: Number(b.total_amount_xof), dueDate: today,
      priority: "high", status: "open",
      href: "/daily-rentals",
      roles: ["admin", "front_desk", "boss"],
    });
  }

  // ── Daily: check-out today ──
  for (const b of dailyBookings) {
    if (b.status !== "checked_in") continue;
    const isFixedToday = b.check_out === today;
    const isOpen = b.checkout_mode === "open";
    if (!isFixedToday && !isOpen) continue;
    const unit = u(units, b.unit_id);
    const c = cust(customers, b.customer_id);
    const nights = Math.ceil((Date.now() - new Date(b.check_in).getTime()) / 86400000);
    todos.push({
      id: makeId("daily_checkout", b.id), type: "daily_checkout_today", source: "daily",
      title: isOpen
        ? `开放式住宿已住 ${nights} 天 ${unit?.unit_no ?? ""}`
        : `今日待退房 ${unit?.unit_no ?? ""}`,
      description: isOpen
        ? `客户 ${c?.name ?? "—"}，已住 ${nights} 天，需关注结算`
        : `客户 ${c?.name ?? "—"}，预计退房 ${b.check_out}`,
      sourceId: b.id, unitLabel: unit?.unit_no ?? "", customerName: c?.name ?? "",
      amount: Number(b.total_amount_xof), dueDate: today,
      priority: isOpen ? "medium" : "high", status: "open",
      href: "/daily-rentals",
      roles: ["admin", "front_desk", "boss"],
    });
  }

  // ── Daily: open-ended > 3 days ──
  for (const b of dailyBookings) {
    if (b.status !== "checked_in" || b.checkout_mode !== "open") continue;
    const nights = Math.ceil((Date.now() - new Date(b.check_in).getTime()) / 86400000);
    if (nights < 4) continue;
    const unit = u(units, b.unit_id);
    const c = cust(customers, b.customer_id);
    todos.push({
      id: makeId("daily_open_long", b.id), type: "daily_open_long", source: "daily",
      title: `开放式住宿超过 ${nights} 天 ${unit?.unit_no ?? ""}`,
      description: `客户 ${c?.name ?? "—"}，已住 ${nights} 天，建议提醒退房或转为长租`,
      sourceId: b.id, unitLabel: unit?.unit_no ?? "", customerName: c?.name ?? "",
      amount: Number(b.total_amount_xof), dueDate: today,
      priority: "medium", status: "open",
      href: "/daily-rentals",
      roles: ["admin", "front_desk", "boss"],
    });
  }

  // ── Lease: expiring within 30 days ──
  for (const lc of leaseContracts) {
    if (lc.status !== "active") continue;
    if (lc.expected_end_date > monthLater || lc.expected_end_date < today) continue;
    const unit = u(units, lc.unit_id);
    const c = cust(customers, lc.customer_id);
    const daysLeft = Math.ceil((new Date(lc.expected_end_date).getTime() - Date.now()) / 86400000);
    todos.push({
      id: makeId("lease_expiring", lc.id), type: "lease_expiring_30d", source: "lease",
      title: `合同即将到期 ${lc.contract_no} (${daysLeft}天)`,
      description: `${unit?.unit_no ?? ""} ${c?.name ?? "—"}，预计退租 ${lc.expected_end_date}，月租 ${formatXofRaw(Number(lc.monthly_rent_xof))}`,
      sourceId: lc.id, unitLabel: unit?.unit_no ?? "", customerName: c?.name ?? "",
      amount: Number(lc.monthly_rent_xof), dueDate: lc.expected_end_date,
      priority: daysLeft <= 7 ? "high" : "medium", status: "open",
      href: "/leases",
      roles: ["admin", "finance", "boss"],
    });
  }

  // ── Lease: expired but not terminated ──
  for (const lc of leaseContracts) {
    if (lc.status !== "active") continue;
    if (lc.expected_end_date >= today) continue;
    const unit = u(units, lc.unit_id);
    const c = cust(customers, lc.customer_id);
    todos.push({
      id: makeId("lease_expired", lc.id), type: "lease_expired", source: "lease",
      title: `合同已到期未退租 ${lc.contract_no}`,
      description: `${unit?.unit_no ?? ""} ${c?.name ?? "—"}，到期 ${lc.expected_end_date}，请尽快退租结算`,
      sourceId: lc.id, unitLabel: unit?.unit_no ?? "", customerName: c?.name ?? "",
      amount: Number(lc.monthly_rent_xof), dueDate: lc.expected_end_date,
      priority: "high", status: "open",
      href: "/leases",
      roles: ["admin", "finance", "boss"],
    });
  }

  // ── Lease: rent overdue from receivables ──
  for (const r of receivables) {
    if (r.source_type !== "lease_contract" || r.category !== "lease_rent") continue;
    if (r.status === "cancelled" || r.status === "paid") continue;
    const unpaid = Number(r.amount_xof) - Number(r.paid_amount_xof);
    if (unpaid <= 0) continue;
    const isOverdue = r.status === "overdue" || r.due_date < today;
    if (!isOverdue && r.due_date > weekLater) continue;
    const unit = u(units, r.unit_id);
    const c = cust(customers, r.customer_id);
    todos.push({
      id: makeId("lease_overdue", r.id), type: "lease_rent_overdue", source: "lease",
      title: isOverdue ? `长租租金逾期 ${r.title}` : `长租租金即将到期 ${r.title}`,
      description: `${unit?.unit_no ?? ""} ${c?.name ?? "—"}，应收 ${formatXofRaw(Number(r.amount_xof))}，未收 ${formatXofRaw(unpaid)}，${r.due_date}`,
      sourceId: r.source_id, unitLabel: unit?.unit_no ?? "", customerName: c?.name ?? "",
      amount: unpaid, dueDate: r.due_date,
      priority: isOverdue ? "high" : "medium", status: "open",
      href: "/leases",
      roles: ["admin", "finance", "boss"],
    });
  }

  // ── Lease: deposit not received ──
  for (const lc of leaseContracts) {
    if (lc.status !== "active") continue;
    if (lc.deposit_received || Number(lc.deposit_amount_xof) <= 0) continue;
    const unit = u(units, lc.unit_id);
    const c = cust(customers, lc.customer_id);
    todos.push({
      id: makeId("lease_deposit", lc.id), type: "lease_deposit_pending", source: "lease",
      title: `押金待收 ${lc.contract_no}`,
      description: `${unit?.unit_no ?? ""} ${c?.name ?? "—"}，押金 ${formatXofRaw(Number(lc.deposit_amount_xof))} 尚未收取`,
      sourceId: lc.id, unitLabel: unit?.unit_no ?? "", customerName: c?.name ?? "",
      amount: Number(lc.deposit_amount_xof), dueDate: lc.start_date,
      priority: "medium", status: "open",
      href: "/leases",
      roles: ["admin", "finance", "boss"],
    });
  }

  // ── Sale: installment due within 7 days ──
  for (const r of receivables) {
    if (r.source_type !== "sale_contract") continue;
    if (r.status === "paid" || r.status === "cancelled") continue;
    const unpaid = Number(r.amount_xof) - Number(r.paid_amount_xof);
    if (unpaid <= 0) continue;
    if (r.due_date > weekLater && r.due_date >= today) continue;
    const isOverdue = r.status === "overdue" || r.due_date < today;
    const unit = u(units, r.unit_id);
    const c = cust(customers, r.customer_id);
    todos.push({
      id: makeId("sale_installment", r.id),
      type: isOverdue ? "sale_installment_overdue" : "sale_installment_due",
      source: "sale",
      title: isOverdue ? `出售分期逾期 ${r.title}` : `出售分期即将到期 ${r.title}`,
      description: `${unit?.unit_no ?? ""} ${c?.name ?? "—"}，应收 ${formatXofRaw(Number(r.amount_xof))}，未收 ${formatXofRaw(unpaid)}`,
      sourceId: r.source_id, unitLabel: unit?.unit_no ?? "", customerName: c?.name ?? "",
      amount: unpaid, dueDate: r.due_date,
      priority: isOverdue ? "high" : "medium", status: "open",
      href: "/sales",
      roles: ["admin", "finance", "boss"],
    });
  }

  // ── Sale: settled but transfer not completed ──
  for (const sc of saleContracts) {
    if (sc.status !== "active") continue;
    const totalRecForContract = receivables
      .filter(r => r.source_type === "sale_contract" && r.source_id === sc.id && r.status !== "cancelled")
      .reduce((s, r) => s + Number(r.paid_amount_xof), 0);
    const fullyPaid = totalRecForContract >= Number(sc.total_amount_xof);
    if (!fullyPaid || sc.transfer_status === "completed") continue;
    const unit = u(units, sc.unit_id);
    const c = cust(customers, sc.customer_id);
    todos.push({
      id: makeId("sale_transfer", sc.id),
      type: sc.transfer_status === "not_started" ? "sale_settled_undelivered" : "sale_missing_transfer",
      source: "sale",
      title: sc.transfer_status === "not_started" ? `出售已结清未过户 ${sc.contract_no}` : `出售过户进行中 ${sc.contract_no}`,
      description: `${unit?.unit_no ?? ""} ${c?.name ?? "—"}，回款 ${formatXofRaw(totalRecForContract)} / ${formatXofRaw(Number(sc.total_amount_xof))}`,
      sourceId: sc.id, unitLabel: unit?.unit_no ?? "", customerName: c?.name ?? "",
      amount: Number(sc.total_amount_xof), dueDate: sc.signed_date,
      priority: "medium", status: "open",
      href: "/sales",
      roles: ["admin", "finance", "boss"],
    });
  }

  // ── Finance: overdue receivables (any source) ──
  for (const r of receivables) {
    if (r.status === "paid" || r.status === "cancelled") continue;
    const unpaid = Number(r.amount_xof) - Number(r.paid_amount_xof);
    if (unpaid <= 0) continue;
    const isOverdue = r.status === "overdue" || r.due_date < today;
    if (!isOverdue) continue;
    const unit = u(units, r.unit_id);
    const c = cust(customers, r.customer_id);
    // Skip lease/sale which are already covered above
    if (r.source_type === "lease_contract" || r.source_type === "sale_contract") continue;
    todos.push({
      id: makeId("fin_overdue", r.id), type: "finance_receivable_overdue", source: "finance",
      title: `逾期应收 ${r.title}`,
      description: `${unit?.unit_no ?? ""} ${c?.name ?? "—"}，应收 ${formatXofRaw(Number(r.amount_xof))}，未收 ${formatXofRaw(unpaid)}，${r.due_date}`,
      sourceId: r.id, unitLabel: unit?.unit_no ?? "", customerName: c?.name ?? "",
      amount: unpaid, dueDate: r.due_date,
      priority: "high", status: "open",
      href: "/finance",
      roles: ["admin", "finance", "boss"],
    });
  }

  // ── Finance: receivable due today ──
  for (const r of receivables) {
    if (r.due_date !== today) continue;
    if (r.status === "paid" || r.status === "cancelled") continue;
    const unit = u(units, r.unit_id);
    const c = cust(customers, r.customer_id);
    todos.push({
      id: makeId("fin_today", r.id), type: "finance_receivable_today", source: "finance",
      title: `今日应收 ${r.title}`,
      description: `${unit?.unit_no ?? ""} ${c?.name ?? "—"}，${formatXofRaw(Number(r.amount_xof))}`,
      sourceId: r.id, unitLabel: unit?.unit_no ?? "", customerName: c?.name ?? "",
      amount: Number(r.amount_xof), dueDate: today,
      priority: "high", status: "open",
      href: "/finance",
      roles: ["admin", "finance", "boss"],
    });
  }

  // ── Finance: anomalies ──
  for (const r of receivables) {
    if (r.status === "cancelled") continue;
    const overpaid = Number(r.paid_amount_xof) > Number(r.amount_xof);
    const negative = Number(r.amount_xof) < 0;
    const noCustomer = !r.customer_id;
    const noUnit = !r.unit_id;
    if (!overpaid && !negative && !noCustomer && !noUnit) continue;
    const unit = u(units, r.unit_id);
    const c = cust(customers, r.customer_id);
    const reasons: string[] = [];
    if (overpaid) reasons.push("实收 > 应收");
    if (negative) reasons.push("金额为负");
    if (noCustomer) reasons.push("无客户");
    if (noUnit) reasons.push("无房号");
    todos.push({
      id: makeId("fin_anomaly", r.id), type: "finance_anomaly", source: "finance",
      title: `金额异常 ${r.title}`,
      description: `${reasons.join("; ")} — ${unit?.unit_no ?? "?"} ${c?.name ?? "?"}，应收 ${formatXofRaw(Number(r.amount_xof))}，已收 ${formatXofRaw(Number(r.paid_amount_xof))}`,
      sourceId: r.id, unitLabel: unit?.unit_no ?? "", customerName: c?.name ?? "",
      amount: Number(r.amount_xof), dueDate: r.due_date,
      priority: overpaid || negative ? "high" : "medium", status: "open",
      href: "/finance",
      roles: ["admin", "finance"],
    });
  }

  // ── Filter by role if specified ──
  if (targetRole) {
    return todos.filter(t => t.roles.includes(targetRole));
  }

  return todos;
}

function formatXofRaw(amount: number): string {
  return new Intl.NumberFormat("fr-CI", { style: "currency", currency: "XOF", maximumFractionDigits: 0 }).format(amount);
}
