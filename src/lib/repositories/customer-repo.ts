import type { SupabaseClient } from "@supabase/supabase-js";
import type { CustomerRow, CustomerInsert, CustomerUpdate } from "@/types/database";

export function createCustomerRepo(client: SupabaseClient) {
  const table = () => client.from("customers");

  return {
    async getAll(opts?: { search?: string; blacklisted?: boolean }): Promise<CustomerRow[]> {
      let query = table().select("*").order("name");
      if (opts?.search) query = query.ilike("name", `%${opts.search}%`);
      if (opts?.blacklisted !== undefined) query = query.eq("is_blacklisted", opts.blacklisted);
      const { data, error } = await query;
      if (error) throw error;
      return data;
    },

    async getById(id: string): Promise<CustomerRow | null> {
      const { data, error } = await table().select("*").eq("id", id).single();
      if (error) {
        if (error.code === "PGRST116") return null;
        throw error;
      }
      return data;
    },

    async getByPhone(phone: string): Promise<CustomerRow[]> {
      const { data, error } = await table().select("*").eq("phone", phone);
      if (error) throw error;
      return data;
    },

    async create(input: CustomerInsert): Promise<CustomerRow> {
      const { data, error } = await table().insert(input).select("*").single();
      if (error) throw error;
      return data;
    },

    async update(id: string, input: CustomerUpdate): Promise<CustomerRow> {
      const { data, error } = await table().update(input).eq("id", id).select("*").single();
      if (error) throw error;
      return data;
    },

    async setBlacklisted(
      id: string,
      reason: string,
      operatorId: string,
      permanent: boolean
    ): Promise<void> {
      const { error } = await table()
        .update({
          is_blacklisted: true,
          blacklist_reason: reason,
          blacklist_operator_id: operatorId,
          blacklist_date: new Date().toISOString().slice(0, 10),
          blacklist_permanent: permanent,
        })
        .eq("id", id);
      if (error) throw error;
    },

    async removeBlacklist(id: string): Promise<void> {
      const { error } = await table()
        .update({
          is_blacklisted: false,
          blacklist_reason: null,
          blacklist_operator_id: null,
          blacklist_date: null,
          blacklist_permanent: false,
        })
        .eq("id", id);
      if (error) throw error;
    },

    async findDuplicates(name: string, phone?: string): Promise<CustomerRow[]> {
      let query = table().select("*").ilike("name", name);
      if (phone) query = query.or(`phone.eq.${phone}`);
      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
  };
}

export type CustomerRepo = ReturnType<typeof createCustomerRepo>;
