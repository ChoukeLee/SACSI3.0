import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

describe("privileged finance actions", () => {
  it("keeps application guards before using the service-role client", () => {
    const leases = read("src/features/leases/actions.ts");
    const sales = read("src/features/sales/actions.ts");
    const finance = read("src/features/finance/actions.ts");
    expect(leases.indexOf("await guardLeaseFinance();")).toBeLessThan(leases.indexOf("createPrivilegedClient();", leases.indexOf("recordLeaseFinancialEntry")));
    expect(sales.indexOf("await guardSaleFinance();")).toBeLessThan(sales.indexOf("createPrivilegedClient();", sales.indexOf("recordSalePaymentAtomic")));
    expect(finance.indexOf('await requireRole("admin", "finance");')).toBeLessThan(finance.indexOf("createPrivilegedClient();"));
  });

  it("uses privileged clients for lease, sale and manual finance writes", () => {
    expect(read("src/features/leases/actions.ts")).toContain("record_lease_financial_entry_rpc");
    expect(read("src/features/leases/actions.ts")).toContain("const supabase = createPrivilegedClient();");
    expect(read("src/features/sales/actions.ts")).toContain("const supabase = createPrivilegedClient();");
    expect(read("src/features/finance/actions.ts")).toContain("const supabase = createPrivilegedClient();");
  });
});
