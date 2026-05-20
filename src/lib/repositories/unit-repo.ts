import type { SupabaseClient } from "@supabase/supabase-js";
import type { UnitRow, UnitInsert, UnitUpdate, UnitBusinessFlagRow } from "@/types/database";
import type { UnitStatus, BusinessType } from "@/types/domain";
import { sortUnits } from "@/lib/utils";

export function createUnitRepo(client: SupabaseClient) {
  const table = () => client.from("units");
  const flagsTable = () => client.from("unit_business_flags");

  return {
    // ── Units ──

    async getByBuildingId(
      buildingId: string,
      opts?: { kind?: string; status?: UnitStatus }
    ): Promise<UnitRow[]> {
      let query = table().select("*").eq("building_id", buildingId).order("unit_no");
      if (opts?.kind) query = query.eq("kind", opts.kind);
      if (opts?.status) query = query.eq("status", opts.status);
      const { data, error } = await query;
      if (error) throw error;
      return sortUnits(data);
    },

    async getByBuildingCode(
      buildingCode: string,
      opts?: { kind?: string; status?: UnitStatus }
    ): Promise<UnitRow[]> {
      // Join through buildings table to resolve code → id
      let query = client
        .from("units")
        .select("*, buildings!inner(code)")
        .eq("buildings.code", buildingCode)
        .order("unit_no");
      if (opts?.kind) query = query.eq("kind", opts.kind);
      if (opts?.status) query = query.eq("status", opts.status);
      const { data, error } = await query;
      if (error) throw error;
      return sortUnits(data as unknown as UnitRow[]);
    },

    async getById(id: string): Promise<UnitRow | null> {
      const { data, error } = await table().select("*").eq("id", id).single();
      if (error) {
        if (error.code === "PGRST116") return null;
        throw error;
      }
      return data;
    },

    async getByCode(code: string): Promise<UnitRow | null> {
      const { data, error } = await table().select("*").eq("code", code).single();
      if (error) {
        if (error.code === "PGRST116") return null;
        throw error;
      }
      return data;
    },

    async getByUnitNo(buildingId: string, unitNo: string): Promise<UnitRow | null> {
      const { data, error } = await table()
        .select("*")
        .eq("building_id", buildingId)
        .eq("unit_no", unitNo)
        .single();
      if (error) {
        if (error.code === "PGRST116") return null;
        throw error;
      }
      return data;
    },

    async create(input: UnitInsert): Promise<UnitRow> {
      const { data, error } = await table().insert(input).select("*").single();
      if (error) throw error;
      return data;
    },

    async update(id: string, input: UnitUpdate): Promise<UnitRow> {
      const { data, error } = await table().update(input).eq("id", id).select("*").single();
      if (error) throw error;
      return data;
    },

    async updateStatus(id: string, status: UnitStatus): Promise<void> {
      const { error } = await table().update({ status }).eq("id", id);
      if (error) throw error;
    },

    async batchCreate(inputs: UnitInsert[]): Promise<UnitRow[]> {
      const { data, error } = await table().insert(inputs).select("*");
      if (error) throw error;
      return data;
    },

    async batchUpdateStatus(ids: string[], status: UnitStatus): Promise<void> {
      const { error } = await table().update({ status }).in("id", ids);
      if (error) throw error;
    },

    // ── Unit Business Flags ──

    async getBusinessFlags(unitId: string): Promise<UnitBusinessFlagRow[]> {
      const { data, error } = await flagsTable().select("*").eq("unit_id", unitId);
      if (error) throw error;
      return data;
    },

    async getUnitsWithBusinessType(
      buildingId: string,
      businessType: BusinessType
    ): Promise<UnitRow[]> {
      const { data, error } = await client
        .from("units")
        .select("*, unit_business_flags!inner(business_type, is_enabled, default_price_xof)")
        .eq("building_id", buildingId)
        .eq("unit_business_flags.business_type", businessType)
        .eq("unit_business_flags.is_enabled", true)
        .order("unit_no");
      if (error) throw error;
      return sortUnits(data as unknown as UnitRow[]);
    },

    async setBusinessFlag(
      unitId: string,
      businessType: BusinessType,
      isEnabled: boolean,
      defaultPriceXof?: number
    ): Promise<void> {
      const { error } = await flagsTable().upsert({
        unit_id: unitId,
        business_type: businessType,
        is_enabled: isEnabled,
        default_price_xof: defaultPriceXof ?? null,
      });
      if (error) throw error;
    },

    // ── Enriched queries ──

    async getWithBusinessFlags(buildingId: string): Promise<UnitRow[]> {
      const { data, error } = await table()
        .select("*, unit_business_flags(*)")
        .eq("building_id", buildingId)
        .order("unit_no");
      if (error) throw error;
      return sortUnits(data as unknown as UnitRow[]);
    },

    async getDailyRentalUnits(buildingId: string): Promise<UnitRow[]> {
      return this.getUnitsWithBusinessType(buildingId, "daily_rental");
    },
  };
}

export type UnitRepo = ReturnType<typeof createUnitRepo>;
