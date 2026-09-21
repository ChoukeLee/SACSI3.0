import { describe, expect, it, vi } from "vitest";
import { enrichAuditLogsWithUnitNumbers } from "@/features/settings/audit-log-enrichment";
import { auditFixture } from "./fixtures/audit-display";

describe("supplementary agent names", () => {
  it.each(["success", "error", "throw"])("preserves original evidence when directory lookup is %s", async mode => {
    const log = auditFixture({ actor_id: null, entity_id: null, resolved_booking_agent_name: undefined });
    const original = structuredClone(log);
    const query = vi.fn(async () => {
      if (mode === "throw") throw new Error("offline");
      return { data: [{ id: log.metadata?.booking_agent_id, name: "振咏" }], error: mode === "error" ? {} : null };
    });
    const from = vi.fn(() => ({ select: () => ({ in: query }) }));
    const result = await enrichAuditLogsWithUnitNumbers({ from } as unknown as Parameters<typeof enrichAuditLogsWithUnitNumbers>[0], [log]);
    expect(log).toEqual(original);
    expect(result[0].metadata).toEqual(original.metadata);
    expect(result[0].resolved_booking_agent_name).toBe(mode === "success" ? "振咏" : null);
    expect(from).toHaveBeenCalledWith("customers");
  });

  it("uses the authenticated profile directory as a supplementary actor label", async () => {
    const log = auditFixture({ resolved_actor_display_name: undefined });
    const from = vi.fn((table: string) => ({ select: () => ({ in: async () => ({
      data: table === "user_profiles" ? [{ id: log.actor_id, display_name: "Ying", role: "admin" }] : [], error: null,
    }) }) }));
    const [result] = await enrichAuditLogsWithUnitNumbers({ from } as unknown as Parameters<typeof enrichAuditLogsWithUnitNumbers>[0], [log]);
    expect(result.resolved_actor_display_name).toBe("Ying");
  });
});
