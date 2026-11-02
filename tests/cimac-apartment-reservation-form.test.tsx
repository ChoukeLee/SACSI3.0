// @vitest-environment jsdom
import React, { act } from "react";
import { webcrypto } from "node:crypto";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CimacApartmentReservationForm } from "@/features/cimac/cimac-apartment-reservation-form";
import {
  cimacApartmentPlan,
  type CimacApartmentRoom,
} from "@/features/cimac/cimac-apartment-model";
import type {
  CimacApartmentReservationActionResult,
  CimacApartmentReservationRequest,
} from "@/features/cimac/cimac-apartment-reservation-model";

const mocks = vi.hoisted(() => ({ execute: vi.fn(), check: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("@/features/cimac/cimac-apartment-reservation-actions", () => ({
  executeCimacApartmentReservations: mocks.execute,
  checkCimacApartmentReservationStatus: mocks.check,
}));

const id = (n: number) => `91000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const unit = id(1),
  reservationId = id(2),
  project = id(3),
  building = id(4);
const before = "2026-11-02T12:00:00.000Z",
  after = "2026-11-02T12:00:01.000Z";
const storageKey = `cimac-apartment-reservation:${project}:${building}:${unit}`;
let host: HTMLDivElement, root: Root;

function fixture(reserved = false): CimacApartmentRoom {
  return {
    ...cimacApartmentPlan()[0],
    registered: true,
    unitId: unit,
    unitUpdatedAt: before,
    constructionStatus: "unverified",
    occupancyState: "unknown",
    operationalCondition: "normal",
    areaSqm: null,
    reservation: reserved
      ? {
          id: reservationId,
          reserverName: "Original Tenant",
          status: "reserved",
          paymentStatus: "unpaid",
          updatedAt: before,
        }
      : null,
  };
}
function success(input: CimacApartmentReservationRequest): CimacApartmentReservationActionResult {
  const op = input.operations[0];
  return {
    success: true,
    requestId: input.requestId,
    idempotent: false,
    rooms: [
      {
        unitId: unit,
        unitNo: "201",
        reservationId,
        updatedAt: after,
        status: op.type === "cancel" ? "cancelled" : "reserved",
        reserverName: op.reserverName ?? "Original Tenant",
        paymentStatus: "unpaid",
      },
    ],
  };
}
async function render(room = fixture(), locale: "zh" | "fr" = "zh") {
  await act(async () =>
    root.render(
      <CimacApartmentReservationForm
        room={room}
        projectId={project}
        buildingId={building}
        locale={locale}
      />,
    ),
  );
}
function button(label: string) {
  const result = [...host.querySelectorAll<HTMLButtonElement>("button")].find(
    (item) => item.textContent === label,
  );
  if (!result) throw new Error(`Missing button: ${label}`);
  return result;
}
async function click(label: string) {
  await act(async () => button(label).click());
}
async function fill(kind: "input" | "textarea", value: string) {
  const input = host.querySelector<HTMLInputElement | HTMLTextAreaElement>(kind)!;
  const prototype = kind === "input" ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function submit(expectedCalls = 1) {
  await act(async () => {
    host
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(mocks.execute).toHaveBeenCalledTimes(expectedCalls));
  });
}
beforeEach(() => {
  vi.resetAllMocks();
  sessionStorage.clear();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("crypto", webcrypto);
  mocks.execute.mockImplementation(async (input: CimacApartmentReservationRequest) =>
    success(input),
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

describe("unpaid apartment reservation form", () => {
  it("accepts a name without dates or financial fields and verifies the returned room", async () => {
    await render();
    await click("登记房间预留");
    expect(document.activeElement).toBe(host.querySelector("input"));
    expect(host.querySelectorAll("input")).toHaveLength(1);
    expect(host.querySelector("textarea")).toBeNull();
    expect(host.textContent).toContain("未付款 · 入住日期与租期待定");
    await fill("input", "  Synthetic Tenant  ");
    await submit();
    const request = mocks.execute.mock.calls[0][0] as CimacApartmentReservationRequest;
    expect(request.operations).toEqual([
      {
        type: "reserve",
        unitId: unit,
        expectedUnitUpdatedAt: before,
        expectedReservationId: null,
        expectedReservationUpdatedAt: null,
        reserverName: "Synthetic Tenant",
        reason: "按页面明确指令登记房间预留；未付款，入住日期和租期待定。",
      },
    ]);
    expect(request.requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(request).not.toHaveProperty("payment");
    expect(request.operations[0]).not.toHaveProperty("checkIn");
    expect(mocks.refresh).toHaveBeenCalledOnce();
    expect(sessionStorage.getItem(storageKey)).toBeNull();
    expect(host.querySelector('[role="status"]')?.textContent).toContain("实际入住与账务未改动");
    expect(button("登记预留").disabled).toBe(true);
  });

  it.each(["   ", "x".repeat(201)])(
    "rejects invalid supplied names before preparing a request",
    async (name) => {
      await render();
      await click("登记房间预留");
      await fill("input", name);
      await act(async () =>
        host
          .querySelector("form")!
          .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
      );
      expect(mocks.execute).not.toHaveBeenCalled();
      expect(host.querySelector('[role="alert"]')?.textContent).toContain("请填写预订人");
      expect(sessionStorage.getItem(storageKey)).toBeNull();
    },
  );

  it("keeps the immutable request after an unknown result and never persists the name", async () => {
    let resolve!: (value: CimacApartmentReservationActionResult) => void;
    mocks.execute.mockImplementationOnce(
      () =>
        new Promise<CimacApartmentReservationActionResult>((done) => {
          resolve = done;
        }),
    );
    await render();
    await click("登记房间预留");
    await fill("input", "Synthetic Private Name");
    await submit();
    const original = structuredClone(
      mocks.execute.mock.calls[0][0] as CimacApartmentReservationRequest,
    );
    expect(host.querySelector("input")?.disabled).toBe(true);
    expect(button("正在核验…").disabled).toBe(true);
    await click("正在核验…");
    expect(mocks.execute).toHaveBeenCalledOnce();
    const marker = JSON.parse(sessionStorage.getItem(storageKey)!);
    expect(Object.keys(marker).sort()).toEqual(["fingerprint", "requestId", "version"]);
    expect(marker.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(marker)).not.toContain("Synthetic");
    await act(async () => resolve({ success: false, error: "结果未知", outcome: "unknown" }));
    await fill("input", "Changed In Browser");
    await click("按原请求重试");
    expect(mocks.execute.mock.calls[1][0]).toEqual(original);
    expect(mocks.refresh).toHaveBeenCalledOnce();
  });

  it("recovers only by original ID after remount, retaining not-found requests", async () => {
    mocks.execute.mockRejectedValueOnce(new Error("network diagnostic must stay private"));
    await render();
    await click("登记房间预留");
    await fill("input", "Synthetic Tenant");
    await submit();
    const requestId = mocks.execute.mock.calls[0][0].requestId as string;
    expect(host.textContent).not.toContain("network diagnostic");
    await act(async () => root.unmount());
    root = createRoot(host);
    await render();
    expect(host.querySelector("input")).toBeNull();
    expect(host.textContent).toContain(requestId);
    expect(mocks.execute).toHaveBeenCalledOnce();
    mocks.check.mockResolvedValueOnce({ success: true, requestId, found: false, verified: false });
    await click("核对原请求");
    expect(mocks.check).toHaveBeenCalledExactlyOnceWith(requestId);
    expect(sessionStorage.getItem(storageKey)).not.toBeNull();
    expect(host.textContent).toContain("不要换号重录");
    expect(mocks.refresh).not.toHaveBeenCalled();
    mocks.check.mockResolvedValueOnce({ success: true, requestId, found: true, verified: false });
    await click("核对原请求");
    expect(sessionStorage.getItem(storageKey)).toBeNull();
    expect(host.textContent).toContain("已查到原请求完成记录");
    expect(host.textContent).toContain("请核对当前房态");
    expect(mocks.execute).toHaveBeenCalledOnce();
    expect(mocks.refresh).toHaveBeenCalledOnce();
  });

  it("unlocks a definitely rejected request only after refreshing its source data", async () => {
    mocks.execute.mockResolvedValueOnce({
      success: false,
      error: "资料已变化",
      outcome: "rejected",
    });
    await render();
    await click("登记房间预留");
    await fill("input", "Synthetic First");
    await submit();
    const oldId = mocks.execute.mock.calls[0][0].requestId;
    expect(sessionStorage.getItem(storageKey)).toBeNull();
    expect(mocks.refresh).toHaveBeenCalledOnce();
    expect(host.textContent).toContain("资料已变化");
    await render({ ...fixture(), unitUpdatedAt: after });
    await click("登记房间预留");
    await fill("input", "Synthetic Revised");
    await submit(2);
    expect(mocks.execute.mock.calls[1][0].requestId).not.toBe(oldId);
    expect(mocks.execute.mock.calls[1][0].operations[0]).toMatchObject({
      reserverName: "Synthetic Revised",
      expectedUnitUpdatedAt: after,
    });
  });

  it.each(["cancel", "correct_name"] as const)(
    "requires a reason and preserves the expected reservation for %s",
    async (mode) => {
      await render(fixture(true));
      await click(mode === "cancel" ? "取消预留" : "更正预订人");
      if (mode === "correct_name") await fill("input", "Synthetic Corrected");
      await act(async () =>
        host
          .querySelector("form")!
          .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
      );
      expect(mocks.execute).not.toHaveBeenCalled();
      expect(host.querySelector('[role="alert"]')?.textContent).toContain("理由");
      await fill("textarea", "Explicit synthetic correction");
      await submit();
      expect(mocks.execute.mock.calls[0][0].operations[0]).toMatchObject({
        type: mode,
        unitId: unit,
        expectedReservationId: reservationId,
        expectedReservationUpdatedAt: before,
        expectedUnitUpdatedAt: before,
        reserverName: mode === "cancel" ? null : "Synthetic Corrected",
        reason: "Explicit synthetic correction",
      });
      expect(mocks.refresh).toHaveBeenCalledOnce();
    },
  );

  it.each([
    { unitId: id(9) },
    { unitNo: "202" },
    { reserverName: "Another Tenant" },
    { status: "cancelled" },
    { paymentStatus: "paid" },
    { updatedAt: "bad" },
    { reservationId: "bad" },
  ])("keeps an unverified response pending (%j)", async (change) => {
    mocks.execute.mockImplementation(async (input: CimacApartmentReservationRequest) => {
      const result = success(input);
      return result.success ? { ...result, rooms: [{ ...result.rooms[0], ...change }] } : result;
    });
    await render();
    await click("登记房间预留");
    await fill("input", "Synthetic Tenant");
    await submit();
    expect(mocks.refresh).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(storageKey)).not.toBeNull();
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("结果尚未核实");
  });

  it("requires a registered room version and localizes the pending nature in French", async () => {
    await render({ ...fixture(), unitUpdatedAt: null });
    expect(host.textContent).toBe("");
    await render(fixture(), "fr");
    await click("Réserver ce logement");
    expect(host.textContent).toContain("Non payé · arrivée et durée à préciser");
    expect(host.querySelector("label")?.textContent).toContain("Réservataire");
    expect(host.querySelector('input[type="date"]')).toBeNull();
    expect(mocks.execute).not.toHaveBeenCalled();
  });
});
