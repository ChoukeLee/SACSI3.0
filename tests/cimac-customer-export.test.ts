import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
vi.mock("server-only", () => ({}));
import {
  CIMAC_PROJECT_ID,
  cimacExportCsv,
  type CimacExportBundle,
} from "@/features/finance/cimac-export-model";
import { readCimacExport } from "@/features/finance/cimac-export-read";

type Row = Record<string, unknown>;
const id = (n: number) => `bbbbbbbb-bbbb-4bbb-8bbb-${String(n).padStart(12, "0")}`;
const paymentId = id(1),
  customerId = id(2),
  buildingId = id(3),
  unitId = id(4),
  otherUnitId = id(5);
function fixture(): CimacExportBundle {
  const ledger = [
    {
      id: id(11),
      building_id: buildingId,
      unit_id: unitId,
      payment_id: paymentId,
      entry_date: "2026-10-24",
      direction: "income",
      category: "property_fee",
      amount_xof: 1000,
      amount_cny: null,
      currency: "XOF",
      amount_native: null,
    },
    {
      id: id(12),
      building_id: buildingId,
      unit_id: otherUnitId,
      payment_id: paymentId,
      entry_date: "2026-10-24",
      direction: "income",
      category: "lease_rent",
      amount_xof: 2000,
      amount_cny: null,
      currency: "XOF",
      amount_native: null,
    },
  ];
  return {
    readAt: "2026-10-24T12:00:00Z",
    ledger,
    collectionLedger: structuredClone(ledger),
    payments: [
      {
        id: paymentId,
        customer_id: customerId,
        unit_id: null,
        source_type: "cimac_customer_collection",
        source_id: customerId,
        payment_date: "2026-10-24",
        amount: 3000,
        currency: "XOF",
        exchange_rate_to_xof: 1,
        native_settlement: false,
        receipt_no: "CIMAC-CUSTOMER-1",
        external_receipt_no: null,
        reversal_of_payment_id: null,
        payment_method: "cash",
      },
    ],
    units: [
      { id: unitId, building_id: buildingId, unit_no: "SHOP-1" },
      { id: otherUnitId, building_id: buildingId, unit_no: "WAREHOUSE-1" },
    ],
    buildings: [{ id: buildingId, project_id: CIMAC_PROJECT_ID, display_name: "CIMAC" }],
    allocations: [
      { payment_id: paymentId, receivable_id: id(21), amount_xof: "1000" },
      { payment_id: paymentId, receivable_id: id(22), amount_xof: "2000" },
    ],
    collectionReceivables: [
      {
        id: id(21),
        customer_id: customerId,
        unit_id: unitId,
        building_id: buildingId,
        source_type: "lease_contract",
        source_id: id(31),
        category: "property_fee",
        currency: "XOF",
      },
      {
        id: id(22),
        customer_id: customerId,
        unit_id: otherUnitId,
        building_id: buildingId,
        source_type: "lease_contract",
        source_id: id(32),
        category: "lease_rent",
        currency: "XOF",
      },
    ],
    verifiedCollectionPaymentIds: [paymentId],
  };
}
function cells(csv: string) {
  return csv
    .replace(/^\uFEFF/, "")
    .split("\r\n")
    .map((line) =>
      [...line.matchAll(/"((?:""|[^"])*)"(?:,|$)/g)].map((cell) => cell[1].replaceAll('""', '"')),
    );
}
const query = { view: "property-fee-payments" as const, locale: "zh" as const };

describe("customer collections in the property-fee CSV", () => {
  it.each(["zh", "fr"] as const)(
    "exports only the verified fee portion and keeps the mixed header independently once in %s",
    (locale) => {
      const csv = cimacExportCsv(fixture(), { ...query, locale });
      const [headers, row] = cells(csv);
      expect(cells(csv)).toHaveLength(2);
      expect(
        row[headers.indexOf(locale === "zh" ? "原币金额" : "Montant en devise originale")],
      ).toBe("");
      expect(
        row[
          headers.findIndex((value) =>
            value.startsWith(
              locale === "zh" ? "客户总账整笔实收" : "Encaissement total du compte client",
            ),
          )
        ],
      ).toBe("3000");
      expect(
        row[
          headers.indexOf(
            locale === "zh" ? "物业费关联分录金额 XOF" : "Montant des écritures de charges XOF",
          )
        ],
      ).toBe("1000");
      expect(
        row[
          headers.findIndex((value) =>
            value.startsWith(locale === "zh" ? "其中已验证" : "Dont imputation vérifiée"),
          )
        ],
      ).toBe("1000");
      expect(csv.match(/"3000"/g)).toHaveLength(1);
      expect(csv).toContain(id(21));
      expect(csv).not.toContain(id(22));
      expect(row[headers.indexOf(locale === "zh" ? "铺号" : "Numéros des locaux")]).toBe("SHOP-1");
    },
  );
  it("keeps the generic payment export's original header once, without turning it into a property fee", () => {
    const csv = cimacExportCsv(fixture(), { view: "payments", locale: "zh" });
    expect(csv.match(/"3000"/g)).toHaveLength(1);
    expect(csv).not.toContain("已验证物业费应收");
  });
  it("accepts a scoped partial principal only after independently checking all receipt ledger and allocation facts", () => {
    const data = fixture();
    data.ledger = data.ledger.slice(0, 1);
    const csv = cimacExportCsv(data, query);
    expect(csv).toContain('"1000"');
    expect(csv).toContain('"3000"');
    expect(csv).not.toContain("WAREHOUSE-1");
    data.ledger = fixture().ledger.slice(1);
    expect(cells(cimacExportCsv(data, query))).toHaveLength(1);
  });
  it("does not invent a specific receivable when a partial scope selects one of two identical ledger pieces", () => {
    const data = fixture();
    data.payments[0].amount = 2000;
    data.collectionReceivables![1] = { ...data.collectionReceivables![0], id: id(22) };
    data.allocations![1].amount_xof = "1000";
    data.collectionLedger![1] = { ...data.collectionLedger![0], id: id(12) };
    data.ledger = data.ledger.slice(0, 1);
    const csv = cimacExportCsv(data, query),
      [headers, row] = cells(csv);
    expect(row[headers.indexOf("已验证物业费应收 ID")]).toBe("");
    expect(csv).toContain("具体应收无法唯一对应");
    expect(row[headers.indexOf("其中已验证核销金额 XOF（历史未知留空）")]).toBe("1000");
  });
  it.each([
    "missing-proof",
    "missing-full-ledger",
    "truncated-allocation",
    "duplicate-allocation",
    "other-customer",
    "other-project",
    "wrong-amount",
    "shifted-piece",
    "foreign-extra-receivable",
    "wrong-header-source",
  ])("fails closed for %s rather than leaking or guessing the property portion", (kind) => {
    const data = fixture();
    if (kind === "missing-proof") data.verifiedCollectionPaymentIds = [];
    if (kind === "missing-full-ledger") data.collectionLedger = undefined;
    if (kind === "truncated-allocation") data.allocations!.pop();
    if (kind === "duplicate-allocation") data.allocations!.push({ ...data.allocations![0] });
    if (kind === "other-customer") data.collectionReceivables![1].customer_id = id(99);
    if (kind === "other-project") data.buildings[0].project_id = id(99);
    if (kind === "wrong-amount") data.payments[0].amount = 4000;
    if (kind === "shifted-piece") {
      data.collectionLedger![0].amount_xof = 1500;
      data.collectionLedger![1].amount_xof = 1500;
    }
    if (kind === "foreign-extra-receivable")
      data.collectionReceivables!.push({ ...data.collectionReceivables![0], id: id(99) });
    if (kind === "wrong-header-source") data.payments[0].source_id = id(31);
    expect(() => cimacExportCsv(data, query)).toThrow();
  });
});

function readClient(data: CimacExportBundle, verified = true) {
  const calls: { table: string; key: string; values: unknown[]; from?: number; to?: number }[] = [];
  const rows: Record<string, Row[]> = {
    projects: [{ id: CIMAC_PROJECT_ID, code: "CIMAC", is_active: true }],
    ledger_entries: data.collectionLedger!,
    payment_receivable_allocations: data.allocations!,
    payments: data.payments,
    receivables: data.collectionReceivables!,
    units: data.units,
    buildings: data.buildings,
  };
  const rpc = vi.fn(async (name: string, input: Row) =>
    name === "finance_read_rpc"
      ? { data: { kind: "ledger", total: data.ledger.length, rows: data.ledger }, error: null }
      : {
          data: (input.p_payment_ids as string[]).map((paymentId) => ({ paymentId, verified })),
          error: null,
        },
  );
  const client = {
    rpc,
    from(table: string) {
      let filters: Array<(row: Row) => boolean> = [],
        start = 0,
        end = Infinity;
      const result = () => ({
        data: (rows[table] ?? [])
          .filter((row) => filters.every((filter) => filter(row)))
          .slice(start, end + 1),
        error: null,
      });
      const builder = {
        select: () => builder,
        eq(key: string, value: unknown) {
          filters.push((row) => row[key] === value);
          return builder;
        },
        in(key: string, values: unknown[]) {
          calls.push({ table, key, values });
          filters.push((row) => values.includes(row[key]));
          return builder;
        },
        order: () => builder,
        range(from: number, to: number) {
          start = from;
          end = to;
          calls.push({ table, key: "range", values: [], from, to });
          return builder;
        },
        maybeSingle: async () => ({ data: result().data[0] ?? null, error: null }),
        then(
          resolve: (value: ReturnType<typeof result>) => unknown,
          reject?: (error: unknown) => unknown,
        ) {
          return Promise.resolve(result()).then(resolve, reject);
        },
      };
      return builder;
    },
  } as unknown as Pick<SupabaseClient, "from" | "rpc">;
  return { client, calls, rpc };
}
describe("customer-collection export reads remain bounded and authenticated", () => {
  it("pages complete receipt associations beyond the Data API default row cap", async () => {
    const data = fixture(),
      sampleLedger = data.collectionLedger![0],
      sampleReceivable = data.collectionReceivables![0],
      samplePayment = data.payments[0];
    data.payments = [];
    data.ledger = [];
    data.collectionLedger = [];
    data.allocations = [];
    data.collectionReceivables = [];
    for (let receipt = 0; receipt < 11; receipt++) {
      const currentPaymentId = id(100 + receipt);
      data.payments.push({ ...samplePayment, id: currentPaymentId, amount: 100000 });
      for (let item = 0; item < 100; item++) {
        const index = receipt * 100 + item,
          receivableId = id(2000 + index);
        const entry = { ...sampleLedger, id: id(4000 + index), payment_id: currentPaymentId };
        data.collectionLedger.push(entry);
        if (item === 0) data.ledger.push(entry);
        data.collectionReceivables.push({ ...sampleReceivable, id: receivableId });
        data.allocations.push({
          payment_id: currentPaymentId,
          receivable_id: receivableId,
          amount_xof: "1000",
        });
      }
    }
    const { client, calls } = readClient(data);
    const result = await readCimacExport(client, query);
    expect(result.allocations).toHaveLength(1100);
    expect(result.collectionLedger).toHaveLength(1100);
    expect(
      calls
        .filter((call) => call.table === "payment_receivable_allocations" && call.key === "range")
        .map((call) => call.from),
    ).toEqual([0, 1000]);
    expect(cells(cimacExportCsv(result, query))).toHaveLength(12);
  });
  it("supplements a partial principal with complete exact-ID receipt proof, not unbounded customer scans", async () => {
    const data = fixture();
    data.ledger = data.ledger.slice(0, 1);
    const { client, calls, rpc } = readClient(data);
    const result = await readCimacExport(client, query);
    expect(result.ledger).toHaveLength(1);
    expect(result.collectionLedger).toHaveLength(2);
    expect(result.allocations).toHaveLength(2);
    expect(rpc).toHaveBeenCalledWith("cimac_customer_collection_proofs_rpc", {
      p_payment_ids: [paymentId],
    });
    expect(
      calls.filter(
        (call) => call.table === "payment_receivable_allocations" && call.key === "payment_id",
      )[0].values,
    ).toEqual([paymentId]);
    expect(cimacExportCsv(result, query)).toContain("CIMAC-CUSTOMER-1");
  });
  it("rejects an unverifiable sealed receipt instead of downloading a partial report", async () => {
    const { client } = readClient(fixture(), false);
    await expect(readCimacExport(client, query)).rejects.toMatchObject({ status: 503 });
  });
  it("does not issue new proof reads on legacy generic export paths", async () => {
    const { client, calls, rpc } = readClient(fixture());
    await readCimacExport(client, { view: "payments", locale: "zh" });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(calls.some((call) => call.table === "payment_receivable_allocations")).toBe(false);
  });
});
