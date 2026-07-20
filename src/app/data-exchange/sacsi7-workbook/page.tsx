import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { Sacsi7WorkbookImportCenter } from "@/features/data-exchange/sacsi7-workbook-import-center";

export default async function Sacsi7WorkbookImportPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "admin") redirect("/data-exchange");
  return <div className="mx-auto max-w-5xl space-y-5 p-6"><div><h1 className="text-2xl font-bold">7号楼工作簿覆盖导入</h1><p className="text-sm text-muted-foreground">管理员专用：先预览，确认后执行。</p></div><Sacsi7WorkbookImportCenter /></div>;
}
