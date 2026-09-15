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
      databaseCapabilities: [{
        action_name: "create_sale_draft",
        authorized: true,
        authorization_source: "explicit_grant",
      }],
    });
    const action = manifest.actions.find((item) => item.name === "create_sale_draft");
    expect(action).toMatchObject({ authorized: true, authorizationSource: "explicit_grant" });
    expect(manifest.identity.role).toBe("finance");
  });
});
