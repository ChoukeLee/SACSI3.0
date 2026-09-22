import { beforeEach, it, expect, vi } from "vitest";
vi.mock("server-only", () => ({}));
const m = vi.hoisted(() => ({ auth: vi.fn(), rpc: vi.fn(), from: vi.fn() }));
vi.mock("@/features/business-actions/operator-request-auth", () => ({ authenticateOperatorRequest: m.auth }));
import { POST as search } from "@/app/api/operator/v1/bookings/search/route";
import { POST as plan } from "@/app/api/operator/v1/bookings/plan/route";
const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const query = { buildingCode: "SACSI11", unitNo: "1006" };
const change = { bookingId: id, operation: "extend_and_collect", originalInstruction: "续住收款" };
const req = (body: unknown) => new Request("http://localhost", { method: "POST", body: JSON.stringify(body) });
function builder(result: unknown) {
  const b: Record<string, unknown> = {};
  for (const key of ["select", "eq", "gte", "lte", "order", "limit", "maybeSingle"]) b[key] = vi.fn(() => b);
  b.then = (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve);
  return b;
}
beforeEach(() => { vi.resetAllMocks(); m.auth.mockResolvedValue({ authenticated: true, mode: "bearer", supabase: { rpc: m.rpc, from: m.from } }); m.rpc.mockResolvedValue({ data: true, error: null }); });
it.each([[search, query], [plan, change]] as const)("denies missing authentication before data reads", async (handler, body) => {
  m.auth.mockResolvedValue({ authenticated: false, reason: "missing_or_invalid_session" });
  expect((await handler(req(body))).status).toBe(401); expect(m.from).not.toHaveBeenCalled(); expect(m.rpc).not.toHaveBeenCalled();
});
it.each([false, null, "true"])("requires explicit live query permission %j", async permission => {
  m.rpc.mockResolvedValue({ data: permission, error: null });
  expect((await search(req(query))).status).toBe(403); expect(m.from).not.toHaveBeenCalled();
});
it("preserves cross-status search and exposes a truncated result", async () => {
  const units = builder({ data: [{ id: "unit" }], error: null });
  const rows = Array.from({ length: 201 }, (_, i) => ({ id: String(i), status: "checked_in", check_in: "2026-09-01", total_amount_xof: 10, prepaid_amount_xof: 0 }));
  const bookings = builder({ data: rows, error: null }); m.from.mockImplementation(table => table === "units" ? units : bookings);
  const response = await search(req(query)); expect(response.status).toBe(200);
  const data = await response.json(); expect(data.status).toBe("refine_search"); expect(data.candidates).toHaveLength(200);
  expect(bookings.eq).toHaveBeenCalledExactlyOnceWith("unit_id", "unit"); expect(bookings.limit).toHaveBeenCalledWith(201);
});
it("rejects malformed inputs and oversized bodies without reading the database", async () => {
  expect((await search(req({ ...query, actorId: id }))).status).toBe(400);
  expect((await plan(req({ ...change, padding: "x".repeat(9000) }))).status).toBe(413); expect(m.rpc).not.toHaveBeenCalled();
});
it("does not invoke a privileged snapshot when RLS hides the booking", async () => {
  m.from.mockReturnValue(builder({ data: null, error: null }));
  expect((await plan(req(change))).status).toBe(404);
  expect(m.rpc.mock.calls.map(c => c[0])).toEqual(["can_execute_operator_action"]);
});
it("rechecks unit access before invoking the legacy snapshot", async () => {
  m.from.mockReturnValue(builder({ data: { id, unit_id: "unit" }, error: null }));
  m.rpc.mockImplementation(name => Promise.resolve({ data: name !== "can_access_unit", error: null }));
  expect((await plan(req(change))).status).toBe(403);
  expect(m.rpc.mock.calls.map(c => c[0])).toEqual(["can_execute_operator_action", "can_access_unit"]);
});
it("returns sanitized service failure, not transport details", async () => {
  m.rpc.mockRejectedValue(new Error("secret diagnostic")); const r = await search(req(query));
  expect(r.status).toBe(503); expect(await r.text()).not.toContain("secret");
});
