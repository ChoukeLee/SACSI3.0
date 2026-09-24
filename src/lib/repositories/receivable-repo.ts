import type { SupabaseClient } from "@supabase/supabase-js";
import type { ReceivableRow } from "@/types/database";

export function createReceivableRepo(client: SupabaseClient) {
  const table = () => client.from("receivables");

  return {
    async list(filters?: {
      buildingId?: string;
      unitId?: string;
      status?: string;
      sourceType?: string;
      dateFrom?: string;
      dateTo?: string;
    }): Promise<ReceivableRow[]> {
      let query = table().select("*").order("due_date", { ascending: false }).limit(1000);
      if (filters?.buildingId) query = query.eq("building_id", filters.buildingId);
      if (filters?.unitId) query = query.eq("unit_id", filters.unitId);
      if (filters?.status) query = query.eq("status", filters.status);
      if (filters?.sourceType) query = query.eq("source_type", filters.sourceType);
      if (filters?.dateFrom) query = query.gte("due_date", filters.dateFrom);
      if (filters?.dateTo) query = query.lte("due_date", filters.dateTo);
      const { data, error } = await query;
      if (error) throw error;
      return data;
    },

    async getById(id: string): Promise<ReceivableRow | null> {
      const { data, error } = await table().select("*").eq("id", id).single();
      if (error) {
        if (error.code === "PGRST116") return null;
        throw error;
      }
      return data;
    },

    async getBySource(sourceType: string, sourceId: string): Promise<ReceivableRow[]> {
      const { data, error } = await table()
        .select("*")
        .eq("source_type", sourceType)
        .eq("source_id", sourceId)
        .order("due_date");
      if (error) throw error;
      return data;
    },

    async getSummary(filters?: {
      buildingId?: string;
      dateFrom?: string;
      dateTo?: string;
    }): Promise<{
      totalReceivable: number;
      totalPaid: number;
      totalOutstanding: number;
      totalOverdue: number;
    }> {
      let query = table().select("amount_xof, paid_amount_xof, status, due_date").neq("status", "cancelled");
      if (filters?.buildingId) query = query.eq("building_id", filters.buildingId);
      if (filters?.dateFrom) query = query.gte("due_date", filters.dateFrom);
      if (filters?.dateTo) query = query.lte("due_date", filters.dateTo);

      const { data, error } = await query;
      if (error) throw error;

      const today = new Date().toISOString().slice(0, 10);
      let totalReceivable = 0;
      let totalPaid = 0;
      let totalOverdue = 0;

      for (const r of data ?? []) {
        totalReceivable += Number(r.amount_xof);
        totalPaid += Number(r.paid_amount_xof);
        if (r.status === "overdue" || (Number(r.paid_amount_xof) < Number(r.amount_xof) && r.due_date < today)) {
          totalOverdue += Number(r.amount_xof) - Number(r.paid_amount_xof);
        }
      }

      return {
        totalReceivable,
        totalPaid,
        totalOutstanding: totalReceivable - totalPaid,
        totalOverdue,
      };
    },
  };
}

export type ReceivableRepo = ReturnType<typeof createReceivableRepo>;

/** Pure status computation — also used server-side before DB update. */
export function computeStatus(
  amountXof: number,
  paidAmountXof: number,
  dueDate: string,
): string {
  if (paidAmountXof >= amountXof) return "paid";
  if (paidAmountXof > 0) return "partial";
  const today = new Date().toISOString().slice(0, 10);
  if (dueDate < today) return "overdue";
  return "pending";
}
