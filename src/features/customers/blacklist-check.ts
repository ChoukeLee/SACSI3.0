import { createClient } from "@/lib/supabase/server";

export interface BlacklistCheckResult {
  isBlacklisted: boolean;
  reason?: string;
  isPermanent?: boolean;
}

/**
 * Check whether a customer is blacklisted.
 * Call this before creating any business document (daily rental, lease, sale).
 */
export async function checkBlacklist(customerId: string): Promise<BlacklistCheckResult> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("customers")
    .select("is_blacklisted, blacklist_reason, blacklist_permanent")
    .eq("id", customerId)
    .single();

  if (error || !data) {
    return { isBlacklisted: false };
  }

  return {
    isBlacklisted: data.is_blacklisted,
    reason: data.blacklist_reason ?? undefined,
    isPermanent: data.blacklist_permanent,
  };
}
