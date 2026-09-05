import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

describe("AI workbench French result layer", () => {
  const queryService = read("src/features/ai-workbench/query-service.ts");
  const actions = read("src/features/ai-workbench/actions.ts");
  const draftService = read("src/features/ai-workbench/action-draft-service.ts");
  const view = read("src/features/ai-workbench/workbench-view.tsx");
  const zhPage = read("src/app/assistant/page.tsx");
  const frPage = read("src/app/fr/assistant/page.tsx");

  it("threads the locale from the page into the workbench query pipeline", () => {
    expect(zhPage).toContain('locale="zh"');
    expect(frPage).toContain('locale="fr"');
    expect(view).toContain("export function AiWorkbenchView({ locale = \"zh\" }");
    expect(view).toContain('name="locale"');
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

  it("keeps the bilingual UI copy complete for both locales", () => {
    for (const key of ["verifyTitle", "confirmExecuting", "boundaryConfirmText", "emptyRows", "evidenceTitle", "loadingTitle"]) {
      expect(view).toContain(`${key}:`);
    }
    expect(view).toContain('"Confirmer et exécuter"');
    expect(view).toContain('"Vérification après exécution (base relue)"');
    expect(view).toContain('"Enregistrements réels"');
  });
});
