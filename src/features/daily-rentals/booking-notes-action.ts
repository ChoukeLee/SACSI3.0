"use server";

import { getCurrentUser, hasPermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function saveBookingNotes(input: {
  bookingId: string;
  unitId: string;
  expectedNotes: string | null;
  notes: string;
}): Promise<
  | { status: "saved" | "conflict"; notes: string | null }
  | { status: "forbidden" | "invalid" | "unavailable" }
> {
  if (
    !input ||
    typeof input.bookingId !== "string" ||
    !uuid.test(input.bookingId) ||
    typeof input.unitId !== "string" ||
    !uuid.test(input.unitId) ||
    (input.expectedNotes !== null && typeof input.expectedNotes !== "string") ||
    typeof input.notes !== "string"
  ) {
    return { status: "invalid" };
  }
  const notes = input.notes.trim();
  if (Array.from(notes).length > 4000 || notes.startsWith("[历史补录]")) {
    return { status: "invalid" };
  }
  if (!hasPermission(await getCurrentUser(), "daily_rentals:write")) {
    return { status: "forbidden" };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("update_daily_booking_notes_rpc", {
    p_booking_id: input.bookingId,
    p_unit_id: input.unitId,
    p_expected_notes: input.expectedNotes,
    p_notes: notes || null,
  });
  if (error?.code === "42501") return { status: "forbidden" };
  if (error?.code === "22023") return { status: "invalid" };
  if (
    error ||
    (data?.status !== "saved" && data?.status !== "conflict") ||
    (data.notes !== null && typeof data.notes !== "string")
  ) {
    return { status: "unavailable" };
  }
  return { status: data.status, notes: data.notes };
}
