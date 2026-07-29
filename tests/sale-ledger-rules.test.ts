import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const actions = readFileSync(join(root, "src/features/sales/actions.ts"), "utf8");
const view = readFileSync(join(root, "src/features/sales/sale-list.tsx"), "utf8");
const migration = readFileSync(join(root, "supabase/migrations/202607290004_atomic_sale_contract_create.sql"), "utf8");

describe("sale ledger accuracy rules", () => {
  it("creates sale contracts through one database transaction", () => {
    expect(actions).toContain('rpc("create_sale_contract_rpc"');
    expect(actions).not.toMatch(/from\("sale_contracts"\)\s*\.insert/);
  });

  it("uses client-stable idempotency ids for contract creation", () => {
    expect(view).toContain("createRequestIdRef.current??crypto.randomUUID()");
    expect(migration).toContain("sale_contracts_request_id_unique");
  });

  it("writes contract, schedule, receivable, room status and audit together", () => {
    expect(migration).toContain("insert into public.sale_contracts");
    expect(migration).toContain("insert into public.sale_payment_schedule");
    expect(migration).toContain("insert into public.receivables");
    expect(migration).toContain("update public.units set status = 'sold'");
    expect(migration).toContain("insert into public.audit_logs");
  });

  it("does not hide historical contracts", () => {
    const zhPage = readFileSync(join(root, "src/app/sales/page.tsx"), "utf8");
    expect(zhPage).not.toContain('.eq("status", "active")');
    expect(view).toContain('value: "terminated"');
  });
});
