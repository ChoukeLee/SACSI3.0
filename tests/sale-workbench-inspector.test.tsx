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
    onAction: vi.fn(),
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
async function paymentSource(id: string) {
  const row = host.querySelector(`[data-sale-payment-id="${id}"]`);
  expect(row).toBeTruthy();
  await act(async () => row!.querySelector<HTMLButtonElement>("button")!.click());
}
function fact(name: string) {
  return [...host.querySelectorAll("dt")].find((item) => item.textContent === name)
    ?.nextElementSibling?.textContent;
}
function disclosure(label: string) {
  return [...host.querySelectorAll("details")].find(
    (item) => item.querySelector(":scope > summary")?.textContent === label,
  );
}
async function openDisclosure(label: string) {
  const details = disclosure(label);
  expect(details).toBeTruthy();
  if (!details!.open) await act(async () => details!.querySelector("summary")!.click());
  return details!;
}
function visible(element: Element) {
  for (let parent: Element | null = element; parent; parent = parent.parentElement) {
    if (
      parent instanceof HTMLDetailsElement &&
      !parent.open &&
      !parent.querySelector(":scope > summary")?.contains(element)
    )
      return false;
  }
  return true;
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

function nativeSourceData() {
  const data = saleFixture(undefined, "detail", 1);
  const contract = data.contracts[0] as SaleContractRow;
  Object.assign(contract, {
    registration_basis: "source_record",
    source_reference: "Synthetic.xlsx|Sheet1!A1",
    sale_currency: "CNY",
    total_amount_xof: 0,
    total_amount_native: 720000,
    total_amount_confirmed: true,
    signed_date: null,
    payment_plan_type: "unconfirmed",
    transfer_status: "unconfirmed",
    source_balance_native: 0,
    source_balance_reference: "Synthetic.xlsx|Sheet1!B1",
  });
  data.receivables = [];
  data.schedules = [];
  data.summaries[contract.id] = {
    total: 0,
    paid: 0,
    outstanding: 0,
    overdue: 0,
    nextDue: null,
    count: 0,
    dueOutstanding: 0,
  };
  data.payments = [700000, 20000].map((amount, index) =>
    payment({
      id: `native-payment-${index}`,
      source_type: "sale_contract",
      source_id: contract.id,
      unit_id: contract.unit_id,
      customer_id: contract.customer_id,
      amount,
      currency: "CNY",
      native_settlement: true,
      exchange_rate_to_xof: null,
      payment_method: null,
    }),
  );
  return data;
}

it("has a useful no-selection state without a phantom contract or amount", async () => {
  await render({ selectedId: null });
  expect(host.textContent).toContain("选中左侧合同");
  expect(host.textContent).not.toContain("XOF");
  expect(host.querySelector("button")).toBeNull();
});
it("uses four read tabs with every permitted manual action hidden until more operations opens", async () => {
  const props = await render({ canRecordFinance: true, canManage: true, canTerminate: true });
  expect([...host.querySelectorAll('[role="tab"]')].map((item) => item.textContent)).toEqual([
    "概览",
    "收付款",
    "资料",
    "历史",
  ]);
  const more = disclosure("更多操作")!;
  expect(more.open).toBe(false);
  for (const action of more.querySelectorAll("button")) expect(visible(action)).toBe(false);
  expect(
    [...host.querySelectorAll("button")]
      .filter(visible)
      .every(
        (item) =>
          item.getAttribute("role") === "tab" || item.getAttribute("aria-label") === "关闭合同预览",
      ),
  ).toBe(true);
  await tab("收付款");
  expect(props.onAction).not.toHaveBeenCalled();
  expect(props.onPrint).not.toHaveBeenCalled();
  expect(disclosure("更多操作")?.open).toBe(false);
});
it("leaves the outer drawer as the only close control in embedded mode", async () => {
  await render({ embedded: true });
  expect(host.querySelector('button[aria-label="关闭合同预览"]')).toBeNull();
  expect(host.querySelector("h2")?.textContent).toBe(saleFixture().customers[0].name);
  expect(host.querySelector("header")).toBeNull();
  for (const patch of [{ loading: true }, { error: true }]) {
    await render({ ...patch, embedded: true });
    expect([...host.querySelectorAll("button")].some((item) => item.textContent === "关闭")).toBe(
      false,
    );
  }
});
it("keeps operation errors readable outside a closed disclosure and cannot execute while busy", async () => {
  const props = await render({
    canRecordFinance: true,
    canManage: true,
    canTerminate: true,
    busy: true,
    operationError: "原请求结果待核验",
  });
  const error = host.querySelector('[role="alert"]')!;
  expect(error.textContent).toBe("原请求结果待核验");
  expect(visible(error)).toBe(true);
  const more = await openDisclosure("更多操作");
  for (const button of more.querySelectorAll<HTMLButtonElement>("button")) {
    await act(async () => button.click());
  }
  expect(props.onAction).not.toHaveBeenCalled();
  expect(props.onPrint).not.toHaveBeenCalled();
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
  expect(fact("登记总价")).toBe("1,000,000 XOF");
  await tab("收付款");
  expect(fact("应收已核销")).toBe("200,000 XOF");
  expect(fact("经营收款")).toBe("500 XOF");
  expect(host.textContent).toContain("1 笔非现金变动");
  expect(fact("经营收款")).not.toContain("200,000 XOF");
});
it.each(["zh", "fr"] as const)(
  "shows payment rows immediately after buyer context and before summaries and the plan in %s",
  async (locale) => {
    await render({ locale });
    await tab(locale === "zh" ? "收付款" : "Paiements");
    const section = host.querySelector(
      `[aria-label="${locale === "zh" ? "实际收付款" : "Mouvements réels"}"]`,
    )!;
    const buyer = section.querySelector("h3")!;
    const table = section.querySelector("table")!;
    expect(buyer.nextElementSibling?.contains(table)).toBe(true);
    for (const label of locale === "zh"
      ? ["房款原币实收", "已核应收", "已录付款事实", "付款计划"]
      : [
          "Encaissements du bien par devise",
          "Créances vérifiées",
          "Paiements enregistrés",
          "Plan de paiement",
        ]) {
      const heading = [...host.querySelectorAll("h3")].find((row) => row.textContent === label)!;
      expect(heading).toBeTruthy();
      expect(
        table.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    }
  },
);
it("retains the payment plan and does not call future installments overdue or allocation progress actual cash", async () => {
  const data = saleFixture(undefined, "detail", 1);
  data.today = "2026-11-07";
  data.schedules = [
    {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
      sale_contract_id: workspaceContract,
      installment_no: 1,
      due_date: "2026-11-01",
      amount_xof: 500000,
      status: "pending",
      created_at: "2026-01-01T00:00:00Z",
    },
    {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2",
      sale_contract_id: workspaceContract,
      installment_no: 2,
      due_date: "2026-12-01",
      amount_xof: 500000,
      status: "overdue",
      created_at: "2026-01-01T00:00:00Z",
    },
  ];
  const template = data.receivables[0];
  data.receivables = [
    {
      ...template,
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1",
      due_date: "2026-11-01",
      amount_xof: 500000,
      paid_amount_xof: 200000,
      status: "partial",
    },
    {
      ...template,
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2",
      due_date: "2026-12-01",
      amount_xof: 500000,
      paid_amount_xof: 0,
      status: "overdue",
    },
  ];
  data.payments = [];
  await render({ data });
  await tab("收付款");
  expect(host.textContent).toContain("付款计划");
  const future = [...host.querySelectorAll("div")].find((item) =>
    item.querySelector(":scope > p")?.textContent?.includes("2026-12-01"),
  );
  expect(future?.textContent).toContain("待付 / 未逾期");
  expect(future?.textContent).not.toContain("已逾期");
  await tab("收付款");
  expect(fact("应收已核销")).toBe("200,000 XOF");
  expect(fact("经营收款")).toBe("暂无已核记录");
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
  await tab("收付款");
  expect(fact("经营收款")).toBe("850 XOF");
  expect(host.textContent).toContain("¥10");
  await paymentSource(data.payments[0].id);
  expect(fact("实际收款人")).toBe("待核对");
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
  expect(fact("登记总价")).toBe("待核对");
  await tab("收付款");
  expect(fact("已建应收未收")).toBe("暂无已核应收");
  expect(host.textContent).not.toContain("0 XOF");
});
it("keeps a source-only native price and receipts separate from unknown bills and XOF actions", async () => {
  const data = nativeSourceData();
  const props = await render({ data, canRecordFinance: true, canManage: true });
  expect(fact("登记总价")).toBe("¥720,000 CNY");
  expect(fact("登记余款（Excel）")).toBe("¥0 CNY");
  expect(host.textContent).not.toContain("暂无已登记付款计划，不代表已付款");
  expect(host.textContent).not.toContain("0 XOF");

  await openDisclosure("更多操作");
  for (const label of ["手工登记出售收款", "新增分期"]) {
    const action = [...host.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent === label,
    );
    expect(action?.disabled).toBe(true);
    await act(async () => action!.click());
  }
  expect(props.onAction).not.toHaveBeenCalled();
  expect(host.textContent).toContain("不支持手工西法收款或新增西法分期");

  await tab("资料");
  expect(fact("签约日期")).toBe("未登记");
  expect(fact("登记总价")).toBe("¥720,000 CNY");

  await tab("收付款");
  expect(fact("已建应收未收")).toBe("暂无已核应收");
  expect(fact("应收已核销")).toBe("—");
  const receiptHeading = [...host.querySelectorAll("h3")].find(
    (heading) => heading.textContent === "房款原币实收",
  );
  expect(receiptHeading?.nextElementSibling?.textContent).toBe("¥720,000 CNY");
  expect(fact("西法经营收款")).toBe("暂无已核记录");
  const articles = [...host.querySelectorAll("[data-sale-payment-id]")];
  expect(articles).toHaveLength(2);
  expect(articles.every((row) => row.textContent?.includes("原币房款实收 · 未折算西法"))).toBe(
    true,
  );
  expect(host.textContent).not.toContain("不计入现金汇总");
  expect(host.textContent).not.toContain("2 笔待核");
  expect(host.textContent).not.toContain("2 笔非现金变动");
  expect(host.textContent).not.toContain("0 XOF");
});
it("excludes mismatched native purchase receipts and keeps XOF registration fees independent", async () => {
  const data = nativeSourceData();
  data.payments[1].unit_id = "88888888-8888-4888-8888-888888888888";
  data.payments.push(
    payment({
      id: "registration-payment",
      source_type: "sale_registration_fee",
      unit_id: data.contracts[0].unit_id,
      customer_id: data.contracts[0].customer_id,
      amount: 300000,
    }),
  );
  await render({ data });
  await tab("收付款");
  const receiptHeading = [...host.querySelectorAll("h3")].find(
    (heading) => heading.textContent === "房款原币实收",
  );
  expect(receiptHeading?.nextElementSibling?.textContent).toBe("¥700,000 CNY");
  expect(fact("西法经营收款")).toBe("300,000 XOF");
  const articles = [...host.querySelectorAll("[data-sale-payment-id]")];
  const mismatched = articles.find((row) => row.textContent?.includes("¥20,000"));
  expect(mismatched?.textContent).toContain("原币登记待核 · 未折算西法");
  expect(mismatched?.textContent).not.toContain("原币房款实收");
  const registration = articles.find((row) => row.textContent?.includes("300,000 XOF"));
  expect(registration?.textContent).toContain("注册金收款");
  expect(registration?.textContent).not.toContain("原币房款实收");
});
it("links only explicit customer/asset IDs and carries the sanitized return scope", async () => {
  await render();
  await tab("资料");
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
it("opens focused actions directly and preserves print and keyboard tabs", async () => {
  const props = await render({ canRecordFinance: true, canManage: true, canTerminate: true });
  const first = host.querySelector<HTMLButtonElement>('[role="tab"][aria-selected="true"]')!;
  await act(async () =>
    first.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })),
  );
  expect(host.querySelector('[aria-selected="true"]')?.textContent).toBe("收付款");
  await openDisclosure("更多操作");
  const find = (name: string) =>
    [...host.querySelectorAll<HTMLButtonElement>("button")].find((b) =>
      b.textContent?.includes(name),
    )!;
  for (const [label, action] of [
    ["手工登记出售收款", "payment"],
    ["新增分期", "installment"],
    ["终止合同", "terminate"],
  ]) {
    await act(async () => find(label).click());
    expect(props.onAction).toHaveBeenLastCalledWith(action);
  }
  expect(host.textContent).not.toContain("打开合同 / 办理");
  await act(async () => find("打印登记合同").click());
  expect(props.onPrint).toHaveBeenCalledTimes(1);
});
it("keeps operations hidden for viewers and inactive contracts", async () => {
  await render();
  expect(host.textContent).not.toContain("手工登记出售收款");
  expect(host.textContent).not.toContain("新增分期");
  const data = saleFixture(undefined, "detail", 1);
  data.contracts[0].status = "terminated";
  await render({ data, canRecordFinance: true, canManage: true, canTerminate: true });
  expect(host.textContent).not.toContain("终止合同");
  expect(host.textContent).toContain("打印登记合同");
});
it("disables all mutation entry points while a business operation is pending", async () => {
  await render({ canRecordFinance: true, canManage: true, canTerminate: true, busy: true });
  const actions = host.querySelectorAll<HTMLButtonElement>('[aria-label="办理此合同"] button');
  expect(actions).toHaveLength(3);
  expect([...actions].every((button) => button.disabled)).toBe(true);
});
it("retains every payment and its full notes in the single detail", async () => {
  const data = saleFixture(undefined, "detail", 1);
  data.payments = Array.from({ length: 8 }, (_, index) =>
    payment({
      id: `payment-${index}`,
      receipt_no: `receipt-${index}`,
      notes: `完整备注-${index}`,
    }),
  );
  await render({ data });
  await tab("收付款");
  expect(host.querySelectorAll("[data-sale-payment-id]")).toHaveLength(8);
  await paymentSource("payment-7");
  expect(host.textContent).toContain("receipt-7");
  expect(host.textContent).toContain("完整备注-7");
  expect(host.textContent).not.toContain("办理详情");
});
it("localizes the same read-only facts for French", async () => {
  await render({ locale: "fr" });
  expect(host.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe("Aperçu");
  await tab("Informations");
  expect(fact("Signature")).toBe("2026-01-01");
  await tab("Paiements");
  expect(host.textContent).toContain("Plan de paiement");
});

it.each(["zh", "fr"] as const)(
  "omits legacy transfer workflow fields and actions while retaining payment facts in %s",
  async (locale) => {
    const data = saleFixture(undefined, "detail", 1);
    Object.assign(data.contracts[0], {
      transfer_status: "completed",
      transfer_date: "2039-12-31",
      title_certificate_no: "SYNTHETIC-LEGACY-TITLE",
    });
    await render({ data, locale, canRecordFinance: true, canManage: true, canTerminate: true });
    await tab(locale === "zh" ? "资料" : "Informations");
    await openDisclosure(locale === "zh" ? "更多操作" : "Autres opérations");
    expect(host.textContent).not.toMatch(/过户|产权证|transfert|titre foncier/i);
    expect(host.textContent).not.toContain("SYNTHETIC-LEGACY-TITLE");
    expect(host.textContent).not.toContain("2039-12-31");
    expect(fact(locale === "zh" ? "签约日期" : "Signature")).toBe("2026-01-01");
    await tab(locale === "zh" ? "收付款" : "Paiements");
    expect(host.textContent).toContain(locale === "zh" ? "付款计划" : "Plan de paiement");
    const actions = host.querySelectorAll(
      '[aria-label="' + (locale === "zh" ? "办理此合同" : "Gérer ce contrat") + '"] button',
    );
    expect(actions).toHaveLength(3);
    await tab(locale === "zh" ? "收付款" : "Paiements");
    expect(host.querySelectorAll("[data-sale-payment-id]")).toHaveLength(data.payments.length);
    expect(host.textContent).not.toMatch(/过户|产权证|transfert|titre foncier/i);
  },
);

it.each([0, null])(
  "keeps native cash, source balance %s and unknown signing separate from managed receivables",
  async (sourceBalance) => {
    const data = saleFixture(undefined, "detail", 1);
    data.today = "2026-11-07";
    const contract = data.contracts[0] as SaleContractRow;
    Object.assign(contract, {
      registration_basis: "source_record",
      source_reference: "sha256:synthetic|sheet:Source|cell:E65",
      signed_date: null,
      payment_plan_type: "unconfirmed",
      transfer_status: "unconfirmed",
      sale_currency: "CNY",
      total_amount_xof: 0,
      total_amount_native: 720000,
      source_balance_native: sourceBalance,
      source_balance_reference: sourceBalance === null ? null : "source:Source!K65",
    });
    data.receivables = [];
    data.receivableCount = 0;
    data.schedules = [];
    data.scheduleCount = 0;
    data.summaries[workspaceContract] = {
      total: 0,
      paid: 0,
      outstanding: 0,
      overdue: 0,
      nextDue: null,
      count: 0,
      dueOutstanding: 0,
    };
    data.payments = [
      payment({
        source_type: "sale_contract",
        unit_id: contract.unit_id,
        customer_id: contract.customer_id,
        amount: 700000,
        currency: "CNY",
        native_settlement: true,
        exchange_rate_to_xof: null,
        payment_method: null,
      }),
      payment({
        id: "88888888-8888-4888-8888-888888888888",
        source_type: "sale_contract",
        unit_id: contract.unit_id,
        customer_id: contract.customer_id,
        payment_date: "2026-10-19",
        amount: 20000,
        currency: "CNY",
        native_settlement: true,
        exchange_rate_to_xof: null,
        payment_method: null,
      }),
      payment({
        id: "77777777-7777-4777-8777-777777777777",
        source_type: "sale_registration_fee",
        unit_id: contract.unit_id,
        customer_id: contract.customer_id,
        amount: 300000,
      }),
    ];
    data.paymentCount = data.payments.length;
    const props = await render({ data, canRecordFinance: true, canManage: true });
    expect(host.textContent).toContain("按Excel登记");
    expect(fact("登记总价")).toContain("720,000");
    expect(fact("登记总价")).toContain("CNY");
    expect(fact("累计房款入款")).toContain("720,000");
    expect(fact("累计房款入款")).not.toContain("300,000");
    if (sourceBalance === 0) expect(fact("登记余款（Excel）")).toMatch(/0 CNY/);
    else {
      expect(fact("登记余款（Excel）")).toBeUndefined();
      expect(fact("已核未收")).toBe("暂无已核应收");
    }
    expect(disclosure("更多操作")?.open).toBe(false);
    await tab("资料");
    expect(fact("签约日期")).toBe("未登记");
    await tab("收付款");
    expect(fact("已建应收未收")).toBe("暂无已核应收");
    expect(host.textContent).toContain("原币房款实收 · 未折算西法");
    expect(host.textContent).not.toMatch(/[12] 笔待核/);
    expect(host.textContent).not.toContain("已核账单已结清");
    expect(fact("西法经营收款")).toBe("300,000 XOF");
    await openDisclosure("更多操作");
    for (const label of ["手工登记出售收款", "新增分期", "打印登记合同"]) {
      const button = [...host.querySelectorAll<HTMLButtonElement>("button")].find((item) =>
        item.textContent?.includes(label),
      )!;
      expect(button.disabled).toBe(true);
      await act(async () => button.click());
    }
    expect(props.onAction).not.toHaveBeenCalled();
    expect(props.onPrint).not.toHaveBeenCalled();
  },
);

it("keeps a managed unpaid balance ahead of an Excel zero balance", async () => {
  const data = saleFixture(undefined, "detail", 1);
  Object.assign(data.contracts[0], {
    registration_basis: "source_record",
    source_reference: "source:E33",
    signed_date: null,
    source_balance_native: 0,
    source_balance_reference: "source:K33",
  });
  const props = await render({ data });
  expect(fact("已核未收")).toBe("800,000 XOF");
  expect(fact("登记余款（Excel）")).toBeUndefined();
  await openDisclosure("更多操作");
  const print = [...host.querySelectorAll<HTMLButtonElement>("button")].find((item) =>
    item.textContent?.includes("打印登记合同"),
  )!;
  expect(print.disabled).toBe(true);
  await act(async () => print.click());
  expect(props.onPrint).not.toHaveBeenCalled();
});

it("keeps full payment provenance in one selected source panel and refreshes it from current data", async () => {
  const data = saleFixture(undefined, "detail", 1);
  data.payments = [
    payment({
      notes: "完整来源原文-unknown",
      receipt_no: "SYSTEM-UNKNOWN",
      external_receipt_no: "SOURCE-UNKNOWN",
      recorded_by: "private-recording-id",
      actual_collector: null,
    }),
    payment({
      id: "88888888-8888-4888-8888-888888888888",
      notes: "完整来源原文-known",
      receipt_no: "SYSTEM-KNOWN",
      actual_collector: "Synthetic collector",
      collector_basis: "Synthetic receipt basis",
    }),
  ];
  await render({ data });
  await tab("收付款");
  expect(host.querySelectorAll("[data-sale-payment-id]")).toHaveLength(2);
  expect(host.querySelectorAll("details")).toHaveLength(1);
  expect(host.textContent).not.toContain("完整来源原文-unknown");
  await paymentSource(data.payments[1].id);
  expect(fact("实际收款人")).toBe("Synthetic collector");
  expect(fact("收款人依据")).toBe("Synthetic receipt basis");
  await paymentSource(data.payments[0].id);
  const source = () => host.querySelector('[role="region"][aria-label="收付款依据"]')!;
  expect(host.querySelectorAll('[aria-label="收付款依据"]')).toHaveLength(1);
  expect(source().textContent).toContain("完整来源原文-unknown");
  expect(source().textContent).not.toContain("完整来源原文-known");
  expect(fact("内部凭证号")).toBe("SYSTEM-UNKNOWN");
  expect(fact("外部凭证")).toBe("SOURCE-UNKNOWN");
  expect(fact("实际收款人")).toBe("待核对");
  expect(fact("录入账号")).toBe("已记录，见审计详情");
  expect(host.textContent).not.toContain("private-recording-id");
  data.payments[0] = { ...data.payments[0], notes: "Fresh source text" };
  await render({ data });
  expect(source().textContent).toContain("Fresh source text");
  expect(source().textContent).not.toContain("完整来源原文-unknown");
  data.payments = data.payments.slice(1);
  await render({ data });
  expect(host.querySelector('[aria-label="收付款依据"]')).toBeNull();
});

it("preserves the finance deep link and resets tab and selected source when the selected record changes", async () => {
  const data = saleFixture(undefined, "detail", 1);
  data.payments = [payment({ notes: "First record evidence" })];
  await render({ data, initialTab: "finance" });
  expect(host.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe("收付款");
  await paymentSource(data.payments[0].id);
  expect(host.textContent).toContain("First record evidence");
  await tab("历史");
  const nextId = "77777777-7777-4777-8777-777777777777";
  const next = saleFixture(undefined, "detail", 1, nextId);
  next.payments = [];
  await render({ data: next, selectedId: nextId });
  expect(host.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe("概览");
  expect(host.textContent).not.toContain("First record evidence");
  await tab("收付款");
  expect(host.querySelector('[aria-label="收付款依据"]')).toBeNull();
  await render({ data, selectedId: workspaceContract });
  expect(host.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe("概览");
  expect(host.querySelector('[aria-label="收付款依据"]')).toBeNull();
});

it("navigates four sections by keyboard and mounts only genuine supplied history in history", async () => {
  const props = await render({ historyContent: <button>Actual older sale record</button> });
  expect(host.textContent).not.toContain("Actual older sale record");
  const key = async (name: string, value: string) => {
    const button = [...host.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(
      (el) => el.textContent === name,
    )!;
    await act(async () =>
      button.dispatchEvent(new KeyboardEvent("keydown", { key: value, bubbles: true })),
    );
  };
  await key("概览", "End");
  expect(document.activeElement?.textContent).toBe("历史");
  expect(host.textContent).toContain("Actual older sale record");
  expect(host.textContent).toContain("不是完整变更审计");
  const active = host.querySelector('[role="tab"][aria-selected="true"]')!;
  expect(host.querySelector('[role="tabpanel"]')?.id).toBe(active.getAttribute("aria-controls"));
  await key("历史", "ArrowLeft");
  expect(document.activeElement?.textContent).toBe("资料");
  expect(host.textContent).not.toContain("Actual older sale record");
  await key("资料", "Home");
  expect(document.activeElement?.textContent).toBe("概览");
  expect(props.onAction).not.toHaveBeenCalled();
  expect(props.onPrint).not.toHaveBeenCalled();
});

it("keeps gross purchase receipts and explicit refunds separate without deriving a new balance or net price", async () => {
  const data = saleFixture(undefined, "detail", 1);
  data.payments = [
    payment({ amount: 1000000 }),
    payment({ id: "refund-id", source_type: "sale_refund", amount: 1000000 }),
    payment({ id: "receipt-again", amount: 1000000 }),
  ];
  await render({ data });
  expect(fact("累计房款入款")).toBe("2,000,000 XOF");
  expect(fact("已录房款退款")).toBe("1,000,000 XOF");
  expect(fact("已核未收")).toBe("800,000 XOF");
  expect(fact("净收房款")).toBeUndefined();
  await tab("收付款");
  expect(host.querySelector('[data-sale-payment-id="refund-id"]')?.textContent).toContain(
    "− 1,000,000 XOF",
  );
  expect(host.querySelectorAll("[data-sale-payment-id]")).toHaveLength(3);
});
