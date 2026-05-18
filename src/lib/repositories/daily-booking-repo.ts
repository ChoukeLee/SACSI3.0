import type { SupabaseClient } from "@supabase/supabase-js";
import type { DailyBookingRow, DailyBookingInsert, DailyBookingUpdate } from "@/types/database";

export function createDailyBookingRepo(client: SupabaseClient) {
  const table = () => client.from("daily_bookings");

  return {
    async getByUnitId(unitId: string): Promise<DailyBookingRow[]> {
      const { data, error } = await table()
        .select("*")
        .eq("unit_id", unitId)
        .order("check_in", { ascending: false });
      if (error) throw error;
      return data;
    },

    async getByDateRange(
      buildingId: string,
      startDate: string,
      endDate: string
    ): Promise<DailyBookingRow[]> {
      // Bookings whose stay overlaps [startDate, endDate] for units in the given building
      const { data, error } = await client
        .from("daily_bookings")
        .select("*, units!inner(building_id)")
        .eq("units.building_id", buildingId)
        .lte("check_in", endDate)
        .gte("check_out", startDate)
        .order("check_in");
      if (error) throw error;
      return data as unknown as DailyBookingRow[];
    },

    async getById(id: string): Promise<DailyBookingRow | null> {
      const { data, error } = await table().select("*").eq("id", id).single();
      if (error) {
        if (error.code === "PGRST116") return null;
        throw error;
      }
      return data;
    },

    async getByCustomerId(customerId: string): Promise<DailyBookingRow[]> {
      const { data, error } = await table()
        .select("*")
        .eq("customer_id", customerId)
        .order("check_in", { ascending: false });
      if (error) throw error;
      return data;
    },

    async findConflicts(
      unitId: string,
      checkIn: string,
      checkOut: string,
      excludeBookingId?: string
    ): Promise<DailyBookingRow[]> {
      let query = table()
        .select("*")
        .eq("unit_id", unitId)
        .lt("check_in", checkOut)
        .gt("check_out", checkIn);
      if (excludeBookingId) query = query.neq("id", excludeBookingId);
      const { data, error } = await query;
      if (error) throw error;
      return data;
    },

    async create(input: DailyBookingInsert): Promise<DailyBookingRow> {
      const { data, error } = await table().insert(input).select("*").single();
      if (error) throw error;
      return data;
    },

    async update(id: string, input: DailyBookingUpdate): Promise<DailyBookingRow> {
      const { data, error } = await table().update(input).eq("id", id).select("*").single();
      if (error) throw error;
      return data;
    },

    async updateStatus(id: string, status: string): Promise<void> {
      const { error } = await table().update({ status }).eq("id", id);
      if (error) throw error;
    },

    async getCalendarForBuilding(
      buildingId: string,
      monthStart: string,
      monthEnd: string
    ): Promise<DailyBookingRow[]> {
      return this.getByDateRange(buildingId, monthStart, monthEnd);
    },
  };
}

export type DailyBookingRepo = ReturnType<typeof createDailyBookingRepo>;
