import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { hasPermission, type CurrentUser } from "@/lib/auth";
import { writeAuditLog } from "@/lib/audit";
import { createDraftId, extractRoomNumbers, nowIso } from "../utils";
import type { AssistantOperationDraft, AssistantOperationDraftInput, AssistantOperationExecutionResult, AssistantOperationHandler, AssistantOperationValidation } from "../types";

const CONTRACT_TERMS = /合同|编号|资料待补|编号待整理|legacy|LEGACY/i;

async function findLegacyLeaseContracts(roomNumbers: string[]) {
  if (roomNumbers.length === 0) return [];
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("lease_contracts")
    .select("id, contract_no, start_date, monthly_rent_xof, deposit_amount_xof, unit:units!inner(id, unit_no, building:buildings!inner(code)), customer:customers(id, name, notes)")
    .in("unit.unit_no", roomNumbers)
    .eq("status", "active")
    .like("contract_no", "LEGACY-LEASE-%");
  if (error) throw error;
  type Raw = {
    id: string;
    contract_no: string;
    start_date: string;
    monthly_rent_xof: number;
    deposit_amount_xof: number;
    unit: { id: string; unit_no: string; building: { code: string } | { code: string }[] } | { id: string; unit_no: string; building: { code: string } | { code: string }[] }[];
    customer: { id: string; name: string; notes: string | null } | { id: string; name: string; notes: string | null }[] | null;
  };
  return ((data ?? []) as Raw[]).map((row) => {
    const unit = Array.isArray(row.unit) ? row.unit[0] : row.unit;
    const customer = Array.isArray(row.customer) ? row.customer[0] : row.customer;
    const building = Array.isArray(unit.building) ? unit.building[0] : unit.building;
    return { ...row, unit: { ...unit, building }, customer };
  });
}

function targetContractNo(roomNo: string, startDate: string) {
  return `MANAGED-LEASE-${roomNo}-${startDate.replaceAll("-", "")}`;
}

export const leaseNumberCleanupOperation: AssistantOperationHandler = {
  action: "lease_number_cleanup",
  match(input) {
    return CONTRACT_TERMS.test(input.message) && /整理|修正|取消|不再|清理|finalize|cleanup/i.test(input.message);
  },
  async buildDraft(input: AssistantOperationDraftInput): Promise<AssistantOperationDraft> {
    const roomNumbers = extractRoomNumbers(input.message);
    const contracts = await findLegacyLeaseContracts(roomNumbers);
    const missing = roomNumbers.length === 0 ? ["roomNumbers"] : [];
    const warnings: string[] = [];
    const changes = contracts.flatMap((contract) => {
      const roomNo = contract.unit.unit_no;
      const isPlaceholderCustomer = contract.customer?.name?.includes("资料待补") || contract.customer?.notes?.includes("legacy_placeholder=true");
      if (isPlaceholderCustomer) {
        warnings.push(`${roomNo}: placeholder customer still present`);
        return [];
      }
      const nextNo = targetContractNo(roomNo, contract.start_date);
      return [{
        table: "lease_contracts",
        type: "update" as const,
        entityId: contract.id,
        label: `Room ${roomNo}`,
        before: { contract_no: contract.contract_no },
        after: { contract_no: nextNo },
      }];
    });
    if (roomNumbers.length > 0 && changes.length === 0) missing.push("legacy_lease_contract");
    return {
      id: createDraftId(["lease_number_cleanup", roomNumbers, changes.map((change) => change.entityId)]),
      action: "lease_number_cleanup",
      summary: input.locale === "zh" ? `整理 ${roomNumbers.join("、") || "-"} 长租合同编号` : `Nettoyer les numéros de bail ${roomNumbers.join(", ") || "-"}`,
      riskLevel: missing.length > 0 || warnings.length > 0 ? "blocked" : "medium",
      requiresConfirmation: true,
      executable: missing.length === 0 && warnings.length === 0,
      locale: input.locale,
      originalMessage: input.message,
      roomNumbers,
      changes,
      missing,
      warnings,
      permissions: ["leases:write"],
      metadata: { operation: "lease_number_cleanup" },
      createdAt: nowIso(),
    };
  },
  async validate(draft: AssistantOperationDraft, user: CurrentUser): Promise<AssistantOperationValidation> {
    const missing = [...draft.missing];
    const warnings = [...draft.warnings];
    if (!hasPermission(user, "leases:write")) missing.push("permission:leases:write");
    if (draft.changes.length === 0) missing.push("legacy_lease_contract");
    const ok = missing.length === 0 && warnings.length === 0;
    return { ok, riskLevel: ok ? "medium" : "blocked", missing: [...new Set(missing)], warnings: [...new Set(warnings)], changes: draft.changes };
  },
  async execute(draft: AssistantOperationDraft, user: CurrentUser): Promise<AssistantOperationExecutionResult> {
    const validation = await this.validate(draft, user);
    if (!validation.ok) return { success: false, action: "lease_number_cleanup", message: "Draft validation failed.", affectedRecords: [], metadata: { validation } };
    const supabase = await createClient();
    const affectedRecords = [];
    for (const change of draft.changes) {
      const nextNo = String(change.after?.contract_no ?? "");
      if (!change.entityId || !nextNo) continue;
      const { data: before } = await supabase.from("lease_contracts").select("id, contract_no").eq("id", change.entityId).single();
      const { error } = await supabase.from("lease_contracts").update({ contract_no: nextNo }).eq("id", change.entityId).like("contract_no", "LEGACY-LEASE-%");
      if (error) return { success: false, action: "lease_number_cleanup", message: error.message, affectedRecords };
      await writeAuditLog({
        action: "finalize_legacy_lease_contract_no",
        entityType: "lease_contract",
        entityId: change.entityId,
        entityLabel: change.label,
        beforeData: before ?? change.before,
        afterData: { contract_no: nextNo },
        metadata: { original_message: draft.originalMessage, finance_entries_created: false },
      });
      affectedRecords.push(change);
    }
    revalidatePath("/leases"); revalidatePath("/fr/leases");
    revalidatePath("/settings/audit-logs"); revalidatePath("/fr/settings/audit-logs");
    return { success: true, action: "lease_number_cleanup", message: draft.locale === "zh" ? "合同编号已整理。" : "Numéro de bail nettoyé.", auditAction: "finalize_legacy_lease_contract_no", affectedRecords };
  },
};
