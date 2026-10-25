import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "..");
const ledger = readFileSync(resolve(root, "src/features/leases/lease-list.tsx"), "utf8");
const loader = readFileSync(resolve(root, "src/features/leases/lease-lazy-view.tsx"), "utf8");
const preview = readFileSync(
  resolve(root, "src/features/leases/use-lease-workbench-preview.ts"),
  "utf8",
);
const inspector = readFileSync(
  resolve(root, "src/features/leases/lease-workbench-inspector.tsx"),
  "utf8",
);
const table = readFileSync(resolve(root, "src/features/leases/lease-workbench-table.tsx"), "utf8");
const serverActions = readFileSync(resolve(root, "src/features/leases/actions.ts"), "utf8");
const actions = readFileSync(resolve(root, "src/features/leases/lease-payment-actions.ts"), "utf8");
const migration = readFileSync(
  resolve(
    root,
    "supabase/migrations/20260923162712_standardize_financial_references_and_currency_rules.sql",
  ),
  "utf8",
);

describe("lease ledger rules", () => {
  it("uses the selected workbench without replacing the shared page or full contract drawer", () => {
    expect(ledger).toContain("<OperationalPage");
    expect(ledger).toContain("<LeaseWorkbenchTable");
    expect(ledger).toContain("<LeaseWorkbenchInspector");
    expect(ledger).toContain("<RightDrawer");
    expect(ledger).toContain("onOpen={openDetail}");
    expect(ledger).toContain('onFinance={(id) => openDetail(id, "finance")}');
    expect(loader).not.toContain("ssr: false");
  });

  it("reads only an explicitly selected contract and invalidates previews across query and page changes", () => {
    expect(ledger).toMatch(/useState<\{[\s\S]*?scope: string;[\s\S]*?\}\s*\|\s*null>\(null\)/);
    expect(
      /useLeaseWorkbenchPreview\(\s*workspace\.query,\s*previewId,\s*previewSelection\?\.version,\s*workArea\s*,?\s*\)/.test(
        ledger,
      ),
    ).toBe(true);
    expect(preview.includes("${selectionVersion}")).toBe(true);
    expect(ledger).toContain("previewSelection?.scope === previewScope");
    expect(ledger).toContain("previewSelection.page === workspace.pageData");
    expect(ledger).toContain("previewSelection.contracts === initialContracts");
    expect(ledger).toContain("onVisibleIdsChange={syncVisiblePreview}");
    expect(preview).toContain("if (!query || !contractId || !key) return;");
    expect(preview).toContain('params.set("mode", "detail")');
    expect(preview).toContain('params.set("contractId", contractId)');
    expect(preview).toContain('if (workArea === "cimac") params.set("workspace", workArea)');
    expect(preview).toContain('cache: "no-store"');
    expect(preview).toContain("new AbortController()");
    expect(preview).toContain("controller.abort()");
    expect(preview).toContain(
      'decodeWorkspace(await response.json(), "lease", query, "detail", contractId)',
    );
    expect(preview).not.toContain('params.set("mode", "scope")');
    expect(preview).not.toContain("workspace.ensure");
  });

  it("keeps table, inspector and preview read-only and retains the existing server-action boundary", () => {
    for (const component of [table, inspector, preview]) {
      expect(component).not.toMatch(/from\s+["'][^"']*(?:actions|supabase)[^"']*["']/);
      expect(component).not.toMatch(/\.(?:rpc|insert|update|delete|upsert)\s*\(/);
      expect(component).not.toMatch(/\bmethod\s*:\s*["'](?:POST|PUT|PATCH|DELETE)["']/i);
    }
    expect(ledger).toMatch(
      /import\s*\{[^}]*recordLeaseFinancialEntry[^}]*\}\s*from\s*["']\.\/actions["']/,
    );
    expect(serverActions).toContain('"use server"');
    for (const name of ["createLeaseContract", "activateContract", "terminateContract"]) {
      expect(serverActions).toContain(`return contract.${name}(...args);`);
    }
    expect(serverActions).toContain("return payment.recordLeaseFinancialEntry(...args);");
    expect(serverActions).toContain("return moveout.processMoveOut(...args);");
  });

  it("uses explicit UI capabilities for creation and finance writes", () => {
    expect(ledger).toMatch(/action=\{\s*canCreate\s*\?/);
    expect(ledger).toMatch(/canRecordFinance/);
    expect(ledger).toMatch(/requestId/);
    expect(ledger).toMatch(/crypto\.randomUUID\(\)/);
  });

  it("records lease money atomically and idempotently", () => {
    expect(actions).toMatch(/rpc\("record_lease_financial_entry_v2_rpc"/);
    expect(migration).toMatch(/where request_id = p_request_id/i);
    expect(migration).toMatch(/insert into public\.payments/i);
    expect(migration).toMatch(/insert into public\.ledger_entries/i);
    expect(migration).toMatch(/update public\.receivables/i);
    expect(migration).toMatch(/update public\.lease_contracts/i);
    expect(migration).toMatch(/insert into public\.audit_logs/i);
    expect(migration).toMatch(/external_receipt_no/i);
    expect(migration).toMatch(/p_exchange_rate_to_xof/i);
    expect(migration).toMatch(/payments_currency_rate_valid/i);
  });
});
