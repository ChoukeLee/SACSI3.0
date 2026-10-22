import { describe, expect, it } from "vitest";
import {
  nativeMoney,
  parseNativeCollection,
  parseNativeSelector,
} from "@/features/business-actions/operator-native-collection";
import { verifyNativeCollectionResult } from "@/features/business-actions/operator-native-collection-verification";
import { buildOperatorProtocolManifest } from "@/features/business-actions/operator-protocol";
import { nativeIds, nativeRequest, nativeResult } from "./fixtures/native-collection";

describe("exact original currency collection contract", () => {
  it.each(["USD", "CNY"])(
    "preserves %s with exact decimal allocation and no XOF slot",
    (currency) => {
      const value = nativeRequest();
      value.currency = currency as "USD" | "CNY";
      value.amount = "0.3";
      value.allocations = [
        { receivableId: nativeIds.receivable, amount: "0.1" },
        { receivableId: nativeIds.audit, amount: "0.2" },
      ];
      expect(parseNativeCollection(value)).toMatchObject({
        currency,
        amount: "0.30",
        allocations: [
          { receivableId: nativeIds.receivable, amount: "0.10" },
          { receivableId: nativeIds.audit, amount: "0.20" },
        ],
      });
      expect(JSON.stringify(parseNativeCollection(value))).not.toMatch(/amountXof|exchangeRate/);
    },
  );
  it.each([
    0.3,
    "0",
    "-1",
    "+1",
    "01.25",
    "1e3",
    "NaN",
    "Infinity",
    "1.001",
    " 1.00",
    "1000000000000",
  ])("rejects invalid money %j", (value) => {
    expect(() => nativeMoney(value)).toThrow("invalidNativeCollection");
  });
  it("accepts the exact supported bound without rounding", () =>
    expect(nativeMoney("999999999999.99")).toBe("999999999999.99"));
  it.each([
    { currency: "XOF" },
    { currency: "EUR" },
    { currency: ["USD"] },
    { inputSource: ["natural_language"] },
    { paymentMethod: ["cash"] },
    { exchangeRateToXof: 1 },
    { amountXof: 100 },
    { actorId: nativeIds.actor },
    { humanConfirmed: true },
    { connectorVersion: "0.6.0" },
    { paymentDate: "2026-02-30" },
    { paymentDate: "2999-01-01" },
    { paymentMethod: "offset" },
    { actualCollector: "明确事实未配依据" },
    { collectorBasis: "只有依据" },
  ])("rejects wrong currency, authority injection or incomplete source facts: %j", (patch) => {
    expect(() => parseNativeCollection({ ...nativeRequest(), ...patch })).toThrow();
  });
  it("rejects a duplicate item and unequal sum instead of silently dropping rows", () => {
    const value = nativeRequest();
    expect(() =>
      parseNativeCollection({
        ...value,
        allocations: [...value.allocations, ...value.allocations],
      }),
    ).toThrow();
    expect(() => parseNativeCollection({ ...value, amount: "100.24" })).toThrow();
  });
  it("preserves explicit screenshot provenance and never invents collector or coverage", () => {
    const value = parseNativeCollection({ ...nativeRequest(), inputSource: "excel_screenshot" });
    expect(value.inputSource).toBe("excel_screenshot");
    expect(value).not.toHaveProperty("actualCollector");
    expect(value).not.toHaveProperty("coverage");
  });
  it("requires explicit complete coverage proof, independently from a cash receipt", () => {
    expect(() =>
      parseNativeCollection({ ...nativeRequest(), coverage: { throughDate: "2026-11-30" } }),
    ).toThrow();
  });
  it("does not guess which contract when the selector mixes identifiers", () => {
    expect(parseNativeSelector({ buildingCode: "11", unitNo: "503" })).toEqual({
      buildingCode: "11",
      unitNo: "503",
    });
    expect(() => parseNativeSelector({ contractId: nativeIds.contract, unitNo: "503" })).toThrow();
    expect(() => parseNativeSelector({ buildingCode: "11" })).toThrow();
  });
  it("advertises 0.7 only when the installed native workflow is actually available", () => {
    const user = {
      id: nativeIds.actor,
      email: "synthetic@invalid",
      displayName: "Synthetic",
      role: "admin" as const,
    };
    expect(
      buildOperatorProtocolManifest({ user, directWorkflows: ["collection"] })
        .minimumConnectorVersion,
    ).toBe("0.6.0");
    const native = buildOperatorProtocolManifest({
      user,
      directWorkflows: ["collection", "native_collection"],
    });
    expect(native.minimumConnectorVersion).toBe("0.7.0");
    expect(native.directExecution.workflows).toContain("native_collection");
  });
});

describe("native collection result evidence", () => {
  it("accepts one verified native receipt with zero XOF valuation and unchanged coverage", () => {
    expect(verifyNativeCollectionResult(nativeResult(), nativeRequest(), nativeIds.actor)).toBe(
      true,
    );
  });
  it.each([
    (r: ReturnType<typeof nativeResult>) => {
      r.verified = false;
    },
    (r: ReturnType<typeof nativeResult>) => {
      r.currency = "CNY";
    },
    (r: ReturnType<typeof nativeResult>) => {
      r.amount = "100.24";
    },
    (r: ReturnType<typeof nativeResult>) => {
      r.allocations[0].amount = "100.24";
    },
    (r: ReturnType<typeof nativeResult>) => {
      r.verification.checks.audit = false;
    },
    (r: ReturnType<typeof nativeResult>) => {
      r.verification.payments[0].recordedBy = nativeIds.contract;
    },
    (r: ReturnType<typeof nativeResult>) => {
      r.verification.payments[0].nativeSettlement = false;
    },
    (r: ReturnType<typeof nativeResult>) => {
      r.verification.ledger[0].amountXof = "100.25";
    },
    (r: ReturnType<typeof nativeResult>) => {
      r.verification.receivables[0].paidAfter = "100.24";
    },
    (r: ReturnType<typeof nativeResult>) => {
      r.verification.allocations = [];
    },
    (r: ReturnType<typeof nativeResult>) => {
      r.paymentIds.push(nativeIds.audit);
    },
    (r: ReturnType<typeof nativeResult>) => {
      r.verification.audit.channel = "sacsi_web";
    },
    (r: ReturnType<typeof nativeResult>) => {
      r.paidThroughAfter = "2026-11-30";
    },
  ])("fails closed on a mismatched or incomplete financial result %#", (change) => {
    const value = nativeResult();
    change(value);
    expect(verifyNativeCollectionResult(value, nativeRequest(), nativeIds.actor)).toBe(false);
  });
});
