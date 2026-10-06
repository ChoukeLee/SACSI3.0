import { describe, expect, it, vi } from "vitest";
import { financeCsv, parseFinanceRead } from "../src/features/finance/finance-read";
import { resolveVerifiedSupabaseUser } from "../src/lib/auth";
import { fetchAllPages } from "../src/lib/supabase/fetch-all";
import type { SupabaseClient } from "@supabase/supabase-js";

describe("database authorization source", () => {
  function client(profile: unknown, error: unknown = null) {
    const single = vi.fn().mockResolvedValue({ data: profile, error });
    const eq = vi.fn().mockReturnValue({ single });
    const select = vi.fn().mockReturnValue({ eq });
    return {
      value: { from: vi.fn().mockReturnValue({ select }) } as unknown as SupabaseClient,
      eq,
    };
  }
  it("known privileged emails do not bypass missing profiles", async () => {
    const db = client(null);
    expect(
      await resolveVerifiedSupabaseUser(db.value, { id: "actor", email: "admin@sacsi.com" }),
    ).toBeNull();
    expect(db.eq).toHaveBeenCalledWith("id", "actor");
  });
  it("profile role changes take precedence over seed metadata", async () => {
    const db = client({ role: "front_desk", display_name: "Employee" });
    expect(
      await resolveVerifiedSupabaseUser(db.value, { id: "actor", email: "ying@sacsi.com" }),
    ).toMatchObject({ role: "front_desk", displayName: "Employee" });
  });
  it("does not use data accompanying a database error", async () => {
    expect(
      await resolveVerifiedSupabaseUser(
        client({ role: "admin" }, { message: "unavailable" }).value,
        { id: "actor" },
      ),
    ).toBeNull();
  });
});
describe("complete reads and export filters", () => {
  it("reads beyond the default API cap without losing the final rows", async () => {
    const rows = Array.from({ length: 2550 }, (_, id) => ({ id }));
    expect(
      await fetchAllPages(
        async (from, to) => ({ data: rows.slice(from, to + 1), error: null }),
        "test",
      ),
    ).toEqual(rows);
  });
  it("fails rather than returning a partial successful report", async () => {
    await expect(
      fetchAllPages(
        async (from) =>
          from ? { data: null, error: { message: "offline" } } : { data: [1, 2], error: null },
        "test",
        2,
      ),
    ).rejects.toThrow("offline");
  });
  it("uses actual returned length when the API cap is lower than the requested page", async () => {
    const rows = Array.from({ length: 15 }, (_, id) => id);
    expect(
      await fetchAllPages(
        async (from) => ({ data: rows.slice(from, from + 3), count: 15, error: null }),
        "capped",
        10,
      ),
    ).toEqual(rows);
  });
  it("detects changing counts instead of displaying a mixed report", async () => {
    await expect(
      fetchAllPages(
        async (from) => ({ data: [1, 2], count: from ? 5 : 4, error: null }),
        "changing",
        2,
      ),
    ).rejects.toThrow("Data changed");
  });
  it.each([
    { page: "0" },
    { page: "1.5" },
    { kind: "payments" },
    { dateFrom: "2026-02-30" },
    { dateFrom: "2026-10-07", dateTo: "2026-10-06" },
    { page: ["1", "2"] },
    { direction: "unknown" },
  ])("rejects malformed criteria %o", (params) => {
    expect(() => parseFinanceRead(params)).toThrow();
  });
  it("CSV neutralizes formulas and quotes, while preserving numeric signs", () => {
    const csv = financeCsv({
      kind: "ledger",
      page: 1,
      pageSize: 50,
      total: 1,
      summary: {},
      rows: [{ id: "id", amount_xof: -10, description: '=HYPERLINK("url")' }],
    });
    expect(csv).toContain('"\'=HYPERLINK(""url"")"');
    expect(csv).toContain('"-10"');
  });
});
