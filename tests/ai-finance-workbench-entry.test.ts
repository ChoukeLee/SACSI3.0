import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

describe("AI finance workbench entry", () => {
  const zhPage = read("src/app/assistant/page.tsx");
  const frPage = read("src/app/fr/assistant/page.tsx");
  const view = read("src/features/ai-workbench/workbench-view.tsx");
  const entry = read("src/features/ai-workbench/receipt-workbench.tsx");
  const upload = read("src/features/finance/receipt-upload.tsx");

  it("derives the visible finance entry from the authenticated permission", () => {
    for (const page of [zhPage, frPage]) {
      expect(page).toContain('hasPermission(user, "finance:write")');
      expect(page).toContain("canRecordFinance=");
    }
    expect(view).toContain("canRecordFinance && <ReceiptWorkbench");
  });

  it("mounts the existing three-step receipt flow inside the AI workbench", () => {
    expect(entry).toContain('from "@/features/finance/receipt-upload"');
    expect(entry).toContain('role="dialog"');
    expect(entry).toContain('aria-modal="true"');
    expect(entry).toContain("<ReceiptUpload");
    expect(upload).toContain("/api/receipt/scan");
    expect(upload).toContain("/api/receipt/prepare");
    expect(upload).toContain("/api/receipt/confirm");
  });

  it("keeps every receipt API behind the server-side finance permission", () => {
    for (const route of ["scan", "prepare", "confirm"]) {
      const source = read(`src/app/api/receipt/${route}/route.ts`);
      expect(source).toContain("await getCurrentUser()");
      expect(source).toContain('hasPermission(user, "finance:write")');
    }
  });

  it("accepts only bounded image inputs before creating a financial draft", () => {
    const scan = read("src/app/api/receipt/scan/route.ts");
    expect(scan).toContain('new Set(["image/jpeg", "image/png", "image/webp"])');
    expect(scan).toContain("10 * 1024 * 1024");
    expect(upload).toContain('accept="image/jpeg,image/png,image/webp"');
  });
});
