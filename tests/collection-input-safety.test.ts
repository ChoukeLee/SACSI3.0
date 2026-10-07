import { describe, expect, it, vi } from "vitest";
import { checkCollectionReceipts } from "@/features/business-actions/collection-duplicate-check";
import {
  parseCollectionRequest,
  suggestCollectionAllocation,
  type CollectionRequest,
} from "@/features/business-actions/operator-batch";

const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const other = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const input = (): CollectionRequest => ({
  requestId: id,
  protocolVersion: "1.0",
  connectorVersion: "0.5.0",
  originalInstruction: "合成测试",
  totalXof: 100,
  rows: [
    {
      lineId: "1",
      sourceText: "合成收款",
      domain: "lease",
      targetId: id,
      totalXof: 100,
      paymentDate: "2026-10-07",
      paymentMethod: "cash",
      receiptNo: "TEST",
      allocations: [{ receivableId: id, amountXof: 100 }],
    },
  ],
});
const bill = {
  id,
  title: "租金",
  category: "lease_rent",
  due_date: "2026-10-07",
  amount_xof: 100,
  paid_amount_xof: 0,
};

describe("collection input safety", () => {
  it.each([null, undefined, "", " ", true, "1e2", "0x64", -1, 1.5])(
    "does not treat invalid paid amount %j as zero",
    (value) => {
      expect(
        suggestCollectionAllocation(100, [
          { ...bill, paid_amount_xof: value } as unknown as typeof bill,
        ]).status,
      ).toBe("clarification_required");
    },
  );
  it.each([
    { currency: "EUR" },
    { status: "paid" },
    { status: "cancelled" },
    { management_status: "historical_pending" },
    { management_status: "excluded" },
    { paid_amount_xof: 101 },
  ])("rejects nonpayable evidence %j", (extra) => {
    expect(suggestCollectionAllocation(100, [{ ...bill, ...extra }]).status).toBe(
      "clarification_required",
    );
  });
  it("accepts exact decimal database strings and explicit zero", () => {
    expect(
      suggestCollectionAllocation(100, [
        {
          ...bill,
          amount_xof: "100.00",
          paid_amount_xof: "0.00",
          currency: "XOF",
        } as unknown as typeof bill,
      ]).status,
    ).toBe("suggested");
  });
  it("compares UUID and line identities independently of case or whitespace", () => {
    expect(suggestCollectionAllocation(200, [bill, { ...bill, id: id.toUpperCase() }]).status).toBe(
      "clarification_required",
    );
    const q = input();
    q.totalXof = 200;
    q.rows.push({
      ...q.rows[0],
      lineId: " 1 ",
      targetId: other,
      allocations: [{ receivableId: other, amountXof: 100 }],
    });
    expect(() => parseCollectionRequest(q)).toThrow("duplicate_batch_target");
  });
});

function database(
  records: Array<{ source_id: string; receipt_no: string }>,
  error: unknown = null,
) {
  const range = vi.fn(async () => ({ data: records, error, count: records.length }));
  const query = {
    select: () => query,
    in: () => query,
    not: () => query,
    order: () => query,
    range,
  };
  return {
    db: { from: vi.fn(() => query) } as unknown as Parameters<typeof checkCollectionReceipts>[0],
    range,
  };
}
describe("read-only historical receipt preflight", () => {
  it("rejects the same receipt on the same target, including trimmed receipt and upper-case UUID", async () => {
    const { db } = database([{ source_id: id.toUpperCase(), receipt_no: " TEST " }]);
    await expect(checkCollectionReceipts(db, input())).rejects.toThrow(
      "duplicateCollectionReceipt",
    );
  });
  it("does not infer global uniqueness across different targets", async () => {
    const { db } = database([{ source_id: other, receipt_no: "TEST" }]);
    await expect(checkCollectionReceipts(db, input())).resolves.toBeUndefined();
  });
  it("does not query or invent a fingerprint when no receipt number is supplied", async () => {
    const { db } = database([]);
    const q = input();
    delete q.rows[0].receiptNo;
    await checkCollectionReceipts(db, q);
    expect(db.from).not.toHaveBeenCalled();
  });
  it("fails closed and hides database diagnostics", async () => {
    const { db } = database([], { message: "secret database detail" });
    await expect(checkCollectionReceipts(db, input())).rejects.toThrow(
      /^collectionDuplicateCheckUnavailable$/,
    );
  });
  it("reads past a server page cap instead of silently checking only one page", async () => {
    const { db, range } = database([]);
    range
      .mockResolvedValueOnce({
        data: [{ source_id: other, receipt_no: "other" }],
        error: null,
        count: 2,
      })
      .mockResolvedValueOnce({
        data: [{ source_id: id, receipt_no: "TEST" }],
        error: null,
        count: 2,
      });
    await expect(checkCollectionReceipts(db, input())).rejects.toThrow(
      "duplicateCollectionReceipt",
    );
    expect(range).toHaveBeenCalledTimes(2);
  });
});
