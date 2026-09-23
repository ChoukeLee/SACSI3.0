import { cache } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

export type UserRole = "admin" | "boss" | "finance" | "front_desk" | "rental_sales";
export type AppLocale = "zh" | "fr";

export interface CurrentUser {
  id: string;
  email?: string;
  role: UserRole;
  displayName: string;
}

type AccountProjectScope = "all" | "sacsi_only";

const seedAccountProfiles: Record<string, { role: UserRole; displayName: string; projectScope: AccountProjectScope }> = {
  "admin@sacsi.com": { role: "admin", displayName: "Chouke", projectScope: "all" },
  "boss@sacsi.com": { role: "boss", displayName: "GAO", projectScope: "all" },
  "finance@sacsi.com": { role: "finance", displayName: "zhulin", projectScope: "all" },
  "front@sacsi.com": { role: "front_desk", displayName: "Niamké", projectScope: "sacsi_only" },
  "ying@sacsi.com": { role: "admin", displayName: "Ying", projectScope: "sacsi_only" },
  "huang@sacsi.com": { role: "admin", displayName: "黄姐", projectScope: "sacsi_only" },
};

export const configuredAccountSummaries = Object.entries(seedAccountProfiles).map(([email, profile]) => ({
  email,
  displayName: profile.displayName,
  role: profile.role,
  projectScope: profile.projectScope,
}));

export function getSeedAccountProfile(email: string | undefined) {
  if (!email) return null;
  const profile = seedAccountProfiles[email.toLowerCase()];
  return profile ? { role: profile.role, displayName: profile.displayName } : null;
}

export async function resolveVerifiedSupabaseUser(
  supabase: SupabaseClient<any, "public", any>,
  user: { id: string; email?: string | null },
): Promise<CurrentUser | null> {
  const email = user.email ?? undefined;
  const seedProfile = getSeedAccountProfile(email);
  if (seedProfile) {
    return {
      id: user.id,
      email,
      role: seedProfile.role,
      displayName: seedProfile.displayName,
    };
  }

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
    email,
    role,
    displayName: profile?.display_name ?? email ?? "User",
  };
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

  return resolveVerifiedSupabaseUser(supabase, user);
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
