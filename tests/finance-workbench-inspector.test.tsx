// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  FinanceWorkbenchInspector,
  type FinanceWorkbenchInspectorProps,
} from "@/features/finance/finance-workbench-inspector";
import type { FinanceRecordContext } from "@/features/finance/finance-record-context";

vi.mock("@/features/finance/payment-context-panel", () => ({
  PaymentContextPanel: (props: { paymentId: string; canWrite: boolean }) => (
    <button type="button" data-payment={props.paymentId} data-writable={props.canWrite}>
      付款事实
    </button>
  ),
}));

const recordId = "11111111-1111-4111-8111-111111111111";
const nextId = "22222222-2222-4222-8222-222222222222";
const paymentId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const buildingId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const unitId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const projectId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const customerId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const recorderId = "99999999-9999-4999-8999-999999999999";
const sourceId = "55555555-5555-4555-8555-555555555555";
const context: FinanceRecordContext = {
  kind: "ledger",
  id: recordId,
  amountXof: 3600000,
  date: "2026-10-18",
  category: "lease_rent",
  direction: "income",
  title: "Synthetic six-month rent",
  paidAmountXof: null,
  status: null,
  managementStatus: null,
  paymentId,
  paymentMethod: "bank_transfer",
  building: { id: buildingId, label: "测试第三栋", projectId },
  unit: { id: unitId, label: "测试铺位 A" },
  customer: { id: customerId, label: "测试客户" },
  source: {
    type: "lease_contract",
    id: sourceId,
    label: "TEST-CONTRACT-001",
    href: `/leases?project=${projectId}`,
    linkKind: "workspace",
  },
  period: null,
};
const payment = {
  paymentId,
  unitId,
  buildingId,
  paymentDate: "2026-10-17",
  amount: 384,
  currency: "CNY",
  recordedBy: recorderId,
  recordedByName: "测试录入账号",
  actualCollector: "测试实际收款人",
  collectorBasis: "Synthetic receipt TEST-001",
  version: 0,
  token: "a".repeat(32),
  confirmedBy: null,
  confirmedAt: null,
  allocatedXof: 3840000,
  allocations: [
    {
      receivableId: "44444444-4444-4444-8444-444444444444",
      title: "测试租金分账",
      dueDate: "2026-10-01",
      allocatedXof: 3600000,
      periodStart: "2026-10-01",
      periodEnd: "2027-03-31",
      periodSource: "Synthetic receipt period",
      token: "b".repeat(32),
    },
    {
      receivableId: "66666666-6666-4666-8666-666666666666",
      title: "测试物业分账",
      dueDate: "2026-10-01",
      allocatedXof: 240000,
      periodStart: null,
      periodEnd: null,
      periodSource: null,
      token: "c".repeat(32),
    },
  ],
};
const row = { id: recordId, payment_id: paymentId, amount_xof: 3600000 };
const response = (data: unknown, ok = true) => ({ ok, json: async () => data });
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
const fetchMock = vi.fn();
let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url: string) =>
    response(url.includes("/payment-context/") ? payment : context),
  );
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
async function render(overrides: Partial<FinanceWorkbenchInspectorProps> = {}) {
  await act(async () =>
    root.render(
      <FinanceWorkbenchInspector
        row={row}
        kind="ledger"
        locale="zh"
        canWrite={false}
        scopeKey="project-A/all/current/page-1"
        {...overrides}
      />,
    ),
  );
}
function fact(label: string) {
  return [...host.querySelectorAll("dt")].find((item) => item.textContent === label)
    ?.nextElementSibling?.textContent;
}
async function click(label: string) {
  const button = [...host.querySelectorAll<HTMLButtonElement>("button")].find(
    (item) => item.textContent === label,
  );
  if (!button) throw new Error(`Missing button: ${label}`);
  await act(async () => button.click());
}

describe("FinanceWorkbenchInspector selected-record facts", () => {
  it.each(["zh", "fr"] as const)(
    "keeps protected customer collection facts read-only in %s without a single-unit operation link",
    async (locale) => {
      fetchMock.mockImplementation(async (url: string) =>
        response(
          url.includes("/payment-context/")
            ? { ...payment, unitId: null, buildingId: null }
            : {
                ...context,
                source: {
                  type: "cimac_customer_collection",
                  id: customerId,
                  label: "TEST-CONTRACT-001",
                  href: null,
                  linkKind: null,
                },
              },
        ),
      );
      await render({ canWrite: true, locale });
      expect(host.querySelector("button[data-payment]")?.getAttribute("data-writable")).toBe(
        "false",
      );
      expect(host.textContent).toContain(
        locale === "zh"
          ? "请从客户总账的原收款区分办理实际退款与错误冲正"
          : "Ouvrez le reçu d’origine dans le compte client",
      );
      expect(host.querySelector("a")?.getAttribute("href")).toBe(
        `${locale === "fr" ? "/fr" : ""}/finance?view=customers&customerId=${customerId}&tab=receipts`,
      );
    },
  );
  it.each(["cimac_customer_refund", "cimac_customer_reversal"])(
    "keeps %s protected from legacy mutation and links the verified customer instead of the source payment ID",
    async (sourceType) => {
      fetchMock.mockImplementation(async (url: string) =>
        response(
          url.includes("/payment-context/")
            ? { ...payment, unitId: null, buildingId: null }
            : {
                ...context,
                source: {
                  type: sourceType,
                  id: sourceId,
                  label: "Original customer receipt correction",
                  href: null,
                  linkKind: null,
                },
              },
        ),
      );
      await render({ canWrite: true });
      expect(host.querySelector("button[data-payment]")?.getAttribute("data-writable")).toBe(
        "false",
      );
      expect(host.querySelector("a")?.getAttribute("href")).toContain(`customerId=${customerId}`);
      expect(host.querySelector("a")?.getAttribute("href")).not.toContain(`customerId=${sourceId}`);
      expect(host.textContent).not.toContain("客户级更正流程尚未开放");
    },
  );
  it("does not fetch or invent amounts before a row is selected", async () => {
    await render({ row: null });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(host.querySelector('aside[aria-label="账目详情"]')).not.toBeNull();
    expect(host.textContent).toContain("选择一笔账目");
    expect(host.textContent).not.toContain("XOF");
    expect(host.querySelector("button")).toBeNull();
  });

  it("starts a known payment and record read in parallel, with no cache or writes", async () => {
    const pending = deferred<ReturnType<typeof response>>();
    fetchMock.mockReturnValue(pending.promise);
    await render();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual(
      expect.arrayContaining([
        `/api/finance/payment-context/${paymentId}`,
        `/api/finance/record-context?kind=ledger&id=${recordId}`,
      ]),
    );
    for (const [, options] of fetchMock.mock.calls) {
      expect(options).toMatchObject({ cache: "no-store", credentials: "same-origin" });
      expect(options.signal).toBeInstanceOf(AbortSignal);
      expect(options.method).toBeUndefined();
    }
    expect(host.querySelector('aside[aria-busy="true"]')).not.toBeNull();
    expect(host.querySelector('[role="status"]')?.textContent).toContain("正在读取实时账目");
    expect(host.textContent).not.toContain("3,600,000");
    expect(host.textContent).not.toContain("测试实际收款人");
  });

  it("separates an XOF entry, original-currency payment total, allocation and dates", async () => {
    await render();
    expect(host.querySelector("header")?.textContent).toContain("3,600,000 XOF");
    expect(fact("关联付款原币合计")).toBe("384 CNY");
    expect(fact("流水日期")).toBe("2026-10-18");
    expect(fact("付款日期")).toBe("2026-10-17");
    expect(fact("付款方式")).toBe("银行转账");
    expect(host.textContent).toContain("240,000 XOF");
    expect(host.textContent).toContain("2026-10-01 → 2027-03-31");
    expect(host.textContent).not.toContain("384 XOF");
    expect(host.textContent).toContain("不直接比较不同币种");
    expect(host.querySelector("button[data-payment]")?.getAttribute("data-writable")).toBe("false");
  });

  it("keeps actual collector distinct from the recording identity and does not guess unknown facts", async () => {
    await render();
    expect(fact("实际收款人")).toBe("测试实际收款人");
    expect(fact("录入账号")).toBe("测试录入账号");
    fetchMock.mockImplementation(async (url: string) =>
      response(
        url.includes("/payment-context/")
          ? { ...payment, actualCollector: null, collectorBasis: null, recordedByName: null }
          : context,
      ),
    );
    await click("刷新详情");
    expect(fact("实际收款人")).toBe("待核对");
    expect(fact("录入账号")).toBe("已记录账号身份（姓名待核）");
    expect(host.textContent).not.toContain(recorderId);
    expect(fact("收款人依据")).toBeUndefined();
  });

  it("keeps historical missing recording identity explicit rather than borrowing an operator", async () => {
    fetchMock.mockImplementation(async (url: string) =>
      response(
        url.includes("/payment-context/")
          ? { ...payment, recordedBy: null, recordedByName: null, actualCollector: null }
          : context,
      ),
    );
    await render({ canWrite: true });
    expect(fact("录入账号")).toBe("历史未记录");
    expect(fact("实际收款人")).toBe("待核对");
    expect(host.querySelector("button[data-payment]")?.getAttribute("data-writable")).toBe("true");
  });

  it("does not describe deposit entries as operating income or refundable balances", async () => {
    fetchMock.mockImplementation(async (url: string) =>
      response(
        url.includes("/payment-context/")
          ? payment
          : { ...context, category: "lease_deposit", direction: "liability_in" },
      ),
    );
    await render();
    expect(host.textContent).toContain("押金为独立负债口径，不计作经营收入");
    expect(host.textContent).toContain("不代表当前可退押金余额");
    expect(host.querySelector("header")?.textContent).toContain("负债流入");
  });

  it("explicitly identifies a non-cash offset rather than calling its payment a cash receipt", async () => {
    fetchMock.mockImplementation(async (url: string) =>
      response(
        url.includes("/payment-context/") ? payment : { ...context, paymentMethod: "offset" },
      ),
    );
    await render();
    expect(fact("付款方式")).toBe("非现金抵扣");
    expect(host.textContent).toContain("不计为现金实收");
    expect(host.textContent).not.toContain("已录现金");
  });

  it("does not infer allocation periods from the due date or invent a history link", async () => {
    fetchMock.mockImplementation(async (url: string) =>
      response(
        url.includes("/payment-context/")
          ? { ...payment, allocations: [], allocatedXof: 0 }
          : context,
      ),
    );
    await render();
    expect(host.textContent).toContain("尚无明确分配关系");
    expect(host.textContent).not.toContain("2026-10-01 →");
    expect([...host.querySelectorAll("dd")].map((item) => item.textContent)).not.toContain("0 XOF");
  });

  it("shows unlinked ledger entries without a fictional payment request or zero amount", async () => {
    fetchMock.mockResolvedValue(
      response({ ...context, paymentId: null, paymentMethod: null, source: null }),
    );
    await render({ row: { id: recordId } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain("没有明确关联付款");
    expect(host.textContent).toContain("尚无可核验的业务来源");
    expect([...host.querySelectorAll("dd")].map((item) => item.textContent)).not.toContain("0 XOF");
    expect(host.querySelector("button[data-payment]")).toBeNull();
    expect(host.querySelector("a")).toBeNull();
  });

  it("loads a server-confirmed payment when the selected list row lacks its ID", async () => {
    await render({ row: { id: recordId } });
    expect(fetchMock.mock.calls[0][0]).toContain("/record-context?");
    expect(fetchMock.mock.calls[1][0]).toBe(`/api/finance/payment-context/${paymentId}`);
    expect(fact("实际收款人")).toBe("测试实际收款人");
  });

  it("reads receivables without inferring payment cash and preserves an end-only period", async () => {
    fetchMock.mockResolvedValue(
      response({
        ...context,
        kind: "receivables",
        direction: null,
        paidAmountXof: 600000,
        status: "partial",
        managementStatus: "historical_pending",
        paymentId: null,
        paymentMethod: null,
        period: { start: null, end: "2027-03-31", source: "Explicit end only" },
      }),
    );
    await render({ kind: "receivables", row: { id: recordId } });
    expect(fact("应收已核销")).toBe("600,000 XOF");
    expect(fact("管理范围")).toBe("历史待核对");
    expect(fact("服务账期")).toBe("开始待核 → 2027-03-31");
    expect(fact("账期依据")).toBe("Explicit end only");
    expect(host.textContent).toContain("不从应收已核销金额倒推付款");
    expect(host.textContent).not.toContain("2026-10-18 →");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("localizes the French source workspace link without promising a direct contract open", async () => {
    await render({ locale: "fr" });
    expect(host.querySelector('aside[aria-label="Détail de l\'écriture"]')).not.toBeNull();
    expect(host.querySelector("a")?.getAttribute("href")).toBe(`/fr/leases?project=${projectId}`);
    expect(host.querySelector("a")?.textContent).toContain("Ouvrir l'espace source");
    expect(host.textContent).toContain("ne s'ouvre pas automatiquement");
    expect(host.textContent).toContain("384 CNY");
    expect(fact("Encaisseur réel")).toBe("测试实际收款人");
  });

  it("fails closed for a malformed record response and never falls back to list amounts", async () => {
    fetchMock.mockImplementation(async (url: string) =>
      response(url.includes("/payment-context/") ? payment : { ...context, amountXof: null }),
    );
    await render();
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("暂时无法核验");
    expect(host.textContent).not.toContain("3,600,000");
    expect(host.textContent).not.toContain("测试实际收款人");
    expect(host.textContent).not.toContain("0 XOF");
  });

  it("uses freshly verified record amounts and dates rather than stale selected-list values", async () => {
    fetchMock.mockImplementation(async (url: string) =>
      response(
        url.includes("/payment-context/")
          ? payment
          : { ...context, amountXof: 3700000, date: "2026-10-19", title: "Fresh record fact" },
      ),
    );
    await render({
      row: {
        ...row,
        amount_xof: 3600000,
        entry_date: "2026-10-18",
        description: "Stale list label",
      },
    });
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(host.querySelector("header")?.textContent).toContain("3,700,000 XOF");
    expect(fact("流水日期")).toBe("2026-10-19");
    expect(fact("事项")).toBe("Fresh record fact");
    expect(host.querySelector("header")?.textContent).not.toContain("3,600,000 XOF");
    expect(host.textContent).not.toContain("Stale list label");
  });

  it.each([
    `/leases?project=${nextId}`,
    `/sales?project=${projectId}`,
    "https://example.invalid/leases",
  ])("rejects a source workspace URL unrelated to the verified record: %s", async (href) => {
    fetchMock.mockImplementation(async (url: string) =>
      response(
        url.includes("/payment-context/")
          ? payment
          : { ...context, source: { ...context.source, href } },
      ),
    );
    await render();
    expect(host.querySelector('[role="alert"]')).not.toBeNull();
    expect(host.querySelector("a")).toBeNull();
    expect(host.querySelector("button[data-payment]")).toBeNull();
  });

  it.each([
    ["record ID", { ...context, id: nextId }, payment],
    ["payment ID", context, { ...payment, paymentId: nextId }],
    ["record payment link", { ...context, paymentId: nextId }, payment],
    ["unit", context, { ...payment, unitId: nextId }],
    ["building", context, { ...payment, buildingId: nextId }],
  ])(
    "rejects a mismatched %s instead of combining unrelated facts",
    async (_name, record, paymentData) => {
      fetchMock.mockImplementation(async (url: string) =>
        response(url.includes("/payment-context/") ? paymentData : record),
      );
      await render();
      expect(host.querySelector('[role="alert"]')).not.toBeNull();
      expect(host.textContent).not.toContain("3,600,000");
      expect(host.querySelector("button[data-payment]")).toBeNull();
    },
  );

  it("rejects an invalid selected ID before making any API read", async () => {
    await render({ row: { id: "bad-id" } });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(host.querySelector('[role="alert"]')).not.toBeNull();
  });

  it("retries a failed read and never keeps an old amount on subsequent refresh failure", async () => {
    fetchMock.mockResolvedValue(response({}, false));
    await render();
    expect(host.querySelector('[role="alert"]')).not.toBeNull();
    fetchMock.mockImplementation(async (url: string) =>
      response(url.includes("/payment-context/") ? payment : context),
    );
    await click("重新读取");
    expect(fact("实际收款人")).toBe("测试实际收款人");
    fetchMock.mockResolvedValue(response({}, false));
    await click("刷新详情");
    expect(host.querySelector('[role="alert"]')).not.toBeNull();
    expect(host.textContent).not.toContain("3,600,000");
    expect(host.textContent).not.toContain("测试实际收款人");
  });

  it("re-reads the same ID explicitly, clearing the former facts before the refresh resolves", async () => {
    await render();
    const pending = deferred<ReturnType<typeof response>>();
    fetchMock.mockReturnValue(pending.promise);
    await click("刷新详情");
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(host.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(host.textContent).not.toContain("测试实际收款人");
    expect(host.textContent).not.toContain("3,600,000");
  });

  it("aborts an earlier project read and ignores late responses after switching scope", async () => {
    const oldRecord = deferred<ReturnType<typeof response>>();
    const oldPayment = deferred<ReturnType<typeof response>>();
    fetchMock.mockImplementation((url: string) =>
      url.includes("/payment-context/") ? oldPayment.promise : oldRecord.promise,
    );
    await render();
    const signals = fetchMock.mock.calls.map(([, options]) => options.signal as AbortSignal);
    fetchMock.mockResolvedValue(response({}, false));
    await render({ scopeKey: "project-B/all/current/page-1" });
    expect(signals.every((signal) => signal.aborted)).toBe(true);
    await act(async () => {
      oldRecord.resolve(response(context));
      oldPayment.resolve(response(payment));
    });
    expect(host.querySelector('[role="alert"]')).not.toBeNull();
    expect(host.textContent).not.toContain("测试实际收款人");
    expect(host.textContent).not.toContain("3,600,000");
  });

  it("re-reads the same record after deselection and cannot reuse a stale response", async () => {
    const oldRecord = deferred<ReturnType<typeof response>>();
    fetchMock.mockImplementation((url: string) =>
      url.includes("/payment-context/") ? Promise.resolve(response(payment)) : oldRecord.promise,
    );
    await render();
    await render({ row: null });
    fetchMock.mockImplementation(async (url: string) =>
      response(
        url.includes("/payment-context/")
          ? { ...payment, actualCollector: "新核实收款人" }
          : context,
      ),
    );
    await render();
    expect(fact("实际收款人")).toBe("新核实收款人");
    await act(async () => oldRecord.resolve(response(context)));
    expect(fact("实际收款人")).toBe("新核实收款人");
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("does not start a discovered payment read after its record selection was closed", async () => {
    const oldRecord = deferred<ReturnType<typeof response>>();
    fetchMock.mockReturnValue(oldRecord.promise);
    await render({ row: { id: recordId } });
    await render({ row: null });
    await act(async () => oldRecord.resolve(response(context)));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain("选择一笔账目");
    expect(host.textContent).not.toContain("测试实际收款人");
  });
});
