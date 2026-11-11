// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CimacApartmentWorkbench } from "@/features/cimac/cimac-apartment-workbench";
import {
  cimacApartmentPlan,
  type CimacApartmentData,
  type CimacApartmentInitializationResult,
  type CimacApartmentQuery,
} from "@/features/cimac/cimac-apartment-model";
import type { Locale } from "@/lib/i18n";

const mocks = vi.hoisted(() => ({
  initialize: vi.fn(),
  refresh: vi.fn(),
  executeReservation: vi.fn(),
  checkReservation: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("@/features/cimac/cimac-apartment-actions", () => ({
  initializeCimacApartments: mocks.initialize,
}));
vi.mock("@/features/cimac/cimac-apartment-reservation-actions", () => ({
  executeCimacApartmentReservations: mocks.executeReservation,
  checkCimacApartmentReservationStatus: mocks.checkReservation,
}));

let host: HTMLDivElement;
let root: Root;

function fixture(): CimacApartmentData {
  return {
    projectId: "project-cimac",
    buildingId: "building-17",
    buildingName: "第十七栋",
    rooms: cimacApartmentPlan().map((room) => ({
      ...room,
      registered: false,
      unitId: null,
      constructionStatus: null,
      occupancyState: "unknown",
      operationalCondition: null,
      areaSqm: null,
    })),
    registeredCount: 0,
    schemaAvailable: true,
  };
}

async function render({
  data = fixture(),
  locale = "zh",
  canInitialize = true,
  initialQuery = { floor: 2, suffix: 1, tab: "fees" },
}: {
  data?: CimacApartmentData;
  locale?: Locale;
  canInitialize?: boolean;
  initialQuery?: CimacApartmentQuery;
} = {}) {
  await act(async () => {
    root.render(
      <CimacApartmentWorkbench
        data={data}
        locale={locale}
        canInitialize={canInitialize}
        initialQuery={initialQuery}
      />,
    );
  });
}

function button(text: string) {
  const result = [...host.querySelectorAll<HTMLButtonElement>("button")].find(
    (candidate) => candidate.textContent === text,
  );
  if (!result) throw new Error(`Missing button: ${text}`);
  return result;
}

async function click(target: HTMLElement) {
  await act(async () => target.click());
}

function plan() {
  return host.querySelector('[data-testid="apartment-desktop-plan"]')!;
}

function room(number: string) {
  const result = plan().querySelector<HTMLButtonElement>(`[data-room="${number}"]`);
  if (!result) throw new Error(`Missing room ${number}`);
  return result;
}

function selectedNumber() {
  return host.querySelector('[data-testid="apartment-selected-number"]')!.textContent;
}

beforeEach(() => {
  vi.resetAllMocks();
  sessionStorage.clear();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.initialize.mockRejectedValue(new Error("connection lost"));
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

describe("CIMAC apartment workbench", () => {
  it("shows delivery, booking and actual stay independently for a ready 64-room catalogue", async () => {
    const data = fixture();
    data.reservationSchemaAvailable = true;
    data.registeredCount = 64;
    data.rooms = data.rooms.map((item, index) => ({
      ...item,
      registered: true,
      unitId: `synthetic-unit-${item.unitNo}`,
      constructionStatus: "operational",
      operationalCondition: "normal",
      reservation:
        index < 11
          ? {
              id: `synthetic-reservation-${index}`,
              reserverName: `Synthetic Booker ${index}`,
              status: "reserved",
              paymentStatus: "unpaid",
              updatedAt: "2026-11-11T12:00:00Z",
            }
          : null,
    }));
    await render({
      data,
      canInitialize: false,
      initialQuery: { floor: 2, suffix: 1, tab: "room" },
    });
    const delivery = host.querySelector('[data-testid="apartment-delivery-summary"]')!.textContent;
    const booking = host.querySelector(
      '[data-testid="apartment-reservation-summary"]',
    )!.textContent;
    const stay = host.querySelector('[data-testid="apartment-stay-summary"]')!.textContent;
    expect(delivery).toContain("64");
    expect(delivery).toContain("可交付");
    expect(booking).toContain("11");
    expect(booking).toContain("53");
    expect(booking).toContain("已预订");
    expect(booking).toContain("暂无预订");
    expect(stay).toContain("64");
    expect(stay).toContain("资料待补充");
    const states = host.querySelector('[aria-label="房间状态"]')!.textContent;
    expect(states).toContain("交付条件可交付");
    expect(states).toContain("预订情况已预订");
    expect(
      host.querySelector('[aria-label="选中房间详情"] [title="Synthetic Booker 0"]')?.textContent,
    ).toContain("Synthetic Booker 0");
    expect(states).toContain("实际入住资料待补充");
    expect(room("201").getAttribute("aria-label")).toMatch(
      /交付.*可交付.*预订.*Synthetic Booker 0.*入住.*资料待补充/,
    );
    expect(room("216").getAttribute("aria-label")).toMatch(
      /交付.*可交付.*预订.*暂无预订.*入住.*资料待补充/,
    );
    expect(host.textContent).not.toMatch(/业务占用待核|64套待核|已入住|空房|空置率/);
    expect(mocks.executeReservation).not.toHaveBeenCalled();
  });

  it("keeps unavailable or unregistered booking data unknown instead of reporting no booking", async () => {
    const data = fixture();
    data.rooms[0] = { ...data.rooms[0], registered: true, unitId: "synthetic-unit-201" };
    data.registeredCount = 1;
    data.reservationSchemaAvailable = false;
    await render({ data, canInitialize: false });
    expect(room("201").getAttribute("aria-label")).toMatch(/预订.*资料待补充/);
    expect(
      host.querySelector('[data-testid="apartment-reservation-summary"]')?.textContent,
    ).not.toContain("暂无预订");
    data.reservationSchemaAvailable = true;
    await render({ data, canInitialize: false });
    expect(room("201").getAttribute("aria-label")).toContain("暂无预订");
    expect(room("202").getAttribute("aria-label")).toMatch(/预订.*资料待补充/);
    expect(
      host.querySelector('[data-testid="apartment-reservation-summary"]')?.textContent,
    ).toContain("1");
  });

  it("does not equate blocked, missing-condition or unregistered assets with delivery readiness", async () => {
    const data = fixture();
    data.rooms = data.rooms.map((item, index) => ({
      ...item,
      registered: index < 4,
      unitId: index < 4 ? `synthetic-unit-${item.unitNo}` : null,
      constructionStatus: "operational",
      operationalCondition:
        index === 1 ? "locked" : index === 2 ? "maintenance" : index === 3 ? null : "normal",
    }));
    data.registeredCount = 4;
    await render({ data, canInitialize: false });
    expect(room("201").getAttribute("aria-label")).toContain("可交付");
    expect(room("202").getAttribute("aria-label")).toContain("暂停交付");
    expect(room("203").getAttribute("aria-label")).toContain("维护中");
    expect(room("204").getAttribute("aria-label")).not.toContain("可交付");
    expect(room("205").getAttribute("aria-label")).not.toContain("可交付");
  });

  it("shows named unpaid reservations separately from actual residents and unknown occupancy", async () => {
    const data = fixture();
    data.reservationSchemaAvailable = true;
    data.registeredCount = 2;
    const fullName = "Synthetic Reservation Name With A Long Label";
    data.rooms[0] = {
      ...data.rooms[0],
      registered: true,
      unitId: "92000000-0000-4000-8000-000000000001",
      unitUpdatedAt: "2026-11-02T12:00:00Z",
      reservation: {
        id: "92000000-0000-4000-8000-000000000002",
        reserverName: fullName,
        status: "reserved",
        paymentStatus: "unpaid",
        updatedAt: "2026-11-02T12:00:00Z",
      },
    };
    data.rooms[16] = {
      ...data.rooms[16],
      registered: true,
      unitId: "92000000-0000-4000-8000-000000000003",
      unitUpdatedAt: "2026-11-02T12:00:00Z",
      reservation: {
        id: "92000000-0000-4000-8000-000000000004",
        reserverName: "Another Synthetic Name",
        status: "reserved",
        paymentStatus: "unpaid",
        updatedAt: "2026-11-02T12:00:00Z",
      },
    };
    await render({ data, initialQuery: { floor: 2, suffix: 1, tab: "room" } });
    expect(
      host.querySelector('[data-testid="apartment-reservation-summary"]')?.textContent,
    ).toMatch(/2.*已预订/);
    expect(host.textContent).toContain("本层预订 1 套");
    expect(room("201").getAttribute("aria-label")).toContain(`已预订 · ${fullName}`);
    expect(room("201").querySelector(`[title="${fullName}"]`)?.textContent).toBe(fullName);
    const info = host.querySelector("#apartment-room-info")!.textContent;
    expect(info).toContain(`预订人${fullName}`);
    expect(info).toContain("预留付款未付款");
    expect(info).toContain("预计入住日期待定");
    expect(info).toContain("租期待定");
    expect(info).toContain("实际住户待补充");
    expect(info).toContain("入住日期待补充");
    expect(host.querySelector('[data-testid="apartment-stay-summary"]')?.textContent).toMatch(
      /64.*待补充/,
    );
    expect(host.textContent).not.toContain("入住率");
    expect(button("更正预订人")).not.toBeNull();
    await click(button("3层"));
    expect(room("301").textContent).toContain("Another Synthetic Name");
    expect(host.textContent).toContain("本层预订 1 套");
    expect(mocks.executeReservation).not.toHaveBeenCalled();
  });

  it("keeps reservations readable without exposing mutation controls to read-only roles", async () => {
    const data = fixture();
    data.reservationSchemaAvailable = true;
    data.registeredCount = 1;
    data.rooms[0] = {
      ...data.rooms[0],
      registered: true,
      unitId: "asset-201",
      unitUpdatedAt: "2026-11-02T12:00:00Z",
      reservation: {
        id: "reservation-201",
        reserverName: "Synthetic Reservation",
        status: "reserved",
        paymentStatus: "unpaid",
        updatedAt: "2026-11-02T12:00:00Z",
      },
    };
    await render({ data, canInitialize: false });
    expect(room("201").textContent).toContain("Synthetic Reservation");
    expect(host.querySelector('[aria-label="房间预留操作"]')).toBeNull();
    expect(mocks.executeReservation).not.toHaveBeenCalled();
    data.reservationSchemaAvailable = false;
    await render({ data });
    expect(host.textContent).toContain("房间预留功能待部署");
    expect(host.querySelector('[aria-label="房间预留操作"]')).toBeNull();
  });

  it("does not display cancelled reservation names as current room reservations", async () => {
    const data = fixture();
    data.reservationSchemaAvailable = true;
    data.registeredCount = 1;
    data.rooms[0] = {
      ...data.rooms[0],
      registered: true,
      unitId: "asset-201",
      unitUpdatedAt: "2026-11-02T12:00:00Z",
      reservation: {
        id: "reservation-201",
        reserverName: "Cancelled Synthetic Name",
        status: "cancelled",
        paymentStatus: "unpaid",
        updatedAt: "2026-11-02T12:00:00Z",
      },
    };
    await render({ data });
    expect(room("201").getAttribute("aria-label")).toContain("暂无预订");
    expect(host.textContent).not.toContain("Cancelled Synthetic Name");
    expect(
      host.querySelector('[data-testid="apartment-reservation-summary"]')?.textContent,
    ).toMatch(/0.*已预订/);
    expect(button("登记房间预留")).not.toBeNull();
  });

  it("localizes reservation names, unpaid state and pending dates in French", async () => {
    const data = fixture();
    data.reservationSchemaAvailable = true;
    data.registeredCount = 1;
    data.rooms[0] = {
      ...data.rooms[0],
      registered: true,
      unitId: "asset-201",
      unitUpdatedAt: "2026-11-02T12:00:00Z",
      reservation: {
        id: "reservation-201",
        reserverName: "Synthetic Réservataire",
        status: "reserved",
        paymentStatus: "unpaid",
        updatedAt: "2026-11-02T12:00:00Z",
      },
    };
    await render({ data, locale: "fr", initialQuery: { floor: 2, suffix: 1, tab: "room" } });
    expect(room("201").getAttribute("aria-label")).toContain("Réservé · Synthetic Réservataire");
    const info = host.querySelector("#apartment-room-info")!.textContent;
    expect(info).toContain("RéservataireSynthetic Réservataire");
    expect(info).toContain("Paiement de la réservationNon payé");
    expect(info).toContain("Arrivée prévueÀ préciser");
    expect(info).toContain("Résident réelÀ compléter");
    expect(button("Corriger le réservataire")).not.toBeNull();
  });

  it("separates the 64 confirmed plans from asset registration and unknown occupancy", async () => {
    await render();
    expect(host.textContent).toContain("房间总数64套");
    expect(host.textContent).toContain("52套一室一厅 / 12套两室");
    expect(host.textContent).toContain("资产建档 0 / 64");
    expect(host.querySelector('[data-testid="apartment-stay-summary"]')?.textContent).toMatch(
      /64.*待补充/,
    );
    expect(host.textContent).toContain("资产记录尚未建立");
    expect(host.textContent).not.toMatch(/入住率|空置率|已入住|已收租金|已收物业|0%/);
    expect(plan().querySelectorAll("button[data-room]")).toHaveLength(16);
    expect(host.querySelector("nav")).toBeNull();
    expect(mocks.initialize).not.toHaveBeenCalled();
  });

  it("switches all four floors locally while keeping the selected suffix and bedroom correction", async () => {
    await render({ initialQuery: { floor: 2, suffix: 14, tab: "room" } });
    expect(selectedNumber()).toBe("214");
    expect(room("214").getAttribute("aria-label")).toContain("一室一厅");
    expect(room("216").getAttribute("aria-label")).toContain("两室");
    for (const floor of [3, 4, 5, 2]) {
      await click(button(`${floor}层`));
      expect(selectedNumber()).toBe(`${floor}14`);
      expect(plan().querySelectorAll("button[data-room]")).toHaveLength(16);
      expect(room(`${floor}14`).getAttribute("aria-label")).toContain("一室一厅");
      expect(room(`${floor}16`).getAttribute("aria-label")).toContain("两室");
      expect(button(`${floor}层`).getAttribute("aria-pressed")).toBe("true");
    }
    expect(mocks.refresh).not.toHaveBeenCalled();
    expect(mocks.initialize).not.toHaveBeenCalled();
  });

  it("places nine rooms east and seven west with the core between 208 and 211", async () => {
    await render();
    const rows = [...plan().querySelectorAll("div")].filter((item) =>
      [...item.children].some((child) => child.hasAttribute("data-room")),
    );
    expect([...rows[0].querySelectorAll("button")].map((item) => item.dataset.room)).toEqual([
      "201",
      "203",
      "205",
      "207",
      "209",
      "210",
      "212",
      "213",
      "215",
    ]);
    expect([...rows[1].children].map((item) => item.getAttribute("data-room") ?? "core")).toEqual([
      "202",
      "204",
      "206",
      "208",
      "core",
      "211",
      "214",
      "216",
    ]);
    expect(room("210").getAttribute("aria-label")).toContain("东侧");
    expect(room("211").getAttribute("aria-label")).toContain("西侧");
    await click(room("216"));
    expect(selectedNumber()).toBe("216");
    expect(room("216").getAttribute("aria-pressed")).toBe("true");
    expect(
      host
        .querySelector('[data-testid="apartment-mobile-plan"] [data-room="216"]')
        ?.getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("calculates rent, two-month deposit, three-month prepayment and an entire year of fees independently of actual accounts", async () => {
    await render();
    const fees = () => host.querySelector("#apartment-room-fees")!.textContent;
    expect(fees()).toContain("月租35万 XOF");
    expect(fees()).toContain("押金 · 2个月70万 XOF");
    expect(fees()).toContain("预付租金 · 3个月105万 XOF");
    expect(fees()).toContain("物业费 · 每月3万 XOF");
    expect(fees()).toContain("物业费 · 一年36万 XOF");
    expect(host.querySelector('[data-testid="apartment-initial-total"]')?.textContent).toBe(
      "211万 XOF",
    );
    await click(room("216"));
    expect(fees()).toContain("月租60万 XOF");
    expect(fees()).toContain("押金 · 2个月120万 XOF");
    expect(fees()).toContain("预付租金 · 3个月180万 XOF");
    expect(fees()).toContain("物业费 · 每月4万 XOF");
    expect(fees()).toContain("物业费 · 一年48万 XOF");
    expect(host.querySelector('[data-testid="apartment-initial-total"]')?.textContent).toBe(
      "348万 XOF",
    );
    expect(host.textContent).toContain("原币 XOF · 押二付三 · 物业年缴");
    expect(host.textContent).toContain("2个月押金 + 3个月租金 + 完整1年物业费");
    expect(host.textContent).not.toContain("6个月");
    expect(host.textContent).toContain("收费测算，不代表应收或已收款");
    expect(host.textContent).toContain("待确认，不套用商铺年度");
    expect(host.textContent).toContain("折算方式待确认");
    expect(mocks.initialize).not.toHaveBeenCalled();
  });

  it("keeps unsupplied resident, merchant, occupancy dates and areas pending", async () => {
    await render({ initialQuery: { floor: 2, suffix: 16, tab: "room" } });
    const info = host.querySelector("#apartment-room-info")!;
    expect(info.textContent).toContain("实际住户待补充");
    expect(info.textContent).toContain("关联商户待补充");
    expect(info.textContent).toContain("入住日期待补充");
    expect(info.textContent).toContain("租金起算日待核实");
    expect(info.textContent).toContain("面积待核实");
    expect(host.querySelector('[aria-label="房间状态"]')?.textContent).toContain(
      "交付条件资料待补充",
    );
    expect(info.textContent).toContain("运行条件待核实");
    expect(host.querySelector("a")).toBeNull();
  });

  it("does not describe an undeployed schema as an empty live catalogue", async () => {
    const data = fixture();
    data.schemaAvailable = false;
    await render({ data });
    expect(host.textContent).toContain("公寓台账待部署");
    expect(host.textContent).toContain("请先完成公寓数据库迁移");
    expect(host.textContent).not.toContain("资产建档 0 / 64");
    expect(
      [...host.querySelectorAll("button")].some((item) => item.textContent?.includes("建立64套")),
    ).toBe(false);
    expect(mocks.initialize).not.toHaveBeenCalled();
  });

  it("offers initialization only to an authorized role and a completely unregistered catalogue", async () => {
    await render({ canInitialize: false });
    expect(
      [...host.querySelectorAll("button")].some((item) => item.textContent === "建立64套房间台账"),
    ).toBe(false);
    const data = fixture();
    data.registeredCount = 1;
    data.rooms[0] = { ...data.rooms[0], registered: true, unitId: "asset-201" };
    await render({ data });
    expect(host.textContent).toContain("资产建档 1 / 64");
    expect(
      [...host.querySelectorAll("button")].some((item) => item.textContent === "建立64套房间台账"),
    ).toBe(false);
  });

  it("retains the request identity after an unknown outcome, blocks double clicks and refreshes only verified success", async () => {
    let resolve!: (value: CimacApartmentInitializationResult) => void;
    mocks.initialize.mockImplementationOnce(
      () =>
        new Promise<CimacApartmentInitializationResult>((done) => {
          resolve = done;
        }),
    );
    await render();
    const initialize = button("建立64套房间台账");
    await act(async () => {
      initialize.click();
      initialize.click();
    });
    expect(mocks.initialize).toHaveBeenCalledTimes(1);
    expect(initialize.disabled).toBe(true);
    const request = mocks.initialize.mock.calls[0][0] as string;
    expect(request).toMatch(/^[0-9a-f-]{36}$/);
    await act(async () => resolve({ success: false, error: "待核验" }));
    expect(host.querySelector('[role="alert"]')?.textContent).toBe("待核验");
    await click(button("建立64套房间台账"));
    expect(mocks.initialize.mock.calls[1][0]).toBe(request);
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("结果尚未确认");
    await click(button("5层"));
    await click(room("516"));
    mocks.initialize.mockResolvedValue({
      success: true,
      requestId: request,
      roomCount: 64,
      idempotent: true,
    });
    await click(button("建立64套房间台账"));
    expect(mocks.initialize.mock.calls[2][0]).toBe(request);
    expect(mocks.refresh).toHaveBeenCalledOnce();
    expect(host.querySelector('[role="status"]')?.textContent).toContain("未生成合同、应收或收款");
    await click(button("台账已建立"));
    expect(mocks.initialize).toHaveBeenCalledTimes(3);
  });

  it.each([
    { requestId: "different-request", roomCount: 64, idempotent: false },
    { requestId: "same", roomCount: 63, idempotent: false },
    { requestId: "same", roomCount: 64 },
  ])("rejects an unverified success response (%j)", async (response) => {
    mocks.initialize.mockImplementation(async (requestId: string) => ({
      success: true,
      ...response,
      requestId: response.requestId === "same" ? requestId : response.requestId,
    }));
    await render();
    await click(button("建立64套房间台账"));
    expect(mocks.refresh).not.toHaveBeenCalled();
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("尚未核实");
    expect(host.querySelector('[role="status"]')).toBeNull();
  });

  it("restores an unresolved request after remount and removes it only after verified success", async () => {
    await render();
    await click(button("建立64套房间台账"));
    const requestId = mocks.initialize.mock.calls[0][0] as string;
    expect(sessionStorage.getItem("cimac-apartment-initialize:project-cimac:building-17")).toBe(
      requestId,
    );
    expect(host.textContent).toContain(`请求编号：${requestId}`);
    await act(async () => root.unmount());
    root = createRoot(host);
    await render();
    mocks.initialize.mockResolvedValue({
      success: true,
      requestId,
      roomCount: 64,
      idempotent: true,
    });
    await click(button("建立64套房间台账"));
    expect(mocks.initialize.mock.calls[1][0]).toBe(requestId);
    expect(
      sessionStorage.getItem("cimac-apartment-initialize:project-cimac:building-17"),
    ).toBeNull();
    expect(mocks.refresh).toHaveBeenCalledOnce();
  });

  it("replaces malformed stored request IDs without forwarding them", async () => {
    sessionStorage.setItem("cimac-apartment-initialize:project-cimac:building-17", "bad request");
    await render();
    await click(button("建立64套房间台账"));
    expect(mocks.initialize.mock.calls[0][0]).toMatch(/^[0-9a-f-]{36}$/);
    expect(mocks.initialize.mock.calls[0][0]).not.toBe("bad request");
  });

  it("labels business occupation distinctly from real residents and provides the registered asset return path", async () => {
    const data = fixture();
    data.reservationSchemaAvailable = true;
    data.registeredCount = 2;
    data.rooms[0] = {
      ...data.rooms[0],
      registered: true,
      unitId: "asset-201",
      occupancyState: "occupied",
      reservation: {
        id: "synthetic-reservation",
        reserverName: "Synthetic Future Booker",
        status: "reserved",
        paymentStatus: "unpaid",
        updatedAt: "2026-11-11T12:00:00Z",
      },
    };
    data.rooms[1] = {
      ...data.rooms[1],
      registered: true,
      unitId: "asset-202",
      occupancyState: "unoccupied",
    };
    await render({ data, initialQuery: { floor: 2, suffix: 1, tab: "room" } });
    expect(room("201").getAttribute("aria-label")).toMatch(
      /预订.*Synthetic Future Booker.*入住.*资料待补充/,
    );
    expect(room("202").getAttribute("aria-label")).toMatch(/暂无预订.*入住.*资料待补充/);
    expect(host.querySelector("#apartment-room-info")?.textContent).toContain(
      "关联业务存在占用业务",
    );
    expect(host.querySelector("#apartment-room-info")?.textContent).toContain("实际住户待补充");
    const link = new URL(host.querySelector("a")!.href);
    expect(link.pathname).toBe("/cimac/assets/asset-201");
    expect(link.searchParams.get("returnTo")).toBe("/cimac/apartments?floor=2&room=201&tab=room");
    expect(host.textContent).not.toContain("入住率");
    expect(host.textContent).not.toMatch(/已入住|现场空置/);
    await click(room("202"));
    expect(host.querySelector("#apartment-room-info")?.textContent).toContain(
      "关联业务已核实无占用业务",
    );
  });

  it("localizes the floor, details, XOF reference amounts and asset route in French", async () => {
    const data = fixture();
    data.registeredCount = 1;
    data.rooms[15] = { ...data.rooms[15], registered: true, unitId: "asset-216" };
    await render({ data, locale: "fr", initialQuery: { floor: 2, suffix: 16, tab: "fees" } });
    expect(host.querySelector("h1")?.textContent).toBe("Bâtiment 17 · Appartements");
    expect(button("Étage 2").getAttribute("aria-pressed")).toBe("true");
    expect(room("216").getAttribute("aria-label")).toContain("2 chambres · Ouest");
    expect(
      host
        .querySelector('[data-testid="apartment-initial-total"]')
        ?.textContent?.replace(/\s/g, " "),
    ).toBe("3 480 000 XOF");
    const feeText = host.querySelector("#apartment-room-fees")!.textContent!.replace(/\s/g, " ");
    expect(feeText).toContain("Dépôt · 2 mois1 200 000 XOF");
    expect(feeText).toContain("Loyer prépayé · 3 mois1 800 000 XOF");
    expect(feeText).toContain("Charges · année480 000 XOF");
    expect(feeText).toContain("Dépôt 2 mois + loyer 3 mois + charges d’une année entière");
    expect(host.textContent).toContain("XOF · dépôt 2 mois · loyer 3 mois · charges annuelles");
    expect(host.textContent).not.toContain("6 mois");
    expect(host.textContent).toContain("Prorata à confirmer");
    expect(host.querySelector("#apartment-room-info")?.textContent).toContain(
      "Résident réelÀ compléter",
    );
    const link = new URL(host.querySelector("a")!.href);
    expect(link.pathname).toBe("/fr/cimac/assets/asset-216");
    expect(link.searchParams.get("returnTo")).toBe(
      "/fr/cimac/apartments?floor=2&room=216&tab=fees",
    );
    await click(room("201"));
    const oneBedroomFees = host
      .querySelector("#apartment-room-fees")!
      .textContent!.replace(/\s/g, " ");
    expect(oneBedroomFees).toContain("Dépôt · 2 mois700 000 XOF");
    expect(oneBedroomFees).toContain("Loyer prépayé · 3 mois1 050 000 XOF");
    expect(oneBedroomFees).toContain("Charges · année360 000 XOF");
    expect(
      host
        .querySelector('[data-testid="apartment-initial-total"]')
        ?.textContent?.replace(/\s/g, " "),
    ).toBe("2 110 000 XOF");
  });

  it("supports keyboard tab navigation without a network transition", async () => {
    await render();
    const feesTab = host.querySelector<HTMLButtonElement>("#apartment-tab-fees")!;
    const infoTab = host.querySelector<HTMLButtonElement>("#apartment-tab-room")!;
    await act(async () => {
      feesTab.focus();
      feesTab.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Home", bubbles: true, cancelable: true }),
      );
    });
    expect(infoTab.getAttribute("aria-selected")).toBe("true");
    expect(infoTab.tabIndex).toBe(0);
    expect(document.activeElement).toBe(infoTab);
    expect(host.querySelector<HTMLElement>("#apartment-room-fees")?.hidden).toBe(true);
    await act(async () =>
      infoTab.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true }),
      ),
    );
    expect(feesTab.getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(feesTab);
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
});
