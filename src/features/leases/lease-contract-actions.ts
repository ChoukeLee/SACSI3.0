"use server";
import { createClient } from "@/lib/supabase/server";
import { guardLeaseWrite } from "./lease-action-guards";
import { requireRole } from "@/lib/auth";
import {
  refreshLeaseViews,
  leaseLifecycleError,
  leaseRequestRejected,
} from "./lease-lifecycle-service";
import type { LeaseContractRow } from "@/types/database";
import type { ContractStatus } from "@/types/domain";

export async function createLeaseContract(input: {
  unitId: string;
  customerId: string;
  contractNo: string;
  startDate: string;
  expectedEndDate: string;
  paymentCycle: string;
  paymentDay: number;
  monthlyRentXof: number;
  depositAmountXof: number;
  depositReceived: boolean;
  rentFreeDays: number;
  signerName?: string;
  status?: ContractStatus;
  requestId: string;
}): Promise<{ success: boolean; data?: LeaseContractRow; error?: string; rejected?: boolean }> {
  await guardLeaseWrite();
  const supabase = await createClient();
  const { requestId, contractNo: _displayOnly, ...payload } = input;
  const { data, error } = await supabase.rpc("lease_lifecycle_rpc", {
    p_operation: "create",
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
  return data as { success: boolean; data?: LeaseContractRow };
}
export async function activateContract(
  contractId: string,
  requestId: string,
  expectedUpdatedAt: string,
): Promise<{ success: boolean; error?: string; rejected?: boolean }> {
  await guardLeaseWrite();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("lease_lifecycle_rpc", {
    p_operation: "activate",
    p_input: { contractId, expectedUpdatedAt },
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
export async function terminateContract(
  contractId: string,
  requestId: string,
  expectedUpdatedAt: string,
): Promise<{ success: boolean; error?: string; rejected?: boolean }> {
  await requireRole("admin");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("lease_lifecycle_rpc", {
    p_operation: "terminate",
    p_input: { contractId, expectedUpdatedAt },
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
