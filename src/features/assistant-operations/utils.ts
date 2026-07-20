import { createHash } from "crypto";
import { createClient } from "@/lib/supabase/server";

export function extractRoomNumbers(text: string): string[] {
  const matches = text.match(/\b\d{3,4}\b/g) ?? [];
  return [...new Set(matches)];
}

export function createDraftId(parts: unknown[]): string {
  const hash = createHash("sha256")
    .update(JSON.stringify(parts))
    .digest("hex")
    .slice(0, 16);
  return `draft_${hash}`;
}

export function nowIso() {
  return new Date().toISOString();
}

export function todayIso() {
  return nowIso().slice(0, 10);
}

function normalizeDateParts(year: number | string, month: string, day: string) {
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

export function extractDateHints(text: string): string[] {
  const today = new Date();
  const hints: string[] = [];

  if (/昨天|昨日|yesterday|hier/i.test(text)) {
    const d = new Date(today);
    d.setDate(d.getDate() - 1);
    hints.push(d.toISOString().slice(0, 10));
  }
  if (/今天|今日|today|aujourd/i.test(text)) hints.push(today.toISOString().slice(0, 10));

  for (const match of text.matchAll(/\b(20\d{2})[-/](\d{1,2})[-/](\d{1,2})\b/g)) {
    hints.push(normalizeDateParts(match[1], match[2], match[3]));
  }

  for (const match of text.matchAll(/(?:^|[^\d])(\d{1,2})[./月-](\d{1,2})(?:日|号)?(?:[^\d]|$)/g)) {
    hints.push(normalizeDateParts(today.getFullYear(), match[1], match[2]));
  }

  return [...new Set(hints)];
}

export function extractAmountXof(text: string): number | undefined {
  const withoutDates = text
    .replace(/\b20\d{2}[-/]\d{1,2}[-/]\d{1,2}\b/g, " ")
    .replace(/(?:^|[^\d])\d{1,2}[./月-]\d{1,2}(?:日|号)?(?:[^\d]|$)/g, " ");
  const withoutRooms = withoutDates.replace(/\b\d{3,4}\b/g, " ");
  const explicitMatch = withoutRooms.match(/(?:金额|房费|价格|单价|收款|收了|收到|付款|支付|paid|payment|prix|montant)?\s*(\d+(?:\.\d+)?)\s*(万|w|W|xof|XOF|cfa|CFA|fcfa|FCFA)/);
  const fallbackMatch = withoutRooms.match(/(?:收款|收了|收到|付款|支付|房费|价格|单价|paid|payment|prix|montant)\D{0,6}(\d+(?:\.\d+)?)/i);
  const match = explicitMatch ?? fallbackMatch;
  if (!match) return undefined;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount)) return undefined;
  return Math.round(amount * (/[万wW]/.test(match[2] ?? "") ? 10000 : 1));
}

export function extractDateHint(text: string): string | undefined {
  return extractDateHints(text)[0];
}

export function extractCustomerNameHint(text: string): string | undefined {
  const match = text.match(/客户(?:为|是|叫|:|：)?\s*([A-Za-z\u4e00-\u9fa5][A-Za-z\u4e00-\u9fa5\s·.-]{0,30})/);
  return match?.[1]
    ?.trim()
    .replace(/[，,。；;].*$/, "")
    .replace(/\s*(住|入住|退房|一晚|两晚|默认|按|房价|价格).*$/, "")
    .trim() || undefined;
}

export function extractCheckoutModeHint(text: string): "open" | "fixed" | undefined {
  if (/开放式|开放入住|不定退房|未定退房|open/i.test(text)) return "open";
  if (/到|至|退房|一晚|1晚|两晚|2晚|checkout|check-out|départ|depart|one night|une nuit/i.test(text)) return "fixed";
  return undefined;
}

export function mergeDraftMessage(previousMessage: string, followUpMessage: string) {
  return `${previousMessage}\n补充信息：${followUpMessage}`;
}

export async function findUnitsByRoomNumbers(roomNumbers: string[]) {
  if (roomNumbers.length === 0) return [];
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("units")
    .select("id, unit_no, status, building_id, buildings!inner(code), unit_business_flags(business_type, is_enabled, default_price_xof)")
    .in("unit_no", roomNumbers)
    .eq("buildings.code", "SACSI11");
  if (error) throw error;
  const units = (data ?? []) as Array<{
    id: string;
    unit_no: string;
    status: string;
    building_id: string;
    buildings: { code: string } | { code: string }[] | null;
    unit_business_flags?: Array<{ business_type: string; is_enabled: boolean; default_price_xof: number | null }> | null;
  }>;
  return units.map((unit) => unit.unit_no === "503"
    ? { ...unit, unit_business_flags: unit.unit_business_flags?.filter((flag) => flag.business_type !== "daily_rental") }
    : unit);
}

export async function findCustomersByName(name: string | undefined) {
  if (!name) return [];
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("customers")
    .select("id, name, phone, is_blacklisted")
    .ilike("name", `%${name}%`)
    .limit(5);
  if (error) throw error;
  return (data ?? []) as Array<{ id: string; name: string; phone: string | null; is_blacklisted: boolean | null }>;
}

export async function findDailyBookingsForRooms(roomNumbers: string[]) {
  if (roomNumbers.length === 0) return [];
  const supabase = await createClient();
  const units = await findUnitsByRoomNumbers(roomNumbers);
  const unitIds = units.map((unit) => unit.id);
  if (unitIds.length === 0) return [];
  const { data, error } = await supabase
    .from("daily_bookings")
    .select("id, unit_id, customer_id, check_in, check_out, checkout_mode, actual_check_out, nightly_price_xof, total_amount_xof, prepaid_amount_xof, final_amount_xof, billing_status, status, units!inner(id, unit_no, status), customers(id, name, phone)")
    .in("unit_id", unitIds)
    .in("status", ["pending_review", "confirmed", "checked_in", "checked_out"])
    .order("check_in", { ascending: false });
  if (error) throw error;
  type RawBooking = {
    id: string;
    unit_id: string;
    customer_id: string;
    check_in: string;
    check_out: string | null;
    checkout_mode: string;
    actual_check_out: string | null;
    nightly_price_xof: number;
    total_amount_xof: number;
    prepaid_amount_xof: number;
    final_amount_xof: number | null;
    billing_status: string;
    status: string;
    units: { id: string; unit_no: string; status: string } | { id: string; unit_no: string; status: string }[];
    customers: { id: string; name: string; phone: string | null } | { id: string; name: string; phone: string | null }[] | null;
  };
  return ((data ?? []) as RawBooking[]).map((booking) => ({
    ...booking,
    units: Array.isArray(booking.units) ? booking.units[0] : booking.units,
    customers: Array.isArray(booking.customers) ? booking.customers[0] : booking.customers,
  })).filter((booking) => booking.units);
}
