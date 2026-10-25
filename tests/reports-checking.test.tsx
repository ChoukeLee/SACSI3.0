// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ReportsView } from "@/features/reports/reports-view";
import { reportExportHref, type ReportWorkspaceData } from "@/features/reports/report-read";

const projectId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const cimacId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const entryId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

function fixture(kind: "ledger" | "receivables" = "ledger"): ReportWorkspaceData {
  const query = {
    kind,
    projectId,
    month: "2026-10",
    page: 1,
    search: "",
    direction: "",
    management: "managed" as const,
    outstandingOnly: false,
  };
  return {
    query,
    projects: [
      { id: projectId, code: "SACSI", display_name: "SACSI" },
      { id: cimacId, code: "CIMAC", display_name: "CIMAC" },
    ],
    result: {
      kind,
      page: 1,
      pageSize: 50,
      total: 1,
      summary:
        kind === "ledger"
          ? { income: 100.25, expense: 20, liability_in: 700, liability_out: 200 }
          : { receivable: 100.25, paid: 20, outstanding: 80.25, overdue: 30 },
      rows:
        kind === "ledger"
          ? [
              {
                id: entryId,
                payment_id: null,
                entry_date: "2026-10-18",
                building_label: "Synthetic building",
                unit_label: "408",
                direction: "income",
                category: "lease_rent",
                amount_xof: 100.25,
                amount_cny: null,
                description: "Explicit receipt evidence",
              },
            ]
          : [
              {
                id: entryId,
                due_date: "2020-01-01",
                building_label: "Synthetic building",
                unit_label: "408",
                category: "lease_rent",
                title: "Explicit historical balance",
                amount_xof: 100.25,
                paid_amount_xof: 20,
                status: "partial",
                management_status: "managed",
                source_type: "lease_contract",
                source_id: null,
              },
            ],
    },
    trend:
      kind === "ledger"
        ? [
            { month: "2026-08", income: 200, expense: 0, net: 200 },
            { month: "2026-09", income: 20, expense: 40, net: -20 },
            { month: "2026-10", income: 100.25, expense: 20, net: 80.25 },
          ]
        : [],
    asOf: "2026-10-19",
    exportHref: reportExportHref(query),
  };
}

function render(data = fixture(), locale: "zh" | "fr" = "zh") {
  const root = document.createElement("div");
  root.innerHTML = renderToStaticMarkup(<ReportsView data={data} locale={locale} />);
  return root;
}

describe("financial checking workspace", () => {
  it.each(["zh", "fr"] as const)(
    "keeps CIMAC report filtering, trend links and source inspection inside the independent workspace in %s",
    (locale) => {
      const data = fixture();
      data.workArea = "cimac";
      data.query.projectId = cimacId;
      data.projects = [{ id: cimacId, code: "CIMAC", display_name: "CIMAC" }];
      data.exportHref = reportExportHref(data.query);
      const host = render(data, locale);
      const prefix = locale === "fr" ? "/fr/cimac" : "/cimac";
      expect(host.querySelector("h1")?.textContent).toBe(
        locale === "zh" ? "园区经营分析" : "Analyse du parc",
      );
      for (const form of host.querySelectorAll("form"))
        expect(form.getAttribute("action")).toBe(`${prefix}/reports`);
      const internal = [...host.querySelectorAll<HTMLAnchorElement>("a")].map((link) =>
        link.getAttribute("href")!,
      );
      expect(internal.some((href) => href.startsWith(`${prefix}/finance?`))).toBe(true);
      expect(internal.some((href) => href.startsWith(`${prefix}/reports?`))).toBe(true);
      expect(
        internal.every(
          (href) => href.startsWith(prefix) || href.startsWith("/api/reports/export?"),
        ),
      ).toBe(true);
      expect(host.textContent).not.toContain(
        locale === "zh" ? "日租收款专题" : "Encaissements courts séjours",
      );
    },
  );
  it.each(["zh", "fr"] as const)(
    "keeps one localized native disclosure after report metrics in %s without changing XOF totals or trend",
    (locale) => {
      const data = fixture();
      data.result.nativeSummary = [
        {
          currency: "USD",
          income: -250,
          expense: 0,
          liability_in: 0,
          liability_out: 0,
          receivable: 0,
          paid: 0,
          outstanding: 0,
          overdue: 0,
        },
      ];
      const root = render(data, locale);
      const panels = root.querySelectorAll<HTMLDetailsElement>(
        "details[data-native-currency-summary]",
      );
      expect(panels).toHaveLength(1);
      const panel = panels[0];
      expect(panel.open).toBe(false);
      expect(panel.dataset.nativeCurrencySummary).toBe("ledger");
      expect(panel.previousElementSibling?.textContent).toContain(
        locale === "zh" ? "登记净额" : "Solde inscrit",
      );
      expect(panel.querySelector("summary")?.textContent).toContain(
        locale === "zh" ? "其他币种" : "Autres devises",
      );
      expect(panel.querySelector("summary")?.textContent).toContain("-250");
      expect(panel.previousElementSibling?.textContent).toContain(
        locale === "zh" ? "80.25" : "80,25",
      );
      expect(panel.previousElementSibling?.textContent).not.toContain("-250");
      const trend = root.querySelector(
        'section[aria-label="项目登记净额趋势"], section[aria-label="Tendance du solde inscrit"]',
      );
      expect(trend).not.toBeNull();
      expect(trend!.textContent).not.toContain("USD");
      expect(trend!.textContent).not.toContain("-250");
    },
  );
  it("retains fully settled native receivables in collapsed report details instead of treating zero debt as no history", () => {
    const data = fixture("receivables");
    data.result.nativeSummary = [
      {
        currency: "USD",
        income: 0,
        expense: 0,
        liability_in: 0,
        liability_out: 0,
        receivable: 19200,
        paid: 19200,
        outstanding: 0,
        overdue: 0,
      },
    ];
    const root = render(data);
    const panel = root.querySelector<HTMLDetailsElement>(
      'details[data-native-currency-summary="receivables"]',
    )!;
    expect(panel.open).toBe(false);
    expect(panel.previousElementSibling?.textContent).toContain("管理应收未收");
    expect(panel.querySelector("summary")?.textContent).toContain("19,200");
    expect(panel.querySelector("summary")?.textContent).not.toContain("$0");
    expect(panel.querySelectorAll("dd")).toHaveLength(4);
    expect(panel.textContent).toContain("已核销");
    expect(panel.textContent).toContain("不折算或并入 XOF 合计");
  });
  it("draws negative trend values below the same zero axis as positive values", () => {
    const root = render();
    const positive = root.querySelector<HTMLElement>('a[aria-label="2026-08 · 200 XOF"] > span');
    const negative = root.querySelector<HTMLElement>('a[aria-label="2026-09 · -20 XOF"] > span');
    expect(positive?.style.bottom).toMatch(/%$/);
    expect(positive?.style.top).toBe("auto");
    expect(negative?.style.top).toMatch(/%$/);
    expect(negative?.style.bottom).toBe("auto");
    expect(parseFloat(positive!.style.bottom) + parseFloat(negative!.style.top)).toBeCloseTo(100);
  });

  it("distinguishes an out-of-range empty page from an empty filtered result", () => {
    const data = fixture();
    data.query.page = 999;
    data.result.page = 999;
    data.result.rows = [];
    const root = render(data);
    expect(root.textContent).toContain("当前页无记录");
    const firstPage = root.querySelector<HTMLAnchorElement>('a[href*="page=1"]');
    expect(firstPage).not.toBeNull();
    expect(root.textContent).toContain("返回第一页");
  });

  it("uses a detail-first, explicitly read-only workspace with a source inspector", () => {
    const root = render();
    expect(root.querySelector("h1")?.textContent).toBe("财务核查台");
    expect(root.querySelector("table")).not.toBeNull();
    expect(root.textContent).toContain("只读核查");
    expect(root.textContent).toContain("不等于实际现金流或会计利润");
    expect(root.textContent).toContain("押金 / 负债不计入上述净额");
    expect(root.querySelector('button[aria-pressed="true"]')).not.toBeNull();
    for (const button of root.querySelectorAll("button")) {
      expect(button.textContent).not.toMatch(/修改|确认入账|保存|删除|退款/);
    }
    expect(root.querySelectorAll('form[method="post"]')).toHaveLength(0);
  });

  it.each(["zh", "fr"] as const)(
    "preserves exact financial amounts in %s instead of rounding cents away",
    (locale) => {
      const root = render(fixture(), locale);
      const decimal = locale === "zh" ? "." : ",";
      expect(root.textContent).toContain(`100${decimal}25`);
      expect(root.textContent).toContain(`80${decimal}25`);
    },
  );

  it("separates projects and removes the daily-rental shortcut for CIMAC", () => {
    const data = fixture();
    let root = render(data);
    expect(root.querySelector('a[href="/daily-rentals/receipts"]')).not.toBeNull();
    const cimacLink = root.querySelector<HTMLAnchorElement>(`a[href*="projectId=${cimacId}"]`);
    expect(cimacLink).not.toBeNull();
    expect(cimacLink?.textContent).toContain("CIMAC");
    data.query.projectId = cimacId;
    root = render(data);
    expect(root.querySelector('a[href="/daily-rentals/receipts"]')).toBeNull();
    expect(
      root.querySelector('nav[aria-label="核查项目"] a[aria-current="page"]')?.textContent,
    ).toContain("CIMAC");
  });

  it("does not render a month control or trend for current receivables", () => {
    const data = fixture("receivables");
    data.query.month = "2020-01";
    const root = render(data);
    expect(root.querySelector('input[type="month"]')).toBeNull();
    expect(root.querySelector('section[aria-label="项目登记净额趋势"]')).toBeNull();
    expect(root.textContent).toContain("当前快照");
    expect(root.textContent).toContain("2026-10-19");
    expect(root.textContent).toContain("不是所选月份的月末余额");
    expect(root.textContent).toContain("不跨记录冲抵");
  });

  it.each(["historical_pending", "excluded"] as const)(
    "does not turn %s into a managed debt total",
    (management) => {
      const data = fixture("receivables");
      data.query.management = management;
      data.result.summary = { receivable: 0, paid: 0, outstanding: 0, overdue: 0 };
      data.result.rows[0].management_status = management;
      const root = render(data);
      expect(root.textContent).toContain("独立核查范围");
      expect(root.textContent).toContain("不能将其视为新增欠款");
      expect(root.textContent).not.toContain("管理应收未收");
      expect(root.textContent).not.toContain("其中已逾期");
      expect(
        root.querySelector('select[name="management"] option:checked')?.getAttribute("value"),
      ).toBe(management);
    },
  );

  it("keeps summary server-wide, month and search scopes clear and pagination filter-preserving", () => {
    const data = fixture();
    data.query.page = 2;
    data.query.search = "408";
    data.query.direction = "income";
    data.result.page = 2;
    data.result.total = 101;
    data.result.summary.income = 123456.25;
    data.exportHref = reportExportHref(data.query);
    const root = render(data);
    expect(root.textContent).toContain("123,456.25");
    expect(root.textContent).toContain("不随下方搜索或方向筛选变化");
    expect(root.textContent).toContain("导出包含完整筛选结果，不仅是当前页");
    const next = root.querySelector<HTMLAnchorElement>('a[aria-label="下一页"]');
    const params = new URL(next!.getAttribute("href")!, "https://sacsi.example").searchParams;
    expect(Object.fromEntries(params)).toMatchObject({
      projectId,
      month: "2026-10",
      search: "408",
      direction: "income",
      page: "3",
    });
    expect(root.querySelector<HTMLInputElement>('input[name="search"]')?.value).toBe("408");
    const exportLink = root.querySelector<HTMLAnchorElement>('a[href^="/api/reports/export"]');
    const exported = new URL(exportLink!.getAttribute("href")!, "https://sacsi.example")
      .searchParams;
    expect(exported.get("projectId")).toBe(projectId);
    expect(exported.get("search")).toBe("408");
    expect(exported.get("locale")).toBe("zh");
  });

  it("localizes French labels and navigational routes without leaking raw category codes", () => {
    const root = render(fixture(), "fr");
    expect(root.querySelector("h1")?.textContent).toBe("Contrôle financier");
    expect(root.textContent).toContain("Loyer longue durée");
    expect(root.textContent).toContain("Lecture seule");
    expect(root.textContent).not.toContain("lease_rent");
    expect(root.querySelector('form[action="/fr/reports"]')).not.toBeNull();
    expect(root.querySelector('a[href="/fr/daily-rentals/receipts"]')).not.toBeNull();
    for (const link of root.querySelectorAll<HTMLAnchorElement>('a[href*="/reports?"]')) {
      expect(link.getAttribute("href")).toMatch(/^\/fr\/reports\?/);
    }
    expect(root.querySelector('a[href^="/api/reports/export"]')?.getAttribute("href")).toContain(
      "locale=fr",
    );
  });

  it("treats an empty filtered page as unknown settlement rather than zero debt", () => {
    const data = fixture();
    data.result.total = 0;
    data.result.rows = [];
    data.result.summary = { income: 0, expense: 0, liability_in: 0, liability_out: 0 };
    const root = render(data);
    expect(root.querySelector("table")).toBeNull();
    expect(root.textContent).toContain("没有匹配记录");
    expect(root.textContent).toContain("无记录不代表已结清");
    expect(root.querySelector('button[aria-pressed="true"]')).toBeNull();
  });

  it("renders negative expense corrections with one unambiguous sign", () => {
    const data = fixture();
    data.result.rows[0].direction = "expense";
    data.result.rows[0].amount_xof = -20.25;
    const root = render(data);
    const amount = root.querySelector("tbody tr td:nth-child(3) strong")?.textContent;
    expect(amount).toBe("-20.25");
    expect(amount).not.toContain("−-");
  });

  it("does not present a cancelled receivable as an amount still owed", () => {
    const data = fixture("receivables");
    data.result.rows[0].status = "cancelled";
    const root = render(data);
    expect(root.querySelector("tbody tr td:nth-child(3) strong")?.textContent).toBe("—");
    expect(root.textContent).toContain("已取消");
    expect(root.querySelector('aside[aria-label="选中记录来源"]')?.textContent).toContain("100.25");
    expect(root.querySelector('aside[aria-label="选中记录来源"]')?.textContent).toContain(
      "所选应收原额，并非未收余额",
    );
  });
});

describe("selected financial source retrieval", () => {
  const paymentA = "11111111-1111-4111-8111-111111111111";
  const paymentB = "22222222-2222-4222-8222-222222222222";
  const context = (paymentId: string, recordedByName = "Explicit recorder") => ({
    paymentId,
    paymentDate: "2026-10-18",
    amount: 12.25,
    currency: "CNY",
    recordedBy: projectId,
    recordedByName,
    actualCollector: null,
    collectorBasis: null,
    version: 0,
    token: "a".repeat(32),
    confirmedBy: null,
    confirmedAt: null,
    allocatedXof: 100.25,
    allocations: [],
  });
  const response = (data: unknown, ok = true) => ({ ok, json: async () => data });
  const hosts: { host: HTMLDivElement; unmount: () => void }[] = [];
  const fetchMock = vi.fn();

  async function mount(data: ReportWorkspaceData) {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("fetch", fetchMock);
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    hosts.push({ host, unmount: () => root.unmount() });
    await act(async () => root.render(<ReportsView data={data} locale="zh" />));
    return host;
  }

  afterEach(async () => {
    for (const { host, unmount } of hosts.splice(0)) {
      await act(async () => unmount());
      host.remove();
    }
    fetchMock.mockReset();
    vi.unstubAllGlobals();
  });

  it("retrieves original-currency payment facts using GET only without inferring the collector", async () => {
    const data = fixture();
    data.result.rows[0].payment_id = paymentA;
    fetchMock.mockResolvedValue(response(context(paymentA)));
    const host = await mount(data);
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
      `/api/finance/payment-context/${paymentA}`,
      expect.objectContaining({ method: "GET", cache: "no-store", credentials: "same-origin" }),
    );
    const inspector = host.querySelector('aside[aria-label="选中记录来源"]');
    expect(inspector?.textContent).toContain("12.25 CNY");
    expect(inspector?.textContent).toContain("实际收款人尚未确认");
    expect(inspector?.textContent).toContain("账号登记人Explicit recorder");
    expect(inspector?.textContent).not.toContain("a".repeat(32));
    expect(inspector?.querySelector('button[type="submit"]')).toBeNull();
  });

  it("does not issue a payment request for an independent ledger entry", async () => {
    const host = await mount(fixture());
    expect(fetchMock).not.toHaveBeenCalled();
    expect(host.textContent).toContain("没有可核查的关联付款");
  });

  it("rejects a payment context for another record and lets the user retry instead of displaying fake facts", async () => {
    const data = fixture();
    data.result.rows[0].payment_id = paymentA;
    fetchMock
      .mockResolvedValueOnce(response(context(paymentB)))
      .mockResolvedValueOnce(response(context(paymentA)));
    const host = await mount(data);
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("没有用空值或零代替");
    expect(host.textContent).not.toContain("12.25 CNY");
    await act(async () =>
      (host.querySelector('[role="alert"] button') as HTMLButtonElement).click(),
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(host.textContent).toContain("12.25 CNY");
  });

  it("aborts the old source request on row changes while preserving the search and selection", async () => {
    const data = fixture();
    data.query.search = "408";
    data.result.total = 2;
    data.result.rows[0].payment_id = paymentA;
    data.result.rows.push({
      ...data.result.rows[0],
      id: cimacId,
      payment_id: paymentB,
      unit_label: "202",
    });
    let finishOld!: (value: ReturnType<typeof response>) => void;
    fetchMock
      .mockReturnValueOnce(
        new Promise((resolve) => {
          finishOld = resolve;
        }),
      )
      .mockResolvedValueOnce(response(context(paymentB, "Current source")));
    const host = await mount(data);
    const oldSignal = fetchMock.mock.calls[0][1].signal as AbortSignal;
    await act(async () =>
      (host.querySelector('button[aria-label="核查 202 2026-10-18"]') as HTMLButtonElement).click(),
    );
    expect(oldSignal.aborted).toBe(true);
    expect(host.querySelector<HTMLInputElement>('input[name="search"]')?.value).toBe("408");
    expect(host.querySelector('button[aria-pressed="true"]')?.getAttribute("aria-label")).toContain(
      "202",
    );
    expect(host.textContent).toContain("Current source");
    await act(async () => finishOld(response(context(paymentA, "Stale source"))));
    expect(host.textContent).toContain("Current source");
    expect(host.textContent).not.toContain("Stale source");
    expect(fetchMock.mock.calls.every((call) => call[1].method === "GET")).toBe(true);
  });
});
