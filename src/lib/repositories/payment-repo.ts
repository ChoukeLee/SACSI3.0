import type { SupabaseClient } from "@supabase/supabase-js";
import type { PaymentRow, PaymentInsert, PaymentUpdate } from "@/types/database";

export function createPaymentRepo(client: SupabaseClient) {
  const table = () => client.from("payments");

  return {
    async getBySource(sourceType: string, sourceId: string): Promise<PaymentRow[]> {
      const { data, error } = await table()
        .select("*")
        .eq("source_type", sourceType)
        .eq("source_id", sourceId)
        .order("payment_date", { ascending: false });
      if (error) throw error;
      return data;
    },

    async getByCustomerId(customerId: string): Promise<PaymentRow[]> {
      const { data, error } = await table()
        .select("*")
        .eq("customer_id", customerId)
        .order("payment_date", { ascending: false });
      if (error) throw error;
      return data;
    },

    async getByUnitId(unitId: string): Promise<PaymentRow[]> {
      const { data, error } = await table()
        .select("*")
        .eq("unit_id", unitId)
        .order("payment_date", { ascending: false });
      if (error) throw error;
      return data;
    },

    async getByDateRange(
      buildingId: string,
      startDate: string,
      endDate: string
    ): Promise<PaymentRow[]> {
      const { data, error } = await client
        .from("payments")
        .select("*, units!inner(building_id)")
        .eq("units.building_id", buildingId)
        .gte("payment_date", startDate)
        .lte("payment_date", endDate)
        .order("payment_date", { ascending: false });
      if (error) throw error;
      return data as unknown as PaymentRow[];
    },

    async getById(id: string): Promise<PaymentRow | null> {
      const { data, error } = await table().select("*").eq("id", id).single();
      if (error) {
        if (error.code === "PGRST116") return null;
        throw error;
      }
      return data;
    },

    async create(input: PaymentInsert): Promise<PaymentRow> {
      const { data, error } = await table().insert(input).select("*").single();
      if (error) throw error;
      return data;
    },

    async update(id: string, input: PaymentUpdate): Promise<PaymentRow> {
      const { data, error } = await table().update(input).eq("id", id).select("*").single();
      if (error) throw error;
      return data;
    },

    async getTotalBySource(sourceType: string, sourceId: string): Promise<number> {
      const { data, error } = await table()
        .select("amount, currency, exchange_rate_to_xof")
        .eq("source_type", sourceType)
        .eq("source_id", sourceId);
      if (error) throw error;
      return data.reduce((sum, p) => {
        const amountXof = Number(p.amount) * Number(p.exchange_rate_to_xof);
        return sum + amountXof;
      }, 0);
    },

    async getReceiptNos(): Promise<string[]> {
      const { data, error } = await table()
        .select("receipt_no")
        .not("receipt_no", "is", null)
        .order("payment_date", { ascending: false });
      if (error) throw error;
      return data.map((r) => r.receipt_no!);
    },
  };
}

export type PaymentRepo = ReturnType<typeof createPaymentRepo>;
