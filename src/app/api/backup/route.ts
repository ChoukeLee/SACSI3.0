import { NextResponse } from "next/server";
import { getCurrentUser, hasPermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

const TABLES = [
  "buildings", "units", "unit_business_flags", "customers",
  "daily_bookings", "lease_contracts", "sale_contracts",
  "sale_payment_schedule", "receivables", "payments",
  "ledger_entries", "cleaning_tasks", "audit_logs",
  "system_settings", "user_profiles", "business_targets",
];

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasPermission(user, "settings:read")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const supabase = await createClient();
  const backup: Record<string, unknown[]> = {};
  const errors: string[] = [];

  for (const table of TABLES) {
    try {
      const { data, error } = await supabase.from(table).select("*");
      if (error) { errors.push(`${table}: ${error.message}`); continue; }
      backup[table] = data ?? [];
    } catch (e) {
      errors.push(`${table}: ${String(e)}`);
    }
  }

  const metadata = {
    exportedAt: new Date().toISOString(),
    exportedBy: user.displayName || user.email,
    tableCount: Object.keys(backup).length,
    totalRows: Object.values(backup).reduce((sum, rows) => sum + rows.length, 0),
    errors: errors.length > 0 ? errors : undefined,
  };

  const json = JSON.stringify({ metadata, data: backup }, null, 2);

  return new NextResponse(json, {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="sacsi-backup-${new Date().toISOString().slice(0, 10)}.json"`,
    },
  });
}
