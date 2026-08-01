import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "..");
const ledger = readFileSync(resolve(root, "src/features/leases/lease-list.tsx"), "utf8");
const loader = readFileSync(resolve(root, "src/features/leases/lease-lazy-view.tsx"), "utf8");
const actions = readFileSync(resolve(root, "src/features/leases/actions.ts"), "utf8");
const migration = readFileSync(
  resolve(root, "supabase/migrations/202607290003_atomic_lease_financial_entries.sql"),
  "utf8",
);

describe("lease ledger rules", () => {
  it("uses the shared operational page, metrics and drawer", () => {
    expect(ledger).toContain("OperationalPage");
    expect(ledger).toContain("StatTile");
    expect(ledger).toContain("RightDrawer");
    expect(loader).not.toContain("ssr: false");
  });

  it("uses explicit UI capabilities for creation and finance writes", () => {
    expect(ledger).toMatch(/action=\{canCreate \?/);
    expect(ledger).toMatch(/canRecordFinance/);
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
