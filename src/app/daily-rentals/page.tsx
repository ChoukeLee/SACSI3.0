import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { CalendarSkeleton } from "@/features/daily-rentals/calendar-skeleton";
import { DailyRentalData } from "./daily-rental-data";

/**
 * Daily rentals page with streaming architecture:
 * 1. Auth check + page shell render immediately
 * 2. Calendar skeleton shows while data loads
 * 3. Full calendar + data streams in when ready
 */
export default async function DailyRentalsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!["admin", "front_desk", "finance", "boss", "rental_sales"].includes(user.role)) redirect("/");
  if (user.role === "front_desk") redirect("/fr/daily-rentals");

  return (
    <div data-daily-rentals-page>
      <Suspense fallback={<CalendarSkeleton locale="zh" />}>
        <DailyRentalData userRole={user.role} locale="zh" />
      </Suspense>
    </div>
  );
}
