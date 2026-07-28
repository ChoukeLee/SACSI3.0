import type { UserRole } from "./auth";

interface NavigationItem {
  key: string;
}

interface NavigationGroup<TItem extends NavigationItem> {
  key: string;
  items: TItem[];
}

const BOSS_HIDDEN = new Set(["bulkActions"]);
const FINANCE_GROUPS = new Set(["home", "business", "financeCenter", "operations", "systemTools"]);
const FINANCE_HIDDEN = new Set(["management", "dailyRentals", "bulkActions", "security", "targets", "dataQuality", "settings", "leases", "sales"]);
const FRONT_GROUPS = new Set(["home", "business", "operations"]);
const FRONT_KEYS = new Set(["management", "units", "dailyRentals", "customers", "assistant", "todos", "documents"]);
const RENTAL_SALES_GROUPS = new Set(["home", "business", "operations"]);
const RENTAL_SALES_KEYS = new Set(["management", "units", "dailyRentals", "leases", "sales", "customers", "auditLogs"]);

export function navigationGroupsForRole<TItem extends NavigationItem, TGroup extends NavigationGroup<TItem>>(
  groups: TGroup[],
  role?: UserRole,
): TGroup[] {
  if (!role || role === "admin") return groups;
  if (role === "boss") return groups.map((group) => ({
    ...group,
    items: group.items.filter((item) => !BOSS_HIDDEN.has(item.key)),
  })).filter((group) => group.items.length > 0) as TGroup[];
  if (role === "finance") return groups.filter((group) => FINANCE_GROUPS.has(group.key)).map((group) => ({
    ...group,
    items: group.items.filter((item) => !FINANCE_HIDDEN.has(item.key)),
  })).filter((group) => group.items.length > 0) as TGroup[];
  if (role === "front_desk") return groups.filter((group) => FRONT_GROUPS.has(group.key)).map((group) => ({
    ...group,
    items: group.items.filter((item) => FRONT_KEYS.has(item.key)),
  })).filter((group) => group.items.length > 0) as TGroup[];
  if (role === "rental_sales") return groups.filter((group) => RENTAL_SALES_GROUPS.has(group.key)).map((group) => ({
    ...group,
    items: group.items.filter((item) => RENTAL_SALES_KEYS.has(item.key)),
  })).filter((group) => group.items.length > 0) as TGroup[];
  return [];
}
