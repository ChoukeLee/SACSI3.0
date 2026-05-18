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
}): Promise<{ success: boolean; data?: BuildingRow; error?: string }> {
  await requireRole("admin");

  if (!input.code.trim()) return { success: false, error: "Building code is required." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("buildings")
    .insert({
      code: input.code.trim(),
      display_name: input.displayName.trim(),
      floors_above_ground: input.floorsAboveGround,
      elevator_count: input.elevatorCount,
    })
    .select("*")
    .single();

  if (error) {
    if (error.code === "23505") return { success: false, error: "Building code already exists." };
    return { success: false, error: error.message };
  }

  await supabase.from("audit_logs").insert({
    action: "create",
    entity_type: "building",
    entity_id: data.id,
    metadata: { code: input.code },
  });

  revalidatePath("/settings");
  revalidatePath("/fr/settings");
  return { success: true, data };
}

export async function toggleBuildingActive(
  id: string,
  active: boolean
): Promise<{ success: boolean; error?: string }> {
  await requireRole("admin");

  const supabase = await createClient();
  const { error } = await supabase
    .from("buildings")
    .update({ is_active: active })
    .eq("id", id);

  if (error) return { success: false, error: error.message };

  await supabase.from("audit_logs").insert({
    action: active ? "activate" : "deactivate",
    entity_type: "building",
    entity_id: id,
    metadata: {},
  });

  revalidatePath("/settings");
  revalidatePath("/fr/settings");
  return { success: true };
}

export async function toggleBuildingPaused(
  id: string,
  paused: boolean
): Promise<{ success: boolean; error?: string }> {
  await requireRole("admin");

  const supabase = await createClient();
  const { error } = await supabase
    .from("buildings")
    .update({ business_paused: paused })
    .eq("id", id);

  if (error) return { success: false, error: error.message };

  revalidatePath("/settings");
  revalidatePath("/fr/settings");
  return { success: true };
}
