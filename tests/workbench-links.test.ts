import { describe, expect, it } from "vitest";
import { buildWorkbenchRecordHref, safeWorkbenchReturnTo } from "@/lib/workbench-links";

const record = "912a5a85-9a0f-4989-a4ce-73409176d2da";
const project = "313eb2b7-b743-41cf-ab52-0a646da0916e";
const building = "494889da-1598-45f2-9354-759866048302";

describe("business workbench record links", () => {
  it.each([
    ["sales", "contract"],
    ["leases", "contract"],
    ["customers", "customer"],
    ["units", "unit"],
  ] as const)("uses a stable record identifier for %s", (workspace, key) => {
    const href = buildWorkbenchRecordHref({ workspace, id: record, project, building });
    const url = new URL(href!, "https://sacsi.example");
    expect(url.pathname).toBe(`/${workspace}`);
    expect(url.searchParams.get(key)).toBe(record);
    expect(url.searchParams.get("project")).toBe(project);
    expect(url.searchParams.get("building")).toBe(building);
  });

  it("preserves the exact caller query without inventing a record deep link from a name", () => {
    expect(buildWorkbenchRecordHref({ workspace: "customers", id: "同名客户" })).toBeNull();
    const source = `/sales?project=${project}&building=${building}&q=A-801&status=all&page=3`;
    const href = buildWorkbenchRecordHref({
      workspace: "customers",
      id: record,
      returnTo: source,
    });
    expect(new URL(href!, "https://sacsi.example").searchParams.get("returnTo")).toBe(source);
  });

  it("uses the French business path and never embeds invalid scope identifiers", () => {
    const href = buildWorkbenchRecordHref({
      workspace: "units",
      id: record,
      locale: "fr",
      project: "unknown-project",
      building: "latest-occupant",
    });
    expect(href).toBe(`/fr/units?unit=${record}`);
  });

  it("does not accept a cross-origin return even when the target record is valid", () => {
    const href = buildWorkbenchRecordHref({
      workspace: "units",
      id: record,
      returnTo: "https://elsewhere.example/units",
    });
    expect(href).toBe(`/units?unit=${record}`);
  });
});

describe("workbench return destinations", () => {
  it.each([
    "/sales?status=all&q=A-801&page=2",
    "/fr/customers?segment=guest&q=示例",
    `/units/${record}?view=history`,
    `/fr/customers/${record}`,
    "/daily-rentals/receipts?dateFrom=2026-10-01",
    "/management?project=CIMAC",
    "/finance?kind=receivables&outstandingOnly=true",
  ])("accepts an existing business page %s", (path) => {
    expect(safeWorkbenchReturnTo(path)).toBe(
      new URL(path, "https://sacsi.example").pathname +
        new URL(path, "https://sacsi.example").search,
    );
  });

  it("removes the older return hop but preserves filter and selected record", () => {
    const path = `/customers?customer=${record}&segment=contract&returnTo=${encodeURIComponent("/sales?page=2")}`;
    expect(safeWorkbenchReturnTo(path)).toBe(`/customers?customer=${record}&segment=contract`);
  });

  it.each([
    null,
    undefined,
    ["/units"],
    "https://evil.example/units",
    "//evil.example/units",
    "/\\evil.example/units",
    "javascript:alert(1)",
    "/%2f%2fevil.example/units",
    "/units/../../login",
    "/api/finance/export",
    "/operator/confirmations/anything",
    "/customers/not-a-uuid",
    "/sales?access_token=secret",
    "/sales?PASSWORD=secret",
    "/sales?q=%0aLocation%3Aevil.example",
    " /sales",
    "/sales\n",
    "/units?q=" + "x".repeat(2400),
  ])("rejects unsafe or non-business return destinations", (path) => {
    expect(safeWorkbenchReturnTo(path)).toBeNull();
  });
});
