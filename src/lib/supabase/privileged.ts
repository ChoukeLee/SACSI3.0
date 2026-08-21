import "server-only";
import { createClient } from "@supabase/supabase-js";

/**
 * Service-role client for server actions that already passed an application
 * role guard. This keeps database RLS from seeing a stale seed-account role
 * while a newly deployed role migration is still pending.
 */
export function createPrivilegedClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }
  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
