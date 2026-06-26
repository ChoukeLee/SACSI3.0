import type {
  AssistantOperationDraft,
  AssistantOperationDraftInput,
  AssistantOperationExecutionResult,
  AssistantOperationValidation,
} from "./types";
import { completeCleaningOperation } from "./operations/complete-cleaning";
import { dailyCheckOutOperation } from "./operations/daily-check-out";
import { dailyPaymentOperation } from "./operations/daily-payment";
import { leaseNumberCleanupOperation } from "./operations/lease-number-cleanup";
import { dailyCheckInBackfillOperation } from "./operations/daily-check-in-backfill";
import { dailyCancelBookingOperation } from "./operations/daily-cancel-booking";
import { unitStatusUpdateOperation } from "./operations/unit-status-update";
import { mergeDraftMessage } from "./utils";

const handlers = [
  completeCleaningOperation,
  dailyCheckOutOperation,
  dailyCancelBookingOperation,
  unitStatusUpdateOperation,
  leaseNumberCleanupOperation,
  dailyCheckInBackfillOperation,
  dailyPaymentOperation,
];

export async function buildOperationDraft(input: AssistantOperationDraftInput): Promise<AssistantOperationDraft | null> {
  const handler = handlers.find((candidate) => candidate.match(input));
  if (!handler) return null;
  return handler.buildDraft(input);
}

export async function buildOrContinueOperationDraft(input: AssistantOperationDraftInput): Promise<AssistantOperationDraft | null> {
  const direct = await buildOperationDraft(input);
  if (direct || !input.previousDraft) return direct;

  const previousHandler = handlers.find((candidate) => candidate.action === input.previousDraft?.action);
  if (!previousHandler) return null;
  return previousHandler.buildDraft({
    ...input,
    message: mergeDraftMessage(input.previousDraft.originalMessage, input.message),
    previousDraft: input.previousDraft,
  });
}

export async function validateOperationDraft(
  draft: AssistantOperationDraft,
  user: AssistantOperationDraftInput["user"],
): Promise<AssistantOperationValidation> {
  const handler = handlers.find((candidate) => candidate.action === draft.action);
  if (!handler) {
    return {
      ok: false,
      riskLevel: "blocked",
      missing: ["operation_handler"],
      warnings: [`Unsupported operation: ${draft.action}`],
      changes: draft.changes,
    };
  }
  return handler.validate(draft, user);
}

export async function executeOperationDraft(
  draft: AssistantOperationDraft,
  user: AssistantOperationDraftInput["user"],
): Promise<AssistantOperationExecutionResult> {
  const handler = handlers.find((candidate) => candidate.action === draft.action);
  if (!handler) {
    return {
      success: false,
      action: draft.action,
      message: `Unsupported operation: ${draft.action}`,
      affectedRecords: [],
    };
  }
  return handler.execute(draft, user);
}

export type { AssistantOperationDraft } from "./types";
