import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CimacBillingQuery } from "./cimac-billing-query";
import { decodeCimacCustomerAccount } from "./cimac-billing-model";

export async function readCimacCustomerAccount(
  client: Pick<SupabaseClient, "rpc">,
  query: CimacBillingQuery,
) {
  const { data, error } = await client.rpc("cimac_customer_account_rpc", {
    p_customer_id: query.customerId ?? null,
    p_search: query.search || null,
    p_page: query.customerPage,
  });
  if (error || !data) throw new Error("CimacAccountUnavailable");
  const result = decodeCimacCustomerAccount(data, query.customerId);
  if (result.customerPage.page !== query.customerPage) throw new Error("CimacAccountUnavailable");
  return result;
}
