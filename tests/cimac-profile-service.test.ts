import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CimacWorkspaceScope } from "@/features/cimac/cimac-workspace-types";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ customer: vi.fn() }));
vi.mock("@/features/cimac/cimac-workspace-read", () => ({ readCimacCustomer: mocks.customer }));
import {
  readCimacOperationUnit,
  readCimacProfileRecords,
} from "@/features/cimac/cimac-profile-service";
const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const scope: CimacWorkspaceScope = {
  project: { id: id(1), code: "CIMAC", displayName: "CIMAC" },
  buildings: [{ id: id(2), code: "A", name: "A", constructionStatus: null, isActive: true }],
};
type Row = Record<string, unknown>;
let tables: Record<string, Row[]>, errors: Record<string, { code: string; message: string }>;
const calls: { table: string; filters: [string, unknown][]; columns: string }[] = [];
function from(table: string) {
  const call = { table, filters: [] as [string, unknown][], columns: "" };
  calls.push(call);
  let start = 0,
    end = 999;
  const run = () => {
    const rows = (tables[table] ?? []).filter((row) =>
      call.filters.every(([key, value]) =>
        Array.isArray(value) ? value.includes(row[key]) : row[key] === value,
      ),
    );
    return { data: rows.slice(start, end + 1), count: rows.length, error: errors[table] ?? null };
  };
  const builder = {
    select(columns: string) {
      call.columns = columns;
      return builder;
    },
    eq(key: string, value: unknown) {
      call.filters.push([key, value]);
      return builder;
    },
    in(key: string, value: unknown[]) {
      call.filters.push([key, value]);
      return builder;
    },
    order() {
      return builder;
    },
    range(a: number, b: number) {
      start = a;
      end = b;
      return builder;
    },
    async maybeSingle() {
      const result = run();
      return { ...result, data: result.data[0] ?? null };
    },
    then(resolve: (value: ReturnType<typeof run>) => unknown) {
      return Promise.resolve(run()).then(resolve);
    },
  };
  return builder;
}
const client = { from, rpc: vi.fn() } as unknown as SupabaseClient;
const file = (n: number, unitId: string | null, customerId = id(4)) => ({
  id: id(n),
  unit_id: unitId,
  customer_id: customerId,
  storage_path: `private/${n}`,
  file_type: "image/jpeg",
  paper_archive_status: "pending",
  uploaded_at: "2026-10-25T10:00:00Z",
  metadata: { secret: "SHOULD_NOT_FORWARD" },
});
beforeEach(() => {
  calls.length = 0;
  mocks.customer.mockReset().mockResolvedValue({ profile: { id: id(4) } });
  tables = {
    units: [
      { id: id(3), building_id: id(2), unit_no: "101", updated_at: "2026-10-25T00:00:00Z" },
      { id: id(9), building_id: id(8) },
    ],
    attachments: [file(11, id(3)), file(12, id(9)), file(13, null), file(14, id(3), id(7))],
    audit_logs: [
      {
        id: id(20),
        entity_type: "customer",
        entity_id: id(4),
        created_at: "2026-10-25T00:00:00Z",
        action: "update",
        actor_id: id(99),
        actor_email: "actor@example.com",
        metadata: { secret: "SHOULD_NOT_FORWARD" },
      },
    ],
  };
  errors = {};
});
describe("CIMAC profile sources never fetch the global customer financial profile", () => {
  it("locks an operation asset to the exact RLS park building set", async () => {
    expect((await readCimacOperationUnit(client, scope, id(3))).id).toBe(id(3));
    expect(calls[0].filters).toContainEqual(["building_id", [id(2)]]);
    await expect(readCimacOperationUnit(client, scope, id(9))).rejects.toMatchObject({
      status: 404,
    });
  });
  it("rejects a missing or malformed target without returning a fallback asset", async () => {
    await expect(readCimacOperationUnit(client, scope, "bad")).rejects.toMatchObject({
      status: 400,
    });
    await expect(
      readCimacOperationUnit(client, { ...scope, buildings: [] }, id(3)),
    ).rejects.toMatchObject({ status: 404 });
  });
  it("does not turn an RLS query failure into an available asset", async () => {
    errors.units = { code: "42501", message: "denied" };
    await expect(readCimacOperationUnit(client, scope, id(3))).rejects.toMatchObject({
      status: 403,
    });
  });
  it("includes only documents explicitly linked to this customer and a park unit", async () => {
    const result = await readCimacProfileRecords(client, scope, { type: "customer", id: id(4) });
    expect(result.attachments.map((row) => row.id)).toEqual([id(11)]);
    expect(mocks.customer).toHaveBeenCalledWith(
      client,
      scope,
      id(4),
      expect.objectContaining({ project: "CIMAC" }),
    );
    expect(JSON.stringify(result)).not.toContain("SHOULD_NOT_FORWARD");
    expect(result.auditLogs[0].metadata).toBeNull();
    expect(
      calls.some((call) => ["payments", "receivables", "daily_bookings"].includes(call.table)),
    ).toBe(false);
  });
  it("rechecks a customer membership before querying shared identity events", async () => {
    mocks.customer.mockRejectedValue(new Error("foreign customer"));
    await expect(
      readCimacProfileRecords(client, scope, { type: "customer", id: id(7) }),
    ).rejects.toThrow("foreign customer");
    expect(calls).toHaveLength(0);
  });
  it("rechecks asset membership before querying its audit and attachments", async () => {
    await expect(
      readCimacProfileRecords(client, scope, { type: "unit", id: id(9) }),
    ).rejects.toMatchObject({ status: 404 });
    expect(calls.map((call) => call.table)).toEqual(["units"]);
  });
  it("includes all explicit unit attachments without applying an arbitrary customer", async () => {
    const result = await readCimacProfileRecords(client, scope, { type: "unit", id: id(3) });
    expect(result.attachments.map((row) => row.id)).toEqual([id(11), id(14)]);
    expect(result.auditLogs).toHaveLength(0);
  });
  it("surfaces failed history reads instead of claiming no files or zero activity", async () => {
    errors.attachments = { code: "42501", message: "cannot read" };
    await expect(
      readCimacProfileRecords(client, scope, { type: "unit", id: id(3) }),
    ).rejects.toThrow("Failed to fetch");
  });
});
