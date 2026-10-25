import { beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: vi.fn() }));
import type { SupabaseClient } from "@supabase/supabase-js";
import { readWorkspace } from "@/features/contracts/workspace-service";
import { parseWorkspaceQuery } from "@/features/contracts/workspace-model";
import {
  workspaceFixture,
  workspaceProject,
  workspaceBuilding,
} from "./fixtures/contract-workspace";

const parkProject = "88888888-8888-4888-8888-888888888888";
const parkBuilding = "99999999-9999-4999-8999-999999999999";
const buildings = [
  workspaceFixture().buildings[0],
  {
    id: parkBuilding,
    code: "CIMAC-B01",
    display_name: "Park",
    project_id: parkProject,
    project: { id: parkProject, code: "CIMAC", display_name: "Park" },
  },
];
const rpc = vi.fn(),
  order = vi.fn();
const chain = { select: vi.fn(), eq: vi.fn(), order };
const client = { from: vi.fn(() => chain), rpc } as unknown as Pick<SupabaseClient, "from" | "rpc">;
beforeEach(() => {
  vi.clearAllMocks();
  chain.select.mockReturnValue(chain);
  chain.eq.mockReturnValue(chain);
  order.mockResolvedValue({ data: buildings, error: null });
  rpc.mockImplementation(async (_name, args) => {
    const data = workspaceFixture({}, args.p_input);
    data.buildings = buildings;
    data.units[0].building_id =
      args.p_input.projectId === parkProject ? parkBuilding : workspaceBuilding;
    return { data, error: null };
  });
});
it.each(["list", "scope", "context"] as const)(
  "refuses a forged park %s request before the financial workspace RPC",
  async (mode) => {
    await expect(
      readWorkspace(
        client,
        "lease",
        parseWorkspaceQuery({ projectId: workspaceProject }),
        mode,
        undefined,
        "cimac",
      ),
    ).rejects.toMatchObject({ status: 403 });
    expect(rpc).not.toHaveBeenCalled();
  },
);
it.each(["sacsi", "cimac"] as const)(
  "returns only the %s navigation perimeter without changing the exact RPC query",
  async (workArea) => {
    const projectId = workArea === "cimac" ? parkProject : workspaceProject;
    const query = parseWorkspaceQuery({ projectId });
    const result = await readWorkspace(client, "lease", query, "list", undefined, workArea);
    expect(rpc).toHaveBeenCalledWith("contract_workspace_read_rpc", {
      p_kind: "lease",
      p_input: query,
      p_mode: "list",
      p_contract_id: null,
    });
    expect(result.buildings.map((building) => building.project_id)).toEqual([projectId]);
    expect(result.query).toEqual(query);
  },
);
