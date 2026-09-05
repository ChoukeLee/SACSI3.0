import { getBusinessActionDefinition, type BusinessActionName } from "./registry";
import type { BusinessActionEffect, ProposedBusinessAction } from "./types";

export type AiInputMode = "text" | "image" | "file" | "mixed";
export type AiInputType = "text" | "image" | "pdf" | "spreadsheet" | "csv";
export type AiProposalStatus =
  | "awaiting_clarification"
  | "proposed"
  | "confirmed"
  | "executing"
  | "executed"
  | "rejected"
  | "expired"
  | "failed";

export type BusinessTarget = ProposedBusinessAction["target"];
export type TargetVersionMap = Record<string, string>;

export interface AiProposalDraft {
  action: BusinessActionName;
  target: BusinessTarget;
  input: Record<string, unknown>;
  beforeSnapshot: Record<string, unknown>;
  beforeVersions: TargetVersionMap;
  expectedEffects: BusinessActionEffect[];
  warnings?: string[];
  confidence: number;
  requiresClarification?: boolean;
  expiresAt?: string;
}

export const AI_PROPOSAL_TTL_MINUTES = 15;
export const AI_RAW_INPUT_RETENTION_DAYS = 30;
export const AI_AUDIT_RETENTION_DAYS = 365;
export const AI_INPUT_MAX_BYTES = 20 * 1024 * 1024;

export function defaultProposalExpiry(now = new Date()) {
  return new Date(now.getTime() + AI_PROPOSAL_TTL_MINUTES * 60_000).toISOString();
}

export function validateAiProposalDraft(draft: AiProposalDraft, now = new Date()) {
  const definition = getBusinessActionDefinition(draft.action);
  if (!definition) throw new Error(`未知业务动作：${draft.action}`);
  if (!definition.write || definition.risk === "L0") {
    throw new Error("查询动作不应生成可执行草稿。");
  }
  if (!Number.isFinite(draft.confidence) || draft.confidence < 0 || draft.confidence > 1) {
    throw new Error("草稿置信度必须在 0 到 1 之间。");
  }
  const expiresAt = draft.expiresAt ?? defaultProposalExpiry(now);
  if (!Number.isFinite(Date.parse(expiresAt)) || Date.parse(expiresAt) <= now.getTime()) {
    throw new Error("草稿到期时间必须晚于当前时间。");
  }
  if (Date.parse(expiresAt) > now.getTime() + 60 * 60_000) {
    throw new Error("草稿有效期不能超过 1 小时。");
  }
  return { definition, expiresAt };
}

export function targetVersionKey(entity: string, id: string) {
  return `${entity}:${id}`;
}

export function compareTargetVersions(expected: TargetVersionMap, current: TargetVersionMap) {
  const keys = new Set([...Object.keys(expected), ...Object.keys(current)]);
  return [...keys]
    .filter((key) => expected[key] !== current[key])
    .map((key) => ({ key, expected: expected[key] ?? null, current: current[key] ?? null }));
}

export function assertTargetVersionsUnchanged(expected: TargetVersionMap, current: TargetVersionMap) {
  const changed = compareTargetVersions(expected, current);
  if (changed.length > 0) {
    throw new Error(`业务记录已经变化，请重新生成操作草稿：${changed.map((item) => item.key).join("、")}`);
  }
}

export function sanitizeAiFilename(filename: string) {
  const normalized = filename.normalize("NFKC").replace(/[^a-zA-Z0-9._-]+/g, "-");
  const compact = normalized.replace(/-+/g, "-").replace(/^[-.]+|[-.]+$/g, "");
  return (compact || "upload").slice(0, 120);
}

export function buildAiInputStoragePath(actorId: string, jobId: string, inputId: string, filename: string) {
  return `${actorId}/${jobId}/${inputId}/${sanitizeAiFilename(filename)}`;
}
