import "server-only";

import { randomUUID } from "node:crypto";
import { requireAuth } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  AI_INPUT_MAX_BYTES,
  assertTargetVersionsUnchanged,
  buildAiInputStoragePath,
  type AiInputMode,
  type AiInputType,
  type AiProposalDraft,
  type BusinessTarget,
  type TargetVersionMap,
  targetVersionKey,
  validateAiProposalDraft,
} from "./ai-draft-model";
import { requireBusinessActionRole } from "./registry";

type RpcTransitionResult = {
  success: boolean;
  idempotent?: boolean;
  status?: string;
  version?: number;
  error?: string;
};

const TARGET_TABLES = [
  ["projectId", "project", "projects"],
  ["buildingId", "building", "buildings"],
  ["unitId", "unit", "units"],
  ["bookingId", "daily_booking", "daily_bookings"],
  ["leaseContractId", "lease_contract", "lease_contracts"],
  ["saleContractId", "sale_contract", "sale_contracts"],
  ["customerId", "customer", "customers"],
] as const;

export async function loadBusinessTargetVersions(target: BusinessTarget): Promise<TargetVersionMap> {
  const supabase = await createClient();
  const versions: TargetVersionMap = {};

  for (const [targetField, entity, table] of TARGET_TABLES) {
    const id = target[targetField];
    if (!id) continue;
    const { data, error } = await supabase.from(table).select("id, updated_at").eq("id", id).maybeSingle();
    if (error) throw new Error(`读取${entity}版本失败：${error.message}`);
    if (!data) throw new Error(`操作对象不存在或当前账号无权访问：${entity}:${id}`);
    versions[targetVersionKey(entity, id)] = String(data.updated_at ?? "missing-version");
  }
  return versions;
}

export async function createAiJob(input: {
  projectId?: string;
  requestId?: string;
  inputMode?: AiInputMode;
  locale?: "zh" | "fr";
}) {
  const user = await requireAuth();
  const supabase = await createClient();
  const requestId = input.requestId ?? randomUUID();
  const { data, error } = await supabase
    .from("ai_jobs")
    .insert({
      actor_id: user.id,
      actor_role: user.role,
      project_id: input.projectId ?? null,
      request_id: requestId,
      input_mode: input.inputMode ?? "text",
      locale: input.locale ?? "zh",
      timezone: "Africa/Abidjan",
    })
    .select("id, request_id, status, created_at")
    .single();
  if (error || !data) throw new Error(error?.message ?? "AI 任务创建失败。");
  return data;
}

export async function addAiTextInput(jobId: string, sequenceNo: number, rawText: string) {
  await requireAuth();
  const text = rawText.trim();
  if (!text) throw new Error("文字输入不能为空。");
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("ai_inputs")
    .insert({ job_id: jobId, sequence_no: sequenceNo, input_type: "text", raw_text: text })
    .select("id, job_id, sequence_no, input_type")
    .single();
  if (error || !data) throw new Error(error?.message ?? "AI 输入保存失败。");
  return data;
}

export async function reserveAiFileInput(input: {
  jobId: string;
  sequenceNo: number;
  inputType: Exclude<AiInputType, "text">;
  filename: string;
  mimeType: string;
  fileSizeBytes: number;
}) {
  const user = await requireAuth();
  if (!Number.isInteger(input.fileSizeBytes) || input.fileSizeBytes < 0 || input.fileSizeBytes > AI_INPUT_MAX_BYTES) {
    throw new Error("文件大小无效或超过 20 MB 上限。");
  }
  const inputId = randomUUID();
  const storagePath = buildAiInputStoragePath(user.id, input.jobId, inputId, input.filename);
  const supabase = await createClient();
  const { data: upload, error: uploadError } = await supabase.storage.from("ai-inputs").createSignedUploadUrl(storagePath);
  if (uploadError || !upload) throw new Error(uploadError?.message ?? "无法创建私有上传地址。");
  const { error } = await supabase.from("ai_inputs").insert({
    id: inputId,
    job_id: input.jobId,
    sequence_no: input.sequenceNo,
    input_type: input.inputType,
    storage_bucket: "ai-inputs",
    storage_path: storagePath,
    original_filename: input.filename,
    mime_type: input.mimeType,
    file_size_bytes: input.fileSizeBytes,
  });
  if (error) throw new Error(error.message);
  return { inputId, storagePath, token: upload.token };
}

export async function createAiProposal(jobId: string, sequenceNo: number, draft: AiProposalDraft) {
  const user = await requireAuth();
  const { definition, expiresAt } = validateAiProposalDraft(draft);
  requireBusinessActionRole(user.role, draft.action);
  const currentVersions = await loadBusinessTargetVersions(draft.target);
  if (Object.keys(draft.beforeVersions).length > 0) {
    assertTargetVersionsUnchanged(draft.beforeVersions, currentVersions);
  }
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("ai_proposed_actions")
    .insert({
      job_id: jobId,
      sequence_no: sequenceNo,
      action_name: draft.action,
      risk_level: definition.risk,
      status: draft.requiresClarification ? "awaiting_clarification" : "proposed",
      target: draft.target,
      action_input: draft.input,
      before_snapshot: draft.beforeSnapshot,
      before_versions: currentVersions,
      expected_effects: draft.expectedEffects,
      warnings: draft.warnings ?? [],
      confidence: draft.confidence,
      requires_clarification: draft.requiresClarification ?? false,
      expires_at: expiresAt,
    })
    .select("id, status, version, expires_at")
    .single();
  if (error || !data) throw new Error(error?.message ?? "操作草稿保存失败。");
  return data;
}

async function getExecutableProposal(proposalId: string) {
  const user = await requireAuth();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("ai_proposed_actions")
    .select("id, action_name, target, before_versions, status, version, expires_at")
    .eq("id", proposalId)
    .single();
  if (error || !data) throw new Error(error?.message ?? "未找到操作草稿。");
  requireBusinessActionRole(user.role, data.action_name);
  return { supabase, proposal: data };
}

export async function confirmAiProposal(proposalId: string, expectedVersion: number, requestId = randomUUID()) {
  const { supabase, proposal } = await getExecutableProposal(proposalId);
  const currentVersions = await loadBusinessTargetVersions(proposal.target as BusinessTarget);
  assertTargetVersionsUnchanged(proposal.before_versions as TargetVersionMap, currentVersions);
  const { data, error } = await supabase.rpc("confirm_ai_proposed_action", {
    p_proposal_id: proposalId,
    p_expected_version: expectedVersion,
    p_request_id: requestId,
  });
  if (error) throw new Error(error.message);
  const result = data as RpcTransitionResult;
  if (!result.success) throw new Error(result.error ?? "操作草稿确认失败。");
  return { ...result, requestId };
}

export async function reviseAiProposal(proposalId: string, expectedVersion: number, draft: AiProposalDraft) {
  const { supabase, proposal } = await getExecutableProposal(proposalId);
  if (proposal.action_name !== draft.action) throw new Error("草稿动作类型不能在修改时替换。");
  const { expiresAt } = validateAiProposalDraft(draft);
  const currentVersions = await loadBusinessTargetVersions(proposal.target as BusinessTarget);
  const { data, error } = await supabase.rpc("revise_ai_proposed_action", {
    p_proposal_id: proposalId,
    p_expected_version: expectedVersion,
    p_action_input: draft.input,
    p_before_snapshot: draft.beforeSnapshot,
    p_before_versions: currentVersions,
    p_expected_effects: draft.expectedEffects,
    p_warnings: draft.warnings ?? [],
    p_requires_clarification: draft.requiresClarification ?? false,
    p_expires_at: expiresAt,
  });
  if (error) throw new Error(error.message);
  const result = data as RpcTransitionResult;
  if (!result.success) throw new Error(result.error ?? "操作草稿修改失败。");
  return result;
}

export async function rejectAiProposal(proposalId: string, expectedVersion: number, reason: string) {
  const { supabase } = await getExecutableProposal(proposalId);
  const rejectionReason = reason.trim();
  if (!rejectionReason) throw new Error("拒绝草稿时必须填写原因。");
  const { data, error } = await supabase.rpc("reject_ai_proposed_action", {
    p_proposal_id: proposalId,
    p_expected_version: expectedVersion,
    p_reason: rejectionReason,
  });
  if (error) throw new Error(error.message);
  const result = data as RpcTransitionResult;
  if (!result.success) throw new Error(result.error ?? "拒绝操作草稿失败。");
  return result;
}

export async function claimAiProposalExecution(proposalId: string, expectedVersion: number, requestId = randomUUID()) {
  const { supabase, proposal } = await getExecutableProposal(proposalId);
  const currentVersions = await loadBusinessTargetVersions(proposal.target as BusinessTarget);
  assertTargetVersionsUnchanged(proposal.before_versions as TargetVersionMap, currentVersions);
  const { data, error } = await supabase.rpc("claim_ai_action_execution", {
    p_proposal_id: proposalId,
    p_expected_version: expectedVersion,
    p_request_id: requestId,
  });
  if (error) throw new Error(error.message);
  const result = data as RpcTransitionResult;
  if (!result.success) throw new Error(result.error ?? "操作草稿执行占用失败。");
  return { ...result, requestId };
}

export async function completeAiProposalExecution(input: {
  proposalId: string;
  requestId: string;
  success: boolean;
  verified: boolean;
  result?: Record<string, unknown>;
  error?: string;
}) {
  const { supabase } = await getExecutableProposal(input.proposalId);
  const { data, error } = await supabase.rpc("complete_ai_action_execution", {
    p_proposal_id: input.proposalId,
    p_request_id: input.requestId,
    p_success: input.success,
    p_verified: input.verified,
    p_result: input.result ?? {},
    p_error: input.error ?? null,
  });
  if (error) throw new Error(error.message);
  const result = data as RpcTransitionResult;
  if (!result.success) throw new Error(result.error ?? "操作结果保存失败。");
  return result;
}

export async function redactExpiredAiInputs(limit = 50) {
  await requireAuth();
  const safeLimit = Math.max(1, Math.min(100, Math.trunc(limit)));
  const supabase = await createClient();
  const { data: inputs, error } = await supabase
    .from("ai_inputs")
    .select("id, storage_bucket, storage_path")
    .is("redacted_at", null)
    .lte("retention_until", new Date().toISOString())
    .order("retention_until")
    .limit(safeLimit);
  if (error) throw new Error(error.message);

  const results: Array<{ inputId: string; success: boolean; error?: string }> = [];
  for (const input of inputs ?? []) {
    try {
      if (input.storage_bucket && input.storage_path) {
        const { error: storageError } = await supabase.storage
          .from(input.storage_bucket)
          .remove([input.storage_path]);
        if (storageError) throw storageError;
      }
      const { data, error: redactionError } = await supabase.rpc("redact_expired_ai_input", {
        p_input_id: input.id,
        p_expected_storage_path: input.storage_path ?? null,
      });
      if (redactionError) throw redactionError;
      const result = data as RpcTransitionResult;
      if (!result.success) throw new Error(result.error ?? "输入清理失败。");
      results.push({ inputId: input.id, success: true });
    } catch (cleanupError) {
      results.push({
        inputId: input.id,
        success: false,
        error: cleanupError instanceof Error ? cleanupError.message : "输入清理失败。",
      });
    }
  }
  return results;
}
