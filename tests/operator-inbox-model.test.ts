import { describe, it, expect } from "vitest";
import {
  decodeOperatorInboxResult,
  parseOperatorInboxQuery,
  operatorInboxHref,
  operatorInboxItemHref,
  operatorInboxFilters,
  type OperatorInboxItem,
} from "@/features/business-actions/operator-inbox-model";
const id = "11111111-1111-4111-8111-111111111111",
  requestId = "22222222-2222-4222-8222-222222222222";
function row(changes: Partial<OperatorInboxItem> = {}) {
  return {
    id,
    requestId,
    kind: "confirmations",
    sourceStatus: "completed",
    state: "completed",
    createdAt: "2026-01-01T00:00:00Z",
    expiresAt: "2026-01-02T00:00:00Z",
    unitNo: "408",
    buildingLabel: "4#",
    operation: null,
    itemCount: null,
    ...changes,
  } as OperatorInboxItem;
}
function result(item = row()) {
  return {
    page: 1,
    pageSize: 30,
    total: 1,
    counts: {
      all: 1,
      pending: 0,
      completed: 0,
      expired: 0,
      superseded: 0,
      unknown: 0,
      [item.state]: 1,
    },
    items: [item],
  };
}
describe("strict own-account inbox query", () => {
  it("defaults to the full authorized own scope, not a recent100 window", () => {
    expect(parseOperatorInboxQuery({})).toEqual({
      state: "all",
      kind: "all",
      search: "",
      dateFrom: "",
      dateTo: "",
      page: 1,
    });
  });
  it.each([
    { page: "0" },
    { page: "-1" },
    { page: "1.5" },
    { page: "2000001" },
    { state: "executing" },
    { kind: "all_users" },
    { search: "%" },
    { search: "somebody@example.com" },
    { dateFrom: "2026-02-30" },
    { dateTo: "2026-04-31" },
    { dateFrom: "2026-10-20", dateTo: "2026-10-01" },
    { page: ["1", "2"] },
    { actorId: id },
  ])("rejects invalid or identity-expanding params %j", (data) => {
    expect(() => parseOperatorInboxQuery(data)).toThrow("InvalidOperatorInboxQuery");
  });
  it("preserves dates, state and business filters while paging and keeps the locale", () => {
    const query = parseOperatorInboxQuery({
      state: "completed",
      kind: "collections",
      search: requestId.toUpperCase(),
      dateFrom: "2026-01-01",
      dateTo: "2026-10-20",
      page: "4",
    });
    expect(operatorInboxHref(query, "fr", { page: 3 })).toBe(
      `/fr/operator?state=completed&kind=collections&search=${requestId}&dateFrom=2026-01-01&dateTo=2026-10-20&page=3`,
    );
    expect(operatorInboxFilters(query)).not.toHaveProperty("page");
  });
});
describe("complete page decoding and status evidence", () => {
  it("preserves completed records even when their original expiry has passed", () => {
    expect(decodeOperatorInboxResult(result(), parseOperatorInboxQuery({})).items[0].state).toBe(
      "completed",
    );
  });
  it("keeps unknown source statuses explicitly unknown, without an execution entry", () => {
    const item = row({ state: "unknown", sourceStatus: "future-status" });
    expect(
      decodeOperatorInboxResult(result(item), parseOperatorInboxQuery({})).items[0].state,
    ).toBe("unknown");
    expect(operatorInboxItemHref(item, "fr")).toBeNull();
  });
  it.each([
    { pageSize: 100 },
    { total: 2 },
    { items: [] },
    { counts: { all: 1, pending: 1, completed: 1, expired: 0, superseded: 0, unknown: 0 } },
    { items: [row({ state: "expired" })] },
  ])("rejects incomplete/mislabelled responses %j", (change) => {
    expect(() =>
      decodeOperatorInboxResult({ ...result(), ...change }, parseOperatorInboxQuery({})),
    ).toThrow("OperatorInboxReadUnavailable");
  });
  it("allows a genuinely empty out-of-range page without falsely reducing the total", () => {
    const value = { ...result(), page: 2, items: [] };
    expect(decodeOperatorInboxResult(value, parseOperatorInboxQuery({ page: "2" })).total).toBe(1);
  });
  it.each(["confirmations", "collections", "daily-workflows", "booking-operations"] as const)(
    "links %s to its unchanged localized confirmation",
    (kind) => {
      expect(operatorInboxItemHref(row({ kind }), "fr")).toBe(`/fr/operator/${kind}/${id}`);
    },
  );
});
