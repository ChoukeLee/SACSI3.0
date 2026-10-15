// @vitest-environment jsdom
import React, { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DailyCustomerSelect } from "@/features/daily-rentals/daily-customer-select";
import { calendarBuilding, calendarOtherBuilding } from "./fixtures/calendar-window";
let host: HTMLDivElement, root: Root;
const fetchMock = vi.fn();
const agent = {
  id: "agent",
  name: "颖",
  phone: "001",
  is_blacklisted: false,
  has_active_lease_contract: true,
  has_active_sale_contract: true,
};
function Picker({ buildingId = calendarBuilding }: { buildingId?: string }) {
  const [value, setValue] = useState("");
  return (
    <>
      <DailyCustomerSelect
        buildingId={buildingId}
        value={value}
        onChange={setValue}
        locale="zh"
        placeholder="选择经办人"
      />
      <span data-selected>{value}</span>
    </>
  );
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  fetchMock.mockImplementation((url: string) => {
    const params = new URL(url, "https://example.test").searchParams;
    return Promise.resolve({
      ok: true,
      json: async () => ({
        buildingId: params.get("buildingId"),
        query: params.get("query"),
        page: 1,
        hasMore: false,
        rows: [
          agent,
          { ...agent, id: "blacklist", name: "黄姐", is_blacklisted: true },
          { ...agent, id: "unregistered", name: "Not an agent" },
        ],
      }),
    });
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
async function render(buildingId = calendarBuilding) {
  await act(async () => {
    root.render(<Picker buildingId={buildingId} />);
  });
  await act(async () => vi.advanceTimersByTimeAsync(0));
}
async function input(value: string) {
  await act(async () => {
    const element = host.querySelector("input")!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
it("reads candidates on mounting the booking form, keeps original agent eligibility, blacklist and contract markers, then selects the existing identity", async () => {
  await render();
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(host.textContent).toContain("有长租合同");
  expect(host.textContent).toContain("有出售合同");
  expect(host.textContent).not.toContain("Not an agent");
  expect(host.querySelector<HTMLOptionElement>('option[value="blacklist"]')?.disabled).toBe(true);
  await act(async () => {
    const select = host.querySelector("select")!;
    select.value = "agent";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(host.querySelector("[data-selected]")?.textContent).toBe("agent");
});
it("debounces typing without caching candidates, then rechecks current authorized flags with no-store", async () => {
  await render();
  await input("颖");
  expect(fetchMock).toHaveBeenCalledTimes(1);
  await act(async () => vi.advanceTimersByTimeAsync(200));
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(fetchMock.mock.calls[1][0]).toContain("query=%E9%A2%96");
  expect(fetchMock.mock.calls[1][1].cache).toBe("no-store");
});
it("failed or malformed candidates remain unknown and unselectable, with an explicit retry", async () => {
  fetchMock.mockResolvedValue({ ok: false });
  await render();
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("不能视为没有候选");
  expect(host.querySelector("select")?.disabled).toBe(true);
  fetchMock.mockResolvedValue({
    ok: true,
    json: async () => ({
      buildingId: calendarBuilding,
      query: "",
      page: 1,
      hasMore: false,
      rows: [{ id: "bad", name: "颖", phone: null, is_blacklisted: false }],
    }),
  });
  await act(async () =>
    [...host.querySelectorAll("button")].find((button) => button.textContent === "重试")!.click(),
  );
  await act(async () => vi.advanceTimersByTimeAsync(0));
  expect(host.querySelector('[role="alert"]')).not.toBeNull();
  expect(host.querySelector("select")?.disabled).toBe(true);
});
it("aborts candidates for an abandoned building and ignores a late response", async () => {
  let complete!: (value: unknown) => void;
  fetchMock.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  );
  await render();
  await render(calendarOtherBuilding);
  expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
  await act(async () =>
    complete({
      ok: true,
      json: async () => ({
        buildingId: calendarBuilding,
        query: "",
        page: 1,
        hasMore: false,
        rows: [{ ...agent, name: "Old response" }],
      }),
    }),
  );
  expect(host.textContent).not.toContain("Old response");
  expect(host.querySelector("[data-selected]")?.textContent).toBe("");
});
it("clears a selected identity and its cached contact label if later authorization/data verification fails", async () => {
  await render();
  await act(async () => {
    const select = host.querySelector("select")!;
    select.value = "agent";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(host.querySelector("[data-selected]")?.textContent).toBe("agent");
  fetchMock.mockResolvedValue({ ok: false, status: 403 });
  await input("颖");
  await act(async () => vi.advanceTimersByTimeAsync(200));
  expect(host.querySelector("[data-selected]")?.textContent).toBe("");
  expect(host.querySelector('option[value="agent"]')).toBeNull();
  expect(host.querySelector("select")?.disabled).toBe(true);
});
