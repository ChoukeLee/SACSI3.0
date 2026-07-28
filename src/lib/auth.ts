import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

export type UserRole = "admin" | "boss" | "finance" | "front_desk" | "rental_sales";

export interface CurrentUser {
  id: string;
  email?: string;
  role: UserRole;
  displayName: string;
}

const seedAccountProfiles: Record<string, { role: UserRole; displayName: string; databaseRole?: "front_desk" }> = {
  "admin@sacsi.com": { role: "admin", displayName: "Chouke" },
  "boss@sacsi.com": { role: "boss", displayName: "王老板" },
  "finance@sacsi.com": { role: "finance", displayName: "李财务" },
  "front@sacsi.com": { role: "front_desk", displayName: "Niamké" },
  "ying@sacsi.com": { role: "rental_sales", displayName: "Ying", databaseRole: "front_desk" },
};

export function getSeedAccountProfile(email: string | undefined) {
  if (!email) return null;
  return seedAccountProfiles[email.toLowerCase()] ?? null;
}

// ── Permission matrix ──

const rolePermissions: Record<UserRole, string[]> = {
  admin: [
    "units:read", "units:write", "units:delete",
    "customers:read", "customers:write", "customers:delete",
    "daily_rentals:read", "daily_rentals:write", "daily_rentals:delete",
    "leases:read", "leases:write", "leases:delete",
    "sales:read", "sales:write", "sales:delete",
    "finance:read", "finance:write", "finance:export",
    "reports:read", "reports:export",
    "settings:read", "settings:write",
    "users:manage",
  ],
  boss: [
    "units:read",
    "customers:read",
    "daily_rentals:read",
    "leases:read",
    "sales:read",
    "finance:read",
    "reports:read", "reports:export",
    "settings:read",
  ],
  finance: [
    "units:read",
    "customers:read", "customers:write",
    "daily_rentals:read",
    "leases:read",
    "sales:read",
    "finance:read", "finance:write", "finance:export",
    "reports:read", "reports:export",
    "settings:read",
  ],
  front_desk: [
    "units:read", "units:write",
    "customers:read", "customers:write",
    "daily_rentals:read", "daily_rentals:write",
    "leases:read",
    "sales:read",
    "finance:read",
    "reports:read",
    "settings:read",
  ],
  rental_sales: [
    "units:read", "units:write",
    "customers:read", "customers:write",
    "daily_rentals:read", "daily_rentals:write",
    "leases:read", "leases:write",
    "sales:read", "sales:write",
    "audit_logs:read",
  ],
};

// ── Auth helpers ──

export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const supabase = await createClient();

  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) return null;

  const user = session.user;

  // PERF: seed accounts skip the user_profiles DB query — they're resolved in-memory
  const seedProfile = getSeedAccountProfile(user.email);
  if (seedProfile) {
    return {
      id: user.id,
      email: user.email,
      role: seedProfile.role,
      displayName: seedProfile.displayName,
    };
  }

  // Non-seed accounts: lookup role/display_name from user_profiles
  const { data: profile } = await supabase
    .from("user_profiles")
    .select("role, display_name")
    .eq("id", user.id)
    .single();

  return {
    id: user.id,
    email: user.email,
    role: (profile?.role as UserRole) ?? "front_desk",
    displayName: profile?.display_name ?? user.email ?? "User",
  };
});

export function hasPermission(user: CurrentUser | null, permission: string): boolean {
  if (!user) return false;
  const perms = rolePermissions[user.role] ?? [];
  return perms.includes(permission);
}

export function requirePermission(user: CurrentUser | null, permission: string): void {
  if (!hasPermission(user, permission)) {
    throw new Error(`Permission denied: ${permission}`);
  }
}

export async function requireAuth(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) throw new Error("Authentication required.");
  return user;
}

export async function requireRole(...roles: UserRole[]): Promise<CurrentUser> {
  const user = await requireAuth();
  if (!roles.includes(user.role)) {
    throw new Error(`Role required: ${roles.join(" or ")}`);
  }
  return user;
}

// ── Page access ──

/** Roles that can access each route section. */
const pageAccess: Record<string, UserRole[]> = {
  management: ["admin", "boss", "finance"],
  finance: ["admin", "boss", "finance"],
  settings: ["admin"],
  reports: ["admin", "boss", "finance"],
  "daily-rentals": ["admin", "front_desk", "finance", "boss", "rental_sales"],
  leases: ["admin", "front_desk", "finance", "boss", "rental_sales"],
  sales: ["admin", "front_desk", "finance", "boss", "rental_sales"],
  customers: ["admin", "front_desk", "finance", "boss", "rental_sales"],
};

/**
 * Check if a role can access a page section.
 * Returns the user if permitted, otherwise null.
 */
export function canAccessPage(role: UserRole, section: string): boolean {
  const allowed = pageAccess[section];
  if (!allowed) return true; // unknown sections default to open
  return allowed.includes(role);
}
