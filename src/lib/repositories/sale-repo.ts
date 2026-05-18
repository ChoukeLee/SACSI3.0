import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  SaleContractRow,
  SaleContractInsert,
  SaleContractUpdate,
  SalePaymentScheduleRow,
  SalePaymentScheduleInsert,
  SalePaymentScheduleUpdate,
} from "@/types/database";
import type { ContractStatus } from "@/types/domain";

export function createSaleRepo(client: SupabaseClient) {
  const table = () => client.from("sale_contracts");
  const scheduleTable = () => client.from("sale_payment_schedule");

  return {
    // ── Sale Contracts ──

    async getByBuildingId(
      buildingId: string,
      opts?: { status?: ContractStatus }
    ): Promise<SaleContractRow[]> {
      let query = client
        .from("sale_contracts")
        .select("*, units!inner(building_id)")
        .eq("units.building_id", buildingId)
        .order("signed_date", { ascending: false });
      if (opts?.status) query = query.eq("status", opts.status);
      const { data, error } = await query;
      if (error) throw error;
      return data as unknown as SaleContractRow[];
    },

    async getById(id: string): Promise<SaleContractRow | null> {
      const { data, error } = await table().select("*").eq("id", id).single();
      if (error) {
        if (error.code === "PGRST116") return null;
        throw error;
      }
      return data;
    },

    async getByContractNo(contractNo: string): Promise<SaleContractRow | null> {
      const { data, error } = await table().select("*").eq("contract_no", contractNo).single();
      if (error) {
        if (error.code === "PGRST116") return null;
        throw error;
      }
      return data;
    },

    async getByUnitId(unitId: string): Promise<SaleContractRow[]> {
      const { data, error } = await table()
        .select("*")
        .eq("unit_id", unitId)
        .order("signed_date", { ascending: false });
      if (error) throw error;
      return data;
    },

    async getByCustomerId(customerId: string): Promise<SaleContractRow[]> {
      const { data, error } = await table()
        .select("*")
        .eq("customer_id", customerId)
        .order("signed_date", { ascending: false });
      if (error) throw error;
      return data;
    },

    async create(input: SaleContractInsert): Promise<SaleContractRow> {
      const { data, error } = await table().insert(input).select("*").single();
      if (error) throw error;
      return data;
    },

    async update(id: string, input: SaleContractUpdate): Promise<SaleContractRow> {
      const { data, error } = await table().update(input).eq("id", id).select("*").single();
      if (error) throw error;
      return data;
    },

    async updateStatus(id: string, status: ContractStatus): Promise<void> {
      const { error } = await table().update({ status }).eq("id", id);
      if (error) throw error;
    },

    // ── Payment Schedule ──

    async getSchedule(contractId: string): Promise<SalePaymentScheduleRow[]> {
      const { data, error } = await scheduleTable()
        .select("*")
        .eq("sale_contract_id", contractId)
        .order("installment_no");
      if (error) throw error;
      return data;
    },

    async getScheduleById(scheduleId: string): Promise<SalePaymentScheduleRow | null> {
      const { data, error } = await scheduleTable().select("*").eq("id", scheduleId).single();
      if (error) {
        if (error.code === "PGRST116") return null;
        throw error;
      }
      return data;
    },

    async createScheduleItem(
      input: SalePaymentScheduleInsert
    ): Promise<SalePaymentScheduleRow> {
      const { data, error } = await scheduleTable().insert(input).select("*").single();
      if (error) throw error;
      return data;
    },

    async updateScheduleItem(
      id: string,
      input: SalePaymentScheduleUpdate
    ): Promise<SalePaymentScheduleRow> {
      const { data, error } = await scheduleTable().update(input).eq("id", id).select("*").single();
      if (error) throw error;
      return data;
    },

    async batchCreateSchedule(
      inputs: SalePaymentScheduleInsert[]
    ): Promise<SalePaymentScheduleRow[]> {
      const { data, error } = await scheduleTable().insert(inputs).select("*");
      if (error) throw error;
      return data;
    },

    async getRemainingBalance(contractId: string): Promise<number> {
      const { data, error } = await scheduleTable()
        .select("amount_xof, status")
        .eq("sale_contract_id", contractId);
      if (error) throw error;
      return data
        .filter((r) => r.status !== "paid")
        .reduce((sum, r) => sum + Number(r.amount_xof), 0);
    },
  };
}

export type SaleRepo = ReturnType<typeof createSaleRepo>;
