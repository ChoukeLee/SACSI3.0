import type { Locale } from "@/lib/i18n";
import type { WorkbenchResult } from "./types";

export function combineQueryResults(
  query: string,
  sections: WorkbenchResult[],
  locale: Locale,
): WorkbenchResult {
  if (!sections.length || sections.length > 5) throw new Error("Invalid multi-query result");
  if (sections.length === 1) return sections[0];
  const zh = locale === "zh";
  return {
    ...sections[0],
    query,
    title: zh ? "多项业务查询" : "Plusieurs consultations",
    answer: sections.map((section) => `${section.title}：${section.answer}`).join("\n\n"),
    scope: sections.map((section) => section.scope).join(" / "),
    metrics: [],
    table: null,
    evidence: [],
    // resultCount belongs to each section; zero intentionally prevents a false grand total.
    resultCount: 0,
    sections,
    warnings: [
      zh
        ? "各项结果独立计算，可能包含重复业务记录，不作跨项合计。"
        : "Résultats indépendants pouvant se recouper ; aucun total combiné.",
    ],
  };
}
