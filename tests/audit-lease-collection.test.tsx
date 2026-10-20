import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  auditBusinessSummary,
  auditLeaseCollectionEvidence,
  auditNativeMoney,
} from "@/features/settings/audit-business-summary";
import { AuditBusinessDetail } from "@/features/settings/audit-business-detail";
import { auditFixture } from "./fixtures/audit-display";

function collection() {
  return auditFixture({
    action: "record_lease_collection",
    entity_type: "lease_collection",
    actor_email: "recorded@example.invalid",
    before_data: {
      paidThroughDate: "2026-08-31",
      receivables: [
        {
          id: "bill-1",
          title: "历史租金",
          category: "lease_rent",
          service_period_start: "2026-09-01",
          service_period_end: null,
        },
      ],
    },
    after_data: {
      success: true,
      requestId: "saved-request",
      currency: "USD",
      totalAmount: 123.45,
      paymentIds: ["payment-1"],
      referenceNos: ["L-001"],
      paidThroughBefore: "2026-08-31",
      paidThroughAfter: "2026-08-31",
      allocations: [
        { receivableId: "bill-1", amount: 123.45, currency: "USD", paymentId: "payment-1" },
      ],
    },
    metadata: {
      channel: "sacsi_web",
      request_id: "input-request",
      paid_through_unchanged: true,
      input: {
        currency: "XOF",
        amount: 999999,
        actualCollector: "黄姐",
        collectorBasis: "凭证署名",
        paymentDate: "2026-09-15",
        paymentMethod: "bank_transfer",
        externalReceiptNo: "BANK-001",
        notes: "只记录原币",
      },
    },
  });
}

describe("lease collection audit evidence", () => {
  it("uses persisted original currency, not an input amount or XOF slot", () => {
    const info = auditBusinessSummary(collection(), "zh");
    expect(info.paymentAmount).toBe("123.45 USD");
    expect(info.summary).toBe("登记长租实收并核销 123.45 USD");
    expect(info.requestId).toBe("saved-request");
    expect(info.leaseCollection?.actualCollector).toBe("黄姐");
    expect(info.actor).toContain("recorded@example.invalid");
    expect(info.actor).not.toContain("黄姐");
    expect(info.receiptNo).toBe("L-001");
    expect(info.leaseCollection?.externalReceiptNo).toBe("BANK-001");
  });
  it("does not turn a list projection or an input-only log into confirmed money", () => {
    const log = collection();
    expect(auditBusinessSummary({ ...log, after_data: null }, "zh").paymentAmount).toBe("");
    expect(
      auditBusinessSummary({ ...log, after_data: { ...log.after_data, success: false } }, "fr")
        .paymentAmount,
    ).toBe("");
    expect(auditBusinessSummary({ ...log, actor_id: null, actor_email: null }, "zh").actor).toBe(
      "未记录登录账号",
    );
  });
  it("reads only the server's saved-result projection on a paged list", () => {
    const log = collection();
    const list = {
      ...log,
      before_data: null,
      after_data: null,
      metadata: {
        ...log.metadata,
        collection_result: {
          success: true,
          currency: "USD",
          totalAmount: 123.45,
          referenceNos: ["L-001"],
          paymentIds: ["payment-1"],
          requestId: "saved-request",
        },
        collection_input: { actualCollector: "黄姐", externalReceiptNo: "BANK-001" },
        amount: 0,
      },
    };
    expect(auditBusinessSummary(list, "zh")).toMatchObject({
      paymentAmount: "123.45 USD",
      receiptNo: "L-001",
    });
    expect(auditBusinessSummary(list, "zh").leaseCollection?.allocations).toHaveLength(0);
    // A missing after_data field in a detail is not repaired with user input.
    expect(
      auditBusinessSummary({ ...log, after_data: {}, metadata: list.metadata }, "zh").paymentAmount,
    ).toBe("");
  });
  it("keeps actual unchanged coverage and incomplete service periods", () => {
    const info = auditLeaseCollectionEvidence(collection(), "zh")!;
    expect(info.paidThroughBefore).toBe("2026-08-31");
    expect(info.paidThroughAfter).toBe("2026-08-31");
    expect(info.coverageStatus).toBe("保持不变");
    expect(info.allocations[0]).toMatchObject({
      amount: "123.45 USD",
      servicePeriodStart: "2026-09-01",
      servicePeriodEnd: "",
      paymentId: "payment-1",
    });
  });
  it("shows actual explicit coverage result, not the requested target", () => {
    const log = collection();
    const info = auditLeaseCollectionEvidence(
      {
        ...log,
        metadata: {
          ...log.metadata,
          coverage_explicitly_confirmed: true,
          input: { coverage: { throughDate: "2027-12-31" } },
        },
        after_data: {
          ...log.after_data,
          paidThroughAfter: "2026-09-30",
          coverage: { throughDate: "2026-09-30", receivableIds: ["bill-1"] },
        },
      },
      "fr",
    )!;
    expect(info.paidThroughAfter).toBe("2026-09-30");
    expect(info.coverageStatus).toContain("confirmation explicite");
  });
  it("does not certify an inconsistent or missing coverage snapshot as unchanged", () => {
    const log = collection();
    expect(
      auditLeaseCollectionEvidence(
        { ...log, after_data: { ...log.after_data, paidThroughAfter: "2026-09-30" } },
        "zh",
      )?.coverageStatus,
    ).toBe("未记录同步结论");
    expect(
      auditLeaseCollectionEvidence(
        { ...log, after_data: { ...log.after_data, paidThroughAfter: undefined } },
        "zh",
      )?.paidThroughAfter,
    ).toBe("未记录");
    expect(
      auditLeaseCollectionEvidence(
        {
          ...log,
          after_data: { ...log.after_data, paidThroughBefore: null, paidThroughAfter: null },
        },
        "zh",
      ),
    ).toMatchObject({
      paidThroughBefore: "未设置",
      paidThroughAfter: "未设置",
      coverageStatus: "保持不变",
    });
  });
  it("keeps each allocation's explicit currency and does not invent a missing currency", () => {
    const log = collection();
    const info = auditLeaseCollectionEvidence(
      {
        ...log,
        after_data: {
          ...log.after_data,
          allocations: [
            { receivableId: "first", currency: "CNY", amount: 10.5 },
            { receivableId: "second", amount: 100 },
          ],
        },
      },
      "zh",
    )!;
    expect(info.allocations.map((row) => row.amount)).toEqual(["10.5 CNY", "—"]);
    expect(info.amount).toBe("123.45 USD");
  });
  it("renders named collector, allocation facts and missing dates in both languages", () => {
    for (const locale of ["zh", "fr"] as const) {
      const html = renderToStaticMarkup(<AuditBusinessDetail log={collection()} locale={locale} />);
      for (const fact of [
        locale === "zh" ? "123.45 USD" : "123,45 USD",
        "黄姐",
        "凭证署名",
        "payment-1",
        "L-001",
        "BANK-001",
        "2026-08-31",
        "2026-09-01",
      ])
        expect(html).toContain(fact);
      expect(html).not.toContain("999,999 XOF");
      expect(html).toContain(locale === "zh" ? "止日未记录" : "Fin non enregistrée");
    }
  });
  it.each([true, {}, "1e3", -1, 0.001, Infinity, "", " 1", "1.999"])(
    "rejects non-exact financial evidence %j",
    (value) => expect(auditNativeMoney(value, "USD", "zh")).toBe("—"),
  );
  it("requires an explicit supported currency and preserves recorded zero", () => {
    expect(auditNativeMoney(100, null, "zh")).toBe("—");
    expect(auditNativeMoney(0, "CNY", "zh")).toBe("0 CNY");
    expect(auditNativeMoney("123.45", "USD", "fr")).toContain("123,45 USD");
  });
  it.each(["zh", "fr"] as const)(
    "does not certify a historical actor label as verified authentication in %s",
    (locale) => {
      const html = renderToStaticMarkup(
        <AuditBusinessDetail
          log={auditFixture({ actor_id: null, actor_email: "legacy-maintenance@example.invalid" })}
          locale={locale}
        />,
      );
      expect(html).toContain(
        locale === "zh" ? "操作账号（历史记录）" : "Compte opérateur enregistré",
      );
      expect(html).toContain("legacy-maintenance@example.invalid");
      expect(html).not.toContain(locale === "zh" ? "系统认证" : "(authentifié)");
    },
  );
});
