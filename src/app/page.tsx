import { redirect } from "next/navigation";
import { getCurrentUser, homePathForRole } from "@/lib/auth";


export default async function HomePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  redirect(homePathForRole(user.role));
}

