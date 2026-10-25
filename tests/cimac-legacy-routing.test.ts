import { describe, expect, it } from "vitest";
import { cimacLegacyHref } from "@/features/cimac/cimac-legacy-routing";
import { buildWorkbenchRecordHref, safeWorkbenchReturnTo } from "@/lib/workbench-links";
import { safeCimacReturnTo } from "@/features/cimac/cimac-workspace-query";
const id = "11111111-1111-4111-8111-111111111111";
describe("CIMAC legacy deep-link compatibility", () => {
  it.each(["zh", "fr"] as const)(
    "keeps %s contract, customer, asset and historical-sale targets inside the park",
    (locale) => {
      const base = `${locale === "fr" ? "/fr" : ""}/cimac`;
      expect(cimacLegacyHref("management", {}, locale)).toBe(base);
      expect(cimacLegacyHref("leases", { contract: id, project: "CIMAC" }, locale)).toBe(
        `${base}/contracts?contract=${id}`,
      );
      expect(cimacLegacyHref("customers", { customer: id }, locale)).toBe(
        `${base}/customers/${id}`,
      );
      expect(cimacLegacyHref("units", { unit: id }, locale)).toBe(`${base}/assets/${id}`);
      expect(cimacLegacyHref("sales", { contract: id }, locale)).toBe(
        `${base}/contracts/history/sales/${id}`,
      );
      expect(cimacLegacyHref("sales", {}, locale)).toBe(`${base}/assets`);
    },
  );
  it("maps the former finance customer workspace without passing incompatible query keys", () => {
    expect(
      cimacLegacyHref(
        "finance",
        { view: "customers", search: "client", customerPage: "2", tab: "receipts" },
        "zh",
      ),
    ).toBe("/cimac/finance?q=client&page=2");
    expect(
      cimacLegacyHref("finance", { view: "customers", customerId: id, tab: "receipts" }, "zh"),
    ).toBe(`/cimac/customers/${id}?tab=account&accountTab=receipts`);
    expect(cimacLegacyHref("finance", { projectId: id }, "zh")).toBe("/cimac/finance");
  });
  it("retains ledger filters and adds the formerly implicit ledger mode", () => {
    const target = new URL(
      cimacLegacyHref(
        "finance",
        { projectId: id, dateFrom: "2026-10-01", direction: "income", page: "2" },
        "zh",
      ),
      "https://example.invalid",
    );
    expect(target.pathname).toBe("/cimac/finance");
    expect(Object.fromEntries(target.searchParams)).toEqual({
      dateFrom: "2026-10-01",
      direction: "income",
      page: "2",
      kind: "ledger",
    });
    expect(cimacLegacyHref("finance", { kind: "receivables", outstandingOnly: "true" }, "fr")).toBe(
      "/fr/cimac/finance?kind=receivables&outstandingOnly=true",
    );
  });
  it("keeps aliases and maps supported old asset filter meanings", () => {
    expect(cimacLegacyHref("units", { buildingId: id, filter: "maintenance" }, "zh")).toBe(
      `/cimac/assets?building=${id}&filter=maintenance`,
    );
    expect(cimacLegacyHref("units", { filter: "cleaning" }, "zh")).toBe(
      "/cimac/assets?filter=attention",
    );
  });
  it("preserves safe contextual return paths without allowing external redirects", () => {
    const href = cimacLegacyHref(
      "leases",
      { contract: id, returnTo: "https://evil.invalid" },
      "zh",
    );
    expect(href).not.toContain("evil");
    for (const path of [
      "/cimac/contracts",
      `/fr/cimac/contracts/${id}/collect`,
      `/cimac/contracts/history/sales/${id}`,
      "/cimac/reports",
      "/cimac/map",
      "/cimac/finance?kind=ledger",
    ]) {
      expect(safeWorkbenchReturnTo(path)).toBe(path);
      expect(safeCimacReturnTo(path)).toBe(path);
    }
    expect(safeCimacReturnTo("/cimac/finance?password=secret")).toBeNull();
    expect(safeWorkbenchReturnTo(`/customers/${id}/collect`)).toBeNull();
  });
  it.each(["leases", "sales", "customers", "units"] as const)(
    "builds explicit park %s links without losing immutable IDs",
    (workspace) => {
      const href = buildWorkbenchRecordHref({
        workspace,
        id,
        workArea: "cimac",
        locale: "fr",
        project: id,
        returnTo: "/fr/cimac",
      });
      expect(href).toContain("/fr/cimac/");
      expect(href).toContain(id);
      expect(href).not.toContain("project=");
      expect(href).toContain("returnTo=%2Ffr%2Fcimac");
    },
  );
  it("rejects repeated target parameters and malformed immutable IDs", () => {
    expect(() => cimacLegacyHref("leases", { contract: [id, id] }, "zh")).toThrow();
    expect(() => cimacLegacyHref("customers", { customer: "wrong" }, "zh")).toThrow();
    expect(() => cimacLegacyHref("finance", { customerId: [id, id] }, "zh")).toThrow();
  });
  it("does not propagate unrelated or sensitive URL parameters into the new workspace", () => {
    expect(
      cimacLegacyHref("reports", { month: "2026-10", password: "secret", token: "secret" }, "zh"),
    ).toBe("/cimac/reports?month=2026-10");
    expect(cimacLegacyHref("finance", { kind: "ledger", authorization: "secret" }, "zh")).toBe(
      "/cimac/finance?kind=ledger",
    );
    expect(cimacLegacyHref("leases", { contract: id, q: "formerly ignored" }, "zh")).toBe(
      `/cimac/contracts?contract=${id}`,
    );
  });
});
