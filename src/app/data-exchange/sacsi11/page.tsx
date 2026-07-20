import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { Sacsi11WorkbookImportCenter } from "@/features/data-exchange/sacsi11-workbook-import-center";

export default async function Sacsi11WorkbookImportPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "admin") redirect("/data-exchange");
  return <div className="space-y-5"><h1 className="text-2xl font-semibold tracking-tight">11号公寓数据覆盖</h1><Sacsi11WorkbookImportCenter /></div>;
}
