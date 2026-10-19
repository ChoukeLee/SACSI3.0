import { describe, expect, it } from "vitest";
import {
  parseReportQuery,
  reportExportHref,
  reportFinanceFilters,
  reportHref,
} from "@/features/reports/report-read";

const projectId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const asOf = "2026-10-19";
const query = (params: Record<string, string | string[] | undefined> = {}) =>
  parseReportQuery({ projectId, ...params }, asOf);

describe("financial checking query boundaries", () => {
  it("requires an explicit valid project before asking for financial records", () => {
    const parsed = parseReportQuery({}, asOf);
    expect(parsed.month).toBe("2026-10");
    expect(() => reportFinanceFilters(parsed)).toThrow("Report project required");
    expect(parseReportQuery({}, asOf, projectId).projectId).toBe(projectId);
    expect(() => query({ projectId: "all" })).toThrow("Invalid report project");
  });

  it.each([
    ["kind", ["ledger", "receivables"]],
    ["projectId", [projectId, projectId]],
    ["month", ["2026-10", "2026-09"]],
    ["page", ["1", "2"]],
    ["search", ["408", "202"]],
    ["direction", ["income", "expense"]],
    ["management", ["managed", "historical_pending"]],
    ["outstandingOnly", ["true", "false"]],
  ])("rejects duplicated %s rather than silently taking one scope", (key, value) => {
    expect(() => query({ [key]: value })).toThrow("Duplicate report filter");
  });

  it.each([
    { kind: "cash" },
    { month: "2026-13" },
    { month: "2026-00" },
    { month: "2026-1" },
    { month: "0099-01" },
    { page: "0" },
    { page: "1.5" },
    { page: "2000001" },
    { search: "a".repeat(151) },
    { direction: "net" },
    { management: "all" },
    { outstandingOnly: "1" },
  ])("rejects malformed or unsupported report filters %j", (params) => {
    expect(() => query(params)).toThrow();
  });

  it.each([
    ["2026-10", "2026-10-31"],
    ["2026-02", "2026-02-28"],
    ["2028-02", "2028-02-29"],
    ["2026-12", "2026-12-31"],
  ])("uses the complete selected month %s without changing project scope", (month, end) => {
    expect(reportFinanceFilters(query({ month, search: "  408  ", direction: "income" }))).toEqual({
      projectId,
      dateFrom: `${month}-01`,
      dateTo: end,
      search: "408",
      direction: "income",
    });
  });

  it("never mistakes a selected ledger month for a historical receivable snapshot", () => {
    const receivables = query({
      kind: "receivables",
      month: "2020-01",
      direction: "income",
      management: "historical_pending",
      outstandingOnly: "true",
      search: "408",
    });
    expect(receivables.direction).toBe("");
    expect(reportFinanceFilters(receivables)).toEqual({
      projectId,
      search: "408",
      management: "historical_pending",
      outstandingOnly: "true",
    });
    expect(reportFinanceFilters(receivables)).not.toHaveProperty("dateFrom");
    expect(reportFinanceFilters(receivables)).not.toHaveProperty("dateTo");
  });

  it("keeps historical and excluded receivables in explicit separate scopes", () => {
    for (const management of ["managed", "historical_pending", "excluded"]) {
      expect(reportFinanceFilters(query({ kind: "receivables", management }))).toEqual({
        projectId,
        management,
      });
    }
    expect(query({ kind: "receivables", outstandingOnly: "false" }).outstandingOnly).toBe(false);
    expect(
      reportFinanceFilters(query({ kind: "ledger", outstandingOnly: "true" })),
    ).not.toHaveProperty("outstandingOnly");
  });

  it("retains complete scope and literal searches when paging or exporting", () => {
    const original = query({ page: "7", search: "exact%_ & 408", direction: "expense" });
    const paged = new URL(reportHref(original, { page: 8 }), "https://sacsi.example");
    expect(Object.fromEntries(paged.searchParams)).toEqual({
      kind: "ledger",
      projectId,
      month: "2026-10",
      page: "8",
      search: "exact%_ & 408",
      direction: "expense",
    });
    const exported = new URL(reportExportHref(original), "https://sacsi.example");
    expect(exported.pathname).toBe("/api/reports/export");
    expect(
      reportFinanceFilters(parseReportQuery(Object.fromEntries(exported.searchParams), asOf)),
    ).toEqual(reportFinanceFilters(original));
    expect(original.page).toBe(7);
  });

  it("resets pagination on scope changes and drops stale view-specific filters", () => {
    const original = query({ page: "7", direction: "income", search: "408" });
    const changed = new URL(
      reportHref(original, { kind: "receivables", management: "historical_pending" }),
      "https://sacsi.example",
    );
    expect(changed.searchParams.get("page")).toBe("1");
    expect(changed.searchParams.get("projectId")).toBe(projectId);
    expect(changed.searchParams.get("search")).toBe("408");
    expect(changed.searchParams.get("management")).toBe("historical_pending");
    expect(changed.searchParams.has("direction")).toBe(false);
    expect(
      new URL(reportHref(original, { search: "202" }), "https://sacsi.example").searchParams.get(
        "page",
      ),
    ).toBe("1");
  });
});
