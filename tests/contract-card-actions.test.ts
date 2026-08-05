import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(__dirname, "..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

describe("contract card shortcuts", () => {
  it("keeps long-lease detail, finance and print actions distinct", () => {
    const source = read("src/features/leases/lease-list.tsx");
    expect(source).toContain('openDetail(contract.id, "finance")');
    expect(source).toMatch(/icon=\{FileText\}[\s\S]{0,240}printLeaseContract/);
    expect(source).toContain("financeSectionRef.current?.scrollIntoView");
  });

  it("keeps sale detail, finance and print actions distinct", () => {
    const source = read("src/features/sales/sale-list.tsx");
    expect(source).toContain('openDetail(contract.id, "finance")');
    expect(source).toMatch(/icon=\{FileText\}[\s\S]{0,180}printContract\(contract\)/);
    expect(source).toContain("financeSectionRef.current?.scrollIntoView");
    expect(read("src/features/print/index.ts")).toContain("printSaleContract");
  });
});
