import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CimacExportActions } from "@/features/finance/cimac-export-actions";
import { CIMAC_PROJECT_ID, parseCimacExportQuery } from "@/features/finance/cimac-export-model";
import type { FinanceFilters, FinanceKind } from "@/features/finance/finance-read";

function render(
  filters: FinanceFilters = { projectId: CIMAC_PROJECT_ID },
  locale: "zh" | "fr" = "zh",
  kind: FinanceKind = "ledger",
) {
  return renderToStaticMarkup(<CimacExportActions kind={kind} filters={filters} locale={locale} />);
}

describe("CIMAC export entry points", () => {
  it.each([undefined, "", "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"])(
    "does not offer the fixed-project export for %s",
    (projectId) => {
      expect(render(projectId === undefined ? {} : { projectId })).toBe("");
    },
  );

  it("offers only the property-fee receivable export on the receivables view", () => {
    const html = render({ projectId: CIMAC_PROJECT_ID }, "zh", "receivables");
    expect(html).toContain("view=property-fee-receivables");
    expect([...html.matchAll(/href=/g)]).toHaveLength(1);
    expect(html).not.toContain("view=ledger");
    expect(html).toContain("按到期日");
    expect(html).toContain("不是历史余额");
    expect(html).toContain("无正式登记不代表免缴或未缴");
    expect(html).toContain("全管理状态CSV");
    expect(html).toContain("不应把取消、历史待核或排除记录计作当前欠款");
  });

  it.each(["zh", "fr"] as const)("links both views in %s with only supported filters", (locale) => {
    const filters = { projectId: CIMAC_PROJECT_ID, dateFrom: "2026-10-01", dateTo: "2026-10-19" };
    const html = render(filters, locale);
    const links = [...html.matchAll(/href="([^"]+)"/g)].map((match) =>
      match[1].replaceAll("&amp;", "&"),
    );
    expect(links).toHaveLength(5);
    expect(
      links.map((link) =>
        parseCimacExportQuery(new URL(link, "https://sacsi.example").searchParams),
      ),
    ).toEqual([
      { view: "ledger", locale, dateFrom: "2026-10-01", dateTo: "2026-10-19" },
      { view: "payments", locale, dateFrom: "2026-10-01", dateTo: "2026-10-19" },
      { view: "deposits", locale, dateFrom: "2026-10-01", dateTo: "2026-10-19" },
      { view: "refunds", locale, dateFrom: "2026-10-01", dateTo: "2026-10-19" },
      { view: "property-fee-payments", locale, dateFrom: "2026-10-01", dateTo: "2026-10-19" },
    ]);
    expect(html).toContain(
      locale === "zh" ? "未入账原币登记不在此表" : "en attente de comptabilisation",
    );
    expect(filters).toEqual({
      projectId: CIMAC_PROJECT_ID,
      dateFrom: "2026-10-01",
      dateTo: "2026-10-19",
    });
  });

  it.each(["buildingId", "search", "direction", "category", "newFilter"])(
    "never silently ignores %s",
    (key) => {
      const html = render({ projectId: CIMAC_PROJECT_ID, [key]: "active-filter" });
      expect(html).not.toContain("/api/finance/cimac-export");
      expect(html).toContain("请先清除");
    },
  );

  it("ignores no-op empty filters while preserving unbounded dates", () => {
    const html = render({ projectId: CIMAC_PROJECT_ID, buildingId: "", search: "" });
    expect(html).toContain("href=");
    expect(html).not.toContain("dateFrom=");
    expect(html).not.toContain("dateTo=");
  });

  it("explains the filter restriction in French", () => {
    expect(render({ projectId: CIMAC_PROJECT_ID, search: "601" }, "fr")).toContain(
      "Retirez les autres filtres",
    );
  });

  it.each(["zh", "fr"] as const)(
    "preserves the dates and locale when clearing other filters in %s",
    (locale) => {
      const html = render(
        {
          projectId: CIMAC_PROJECT_ID,
          management: "managed",
          category: "property_fee",
          dateFrom: "2026-10-01",
        },
        locale,
        "receivables",
      );
      expect(html).not.toContain("/api/finance/cimac-export");
      const match = html.match(/href="([^"]+)"/)!;
      const target = new URL(match[1].replaceAll("&amp;", "&"), "https://sacsi.example");
      expect(target.pathname).toBe(locale === "zh" ? "/finance" : "/fr/finance");
      expect(Object.fromEntries(target.searchParams)).toEqual({
        projectId: CIMAC_PROJECT_ID,
        kind: "receivables",
        dateFrom: "2026-10-01",
      });
    },
  );

  it("keeps the due-date and service-period meanings distinct in French", () => {
    const html = render({ projectId: CIMAC_PROJECT_ID, dateTo: "2026-10-19" }, "fr", "receivables");
    expect(html).toContain("date d’échéance");
    expect(html).toContain("pas un solde historique");
    expect(html).toContain("périodes manquantes");
    expect(html).toContain("view=property-fee-receivables&amp;locale=fr&amp;dateTo=2026-10-19");
  });
});
