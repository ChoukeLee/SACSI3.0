import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

export type UserRole = "admin" | "boss" | "finance" | "front_desk" | "rental_sales";
export type AppLocale = "zh" | "fr";

export interface CurrentUser {
  id: string;
  email?: string;
  role: UserRole;
  displayName: string;
}

const seedAccountProfiles: Record<string, { role: UserRole; displayName: string }> = {
  "admin@sacsi.com": { role: "admin", displayName: "Chouke" },
  "boss@sacsi.com": { role: "boss", displayName: "GAO" },
  "finance@sacsi.com": { role: "finance", displayName: "李财务" },
  "front@sacsi.com": { role: "front_desk", displayName: "Niamké" },
  "ying@sacsi.com": { role: "admin", displayName: "Ying" },
};

export const configuredAccountSummaries = Object.entries(seedAccountProfiles).map(([email, profile]) => ({
  email,
  displayName: profile.displayName,
  role: profile.role,
}));

export function getSeedAccountProfile(email: string | undefined) {
  if (!email) return null;
  return seedAccountProfiles[email.toLowerCase()] ?? null;
}

export function homePathForRole(role: UserRole, locale: AppLocale = "zh") {
  if (role === "front_desk") return "/fr/daily-rentals";

  const prefix = locale === "fr" ? "/fr" : "";
  if (role === "finance") return `${prefix}/finance`;
  if (role === "rental_sales") return `${prefix}/leases`;
  return `${prefix}/management`;
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
    "audit_logs:read",
    "settings:read", "settings:write",
    "users:manage",
  ],
  boss: [
    "units:read",
    "customers:read",
    "daily_rentals:read",
    "leases:read",
    "sales:read",
    "finance:read", "finance:export",
    "audit_logs:read",
  ],
  finance: [
    "units:read",
    "customers:read", "customers:write",
    "daily_rentals:read",
    "leases:read",
    "sales:read",
    "finance:read", "finance:write", "finance:export",
  ],
  front_desk: [
    "units:read",
    "customers:read",
    "daily_rentals:read", "daily_rentals:write",
    "leases:read",
  ],
  rental_sales: [
    "units:read",
    "customers:read", "customers:write",
    "daily_rentals:read", "daily_rentals:write",
    "leases:read", "leases:write",
    "sales:read", "sales:write",
  ],
};

// ── Auth helpers ──

export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const supabase = await createClient();

  // Server-side authorization must use a user verified by Supabase Auth.
  // getSession() only reads the cookie payload and must not be trusted for
  // permission decisions.
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) return null;

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

  const role = profile?.role as UserRole | undefined;
  if (!role || !Object.prototype.hasOwnProperty.call(rolePermissions, role)) {
    return null;
  }

  return {
    id: user.id,
    email: user.email,
    role,
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
  "daily-rentals": ["admin", "front_desk", "finance", "boss", "rental_sales"],
  leases: ["admin", "front_desk", "finance", "boss", "rental_sales"],
  sales: ["admin", "finance", "boss", "rental_sales"],
  customers: ["admin", "finance", "boss", "rental_sales"],
  "audit-logs": ["admin", "boss"],
  assistant: ["admin", "boss", "finance", "rental_sales"],
};

/**
 * Check if a role can access a page section.
 * Returns the user if permitted, otherwise null.
 */
export function canAccessPage(role: UserRole, section: string): boolean {
  const allowed = pageAccess[section];
  if (!allowed) return false;
  return allowed.includes(role);
}
