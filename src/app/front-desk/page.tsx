import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { FrontDeskData } from "./front-desk-data";

export default async function FrontDeskPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!["admin", "boss", "front_desk"].includes(user.role)) redirect("/");

  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center min-h-[360px]">
          <div className="h-8 w-48 animate-pulse rounded-lg bg-muted/50" />
        </div>
      }
    >
      <FrontDeskData userRole={user.role} />
    </Suspense>
  );
}
