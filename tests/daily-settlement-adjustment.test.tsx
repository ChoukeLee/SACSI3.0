// @vitest-environment jsdom
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DailyBookingRow, UnitRow } from "@/types/database";
import { calculateBilling } from "@/features/daily-rentals/billing";
import {
  computeBookingAmountState,
  computeFinanceState,
} from "@/features/daily-rentals/daily-rental-finance";
import { scanDailyRentalIssues } from "@/features/daily-rentals/daily-rental-audit";
import { DailyWorkbenchInspector } from "@/features/daily-rentals/daily-workbench-inspector";
import { printDailyReceipt } from "@/features/print/print-templates";
import { calendarWindowFixture } from "./fixtures/calendar-window";

function booking(overrides: Partial<DailyBookingRow> = {}): DailyBookingRow {
  return {
    id: "synthetic-agreed-settlement",
    unit_id: "synthetic-room",
    customer_id: "synthetic-agent",
    check_in: "2026-09-26",
    check_out: "2026-10-10",
    actual_check_out: "2026-10-09",
    checkout_mode: "fixed",
    status: "checked_out",
    nightly_price_xof: 40000,
    total_amount_xof: 520000,
    settlement_adjustment_amount_xof: 40000,
    settlement_adjustment_reason: "双方约定以560000西法结清",
    manual_discount_amount_xof: 0,
    manual_discount_reason: null,
    final_amount_xof: 560000,
    prepaid_amount_xof: 560000,
    billing_status: "settled",
    ota_source: null,
    notes: null,
    created_at: "2026-09-26T00:00:00Z",
    updated_at: "2026-10-29T00:00:00Z",
    ...overrides,
  };
}
const unit = {
  id: "synthetic-room",
  code: "SACSI5-101",
  unit_no: "101",
  status: "available",
} as UnitRow;
afterEach(() => vi.unstubAllGlobals());

describe("explicit agreed settlement adjustment", () => {
  it("explains thirteen nights at 40000 plus the agreed 40000 adjustment as 560000 settled", () => {
    const b = booking();
    expect(calculateBilling(b, "2026-10-29")).toMatchObject({
      nights: 13,
      grossAmount: 520000,
      settlementAdjustment: 40000,
      discount: 0,
      finalAmount: 560000,
      paid: 560000,
      outstanding: 0,
      effectiveCheckOut: "2026-10-09",
    });
    expect(computeBookingAmountState(b)).toMatchObject({
      nights: 13,
      grossAmount: 520000,
      settlementAdjustment: 40000,
      discount: 0,
      finalAmount: 560000,
      effectiveCheckOut: "2026-10-09",
    });
    expect(computeFinanceState(b, [{ amount: 560000 }])).toMatchObject({
      settlementAdjustment: 40000,
      finalAmount: 560000,
      paidAmount: 560000,
      balanceDue: 0,
      billingStatus: "settled",
    });
  });
  it("keeps stored final priority while including adjustment in fallback and separate discounts", () => {
    expect(calculateBilling(booking({ final_amount_xof: 570000 })).finalAmount).toBe(570000);
    const fallback = booking({ final_amount_xof: null, manual_discount_amount_xof: 10000 });
    expect(calculateBilling(fallback)).toMatchObject({
      settlementAdjustment: 40000,
      discount: 10000,
      finalAmount: 550000,
    });
    expect(computeBookingAmountState(fallback).finalAmount).toBe(550000);
    expect(
      calculateBilling(
        booking({
          settlement_adjustment_amount_xof: undefined,
          settlement_adjustment_reason: undefined,
          final_amount_xof: null,
        }),
      ).finalAmount,
    ).toBe(520000);
  });
  it("includes the adjustment when an open running stay is recalculated", () => {
    const b = booking({
      checkout_mode: "open",
      status: "checked_in",
      check_out: null,
      actual_check_out: null,
      total_amount_xof: 40000,
      final_amount_xof: 40000,
    });
    expect(calculateBilling(b, "2026-10-09")).toMatchObject({
      nights: 13,
      grossAmount: 520000,
      finalAmount: 560000,
    });
    expect(computeBookingAmountState(b, "2026-10-09")).toMatchObject({
      nights: 13,
      grossAmount: 520000,
      finalAmount: 560000,
    });
  });
  it("preserves computed room charges as the fallback when the final amount is absent", () => {
    const b = booking({
      total_amount_xof: 100000,
      final_amount_xof: null,
      manual_discount_amount_xof: 10000,
    });
    expect(calculateBilling(b, "2026-10-29")).toMatchObject({
      nights: 13,
      grossAmount: 520000,
      settlementAdjustment: 40000,
      discount: 10000,
      finalAmount: 550000,
    });
  });
  it("does not flag the explained settlement as a finance error, but detects a missing adjustment", () => {
    const b = booking();
    const scan = (row: DailyBookingRow) =>
      scanDailyRentalIssues({
        dailyBookings: [{ ...row }],
        units: [],
        payments: [],
        receivables: [],
        cleaningTasks: [],
        ledgerEntries: [],
        auditLogs: [],
      }).filter((issue) => issue.id.startsWith("dr_fin_amount_"));
    expect(scan(b)).toEqual([]);
    expect(scan({ ...b, settlement_adjustment_amount_xof: 0 })).toEqual([
      expect.objectContaining({ description: expect.stringContaining("约定结算调整 0") }),
    ]);
  });
  it.each(["zh", "fr"] as const)(
    "shows the adjustment and its reason in the %s detail inspector",
    (locale) => {
      const b = booking();
      const data = calendarWindowFixture({
        bookings: [b],
        bookingCount: 1,
        dailyUnits: [unit],
        unitLookupUnits: [unit],
        payments: [
          {
            id: "payment",
            source_id: b.id,
            amount: 560000,
            currency: "XOF",
            exchange_rate_to_xof: 1,
            payment_date: "2026-10-09",
            reversal_of_payment_id: null,
            request_kind: null,
          },
        ],
      });
      const html = renderToStaticMarkup(
        <DailyWorkbenchInspector
          data={data}
          unit={unit}
          booking={b}
          locale={locale}
          today="2026-10-29"
          from="2026-09-26"
          to="2026-10-09"
          onOperate={() => {}}
        />,
      );
      expect(html).toContain(locale === "zh" ? "约定结算调整" : "Ajustement de règlement convenu");
      expect(html).toContain(b.settlement_adjustment_reason);
      expect(html).not.toContain("其他费用");
    },
  );
  it.each(["zh", "fr"] as const)(
    "prints the true departure and an escaped, distinct settlement adjustment (%s)",
    (locale) => {
      const write = vi.fn();
      vi.stubGlobal("window", {
        open: vi.fn(() => ({
          document: { write, close: vi.fn() },
          focus: vi.fn(),
          print: vi.fn(),
        })),
      });
      printDailyReceipt(
        {
          booking: booking({ settlement_adjustment_reason: "约定结清 <script>unsafe()</script>" }),
          unit,
          customer: null,
        },
        locale,
      );
      const html = write.mock.calls[0][0] as string;
      expect(html).toContain(locale === "zh" ? "约定结算调整" : "Ajustement de règlement convenu");
      expect(html).toContain("2026-10-09");
      expect(html).not.toContain("2026-10-10");
      expect(html).toContain("13");
      expect(html).toContain("520,000");
      expect(html).toContain("560,000");
      expect(html).toContain("+40,000");
      expect(html).not.toContain("-40,000");
      expect(html).toContain("&lt;script&gt;");
      expect(html).not.toContain("<script>");
      expect(html).not.toContain(locale === "zh" ? "待付余额" : "Solde");
    },
  );
});
