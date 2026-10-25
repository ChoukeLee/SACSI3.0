// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { customerDirectoryFixture } from "./fixtures/customer-directory";
const m = vi.hoisted(() => ({ save: vi.fn(), options: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: m.refresh }) }));
vi.mock("@/features/cimac/cimac-profile-actions", () => ({
  manageCimacCustomer: m.save,
  readCimacCustomerLinkOptions: m.options,
}));
import { CimacCustomerManagement } from "@/features/cimac/cimac-customer-management";
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  m.options.mockResolvedValue({ success: true, data: [] });
  m.save.mockRejectedValue(new Error("lost response"));
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
const submit = () =>
  act(async () => {
    host
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
describe("CIMAC management request recovery", () => {
  it("retains request identity on failed retry, form changes and close/reopen; clears only after verified success", async () => {
    const profile = customerDirectoryFixture("detail").profile!;
    await act(async () =>
      root.render(<CimacCustomerManagement profile={profile} relations={[]} locale="zh" />),
    );
    await act(async () => host.querySelector("button")!.click());
    await submit();
    const first = m.save.mock.calls[0][0];
    expect(host.querySelector('[role="alert"]')).not.toBeNull();
    await act(async () => {
      const select = host.querySelector("select")!;
      select.value = "archived";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await act(async () => host.querySelector("button")!.click());
    await act(async () => host.querySelector("button")!.click());
    await submit();
    expect(m.save.mock.calls[1][0]).toBe(first);
    m.save.mockResolvedValue({ success: true });
    await submit();
    expect(host.querySelector("form")).toBeNull();
    expect(m.refresh).toHaveBeenCalledOnce();
    await act(async () => host.querySelector("button")!.click());
    await submit();
    expect(m.save.mock.calls[3][0]).not.toBe(first);
  });
});
