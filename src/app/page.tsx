import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  if (user.role === "front_desk") redirect("/front-desk");
  if (user.role === "finance") redirect("/finance");

  redirect("/management");
}
