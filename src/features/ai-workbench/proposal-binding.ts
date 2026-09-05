type CleaningProposalContext = {
  action_name: unknown;
  target: unknown;
  action_input: unknown;
  status: unknown;
  version: unknown;
};

type CleaningConfirmationIdentity = {
  action: string;
  taskId: string;
  unitId: string;
  expectedVersion: number;
};

function stringField(value: unknown, key: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const field = (value as Record<string, unknown>)[key];
  return typeof field === "string" ? field : null;
}

/**
 * Prevents client-posted hidden fields from selecting a different business
 * record than the authenticated proposal that the operator reviewed.
 */
export function assertCleaningProposalBinding(
  proposal: CleaningProposalContext,
  confirmation: CleaningConfirmationIdentity,
) {
  if (
    proposal.action_name !== confirmation.action
    || stringField(proposal.target, "unitId") !== confirmation.unitId
    || stringField(proposal.action_input, "taskId") !== confirmation.taskId
    || proposal.status !== "proposed"
    || proposal.version !== confirmation.expectedVersion
  ) {
    throw new Error("proposalTargetMismatch");
  }

  const buildingId = stringField(proposal.target, "buildingId");
  if (!buildingId) throw new Error("proposalTargetMismatch");
  return { buildingId };
}
