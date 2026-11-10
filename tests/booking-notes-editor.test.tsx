// @vitest-environment jsdom
import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { BookingNotesEditor } from "@/features/daily-rentals/booking-notes-editor";
import { DAILY_DATA_CHANGED } from "@/features/daily-rentals/daily-read-invalidation";

const { saveBookingNotes, refresh } = vi.hoisted(() => ({
  saveBookingNotes: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock("@/features/daily-rentals/booking-notes-action", () => ({ saveBookingNotes }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

type EditorProps = ComponentProps<typeof BookingNotesEditor>;
const booking = { id: "booking-1", unit_id: "room-1", notes: null };
const buildingId = "building-1";
const invalidate = vi.fn();
let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  saveBookingNotes.mockReset();
  refresh.mockClear();
  invalidate.mockClear();
  window.addEventListener(DAILY_DATA_CHANGED, invalidate);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  window.removeEventListener(DAILY_DATA_CHANGED, invalidate);
  vi.unstubAllGlobals();
});

async function render(overrides: Partial<EditorProps> = {}) {
  await act(async () =>
    root.render(
      <BookingNotesEditor
        booking={booking}
        buildingId={buildingId}
        locale="zh"
        readOnly={false}
        {...overrides}
      />,
    ),
  );
}

async function click(label: string) {
  const button = Array.from(host.querySelectorAll("button")).find(
    (candidate) => candidate.textContent === label,
  );
  expect(button).toBeDefined();
  await act(async () => button!.click());
}

function draft() {
  const textarea = host.querySelector("textarea");
  expect(textarea).not.toBeNull();
  return textarea!;
}

async function typeNote(value: string) {
  await act(async () => {
    const textarea = draft();
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
    setter.call(textarea, value);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

it("adds a note, displays the saved text immediately and refreshes the selected building", async () => {
  saveBookingNotes.mockResolvedValueOnce({ status: "saved", notes: "到店后联系前台" });
  await render();
  expect(host.textContent).toContain("暂无备注");

  await click("添加备注");
  expect(draft().value).toBe("");
  await typeNote("到店后联系前台");
  await click("保存备注");

  expect(saveBookingNotes).toHaveBeenCalledExactlyOnceWith({
    bookingId: booking.id,
    unitId: booking.unit_id,
    expectedNotes: null,
    notes: "到店后联系前台",
  });
  expect(host.querySelector("textarea")).toBeNull();
  expect(host.textContent).toContain("到店后联系前台");
  expect(host.querySelector('[role="status"]')?.textContent).toBe("备注已保存");
  expect(refresh).toHaveBeenCalledTimes(1);
  expect(invalidate).toHaveBeenCalledTimes(1);
  expect(invalidate.mock.calls[0][0].detail).toEqual({ buildingId });
});

it("keeps the draft on conflict and resubmits only after review against the latest note", async () => {
  saveBookingNotes
    .mockResolvedValueOnce({ status: "conflict", notes: "同事补充的备注" })
    .mockResolvedValueOnce({ status: "saved", notes: "我核对后的备注" });
  await render({ booking: { ...booking, notes: "原备注" } });

  await click("修改备注");
  expect(draft().value).toBe("原备注");
  await typeNote("我的草稿");
  await click("保存备注");

  expect(saveBookingNotes).toHaveBeenCalledExactlyOnceWith({
    bookingId: booking.id,
    unitId: booking.unit_id,
    expectedNotes: "原备注",
    notes: "我的草稿",
  });
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("同事补充的备注");
  expect(draft().value).toBe("我的草稿");
  expect(refresh).not.toHaveBeenCalled();
  expect(invalidate).not.toHaveBeenCalled();

  await typeNote("我核对后的备注");
  await click("核对后保存");

  expect(saveBookingNotes).toHaveBeenCalledTimes(2);
  expect(saveBookingNotes).toHaveBeenLastCalledWith({
    bookingId: booking.id,
    unitId: booking.unit_id,
    expectedNotes: "同事补充的备注",
    notes: "我核对后的备注",
  });
  expect(host.textContent).toContain("我核对后的备注");
});

it("shows the historical marker in read-only French without a write control", async () => {
  await render({
    booking: { ...booking, notes: "[历史补录] Raison historique" },
    locale: "fr",
    readOnly: true,
  });
  expect(host.querySelector('section[aria-label="Note de réservation"]')).not.toBeNull();
  expect(host.textContent).toContain("Saisie historique");
  expect(host.textContent).toContain("Raison historique");
  expect(host.querySelector("button, textarea")).toBeNull();
  expect(saveBookingNotes).not.toHaveBeenCalled();
});

it("keeps the historical marker out of the editable text and in the exact expected note", async () => {
  saveBookingNotes.mockResolvedValueOnce({ status: "saved", notes: "[历史补录] 更新说明" });
  await render({ booking: { ...booking, notes: "[历史补录] 原说明" } });

  await click("修改备注");
  expect(draft().value).toBe("原说明");
  expect(host.textContent).toContain("历史补录");
  await typeNote("更新说明");
  await click("保存备注");

  expect(saveBookingNotes).toHaveBeenCalledExactlyOnceWith({
    bookingId: booking.id,
    unitId: booking.unit_id,
    expectedNotes: "[历史补录] 原说明",
    notes: "更新说明",
  });
  expect(host.textContent).toContain("历史补录");
  expect(host.textContent).toContain("更新说明");
});

it.each([
  ["the selected booking", { id: "booking-2", unit_id: booking.unit_id }],
  ["the selected room", { id: booking.id, unit_id: "room-2" }],
] as const)("discards the previous draft when %s changes", async (_label, target) => {
  await render();
  await click("添加备注");
  await typeNote("原订单未提交草稿");

  const nextBooking = { ...target, notes: "当前订单备注" };
  await render({ booking: nextBooking });
  expect(host.querySelector("textarea")).toBeNull();
  expect(host.textContent).not.toContain("原订单未提交草稿");
  expect(saveBookingNotes).not.toHaveBeenCalled();

  saveBookingNotes.mockResolvedValueOnce({ status: "saved", notes: "当前订单更新" });
  await click("修改备注");
  expect(draft().value).toBe("当前订单备注");
  await typeNote("当前订单更新");
  await click("保存备注");
  expect(saveBookingNotes).toHaveBeenCalledExactlyOnceWith({
    bookingId: target.id,
    unitId: target.unit_id,
    expectedNotes: "当前订单备注",
    notes: "当前订单更新",
  });
});
