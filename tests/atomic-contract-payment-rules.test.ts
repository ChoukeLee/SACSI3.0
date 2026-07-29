import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "..");
const migration = readFileSync(
  resolve(root, "supabase/migrations/202607280006_atomic_contract_payments.sql"),
  "utf8",
);
const actions = readFileSync(resolve(root, "src/features/sales/actions.ts"), "utf8");
const saleList = readFileSync(resolve(root, "src/features/sales/sale-list.tsx"), "utf8");

describe("atomic contract payment rules", () => {
  it("locks sale schedules and receivables before updating money", () => {
    expect(migration).toMatch(/sale_payment_schedule[\s\S]*for update/i);
    expect(migration).toMatch(/from public\.receivables[\s\S]*for update/i);
  });

  it("writes payment, ledger, receivable, schedule and audit in one RPC", () => {
    expect(migration).toMatch(/insert into public\.payments/i);
    expect(migration).toMatch(/insert into public\.ledger_entries/i);
    expect(migration).toMatch(/update public\.receivables/i);
    expect(migration).toMatch(/update public\.sale_payment_schedule/i);
    expect(migration).toMatch(/insert into public\.audit_logs/i);
  });

  it("uses a stable client request id and the atomic RPC", () => {
    expect(actions).toMatch(/rpc\("record_sale_payment_rpc"/);
    expect(saleList).toMatch(/payRequestIdRef/);
    expect(saleList).toMatch(/crypto\.randomUUID\(\)/);
    expect(saleList).toMatch(/recordSalePaymentAtomic/);
  });
});
