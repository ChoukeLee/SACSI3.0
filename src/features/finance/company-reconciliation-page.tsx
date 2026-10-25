import "server-only";
import { redirect, notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { FinanceWorkbench } from "./finance-workbench";
import { decodeFinanceReconciliation, type FinanceReconciliation } from "./finance-workbench-model";
import { parseFinanceRead } from "./finance-read";

/** Preserves the existing global check as an explicitly company-wide tool. */
export async function CompanyReconciliationPage({ locale }: { locale: "zh" | "fr" }) {
  const user = await getCurrentUser();
  if (!user) redirect(locale === "fr" ? "/fr/login" : "/login");
  if (!["admin", "boss", "finance"].includes(user.role)) notFound();
  const client = await createClient();
  let reconciliation: FinanceReconciliation;
  try {
    const { data, error } = await client.rpc("finance_reconciliation_rpc");
    if (error || !data) throw new Error("FinanceReconciliationUnavailable");
    reconciliation = decodeFinanceReconciliation(data);
  } catch {
    reconciliation = { available: false, count: null, issues: [] };
  }
  return (
    <FinanceWorkbench
      scopeKey={`company-reconciliation:${user.id}`}
      query={parseFinanceRead({})}
      mode="reconciliation"
      result={null}
      projects={[]}
      buildings={[]}
      reconciliation={reconciliation}
      locale={locale}
      canWrite={false}
      today={new Date().toISOString().slice(0, 10)}
      companyReconciliation
    />
  );
}
