// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { RoomState } from "@/features/mobile/room-state";
import type { DailyBookingRow, UnitRow } from "@/types/database";
import { dictionaries } from "@/lib/i18n";
import { calendarBuilding, calendarWindowFixture } from "./fixtures/calendar-window";

const mocks = vi.hoisted(() => ({
  rooms: [] as RoomState[],
  checkOut: vi.fn(),
  completeCleaning: vi.fn(),
  payment: vi.fn(),
  extend: vi.fn(),
  updateUnit: vi.fn(),
  confirmations: new Map<string, { open: boolean; onConfirm: () => Promise<void> }>(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("next/dynamic", () => ({
  default: (loader: () => Promise<unknown>) =>
    loader.toString().includes("mobile-daily-cards")
      ? function Mobile(props: React.ComponentProps<typeof MobileDailyCards>) {
          return <MobileDailyCards {...props} />;
        }
      : () => null,
}));
vi.mock("@/features/daily-rentals/actions", () => ({
  checkOut: mocks.checkOut,
  completeCleaning: mocks.completeCleaning,
  recordSupplementaryPayment: mocks.payment,
  extendStay: mocks.extend,
}));
vi.mock("@/features/units/actions", () => ({ updateUnitStatus: mocks.updateUnit }));
vi.mock("@/hooks/use-optimistic-operation", () => ({
  useBackgroundOperationStatus: () => ({ operation: null, reportOperation: vi.fn() }),
  useOptimisticOperation: () => ({
    pendingLabel: "",
    runOptimisticOperation: async (_label: string, operation: () => Promise<unknown>) =>
      operation(),
  }),
}));
vi.mock("@/features/mobile/room-state", () => ({
  computeRoomStates: () => mocks.rooms,
  getOccupiedRooms: (rooms: RoomState[]) =>
    rooms.filter((room) => room.displayStatus === "occupied"),
  getTodayCheckouts: (rooms: RoomState[]) =>
    rooms.filter((room) => room.displayStatus === "checking_out_today"),
  getReservedRooms: (rooms: RoomState[]) =>
    rooms.filter((room) => room.displayStatus === "reserved"),
  getCleaningRooms: (rooms: RoomState[]) =>
    rooms.filter((room) => room.displayStatus === "cleaning"),
}));
vi.mock("@/features/mobile/mobile-stats-bar", () => ({
  MobileStatsBar: ({ onTabChange }: { onTabChange: (tab: string) => void }) => (
    <button onClick={() => onTabChange("available")}>ALL ROOMS</button>
  ),
}));
vi.mock("@/features/mobile/mobile-room-card", () => ({
  MobileRoomCard: ({
    room,
    onPress,
    onCheckOut,
    onCompleteCleaning,
  }: {
    room: RoomState;
    onPress: (room: RoomState) => void;
    onCheckOut?: (room: RoomState) => void;
    onCompleteCleaning?: (room: RoomState) => void;
  }) => (
    <div>
      <button onClick={() => onPress(room)}>OPEN {room.unit.unit_no}</button>
      {onCheckOut && (
        <button onClick={() => onCheckOut(room)}>QUICK CHECKOUT {room.unit.unit_no}</button>
      )}
      {onCompleteCleaning && (
        <button onClick={() => onCompleteCleaning(room)}>QUICK CLEAN {room.unit.unit_no}</button>
      )}
    </div>
  ),
}));
vi.mock("@/features/mobile/confirm-dialog", () => ({
  ConfirmDialog: (props: { title: string; open: boolean; onConfirm: () => Promise<void> }) => {
    mocks.confirmations.set(props.title, props);
    return props.open ? <div data-confirm>{props.title}</div> : null;
  },
}));

import { DailyRentalsResponsiveView } from "@/features/daily-rentals/daily-rentals-responsive-view";
import { MobileDailyCards } from "@/features/mobile/mobile-daily-cards";

let host: HTMLDivElement, root: Root;
const labels = dictionaries.zh.mobile.actions;
function room(unitNo: string, displayStatus: RoomState["displayStatus"]): RoomState {
  const unit = {
    id: `unit-${unitNo}`,
    building_id: calendarBuilding,
    unit_no: unitNo,
    status: displayStatus === "cleaning" ? "cleaning_pending" : "daily_occupied",
  } as UnitRow;
  return {
    unit,
    booking:
      displayStatus === "cleaning"
        ? null
        : ({
            id: "booking-901",
            unit_id: unit.id,
            checkout_mode: "fixed",
            check_in: "2026-10-14",
            check_out: "2026-10-15",
          } as DailyBookingRow),
    customer: null,
    billing: null,
    totalPaid: 0,
    displayStatus,
    cleaningTask:
      displayStatus === "cleaning"
        ? { id: "cleaning-902", unit_id: unit.id, daily_booking_id: null, is_completed: false }
        : null,
  };
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-15T12:00:00Z"));
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      json: async () => ({
        buildingId: calendarBuilding,
        today: "2026-10-15",
        month: "2026-10",
        cash: { gross: 0, refund: 0, adjustment: 0, net: 0, count: 0, excludedCount: 0 },
        generatedAt: "2026-10-15T12:00:00Z",
      }),
    })),
  );
  mocks.rooms = [room("901", "checking_out_today"), room("902", "cleaning")];
  mocks.confirmations.clear();
  for (const write of [
    mocks.checkOut,
    mocks.completeCleaning,
    mocks.payment,
    mocks.extend,
    mocks.updateUnit,
  ])
    write.mockReset();
  mocks.completeCleaning.mockResolvedValue({ success: true });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
async function render(role: string | undefined) {
  const initialWindow = calendarWindowFixture();
  await act(async () =>
    root.render(
      <DailyRentalsResponsiveView
        dailyUnits={[]}
        bookings={[]}
        customers={[]}
        payments={[]}
        cleaningTasks={[]}
        locale="zh"
        userRole={role}
        buildings={[{ id: calendarBuilding, code: "SACSI11", display_name: "11#" }]}
        initialIsDesktop={false}
        initialWindow={initialWindow}
      />,
    ),
  );
}
async function click(label: string) {
  const button = [...document.querySelectorAll("button")].find(
    (item) => item.textContent?.trim() === label,
  );
  expect(button, `button ${label}`).toBeTruthy();
  await act(async () => button!.click());
}
function expectNoWrites() {
  for (const write of [
    mocks.checkOut,
    mocks.completeCleaning,
    mocks.payment,
    mocks.extend,
    mocks.updateUnit,
  ])
    expect(write).not.toHaveBeenCalled();
}

it.each(["finance", "boss", undefined, "unknown"])(
  "keeps %s daily mobile cards and drawer read-only",
  async (role) => {
    await render(role);
    await click("ALL ROOMS");
    expect(host.textContent).not.toContain("QUICK CHECKOUT");
    expect(host.textContent).not.toContain("QUICK CLEAN");
    await click("OPEN 901");
    const drawer = document.querySelector('[role="dialog"]')!;
    expect(drawer).toBeTruthy();
    expect(
      [...drawer.querySelectorAll("button")].filter((button) => !button.closest("[hidden]")),
    ).toHaveLength(1);
    // Even a programmatic hidden-button event cannot execute a retained mutation callback.
    await click(labels.checkOut);
    const checkout = mocks.confirmations.get(labels.checkOutConfirm)!;
    expect(checkout.open).toBe(false);
    await act(async () => checkout.onConfirm());
    expectNoWrites();
  },
);

it.each(["admin", "front_desk", "rental_sales"])(
  "preserves %s mobile checkout and cleaning callbacks",
  async (role) => {
    await render(role);
    await click("ALL ROOMS");
    expect(host.textContent).toContain("QUICK CHECKOUT 901");
    expect(host.textContent).toContain("QUICK CLEAN 902");
    await click("QUICK CHECKOUT 901");
    expect(mocks.confirmations.get(labels.checkOutConfirm)?.open).toBe(true);
    await act(async () => mocks.confirmations.get(labels.checkOutConfirm)!.onConfirm());
    expect(mocks.checkOut).toHaveBeenCalledWith("booking-901", {});
    await click("QUICK CLEAN 902");
    await act(async () => mocks.confirmations.get(labels.completeCleaning)!.onConfirm());
    expect(mocks.completeCleaning).toHaveBeenCalledWith("cleaning-902");
  },
);

it("defaults the daily-card wrapper to read-only without an explicit permission", async () => {
  await act(async () =>
    root.render(
      <MobileDailyCards
        dailyUnits={[]}
        bookings={[]}
        customers={[]}
        payments={[]}
        cleaningTasks={[]}
        locale="zh"
      />,
    ),
  );
  expect(host.textContent).not.toContain("QUICK CHECKOUT");
});
