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
    const rooms = read("src/features/sales/sale-workbench-rooms.tsx");
    expect(rooms).toContain('action: () => onOpen(contract.id, "finance")');
    expect(rooms).toMatch(/icon: FileText[\s\S]{0,180}onPrint\(contract\)/);
    expect(source).toContain("onOpen={(id, section) => selectPreview(id, section)}");
    expect(source).toContain("onPrint={printContract}");
    expect(source).toContain('workspace.ensure("detail", contract.id)');
    expect(source).toContain("<SaleWorkbenchInspector");
    expect(source).toContain("initialTab={previewTab}");
    expect(source).not.toContain('panel === "detail"');
    expect(read("src/features/print/index.ts")).toContain("printSaleContract");
  });
});
