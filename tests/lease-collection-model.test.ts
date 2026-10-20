import { describe, expect, it } from "vitest";
import type { LeaseContractRow, ReceivableRow } from "@/types/database";
import {
  buildLeaseCollectionSubmission,
  formatCollectionMoneyInput,
  getLeaseCollectionBills,
  getLeaseCollectionCoverageProposal as proposeLeaseCoverage,
  moneyMinor,
  parseCollectionMoney,
  type LeaseCollectionDraft,
} from "@/features/leases/lease-collection-model";

const today = "2026-10-20";
const getLeaseCollectionCoverageProposal = (
  selectedContract: LeaseContractRow,
  rows: readonly ReceivableRow[],
  currentDraft: Pick<LeaseCollectionDraft, "currency" | "allocations">,
) => proposeLeaseCoverage(selectedContract, rows, currentDraft, today);
const contract = {
  id: "contract",
  unit_id: "unit",
  customer_id: "customer",
  status: "active",
  rent_currency: "XOF",
  paid_through_date: "2026-08-31",
  monthly_rent_xof: 600000,
} as LeaseContractRow;

function bill(id = "rent", changes: Partial<ReceivableRow> = {}): ReceivableRow {
  return {
    id,
    building_id: "building",
    unit_id: "unit",
    customer_id: "customer",
    source_type: "lease_contract",
    source_id: "contract",
    category: "lease_rent",
    title: "September rent",
    due_date: "2026-09-01",
    amount_xof: 600000,
    paid_amount_xof: 0,
    status: "pending",
    management_status: "managed",
    currency: "XOF",
    service_period_start: "2026-09-01",
    service_period_end: "2026-09-30",
    created_at: "2026-08-01T00:00:00Z",
    updated_at: "2026-09-01T00:00:00Z",
    ...changes,
  };
}

function draft(changes: Partial<LeaseCollectionDraft> = {}): LeaseCollectionDraft {
  return {
    currency: "XOF",
    amount: "600000",
    amountUnit: "unit",
    paymentDate: today,
    paymentMethod: "cash",
    externalReceiptNo: "",
    actualCollector: "",
    collectorBasis: "",
    notes: "",
    allocations: { rent: "600000" },
    ...changes,
  };
}

function codes(
  data: Partial<LeaseCollectionDraft>,
  rows = [bill()],
  selectedContract = contract,
  currentDate = today,
) {
  const result = buildLeaseCollectionSubmission(selectedContract, rows, draft(data), currentDate);
  expect(result.ok).toBe(false);
  return result.ok ? [] : result.issues.map((issue) => `${issue.field}:${issue.code}`);
}

describe("collection decimal parser", () => {
  it.each([
    ["0", "unit", 0],
    ["0.01", "unit", 0.01],
    ["0.29", "unit", 0.29],
    ["1.10", "unit", 1.1],
    [" 600000 ", "unit", 600000],
    ["001.25", "unit", 1.25],
    ["60", "wan", 600000],
    ["0.000001", "wan", 0.01],
    ["1.234567", "wan", 12345.67],
    ["999999999999.99", "unit", 999999999999.99],
    ["99999999.999999", "wan", 999999999999.99],
  ] as const)("parses %s %s with exact minor units", (text, unit, expected) => {
    expect(parseCollectionMoney(text, unit)).toBe(expected);
  });

  it.each([
    "",
    " ",
    "NaN",
    "Infinity",
    "-0",
    "-1",
    "+1",
    "1e3",
    "1E3",
    "1,000",
    "1 000",
    "1_000",
    "1.001",
    ".5",
    "1.",
    "1/2",
    "60万",
    "600000 XOF",
    "１２３",
    "1\n2",
    "1000000000000",
    "90071992547409.91",
    "99999999999999999999999999999999999999999999999999",
  ])("rejects unsafe/ambiguous input %s", (text) => {
    expect(parseCollectionMoney(text)).toBeNull();
  });

  it("rejects excess precision even when trailing digits are zero, and unknown units", () => {
    expect(parseCollectionMoney("1.000")).toBeNull();
    expect(parseCollectionMoney("1.0000000", "wan")).toBeNull();
    expect(parseCollectionMoney("1", "million" as "unit")).toBeNull();
    expect(parseCollectionMoney(100 as unknown as string)).toBeNull();
  });

  it.each([
    [0, 0],
    [0.01, 1],
    [0.29, 29],
    [12345.67, 1234567],
    [999999999999.99, 99999999999999],
    [-1, null],
    [NaN, null],
    [Infinity, null],
    [1.001, null],
    [0.1 + 0.2, null],
    [1000000000000, null],
    [0.0000001, null],
  ])("minor units for %s are exact or rejected", (value, expected) => {
    expect(moneyMinor(value)).toBe(expected);
  });

  it("does not coerce database strings or missing amounts to zero", () => {
    for (const input of ["100", "", null, undefined, true])
      expect(moneyMinor(input as unknown as number)).toBeNull();
  });

  it.each([
    [0, "unit", "0"],
    [0, "wan", "0"],
    [0.01, "unit", "0.01"],
    [0.01, "wan", "0.000001"],
    [0.29, "unit", "0.29"],
    [0.29, "wan", "0.000029"],
    [0.1, "wan", "0.00001"],
    [99.99, "wan", "0.009999"],
    [600000, "unit", "600000"],
    [600000, "wan", "60"],
    [12345.67, "wan", "1.234567"],
    [999999999999.99, "unit", "999999999999.99"],
    [999999999999.99, "wan", "99999999.999999"],
  ] as const)(
    "formats %s %s exactly and permits a lossless round trip",
    (value, unit, expected) => {
      const result = formatCollectionMoneyInput(value, unit);
      expect(result).toBe(expected);
      expect(parseCollectionMoney(result, unit)).toBe(value);
    },
  );

  it.each([NaN, Infinity, -1, 0.001, 0.1 + 0.2, 1000000000000])(
    "does not round unsafe numeric value %s into a valid-looking input",
    (value) => {
      expect(formatCollectionMoneyInput(value)).toBe("");
      expect(formatCollectionMoneyInput(value, "wan")).toBe("");
    },
  );

  it("rejects an unknown formatting unit rather than implicitly interpreting it", () => {
    expect(formatCollectionMoneyInput(1, "million" as "unit")).toBe("");
  });
});

describe("explicit existing bill projection", () => {
  it("keeps outstanding and exact row snapshot without rewriting period or paid-through", () => {
    const rows = [bill("rent", { status: "partial", paid_amount_xof: 100000 })];
    const before = structuredClone({ contract, rows });
    expect(getLeaseCollectionBills(contract, rows)).toEqual({
      bills: [
        {
          id: "rent",
          title: "September rent",
          category: "lease_rent",
          currency: "XOF",
          outstanding: 500000,
          servicePeriodStart: "2026-09-01",
          servicePeriodEnd: "2026-09-30",
          dueDate: "2026-09-01",
          expectedUpdatedAt: "2026-09-01T00:00:00Z",
        },
      ],
      excludedCount: 0,
    });
    expect({ contract, rows }).toEqual(before);
  });

  it("sorts stably by due date and id, not by input order", () => {
    expect(
      getLeaseCollectionBills(contract, [
        bill("b"),
        bill("late", { due_date: "2026-10-01" }),
        bill("a"),
      ]).bills.map((row) => row.id),
    ).toEqual(["a", "b", "late"]);
  });

  it.each([
    { source_id: "other" },
    { source_type: "sale_contract" },
    { category: "lease_deposit" },
    { category: "other" },
    { status: "paid" },
    { status: "cancelled" },
    { management_status: "historical_pending" },
    { management_status: "excluded" },
    { management_status: undefined },
  ] as Partial<ReceivableRow>[])("never offers irrelevant or non-managed rows: %j", (changes) => {
    expect(getLeaseCollectionBills(contract, [bill("bad", changes)])).toEqual({
      bills: [],
      excludedCount: 0,
    });
  });

  it.each([
    { id: "" },
    { unit_id: "other" },
    { unit_id: null },
    { customer_id: "other" },
    { customer_id: null },
    { currency: "" },
    { currency: "USD" },
    { currency: "EUR" },
    { currency: "FCFA" },
    { currency: "xof" },
    { currency: undefined },
    { amount_xof: NaN },
    { amount_xof: Infinity },
    { amount_xof: -1 },
    { amount_xof: 0 },
    { amount_xof: 1.001 },
    { amount_xof: "600000" },
    { paid_amount_xof: null },
    { paid_amount_xof: NaN },
    { paid_amount_xof: -1 },
    { paid_amount_xof: 600001 },
    { paid_amount_xof: 600000 },
    { paid_amount_xof: 1 },
    { status: "partial", paid_amount_xof: 0 },
    { amount_native: 100 },
    { paid_amount_native: 0 },
    { due_date: "2026-02-30" },
    { due_date: "2026-9-1" },
    { service_period_start: "2026-02-30" },
    { service_period_end: null },
    { service_period_end: "2026-08-31" },
  ] as unknown as Partial<ReceivableRow>[])(
    "counts unsafe candidate, never inventing data: %j",
    (changes) => {
      expect(getLeaseCollectionBills(contract, [bill("bad", changes)])).toEqual({
        bills: [],
        excludedCount: 1,
      });
    },
  );

  it.each(["draft", "terminated", "expired"] as const)(
    "rejects non-active %s contracts",
    (status) => {
      expect(getLeaseCollectionBills({ ...contract, status }, [bill()])).toEqual({
        bills: [],
        excludedCount: 1,
      });
    },
  );

  it("does not guess a missing contract currency or infer a missing customer/unit", () => {
    expect(
      getLeaseCollectionBills({ ...contract, rent_currency: undefined }, [bill()]).bills,
    ).toEqual([]);
    expect(getLeaseCollectionBills({ ...contract, customer_id: "" }, [bill()]).bills).toEqual([]);
    expect(getLeaseCollectionBills({ ...contract, unit_id: "" }, [bill()]).bills).toEqual([]);
  });

  it("rejects duplicated identifiers rather than arbitrarily picking one balance", () => {
    expect(getLeaseCollectionBills(contract, [bill(), bill()])).toEqual({
      bills: [],
      excludedCount: 2,
    });
  });

  it("uses exact native balances for USD/CNY, while property fees remain isolated XOF", () => {
    for (const currency of ["USD", "CNY"] as const) {
      const selectedContract = { ...contract, rent_currency: currency };
      const nativeRow = bill("native", {
        currency,
        amount_xof: 0,
        paid_amount_xof: 0,
        amount_native: 3200.29,
        paid_amount_native: 100.01,
        status: "partial",
      });
      const propertyRow = bill("property", {
        category: "property_fee",
      } as unknown as Partial<ReceivableRow>);
      expect(getLeaseCollectionBills(selectedContract, [nativeRow, propertyRow]).bills).toEqual([
        expect.objectContaining({ id: "native", currency, outstanding: 3100.28 }),
        expect.objectContaining({ id: "property", currency: "XOF", outstanding: 600000 }),
      ]);
      expect(
        getLeaseCollectionBills(selectedContract, [{ ...nativeRow, amount_xof: 1 }]).excludedCount,
      ).toBe(1);
      expect(
        getLeaseCollectionBills(selectedContract, [{ ...nativeRow, amount_native: undefined }])
          .excludedCount,
      ).toBe(1);
      expect(
        getLeaseCollectionBills(selectedContract, [
          { ...nativeRow, category: "property_fee" } as unknown as ReceivableRow,
        ]).excludedCount,
      ).toBe(1);
    }
  });

  it("shows an explicitly unperioded obligation as unknown, never derives it from due date", () => {
    const rows = [bill("rent", { service_period_start: null, service_period_end: undefined })];
    expect(getLeaseCollectionBills(contract, rows).bills[0]).toMatchObject({
      servicePeriodStart: null,
      servicePeriodEnd: null,
    });
  });

  it("preserves a confirmed end without inventing the unknown start date", () => {
    const rows = [bill("rent", { service_period_start: null })];
    expect(getLeaseCollectionBills(contract, rows)).toMatchObject({
      bills: [{ servicePeriodStart: null, servicePeriodEnd: "2026-09-30" }],
      excludedCount: 0,
    });
    expect(buildLeaseCollectionSubmission(contract, rows, draft(), today).ok).toBe(true);
    expect(rows[0].service_period_start).toBeNull();
  });

  it("rejects unknown or blank buildings before offering a receipt even without an expected-building context", () => {
    for (const building of [null, "", "   "]) {
      const rows = [bill("rent", { building_id: building })];
      expect(getLeaseCollectionBills(contract, rows)).toEqual({ bills: [], excludedCount: 1 });
      expect(codes({}, rows)).toContain("allocations.rent:unavailable_receivable");
    }
  });

  it("matches an explicit current building without inferring it from contract, unit or customer names", () => {
    const rows = [bill("rent", { building_id: "other-building" })];
    expect(getLeaseCollectionBills(contract, rows).bills).toHaveLength(1);
    expect(getLeaseCollectionBills(contract, rows, "building")).toEqual({
      bills: [],
      excludedCount: 1,
    });
    const result = buildLeaseCollectionSubmission(contract, rows, draft(), today, "building");
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.issues).toContainEqual({
        field: "allocations.rent",
        code: "unavailable_receivable",
      });
  });

  it("keeps building context out of the financial payload and stable idempotency fingerprint", () => {
    const base = buildLeaseCollectionSubmission(contract, [bill()], draft(), today);
    const scoped = buildLeaseCollectionSubmission(contract, [bill()], draft(), today, "building");
    expect(scoped).toEqual(base);
    expect(scoped.ok && scoped.input).not.toHaveProperty("expectedBuildingId");
  });

  it("does not require an update timestamp or invent one when unavailable", () => {
    const rows = [bill("rent", { updated_at: "" })];
    expect(getLeaseCollectionBills(contract, rows).bills[0]).not.toHaveProperty(
      "expectedUpdatedAt",
    );
  });
});

describe("reviewable collection submission", () => {
  it("passes a one-screen collection and includes balance/version evidence", () => {
    expect(buildLeaseCollectionSubmission(contract, [bill()], draft(), today)).toEqual({
      ok: true,
      allocatedAmount: 600000,
      input: {
        contractId: "contract",
        amount: 600000,
        currency: "XOF",
        paymentDate: today,
        paymentMethod: "cash",
        allocations: [
          {
            receivableId: "rent",
            amount: 600000,
            expectedOutstanding: 600000,
            expectedUpdatedAt: "2026-09-01T00:00:00Z",
          },
        ],
      },
    });
  });

  it("allocates combined rent/property receipts exactly, without automatic amounts", () => {
    const rows = [
      bill(),
      bill("property", {
        category: "property_fee",
        amount_xof: 40000,
      } as unknown as Partial<ReceivableRow>),
    ];
    const input = draft({
      amount: "64",
      amountUnit: "wan",
      allocations: { rent: "600000", property: "40000" },
    });
    const before = structuredClone({ contract, rows, input });
    const result = buildLeaseCollectionSubmission(contract, rows, input, today);
    expect(result.ok && result.input.amount).toBe(640000);
    expect(result.ok && result.input.allocations.map((row) => row.amount)).toEqual([600000, 40000]);
    expect(result.ok && result.input).not.toHaveProperty("paidThroughDate");
    expect(result.ok && result.input).not.toHaveProperty("requestId");
    expect({ contract, rows, input }).toEqual(before);
  });

  it("does not automatically allocate even one unambiguous bill", () => {
    expect(codes({ allocations: {} })).toContain("allocations:unallocated");
  });

  it("allows partial receipts without overwriting an already paid amount", () => {
    const rows = [bill("rent", { status: "partial", paid_amount_xof: 100000 })];
    const result = buildLeaseCollectionSubmission(
      contract,
      rows,
      draft({ amount: "200000", allocations: { rent: "200000" } }),
      today,
    );
    expect(result.ok && result.input.allocations[0]).toMatchObject({
      amount: 200000,
      expectedOutstanding: 500000,
    });
    expect(rows[0].paid_amount_xof).toBe(100000);
  });

  it("ignores blank unselected controls but zero is not an unselected allocation", () => {
    const result = buildLeaseCollectionSubmission(
      contract,
      [bill()],
      draft({ allocations: { rent: "600000", ignored: " " } }),
      today,
    );
    expect(result.ok).toBe(true);
    expect(codes({ allocations: { rent: "0" } })).toContain("allocations.rent:invalid_amount");
  });

  it.each(["", "0", "-1", "NaN", "1e5", "100.001", "1000000000000"])(
    "rejects invalid total %s",
    (amount) => {
      expect(codes({ amount })).toContain("amount:invalid_amount");
    },
  );

  it("does not silently interpret an invalid amount unit or unsupported currency", () => {
    expect(codes({ amountUnit: "million" as "unit" })).toContain("amountUnit:unsupported_unit");
    expect(codes({ currency: "EUR" as "XOF" })).toContain("currency:unsupported_currency");
    expect(codes({ currency: "USD", amountUnit: "wan" })).toContain("amountUnit:unsupported_unit");
  });

  it.each([
    "",
    "2026-02-29",
    "2026-02-30",
    "2026-04-31",
    "2026-13-01",
    "2026-00-01",
    "2026-10-00",
    "0000-01-01",
    "2026-1-1",
    "2026-10-20T00:00:00Z",
  ])("rejects invalid receipt date %s", (paymentDate) => {
    expect(codes({ paymentDate })).toContain("paymentDate:invalid_date");
  });

  it("accepts leap day, refuses future receipts, and fails closed on an invalid current date", () => {
    expect(
      buildLeaseCollectionSubmission(
        contract,
        [bill()],
        draft({ paymentDate: "2024-02-29" }),
        today,
      ).ok,
    ).toBe(true);
    expect(codes({ paymentDate: "2026-10-21" })).toContain("paymentDate:future_date");
    expect(codes({}, [bill()], contract, "invalid")).toContain("paymentDate:invalid_date");
  });

  it.each(["", "offset", "credit", "Cash"])(
    "does not invent or accept non-cash receipt method %s",
    (paymentMethod) => {
      expect(codes({ paymentMethod: paymentMethod as "cash" })).toContain("paymentMethod:required");
    },
  );

  it.each(["cash", "bank_transfer", "check", "other"] as const)(
    "accepts explicit method %s",
    (paymentMethod) => {
      expect(
        buildLeaseCollectionSubmission(contract, [bill()], draft({ paymentMethod }), today).ok,
      ).toBe(true);
    },
  );

  it("does not infer collector from contract/customer and requires the user's evidence when named", () => {
    const result = buildLeaseCollectionSubmission(contract, [bill()], draft(), today);
    expect(result.ok && result.input).not.toHaveProperty("actualCollector");
    expect(codes({ actualCollector: "颖" })).toContain("collectorBasis:collector_basis_required");
    expect(codes({ actualCollector: "颖", collectorBasis: "   " })).toContain(
      "collectorBasis:collector_basis_required",
    );
    expect(codes({ collectorBasis: "群内收据" })).toContain("actualCollector:collector_required");
    const named = buildLeaseCollectionSubmission(
      contract,
      [bill()],
      draft({
        actualCollector: "  颖 ",
        collectorBasis: " 群内原始收据 ",
        externalReceiptNo: "  R-001 ",
        notes: " 银行到账已核实 ",
      }),
      today,
    );
    expect(named.ok && named.input).toMatchObject({
      actualCollector: "颖",
      collectorBasis: "群内原始收据",
      externalReceiptNo: "R-001",
      notes: "银行到账已核实",
    });
  });

  it.each([
    ["externalReceiptNo", 200],
    ["actualCollector", 100],
    ["collectorBasis", 1000],
    ["notes", 2000],
  ] as const)("matches server length limit for %s", (field, limit) => {
    expect(
      codes({
        [field]: "x".repeat(limit + 1),
        actualCollector: field === "actualCollector" ? "x".repeat(limit + 1) : "颖",
        collectorBasis: field === "collectorBasis" ? "x".repeat(limit + 1) : "proof",
      }),
    ).toContain(`${field}:too_long`);
    expect(
      buildLeaseCollectionSubmission(
        contract,
        [bill()],
        draft({
          [field]: "x".repeat(limit),
          actualCollector: field === "actualCollector" ? "x".repeat(limit) : "颖",
          collectorBasis: field === "collectorBasis" ? "x".repeat(limit) : "proof",
        }),
        today,
      ).ok,
    ).toBe(true);
  });

  it("refuses stale/deleted/other-contract selected bills instead of reallocating", () => {
    expect(codes({ allocations: { unknown: "600000" } })).toContain(
      "allocations.unknown:unavailable_receivable",
    );
    expect(codes({}, [bill("rent", { source_id: "another-contract" })])).toContain(
      "allocations.rent:unavailable_receivable",
    );
    expect(codes({}, [bill("rent", { status: "paid" })])).toContain(
      "allocations.rent:unavailable_receivable",
    );
  });

  it.each(["", "-1", "1e5", "NaN", "100.001"])(
    "allocation precision/format is strict: %s",
    (amount) => {
      const issue = amount === "" ? "allocations:unallocated" : "allocations.rent:invalid_amount";
      expect(codes({ allocations: { rent: amount } })).toContain(issue);
    },
  );

  it("refuses over-allocation and exact cent mismatches rather than rounding", () => {
    expect(codes({ amount: "600000.01", allocations: { rent: "600000.01" } })).toContain(
      "allocations.rent:exceeds_balance",
    );
    expect(codes({ amount: "599999.99" })).toContain("allocations:amount_mismatch");
    const small = [bill("rent", { amount_xof: 0.1 }), bill("two", { amount_xof: 0.2 })];
    const exact = buildLeaseCollectionSubmission(
      contract,
      small,
      draft({ amount: "0.30", allocations: { rent: "0.1", two: "0.2" } }),
      today,
    );
    expect(exact.ok && exact.allocatedAmount).toBe(0.3);
  });

  it("supports same-currency native collections without exchanging or paying XOF obligations", () => {
    const nativeContract = { ...contract, rent_currency: "USD" as const };
    const nativeBill = bill("rent", {
      currency: "USD",
      amount_xof: 0,
      paid_amount_xof: 0,
      amount_native: 3200.29,
      paid_amount_native: 0,
    });
    const nativeDraft = draft({
      currency: "USD",
      amount: "3200.29",
      allocations: { rent: "3200.29" },
    });
    const result = buildLeaseCollectionSubmission(nativeContract, [nativeBill], nativeDraft, today);
    expect(result.ok && result.input).toMatchObject({ currency: "USD", amount: 3200.29 });
    expect(result.ok && result.input).not.toHaveProperty("exchangeRateToXof");
    const property = bill("property", {
      category: "property_fee",
      amount_xof: 100,
    } as unknown as Partial<ReceivableRow>);
    expect(
      codes(
        { currency: "USD", amount: "100", allocations: { property: "100" } },
        [property],
        nativeContract,
      ),
    ).toContain("allocations.property:currency_mismatch");
  });

  it("limits atomic allocation count, including multiple existing obligations", () => {
    const rows = Array.from({ length: 101 }, (_, i) => bill(`r${i}`, { amount_xof: 1 }));
    const allocations = Object.fromEntries(rows.map((row) => [row.id, "1"]));
    expect(codes({ amount: "101", allocations }, rows)).toContain(
      "allocations:too_many_allocations",
    );
    rows.pop();
    delete allocations.r100;
    expect(
      buildLeaseCollectionSubmission(contract, rows, draft({ amount: "100", allocations }), today)
        .ok,
    ).toBe(true);
  });

  it("keeps sum bounded even when each individual allocation is within the limit", () => {
    const rows = [
      bill("a", { amount_xof: 999999999999.99 }),
      bill("b", { amount_xof: 999999999999.99 }),
    ];
    expect(
      codes(
        { amount: "999999999999.99", allocations: { a: "999999999999.99", b: "999999999999.99" } },
        rows,
      ),
    ).toContain("allocations:invalid_amount");
  });

  it("refuses non-active contracts at submission even if a caller retained an old draft", () => {
    expect(codes({}, [bill()], { ...contract, status: "terminated" })).toContain(
      "contract:invalid_contract",
    );
  });
});

describe("optional proven rent coverage proposal", () => {
  const started = {
    ...contract,
    commencement_state: "started",
    start_date: "2026-01-01",
    expected_end_date: "2026-12-31",
    expected_end_confirmed: true,
    updated_at: "2026-10-01T12:00:00Z",
  } as LeaseContractRow;
  const known = (id = "rent", changes: Partial<ReceivableRow> = {}) =>
    bill(id, {
      service_period_source: "Explicit signed rent schedule",
      ...changes,
    });
  it("offers exact known coverage without opting in, and only attaches it when explicitly selected", () => {
    const rows = [known()];
    const proposal = getLeaseCollectionCoverageProposal(started, rows, draft());
    expect(proposal).toEqual({
      expectedPaidThroughDate: "2026-08-31",
      expectedContractUpdatedAt: "2026-10-01T12:00:00Z",
      throughDate: "2026-09-30",
      receivableIds: ["rent"],
    });
    const unchanged = buildLeaseCollectionSubmission(started, rows, draft(), today);
    expect(unchanged.ok && unchanged.input).not.toHaveProperty("coverage");
    const result = buildLeaseCollectionSubmission(
      started,
      rows,
      draft({ syncPaidThrough: true }),
      today,
    );
    expect(result.ok && result.input).toHaveProperty("coverage", proposal);
    expect(started.paid_through_date).toBe("2026-08-31");
    expect(rows[0].paid_amount_xof).toBe(0);
  });
  it("accepts a fully paid contiguous existing segment followed by this selected rent", () => {
    const rows = [
      known("old", { paid_amount_xof: 600000, status: "paid" }),
      known("oct", { service_period_start: "2026-10-01", service_period_end: "2026-10-31" }),
    ];
    expect(
      getLeaseCollectionCoverageProposal(started, rows, draft({ allocations: { oct: "600000" } })),
    ).toMatchObject({ throughDate: "2026-10-31", receivableIds: ["old", "oct"] });
  });
  it("validates already-paid nonselected proof rows against the current building too", () => {
    const rows = [
      known("old", { paid_amount_xof: 600000, status: "paid", building_id: "other-building" }),
      known("oct", { service_period_start: "2026-10-01", service_period_end: "2026-10-31" }),
    ];
    const current = draft({ allocations: { oct: "600000" } });
    expect(proposeLeaseCoverage(started, rows, current, today)).not.toBeNull();
    expect(proposeLeaseCoverage(started, rows, current, today, "building")).toBeNull();
    rows[0].building_id = null;
    expect(proposeLeaseCoverage(started, rows, current, today)).toBeNull();
  });

  it("orders proof by exact service periods, not due dates, IDs, or input ordering", () => {
    const rows = [
      known("oct", {
        service_period_start: "2026-10-01",
        service_period_end: "2026-10-31",
        due_date: "2026-01-01",
      }),
      known("sept", { due_date: "2026-12-31" }),
    ];
    expect(
      getLeaseCollectionCoverageProposal(
        started,
        rows,
        draft({ allocations: { sept: "600000", oct: "600000" } }),
      ),
    ).toMatchObject({ throughDate: "2026-10-31", receivableIds: ["sept", "oct"] });
  });
  it.each([
    { service_period_start: null },
    { service_period_end: null },
    { service_period_source: null },
    { service_period_source: "  " },
    { service_period_start: "2026-09-02" },
    { service_period_start: "2026-08-31" },
    { service_period_end: "2026-09-31" },
    { management_status: "historical_pending" },
    { unit_id: "wrong" },
    { customer_id: "wrong" },
    { currency: "USD" },
  ] as Partial<ReceivableRow>[])(
    "does not propose coverage from incomplete or mismatched evidence %j",
    (change) => {
      expect(
        getLeaseCollectionCoverageProposal(started, [known("rent", change)], draft()),
      ).toBeNull();
    },
  );
  it.each([
    { paid_through_date: null },
    { start_date: "2026-09-02" },
    { status: "terminated" },
    { commencement_state: "unconfirmed" },
    { commencement_state: undefined },
    { updated_at: "" },
    { updated_at: "invalid" },
    { expected_end_date: "2026-09-29" },
    { expected_end_date: "invalid" },
    { actual_end_date: "2026-09-15" },
    { start_date: "2026-11-01" },
  ])("requires started contract and reliable current boundary/version %j", (change) => {
    expect(
      getLeaseCollectionCoverageProposal(
        { ...started, ...change } as LeaseContractRow,
        [known()],
        draft(),
      ),
    ).toBeNull();
  });
  it("does not turn an explicitly unconfirmed end date into a fake formal bound", () => {
    expect(
      getLeaseCollectionCoverageProposal(
        { ...started, expected_end_date: "2026-09-15", expected_end_confirmed: false },
        [known()],
        draft(),
      ),
    ).toMatchObject({ throughDate: "2026-09-30" });
  });
  it("does not internally read a drifting clock or accept a malformed current date", () => {
    expect(proposeLeaseCoverage(started, [known()], draft(), "invalid")).toBeNull();
  });
  it("does not use a contradictory pending row with a fully paid numeric balance as proof", () => {
    const rows = [
      known("old", { paid_amount_xof: 600000, status: "pending" }),
      known("oct", { service_period_start: "2026-10-01", service_period_end: "2026-10-31" }),
    ];
    expect(
      getLeaseCollectionCoverageProposal(started, rows, draft({ allocations: { oct: "600000" } })),
    ).toBeNull();
  });
  it("does not advance on partial selected payment, a gap, or property-only receipt", () => {
    expect(
      getLeaseCollectionCoverageProposal(
        started,
        [known()],
        draft({ allocations: { rent: "100000" } }),
      ),
    ).toBeNull();
    expect(
      getLeaseCollectionCoverageProposal(
        started,
        [known("oct", { service_period_start: "2026-10-01", service_period_end: "2026-10-31" })],
        draft({ allocations: { oct: "600000" } }),
      ),
    ).toBeNull();
    expect(
      getLeaseCollectionCoverageProposal(
        started,
        [
          known("rent", { paid_amount_xof: 600000, status: "paid" }),
          known("property", { category: "property_fee" }),
        ],
        draft({ allocations: { property: "600000" } }),
      ),
    ).toBeNull();
  });
  it("rejects another overlapping obligation, even when an easier paid sequence was selected", () => {
    for (const management of ["managed", "historical_pending", "excluded"] as const) {
      const rows = [
        known(),
        known("overlap", {
          service_period_start: "2026-09-15",
          service_period_end: "2026-10-14",
          management_status: management,
        }),
      ];
      expect(getLeaseCollectionCoverageProposal(started, rows, draft())).toBeNull();
    }
  });
  it("refuses unknown-period or prior managed unpaid rent without guessing from its due date", () => {
    const unknown = known("unknown", {
      service_period_start: null,
      service_period_end: null,
      service_period_source: null,
      due_date: "2027-12-31",
    });
    const prior = known("prior", {
      service_period_start: "2026-07-01",
      service_period_end: "2026-07-31",
    });
    expect(getLeaseCollectionCoverageProposal(started, [known(), unknown], draft())).toBeNull();
    expect(getLeaseCollectionCoverageProposal(started, [known(), prior], draft())).toBeNull();
    expect(
      getLeaseCollectionCoverageProposal(
        started,
        [known(), { ...unknown, paid_amount_xof: 600000, status: "paid" }],
        draft(),
      ),
    ).not.toBeNull();
  });
  it("allows separately known future unpaid rent without creating or collecting it", () => {
    const future = known("future", {
      service_period_start: "2026-11-01",
      service_period_end: "2026-11-30",
    });
    expect(getLeaseCollectionCoverageProposal(started, [future, known()], draft())).toMatchObject({
      throughDate: "2026-09-30",
      receivableIds: ["rent"],
    });
    expect(future.paid_amount_xof).toBe(0);
  });
  it("supports native contractual rent only, never treats XOF property charges as native coverage", () => {
    const c = { ...started, rent_currency: "USD" as const };
    const native = known("rent", {
      currency: "USD",
      amount_xof: 0,
      paid_amount_xof: 0,
      amount_native: 3200.29,
      paid_amount_native: 0,
    });
    expect(
      getLeaseCollectionCoverageProposal(
        c,
        [native],
        draft({ currency: "USD", allocations: { rent: "3200.29" } }),
      ),
    ).toMatchObject({ throughDate: "2026-09-30" });
    expect(getLeaseCollectionCoverageProposal(c, [native], draft())).toBeNull();
  });
  it("rejects an opt-in without a proven candidate rather than silently dropping the requested action", () => {
    expect(codes({ syncPaidThrough: true })).toContain("coverage:coverage_unavailable");
  });
});
