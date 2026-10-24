import { randomUUID } from "node:crypto";
import type pg from "pg";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { installApplicationRebuild } from "./helpers/application-rebuild";
import { createNativePaymentPostgres } from "./helpers/native-payment-postgres";
import {
  decodeCimacCollectionPosition,
  decodeCimacWriteReceipt,
  decodeCimacWriteResult,
  parseCimacCollectionInput,
  parseCimacRefundInput,
  parseCimacReversalInput,
} from "@/features/finance/cimac-billing-service";
import { decodeCimacCustomerAccount } from "@/features/finance/cimac-billing-model";
import { decodeCimacLeaseCollectionProjection } from "@/features/contracts/cimac-contract-allocation";
import { summarizeContractCash } from "@/features/contracts/contract-cash-model";
import { CIMAC_PROJECT_ID, cimacExportCsv } from "@/features/finance/cimac-export-model";
import { readCimacExport } from "@/features/finance/cimac-export-read";
import { readFinanceRecordContext } from "@/features/finance/finance-record-context-read";
import { decodePaymentContext } from "@/features/finance/payment-context";

type Row = Record<string, unknown>;
let cluster: Awaited<ReturnType<typeof createNativePaymentPostgres>>,
  db: pg.Client,
  building: string;
const actor = randomUUID();
async function login() {
  await db.query("reset role");
  await db.query("select set_config('request.jwt.claims',$1,false)", [
    JSON.stringify({ sub: actor, role: "authenticated" }),
  ]);
  await db.query("set role authenticated");
}
async function rpc(name: string, params: Row = {}) {
  if (!/^[a-z_]+_rpc$/.test(name) || Object.keys(params).some((k) => !/^p_[a-z_]+$/.test(k)))
    throw new Error("Invalid local fixture query");
  const pairs = Object.keys(params).map((k, i) => `${k} => $${i + 1}`);
  return (await db.query(`select public.${name}(${pairs.join(",")}) value`, Object.values(params)))
    .rows[0].value;
}

/** Minimal Data API adapter backed by this fresh local PostgreSQL and current RLS role. */
function readClient() {
  let queue: Promise<unknown> = Promise.resolve();
  const sequential = <T>(task: () => Promise<T>): Promise<T> => {
    const next = queue.then(task);
    queue = next.catch(() => undefined);
    return next;
  };
  return {
    rpc: async (name: string, params: Row) => ({
      data: await sequential(() => rpc(name, params)),
      error: null,
    }),
    from(table: string) {
      if (
        ![
          "projects",
          "payments",
          "receivables",
          "units",
          "buildings",
          "ledger_entries",
          "payment_receivable_allocations",
          "lease_contracts",
          "customers",
        ].includes(table)
      )
        throw new Error("Unexpected local fixture table");
      let columns = "*",
        limit: number | undefined,
        offset = 0;
      const clauses: string[] = [],
        values: unknown[] = [],
        orders: string[] = [];
      const field = (name: string) => {
        if (!/^[a-z_]+$/.test(name)) throw new Error("Unexpected local fixture field");
        return name;
      };
      const result = async () => {
        const query = `select to_jsonb(x) row from (select ${columns} from public.${table}${clauses.length ? ` where ${clauses.join(" and ")}` : ""}${orders.length ? ` order by ${orders.join(",")}` : ""}${limit !== undefined ? ` limit ${limit} offset ${offset}` : ""}) x`;
        return {
          data: (await sequential(() => db.query(query, values))).rows.map((r) => r.row as Row),
          error: null,
        };
      };
      const b = {
        select(value: string) {
          if (!/^[a-z_,]+$/.test(value)) throw new Error("Unexpected local fixture columns");
          columns = value;
          return b;
        },
        eq(key: string, value: unknown) {
          values.push(value);
          clauses.push(`${field(key)}=$${values.length}`);
          return b;
        },
        in(key: string, value: unknown[]) {
          values.push(value);
          clauses.push(`${field(key)}=any($${values.length})`);
          return b;
        },
        order(key: string) {
          orders.push(field(key));
          return b;
        },
        range(start: number, end: number) {
          offset = start;
          limit = end - start + 1;
          return b;
        },
        limit(value: number) {
          limit = value;
          return b;
        },
        async maybeSingle() {
          const r = await result();
          return { ...r, data: r.data[0] ?? null };
        },
        then(
          resolve: (value: Awaited<ReturnType<typeof result>>) => unknown,
          reject?: (error: unknown) => unknown,
        ) {
          return result().then(resolve, reject);
        },
      };
      return b;
    },
  } as unknown as Pick<SupabaseClient, "from" | "rpc">;
}

beforeAll(async () => {
  cluster = await createNativePaymentPostgres();
  db = await cluster.connect();
  await installApplicationRebuild(db);
  await db.query("insert into auth.users(id,email) values($1,'boundary@test.invalid')", [actor]);
  await db.query(
    "insert into user_profiles(id,role,display_name) values($1,'admin','Boundary Admin')",
    [actor],
  );
  await db.query(
    "insert into projects(id,code,display_name,allows_long_lease) values($1,'CIMAC','Boundary CIMAC',true)",
    [CIMAC_PROJECT_ID],
  );
  building = (
    await db.query(
      "insert into buildings(project_id,code,display_name) values($1,'BOUNDARY','Boundary') returning id",
      [CIMAC_PROJECT_ID],
    )
  ).rows[0].id;
}, 45000);
afterAll(async () => {
  await cluster?.close();
});

it.each(["refund", "reversal"] as const)(
  "real PostgreSQL %s crosses service, account, contract, inspector and CSV read boundaries",
  async (kind) => {
    await db.query("reset role");
    const customer = randomUUID();
    await db.query("insert into customers(id,name) values($1,'Boundary customer')", [customer]);
    const lines = [];
    for (const [category, amount] of [
      ["lease_rent", 60000],
      ["property_fee", 40000],
    ] as const) {
      const unit = randomUUID(),
        contract = randomUUID(),
        receivable = randomUUID();
      await db.query(
        "insert into units(id,building_id,code,unit_no,floor_label,kind,status) values($1::uuid,$2,$1::text,$1::text,'G','storefront','leased')",
        [unit, building],
      );
      await db.query(
        "insert into lease_contracts(id,unit_id,customer_id,contract_no,start_date,expected_end_date,payment_cycle,payment_day,monthly_rent_xof,status) values($1::uuid,$2,$3,$1::text,current_date-30,current_date+365,'monthly',1,100000,'active')",
        [contract, unit, customer],
      );
      const stamp = (
        await db.query(
          "insert into receivables(id,building_id,unit_id,customer_id,source_type,source_id,category,title,due_date,amount_xof,paid_amount_xof,currency,status,management_status) values($1,$2,$3,$4,'lease_contract',$5,$6,'Boundary explicit bill',current_date-1,$7,0,'XOF','pending','managed') returning to_jsonb(updated_at) as stamp",
          [receivable, building, unit, customer, contract, category, amount],
        )
      ).rows[0].stamp;
      lines.push({ unit, contract, receivable, stamp, amount, category });
    }
    const { date_value: today, prior_day: priorDay } = (
      await db.query("select current_date::text date_value,(current_date-1)::text prior_day")
    ).rows[0];
    await login();
    const originalInput = parseCimacCollectionInput({
      requestId: randomUUID(),
      customerId: customer,
      paymentDate: priorDay,
      currency: "XOF",
      amount: "100000",
      paymentMethod: "bank_transfer",
      allocations: lines.map((l) => ({
        receivableId: l.receivable,
        amount: String(l.amount),
        expectedOutstanding: String(l.amount),
        expectedUpdatedAt: l.stamp,
      })),
    });
    const { requestId: originalRequest, ...originalPayload } = originalInput;
    const original = decodeCimacWriteResult(
      await rpc("cimac_collect_customer_rpc", {
        p_input: originalPayload,
        p_request_id: originalRequest,
      }),
      originalInput,
      "collection",
      actor,
    );
    const position = decodeCimacCollectionPosition(
      await rpc("cimac_collection_position_rpc", { p_original_payment_id: original.paymentId }),
      original.paymentId!,
    );
    const shares = new Map<string, number>(
      lines.map((l) => [
        l.receivable,
        kind === "reversal" ? l.amount : l.category === "lease_rent" ? 10000 : 5000,
      ]),
    );
    const common = {
      requestId: randomUUID(),
      originalPaymentId: original.paymentId,
      customerId: customer,
      currency: "XOF",
      amount: kind === "reversal" ? "100000" : "15000",
      reason: "Boundary authorized local correction",
      expectedPositionToken: position.positionToken,
      allocations: position.allocations.map((a) => ({
        receivableId: a.receivableId,
        amount: String(shares.get(a.receivableId)),
        expectedRemaining: a.remainingAmount,
        expectedPaid: a.paidAmount,
        expectedUpdatedAt: a.updatedAt,
      })),
    };
    const input =
      kind === "refund"
        ? parseCimacRefundInput({ ...common, paymentDate: today, paymentMethod: "cash" })
        : parseCimacReversalInput(common);
    const { requestId, ...payload } = input;
    const correction = decodeCimacWriteResult(
      await rpc(
        kind === "refund" ? "cimac_refund_collection_rpc" : "cimac_reverse_collection_rpc",
        { p_input: payload, p_request_id: requestId },
      ),
      input,
      kind,
      actor,
    );
    expect(correction.paymentMethod).toBe(kind === "refund" ? "cash" : "offset");
    expect(correction.paymentDate).toBe(kind === "refund" ? today : priorDay);
    const recovered = decodeCimacWriteReceipt(
      await rpc("cimac_billing_request_rpc", { p_request_id: requestId }),
      requestId,
    );
    expect(recovered).toMatchObject({
      originalPaymentId: original.paymentId,
      paymentId: correction.paymentId,
      kind,
      customerId: customer,
      actorId: actor,
    });
    const after = decodeCimacCollectionPosition(
      await rpc("cimac_collection_position_rpc", { p_original_payment_id: original.paymentId }),
      original.paymentId!,
    );
    expect(after.remainingAmount).toBe(kind === "refund" ? "85000" : "0");
    const account = decodeCimacCustomerAccount(
      await rpc("cimac_customer_account_rpc", { p_customer_id: customer }),
      customer,
    );
    expect(account.payments).toHaveLength(2);
    expect(account.allocations).toHaveLength(2);
    expect(account.payments.find((p) => p.id === original.paymentId)?.amount).toBe(100000);
    expect(account.payments.find((p) => p.id === correction.paymentId)?.amount).toBe(
      kind === "refund" ? 15000 : -100000,
    );
    let net = 0;
    for (const line of lines) {
      const projection = decodeCimacLeaseCollectionProjection(
        await rpc("cimac_lease_collection_projection_rpc", { p_contract_id: line.contract }),
        line.contract,
        customer,
      );
      expect(projection).toHaveLength(2);
      expect(
        projection.find((p) => p.id === correction.paymentId)!.cimac_contract_allocation.amount,
      ).toBe(String(-shares.get(line.receivable)!));
      const cash = summarizeContractCash(projection);
      net += cash.net;
      expect(cash.expense).toBe(kind === "refund" ? shares.get(line.receivable) : 0);
    }
    expect(net).toBe(kind === "refund" ? 85000 : 0);
    const metadata = decodePaymentContext(
      await rpc("payment_context_read_rpc", { p_payment_id: correction.paymentId }),
    );
    expect(metadata.allocatedXof).toBe(kind === "refund" ? -15000 : -100000);
    const selected = (
      await db.query(
        "select id from ledger_entries where payment_id=$1 and category='property_fee'",
        [correction.paymentId],
      )
    ).rows[0].id;
    const context = await readFinanceRecordContext(readClient(), { kind: "ledger", id: selected });
    expect(context).toMatchObject({
      source: {
        type: kind === "refund" ? "cimac_customer_refund" : "cimac_customer_reversal",
        id: original.paymentId,
      },
      customer: { id: customer },
      amountXof: kind === "refund" ? -5000 : -40000,
    });
    const bundle = await readCimacExport(readClient(), {
      view: "property-fee-payments",
      locale: "zh",
    });
    const csv = cimacExportCsv(bundle, { view: "property-fee-payments", locale: "zh" });
    expect(csv).toContain(correction.paymentId!);
    expect(csv).toContain(original.paymentId!);
    expect(csv).toContain(kind === "refund" ? '"-5000"' : '"-40000"');
    expect(csv).toContain(kind === "refund" ? "登记实际退款" : "错误收款整单账务冲正，非实际退款");
    expect(csv).toContain("客户总账支付／校正原币金额");
  },
  20000,
);
