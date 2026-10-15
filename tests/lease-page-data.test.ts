import { expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({
  id: "contract",
  unit_id: "unit",
  status: "active",
  updated_at: "2026-09-24T08:00:00.123456+00:00",
}));
const paymentFixtures = vi.hoisted(() => [
  {
    id: "cash",
    source_type: "lease_rent",
    source_id: "contract",
    payment_date: "2026-10-15",
    amount: 100,
    currency: "XOF",
    exchange_rate_to_xof: 1,
    payment_method: "cash",
    request_kind: null,
    reversal_of_payment_id: null,
  },
  {
    id: "offset",
    source_type: "lease_rent",
    source_id: "contract",
    payment_date: "2026-10-15",
    amount: 200,
    currency: "XOF",
    exchange_rate_to_xof: 1,
    payment_method: "offset",
    request_kind: null,
    reversal_of_payment_id: null,
  },
  {
    id: "reversal",
    source_type: "lease_rent",
    source_id: "contract",
    payment_date: "2026-10-15",
    amount: 300,
    currency: "XOF",
    exchange_rate_to_xof: 1,
    payment_method: "cash",
    request_kind: "payment_reversal",
    reversal_of_payment_id: "original",
  },
]);
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (table: string) => {
      let fields: string[] = [];
      const result = () => ({
        data:
          table === "lease_contracts"
            ? [Object.fromEntries(Object.entries(fixture).filter(([key]) => fields.includes(key)))]
            : table === "payments"
              ? paymentFixtures.map((row) =>
                  Object.fromEntries(Object.entries(row).filter(([key]) => fields.includes(key))),
                )
              : [],
        error: null,
      });
      const query = {
        select: (value: string) => {
          fields = value.split(",");
          return query;
        },
        eq: () => query,
        in: () => query,
        order: () => query,
        range: async () => result(),
        then: (resolve: (value: ReturnType<typeof result>) => unknown) =>
          Promise.resolve(result()).then(resolve),
      };
      return query;
    },
  }),
}));

import { loadLeasePageData } from "@/features/leases/lease-page-data";
import { summarizeContractCash } from "@/features/contracts/contract-cash-model";

it("loads and preserves the exact contract version used by lifecycle confirmations", async () => {
  const page = await loadLeasePageData();
  expect(page.contracts).toHaveLength(1);
  expect(page.contracts[0].updated_at).toBe(fixture.updated_at);
});

it("preserves cash exclusion evidence across the actual loader projection", async () => {
  const page = await loadLeasePageData();
  expect(summarizeContractCash(page.payments)).toMatchObject({
    income: 100,
    net: 100,
    nonCashCount: 1,
    excludedCount: 1,
  });
  expect(page.payments[2].reversal_of_payment_id).toBe("original");
});
