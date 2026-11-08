import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(__dirname, "..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

describe("contract card shortcuts", () => {
  it("keeps long-lease detail, finance and print actions distinct", () => {
    const source = read("src/features/leases/lease-list.tsx");
    expect(source).toContain("onClick={() => openDetail(contract.id)}");
    expect(source).toContain('openDetail(contract.id, "finance")');
    expect(source).toMatch(/icon=\{FileText\}[\s\S]{0,240}printById\(contract.id\)/);
    const printHandler = source.slice(
      source.indexOf("const printById ="),
      source.indexOf("const statBlocks:"),
    );
    expect(printHandler).toContain('workspace.ensure("detail", id)');
    expect(printHandler).toContain("printLeaseContract(");
    expect(printHandler).toContain("source.contracts.find((row) => row.id === id)");
    expect(printHandler).toContain("source.receivables.filter(");
    expect(source).toContain("<LeaseWorkbenchInspector");
    expect(source).toContain("initialSection={detailSection}");
    expect(source).not.toContain('panel === "detail"');
  });

  it("keeps sale detail, finance and print actions distinct", () => {
    const source = read("src/features/sales/sale-list.tsx");
    const rooms = read("src/features/sales/sale-room-overview.tsx");
    const inspector = read("src/features/sales/sale-workbench-inspector.tsx");
    expect(rooms).toContain("onClick={() => onSelectRecord(record)}");
    expect(source).toContain("onSelectRecord={(row) => selectPreview(row.id)}");
    expect(rooms).not.toContain("onPrint");
    expect(inspector).toContain("<RecordDetailTabs");
    for (const [value, label] of [
      ["overview", "概览"],
      ["payments", "收付款"],
      ["info", "资料"],
      ["history", "历史"],
    ]) {
      expect(inspector).toContain(`value: "${value}", label: text("${label}"`);
    }
    expect(inspector).toContain("items={tabs}");
    expect(inspector).toContain("value={tab}");
    expect(inspector).toContain('initialTab === "finance" ? "payments" : "overview"');
    expect(inspector).toContain('onClick={() => onAction("payment")}');
    expect(inspector).toContain("onClick={() => onPrint(contract)}");
    expect(source).toContain("onPrint={printContract}");
    const printHandler = source.slice(
      source.indexOf("const printContract ="),
      source.indexOf("const handleCreate ="),
    );
    expect(printHandler).toContain('workspace.ensure("detail", contract.id)');
    expect(printHandler).toContain("printSaleContract(");
    expect(printHandler).not.toContain("openAction(");
    expect(source).toContain("<SaleWorkbenchInspector");
    expect(source).toContain("initialTab={previewTab}");
    expect(source).not.toContain('panel === "detail"');
    expect(read("src/features/print/index.ts")).toContain("printSaleContract");
  });
});
