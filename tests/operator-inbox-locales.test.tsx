// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { OperatorConfirmationPanel } from "@/features/business-actions/operator-confirmation-panel";
import { OperatorCollectionPanel } from "@/features/business-actions/operator-collection-panel";
import {
  DailyWorkflowPanel,
  type DailyWorkflowDisplay,
} from "@/features/business-actions/operator-daily-workflow-panel";
import { BookingOperationPanel } from "@/features/business-actions/operator-booking-operation-panel";
import { buildPaymentPreview } from "@/features/business-actions/operator-payment-preview";
import { previewRequest, previewSnapshot } from "./fixtures/operator-preview";
const fetchMock = vi.fn();
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
const plan: DailyWorkflowDisplay = {
  unitCode: "TEST408",
  guestName: "Synthetic guest",
  operation: "extend_and_collect",
  checkIn: "2026-10-01",
  scheduledCheckOutBefore: "2026-10-03",
  scheduledCheckOutAfter: "2026-10-05",
  actualCheckOutAfter: null,
  totalBefore: 20000,
  totalAfter: 40000,
  paidBefore: 10000,
  paidAfter: 30000,
  outstandingAfter: 10000,
  amountXof: 20000,
  paymentDate: "2026-10-02",
  paymentMethod: "cash",
  cleaningRequired: false,
};
function component(kind: string, locale: "zh" | "fr", status = "pending") {
  const shared = {
    id: "same-id",
    actor: "synthetic@example.invalid",
    expiresAt: "2026-09-15T23:59:00Z",
    locale,
  };
  if (kind === "confirmation") {
    const data = buildPaymentPreview(previewRequest(), previewSnapshot());
    if (!data.success) throw new Error("Fixture");
    return (
      <OperatorConfirmationPanel
        {...shared}
        preview={data.preview}
        completed={status === "completed"}
      />
    );
  }
  if (kind === "collection")
    return (
      <OperatorCollectionPanel
        {...shared}
        requestId="original-request"
        totalXof={10000}
        status={status}
        rows={[
          {
            lineId: "1",
            sourceText: "Original source",
            domain: "daily",
            targetId: "booking",
            totalXof: 10000,
            paymentDate: "2026-10-02",
            paymentMethod: "cash",
            unitLabel: "TEST408",
            customer: "Synthetic guest",
            contractNo: undefined,
            allocations: [
              {
                receivableId: "r1",
                amountXof: 10000,
                category: "日租",
                title: "Source title",
                dueDate: "2026-10-01",
                outstandingBeforeXof: 20000,
                outstandingAfterXof: 10000,
              },
            ],
          },
        ]}
      />
    );
  if (kind === "daily")
    return (
      <DailyWorkflowPanel
        {...shared}
        plan={plan}
        requestId="original-request"
        originalInstruction="Original source"
        status={status}
      />
    );
  return (
    <BookingOperationPanel
      {...shared}
      plan={{ operation: "check_in", unitCode: "TEST408" }}
      requestId="original-request"
      originalInstruction="Original source"
      status={status}
    />
  );
}
const paths = {
  confirmation: "/api/operator/v1/confirmations/same-id",
  collection: "/api/operator/v1/collections/same-id",
  daily: "/api/operator/v1/bookings/confirmations/same-id",
  booking: "/api/operator/v1/booking-operations/confirmations/same-id",
};
it.each(
  Object.keys(paths).flatMap((kind) => (["zh", "fr"] as const).map((locale) => ({ kind, locale }))),
)(
  "$kind $locale uses the identical original authenticated POST, without translation changing input",
  async ({ kind, locale }) => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ status: "completed", verified: true }),
    });
    await act(async () => root.render(component(kind, locale)));
    expect(fetchMock).not.toHaveBeenCalled();
    if (locale === "fr") expect(host.textContent).not.toContain("确认并入账");
    await act(async () => host.querySelector<HTMLInputElement>("input")!.click());
    await act(async () => host.querySelector<HTMLButtonElement>("button")!.click());
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(paths[kind as keyof typeof paths], {
      method: "POST",
      credentials: "same-origin",
    });
    expect(host.querySelector('[role="status"]')).not.toBeNull();
  },
);
it.each(
  ["collection", "daily", "booking"].flatMap((kind) =>
    ["unknown", "unexpected-state"].map((status) => ({ kind, status })),
  ),
)(
  "does not mistake source $status in $kind for a retryable transport failure",
  async ({ kind, status }) => {
    await act(async () => root.render(component(kind, "fr", status)));
    const button = host.querySelector<HTMLButtonElement>("button")!;
    expect(button.disabled).toBe(true);
    await act(async () => button.click());
    expect(fetchMock).not.toHaveBeenCalled();
  },
);
it.each(["confirmation", "collection", "daily", "booking"])(
  "preserves completed $kind history without fresh-check claims or re-execution",
  async (kind) => {
    await act(async () => root.render(component(kind, "fr", "completed")));
    expect(host.querySelector("button")).toBeNull();
    expect(host.textContent).toContain("déjà");
    expect(fetchMock).not.toHaveBeenCalled();
  },
);
it("keeps French re-login on the exact same localized confirmation", async () => {
  fetchMock.mockResolvedValue({
    ok: false,
    json: async () => ({ code: "missing_or_invalid_session" }),
  });
  await act(async () => root.render(component("confirmation", "fr")));
  await act(async () => host.querySelector<HTMLInputElement>("input")!.click());
  await act(async () => host.querySelector<HTMLButtonElement>("button")!.click());
  expect(host.textContent).toContain("La session a expiré");
  expect(host.querySelector("a")?.getAttribute("href")).toBe(
    "/login?redirect=%2Ffr%2Foperator%2Fconfirmations%2Fsame-id",
  );
});
