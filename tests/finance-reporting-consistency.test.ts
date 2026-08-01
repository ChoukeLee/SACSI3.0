import { describe, expect, it, vi } from "vitest";
import { fetchAllPages } from "../src/lib/supabase/fetch-all";

describe("finance reporting consistency", () => {
  it("fetches every page without duplicating boundary rows", async () => {
    const source = Array.from({ length: 2_005 }, (_, index) => index);
    const fetchPage = vi.fn(async (from: number, to: number) => ({
      data: source.slice(from, to + 1),
      error: null,
    }));

    const rows = await fetchAllPages(fetchPage, "test rows", 1_000);

    expect(rows).toEqual(source);
    expect(fetchPage.mock.calls).toEqual([
      [0, 999],
      [1_000, 1_999],
      [2_000, 2_999],
    ]);
  });
});
