export type WorkbenchComposerRoute = "receipt_attachment" | "receipt_revision" | "workbench_query";

export function resolveWorkbenchComposerRoute(input: {
  hasAttachment: boolean;
  hasEditableReceiptProposal: boolean;
}): WorkbenchComposerRoute {
  if (input.hasAttachment) return "receipt_attachment";
  if (input.hasEditableReceiptProposal) return "receipt_revision";
  return "workbench_query";
}
