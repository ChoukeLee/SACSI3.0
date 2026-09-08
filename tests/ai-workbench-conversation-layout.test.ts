import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("AI workbench conversation layout", () => {
  const view = readFileSync(join(process.cwd(), "src/features/ai-workbench/workbench-view.tsx"), "utf8");

  it("uses one bounded conversation surface with an integrated composer", () => {
    expect(view).toContain("min-h-[340px] max-h-[min(58vh,680px)] overflow-y-auto");
    expect(view).toContain('className="border-t border-border bg-card px-4 py-4 sm:px-6"');
    expect(view).not.toContain("lg:grid-cols-[minmax(0,1fr)_300px]");
  });

  it("sizes both message bubbles to their content and wraps long text", () => {
    expect(view).toContain("ml-auto w-fit max-w-[82%] break-words");
    expect(view).toContain("w-fit max-w-[92%] break-words");
  });

  it("moves operational boundaries into an expandable disclosure", () => {
    expect(view).toContain('<details className="group relative shrink-0">');
    expect(view).not.toContain('<aside className="border-t border-border bg-muted/35');
  });
});
