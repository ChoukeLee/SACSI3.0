"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import type { BuildingRow } from "@/types/database";

export async function addBuilding(input: {
  code: string;
  displayName: string;
  floorsAboveGround: number;
  elevatorCount: number;
  projectCode?: string;
}): Promise<{ success: boolean; data?: BuildingRow; error?: string }> {
  await requireRole("admin");
  if (!input.code.trim()) return { success: false, error: "请输入楼栋编号。" };
  const supabase = await createClient();
  const { data: project, error: projectError } = await supabase
    .from("projects")
    .select("id")
    .eq("code", input.projectCode?.trim() || "SACSI")
    .single();
  if (projectError || !project) return { success: false, error: "未找到所属项目。" };
  const { data, error } = await supabase
    .from("buildings").insert({ project_id: project.id, code: input.code.trim(), display_name: input.displayName.trim(), floors_above_ground: input.floorsAboveGround, elevator_count: input.elevatorCount })
    .select("*").single();
  if (error) {
    if (error.code === "23505") return { success: false, error: "楼栋编号已存在。" };
    return { success: false, error: error.message };
  }
  await supabase.from("audit_logs").insert({ action: "create", entity_type: "building", entity_id: data.id, metadata: { code: input.code } });
  revalidatePath("/settings"); revalidatePath("/fr/settings");
  return { success: true, data };
}

export async function toggleBuildingActive(id: string, active: boolean): Promise<{ success: boolean; error?: string }> {
  await requireRole("admin");
  const supabase = await createClient();
  const { error } = await supabase.from("buildings").update({ is_active: active }).eq("id", id);
  if (error) return { success: false, error: error.message };
  revalidatePath("/settings"); revalidatePath("/fr/settings");
  return { success: true };
}

export async function toggleBuildingPaused(id: string, paused: boolean): Promise<{ success: boolean; error?: string }> {
  await requireRole("admin");
  const supabase = await createClient();
  const { error } = await supabase.from("buildings").update({ business_paused: paused }).eq("id", id);
  if (error) return { success: false, error: error.message };
  revalidatePath("/settings"); revalidatePath("/fr/settings");
  return { success: true };
}

// ── Company Info ──

export interface CompanyInfo {
  name: string;
  phone: string;
  address: string;
}

export async function getCompanyInfo(): Promise<CompanyInfo> {
  const supabase = await createClient();
  const { data } = await supabase.from("system_settings").select("key, value").in("key", ["company_name", "company_phone", "company_address"]);
  const map = new Map((data ?? []).map((r: any) => [r.key, r.value]));
  return { name: map.get("company_name") ?? "科建地产", phone: map.get("company_phone") ?? "", address: map.get("company_address") ?? "" };
}

export async function saveCompanyInfo(info: CompanyInfo): Promise<{ success: boolean; error?: string }> {
  await requireRole("admin");
  const supabase = await createClient();
  const entries = [
    { key: "company_name", value: info.name },
    { key: "company_phone", value: info.phone },
    { key: "company_address", value: info.address },
  ];
  const { error } = await supabase.from("system_settings").upsert(entries, { onConflict: "key" });
  if (error) return { success: false, error: error.message };
  revalidatePath("/settings"); revalidatePath("/fr/settings");
  return { success: true };
}
