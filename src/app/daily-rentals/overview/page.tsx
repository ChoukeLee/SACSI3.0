import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { DailyOccupancyOverviewData } from "../occupancy-overview-data";

export default async function DailyOccupancyOverviewPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role === "front_desk") redirect("/fr/daily-rentals/overview");
  return <DailyOccupancyOverviewData locale="zh" />;
}
