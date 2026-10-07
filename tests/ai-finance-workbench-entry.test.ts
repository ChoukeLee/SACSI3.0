import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

describe("AI finance workbench entry", () => {
  const zhPage = read("src/app/assistant/page.tsx");
  const frPage = read("src/app/fr/assistant/page.tsx");
  const upload = read("src/features/finance/receipt-upload.tsx");
  const scan = read("src/app/api/receipt/scan/route.ts");

  it("retires both embedded entries without opening or creating conversations", () => {
    for (const page of [zhPage, frPage]) {
      expect(page).toContain('redirect("/operator")');
      expect(page).not.toContain("AiWorkbenchView");
      expect(page).not.toContain("getOrCreateActiveConversation");
    }
    expect(read("src/components/app-sidebar.tsx")).not.toContain('href: "/assistant"');
    expect(read("src/components/app-shell.tsx")).toContain('href="/operator"');
    expect(read("src/app/operator/page.tsx")).toContain("getCurrentUser");
    expect(existsSync(join(root,"src/features/ai-workbench/workbench-view.tsx"))).toBe(false);
  });

  it("preserves the shared three-step receipt flow", () => {
    expect(upload).toContain("/api/receipt/scan");
    expect(upload).toContain("/api/receipt/prepare");
    expect(upload).toContain("/api/receipt/revise");
    expect(upload).toContain("/api/receipt/confirm");
    expect(upload).toContain('body.append("conversation_id", conversationId)');
    expect(upload).toContain("proposal_version: prepared.proposal.version");
    expect(upload).toContain("每次修改都会生成新版本并写入审计记录");
  });


  it("keeps every receipt API behind the server-side finance permission", () => {
    for (const route of ["scan", "prepare", "revise", "confirm"]) {
      const source = read(`src/app/api/receipt/${route}/route.ts`);
      expect(source).toContain("await getCurrentUser()");
      expect(source).toContain('hasPermission(user, "finance:write")');
    }
  });

  it("binds prepare, revision and confirmation to the same conversation", () => {
    expect(upload.match(/conversation_id: conversationId/g)?.length).toBeGreaterThanOrEqual(3);
    for (const route of ["prepare", "revise", "confirm"]) {
      const source = read(`src/app/api/receipt/${route}/route.ts`);
      expect(source).toContain("conversation_id");
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
