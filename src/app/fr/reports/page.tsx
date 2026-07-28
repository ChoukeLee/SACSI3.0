import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { ReportsLazyView } from "@/features/reports/reports-lazy-view";
import { getReportsData } from "@/features/reports/reports-data";
import { DesktopOnly } from "@/features/mobile";
import { OperationalPageSkeleton } from "@/components/operational-page-skeleton";

export const revalidate = 60;

export default async function FrenchReportsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!["admin", "boss", "finance"].includes(user.role)) redirect("/");

  return (
    <>
      <div className="lg:hidden"><DesktopOnly locale="fr" /></div>
      <div className="hidden lg:block">
        <Suspense fallback={<OperationalPageSkeleton kind="dashboard" rows={6} />}>
          <FrenchReportsData userRole={user.role} />
        </Suspense>
      </div>
    </>
  );
}

async function FrenchReportsData({ userRole }: { userRole: string }) {
  const {
    entries, bookings, units, leaseContracts, saleContracts,
    saleSchedules, receivables, payments, customers,
  } = await getReportsData();

  return (
    <ReportsLazyView entries={entries} bookings={bookings} units={units}
      leaseContracts={leaseContracts} saleContracts={saleContracts}
      saleSchedules={saleSchedules} receivables={receivables}
      payments={payments} customers={customers}
      locale="fr" userRole={userRole} />
  );
}
