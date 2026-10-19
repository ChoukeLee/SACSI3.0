import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, expectTypeOf, it } from "vitest";
import {
  CIMAC_SHOP_PROPERTY_FEE_POLICY,
  cimacShopPropertyFeeNotice,
} from "@/features/finance/cimac-property-fee-policy";
import {
  CIMAC_PROJECT_ID,
  cimacExportCsv,
  type CimacExportBundle,
  type CimacExportQuery,
} from "@/features/finance/cimac-export-model";
import { CimacExportActions } from "@/features/finance/cimac-export-actions";

const uid = (value: number) => `aaaaaaaa-aaaa-4aaa-8aaa-${String(value).padStart(12, "0")}`;
const buildingId = uid(1),
  unitId = uid(2),
  paymentId = uid(3);
const emptyBundle = (): CimacExportBundle => ({
  readAt: "2029-05-15T12:00:00.000Z",
  ledger: [],
  payments: [],
  units: [],
  buildings: [],
  receivables: [],
});
const scopedBundle = (): CimacExportBundle => ({
  ...emptyBundle(),
  units: [{ id: unitId, unit_no: "601", building_id: buildingId }],
  buildings: [
    { id: buildingId, project_id: CIMAC_PROJECT_ID, display_name: "Synthetic commercial building" },
  ],
});
const query = (view: CimacExportQuery["view"], locale: "zh" | "fr"): CimacExportQuery => ({
  view,
  locale,
});

/** The exporter quotes every field; keep policy commas inside the correct column. */
function csvRows(text: string): string[][] {
  return text
    .replace(/^\uFEFF/, "")
    .split("\r\n")
    .map((line) => {
      const cells: string[] = [];
      let quoted = false,
        value = "";
      for (let index = 0; index < line.length; index++) {
        const character = line[index];
        if (character === '"') {
          if (quoted && line[index + 1] === '"') {
            value += '"';
            index++;
          } else quoted = !quoted;
        } else if (character === "," && !quoted) {
          cells.push(value);
          value = "";
        } else value += character;
      }
      cells.push(value);
      return cells;
    });
}
function paymentBundle(type: "property_fee" | "lease_deposit") {
  const data = scopedBundle();
  data.payments = [
    {
      id: paymentId,
      unit_id: unitId,
      source_type: type,
      source_id: uid(4),
      payment_date: "2029-05-12",
      amount: 11100,
      currency: "XOF",
      exchange_rate_to_xof: 1,
      receipt_no: "SYNTHETIC-FUTURE-PAYMENT",
      external_receipt_no: null,
      reversal_of_payment_id: null,
      payment_method: "cash",
    },
  ];
  data.ledger = [
    {
      id: uid(5),
      building_id: buildingId,
      unit_id: unitId,
      payment_id: paymentId,
      entry_date: "2029-05-13",
      direction: type === "property_fee" ? "income" : "liability_in",
      category: type,
      amount_xof: 11100,
      amount_cny: null,
    },
  ];
  return data;
}

describe("confirmed CIMAC shop property-fee policy reference", () => {
  it("retains an immutable dated business confirmation, not a live financial balance", () => {
    expect(CIMAC_SHOP_PROPERTY_FEE_POLICY).toEqual({
      startsOn: "2027-04-01",
      monthlyRateXofPerSqm: 900,
      confirmedAsOf: "2026-10-19",
      collectionAtConfirmation: "not_collected",
    });
    expectTypeOf(CIMAC_SHOP_PROPERTY_FEE_POLICY).toEqualTypeOf<
      Readonly<{
        startsOn: "2027-04-01";
        monthlyRateXofPerSqm: 900;
        confirmedAsOf: "2026-10-19";
        collectionAtConfirmation: "not_collected";
      }>
    >();
    expect(Object.isFrozen(CIMAC_SHOP_PROPERTY_FEE_POLICY)).toBe(true);
    expect(Reflect.set(CIMAC_SHOP_PROPERTY_FEE_POLICY, "startsOn", "1900-01-01")).toBe(false);
    expect(Reflect.set(CIMAC_SHOP_PROPERTY_FEE_POLICY, "monthlyRateXofPerSqm", 0)).toBe(false);
    expect(Reflect.deleteProperty(CIMAC_SHOP_PROPERTY_FEE_POLICY, "confirmedAsOf")).toBe(false);
    expect(CIMAC_SHOP_PROPERTY_FEE_POLICY.startsOn).toBe("2027-04-01");
    expect(CIMAC_SHOP_PROPERTY_FEE_POLICY.monthlyRateXofPerSqm).toBe(900);
    expect(CIMAC_SHOP_PROPERTY_FEE_POLICY.confirmedAsOf).toBe("2026-10-19");
  });

  it.each(["zh", "fr"] as const)(
    "states the commercial-only dated reference and non-accounting boundary in %s",
    (locale) => {
      const notice = cimacShopPropertyFeeNotice(locale);
      expect(notice).toContain("2027-04-01");
      expect(notice).toContain("2026-10-19");
      expect(notice).toContain("900");
      expect(notice).toContain("XOF");
      if (locale === "zh") {
        expect(notice).toMatch(/(?:仅|限于).*商铺/);
        expect(notice).toMatch(/(?:平方米|㎡|m²).*月/);
        expect(notice).toMatch(/未收/);
        expect(notice).toMatch(/(?:非实时|不代表实时|不是实时)/);
        expect(notice).toMatch(/不.*生成.*应收/);
        expect(notice).toMatch(/不.*生成.*收款/);
        expect(notice).toMatch(/不.*(?:替代|代替).*账期/);
        expect(notice).toContain("仓库");
        expect(notice).toContain("公寓");
      } else {
        expect(notice).toMatch(/(?:locaux commerciaux|boutiques|commerces)/i);
        expect(notice).toMatch(/(?:m²|m2).*mois/i);
        expect(notice).toMatch(/(?:non encaiss|pas.*encaiss|aucun.*encaiss)/i);
        expect(notice).toMatch(/(?:pas|non|sans).*temps réel/i);
        expect(notice).toMatch(/(?:aucun|ne|sans).*créance/i);
        expect(notice).toMatch(/ne crée.*(?:encaissement|paiement)/i);
        expect(notice).toMatch(/(?:ne.*remplac.*période|ni période.*chaque écriture)/i);
        expect(notice).toMatch(/entrepôts/i);
        expect(notice).toMatch(/appartements/i);
      }
    },
  );
});

describe("property-fee policy is reference text, never fabricated financial data", () => {
  it.each(["zh", "fr"] as const)(
    "keeps both empty property-fee CSVs headers-only with the notice in %s",
    (locale) => {
      for (const view of ["property-fee-payments", "property-fee-receivables"] as const) {
        const data = emptyBundle(),
          before = structuredClone(data);
        const text = cimacExportCsv(data, query(view, locale));
        expect(csvRows(text)).toHaveLength(1);
        expect(
          csvRows(text)[0].some((cell) => cell.includes(cimacShopPropertyFeeNotice(locale))),
        ).toBe(true);
        expect(text).not.toContain("SYNTHETIC-FUTURE-PAYMENT");
        expect(data).toEqual(before);
      }
    },
  );

  it.each(["zh", "fr"] as const)(
    "does not zero a later formal property-fee receipt using the old confirmation in %s",
    (locale) => {
      const data = paymentBundle("property_fee"),
        before = structuredClone(data);
      const text = cimacExportCsv(data, query("property-fee-payments", locale));
      const [headers, row] = csvRows(text);
      expect(csvRows(text)).toHaveLength(2);
      expect(text).toContain(cimacShopPropertyFeeNotice(locale));
      expect(
        row[headers.indexOf(locale === "zh" ? "原币金额" : "Montant en devise originale")],
      ).toBe("11100");
      expect(row[headers.indexOf(locale === "zh" ? "收款日期" : "Date du paiement")]).toBe(
        "2029-05-12",
      );
      expect(row[headers.indexOf(locale === "zh" ? "原币币种" : "Devise originale")]).toBe("XOF");
      expect(data).toEqual(before);
    },
  );

  it.each(["zh", "fr"] as const)(
    "preserves a formal receivable's explicit dates and paid amount independently of the snapshot in %s",
    (locale) => {
      const data = scopedBundle();
      data.receivables = [
        {
          id: uid(10),
          building_id: buildingId,
          unit_id: unitId,
          source_type: "lease_contract",
          source_id: uid(11),
          category: "property_fee",
          due_date: "2029-05-10",
          amount_xof: 45000,
          paid_amount_xof: 12500,
          status: "partial",
          management_status: "managed",
          service_period_start: "2029-05-01",
          service_period_end: "2030-04-30",
          service_period_source: "PRIVATE_CONFIRMED_PERIOD_REFERENCE",
          service_period_confirmed_by: uid(12),
        },
      ];
      const before = structuredClone(data),
        text = cimacExportCsv(data, query("property-fee-receivables", locale));
      const [headers, row] = csvRows(text);
      expect(csvRows(text)).toHaveLength(2);
      expect(text).toContain(cimacShopPropertyFeeNotice(locale));
      expect(
        row[headers.indexOf(locale === "zh" ? "原登记应收金额 XOF" : "Montant dû enregistré XOF")],
      ).toBe("45000");
      expect(
        row[
          headers.indexOf(
            locale === "zh" ? "原登记已核销金额 XOF" : "Montant imputé enregistré XOF",
          )
        ],
      ).toBe("12500");
      expect(row[headers.indexOf(locale === "zh" ? "到期日" : "Échéance")]).toBe("2029-05-10");
      expect(
        row[headers.indexOf(locale === "zh" ? "明确账期开始" : "Début de période explicite")],
      ).toBe("2029-05-01");
      expect(
        row[headers.indexOf(locale === "zh" ? "明确账期结束" : "Fin de période explicite")],
      ).toBe("2030-04-30");
      expect(text).not.toContain("PRIVATE_CONFIRMED_PERIOD_REFERENCE");
      expect(text).not.toContain(uid(12));
      expect(data).toEqual(before);
    },
  );

  it.each(["zh", "fr"] as const)(
    "does not apply the shop property-fee policy to deposit reports in %s",
    (locale) => {
      const data = paymentBundle("lease_deposit"),
        before = structuredClone(data);
      for (const view of ["deposits", "refunds"] as const) {
        const text = cimacExportCsv(data, query(view, locale));
        expect(text).not.toContain(cimacShopPropertyFeeNotice(locale));
        expect(text).not.toContain("2027-04-01");
        expect(text).not.toContain("2026-10-19");
      }
      expect(data).toEqual(before);
    },
  );
});

describe("CIMAC policy reference in the internal export UI", () => {
  it.each(["zh", "fr"] as const)(
    "shows the dated reference on commercial export entry points in %s",
    (locale) => {
      for (const kind of ["ledger", "receivables"] as const) {
        const html = renderToStaticMarkup(
          React.createElement(CimacExportActions, {
            kind,
            filters: { projectId: CIMAC_PROJECT_ID },
            locale,
          }),
        );
        expect(html).toContain("2027-04-01");
        expect(html).toContain("2026-10-19");
        expect(html).toContain("900");
        expect(html).toContain(locale === "zh" ? "商铺" : "boutiques");
      }
    },
  );

  it("never exposes the fixed-project policy reference under another project's export UI", () => {
    expect(
      renderToStaticMarkup(
        React.createElement(CimacExportActions, {
          kind: "receivables",
          filters: { projectId: uid(99) },
          locale: "zh",
        }),
      ),
    ).toBe("");
  });
});
