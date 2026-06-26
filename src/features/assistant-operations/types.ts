import type { CurrentUser } from "@/lib/auth";

export type AssistantOperationAction =
  | "complete_cleaning"
  | "daily_check_out"
  | "daily_payment"
  | "lease_number_cleanup"
  | "daily_check_in_backfill"
  | "daily_cancel_booking"
  | "unit_status_update";

export type AssistantOperationRisk = "low" | "medium" | "high" | "blocked";

export type AssistantOperationChangeType = "insert" | "update" | "delete";

export interface AssistantOperationChange {
  table: string;
  type: AssistantOperationChangeType;
  entityId?: string | null;
  label?: string | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
}

export interface AssistantOperationDraft {
  id: string;
  action: AssistantOperationAction;
  summary: string;
  riskLevel: AssistantOperationRisk;
  requiresConfirmation: boolean;
  executable: boolean;
  locale: "zh" | "fr";
  originalMessage: string;
  roomNumbers: string[];
  changes: AssistantOperationChange[];
  missing: string[];
  warnings: string[];
  permissions: string[];
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface AssistantOperationDraftInput {
  message: string;
  locale: "zh" | "fr";
  user: CurrentUser;
  previousDraft?: AssistantOperationDraft | null;
}

export interface AssistantOperationValidation {
  ok: boolean;
  riskLevel: AssistantOperationRisk;
  missing: string[];
  warnings: string[];
  changes: AssistantOperationChange[];
}

export interface AssistantOperationExecutionResult {
  success: boolean;
  action: AssistantOperationAction;
  message: string;
  auditAction?: string;
  affectedRecords: AssistantOperationChange[];
  metadata?: Record<string, unknown>;
}

export interface AssistantOperationHandler {
  action: AssistantOperationAction;
  match(input: AssistantOperationDraftInput): boolean;
  buildDraft(input: AssistantOperationDraftInput): Promise<AssistantOperationDraft>;
  validate(draft: AssistantOperationDraft, user: CurrentUser): Promise<AssistantOperationValidation>;
  execute(draft: AssistantOperationDraft, user: CurrentUser): Promise<AssistantOperationExecutionResult>;
}
