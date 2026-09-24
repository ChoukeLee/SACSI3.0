"use server";
import { createClient } from "@/lib/supabase/server";
import { guardLeaseFinance } from "./lease-action-guards";
import {
  refreshLeaseViews,
  leaseLifecycleError,
  leaseRequestRejected,
} from "./lease-lifecycle-service";
export async function processMoveOut(input: {
  contractId: string;
  actualEndDate: string;
  unpaidRentXof: number;
  utilityCleared: boolean;
  depositDeductionXof: number;
  depositRefundXof: number;
  notes?: string;
  requestId: string;
  expectedUpdatedAt: string;
  rentCollectedConfirmed: boolean;
  paymentMethod?: "cash" | "check" | "bank_transfer" | "offset" | "other";
}): Promise<{ success: boolean; error?: string; rejected?: boolean }> {
  await guardLeaseFinance();
  const supabase = await createClient();
  const { requestId, ...payload } = input;
  const { data, error } = await supabase.rpc("lease_lifecycle_rpc", {
    p_operation: "move_out",
    p_input: payload,
    p_request_id: requestId,
  });
  if (error)
    return {
      success: false,
      error: leaseLifecycleError(error.message),
      rejected: leaseRequestRejected(error.code, error.message),
    };
  if (!data?.success)
    return { success: false, error: "结果未确认，请保留原请求号重试。", rejected: false };
  refreshLeaseViews();
  return { success: true };
}
