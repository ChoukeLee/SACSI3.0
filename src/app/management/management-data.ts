import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import type { ProjectRow } from "@/types/database";

export const getProjects = cache(async () => {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("projects")
    .select(
      "id, code, display_name, brand_name, project_kind, construction_status, allows_daily_rental, allows_long_lease, allows_sale, is_active, notes, created_at, updated_at",
    )
    .eq("is_active", true)
    .order("code");
  if (error) throw new Error(`Failed to load projects: ${error.message}`);
  return (data ?? []) as ProjectRow[];
});

export const getBuildings = cache(async () => {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("buildings")
    .select("id, project_id, display_name, is_active, code, construction_status")
    .eq("is_active", true)
    .order("code");
  if (error) throw new Error(`Failed to load buildings: ${error.message}`);
  return data ?? [];
});
