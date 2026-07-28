import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { CalendarSkeleton } from "@/features/daily-rentals/calendar-skeleton";
import { DailyRentalData } from "@/app/daily-rentals/daily-rental-data";

export default async function FrenchDailyRentalsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!["admin", "front_desk", "finance", "boss", "rental_sales"].includes(user.role)) redirect("/");

  return (
    <div data-daily-rentals-page>
      <Suspense fallback={<CalendarSkeleton locale="fr" />}>
        <DailyRentalData userRole={user.role} locale="fr" />
      </Suspense>
    </div>
  );
}
