import type { UserRole } from "./auth";

interface NavigationItem {
  key: string;
}

interface NavigationGroup<TItem extends NavigationItem> {
  key: string;
  items: TItem[];
}

const ROLE_KEYS: Partial<Record<UserRole, Set<string>>> = {
  boss: new Set(["management", "units", "dailyRentals", "leases", "sales"]),
  finance: new Set(["management", "units", "leases", "sales"]),
  front_desk: new Set(["dailyRentals", "leases"]),
  rental_sales: new Set(["management", "units", "dailyRentals", "leases", "sales"]),
};

export function navigationGroupsForRole<TItem extends NavigationItem, TGroup extends NavigationGroup<TItem>>(
  groups: TGroup[],
  role?: UserRole,
): TGroup[] {
  if (!role || role === "admin") return groups;
  const allowedKeys = ROLE_KEYS[role];
  if (!allowedKeys) return [];
  return groups.map((group) => ({
    ...group,
    items: group.items.filter((item) => allowedKeys.has(item.key)),
  })).filter((group) => group.items.length > 0) as TGroup[];
}
