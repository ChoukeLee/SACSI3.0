import type { UserRole } from "@/lib/auth";
import type { BusinessActionDefinition } from "./types";

const ALL_OPERATORS = ["admin", "boss", "finance", "front_desk", "rental_sales"] as const;
const DAILY_OPERATORS = ["admin", "front_desk", "rental_sales"] as const;
const FINANCE_OPERATORS = ["admin", "finance"] as const;
const CONTRACT_OPERATORS = ["admin", "rental_sales"] as const;

export const BUSINESS_ACTIONS = [
  { name: "query_daily_booking", domain: "daily_rental", risk: "L0", write: false, allowedRoles: ALL_OPERATORS, description: "查询日租订单、房态、收款和保洁" },
  { name: "create_daily_booking", domain: "daily_rental", risk: "L2", write: true, allowedRoles: CONTRACT_OPERATORS, description: "新建日租订单" },
  { name: "check_in_daily_booking", domain: "daily_rental", risk: "L2", write: true, allowedRoles: DAILY_OPERATORS, description: "办理日租入住" },
  { name: "extend_daily_stay", domain: "daily_rental", risk: "L2", write: true, allowedRoles: DAILY_OPERATORS, description: "修改退房日期或续住" },
  { name: "record_daily_payment", domain: "daily_rental", risk: "L2", write: true, allowedRoles: DAILY_OPERATORS, description: "登记日租收款" },
  { name: "check_out_daily_booking", domain: "daily_rental", risk: "L2", write: true, allowedRoles: DAILY_OPERATORS, description: "办理退房与结算" },
  { name: "complete_daily_cleaning", domain: "daily_rental", risk: "L1", write: true, allowedRoles: DAILY_OPERATORS, description: "完成日租保洁" },
  { name: "mark_unit_maintenance", domain: "unit", risk: "L1", write: true, allowedRoles: ["admin", "front_desk"], description: "标记房间维修" },
  { name: "cancel_no_show_booking", domain: "daily_rental", risk: "L3", write: true, allowedRoles: ["admin"], description: "取消未到店订单" },
  { name: "transfer_daily_booking", domain: "daily_rental", risk: "L3", write: true, allowedRoles: ["admin"], description: "转移日租订单与关联财务" },
  { name: "reverse_daily_payment", domain: "daily_rental", risk: "L3", write: true, allowedRoles: ["admin"], description: "反冲错误日租收款" },
  { name: "correct_daily_booking", domain: "daily_rental", risk: "L3", write: true, allowedRoles: ["admin"], description: "纠正日租业务记录" },
  { name: "apply_booking_credit", domain: "daily_rental", risk: "L3", write: true, allowedRoles: ["admin"], description: "转移日租可用余额" },

  { name: "query_lease_position", domain: "lease", risk: "L0", write: false, allowedRoles: ALL_OPERATORS, description: "查询长租合同与财务状态" },
  { name: "query_lease_due_detail", domain: "lease", risk: "L0", write: false, allowedRoles: ALL_OPERATORS, description: "查询长租应收与逾期" },
  { name: "record_lease_rent", domain: "lease", risk: "L2", write: true, allowedRoles: FINANCE_OPERATORS, description: "登记长租租金" },
  { name: "record_property_fee", domain: "lease", risk: "L2", write: true, allowedRoles: FINANCE_OPERATORS, description: "登记物业费" },
  { name: "record_combined_lease_payment", domain: "lease", risk: "L3", write: true, allowedRoles: FINANCE_OPERATORS, description: "拆分组合长租付款" },
  { name: "record_lease_deposit", domain: "lease", risk: "L2", write: true, allowedRoles: FINANCE_OPERATORS, description: "登记长租押金" },
  { name: "renew_lease", domain: "lease", risk: "L3", write: true, allowedRoles: CONTRACT_OPERATORS, description: "续签长租合同" },
  { name: "mark_non_renewal", domain: "lease", risk: "L2", write: true, allowedRoles: CONTRACT_OPERATORS, description: "标记到期不续租" },
  { name: "start_lease_move_out", domain: "lease", risk: "L2", write: true, allowedRoles: CONTRACT_OPERATORS, description: "开始退租流程" },
  { name: "settle_lease_deposit", domain: "lease", risk: "L3", write: true, allowedRoles: ["admin", "finance"], description: "结算押金退款与扣款" },
  { name: "terminate_lease", domain: "lease", risk: "L3", write: true, allowedRoles: ["admin"], description: "终止长租合同" },
  { name: "correct_lease_payment", domain: "lease", risk: "L3", write: true, allowedRoles: ["admin"], description: "纠正长租收款" },

  { name: "query_sale_position", domain: "sale", risk: "L0", write: false, allowedRoles: ["admin", "boss", "finance", "rental_sales"], description: "查询销售合同与财务状态" },
  { name: "query_sale_payment_detail", domain: "sale", risk: "L0", write: false, allowedRoles: ["admin", "boss", "finance", "rental_sales"], description: "查询销售付款计划" },
  { name: "create_sale_draft", domain: "sale", risk: "L3", write: true, allowedRoles: CONTRACT_OPERATORS, description: "创建总价可待补的销售草稿" },
  { name: "record_sale_payment", domain: "sale", risk: "L2", write: true, allowedRoles: FINANCE_OPERATORS, description: "登记销售收款" },
  { name: "add_sale_installment", domain: "sale", risk: "L3", write: true, allowedRoles: CONTRACT_OPERATORS, description: "调整销售付款节点" },
  { name: "update_transfer_status", domain: "sale", risk: "L2", write: true, allowedRoles: CONTRACT_OPERATORS, description: "更新交房或过户状态" },
  { name: "correct_sale_payment", domain: "sale", risk: "L3", write: true, allowedRoles: ["admin"], description: "纠正销售收款" },
  { name: "terminate_sale_contract", domain: "sale", risk: "L3", write: true, allowedRoles: ["admin"], description: "解除销售合同" },
] as const satisfies readonly BusinessActionDefinition[];

export type BusinessActionName = (typeof BUSINESS_ACTIONS)[number]["name"];

const ACTION_BY_NAME = new Map<string, BusinessActionDefinition>(
  BUSINESS_ACTIONS.map((definition) => [definition.name, definition]),
);

export function getBusinessActionDefinition(name: string) {
  return ACTION_BY_NAME.get(name) ?? null;
}

export function canRoleUseBusinessAction(role: UserRole, name: string) {
  const definition = getBusinessActionDefinition(name);
  return Boolean(definition?.allowedRoles.includes(role));
}

export function requireBusinessActionRole(role: UserRole, name: string) {
  const definition = getBusinessActionDefinition(name);
  if (!definition) throw new Error(`Unknown business action: ${name}`);
  if (!definition.allowedRoles.includes(role)) {
    throw new Error(`Business action denied: ${name}`);
  }
  return definition;
}
