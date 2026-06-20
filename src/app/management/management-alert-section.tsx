import { createClient } from "@/lib/supabase/server";
import { AlertStrip, computeAlerts } from "@/features/management/management-alert-strip";
import type { Locale } from "@/lib/i18n";

interface Props { locale: Locale; }

export async function ManagementAlertSection({ locale }: Props) {
  const supabase = await createClient();
  const today = new Date().toISOString().slice(0, 10);
  const next30d = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);

  // Lightweight queries — just counts, no heavy data
  const [overdueRes, checkoutRes, checkinRes, pendingRes, leaseRes] = await Promise.all([
    supabase.from("receivables").select("amount_xof, paid_amount_xof, status, due_date").neq("status", "cancelled"),
    supabase.from("daily_bookings").select("id").eq("check_out", today).in("status", ["confirmed","checked_in"]),
    supabase.from("daily_bookings").select("id").eq("check_in", today).in("status", ["confirmed","pending_review"]),
    supabase.from("daily_bookings").select("id").eq("status", "pending_review"),
    supabase.from("lease_contracts").select("id").eq("status", "active").gte("expected_end_date", today).lte("expected_end_date", next30d),
  ]);

  const overdueItems = (overdueRes.data ?? []).filter((r: any) => {
    const os = Number(r.amount_xof) - Number(r.paid_amount_xof);
    return os > 0 && (r.status === "overdue" || r.due_date < today);
  });

  const alerts = computeAlerts({
    overdueCount: overdueItems.length,
    overdueTotal: overdueItems.reduce((s: number, r: any) => s + Math.max(0, Number(r.amount_xof) - Number(r.paid_amount_xof)), 0),
    todayCheckouts: (checkoutRes.data ?? []).length,
    todayCheckins: (checkinRes.data ?? []).length,
    expiringLeases: (leaseRes.data ?? []).length,
    pendingReviewBookings: (pendingRes.data ?? []).length,
    locale,
  });

  if (alerts.length === 0) return null;
  return <AlertStrip alerts={alerts} locale={locale} />;
}
