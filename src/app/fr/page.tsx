import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function FrenchHomePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  if (user.role === "front_desk") redirect("/fr/daily-rentals");
  if (user.role === "finance") redirect("/fr/finance");

  redirect("/fr/management");
}
