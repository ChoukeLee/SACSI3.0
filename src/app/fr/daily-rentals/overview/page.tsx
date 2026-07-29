import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { DailyOccupancyOverviewData } from "@/app/daily-rentals/occupancy-overview-data";

export default async function FrenchDailyOccupancyOverviewPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return <DailyOccupancyOverviewData locale="fr" />;
}
