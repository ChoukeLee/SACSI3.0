// @vitest-environment jsdom
import { webcrypto } from "node:crypto";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { runFinanceRequest } from "@/features/finance/finance-request";
beforeEach(() => {
  sessionStorage.clear();
  vi.stubGlobal("crypto", webcrypto);
});
afterEach(() => vi.unstubAllGlobals());
it("retains identity on transport loss and blocks edited payload, then clears on resolved success", async () => {
  let original = "";
  await expect(
    runFinanceRequest("manual", "new", { amount: 100 }, async (id) => {
      original = id;
      throw new Error("lost");
    }),
  ).rejects.toThrow("结果未知");
  const submit = vi.fn(async () => ({ success: true }));
  await expect(runFinanceRequest("manual", "new", { amount: 200 }, submit)).rejects.toThrow(
    "上一笔操作",
  );
  expect(submit).not.toHaveBeenCalled();
  await runFinanceRequest("manual", "new", { amount: 100 }, async (id) => {
    expect(id).toBe(original);
    return { success: true };
  });
  expect(sessionStorage.length).toBe(0);
});
it("clears an explicitly rejected transaction but retains unknown database results", async () => {
  await runFinanceRequest("manual", "new", {}, async () => ({ success: false, rejected: true }));
  expect(sessionStorage.length).toBe(0);
  const result = await runFinanceRequest("manual", "new", {}, async () => ({
    success: false,
    rejected: false,
    error: "Unavailable",
  }));
  expect(result.error).toContain("操作号");
  expect(sessionStorage.length).toBe(1);
});
