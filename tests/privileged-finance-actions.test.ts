import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

describe("privileged finance actions", () => {
  it("keeps role guards on financial writes", () => {
    const leases = read("src/features/leases/lease-payment-actions.ts");
    const sales = read("src/features/sales/actions.ts");
    const finance = read("src/features/finance/actions.ts");
    expect(leases).toContain("await guardLeaseFinance();");
    expect(sales).toContain("await guardSaleFinance();");
    expect(finance.indexOf('await requireRole("admin", "finance");')).toBeLessThan(finance.indexOf("createPrivilegedClient();"));
  });

  it("preserves the caller session for atomic lease and sale payments", () => {
    const leasePayment = read("src/features/leases/lease-payment-actions.ts");
    expect(leasePayment).toContain("record_lease_financial_entry_v2_rpc");
    expect(leasePayment).toContain("await createClient()");
    expect(leasePayment).not.toContain("createPrivilegedClient");
    expect(read("src/features/sales/actions.ts")).not.toContain("createPrivilegedClient");
    expect(read("src/features/finance/actions.ts")).toContain("const supabase = createPrivilegedClient();");
  });

  it("moves settlement to one authenticated atomic RPC without a privileged client", () => {
    const leases = read("src/features/leases/lease-moveout-actions.ts");
    const moveOut = leases.slice(leases.indexOf("export async function processMoveOut"));
    expect(moveOut).toContain("await guardLeaseFinance();");
    expect(moveOut).toContain("lease_lifecycle_rpc");
    expect(moveOut).toContain("await createClient()");
    expect(moveOut).not.toContain("createPrivilegedClient");
    expect(moveOut).not.toContain(".from(");
  });
});
