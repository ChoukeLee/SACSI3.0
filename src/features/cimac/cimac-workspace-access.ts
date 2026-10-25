import type { UserRole } from "@/lib/auth";

export function canAccessCimacWorkspace(role: UserRole | undefined): boolean {
  return role === "admin" || role === "boss" || role === "finance" || role === "rental_sales";
}

export function canReadCimacAccount(role: UserRole | undefined): boolean {
  return role === "admin" || role === "boss" || role === "finance";
}

export function isCimacWorkspacePath(path: string): boolean {
  return /^\/(?:fr\/)?cimac(?:\/|$)/.test(path);
}
