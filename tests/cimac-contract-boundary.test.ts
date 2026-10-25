import { beforeEach, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  assertContractWorkspaceBoundary,
  contractBuildingsForWorkArea,
} from "@/features/contracts/workspace-boundary";
import { parseWorkspaceQuery } from "@/features/contracts/workspace-model";
import { leaseScopeCookieName } from "@/features/contracts/lease-scope-preference";
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
const order = vi.fn();
const chain = { select: vi.fn(), eq: vi.fn(), order };
const client = { from: vi.fn(() => chain) } as unknown as Pick<SupabaseClient, "from">;
beforeEach(() => {
  vi.clearAllMocks();
  chain.select.mockReturnValue(chain);
  chain.eq.mockReturnValue(chain);
  order.mockResolvedValue({ data: buildings, error: null });
});

it("keeps park buildings out of the legacy workspace and all legacy buildings out of the park", () => {
  expect(contractBuildingsForWorkArea(buildings, "sacsi").map((b) => b.id)).toEqual([
    workspaceBuilding,
  ]);
  expect(contractBuildingsForWorkArea(buildings, "cimac").map((b) => b.id)).toEqual([parkBuilding]);
});
it.each(["sacsi", "cimac"] as const)(
  "rejects an unscoped %s follow-up read before contacting data",
  async (workArea) => {
    await expect(
      assertContractWorkspaceBoundary(client, parseWorkspaceQuery({}), workArea),
    ).rejects.toMatchObject({ status: 403 });
    expect(client.from).not.toHaveBeenCalled();
  },
);
it.each([
  ["cimac", workspaceProject, ""],
  ["sacsi", parkProject, ""],
  ["cimac", parkProject, workspaceBuilding],
  ["sacsi", "", parkBuilding],
] as const)(
  "rejects forged %s scope project=%s building=%s",
  async (workArea, projectId, buildingId) => {
    await expect(
      assertContractWorkspaceBoundary(
        client,
        parseWorkspaceQuery({ projectId, buildingId }),
        workArea,
      ),
    ).rejects.toMatchObject({ status: 403 });
  },
);
it.each([
  ["cimac", parkProject, parkBuilding],
  ["sacsi", workspaceProject, workspaceBuilding],
  ["sacsi", "", workspaceBuilding],
] as const)("allows only the RLS-visible %s perimeter", async (workArea, projectId, buildingId) => {
  const result = await assertContractWorkspaceBoundary(
    client,
    parseWorkspaceQuery({ projectId, buildingId }),
    workArea,
  );
  expect(result).toHaveLength(1);
  expect(chain.eq).toHaveBeenCalledWith("project.is_active", true);
});
it("fails closed when park is absent, ambiguous, or the authorized metadata read fails", async () => {
  for (const data of [
    [],
    [...buildings, { ...buildings[1], id: workspaceBuilding, project_id: workspaceProject }],
  ]) {
    order.mockResolvedValue({ data, error: null });
    await expect(
      assertContractWorkspaceBoundary(
        client,
        parseWorkspaceQuery({ projectId: parkProject }),
        "cimac",
      ),
    ).rejects.toThrow();
  }
  order.mockResolvedValue({ data: null, error: { message: "offline" } });
  await expect(
    assertContractWorkspaceBoundary(
      client,
      parseWorkspaceQuery({ projectId: parkProject }),
      "cimac",
    ),
  ).rejects.toMatchObject({ status: 503 });
});
it("uses independent per-viewer cookies without adopting another business's preference", () => {
  const viewer = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  expect(leaseScopeCookieName(viewer)).toBe(`sacsi_lease_scope_${viewer}`);
  expect(leaseScopeCookieName(viewer, "cimac")).toBe(`cimac_lease_scope_${viewer}`);
  expect(leaseScopeCookieName("invalid", "cimac")).toBeUndefined();
});
