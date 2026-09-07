import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

describe("AI proposal revision v2", () => {
  const migration = read("supabase/migrations/20260907155658_add_ai_proposal_revision_v2.sql");
  const service = read("src/features/business-actions/ai-draft-service.ts");
  const route = read("src/app/api/receipt/revise/route.ts");

  it("locks the owned proposal and enforces optimistic versioning", () => {
    expect(migration).toMatch(/job\.actor_id = v_actor_id[\s\S]+for update of proposal/i);
    expect(migration).toMatch(/v_proposal\.version <> p_expected_version[\s\S]+proposalVersionChanged/i);
    expect(migration).toMatch(/status not in \('awaiting_clarification', 'proposed'\)/i);
  });

  it("re-authorizes changed action and risk without exposing the definer body", () => {
    expect(migration).toContain("private.is_ai_action_authorized(p_action_name, p_risk_level)");
    expect(migration).toMatch(/public\.revise_ai_proposed_action_v2[\s\S]+security invoker/i);
    expect(migration).toMatch(/revoke all on function public\.revise_ai_proposed_action_v2[\s\S]+from public, anon/i);
  });

  it("records a bounded audit summary rather than the raw instruction", () => {
    expect(migration).toContain("'changed_fields'");
    expect(migration).toContain("'previous_version'");
    expect(migration).toContain("'target_changed'");
    expect(migration).not.toContain("instruction");
  });

  it("rebuilds the proposal from live records before atomic revision", () => {
    expect(route).toContain("buildLeaseReceiptProposal");
    expect(route).toContain("parseReceiptRevisionInstruction");
    expect(route).toContain("proposal.version !== expectedVersion");
    expect(service).toContain('supabase.rpc("revise_ai_proposed_action_v2"');
    expect(service).toContain("loadBusinessTargetVersions(draft.target)");
  });
});
