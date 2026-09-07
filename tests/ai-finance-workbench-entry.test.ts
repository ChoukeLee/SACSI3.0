import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

describe("AI finance workbench entry", () => {
  const zhPage = read("src/app/assistant/page.tsx");
  const frPage = read("src/app/fr/assistant/page.tsx");
  const view = read("src/features/ai-workbench/workbench-view.tsx");
  const upload = read("src/features/finance/receipt-upload.tsx");
  const scan = read("src/app/api/receipt/scan/route.ts");

  it("derives the visible finance entry from the authenticated permission", () => {
    for (const page of [zhPage, frPage]) {
      expect(page).toContain('hasPermission(user, "finance:write")');
      expect(page).toContain("canRecordFinance=");
    }
    expect(view).toContain("if (!canRecordFinance) return");
    expect(view).toContain("{canRecordFinance && !receiptTurn && (");
  });

  it("mounts the existing three-step receipt flow inside the conversation", () => {
    expect(view).toContain('from "@/features/finance/receipt-upload"');
    expect(view).toContain("<ReceiptConversation");
    expect(view).toContain("<ReceiptUpload");
    expect(view).toContain("autoScan");
    expect(view).toContain("conversationId={conversationId}");
    expect(upload).toContain("/api/receipt/scan");
    expect(upload).toContain("/api/receipt/prepare");
    expect(upload).toContain("/api/receipt/confirm");
    expect(upload).toContain('body.append("conversation_id", conversationId)');
  });

  it("accepts selected, pasted and dropped images in the main composer", () => {
    expect(view).toContain('onPaste={handlePaste}');
    expect(view).toContain('onDrop={handleDrop}');
    expect(view).toContain('accept="image/jpeg,image/png,image/webp"');
    expect(view).toContain("URL.createObjectURL(attachment)");
    expect(view).toContain("URL.revokeObjectURL(objectUrl)");
  });

  it("keeps every receipt API behind the server-side finance permission", () => {
    for (const route of ["scan", "prepare", "confirm"]) {
      const source = read(`src/app/api/receipt/${route}/route.ts`);
      expect(source).toContain("await getCurrentUser()");
      expect(source).toContain('hasPermission(user, "finance:write")');
    }
  });

  it("accepts only bounded image inputs before creating a financial draft", () => {
    expect(scan).toContain('new Set(["image/jpeg", "image/png", "image/webp"])');
    expect(scan).toContain("10 * 1024 * 1024");
    expect(upload).toContain('accept="image/jpeg,image/png,image/webp"');
  });

  it("records image instructions separately and includes them in extraction", () => {
    expect(scan).toContain("addAiTextInput(String(job.id), 2, manualText)");
    expect(scan).toContain('[ocr.rawText, manualText].filter(Boolean).join("\\n\\n")');
  });
});
