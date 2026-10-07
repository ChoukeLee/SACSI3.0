import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

describe("AI workbench French result layer", () => {
  const queryService = read("src/features/ai-workbench/query-service.ts");
  const actions = read("src/features/ai-workbench/actions.ts");
  const draftService = read("src/features/ai-workbench/action-draft-service.ts");

  it("preserves locale support in the retained shared query pipeline", () => {
    expect(actions).toContain("function readLocale(formData: FormData): Locale");
    expect(actions).toContain("executeWorkbenchQuery(query, intent, locale)");
    expect(actions).toContain("buildCleaningCompletionDraft(actionIntent, locale)");
  });

  it("localizes server-produced query results and drafts", () => {
    expect(queryService).toContain('locale: Locale = "zh"');
    expect(queryService).toContain('"fr-FR"');
    expect(queryService).toContain('"Reste dû"');
    expect(queryService).toContain('tr(locale, "逾期", "en retard")');
    expect(draftService).toContain("buildCleaningCompletionDraft(intent: WorkbenchActionIntent, locale: Locale = \"zh\")");
    expect(draftService).toContain('"Terminer le ménage"');
    expect(actions).toContain('tr(locale, "保洁已完成并复查", "Ménage terminé et vérifié")');
  });

});
