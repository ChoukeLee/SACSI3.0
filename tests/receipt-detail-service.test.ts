import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CurrentUser } from "@/lib/auth";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("@/features/daily-rentals/receipt-analysis-service", async (original) => ({
  ...(await original<typeof import("@/features/daily-rentals/receipt-analysis-service")>()),
  readReceiptAnalysis: mocks.read,
}));
import { readReceiptDetail } from "@/features/daily-rentals/receipt-detail-service";
const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const bookingId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const actor: CurrentUser = { id: "actor", role: "admin", displayName: "Test" };
afterEach(() => vi.unstubAllEnvs());
function db(overrides: Record<string, unknown> = {}) {
  const values: Record<string, unknown> = {
    payments: { data: { payment_date: "2026-09-02" }, error: null },
    daily_bookings: {
      data: {
        check_in: "2026-09-01",
        check_out: "2026-09-05",
        actual_check_out: null,
        status: "checked_out",
      },
      error: null,
    },
    attachments: {
      data: [
        {
          id: "archive",
          bucket: "receipts",
          storage_path: "proof/a.jpg",
          file_type: "receipt_image",
          paper_archive_status: "pending",
          unit_id: "unit",
        },
      ],
      error: null,
    },
    audit_logs: {
      data: [
        {
          id: "audit",
          created_at: "2026-09-02T00:00Z",
          action: "daily_payment",
          actor_id: null,
          actor_email: "not-verified@example.com",
        },
      ],
      error: null,
    },
    ...overrides,
  };
  const from = vi.fn((table: string) => {
    const chain: Record<string, unknown> = {
      then: (resolve: (value: unknown) => void) => Promise.resolve(values[table]).then(resolve),
    };
    for (const key of ["select", "eq", "in", "order", "limit"]) chain[key] = vi.fn(() => chain);
    chain.maybeSingle = vi.fn(async () => values[table]);
    return chain;
  });
  const sign = vi.fn(async () => ({
    data: {
      signedUrl: "https://test.supabase.co/storage/v1/object/sign/receipts/proof/a.jpg?token=short",
    },
    error: null,
  }));
  return {
    client: {
      from,
      storage: { from: vi.fn(() => ({ createSignedUrl: sign })) },
    } as unknown as SupabaseClient,
    from,
    sign,
  };
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://test.supabase.co");
  mocks.read.mockResolvedValue({ rows: [{ id, bookingId, unitId: "unit" }] });
});
describe("receipt trace scope and evidence", () => {
  it("authorizes exact payment with scoped RPC before reading archives", async () => {
    const client = db();
    const result = await readReceiptDetail(client.client, id, actor);
    expect(mocks.read.mock.calls[0][1].input.paymentId).toBe(id);
    expect(result.booking?.checkIn).toBe("2026-09-01");
    expect(result.attachments[0].url).toContain(
      "https://test.supabase.co/storage/v1/object/sign/receipts/",
    );
    expect(client.sign).toHaveBeenCalledWith("proof/a.jpg", 300);
    expect(result.audit[0]).toMatchObject({ actorId: null, actorName: null });
    expect(result.auditAllowed).toBe(true);
  });
  it("rejects inaccessible/orphan record even if old payments RLS returns it", async () => {
    mocks.read.mockResolvedValue({ rows: [] });
    const client = db();
    await expect(readReceiptDetail(client.client, id, actor)).rejects.toMatchObject({
      status: 404,
    });
    expect(client.from.mock.calls.map(([table]) => table)).toEqual(["payments"]);
    expect(client.sign).not.toHaveBeenCalled();
  });
  it("does not query audit for finance role", async () => {
    const client = db();
    const result = await readReceiptDetail(client.client, id, { ...actor, role: "finance" });
    expect(result.auditAllowed).toBe(false);
    expect(result.audit).toEqual([]);
    expect(client.from.mock.calls.map(([table]) => table)).not.toContain("audit_logs");
  });
  it.each(["front_desk", "rental_sales"] as const)("rejects %s before any lookup", async (role) => {
    const client = db();
    await expect(readReceiptDetail(client.client, id, { ...actor, role })).rejects.toMatchObject({
      status: 403,
    });
    expect(client.from).not.toHaveBeenCalled();
  });
  it("rejects malformed ID and unavailable payment lookup", async () => {
    const client = db({ payments: { data: null, error: { message: "unavailable" } } });
    await expect(readReceiptDetail(client.client, "invalid", actor)).rejects.toMatchObject({
      status: 400,
    });
    await expect(readReceiptDetail(client.client, id, actor)).rejects.toMatchObject({
      status: 503,
    });
  });
  it("preserves archive failure and audit failure as unknown, not empty success", async () => {
    const result = await readReceiptDetail(
      db({ attachments: { data: null, error: {} }, audit_logs: { data: null, error: {} } }).client,
      id,
      actor,
    );
    expect(result.attachmentsUnavailable).toBe(true);
    expect(result.auditUnavailable).toBe(true);
  });
  it.each([
    { bucket: "other", storage_path: "proof/a.jpg", unit_id: "unit" },
    { bucket: "receipts", storage_path: "../a.jpg", unit_id: "unit" },
    { bucket: "receipts", storage_path: "proof/a.jpg", unit_id: "other-unit" },
  ])("never signs wrong-scope attachment %j", async (fields) => {
    const client = db({
      attachments: {
        data: [
          { id: "archive", file_type: "receipt_image", paper_archive_status: "pending", ...fields },
        ],
        error: null,
      },
    });
    const result = await readReceiptDetail(client.client, id, actor);
    expect(result.attachments[0].url).toBeNull();
    expect(result.attachmentsUnavailable).toBe(true);
    expect(client.sign).not.toHaveBeenCalled();
  });
  it("does not return untrusted or non-HTTPS signed destinations", async () => {
    const client = db();
    client.sign.mockResolvedValue({
      data: { signedUrl: "https://other.example/steal" },
      error: null,
    });
    const result = await readReceiptDetail(client.client, id, actor);
    expect(result.attachments[0].url).toBeNull();
    expect(result.attachmentsUnavailable).toBe(true);
  });
});
