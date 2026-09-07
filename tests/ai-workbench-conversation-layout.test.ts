import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("AI workbench conversation layout", () => {
  const view = readFileSync(join(process.cwd(), "src/features/ai-workbench/workbench-view.tsx"), "utf8");

  it("keeps the conversation readable on wide screens", () => {
    expect(view).toContain("mx-auto max-h-[420px] max-w-4xl");
  });

  it("sizes both message bubbles to their content and wraps long text", () => {
    expect(view).toContain("ml-auto w-fit max-w-[82%] break-words");
    expect(view).toContain("w-fit max-w-[92%] break-words");
  });
});
