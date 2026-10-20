import "server-only";
import { createClient } from "@/lib/supabase/server";
import {
  decodeOperatorInboxResult,
  operatorInboxFilters,
  type OperatorInboxQuery,
} from "./operator-inbox-model";
export async function readOperatorInbox(query: OperatorInboxQuery) {
  const client = await createClient();
  const { data, error } = await client.rpc("operator_task_inbox_page_rpc", {
    p_filters: operatorInboxFilters(query),
    p_page: query.page,
  });
  if (error) throw new Error("OperatorInboxReadUnavailable");
  return decodeOperatorInboxResult(data, query);
}
