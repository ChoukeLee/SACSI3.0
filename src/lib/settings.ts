import { createClient } from "@/lib/supabase/server";

const cache = new Map<string, { value: unknown; ts: number }>();
const TTL = 60000; // 1 minute cache

export function clearSettingCache(key?: string) {
  if (key) cache.delete(key);
  else cache.clear();
}

export async function getSetting<T = string>(key: string, fallback: T): Promise<T> {
  const cached = cache.get(key);
  if (cached && Date.now() - cached.ts < TTL) return cached.value as T;

  try {
    const supabase = await createClient();
    const { data } = await supabase.from("system_settings").select("value").eq("key", key).single();
    if (data) {
      const val = typeof data.value === "string" ? data.value : (data.value as any);
      const parsed = parseSettingValue(val);
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
      result[row.key] = parseSettingValue(val);
    }
    return result;
  } catch { return {}; }
}

function parseSettingValue(value: unknown) {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed) return "";
  const looksJson =
    trimmed.startsWith('"') ||
    trimmed.startsWith("[") ||
    trimmed.startsWith("{") ||
    trimmed === "true" ||
    trimmed === "false" ||
    trimmed === "null" ||
    /^-?\d+(\.\d+)?$/.test(trimmed);
  if (!looksJson) return value;
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

export async function getBusinessRules() {
  const [dailyPrice, alertDays, checkoutStatus, undoCheckinStatus, accTypes, graceDays, receivableAutoSync, ledgerDescriptionStyle, leaseWarn, overdueWarn] = await Promise.all([
    getSetting("default_daily_price", 40000),
    getSetting("open_checkout_alert_days", 3),
    getSetting("checkout_default_unit_status", "cleaning_pending"),
    getSetting("undo_checkin_target_status", "reserved"),
    getSetting("accommodation_unit_types", ["apartment"] as string[]),
    getSetting("overdue_grace_days", 0),
    getSetting("receivable_auto_sync", true),
    getSetting("ledger_description_style", "compact"),
    getSetting("lease_expiry_warning_days", 30),
    getSetting("receivable_overdue_warning_days", 7),
  ]);
  return {
    defaultDailyPrice: Number(dailyPrice),
    openCheckoutAlertDays: Number(alertDays),
    checkoutDefaultUnitStatus: String(checkoutStatus),
    undoCheckinTargetStatus: String(undoCheckinStatus),
    accommodationUnitTypes: accTypes as string[],
    overdueGraceDays: Number(graceDays),
    receivableAutoSync: Boolean(receivableAutoSync),
    ledgerDescriptionStyle: String(ledgerDescriptionStyle),
    leaseExpiryWarningDays: Number(leaseWarn),
    receivableOverdueWarningDays: Number(overdueWarn),
  };
}
