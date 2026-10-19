// @vitest-environment jsdom
import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SaleWorkbenchInspector } from "@/features/sales/sale-workbench-inspector";
import { saleFixture } from "./fixtures/sale-workbench";
import { workspaceContract } from "./fixtures/contract-workspace";
import type { PaymentRow, SaleContractRow } from "@/types/database";

let host: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
async function render(patch: Partial<ComponentProps<typeof SaleWorkbenchInspector>> = {}) {
  const props = {
    data: saleFixture(undefined, "detail", 1),
    locale: "zh" as const,
    loading: false,
    error: false,
    selectedId: workspaceContract,
    returnTo: "/sales?q=测试&page=2",
    onClose: vi.fn(),
    onRetry: vi.fn(),
    onOpen: vi.fn(),
    onPrint: vi.fn(),
    ...patch,
  };
  await act(async () => root.render(<SaleWorkbenchInspector {...props} />));
  return props;
}
async function tab(name: string) {
  const button = [...host.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(
    (b) => b.textContent === name,
  );
  expect(button).toBeTruthy();
  await act(async () => button!.click());
}
function fact(name: string) {
  return [...host.querySelectorAll("dt")].find((item) => item.textContent === name)
    ?.nextElementSibling?.textContent;
}
const payment = (patch: Partial<PaymentRow> = {}): PaymentRow => ({
  id: "99999999-9999-4999-8999-999999999999",
  source_id: workspaceContract,
  source_type: "sale",
  unit_id: null,
  customer_id: null,
  payment_date: "2026-10-17",
  amount: 500,
  currency: "XOF",
  exchange_rate_to_xof: 1,
  receipt_no: null,
  notes: null,
  payment_method: "cash",
  created_at: "2026-10-17T12:00:00Z",
  ...patch,
});

it("has a useful no-selection state without a phantom contract or amount", async () => {
  await render({ selectedId: null });
  expect(host.textContent).toContain("选中左侧合同");
  expect(host.textContent).not.toContain("XOF");
  expect(host.querySelector("button")).toBeNull();
});
it.each([
  { loading: true, error: false },
  { loading: false, error: true },
])("withholds prior details and all operation actions when unavailable %j", async (status) => {
  await render(status);
  expect(host.textContent).not.toContain("SYNTHETIC-SALE");
  expect(host.textContent).not.toContain("打开合同 / 办理");
  expect(host.textContent).not.toContain("XOF");
});
it("separates recorded price, receivable applications and cash", async () => {
  const data = saleFixture(undefined, "detail", 1);
  data.payments = [
    payment(),
    payment({ id: "88888888-8888-4888-8888-888888888888", amount: 900, payment_method: "offset" }),
  ];
  await render({ data });
  expect(fact("合同价")).toBe("1,000,000 XOF");
  expect(fact("应收已核销")).toBe("200,000 XOF");
  await tab("付款事实");
  expect(fact("经营收款")).toBe("500 XOF");
  expect(host.textContent).toContain("1 笔非现金变动");
  expect(host.textContent).not.toContain("200,000 XOF");
});
it("retains original currency and leaves collector unknown instead of using recording account", async () => {
  const data = saleFixture(undefined, "detail", 1);
  data.payments = [
    payment({
      amount: 10,
      currency: "CNY",
      exchange_rate_to_xof: 85,
      recorded_by: "recording-user-id",
      actual_collector: null,
    }),
  ];
  await render({ data });
  await tab("付款事实");
  expect(fact("经营收款")).toBe("850 XOF");
  expect(host.textContent).toContain("¥10");
  expect(host.textContent).toContain("实际收款人: 待核对");
  expect(host.textContent).not.toContain("recording-user-id");
});
it("does not turn unknown prices or absence of verified receivables into zero debt", async () => {
  const data = saleFixture(undefined, "detail", 1);
  (data.contracts[0] as SaleContractRow).total_amount_confirmed = false;
  data.summaries[workspaceContract] = {
    total: 0,
    paid: 0,
    outstanding: 0,
    overdue: 0,
    nextDue: null,
    count: 0,
    dueOutstanding: 0,
  };
  await render({ data });
  expect(fact("合同价")).toBe("待核对");
  expect(fact("已建应收未收")).toBe("暂无已核应收");
  expect(host.textContent).not.toContain("0 XOF");
});
it("links only explicit customer/asset IDs and carries the sanitized return scope", async () => {
  await render();
  const links = [...host.querySelectorAll<HTMLAnchorElement>("a")];
  expect(links).toHaveLength(2);
  const customer = new URL(links[0].href);
  expect(customer.pathname).toBe("/customers");
  expect(customer.searchParams.get("customer")).toBe(saleFixture().customers[0].id);
  expect(customer.searchParams.get("returnTo")).toBe("/sales?q=%E6%B5%8B%E8%AF%95&page=2");
  const asset = new URL(links[1].href);
  expect(asset.searchParams.get("unit")).toBe(saleFixture().units[0].id);
  expect(asset.searchParams.get("building")).toBe(saleFixture().buildings[0].id);
});
it("preserves the original full-detail and print callbacks and keyboard tabs", async () => {
  const props = await render();
  const first = host.querySelector<HTMLButtonElement>('[role="tab"][aria-selected="true"]')!;
  await act(async () =>
    first.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })),
  );
  expect(host.querySelector('[aria-selected="true"]')?.textContent).toBe("付款事实");
  const button = [...host.querySelectorAll<HTMLButtonElement>("button")].find((b) =>
    b.textContent?.includes("打开合同 / 办理"),
  )!;
  await act(async () => button.click());
  expect(props.onOpen).toHaveBeenCalledWith("finance");
  const print = [...host.querySelectorAll<HTMLButtonElement>("button")].find((b) =>
    b.textContent?.includes("合同 / 打印"),
  )!;
  await act(async () => print.click());
  expect(props.onPrint).toHaveBeenCalledTimes(1);
});
it("localizes the same read-only facts for French", async () => {
  await render({ locale: "fr" });
  expect(host.textContent).toContain("Exécution");
  await tab("Dossier");
  expect(fact("Signature")).toBe("2026-01-01");
  expect(host.textContent).toContain("Date du transfert");
});
