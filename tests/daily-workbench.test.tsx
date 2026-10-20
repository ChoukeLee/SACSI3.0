// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { DailyBookingRow, UnitRow } from "@/types/database";
import type { CalendarWindowData } from "@/features/daily-rentals/calendar-window-model";
import {
  calendarBuilding,
  calendarOtherBuilding,
  calendarWindowFixture,
} from "./fixtures/calendar-window";

const { actionSpy } = vi.hoisted(() => ({ actionSpy: vi.fn() }));
vi.mock("@/features/daily-rentals/daily-workbench-actions", () => ({
  DailyWorkbenchActions: (props: {
    unit: UnitRow | null;
    booking: DailyBookingRow | null;
    date: string;
    checkOut?: string;
    onClose: () => void;
    onChanged: () => void;
  }) => {
    actionSpy(props);
    return (
      <div role="dialog" aria-label="业务操作测试替身">
        <span>{props.booking?.guest_name ?? props.unit?.unit_no}</span>
        <button type="button" onClick={props.onClose}>
          关闭测试操作
        </button>
        <button type="button" onClick={props.onChanged}>
          测试操作已完成
        </button>
      </div>
    );
  },
}));
import { DailyWorkbench } from "@/features/daily-rentals/daily-workbench";

const today = "2026-10-20";
const buildings = [
  { id: calendarBuilding, code: "SACSI11", display_name: "11 号楼" },
  { id: calendarOtherBuilding, code: "SACSI5", display_name: "5 号楼" },
];

function unit(no: string, overrides: Partial<UnitRow> = {}): UnitRow {
  return {
    id: `unit-${no}`,
    building_id: calendarBuilding,
    code: `SACSI11-${no}`,
    unit_no: no,
    floor_label: "1F",
    kind: "apartment",
    status: "available",
    operational_condition: "normal",
    daily_rental_enabled: true,
    area_sqm: null,
    layout: "单间",
    furnishing: null,
    notes: null,
    created_at: "",
    updated_at: "",
    ...overrides,
  };
}

function booking(overrides: Partial<DailyBookingRow> = {}): DailyBookingRow {
  return {
    id: "booking-arrival",
    unit_id: "unit-101",
    customer_id: "legacy-contact",
    booking_agent_id: "agent",
    guest_customer_id: "guest-a",
    guest_name: "待住示例甲",
    check_in: today,
    check_out: "2026-10-23",
    checkout_mode: "fixed",
    actual_check_out: null,
    nightly_price_xof: 40000,
    total_amount_xof: 120000,
    prepaid_amount_xof: 40000,
    billing_status: "prepaid",
    manual_discount_amount_xof: 0,
    manual_discount_reason: null,
    final_amount_xof: null,
    status: "confirmed",
    ota_source: null,
    notes: "只用于测试，不对应真实客户或账款。",
    created_at: "",
    updated_at: "",
    ...overrides,
  };
}

function fixture(overrides: Partial<CalendarWindowData> = {}): CalendarWindowData {
  const units = [unit("101"), unit("102", { status: "daily_occupied" }), unit("103")];
  const bookings = [
    booking(),
    booking({
      id: "booking-inhouse",
      unit_id: "unit-102",
      guest_name: "在住示例乙",
      guest_customer_id: "guest-b",
      check_in: "2026-10-18",
      check_out: "2026-10-21",
      status: "checked_in",
      billing_status: "partially_paid",
    }),
  ];
  return calendarWindowFixture({
    from: today,
    to: "2026-10-27",
    today,
    dailyUnits: units,
    unitLookupUnits: units,
    bookings,
    bookingCount: bookings.length,
    customers: [
      {
        id: "agent",
        name: "经办示例",
        phone: null,
        is_blacklisted: false,
        has_active_lease_contract: false,
        has_active_sale_contract: false,
      },
      {
        id: "guest-a",
        name: "待住示例甲",
        phone: null,
        is_blacklisted: false,
        has_active_lease_contract: false,
        has_active_sale_contract: false,
      },
      {
        id: "guest-b",
        name: "在住示例乙",
        phone: null,
        is_blacklisted: false,
        has_active_lease_contract: false,
        has_active_sale_contract: false,
      },
    ],
    customerCount: 3,
    payments: [
      {
        id: "payment-arrival",
        source_id: "booking-arrival",
        amount: 40000,
        payment_date: today,
        reversal_of_payment_id: null,
        request_kind: null,
      },
    ],
    paymentCount: 1,
    buildingCounts: { [calendarBuilding]: 3, [calendarOtherBuilding]: 1 },
    cleaningTasks: [
      { id: "clean-101", unit_id: "unit-101", daily_booking_id: null, is_completed: false },
    ],
    financeSnapshot: {
      today,
      month: "2026-10",
      cash: null,
      includedPaymentIds: [],
      currentOutstanding: 100,
      monthSettled: 0,
    },
    ...overrides,
  });
}

function requestedWindow(input: RequestInfo | URL) {
  const url = new URL(String(input), "https://local.invalid");
  return {
    buildingId: url.searchParams.get("buildingId")!,
    from: url.searchParams.get("from")!,
    to: url.searchParams.get("to")!,
  };
}

function response(input: RequestInfo | URL, overrides: Partial<CalendarWindowData> = {}) {
  return Response.json(fixture({ ...requestedWindow(input), ...overrides }));
}

let host: HTMLDivElement;
let root: Root;
let scroll: ReturnType<typeof vi.fn>;
let compact = false;
let animationFrames: FrameRequestCallback[];
let mediaChangeListeners: Map<string, Set<() => void>>;
const originalScroll = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollIntoView");
const originalClipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  compact = false;
  animationFrames = [];
  mediaChangeListeners = new Map();
  scroll = vi.fn();
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    value: scroll,
    configurable: true,
  });
  vi.stubGlobal(
    "matchMedia",
    vi.fn((media: string) => ({
      media,
      get matches() {
        return (
          compact &&
          ["(max-width: 600px)", "(max-width: 899px)", "(max-width: 1099px)"].includes(media)
        );
      },
      addEventListener: vi.fn((event: string, listener: () => void) => {
        if (event !== "change") return;
        if (!mediaChangeListeners.has(media)) mediaChangeListeners.set(media, new Set());
        mediaChangeListeners.get(media)!.add(listener);
      }),
      removeEventListener: vi.fn((event: string, listener: () => void) => {
        if (event === "change") mediaChangeListeners.get(media)?.delete(listener);
      }),
    })),
  );
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    animationFrames.push(callback);
    return 1;
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => response(input)),
  );
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  if (originalScroll)
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", originalScroll);
  else Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
  if (originalClipboard) Object.defineProperty(navigator, "clipboard", originalClipboard);
  else Reflect.deleteProperty(navigator, "clipboard");
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

async function render(
  initialWindow = fixture(),
  userRole = "front_desk",
  locale: "zh" | "fr" = "zh",
) {
  await act(async () => {
    root.render(
      <DailyWorkbench
        initialWindow={initialWindow}
        buildings={buildings}
        locale={locale}
        userRole={userRole}
      />,
    );
  });
}

function button(label: string, within: ParentNode = host) {
  return [...within.querySelectorAll("button")].find((node) => node.textContent === label);
}

function task(label: string, within: ParentNode = host) {
  return [...within.querySelectorAll<HTMLButtonElement>("button[aria-controls]")].find((node) =>
    node.textContent?.includes(label),
  );
}

async function click(node: Element | null | undefined) {
  expect(node).toBeTruthy();
  await act(async () => (node as HTMLButtonElement).click());
  await act(async () => {
    for (const callback of animationFrames.splice(0)) callback(0);
  });
}

async function setValue(input: HTMLInputElement | HTMLSelectElement, value: string) {
  await act(async () => {
    const prototype =
      input instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

async function submit(form: HTMLFormElement) {
  await act(async () => {
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}

async function setCompact(next: boolean) {
  await act(async () => {
    compact = next;
    for (const listeners of mediaChangeListeners.values()) {
      for (const listener of listeners) listener();
    }
  });
}

function aside() {
  return host.querySelector('aside[aria-label="订单详情"]');
}

function timeline() {
  return host.querySelector<HTMLElement>('section[aria-label="排房时间轴"]')!;
}

function labelledButton(label: string, within: ParentNode = host) {
  return [...within.querySelectorAll("button")].find(
    (node) => node.getAttribute("aria-label") === label,
  );
}

it("renders SSR and the initial full-width room calendar without a browser fetch, receipt analysis or an action drawer", async () => {
  const html = renderToString(
    <DailyWorkbench
      initialWindow={fixture()}
      buildings={buildings}
      locale="zh"
      userRole="front_desk"
    />,
  );
  expect(html).toContain("日租房态");
  expect(html).toContain("待住示例甲");
  expect(fetch).not.toHaveBeenCalled();
  await render();
  expect(host.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe("房态日历");
  expect(timeline()).toBeTruthy();
  expect(timeline().style.getPropertyValue("--day-count")).toBe("7");
  expect(host.querySelector('section[aria-label="今日运营任务"]')).toBeNull();
  expect(host.querySelector('[aria-label="今日辅助事项"]')?.textContent).toContain("待保洁");
  expect(aside()).toBeNull();
  expect(timeline().parentElement?.className).toContain("stageWide");
  expect(fetch).not.toHaveBeenCalled();
  expect(actionSpy).not.toHaveBeenCalled();
  expect(host.querySelector('[role="dialog"]')).toBeNull();
  expect(host.textContent).not.toContain("同比");
  expect(host.textContent).not.toContain("环比");
  expect(host.textContent).not.toContain("cash");
});

it("selects an in-house order without confusing guest and agent, then passes its stable identity to the action drawer", async () => {
  compact = true;
  await render();
  await click(button("今日事项"));
  await click(button("在住"));
  await click(task("在住示例乙"));
  expect(aside()?.textContent).toContain("在住示例乙");
  expect(aside()?.textContent).toContain("经办示例");
  expect(aside()?.textContent).toContain("不默认相同");
  expect(aside()?.textContent).toContain("不等于已核实应收");
  expect(scroll).toHaveBeenCalledWith({ block: "start", behavior: "smooth" });
  await click(button("办理住宿与收款", aside()!));
  expect(actionSpy).toHaveBeenLastCalledWith(
    expect.objectContaining({
      booking: expect.objectContaining({ id: "booking-inhouse", unit_id: "unit-102" }),
      unit: expect.objectContaining({ id: "unit-102" }),
      date: today,
    }),
  );
  expect(host.querySelector('[role="dialog"]')?.textContent).toContain("在住示例乙");
  expect(fetch).toHaveBeenCalledTimes(2);
});

it("fetches the explicit availability window with no-store and never lists occupied rooms as empty", async () => {
  await render();
  await click(button("查空房"));
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(requestedWindow(vi.mocked(fetch).mock.calls[0][0])).toEqual({
    buildingId: calendarBuilding,
    from: today,
    to: "2026-10-23",
  });
  expect(vi.mocked(fetch).mock.calls[0][1]).toMatchObject({ cache: "no-store" });
  const results = host.querySelector('section[aria-label="空房查询结果"]')!;
  expect(task("103", results)).toBeTruthy();
  expect(task("101", results)).toBeUndefined();
  expect(task("102", results)).toBeUndefined();
  expect(results.querySelector("summary")?.textContent).toBe("不可安排 · 2");
  expect(aside()).toBeNull();
  await click(task("103", results));
  expect(aside()?.textContent).toContain("103");
  const dates = host.querySelectorAll<HTMLInputElement>('input[type="date"]');
  await setValue(dates[0], "2026-10-23");
  await setValue(dates[1], "2026-10-25");
  await submit(host.querySelector("form")!);
  expect(requestedWindow(vi.mocked(fetch).mock.calls.at(-1)![0])).toEqual({
    buildingId: calendarBuilding,
    from: "2026-10-23",
    to: "2026-10-25",
  });
  expect(host.querySelector('section[aria-label="空房查询结果"] summary')?.textContent).toBe(
    "不可安排 · 0",
  );
  expect(host.textContent).toContain("待交接 / 复核");
});

it.each([
  ["2026-10-23", "2026-10-23"],
  ["2026-10-19", "2026-10-22"],
  ["2026-10-20", "2026-12-23"],
])(
  "rejects the invalid availability interval %s to %s without making a request",
  async (from, to) => {
    await render();
    await click(button("查空房"));
    const dates = host.querySelectorAll<HTMLInputElement>('input[type="date"]');
    await setValue(dates[0], from);
    await setValue(dates[1], to);
    await submit(host.querySelector("form")!);
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("最多查询 62 天");
    expect(fetch).toHaveBeenCalledTimes(1);
  },
);

it.each(["transport", "status", "incomplete"])(
  "keeps an unavailable %s window unknown rather than converting it to zero occupancy or empty rooms",
  async (failure) => {
    await render();
    if (failure === "transport") vi.mocked(fetch).mockRejectedValueOnce(new Error("offline"));
    if (failure === "status")
      vi.mocked(fetch).mockResolvedValueOnce(new Response("", { status: 503 }));
    if (failure === "incomplete") {
      vi.mocked(fetch).mockImplementationOnce(async (input) =>
        response(input, { bookingCount: 99 }),
      );
    }
    await click(button("查空房"));
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("房态未知");
    expect(host.querySelector('section[aria-label="空房查询结果"]')).toBeNull();
    expect(aside()).toBeNull();
    expect(host.textContent).not.toContain("此区间暂无可安排房间");
    expect(host.textContent).not.toContain("间当前已就绪");
    expect(host.textContent).not.toContain("待住示例甲");
    expect(host.querySelector('[role="dialog"]')).toBeNull();
  },
);

it("does not relabel a foreign-currency original amount as XOF in the order inspector", async () => {
  const initial = fixture();
  initial.payments = [
    {
      id: "foreign-payment",
      source_id: "booking-arrival",
      amount: 100,
      currency: "CNY",
      exchange_rate_to_xof: 90,
      payment_date: today,
      reversal_of_payment_id: null,
      request_kind: null,
    },
  ];
  initial.paymentCount = 1;
  await render(initial);
  await click(task("待住示例甲", timeline()));
  expect(aside()?.textContent).toContain("含非 XOF 流水或缺少币种/汇率证据");
  expect(aside()?.textContent).not.toContain("100 XOF");
  expect(aside()?.textContent).not.toContain("订单已付记录与收款净额不一致");
  expect(fetch).not.toHaveBeenCalled();
});

it("uses a three-day mobile planning window and keeps history as a separate searchable view", async () => {
  compact = true;
  await render();
  const planning = timeline();
  expect(planning.style.getPropertyValue("--day-count")).toBe("3");
  expect(host.querySelector('[aria-label="日历显示天数"]')).toBeNull();
  expect(requestedWindow(vi.mocked(fetch).mock.calls.at(-1)![0])).toMatchObject({
    from: today,
    to: "2026-10-23",
  });
  await click(task("在住示例乙", planning));
  expect(aside()?.textContent).toContain("在住示例乙");
  await click(host.querySelector('[aria-label="后一段日期"]'));
  expect(requestedWindow(vi.mocked(fetch).mock.calls.at(-1)![0])).toMatchObject({
    from: "2026-10-23",
    to: "2026-10-26",
  });
  await click(button("历史订单"));
  expect(requestedWindow(vi.mocked(fetch).mock.calls.at(-1)![0])).toMatchObject({
    from: "2026-10-01",
    to: "2026-10-21",
  });
  expect(host.querySelector('section[aria-label="排房时间轴"]')).toBeNull();
  const history = host.querySelector('section[aria-label="历史查询结果"]')!;
  expect(task("待住示例甲", history)).toBeTruthy();
  expect(task("在住示例乙", history)).toBeTruthy();
  await setValue(host.querySelector('input[type="search"]')!, "在住示例乙");
  expect(task("待住示例甲", history)).toBeUndefined();
  expect(task("在住示例乙", history)).toBeTruthy();
  expect(actionSpy).not.toHaveBeenCalled();
});

it("hides the previous building's selected facts and open action before its replacement read returns", async () => {
  await render();
  await click(task("待住示例甲", timeline()));
  await click(button("查看保洁与订单", aside()!));
  expect(host.querySelector('[role="dialog"]')).toBeTruthy();
  let complete!: (value: Response) => void;
  vi.mocked(fetch).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  );
  await setValue(host.querySelector("select")!, calendarOtherBuilding);
  expect(host.querySelector('[role="status"]')?.textContent).toContain("正在读取");
  expect(host.textContent).not.toContain("待住示例甲");
  expect(host.textContent).not.toContain("在住示例乙");
  expect(aside()).toBeNull();
  expect(host.querySelector('[role="dialog"]')).toBeNull();
  const otherUnit = unit("201", { building_id: calendarOtherBuilding, code: "SACSI5-201" });
  const otherBooking = booking({
    id: "booking-other",
    unit_id: otherUnit.id,
    guest_name: "他楼住客丙",
  });
  await act(async () => {
    complete(
      response(vi.mocked(fetch).mock.calls.at(-1)![0], {
        dailyUnits: [otherUnit],
        unitLookupUnits: [otherUnit],
        bookings: [otherBooking],
        bookingCount: 1,
        cleaningTasks: [],
        payments: [],
        paymentCount: 0,
      }),
    );
  });
  expect(host.textContent).toContain("他楼住客丙");
  expect(host.textContent).not.toContain("待住示例甲");
  expect(aside()).toBeNull();
  await click(task("他楼住客丙", timeline()));
  expect(aside()?.textContent).toContain("201");
});

it("refreshes after a completed action and hides old balances while that refresh is pending", async () => {
  await render();
  await click(task("待住示例甲", timeline()));
  await click(button("查看保洁与订单", aside()!));
  let complete!: (value: Response) => void;
  vi.mocked(fetch).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  );
  await click(button("测试操作已完成"));
  expect(host.querySelector('[role="dialog"]')).toBeNull();
  expect(host.querySelector('[role="status"]')?.textContent).toContain("正在读取");
  expect(host.textContent).not.toContain("40,000 XOF");
  await act(async () => complete(response(vi.mocked(fetch).mock.calls.at(-1)![0])));
  expect(aside()).toBeNull();
  await click(task("待住示例甲", timeline()));
  expect(aside()?.textContent).toContain("待住示例甲");
  expect(fetch).toHaveBeenCalledTimes(1);
});

it.each([
  ["front_desk", false, false, false],
  ["rental_sales", false, true, false],
  ["finance", true, false, true],
  ["admin", true, true, false],
  ["boss", true, false, true],
])(
  "keeps receipt, creation and read-only entrypoints scoped to the %s role",
  async (role, receipts, create, readOnly) => {
    await render(fixture(), role as string);
    await click(task("待住示例甲", timeline()));
    expect(Boolean(host.querySelector('a[href="/daily-rentals/receipts"]'))).toBe(receipts);
    expect(Boolean(button("新建预订"))).toBe(create);
    expect(Boolean(button("查看订单与收据", aside()!))).toBe(readOnly);
    expect(Boolean(button("查看保洁与订单", aside()!))).toBe(!readOnly);
    expect(actionSpy).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  },
);

it("preserves the French receipt route and translated navigation", async () => {
  await render(fixture(), "finance", "fr");
  expect(host.querySelector('a[href="/fr/daily-rentals/receipts"]')).toBeTruthy();
  expect(host.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe("Calendrier");
  expect(host.textContent).toContain("Locations courtes");
});

it("keeps all rooms visible when a calendar auxiliary item highlights matching rooms", async () => {
  await render();
  const summary = host.querySelector('[aria-label="今日辅助事项"]')!;
  const item = [...summary.querySelectorAll("button")].find((node) =>
    node.textContent?.includes("入住待核"),
  )!;
  expect(summary.querySelectorAll("button")).toHaveLength(4);
  expect(summary.textContent).toContain("当前在住");
  expect(summary.textContent).toContain("离店待核");
  await click(item);
  expect(item.getAttribute("aria-pressed")).toBe("true");
  expect(timeline().querySelectorAll("[data-unit-id]")).toHaveLength(3);
  expect(timeline().querySelector('[data-unit-id="unit-101"]')?.className).toContain(
    "highlightedRoom",
  );
  expect(timeline().querySelector('[data-unit-id="unit-103"]')?.className).not.toContain(
    "highlightedRoom",
  );
  expect(aside()).toBeNull();
  expect(actionSpy).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
  await click(item);
  expect(item.getAttribute("aria-pressed")).toBe("false");
  expect(timeline().querySelectorAll('[class*="highlightedRoom"]')).toHaveLength(0);
  await click(button("今日事项"));
  await click(
    [...host.querySelectorAll('[aria-label="今日辅助事项"] button')].find((node) =>
      node.textContent?.includes("当前在住"),
    ),
  );
  expect(button("在住")?.getAttribute("aria-pressed")).toBe("true");
  const board = host.querySelector('section[aria-label="今日运营任务"]')!;
  expect(task("在住示例乙", board)).toBeTruthy();
  expect(task("待住示例甲", board)).toBeUndefined();
  expect(aside()).toBeNull();
});

it("changes seven to fourteen days and clears a stale inspector before the new window settles", async () => {
  await render();
  await click(task("待住示例甲", timeline()));
  expect(aside()).toBeTruthy();
  await setValue(host.querySelector<HTMLSelectElement>('[aria-label="日历显示天数"]')!, "14");
  expect(requestedWindow(vi.mocked(fetch).mock.calls.at(-1)![0])).toEqual({
    buildingId: calendarBuilding,
    from: today,
    to: "2026-11-03",
  });
  expect(timeline().style.getPropertyValue("--day-count")).toBe("14");
  expect(aside()).toBeNull();
  expect(timeline().parentElement?.className).toContain("stageWide");
  await click(host.querySelector('[aria-label="后一段日期"]'));
  expect(requestedWindow(vi.mocked(fetch).mock.calls.at(-1)![0])).toMatchObject({
    from: "2026-11-03",
    to: "2026-11-17",
  });
  expect(host.querySelector('[aria-label="今日辅助事项"]')).toBeNull();
  expect(button("复制房态")?.disabled).toBe(true);
  expect(button("打印")?.disabled).toBe(false);
  await click(button("返回今日房态"));
  expect(requestedWindow(vi.mocked(fetch).mock.calls.at(-1)![0])).toMatchObject({
    from: today,
    to: "2026-11-03",
  });
  expect(button("复制房态")?.disabled).toBe(false);
});

it.each(["7", "14"])(
  "clears the selected order and open action when the %s-day desktop calendar changes to a three-day mobile window",
  async (desktopDays) => {
    await render(fixture(), "admin");
    if (desktopDays === "14") {
      await setValue(host.querySelector<HTMLSelectElement>('[aria-label="日历显示天数"]')!, "14");
    }
    await click(task("待住示例甲", timeline()));
    await click(button("查看保洁与订单", aside()!));
    expect(host.querySelector('[role="dialog"]')).toBeTruthy();
    await setCompact(true);
    expect(timeline().style.getPropertyValue("--day-count")).toBe("3");
    expect(requestedWindow(vi.mocked(fetch).mock.calls.at(-1)![0])).toMatchObject({
      from: today,
      to: "2026-10-23",
    });
    expect(host.querySelector('[aria-label="日历显示天数"]')).toBeNull();
    expect(aside()).toBeNull();
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(timeline().parentElement?.className).toContain("stageWide");
    await setCompact(false);
    expect(timeline().style.getPropertyValue("--day-count")).toBe(desktopDays);
    expect(aside()).toBeNull();
    expect(host.querySelector('[role="dialog"]')).toBeNull();
  },
);

it.each(["removed", "moved"])(
  "does not turn a selected order into a vacant-room creation when the refreshed booking is %s",
  async (change) => {
    const initial = fixture({ cleaningTasks: [] });
    await render(initial, "admin");
    await click(task("待住示例甲", timeline()));
    expect(button("办理预订与入住", aside()!)).toBeTruthy();
    const bookings = initial.bookings.flatMap((record) => {
      if (record.id !== "booking-arrival") return [record];
      return change === "removed" ? [] : [{ ...record, unit_id: "unit-103" }];
    });
    vi.mocked(fetch).mockImplementation(async (input) =>
      response(input, {
        bookings,
        bookingCount: bookings.length,
        cleaningTasks: [],
        payments: [],
        paymentCount: 0,
      }),
    );
    await click(button("刷新"));
    expect(aside()).toBeNull();
    expect(button("填写预订信息")).toBeUndefined();
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(timeline().parentElement?.className).toContain("stageWide");
    expect(actionSpy).not.toHaveBeenCalled();
    if (change === "moved") {
      const movedRow = timeline().querySelector('[data-unit-id="unit-103"]')!;
      expect(task("待住示例甲", movedRow)).toBeTruthy();
      await click(task("待住示例甲", movedRow));
      expect(aside()?.textContent).toContain("11#103");
      expect(button("办理预订与入住", aside()!)).toBeTruthy();
    }
  },
);

it("clears a future date and action context when returning to today's room calendar", async () => {
  await render(fixture(), "admin");
  await click(host.querySelector('[aria-label="后一段日期"]'));
  await click(labelledButton("11#103 2026-10-28 查看日期与预订"));
  await click(button("填写预订信息", aside()!));
  expect(actionSpy).toHaveBeenLastCalledWith(
    expect.objectContaining({ date: "2026-10-28", checkOut: "2026-10-29" }),
  );
  await click(button("关闭测试操作"));
  expect(aside()).toBeTruthy();
  await click(button("返回今日房态"));
  expect(requestedWindow(vi.mocked(fetch).mock.calls.at(-1)![0])).toMatchObject({
    from: today,
    to: "2026-10-27",
  });
  expect(aside()).toBeNull();
  expect(host.querySelector('[role="dialog"]')).toBeNull();
  expect(timeline().parentElement?.className).toContain("stageWide");
  await click(labelledButton("11#103 2026-10-22 查看日期与预订"));
  await click(button("填写预订信息", aside()!));
  expect(actionSpy).toHaveBeenLastCalledWith(
    expect.objectContaining({ date: "2026-10-22", checkOut: "2026-10-23" }),
  );
});

it("clears selected details and actions when changing the visible calendar floor", async () => {
  const initial = fixture();
  initial.dailyUnits = initial.dailyUnits.map((room) =>
    room.id === "unit-103" ? { ...room, floor_label: "2F" } : room,
  );
  initial.unitLookupUnits = initial.dailyUnits;
  await render(initial, "admin");
  await click(task("待住示例甲", timeline()));
  await click(button("查看保洁与订单", aside()!));
  expect(host.querySelector('[role="dialog"]')).toBeTruthy();
  const floor = timeline().querySelector<HTMLSelectElement>("select")!;
  await setValue(floor, "2F");
  expect(timeline().querySelectorAll("[data-unit-id]")).toHaveLength(1);
  expect(timeline().querySelector('[data-unit-id="unit-103"]')).toBeTruthy();
  expect(aside()).toBeNull();
  expect(host.querySelector('[role="dialog"]')).toBeNull();
  expect(timeline().parentElement?.className).toContain("stageWide");
  expect(fetch).not.toHaveBeenCalled();
});

it("closes a selected inspector and restores the full-width calendar and originating focus", async () => {
  await render();
  const trigger = task("待住示例甲", timeline())!;
  trigger.focus();
  await click(trigger);
  expect(aside()).toBeTruthy();
  expect(timeline().parentElement?.className).toContain("stageInspecting");
  await click(labelledButton("关闭详情"));
  expect(aside()).toBeNull();
  expect(timeline().parentElement?.className).toContain("stageWide");
  expect(document.activeElement).toBe(trigger);
  await click(trigger);
  await act(async () => {
    trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  });
  await act(async () => {
    for (const callback of animationFrames.splice(0)) callback(0);
  });
  expect(aside()).toBeNull();
  expect(document.activeElement).toBe(trigger);
});

it("selects a vacant calendar date without writing, then passes that exact room and one-night interval to the existing actions", async () => {
  await render(fixture(), "admin");
  await click(labelledButton("11#103 2026-10-22 查看日期与预订"));
  expect(aside()?.textContent).toContain("尚未创建预订");
  expect(aside()?.textContent).toContain("10/22");
  expect(actionSpy).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
  await click(button("填写预订信息", aside()!));
  expect(actionSpy).toHaveBeenLastCalledWith(
    expect.objectContaining({
      unit: expect.objectContaining({ id: "unit-103" }),
      booking: null,
      date: "2026-10-22",
      checkOut: "2026-10-23",
      buildingId: calendarBuilding,
      userRole: "admin",
    }),
  );
  expect(host.querySelector('[role="dialog"]')).toBeTruthy();
  expect(fetch).not.toHaveBeenCalled();
});

it("passes the explicitly searched availability interval to the original booking actions", async () => {
  await render(fixture(), "rental_sales");
  await click(button("新建预订"));
  const dates = host.querySelectorAll<HTMLInputElement>('input[type="date"]');
  await setValue(dates[0], "2026-10-23");
  await setValue(dates[1], "2026-10-26");
  await submit(host.querySelector("form")!);
  expect(aside()).toBeNull();
  await click(task("103", host.querySelector('section[aria-label="空房查询结果"]')!));
  await click(button("填写预订信息", aside()!));
  expect(actionSpy).toHaveBeenLastCalledWith(
    expect.objectContaining({
      unit: expect.objectContaining({ id: "unit-103" }),
      booking: null,
      date: "2026-10-23",
      checkOut: "2026-10-26",
      userRole: "rental_sales",
    }),
  );
});

it.each(["front_desk", "finance", "boss"])(
  "does not grant %s a creation action from a vacant calendar cell",
  async (role) => {
    await render(fixture(), role);
    await click(labelledButton("11#103 2026-10-22 查看日期与预订"));
    expect(aside()?.textContent).toContain("尚未创建预订");
    expect(button("填写预订信息", aside()!)).toBeUndefined();
    expect(actionSpy).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  },
);

it.each(["admin", "rental_sales", "front_desk", "finance", "boss"])(
  "preserves the admin-only historical backfill entry for %s",
  async (role) => {
    await render(fixture(), role);
    await click(button("历史订单"));
    expect(Boolean(button("历史补录"))).toBe(role === "admin");
    if (role === "admin") {
      await click(button("历史补录"));
      expect(actionSpy).toHaveBeenLastCalledWith(
        expect.objectContaining({ unit: null, booking: null, date: today, userRole: "admin" }),
      );
    } else expect(actionSpy).not.toHaveBeenCalled();
  },
);

it.each(["房态日历", "今日事项"])(
  "preserves print and privacy-safe room-summary copy in the %s view",
  async (view) => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const print = vi.spyOn(window, "print").mockImplementation(() => {});
    await render();
    if (view === "今日事项") await click(button(view));
    await click(button("复制房态"));
    expect(writeText).toHaveBeenCalledTimes(1);
    const copied = writeText.mock.calls[0][0] as string;
    expect(copied).toContain("11 号楼 · 日租房态 · 2026-10-20");
    expect(copied).not.toContain("待住示例甲");
    expect(copied).not.toContain("在住示例乙");
    expect(copied).not.toContain("经办示例");
    expect(copied).not.toContain("40,000");
    expect(copied).not.toContain("payment-arrival");
    expect(host.querySelector('[role="status"]')?.textContent).toContain("房态摘要已复制");
    await click(button("打印"));
    expect(print).toHaveBeenCalledTimes(1);
    expect(actionSpy).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  },
);

it("advances a refreshed business day without returning to the old SSR window and follows untouched date defaults", async () => {
  await render();
  expect(fetch).not.toHaveBeenCalled();
  vi.mocked(fetch).mockImplementation(async (input) => response(input, { today: "2026-10-21" }));
  await click(button("刷新"));
  expect(vi.mocked(fetch).mock.calls.map(([input]) => requestedWindow(input))).toEqual([
    { buildingId: calendarBuilding, from: today, to: "2026-10-27" },
    { buildingId: calendarBuilding, from: "2026-10-21", to: "2026-10-28" },
  ]);
  expect(host.querySelector("header")?.textContent).toContain("10月21日");
  expect(host.querySelector("footer")?.textContent).toContain("2026-10-21");
  expect(host.querySelector("footer")?.textContent).not.toContain(today);
  await click(button("查空房"));
  expect(
    [...host.querySelectorAll<HTMLInputElement>('input[type="date"]')].map((input) => input.value),
  ).toEqual(["2026-10-21", "2026-10-24"]);
  expect(requestedWindow(vi.mocked(fetch).mock.calls.at(-1)![0])).toEqual({
    buildingId: calendarBuilding,
    from: "2026-10-21",
    to: "2026-10-24",
  });
  await click(button("今日事项"));
  expect(requestedWindow(vi.mocked(fetch).mock.calls.at(-1)![0])).toEqual({
    buildingId: calendarBuilding,
    from: "2026-10-21",
    to: "2026-10-28",
  });
  expect(
    vi
      .mocked(fetch)
      .mock.calls.every(
        ([input, init]) =>
          String(input).startsWith("/api/daily-rentals/calendar?") && init?.cache === "no-store",
      ),
  ).toBe(true);
  expect(actionSpy).not.toHaveBeenCalled();
  expect(host.querySelector('[role="dialog"]')).toBeNull();
});

it.each([
  ["2026-10-22", "2026-10-26"],
  ["2026-10-22", "2026-10-23"],
  ["2026-10-20", "2026-10-26"],
])(
  "preserves a user's explicit %s to %s interval when a refresh crosses midnight",
  async (from, to) => {
    await render();
    await click(button("查空房"));
    const dates = host.querySelectorAll<HTMLInputElement>('input[type="date"]');
    await setValue(dates[0], from);
    await setValue(dates[1], to);
    await submit(host.querySelector("form")!);
    await click(button("今日事项"));
    vi.mocked(fetch).mockImplementation(async (input) => response(input, { today: "2026-10-21" }));
    await click(button("刷新"));
    expect(host.querySelector("footer")?.textContent).toContain("2026-10-21");
    await click(button("查空房"));
    expect(
      [...host.querySelectorAll<HTMLInputElement>('input[type="date"]')].map(
        (input) => input.value,
      ),
    ).toEqual([from, to]);
    expect(requestedWindow(vi.mocked(fetch).mock.calls.at(-1)![0])).toEqual({
      buildingId: calendarBuilding,
      from,
      to,
    });
    expect(actionSpy).not.toHaveBeenCalled();
  },
);
