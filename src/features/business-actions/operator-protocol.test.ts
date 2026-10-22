import { describe, expect, it } from "vitest";
import { buildOperatorProtocolManifest } from "./operator-protocol";

const user = {
  id: "00000000-0000-4000-8000-000000000001",
  email: "ying@sacsi.com",
  role: "admin",
  displayName: "Ying",
} as const;

describe("operator protocol manifest", () => {
  it("binds the manifest to the authenticated SACSI identity", () => {
    const manifest = buildOperatorProtocolManifest({
      user,
      serverRelease: "2c9c243",
      now: new Date("2026-09-14T08:00:00.000Z"),
    });

    expect(manifest).toMatchObject({
      protocolVersion: "1.0",
      serverRelease: "2c9c243",
      generatedAt: "2026-09-14T08:00:00.000Z",
      identity: { userId: user.id, displayName: "Ying", role: "admin" },
    });
  });

  it("never advertises privileged database access", () => {
    const manifest = buildOperatorProtocolManifest({ user });
    expect(manifest.safeguards).toEqual({
      serviceRoleAllowed: false,
      arbitrarySqlAllowed: false,
      systemChangesAllowed: false,
      screenshotWritesRequireConfirmation: true,
      batchWritesRequireConfirmation: true,
    });
  });

  it("advertises explicit-instruction execution without granting extra account permissions", () => {
    const manifest = buildOperatorProtocolManifest({
      user,
      directWorkflows: ["booking_operation", "collection", "daily_payment", "collection"],
    });
    expect(manifest.minimumConnectorVersion).toBe("0.6.0");
    expect(manifest.directExecution).toEqual({
      available: true,
      version: 1,
      authorization: "explicit_instruction",
      workflows: ["daily_payment", "collection", "booking_operation"],
    });
    expect(manifest.safeguards).toMatchObject({
      arbitrarySqlAllowed: false,
      serviceRoleAllowed: false,
      systemChangesAllowed: false,
      screenshotWritesRequireConfirmation: false,
      batchWritesRequireConfirmation: false,
    });
    expect(manifest.actions.every((action) => !action.authorized)).toBe(true);
  });

  it("keeps legacy browser confirmation when no direct workflow is enabled", () => {
    expect(buildOperatorProtocolManifest({ user }).directExecution).toEqual({
      available: false,
      version: 1,
      authorization: "explicit_instruction",
      workflows: [],
    });
    expect(buildOperatorProtocolManifest({ user }).minimumConnectorVersion).toBe("0.1.0");
  });

  it("advertises routine and high-risk confirmation behavior", () => {
    const manifest = buildOperatorProtocolManifest({ user });
    const byName = new Map(manifest.actions.map((action) => [action.name, action]));
    expect(byName.get("record_daily_payment")?.naturalLanguageDecision).toBe("execute");
    expect(byName.get("reverse_daily_payment")?.naturalLanguageDecision).toBe("confirm");
    expect(byName.get("query_sale_position")?.naturalLanguageDecision).toBe("execute");
    expect(byName.get("record_daily_payment")?.availability).toBe("implemented");
    expect(byName.get("query_sale_position")?.availability).toBe("planned");
  });

  it("merges an explicit account grant without changing the user's page role", () => {
    const financeUser = { ...user, role: "finance" as const };
    const manifest = buildOperatorProtocolManifest({
      user: financeUser,
      databaseCapabilities: [
        {
          action_name: "create_sale_draft",
          authorized: true,
          authorization_source: "explicit_grant",
        },
      ],
    });
    const action = manifest.actions.find((item) => item.name === "create_sale_draft");
    expect(action).toMatchObject({ authorized: true, authorizationSource: "explicit_grant" });
    expect(manifest.identity.role).toBe("finance");
  });
});
