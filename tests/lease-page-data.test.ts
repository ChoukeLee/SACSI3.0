import { expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({
  id: "contract",
  unit_id: "unit",
  status: "active",
  updated_at: "2026-09-24T08:00:00.123456+00:00",
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (table: string) => {
      let fields: string[] = [];
      const result = () => ({
        data: table === "lease_contracts"
          ? [Object.fromEntries(Object.entries(fixture).filter(([key]) => fields.includes(key)))]
          : [],
        error: null,
      });
      const query = {
        select: (value: string) => { fields = value.split(","); return query; },
        eq: () => query,
        in: () => query,
        order: () => query,
        range: async () => result(),
        then: (resolve: (value: ReturnType<typeof result>) => unknown) => Promise.resolve(result()).then(resolve),
      };
      return query;
    },
  }),
}));

import { loadLeasePageData } from "@/features/leases/lease-page-data";

it("loads and preserves the exact contract version used by lifecycle confirmations", async () => {
  const page = await loadLeasePageData();
  expect(page.contracts).toHaveLength(1);
  expect(page.contracts[0].updated_at).toBe(fixture.updated_at);
});
