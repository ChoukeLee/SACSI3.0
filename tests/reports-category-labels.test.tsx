import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ReportsView } from "@/features/reports/reports-view";
import { aggregateByCategory } from "@/features/reports/report-aggregators";
import type { LedgerEntryRow } from "@/types/database";

const categories = ["lease_rent", "sale", "daily_rental", "property_fee"];
function entry(
  category: string,
  direction: LedgerEntryRow["direction"],
  index: number,
): LedgerEntryRow {
  return {
    id: `10000000-0000-4000-8000-${String(index + (direction === "income" ? 100 : 200)).padStart(12, "0")}`,
    building_id: null,
    unit_id: null,
    payment_id: null,
    entry_date: "2026-10-10",
    direction,
    category,
    amount_xof: index + 1.25,
    amount_cny: null,
    description: null,
    created_at: "2026-10-10T00:00:00Z",
  };
}
function render(locale: "zh" | "fr", entries: LedgerEntryRow[]) {
  return renderToStaticMarkup(
    <ReportsView
      data={{
        query: {
          kind: "ledger",
          projectId: "10000000-0000-4000-8000-000000000001",
          month: "2026-10",
          page: 1,
          search: "",
          direction: "",
          management: "managed",
          outstandingOnly: false,
        },
        projects: [
          {
            id: "10000000-0000-4000-8000-000000000001",
            code: "SACSI",
            display_name: "SACSI",
          },
        ],
        result: {
          kind: "ledger",
          page: 1,
          pageSize: 50,
          total: entries.length,
          summary: {
            income: entries
              .filter((row) => row.direction === "income")
              .reduce((total, row) => total + Number(row.amount_xof), 0),
            expense: entries
              .filter((row) => row.direction === "expense")
              .reduce((total, row) => total + Number(row.amount_xof), 0),
            liability_in: 0,
            liability_out: 0,
          },
          rows: entries.map((row) => ({ ...row })),
        },
        trend: [],
        asOf: "2026-10-19",
        exportHref: "/api/reports/export",
      }}
      locale={locale}
    />,
  );
}
describe("reports checking table category labels", () => {
  it.each([
    ["zh", ["长租租金", "出售房款", "日租收入", "物业费"]],
    [
      "fr",
      ["Loyer longue durée", "Paiement du bien", "Revenu journalier", "Charges de copropriété"],
    ],
  ] as const)(
    "localizes income and expense rows in %s without changing aggregation keys or amounts",
    (locale, labels) => {
      const entries = [
        ...categories.map((category, index) => entry(category, "income", index)),
        ...categories.map((category, index) => entry(category, "expense", index + 10)),
      ];
      const before = structuredClone(entries);
      const html = render(locale, entries);
      for (const label of labels) expect(html).toContain(label);
      for (const category of categories) expect(html).not.toContain(category);
      expect(entries).toEqual(before);
      expect(aggregateByCategory(entries, "income")).toEqual([
        { label: "property_fee", value: 4.25 },
        { label: "daily_rental", value: 3.25 },
        { label: "sale", value: 2.25 },
        { label: "lease_rent", value: 1.25 },
      ]);
      expect(aggregateByCategory(entries, "expense").map((row) => row.value)).toEqual([
        14.25, 13.25, 12.25, 11.25,
      ]);
    },
  );
  it("does not merge distinct raw categories that share a human label, and localizes unknown codes", () => {
    const entries = [
      entry("sale", "income", 0),
      entry("sale_contract", "income", 1),
      entry("legacy_private_code", "income", 2),
    ];
    const zh = render("zh", entries);
    const fr = render("fr", entries);
    expect(aggregateByCategory(entries, "income")).toHaveLength(3);
    expect(zh).toContain("出售房款");
    expect(fr).toContain("Paiement du bien");
    expect(zh).toContain("其他业务");
    expect(fr).toContain("Autre opération");
    expect(zh).not.toContain("legacy_private_code");
    expect(fr).not.toContain("legacy_private_code");
  });
});
