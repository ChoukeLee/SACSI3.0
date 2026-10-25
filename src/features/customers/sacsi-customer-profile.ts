import "server-only";
import { createClient } from "@/lib/supabase/server";
import { fetchAllPages } from "@/lib/supabase/fetch-all";
import { fetchCustomerProfile } from "./customer-profile-service";
import { scopeCustomerProfile } from "./customer-profile-scope";

export async function fetchSacsiCustomerProfile(id: string) {
  const client = await createClient();
  const buildings = await fetchAllPages<{ id: string }>(
    (from, to) =>
      client
        .from("buildings")
        .select("id,project:projects!inner(code)", { count: "exact" })
        .eq("project.code", "SACSI")
        .order("id")
        .range(from, to),
    "SACSI profile scope",
  );
  if (!buildings.length) throw new Error("CustomerProfileScopeUnavailable");
  const data = await fetchCustomerProfile(id);
  return data
    ? scopeCustomerProfile(
        data,
        buildings.map((row) => row.id),
      )
    : null;
}
