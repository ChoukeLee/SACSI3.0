import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  CustomerDirectoryError,
  parseCustomerDirectoryQuery,
  type CustomerDirectoryData,
} from "@/features/customers/customer-directory-model";
import { customerDirectoryFixture, directoryIds } from "./fixtures/customer-directory";

vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ directory: vi.fn() }));
vi.mock("@/features/customers/customer-directory-service", () => ({
  readCustomerDirectory: mocks.directory,
}));
import { readSacsiCustomerDirectory } from "@/features/customers/sacsi-directory-service";

const foreignProject = "90000000-0000-4000-8000-000000000001";
const foreignBuilding = "90000000-0000-4000-8000-000000000002";
let project: { id: string; code: string } | null;
let projectError: { code: string } | null;
let reply: CustomerDirectoryData;
const filters: [string, unknown][] = [];
const from = vi.fn(() => {
  const builder = {
    select: vi.fn(() => builder),
    eq(key: string, value: unknown) {
      filters.push([key, value]);
      return builder;
    },
    maybeSingle: async () => ({ data: project, error: projectError }),
  };
  return builder;
});
const client = { from } as unknown as SupabaseClient;

beforeEach(() => {
  vi.clearAllMocks();
  filters.length = 0;
  project = { id: directoryIds.project, code: "SACSI" };
  projectError = null;
  reply = customerDirectoryFixture();
  reply.buildings.push({
    id: foreignBuilding,
    code: "CIMAC-A",
    label: "CIMAC building",
    project: { id: foreignProject, code: "CIMAC", label: "CIMAC" },
  });
  mocks.directory.mockImplementation(async (_client, query, mode) => ({ ...reply, query, mode }));
});

describe("SACSI customer directory fixes the UI project independently of user RLS breadth", () => {
  it("uses the supplied user-session client and defaults the generic reader to active SACSI", async () => {
    const query = parseCustomerDirectoryQuery({
      search: "Customer",
      filter: "contract",
      page: "2",
    });
    const result = await readSacsiCustomerDirectory(client, query);
    expect(from).toHaveBeenCalledExactlyOnceWith("projects");
    expect(filters).toEqual([
      ["code", "SACSI"],
      ["is_active", true],
    ]);
    expect(mocks.directory).toHaveBeenCalledExactlyOnceWith(
      client,
      { ...query, projectId: directoryIds.project },
      "list",
      undefined,
      1,
    );
    expect(result.query.projectId).toBe(directoryIds.project);
    expect(query.projectId).toBe("");
  });
  it("retains the explicit unassigned identity view rather than guessing a project relationship", async () => {
    const query = parseCustomerDirectoryQuery({ projectId: "__unassigned__" });
    const result = await readSacsiCustomerDirectory(client, query);
    expect(mocks.directory.mock.calls[0][1].projectId).toBe("__unassigned__");
    expect(result.query.projectId).toBe("__unassigned__");
    expect(result.relationships).toEqual([]);
  });
  it("allows an explicitly matching SACSI project and preserves detail and relation pagination", async () => {
    reply = customerDirectoryFixture("detail");
    const query = parseCustomerDirectoryQuery({
      projectId: directoryIds.project,
      buildingId: directoryIds.building,
    });
    const result = await readSacsiCustomerDirectory(
      client,
      query,
      "detail",
      directoryIds.customer,
      3,
    );
    expect(mocks.directory).toHaveBeenCalledExactlyOnceWith(
      client,
      query,
      "detail",
      directoryIds.customer,
      3,
    );
    expect(result.profile?.id).toBe(directoryIds.customer);
  });
  it("rejects an explicitly foreign project even when the user can read that project", async () => {
    await expect(
      readSacsiCustomerDirectory(
        client,
        parseCustomerDirectoryQuery({ projectId: foreignProject }),
      ),
    ).rejects.toMatchObject({ status: 403 });
    expect(mocks.directory).not.toHaveBeenCalled();
  });
  it("removes CIMAC and unassigned building metadata from the SACSI response", async () => {
    reply.buildings.push({
      id: "90000000-0000-4000-8000-000000000003",
      code: "NONE",
      label: "No project",
      project: null,
    });
    const result = await readSacsiCustomerDirectory(client, parseCustomerDirectoryQuery({}));
    expect(result.buildings.map((building) => building.id)).toEqual([directoryIds.building]);
    expect(reply.buildings).toHaveLength(3);
    expect(JSON.stringify(result.buildings)).not.toContain("CIMAC");
  });
  it.each([foreignProject, null])(
    "fails closed if the generic detail reader returns a relationship from %s",
    async (projectId) => {
      reply = customerDirectoryFixture("detail");
      reply.relationships[0] = { ...reply.relationships[0], projectId };
      await expect(
        readSacsiCustomerDirectory(
          client,
          parseCustomerDirectoryQuery({}),
          "detail",
          directoryIds.customer,
        ),
      ).rejects.toMatchObject({ status: 503 });
    },
  );
  it("does not fall back to another visible project when active SACSI is absent", async () => {
    project = null;
    await expect(
      readSacsiCustomerDirectory(client, parseCustomerDirectoryQuery({})),
    ).rejects.toMatchObject({ status: 403 });
    expect(mocks.directory).not.toHaveBeenCalled();
  });
  it("rejects malformed project metadata returned for the code lookup", async () => {
    project = { id: foreignProject, code: "CIMAC" };
    await expect(
      readSacsiCustomerDirectory(client, parseCustomerDirectoryQuery({})),
    ).rejects.toMatchObject({ status: 403 });
    expect(mocks.directory).not.toHaveBeenCalled();
  });
  it("distinguishes a project-query outage from an empty directory", async () => {
    projectError = { code: "08006" };
    await expect(
      readSacsiCustomerDirectory(client, parseCustomerDirectoryQuery({})),
    ).rejects.toMatchObject({ status: 503 });
    expect(mocks.directory).not.toHaveBeenCalled();
  });
  it("preserves an authoritative generic-reader scope error instead of returning zero customers", async () => {
    mocks.directory.mockRejectedValue(new CustomerDirectoryError(403));
    await expect(
      readSacsiCustomerDirectory(client, parseCustomerDirectoryQuery({})),
    ).rejects.toMatchObject({ status: 403 });
  });
});
