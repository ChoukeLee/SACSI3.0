import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  CustomerDirectoryError,
  customerDirectoryId,
  decodeCustomerDirectory,
  type CustomerDirectoryQuery,
} from "./customer-directory-model";

export async function readCustomerDirectory(
  client: SupabaseClient,
  query: CustomerDirectoryQuery,
  mode: "list" | "detail" = "list",
  customerId?: string,
  relationshipPage = 1,
) {
  if (
    (mode === "detail" && !customerDirectoryId(customerId)) ||
    !Number.isSafeInteger(relationshipPage) ||
    relationshipPage < 1 ||
    relationshipPage > 100000
  )
    throw new CustomerDirectoryError(400);
  const { data, error } = await client.rpc("customer_directory_read_rpc", {
    p_input: query,
    p_mode: mode,
    p_customer_id: customerId ?? null,
    p_relation_page: relationshipPage,
  });
  if (error)
    throw new CustomerDirectoryError(
      error.code === "42501"
        ? 403
        : error.code === "22023"
          ? 400
          : error.code === "P0002"
            ? 404
            : 503,
    );
  return decodeCustomerDirectory(data, query, mode, customerId, relationshipPage);
}
