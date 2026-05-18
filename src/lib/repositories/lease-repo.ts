import type { SupabaseClient } from "@supabase/supabase-js";
import type { LeaseContractRow, LeaseContractInsert, LeaseContractUpdate } from "@/types/database";
import type { ContractStatus } from "@/types/domain";

export function createLeaseRepo(client: SupabaseClient) {
  const table = () => client.from("lease_contracts");

  return {
    async getByBuildingId(
      buildingId: string,
      opts?: { status?: ContractStatus }
    ): Promise<LeaseContractRow[]> {
      let query = client
        .from("lease_contracts")
        .select("*, units!inner(building_id)")
        .eq("units.building_id", buildingId)
        .order("start_date", { ascending: false });
      if (opts?.status) query = query.eq("status", opts.status);
      const { data, error } = await query;
      if (error) throw error;
      return data as unknown as LeaseContractRow[];
    },

    async getById(id: string): Promise<LeaseContractRow | null> {
      const { data, error } = await table().select("*").eq("id", id).single();
      if (error) {
        if (error.code === "PGRST116") return null;
        throw error;
      }
      return data;
    },

    async getByContractNo(contractNo: string): Promise<LeaseContractRow | null> {
      const { data, error } = await table().select("*").eq("contract_no", contractNo).single();
      if (error) {
        if (error.code === "PGRST116") return null;
        throw error;
      }
      return data;
    },

    async getActiveByUnitId(unitId: string): Promise<LeaseContractRow | null> {
      const { data, error } = await table()
        .select("*")
        .eq("unit_id", unitId)
        .eq("status", "active")
        .single();
      if (error) {
        if (error.code === "PGRST116") return null;
        throw error;
      }
      return data;
    },

    async getByUnitId(unitId: string): Promise<LeaseContractRow[]> {
      const { data, error } = await table()
        .select("*")
        .eq("unit_id", unitId)
        .order("start_date", { ascending: false });
      if (error) throw error;
      return data;
    },

    async getByCustomerId(customerId: string): Promise<LeaseContractRow[]> {
      const { data, error } = await table()
        .select("*")
        .eq("customer_id", customerId)
        .order("start_date", { ascending: false });
      if (error) throw error;
      return data;
    },

    async create(input: LeaseContractInsert): Promise<LeaseContractRow> {
      const { data, error } = await table().insert(input).select("*").single();
      if (error) throw error;
      return data;
    },

    async update(id: string, input: LeaseContractUpdate): Promise<LeaseContractRow> {
      const { data, error } = await table().update(input).eq("id", id).select("*").single();
      if (error) throw error;
      return data;
    },

    async updateStatus(id: string, status: ContractStatus): Promise<void> {
      const { error } = await table().update({ status }).eq("id", id);
      if (error) throw error;
    },

    async getExpiringSoon(
      buildingId: string,
      withinDays: number
    ): Promise<LeaseContractRow[]> {
      const today = new Date();
      const cutoff = new Date(today);
      cutoff.setDate(cutoff.getDate() + withinDays);
      const todayStr = today.toISOString().slice(0, 10);
      const cutoffStr = cutoff.toISOString().slice(0, 10);

      const { data, error } = await client
        .from("lease_contracts")
        .select("*, units!inner(building_id)")
        .eq("units.building_id", buildingId)
        .eq("status", "active")
        .gte("expected_end_date", todayStr)
        .lte("expected_end_date", cutoffStr)
        .order("expected_end_date");
      if (error) throw error;
      return data as unknown as LeaseContractRow[];
    },
  };
}

export type LeaseRepo = ReturnType<typeof createLeaseRepo>;
