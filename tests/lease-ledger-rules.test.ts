import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "..");
const ledger = readFileSync(resolve(root, "src/features/leases/lease-ledger.tsx"), "utf8");
const actions = readFileSync(resolve(root, "src/features/leases/actions.ts"), "utf8");
const migration = readFileSync(
  resolve(root, "supabase/migrations/202607290003_atomic_lease_financial_entries.sql"),
  "utf8",
);

describe("lease ledger rules", () => {
  it("shows the compact operational fields and no move-out workflow", () => {
    expect(ledger).toContain("楼栋 / 房号");
    expect(ledger).toContain("实际已收");
    expect(ledger).toContain("下次到期");
    expect(ledger).not.toContain("processMoveOut");
    expect(ledger).not.toContain("正在后台办理退租");
  });

  it("uses explicit UI capabilities for creation and finance writes", () => {
    expect(ledger).toMatch(/canCreate &&/);
    expect(ledger).toMatch(/canRecordFinance &&/);
    expect(ledger).toMatch(/requestId/);
    expect(ledger).toMatch(/crypto\.randomUUID\(\)/);
  });

  it("records lease money atomically and idempotently", () => {
    expect(actions).toMatch(/rpc\("record_lease_financial_entry_rpc"/);
    expect(migration).toMatch(/where request_id = p_request_id/i);
    expect(migration).toMatch(/insert into public\.payments/i);
    expect(migration).toMatch(/insert into public\.ledger_entries/i);
    expect(migration).toMatch(/update public\.receivables/i);
    expect(migration).toMatch(/update public\.lease_contracts/i);
    expect(migration).toMatch(/insert into public\.audit_logs/i);
  });
});
