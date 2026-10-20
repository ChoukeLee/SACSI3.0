// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { CalendarSkeleton } from "@/features/daily-rentals/calendar-skeleton";

it.each([
  ["zh", "正在加载日历…"],
  ["fr", "Chargement du calendrier…"],
] as const)(
  "keeps the original %s calendar loading state readable without fabricated business data",
  (locale, loading) => {
    const root = document.createElement("div");
    root.innerHTML = renderToStaticMarkup(<CalendarSkeleton locale={locale} />);
    const shell = root.querySelector("section");
    expect(shell?.getAttribute("aria-busy")).toBe("true");
    expect(root.querySelector('[role="status"]')?.textContent).toBe(loading);
    expect(root.querySelectorAll("button, input, select, a")).toHaveLength(0);
    expect(root.textContent).not.toMatch(/今天需要处理|À traiter aujourd'hui|\d{3}|XOF/);
  },
);
