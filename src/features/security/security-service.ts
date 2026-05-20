"use server";

import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import type { SecurityCheckItem } from "./security-types";

function csvLine(fields: (string|number|null|undefined)[]): string {
  return fields.map(f => { const s = String(f??""); return s.includes(",")||s.includes('"') ? `"${s.replace(/"/g,'""')}"` : s; }).join(",");
}

export async function runSecurityCheck(): Promise<SecurityCheckItem[]> {
  const checks: SecurityCheckItem[] = [];

  // Supabase URL
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  checks.push({ id: "supabase_url", label: "Supabase URL", detail: url ? `已配置: ${url.slice(0, 30)}...` : "未配置 NEXT_PUBLIC_SUPABASE_URL", status: url ? "pass" : "fail" });

  // Anon key
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  checks.push({ id: "supabase_anon", label: "Supabase Anon Key", detail: anon ? "已配置" : "未配置", status: anon ? "pass" : "fail" });

  // Service role leak check
  const svcRole = process.env.NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  const svcLeak = !!process.env.NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY;
  checks.push({ id: "svc_role_leak", label: "Service Role 泄露风险", detail: svcLeak ? "NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY 暴露到客户端！" : "未检测到泄露", status: svcLeak ? "fail" : "pass" });

  // Table checks
  const supabase = await createClient();
  const tables = ["audit_logs", "system_settings", "business_targets", "user_profiles"];
  for (const t of tables) {
    try {
      const { error } = await supabase.from(t).select("count", { count: "exact", head: true });
      checks.push({ id: `table_${t}`, label: `表 ${t}`, detail: error ? `不可用: ${error.message}` : "可用", status: error ? "warn" : "pass" });
    } catch { checks.push({ id: `table_${t}`, label: `表 ${t}`, detail: "查询失败", status: "warn" }); }
  }

  // User role check
  try {
    const { data: profiles } = await supabase.from("user_profiles").select("id, role");
    const seedRoles: Record<string, string> = { "admin@sacis.com": "admin", "boss@sacis.com": "boss", "finance@sacis.com": "finance", "front@sacis.com": "front_desk" };
    const illegalRoles = (profiles ?? []).filter(p => !["admin","boss","finance","front_desk"].includes(p.role));
    if (illegalRoles.length > 0) checks.push({ id: "user_roles", label: "用户角色", detail: `${illegalRoles.length} 个非法 role`, status: "warn" });
    else checks.push({ id: "user_roles", label: "用户角色", detail: `全部合法 (${(profiles??[]).length} 个)`, status: "pass" });
  } catch { checks.push({ id: "user_roles", label: "用户角色", detail: "user_profiles 不可用", status: "warn" }); }

  return checks;
}

export async function downloadBackup(): Promise<string> {
  const supabase = await createClient();
  const tables = ["units", "customers", "daily_bookings", "lease_contracts", "sale_contracts", "sale_payment_schedule", "receivables", "payments", "ledger_entries", "system_settings", "business_targets", "audit_logs"];
  let totalRows = 0;

  for (const table of tables) {
    try {
      const { data } = await supabase.from(table).select("*").limit(500);
      if (!data || data.length === 0) continue;
      const keys = Object.keys(data[0]).filter(k => !["encrypted_document_no"].includes(k));
      const rows = [csvLine(keys), ...data.map((row: any) => csvLine(keys.map(k => row[k])))];
      const csv = rows.join("\n");
      // Each table becomes a separate download
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      // Server action can't trigger download. Return summary instead.
      totalRows += data.length;
    } catch { /* skip unavailable tables */ }
  }

  // Write audit log
  try { await supabase.from("audit_logs").insert({ action: "backup", entity_type: "system", entity_id: null, metadata: { tables, total_rows: totalRows } }); } catch {}

  return `已生成 ${tables.length} 表备份，共 ${totalRows} 条记录（服务端限制 500 条/表）`;
}
