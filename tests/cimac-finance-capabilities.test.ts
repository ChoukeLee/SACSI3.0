import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ auth: vi.fn(), rpc: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/features/business-actions/operator-request-auth", () => ({
  authenticateOperatorRequest: mock.auth,
}));
import { GET } from "@/app/api/operator/v1/capabilities/route";
import { buildOperatorProtocolManifest } from "@/features/business-actions/operator-protocol";
import { financeActorId } from "./fixtures/cimac-finance";
const user = {
  id: financeActorId,
  email: "synthetic@example.test",
  displayName: "Synthetic admin",
  role: "admin" as const,
};
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("SACSI_OPERATOR_DIRECT_EXECUTION_ENABLED", "true");
  vi.stubEnv("SACSI_OPERATOR_CONFIRMATIONS_ENABLED", "true");
  mock.auth.mockResolvedValue({
    authenticated: true,
    mode: "bearer",
    user,
    supabase: { rpc: mock.rpc },
  });
  mock.rpc.mockImplementation(async (name: string) => ({
    error: null,
    data:
      name === "get_my_operator_capabilities"
        ? []
        : name === "cimac_finance_protocol_version"
          ? 1
          : name === "can_execute_cimac_finance"
            ? true
            : null,
  }));
});
afterEach(() => vi.unstubAllEnvs());
describe("CIMAC finance capability rollout", () => {
  it("advertises only installed, authorized administrator workflow with connector 0.9", async () => {
    const response = await GET(new Request("http://localhost/api/operator/v1/capabilities"));
    const data = await response.json();
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(data.minimumConnectorVersion).toBe("0.9.0");
    expect(data.directExecution.workflows).toEqual(["cimac_finance"]);
    expect(data.cimacFinanceWorkflow).toMatchObject({
      available: true,
      version: 1,
      maximumParts: 100,
      arbitrarySqlAllowed: false,
      adminOnly: true,
    });
    expect(
      data.actions.every((action: { authorized: boolean }) => action.authorized === false),
    ).toBe(true);
  });
  it.each(["kill", "role", "version", "permission", "transport"])(
    "does not advertise on %s failure",
    async (kind) => {
      if (kind === "kill") vi.stubEnv("SACSI_OPERATOR_DIRECT_EXECUTION_ENABLED", "false");
      if (kind === "role")
        mock.auth.mockResolvedValue({
          authenticated: true,
          mode: "bearer",
          user: { ...user, role: "finance" },
          supabase: { rpc: mock.rpc },
        });
      const original = mock.rpc.getMockImplementation()!;
      mock.rpc.mockImplementation((name) =>
        name === "cimac_finance_protocol_version" && kind === "version"
          ? Promise.resolve({ error: null, data: 0 })
          : name === "can_execute_cimac_finance" && kind === "permission"
            ? Promise.resolve({ error: null, data: false })
            : name === "can_execute_cimac_finance" && kind === "transport"
              ? Promise.reject(new Error("secret"))
              : original(name),
      );
      const data = await (await GET(new Request("http://localhost"))).json();
      expect(data.cimacFinanceWorkflow.available).toBe(false);
      expect(data.directExecution.workflows).not.toContain("cimac_finance");
      if (["kill", "role"].includes(kind))
        expect(mock.rpc.mock.calls.some(([name]) => name === "can_execute_cimac_finance")).toBe(
          false,
        );
    },
  );
  it("preserves native and maintenance wire minimums when the new family is absent", () => {
    expect(
      buildOperatorProtocolManifest({ user, directWorkflows: ["native_collection"] })
        .minimumConnectorVersion,
    ).toBe("0.7.0");
    expect(
      buildOperatorProtocolManifest({ user, directWorkflows: ["cimac_maintenance"] })
        .minimumConnectorVersion,
    ).toBe("0.8.0");
    expect(
      buildOperatorProtocolManifest({
        user,
        directWorkflows: ["native_collection", "cimac_maintenance", "cimac_finance"],
      }).minimumConnectorVersion,
    ).toBe("0.9.0");
    expect(
      buildOperatorProtocolManifest({
        user: { ...user, role: "finance" },
        directWorkflows: ["cimac_finance"],
      }).directExecution.workflows,
    ).toEqual([]);
  });
});
