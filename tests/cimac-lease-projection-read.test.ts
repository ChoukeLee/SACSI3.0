import { expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: vi.fn() }));
import { readWorkspace } from "@/features/contracts/workspace-service";
import {
  workspaceContract,
  workspaceCustomer,
  workspaceFixture,
} from "./fixtures/contract-workspace";

const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
function attributed() {
  return {
    id: id(1),
    customer_id: workspaceCustomer,
    unit_id: null,
    source_type: "cimac_customer_collection",
    source_id: workspaceCustomer,
    amount: 640000,
    currency: "XOF",
    exchange_rate_to_xof: 1,
    native_settlement: false,
    payment_date: "2026-01-01",
    payment_method: "cash",
    receipt_no: "TEST-SCOPED",
    notes: null,
    request_id: id(2),
    request_kind: "cimac_customer_collection",
    reversal_of_payment_id: null,
    created_at: "2026-01-01T12:00:00Z",
    cimac_contract_allocation: {
      contractId: workspaceContract,
      amount: "600000",
      currency: "XOF",
      receivableIds: ["77777777-7777-4777-8777-777777777777"],
    },
  };
}
it("merges scoped contract cash into the actual lease-detail endpoint without rewriting header facts", async () => {
  const data = workspaceFixture({}, undefined, "detail");
  const rpc = vi
    .fn()
    .mockResolvedValueOnce({ data, error: null })
    .mockResolvedValueOnce({
      data: {
        contractId: workspaceContract,
        paymentCount: 1,
        payments: [attributed()],
      },
      error: null,
    });
  const result = await readWorkspace(
    { rpc } as never,
    "lease",
    data.query,
    "detail",
    workspaceContract,
  );
  expect(result.payments).toEqual([attributed()]);
  expect(result.paymentCount).toBe(1);
  expect(rpc).toHaveBeenNthCalledWith(2, "cimac_lease_collection_projection_rpc", {
    p_contract_id: workspaceContract,
  });
});
it.each(["error", "wrong_customer", "wrong_contract", "wrong_count", "missing_meta"])(
  "fails closed rather than showing a reassuring zero for %s",
  async (kind) => {
    const data = workspaceFixture({}, undefined, "detail");
    const row = attributed();
    if (kind === "wrong_customer") row.customer_id = id(4);
    if (kind === "missing_meta")
      delete (row as unknown as Record<string, unknown>).cimac_contract_allocation;
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({ data, error: null })
      .mockResolvedValueOnce({
        error: kind === "error" ? { message: "unavailable" } : null,
        data: {
          contractId: kind === "wrong_contract" ? id(3) : workspaceContract,
          paymentCount: kind === "wrong_count" ? 2 : 1,
          payments: [row],
        },
      });
    await expect(
      readWorkspace({ rpc } as never, "lease", data.query, "detail", workspaceContract),
    ).rejects.toThrow();
  },
);
it("does not fan out projection reads on list or form-context requests", async () => {
  for (const mode of ["list", "scope", "context"] as const) {
    const data = workspaceFixture({}, undefined, mode);
    const rpc = vi.fn().mockResolvedValue({ data, error: null });
    await readWorkspace({ rpc } as never, "lease", data.query, mode);
    expect(rpc).toHaveBeenCalledTimes(1);
  }
});
