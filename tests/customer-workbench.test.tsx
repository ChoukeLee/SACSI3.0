// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  refresh: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }),
}));
vi.mock("@/features/customers/actions", () => ({
  createCustomer: mocks.create,
  updateCustomer: mocks.update,
}));
vi.mock("@/components/ui/operational", () => ({
  RightDrawer: ({
    children,
    title,
    onClose,
  }: {
    children: React.ReactNode;
    title: string;
    onClose: () => void;
  }) => (
    <section role="dialog" aria-label={title}>
      <button onClick={onClose}>关闭</button>
      {children}
    </section>
  ),
}));
import { CustomerWorkbench } from "../src/features/customers/customer-workbench";
import { CustomerWorkbenchForm } from "../src/features/customers/customer-workbench-form";
import { customerDirectoryFixture, directoryIds } from "./fixtures/customer-directory";
let host: HTMLDivElement, root: Root;
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  vi.resetAllMocks();
  fetchMock = vi
    .fn()
    .mockResolvedValue({ ok: true, json: async () => customerDirectoryFixture("detail") });
  vi.stubGlobal("fetch", fetchMock);
  window.history.replaceState(null, "", "/");
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
async function render(
  options: { selected?: string; locale?: "zh" | "fr"; canEdit?: boolean; returnTo?: string } = {},
) {
  const data = customerDirectoryFixture();
  await act(async () =>
    root.render(
      <CustomerWorkbench
        data={data}
        locale={options.locale ?? "zh"}
        canEdit={options.canEdit ?? false}
        initialSelectedId={options.selected ?? null}
        returnTo={options.returnTo ?? null}
      />,
    ),
  );
}
function link(name: string) {
  const el = [...host.querySelectorAll("a")].find((a) => a.textContent?.includes(name));
  expect(el, name).toBeTruthy();
  return el!;
}
function button(name: string) {
  const el = [...host.querySelectorAll("button")].find((a) => a.textContent === name);
  expect(el, name).toBeTruthy();
  return el!;
}
async function click(el: Element) {
  await act(async () => (el as HTMLElement).click());
}
it("renders the approved directory without automatic detail or full-history reads", async () => {
  await render();
  expect(host.textContent).toContain("客户关系档案");
  expect(host.textContent).toContain("未关联可见项目");
  expect(host.textContent).toContain("先选择一份客户档案");
  expect(host.textContent).toContain("示例客户甲");
  expect(fetchMock).not.toHaveBeenCalled();
  expect(host.textContent).not.toContain("新建客户");
});
it("reads only the explicitly selected ID and offers exact contract/asset links with a return location", async () => {
  await render();
  await click(link("示例客户甲"));
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const endpoint = new URL(fetchMock.mock.calls[0][0], "https://example.invalid");
  expect(endpoint.pathname).toBe("/api/customers/directory");
  expect(endpoint.searchParams.get("customer")).toBe(directoryIds.customer);
  expect(window.location.search).toContain(directoryIds.customer);
  expect(host.textContent).toContain("合同买方");
  expect(host.textContent).toContain("实际住客");
  const sale = new URL(link("打开合同").href);
  expect(sale.pathname).toBe("/sales");
  expect(sale.searchParams.get("contract")).toBe(directoryIds.sale);
  expect(sale.searchParams.get("returnTo")).toContain(`customer=${directoryIds.customer}`);
  expect(host.textContent).toContain("预计 2026-10-21");
  expect(host.textContent).not.toContain("checked_in");
});
it("supports a precise customer deep link even when no row was clicked", async () => {
  await render({ selected: directoryIds.customer });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(host.textContent).toContain("DEMO-S-101");
  expect(host.textContent).not.toContain("编辑资料");
});
it("clears selected details immediately when changing project before new server data arrives", async () => {
  await render({ selected: directoryIds.customer, canEdit: true });
  expect(host.textContent).toContain("DEMO-S-101");
  const select = host.querySelector("select")!;
  await act(async () => {
    select.value = directoryIds.project;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(mocks.push).toHaveBeenCalledWith(`/customers?project=${directoryIds.project}`);
  expect(host.textContent).not.toContain("DEMO-S-101");
  expect(host.textContent).toContain("先选择一份客户档案");
});
it("clears selected details on a role filter navigation", async () => {
  await render({ selected: directoryIds.customer });
  await click(link("代订联系人"));
  expect(mocks.push).toHaveBeenCalledWith("/customers?filter=contact");
  expect(host.textContent).not.toContain("DEMO-S-101");
});
it("does not leak an older asynchronous customer response into a new selection", async () => {
  let resolveOld: (value: unknown) => void = () => {};
  fetchMock.mockReturnValueOnce(
    new Promise((resolve) => {
      resolveOld = resolve;
    }),
  );
  fetchMock.mockResolvedValueOnce({
    ok: true,
    json: async () => customerDirectoryFixture("detail", directoryIds.other),
  });
  await render();
  await click(link("示例客户甲"));
  await click(link("示例客户乙"));
  await act(async () =>
    resolveOld({ ok: true, json: async () => customerDirectoryFixture("detail") }),
  );
  const inspector = host.querySelector('aside[aria-label="客户关系详情"]')!;
  expect(inspector.textContent).toContain("示例客户乙");
  expect(inspector.textContent).not.toContain("示例客户甲");
  expect(inspector.textContent).not.toContain("DEMO-S-101");
});
it.each([403, 404, 503])(
  "shows unavailable instead of zero relationships for detail failure %s",
  async (status) => {
    fetchMock.mockResolvedValue({ ok: false, status });
    await render({ selected: directoryIds.customer });
    expect(host.querySelector('[role="alert"]')).toBeTruthy();
    expect(host.textContent).not.toContain("当前范围内尚无可见的明确业务关联");
    expect(host.textContent).toContain("重新读取");
  },
);
it("does not expose raw document values, and keeps profile editing behind permission", async () => {
  await render({ selected: directoryIds.customer, canEdit: true });
  await click(link("档案资料"));
  expect(host.textContent).toContain("测试资料");
  expect(host.textContent).toContain("证件资料");
  await click(button("编辑资料"));
  expect(host.querySelector('[role="dialog"]')).toBeTruthy();
  expect(mocks.update).not.toHaveBeenCalled();
  await click(button("取消"));
  expect(host.querySelector('[role="dialog"]')).toBeNull();
});
it("provides French labels, hides writes for a reader, and rejects external return URLs", async () => {
  await render({ locale: "fr", returnTo: "https://evil.invalid" });
  expect(host.textContent).toContain("Dossiers et relations clients");
  expect(host.textContent).toContain("Contacts de réservation");
  expect(host.textContent).not.toContain("Nouveau client");
  expect(host.textContent).not.toContain("Retour à la source");
});
it("uses the original audited edit action and does not submit blank document, risk flags or relationships", async () => {
  const profile = customerDirectoryFixture("detail").profile!;
  const saved = vi.fn();
  mocks.update.mockResolvedValue({ success: true, data: { ...profile, id: profile.id } });
  await act(async () =>
    root.render(
      <CustomerWorkbenchForm profile={profile} locale="zh" onClose={() => {}} onSaved={saved} />,
    ),
  );
  await act(async () =>
    host
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
  expect(mocks.update).toHaveBeenCalledWith(
    directoryIds.customer,
    expect.objectContaining({ name: "示例客户甲", notes: "测试资料" }),
  );
  const payload = mocks.update.mock.calls[0][1];
  expect(payload).not.toHaveProperty("document_no_plain");
  expect(payload).not.toHaveProperty("is_blacklisted");
  expect(payload).not.toHaveProperty("customer_id");
  expect(saved).toHaveBeenCalledWith(directoryIds.customer, false);
});
it("preserves an unsuccessful form with error instead of declaring success", async () => {
  mocks.create.mockResolvedValue({ success: false, error: "Synthetic denied" });
  const profile = customerDirectoryFixture("detail").profile!;
  mocks.update.mockResolvedValue({ success: false, error: "Synthetic denied" });
  const saved = vi.fn();
  await act(async () =>
    root.render(
      <CustomerWorkbenchForm profile={profile} locale="zh" onClose={() => {}} onSaved={saved} />,
    ),
  );
  await act(async () =>
    host
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
  expect(host.textContent).toContain("Synthetic denied");
  expect(saved).not.toHaveBeenCalled();
  expect(host.querySelector('[role="dialog"]')).toBeTruthy();
});
it.each([false, true])(
  "reveals the selected customer on narrow screens once, respecting reduced motion %s",
  async (reducedMotion) => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal(
      "matchMedia",
      vi.fn((query: string) => ({ matches: query.includes("max-width") || reducedMotion })),
    );
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn((callback: FrameRequestCallback) => {
        frames.push(callback);
        return frames.length;
      }),
    );
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    await render();
    const target = host.querySelector<HTMLDivElement>('[aria-label="已选客户详情区"]')!;
    const scroll = vi.fn();
    target.scrollIntoView = scroll;
    const focus = vi.spyOn(target, "focus");
    await click(link("示例客户甲"));
    expect(frames).toHaveLength(1);
    expect(scroll).not.toHaveBeenCalled();
    await act(async () => frames[0](0));
    expect(focus).toHaveBeenCalledExactlyOnceWith({ preventScroll: true });
    expect(document.activeElement).toBe(target);
    expect(scroll).toHaveBeenCalledExactlyOnceWith({
      block: "start",
      behavior: reducedMotion ? "auto" : "smooth",
    });
    expect(window.location.search).toContain(`customer=${directoryIds.customer}`);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  },
);
it("does not move focus or scroll a desktop selection", async () => {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches: false })),
  );
  const frame = vi.fn();
  vi.stubGlobal("requestAnimationFrame", frame);
  await render();
  await click(link("示例客户甲"));
  expect(frame).not.toHaveBeenCalled();
});
it("offers a deliberate narrow-screen jump for an SSR/direct-link selection without focus on data arrival", async () => {
  const frames: FrameRequestCallback[] = [];
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({ matches: query.includes("max-width") })),
  );
  vi.stubGlobal(
    "requestAnimationFrame",
    vi.fn((callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    }),
  );
  await render({ selected: directoryIds.customer });
  expect(host.textContent).toContain("DEMO-S-101");
  expect(frames).toHaveLength(0);
  const target = host.querySelector<HTMLDivElement>('[aria-label="已选客户详情区"]')!;
  target.scrollIntoView = vi.fn();
  await click(button("查看已选客户详情"));
  expect(frames).toHaveLength(1);
  await act(async () => frames[0](0));
  expect(document.activeElement).toBe(target);
  expect(target.scrollIntoView).toHaveBeenCalledTimes(1);
});
