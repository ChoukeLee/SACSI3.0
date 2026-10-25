import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const deps = vi.hoisted(() => ({ context: vi.fn(), read: vi.fn() }));
vi.mock("@/features/cimac/cimac-workspace-pages", () => ({
  getCimacWorkspaceContext: deps.context,
}));
vi.mock("@/features/cimac/cimac-historical-sale-read", () => ({
  readCimacHistoricalSale: deps.read,
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("not-found");
  },
}));
import { CimacHistoricalSalePage } from "@/features/cimac/cimac-historical-sale-page";
import { CimacWorkspaceReadError } from "@/features/cimac/cimac-workspace-types";
import {
  workspaceFixture,
  workspaceContract,
  workspaceCustomer,
  workspaceUnit,
} from "./fixtures/contract-workspace";
beforeEach(() => {
  vi.clearAllMocks();
  const base = workspaceFixture();
  deps.context.mockResolvedValue({ client: {}, scope: {} });
  deps.read.mockResolvedValue({
    contract: { ...base.contracts[0], total_amount_xof: 999999, total_amount_confirmed: false },
    unit: base.units[0],
    customer: base.customers[0],
    schedules: [],
    receivables: [],
    payments: [
      {
        id: "receipt",
        source_type: "sale",
        amount: 120.5,
        currency: "USD",
        native_settlement: true,
        payment_date: "2026-01-01",
      },
    ],
  });
});
it.each(["zh", "fr"] as const)(
  "renders %s archives read-only, retaining native money and native park navigation",
  async (locale) => {
    const html = renderToStaticMarkup(
      await CimacHistoricalSalePage({
        locale,
        params: Promise.resolve({ id: workspaceContract }),
        searchParams: Promise.resolve({}),
      }),
    );
    const prefix = locale === "fr" ? "/fr" : "";
    expect(html).toContain(`${prefix}/cimac/customers/${workspaceCustomer}`);
    expect(html).toContain(`${prefix}/cimac/assets/${workspaceUnit}`);
    expect(html).toContain(locale === "fr" ? "120,5" : "120.5");
    expect(html).toContain("USD");
    expect(html).not.toContain("999,999");
    expect(html).not.toContain("<form");
    expect(html).not.toContain("<button");
  },
);
it("refuses an inaccessible historical contract rather than displaying another project's record", async () => {
  deps.read.mockRejectedValue(new CimacWorkspaceReadError(403));
  await expect(
    CimacHistoricalSalePage({
      locale: "zh",
      params: Promise.resolve({ id: workspaceContract }),
      searchParams: Promise.resolve({}),
    }),
  ).rejects.toThrow("not-found");
});
