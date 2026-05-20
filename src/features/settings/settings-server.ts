"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";

export async function updateSystemSetting(key: string, value: unknown): Promise<{ success: boolean; error?: string }> {
  await requireRole("admin");
  const supabase = await createClient();
  const jsonValue = typeof value === "string" ? value : JSON.stringify(value);
  const { error } = await supabase.from("system_settings").upsert({ key, value: jsonValue as any, updated_at: new Date().toISOString() }, { onConflict: "key" });
  if (error) return { success: false, error: error.message };
  await supabase.from("audit_logs").insert({ action: "update_setting", entity_type: "system_setting", entity_id: key, metadata: { value: jsonValue } }).then(() => {}, () => {});
  revalidatePath("/settings");
  revalidatePath("/fr/settings");
  return { success: true };
}
