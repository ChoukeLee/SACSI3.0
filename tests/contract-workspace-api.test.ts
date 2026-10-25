import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  user: vi.fn(),
  permission: vi.fn(),
  client: vi.fn(),
  read: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ getCurrentUser: mocks.user, hasPermission: mocks.permission }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.client }));
vi.mock("@/features/contracts/workspace-service", () => ({ readWorkspace: mocks.read }));
import { GET } from "../src/app/api/contracts/[kind]/route";
import { workspaceFixture } from "./fixtures/contract-workspace";
import { WorkspaceReadError } from "../src/features/contracts/workspace-model";
const call = (search = "", kind = "lease") =>
  GET(new Request(`http://local.invalid/api/contracts/${kind}${search}`), {
    params: Promise.resolve({ kind }),
  });
beforeEach(() => {
  vi.resetAllMocks();
  mocks.user.mockResolvedValue({ id: "synthetic", role: "admin" });
  mocks.permission.mockReturnValue(true);
  mocks.client.mockResolvedValue({});
  mocks.read.mockResolvedValue(workspaceFixture());
});
it("returns current-scope reads with private no-store and fixed technical timing only", async () => {
  const r = await call();
  expect(r.status).toBe(200);
  expect(r.headers.get("cache-control")).toBe("private, no-store");
  expect(r.headers.get("server-timing")).toContain("authorization;dur=");
  expect(r.headers.get("server-timing")).toContain("database;dur=");
  expect(r.headers.get("server-timing")).toContain("total;dur=");
});
it("rejects anonymous and unauthorized users before reading the database", async () => {
  mocks.user.mockResolvedValue(null);
  expect((await call()).status).toBe(401);
  mocks.user.mockResolvedValue({ role: "front_desk" });
  mocks.permission.mockReturnValue(false);
  expect((await call("", "sale")).status).toBe(403);
  expect(mocks.read).not.toHaveBeenCalled();
});
it.each([
  "?page=0",
  "?page=1&page=2",
  "?unknown=yes",
  "?mode=detail",
  "?mode=list&contractId=33333333-3333-4333-8333-333333333333",
  "?status=deleted",
  "?buildingId=bad",
])("rejects strict invalid query %s", async (search) => {
  const r = await call(search);
  expect(r.status).toBe(400);
  expect(r.headers.get("cache-control")).toBe("private, no-store");
  expect(mocks.read).not.toHaveBeenCalled();
});
it("fails closed with safe no-store errors when verification/client/database throws", async () => {
  for (const target of [mocks.user, mocks.client, mocks.read]) {
    target.mockRejectedValueOnce(new Error("secret SQL financial context"));
    const r = await call();
    expect(r.status).toBe(503);
    expect(r.headers.get("cache-control")).toBe("private, no-store");
    expect(r.headers.get("server-timing")).toContain("total;dur=");
    expect(await r.text()).not.toContain("secret");
  }
});
it("preserves denied database scope instead of returning an empty successful ledger", async () => {
  mocks.read.mockRejectedValue(new WorkspaceReadError(403));
  expect((await call()).status).toBe(403);
});
it("keeps default follow-up reads in SACSI and explicitly tags park reads for boundary verification", async () => {
  await call("?projectId=11111111-1111-4111-8111-111111111111");
  expect(mocks.read).toHaveBeenLastCalledWith(
    {},
    "lease",
    expect.anything(),
    "list",
    undefined,
    "sacsi",
  );
  await call("?workspace=cimac&projectId=11111111-1111-4111-8111-111111111111");
  expect(mocks.read).toHaveBeenLastCalledWith(
    {},
    "lease",
    expect.anything(),
    "list",
    undefined,
    "cimac",
  );
});
it("does not treat an unknown workspace or a front-desk legacy lease permission as park access", async () => {
  expect((await call("?workspace=unknown")).status).toBe(400);
  expect((await call("?workspace=cimac", "sale")).status).toBe(400);
  mocks.user.mockResolvedValue({ id: "actor", role: "front_desk" });
  expect((await call("?workspace=cimac")).status).toBe(403);
  expect(mocks.read).not.toHaveBeenCalled();
});
