import { createClient } from "@/lib/supabase/server";

const cache = new Map<string, { value: unknown; ts: number }>();
const TTL = 60000; // 1 minute cache

export async function getSetting<T = string>(key: string, fallback: T): Promise<T> {
  const cached = cache.get(key);
  if (cached && Date.now() - cached.ts < TTL) return cached.value as T;

  try {
    const supabase = await createClient();
    const { data } = await supabase.from("system_settings").select("value").eq("key", key).single();
    if (data) {
      const val = typeof data.value === "string" ? data.value : (data.value as any);
      const parsed = typeof val === "string" && (val.startsWith('"') || val.startsWith('[') || val.startsWith('{')) ? JSON.parse(val) : val;
      cache.set(key, { value: parsed, ts: Date.now() });
      return parsed as T;
    }
  } catch { /* fallback */ }
  return fallback;
}

export async function getSettingsByCategory(category: string): Promise<Record<string, unknown>> {
  try {
    const supabase = await createClient();
    const { data } = await supabase.from("system_settings").select("key, value").eq("category", category);
    const result: Record<string, unknown> = {};
    for (const row of (data ?? [])) {
      const val = typeof row.value === "string" ? row.value : (row.value as any);
      result[row.key] = typeof val === "string" && (val.startsWith('"') || val.startsWith('[') || val.startsWith('{')) ? JSON.parse(val) : val;
    }
    return result;
  } catch { return {}; }
}

export async function getBusinessRules() {
  const [dailyPrice, alertDays, accTypes, graceDays, leaseWarn, overdueWarn] = await Promise.all([
    getSetting("default_daily_price", 40000),
    getSetting("open_checkout_alert_days", 3),
    getSetting("accommodation_unit_types", ["apartment"] as string[]),
    getSetting("overdue_grace_days", 0),
    getSetting("lease_expiry_warning_days", 30),
    getSetting("receivable_overdue_warning_days", 7),
  ]);
  return { defaultDailyPrice: Number(dailyPrice), openCheckoutAlertDays: Number(alertDays), accommodationUnitTypes: accTypes as string[], overdueGraceDays: Number(graceDays), leaseExpiryWarningDays: Number(leaseWarn), receivableOverdueWarningDays: Number(overdueWarn) };
}
