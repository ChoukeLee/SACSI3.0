import type { SupabaseClient } from "@supabase/supabase-js";
import type { BuildingRow, BuildingInsert, BuildingUpdate } from "@/types/database";
import type { BuildingCode } from "@/types/domain";

export function createBuildingRepo(client: SupabaseClient) {
  const table = () => client.from("buildings");

  return {
    async getAll(): Promise<BuildingRow[]> {
      const { data, error } = await table().select("*").order("code");
      if (error) throw error;
      return data;
    },

    async getActive(): Promise<BuildingRow[]> {
      const { data, error } = await table()
        .select("*")
        .eq("is_active", true)
        .order("code");
      if (error) throw error;
      return data;
    },

    async getById(id: string): Promise<BuildingRow | null> {
      const { data, error } = await table().select("*").eq("id", id).single();
      if (error) {
        if (error.code === "PGRST116") return null;
        throw error;
      }
      return data;
    },

    async getByCode(code: BuildingCode): Promise<BuildingRow | null> {
      const { data, error } = await table().select("*").eq("code", code).single();
      if (error) {
        if (error.code === "PGRST116") return null;
        throw error;
      }
      return data;
    },

    async getIdByCode(code: BuildingCode): Promise<string | null> {
      const row = await this.getByCode(code);
      return row?.id ?? null;
    },

    async create(input: BuildingInsert): Promise<BuildingRow> {
      const { data, error } = await table().insert(input).select("*").single();
      if (error) throw error;
      return data;
    },

    async update(id: string, input: BuildingUpdate): Promise<BuildingRow> {
      const { data, error } = await table().update(input).eq("id", id).select("*").single();
      if (error) throw error;
      return data;
    },

    async setActive(id: string, active: boolean): Promise<void> {
      const { error } = await table().update({ is_active: active }).eq("id", id);
      if (error) throw error;
    },

    async setBusinessPaused(id: string, paused: boolean): Promise<void> {
      const { error } = await table().update({ business_paused: paused }).eq("id", id);
      if (error) throw error;
    },
  };
}

export type BuildingRepo = ReturnType<typeof createBuildingRepo>;
