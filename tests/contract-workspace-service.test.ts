import { beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({
  client: vi.fn(),
  rpc: vi.fn(),
  eq: vi.fn(),
  order: vi.fn(),
  select: vi.fn(),
  cookies: vi.fn(),
  cookieGet: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.client }));
vi.mock("next/headers", () => ({ cookies: mocks.cookies }));
import { initialWorkspace } from "../src/features/contracts/workspace-service";
import {
  workspaceFixture,
  workspaceBuilding,
  workspaceProject,
} from "./fixtures/contract-workspace";
import type { WorkspaceQuery } from "../src/features/contracts/workspace-model";
import {
  leaseScopeCookieName,
  serializeLeaseScope,
  defaultLeaseScope,
} from "../src/features/contracts/lease-scope-preference";
const viewer = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  otherViewer = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const cimacProject = "88888888-8888-4888-8888-888888888888",
  cimacBuilding = "99999999-9999-4999-8999-999999999999";
const buildings = [
  {
    id: cimacBuilding,
    project_id: cimacProject,
    code: "CIMAC-B01",
    display_name: "CIMAC synthetic",
    project: {
      id: cimacProject,
      code: "CIMAC",
      display_name: "CIMAC",
      allows_sale: true,
      is_active: true,
    },
  },
  {
    ...workspaceFixture().buildings[0],
    code: "SACSI11",
    project: {
      id: workspaceProject,
      code: "SACSI",
      display_name: "SACSI",
      allows_sale: true,
      is_active: true,
    },
  },
];
beforeEach(() => {
  vi.resetAllMocks();
  mocks.cookies.mockResolvedValue({ get: mocks.cookieGet });
  const chain = { select: mocks.select, eq: mocks.eq, order: mocks.order };
  mocks.select.mockReturnValue(chain);
  mocks.eq.mockReturnValue(chain);
  mocks.order.mockResolvedValue({ data: buildings, error: null });
  mocks.client.mockResolvedValue({ from: vi.fn(() => chain), rpc: mocks.rpc });
  mocks.rpc.mockImplementation(
    async (_name: string, args: { p_kind: "lease" | "sale"; p_input: WorkspaceQuery }) => {
      const data = workspaceFixture({ kind: args.p_kind }, args.p_input);
      data.buildings = buildings;
      data.units[0].building_id =
        args.p_input.projectId === cimacProject ? cimacBuilding : workspaceBuilding;
      if (args.p_kind === "sale")
        Object.assign(data.contracts[0], {
          signed_date: "2026-01-01",
          total_amount_xof: 100,
          total_amount_confirmed: true,
          payment_plan_type: "lump_sum",
          transfer_status: "not_started",
          transfer_date: null,
        });
      return { data, error: null };
    },
  );
});
it.each(["zh", "fr"] as const)(
  "keeps the original no-preference lease default building (%s)",
  async (locale) => {
    const data = await initialWorkspace("lease", locale);
    expect(data.query).toMatchObject({
      projectId: workspaceProject,
      buildingId: workspaceBuilding,
      locale,
    });
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.eq).toHaveBeenCalledWith("is_active", true);
    expect(mocks.eq).toHaveBeenCalledWith("project.is_active", true);
  },
);
it("uses the same SACSI project fallback as the UI when the preferred building is absent", async () => {
  mocks.order.mockResolvedValue({
    data: buildings.map((b) => ({ ...b, code: b.code === "SACSI11" ? "SACSI7" : b.code })),
    error: null,
  });
  expect((await initialWorkspace("lease", "zh")).query).toMatchObject({
    projectId: workspaceProject,
    buildingId: "",
  });
});
it("normalizes an empty/unassigned visible perimeter without manufacturing a project UUID", () => {
  expect(defaultLeaseScope([])).toEqual({ projectId: "", buildingId: "" });
  expect(
    defaultLeaseScope([
      {
        id: workspaceBuilding,
        project_id: null,
        code: "UNASSIGNED",
        display_name: "Unknown",
        project: null,
      },
    ]),
  ).toEqual({ projectId: "", buildingId: "" });
});
it.each(["", workspaceBuilding])(
  "reads a current-viewer validated all/custom cookie directly on SSR (%s)",
  async (buildingId) => {
    mocks.cookieGet.mockReturnValue({ value: serializeLeaseScope(workspaceProject, buildingId) });
    const data = await initialWorkspace("lease", "zh", undefined, viewer);
    expect(data.query).toMatchObject({ projectId: workspaceProject, buildingId });
    expect(data.scopePreference).toEqual({
      cookieName: leaseScopeCookieName(viewer),
      serverResolved: true,
    });
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  },
);
it.each([
  "%",
  "{}",
  "x".repeat(2048),
  serializeLeaseScope(cimacProject, workspaceBuilding),
  serializeLeaseScope(otherViewer, ""),
  encodeURIComponent(
    JSON.stringify({ projectId: workspaceProject, buildingId: "", role: "admin" }),
  ),
])("ignores malformed/unavailable/cross-project preference %s", async (raw) => {
  mocks.cookieGet.mockReturnValue({ value: raw });
  const data = await initialWorkspace("lease", "zh", undefined, viewer);
  expect(data.query).toMatchObject({ projectId: workspaceProject, buildingId: workspaceBuilding });
  expect(data.scopePreference?.serverResolved).toBe(true);
});
it("does not consume another viewer's cookie or any anonymous preference; explicit URL wins", async () => {
  mocks.cookieGet.mockImplementation((name) =>
    name === leaseScopeCookieName(viewer)
      ? { value: serializeLeaseScope(cimacProject, "") }
      : undefined,
  );
  expect((await initialWorkspace("lease", "zh", undefined, viewer)).query.projectId).toBe(
    workspaceProject,
  );
  expect((await initialWorkspace("lease", "zh", undefined, otherViewer)).query).toMatchObject({
    projectId: workspaceProject,
    buildingId: workspaceBuilding,
  });
  expect(mocks.cookieGet).toHaveBeenLastCalledWith(leaseScopeCookieName(otherViewer));
  mocks.cookies.mockClear();
  expect((await initialWorkspace("lease", "zh")).query.projectId).toBe(workspaceProject);
  expect(mocks.cookies).not.toHaveBeenCalled();
  expect((await initialWorkspace("lease", "zh", "SACSI", viewer)).query).toMatchObject({
    projectId: workspaceProject,
    buildingId: "",
  });
});
it.each(["lease", "sale"] as const)(
  "rejects CIMAC in the legacy %s workspace and keeps it in its explicit work area",
  async (kind) => {
    await expect(initialWorkspace(kind, "zh", "CIMAC")).rejects.toMatchObject({ status: 403 });
    expect(
      (await initialWorkspace(kind, "zh", "CIMAC", undefined, undefined, "cimac")).query,
    ).toMatchObject({
      projectId: cimacProject,
      buildingId: "",
    });
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  },
);
it("keeps the sale no-preference default on its actual initial building", async () => {
  expect((await initialWorkspace("sale", "zh")).query).toMatchObject({
    projectId: "",
    buildingId: workspaceBuilding,
  });
  expect(mocks.rpc).toHaveBeenCalledTimes(1);
});

it("honors an exact linked lease building and refuses a building outside the linked project", async () => {
  expect(
    (await initialWorkspace("lease", "zh", workspaceProject, viewer, workspaceBuilding)).query,
  ).toMatchObject({ projectId: workspaceProject, buildingId: workspaceBuilding });
  mocks.rpc.mockClear();
  await expect(
    initialWorkspace("lease", "zh", cimacProject, viewer, workspaceBuilding),
  ).rejects.toMatchObject({ status: 403 });
  expect(mocks.rpc).not.toHaveBeenCalled();
});
it("never treats an unavailable project or failed authorized building read as a successful default scope", async () => {
  await expect(initialWorkspace("lease", "zh", "NO-ACCESS")).rejects.toThrow();
  expect(mocks.rpc).not.toHaveBeenCalled();
  mocks.order.mockResolvedValue({ data: null, error: { message: "synthetic denied" } });
  await expect(initialWorkspace("lease", "zh")).rejects.toThrow();
  expect(mocks.rpc).not.toHaveBeenCalled();
});
it("never broadens an empty legacy perimeter to all projects for a CIMAC-only account", async () => {
  mocks.order.mockResolvedValue({
    data: buildings.filter((building) => building.project.code === "CIMAC"),
    error: null,
  });
  await expect(initialWorkspace("lease", "zh")).rejects.toMatchObject({ status: 403 });
  expect(mocks.rpc).not.toHaveBeenCalled();
});
