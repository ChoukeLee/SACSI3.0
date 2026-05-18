import type { SupabaseClient } from "@supabase/supabase-js";
import type { LedgerEntryRow, LedgerEntryInsert, LedgerEntryUpdate } from "@/types/database";

export function createLedgerRepo(client: SupabaseClient) {
  const table = () => client.from("ledger_entries");

  return {
    async getByBuildingId(
      buildingId: string,
      opts?: { startDate?: string; endDate?: string; direction?: string; category?: string }
    ): Promise<LedgerEntryRow[]> {
      let query = table()
        .select("*")
        .eq("building_id", buildingId)
        .order("entry_date", { ascending: false });
      if (opts?.startDate) query = query.gte("entry_date", opts.startDate);
      if (opts?.endDate) query = query.lte("entry_date", opts.endDate);
      if (opts?.direction) query = query.eq("direction", opts.direction);
      if (opts?.category) query = query.eq("category", opts.category);
      const { data, error } = await query;
      if (error) throw error;
      return data;
    },

    async getByUnitId(unitId: string): Promise<LedgerEntryRow[]> {
      const { data, error } = await table()
        .select("*")
        .eq("unit_id", unitId)
        .order("entry_date", { ascending: false });
      if (error) throw error;
      return data;
    },

    async getById(id: string): Promise<LedgerEntryRow | null> {
      const { data, error } = await table().select("*").eq("id", id).single();
      if (error) {
        if (error.code === "PGRST116") return null;
        throw error;
      }
      return data;
    },

    async getByPaymentId(paymentId: string): Promise<LedgerEntryRow[]> {
      const { data, error } = await table().select("*").eq("payment_id", paymentId);
      if (error) throw error;
      return data;
    },

    async create(input: LedgerEntryInsert): Promise<LedgerEntryRow> {
      const { data, error } = await table().insert(input).select("*").single();
      if (error) throw error;
      return data;
    },

    async update(id: string, input: LedgerEntryUpdate): Promise<LedgerEntryRow> {
      const { data, error } = await table().update(input).eq("id", id).select("*").single();
      if (error) throw error;
      return data;
    },

    async getMonthlySummary(
      buildingId: string,
      year: number,
      month: number
    ): Promise<{
      total_income_xof: number;
      total_expense_xof: number;
    }> {
      const startDate = `${year}-${String(month).padStart(2, "0")}-01`;
      const endDate = new Date(year, month, 0).toISOString().slice(0, 10);

      const { data, error } = await table()
        .select("direction, amount_xof")
        .eq("building_id", buildingId)
        .gte("entry_date", startDate)
        .lte("entry_date", endDate);
      if (error) throw error;

      const income = data
        .filter((e) => e.direction === "income")
        .reduce((s, e) => s + Number(e.amount_xof), 0);
      const expense = data
        .filter((e) => e.direction === "expense")
        .reduce((s, e) => s + Number(e.amount_xof), 0);

      return { total_income_xof: income, total_expense_xof: expense };
    },

    async getCategorySummary(
      buildingId: string,
      startDate: string,
      endDate: string
    ): Promise<{ category: string; direction: string; total_xof: number }[]> {
      const { data, error } = await table()
        .select("category, direction, amount_xof")
        .eq("building_id", buildingId)
        .gte("entry_date", startDate)
        .lte("entry_date", endDate);
      if (error) throw error;

      const grouped: Record<string, { category: string; direction: string; total_xof: number }> = {};
      for (const entry of data) {
        const key = `${entry.direction}:${entry.category}`;
        if (!grouped[key]) {
          grouped[key] = {
            category: entry.category,
            direction: entry.direction,
            total_xof: 0,
          };
        }
        grouped[key].total_xof += Number(entry.amount_xof);
      }
      return Object.values(grouped);
    },
  };
}

export type LedgerRepo = ReturnType<typeof createLedgerRepo>;
