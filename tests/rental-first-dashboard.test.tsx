// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it } from "vitest";
import {
  RentalFirstDashboard,
  type RentalHomeCash,
  type RentalHomeData,
} from "@/features/management/rental-first-dashboard";
import type { UnifiedLeaseCollectionRow } from "@/features/leases/unified-lease-collections-model";

const projectId = "11111111-1111-4111-8111-111111111111";
const today = "2026-11-11";
const cash: RentalHomeCash = {
  rentIncomeXof: 650000,
  expenseXof: 2620000,
  unknownBookedCount: 0,
  costCoverageComplete: false,
  rentCount: 1,
  expenseCount: 2,
  originals: [
    { currency: "XOF", income: 650000, expense: 2620000 },
    { currency: "CNY", income: 32515, expense: 0 },
  ],
};

function row(
  id: string,
  patch: Partial<UnifiedLeaseCollectionRow> = {},
): UnifiedLeaseCollectionRow {
  return {
    id,
    category: "apartment",
    name: "503",
    group: "6#公寓",
    tenant: "香港怀荣堂",
    keywords: [],
    href: `/leases?contract=${id}`,
    status: "overdue",
    statusLabel: "逾期24天",
    dueDate: "2026-10-18",
    paidThrough: "2026-10-17",
    amount: "84 万西法",
    amountLabel: "逾期未收",
    amountSource: "租金80万西法、物业费4万西法",
    ...patch,
  };
}

function data(patch: Partial<RentalHomeData> = {}): RentalHomeData {
  return {
    rows: [
      row("rent-and-fee"),
      row("native-rent", {
        category: "multi-unit",
        name: "B02",
        group: "孵化园库房",
        tenant: "胡建初",
        amount: "¥32,515",
        dueDate: "2026-11-01",
        statusLabel: "逾期10天",
      }),
      row("upcoming", {
        name: "1201",
        group: "11#公寓",
        tenant: "Kamal",
        status: "upcoming",
        statusLabel: "13天内应缴",
        dueDate: "2026-11-24",
        paidThrough: "2026-11-23",
        amount: "75 万西法",
        amountLabel: "近期应缴",
      }),
    ],
    unavailable: { apartments: false, operatingAssets: false },
    cash,
    month: "2026-11",
    ...patch,
  };
}

const hosts: HTMLDivElement[] = [];
afterEach(() => hosts.splice(0).forEach((host) => host.remove()));

function render(value = data(), options: { locale?: "zh" | "fr"; allowsSale?: boolean } = {}) {
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup(
    <RentalFirstDashboard
      data={value}
      locale={options.locale ?? "zh"}
      today={today}
      projectId={projectId}
      allowsSale={options.allowsSale ?? true}
    />,
  );
  document.body.append(host);
  hosts.push(host);
  return host;
}

function region(host: Element, name: string) {
  const section = host.querySelector<HTMLElement>(`section[aria-label="${name}"]`);
  expect(section).toBeTruthy();
  return section!;
}

function cardFor(host: Element, label: string) {
  const span = [...host.querySelectorAll("span")].find((entry) => entry.textContent === label);
  expect(span).toBeTruthy();
  return span!.parentElement!;
}

it("puts rental collections first, monthly cash second, and sale tails in a closed independent area", () => {
  const host = render();
  const overdue = region(host, "逾期租金");
  const upcoming = region(host, "15天内应缴");
  const monthly = region(host, "月度实际收支");
  const tails = [...host.querySelectorAll("details")].find((entry) =>
    entry.querySelector("summary")?.textContent?.includes("出售尾款"),
  )!;
  expect(overdue.compareDocumentPosition(upcoming) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(upcoming.compareDocumentPosition(monthly) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(monthly.compareDocumentPosition(tails) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(tails.open).toBe(false);
  const saleLink = tails.querySelector<HTMLAnchorElement>("a")!;
  const url = new URL(saleLink.getAttribute("href")!, "https://sacsi.test");
  expect(url.pathname).toBe("/sales");
  expect(url.searchParams.get("saleFollowup")).toBe("unpaid");
  expect(url.searchParams.get("project")).toBe(projectId);
  expect(overdue.textContent).not.toContain("出售");
  expect(upcoming.querySelector('a[href="/leases?contract=upcoming"]')?.textContent).toContain(
    "2026-11-24",
  );
});

it("retains the source amounts and separate currencies, including rental-related property charges", () => {
  const source = data({ cash: null });
  const originalRows = structuredClone(source.rows);
  const host = render(source);
  const overdue = region(host, "逾期租金");
  expect(overdue.querySelectorAll("li")).toHaveLength(2);
  expect(overdue.querySelector('a[href="/leases?contract=rent-and-fee"]')?.textContent).toContain(
    "84 万西法",
  );
  expect(overdue.querySelector('a[href="/leases?contract=native-rent"]')?.textContent).toContain(
    "¥32,515",
  );
  expect(source.rows).toEqual(originalRows);
  expect(host.textContent).toContain("租赁相关费用");
});

it("marks partial collection reads instead of presenting a complete empty or zero dashboard", () => {
  const host = render(
    data({ rows: [], unavailable: { apartments: true, operatingAssets: false }, cash: null }),
  );
  expect(region(host, "逾期租金").textContent).toContain("已读取");
  expect(region(host, "15天内应缴").textContent).toContain("当前已读取范围内");
  expect(host.querySelector('[role="status"]')?.textContent).toContain("部分租赁资料暂不可用");
  expect(host.textContent).not.toContain("当前没有此类租金跟进");
  expect(host.textContent).not.toMatch(/(?<![\d.,])0\s*万西法/);
});

it("shows unavailable cash as unknown, and never fabricates profit from missing costs", () => {
  const host = render(data({ cash: null }));
  const monthly = region(host, "月度实际收支");
  expect(cardFor(monthly, "已录租金实收").textContent).toContain("暂无法读取");
  expect(cardFor(monthly, "已录实际支出").textContent).toContain("暂无法读取");
  expect(monthly.textContent).toContain("不按零收入处理");
  expect(monthly.textContent).not.toMatch(/(?<![\d.,])0\s*万西法/);
  expect(monthly.textContent).toContain("不计算经营收益");
});

it("keeps unknown XOF booking amounts out of a misleading zero cash total", () => {
  const host = render(
    data({
      cash: {
        ...cash,
        rentIncomeXof: 0,
        rentCount: 1,
        unknownBookedCount: 1,
        originals: [{ currency: "CNY", income: 32515, expense: 0 }],
      },
    }),
  );
  const monthly = region(host, "月度实际收支");
  expect(cardFor(monthly, "已录租金实收").textContent).not.toMatch(/(?<![\d.,])0\s*万西法/);
  expect(monthly.textContent).toMatch(/记账额|折算|换算/);
  const originals = [...monthly.querySelectorAll("details")].find((entry) =>
    entry.querySelector("summary")?.textContent?.includes("原币"),
  )!;
  expect(originals.textContent).toContain("32,515");
});

it.each(["zh", "fr"] as const)("keeps %s month navigation and scoped links usable", (locale) => {
  const host = render(data({ month: "2024-02" }), { locale });
  const prefix = locale === "fr" ? "/fr" : "";
  const form = host.querySelector<HTMLFormElement>("form")!;
  expect(form.getAttribute("action")).toBe(`${prefix}/management`);
  expect(form.method).toBe("get");
  expect(form.querySelector<HTMLInputElement>('input[name="project"]')?.value).toBe(projectId);
  expect(form.querySelector<HTMLInputElement>('input[name="month"]')?.value).toBe("2024-02");
  const financeLink = [...host.querySelectorAll<HTMLAnchorElement>("a")].find((entry) =>
    entry.getAttribute("href")?.startsWith(`${prefix}/finance?`),
  )!;
  const url = new URL(financeLink.getAttribute("href")!, "https://sacsi.test");
  expect(url.searchParams.get("projectId")).toBe(projectId);
  expect(url.searchParams.get("dateFrom")).toBe("2024-02-01");
  expect(url.searchParams.get("dateTo")).toBe("2024-02-29");
  expect(
    host.querySelector(
      `a[href="${prefix}/leases?assetCategory=followup#lease-collection-overdue"]`,
    ),
  ).toBeTruthy();
});

it("omits the sale workspace entry when the project does not allow sales", () => {
  const host = render(data(), { allowsSale: false });
  expect(host.textContent).not.toContain("出售尾款");
  expect([...host.querySelectorAll("a")].some((entry) => entry.href.includes("/sales"))).toBe(
    false,
  );
});
