import { describe, expect, it } from "vitest";
import { resolveWorkbenchComposerRoute } from "./composer-routing";

describe("AI Workbench composer routing", () => {
  it("prioritizes a newly attached receipt", () => {
    expect(resolveWorkbenchComposerRoute({ hasAttachment: true, hasEditableReceiptProposal: true })).toBe("receipt_attachment");
  });

  it("routes text to the editable receipt proposal when one is active", () => {
    expect(resolveWorkbenchComposerRoute({ hasAttachment: false, hasEditableReceiptProposal: true })).toBe("receipt_revision");
  });

  it("keeps ordinary questions on the workbench action", () => {
    expect(resolveWorkbenchComposerRoute({ hasAttachment: false, hasEditableReceiptProposal: false })).toBe("workbench_query");
  });
});
