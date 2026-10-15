// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
import { PaymentContextPanel } from "@/features/finance/payment-context-panel";

const paymentId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const base = {
  paymentId,
  paymentDate: "2026-10-01",
  amount: 100,
  currency: "CNY",
  recordedBy: paymentId,
  recordedByName: "Synthetic recorder",
  actualCollector: null,
  collectorBasis: null,
  version: 0,
  token: "a".repeat(32),
  confirmedBy: null,
  confirmedAt: null,
  allocatedXof: 0,
  allocations: [],
};
let root: Root, host: HTMLDivElement;
const fetchMock = vi.fn();
const response = (data: unknown, ok = true) => ({ ok, json: async () => data });
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  mocks.refresh.mockReset();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
async function open(canWrite = true) {
  await act(async () =>
    root.render(<PaymentContextPanel paymentId={paymentId} locale="zh" canWrite={canWrite} />),
  );
  expect(fetchMock).not.toHaveBeenCalled();
  await act(async () => (host.querySelector("button") as HTMLButtonElement).click());
}
function inputFor(label: string) {
  return [...document.querySelectorAll("label")]
    .find((item) => item.textContent?.includes(label))!
    .querySelector("input")!;
}
async function input(label: string, value: string) {
  const element = inputFor(label);
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function submit() {
  await act(async () =>
    document
      .querySelector("[role=dialog] form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
}
it("never assumes the recording account is the collector and retains original currency", async () => {
  fetchMock.mockResolvedValue(response(base));
  await open(false);
  expect(document.querySelector("[role=dialog]")?.textContent).toContain("100 CNY");
  expect(inputFor("明确姓名").value).toBe("");
  expect(inputFor("明确姓名").disabled).toBe(true);
  expect(document.querySelector('button[type="submit"]')).toBeNull();
});
it("sends only explicit facts, not amount, actor, currency or date; a failed retry retains request ID", async () => {
  fetchMock
    .mockResolvedValueOnce(response(base))
    .mockResolvedValueOnce(response({ error: "paymentContextUnavailable" }, false))
    .mockResolvedValueOnce(
      response({
        ...base,
        actualCollector: "振咏",
        collectorBasis: "Synthetic receipt",
        version: 1,
        token: "b".repeat(32),
      }),
    );
  await open();
  await input("明确姓名", "振咏");
  await input("确认依据", "Synthetic receipt");
  await submit();
  await submit();
  const first = JSON.parse(fetchMock.mock.calls[1][1].body),
    second = JSON.parse(fetchMock.mock.calls[2][1].body);
  expect(first.requestId).toBe(second.requestId);
  expect(first.input).toEqual({
    expectedToken: "a".repeat(32),
    collectorName: "振咏",
    collectorBasis: "Synthetic receipt",
    periods: [],
  });
  expect(mocks.refresh).toHaveBeenCalledOnce();
  expect(document.querySelector("[role=dialog]")?.textContent).toContain("金额与余额未修改");
});
it("never fills a service period from a due date", async () => {
  const receivableId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  fetchMock.mockResolvedValue(
    response({
      ...base,
      allocatedXof: 100,
      allocations: [
        {
          receivableId,
          title: "Synthetic rent",
          dueDate: "2026-10-01",
          allocatedXof: 100,
          periodStart: null,
          periodEnd: null,
          periodSource: null,
          token: "c".repeat(32),
        },
      ],
    }),
  );
  await open();
  expect(inputFor("账期开始").value).toBe("");
  expect(inputFor("账期结束").value).toBe("");
  expect(inputFor("账期来源").value).toBe("");
  expect(document.querySelector("[role=dialog]")?.textContent).toContain("到期日 2026-10-01");
});
