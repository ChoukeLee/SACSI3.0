// @vitest-environment jsdom
import { webcrypto } from "node:crypto";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import {
  leaseRequestIdentity,
  clearLeaseRequestIdentity,
} from "@/features/leases/lease-request-identity";
beforeEach(() => {
  sessionStorage.clear();
  vi.stubGlobal("crypto", webcrypto);
});
afterEach(() => vi.unstubAllGlobals());
it("retains the same request across retries without storing the form or customer data", async () => {
  const payload = { customerId: "sensitive-customer", amount: 5000 };
  const first = await leaseRequestIdentity("create", "room", payload);
  expect(await leaseRequestIdentity("create", "room", payload)).toBe(first);
  expect(sessionStorage.getItem("sacsi:lease-request:v1:create:room")).not.toContain(
    "sensitive-customer",
  );
  expect(
    Object.keys(JSON.parse(sessionStorage.getItem("sacsi:lease-request:v1:create:room")!)).sort(),
  ).toEqual(["fingerprint", "requestId"]);
});
it("blocks changed input while the original outcome is unknown", async () => {
  await leaseRequestIdentity("move_out", "contract", { refund: 5000 });
  await expect(leaseRequestIdentity("move_out", "contract", { refund: 6000 })).rejects.toThrow(
    "上一笔操作结果尚未核实",
  );
});
it("allows a fresh request only after explicit resolved-result cleanup", async () => {
  const id = await leaseRequestIdentity("activate", "contract", { version: "one" });
  clearLeaseRequestIdentity("activate", "contract");
  expect(await leaseRequestIdentity("activate", "contract", { version: "two" })).not.toBe(id);
});
