// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { CalendarSkeleton } from "@/features/daily-rentals/calendar-skeleton";
import styles from "@/features/daily-rentals/daily-workbench.module.css";

it.each([
  ["zh", "日租房态", "房态日历", "正在读取实时房态与订单…"],
  ["fr", "Locations courtes", "Calendrier des chambres", "Lecture de l'occupation et des séjours…"],
] as const)(
  "keeps the %s streaming skeleton calendar-first and full-width",
  (locale, title, calendar, loading) => {
    const root = document.createElement("div");
    root.innerHTML = renderToStaticMarkup(<CalendarSkeleton locale={locale} />);
    const shell = root.querySelector("section");
    expect(shell?.getAttribute("aria-busy")).toBe("true");
    expect(shell?.classList.contains(styles.compactPage)).toBe(true);
    expect(root.querySelector("header")?.classList.contains(styles.compactHeader)).toBe(true);
    expect(root.querySelector("h1")?.textContent).toBe(title);
    expect(root.querySelector("h2")?.textContent).toBe(calendar);
    expect(root.querySelector('[role="status"]')?.textContent).toBe(loading);
    expect(root.querySelector(`.${styles.workspace}`)?.classList.contains(styles.stageWide)).toBe(
      true,
    );
    expect(root.querySelector(`.${styles.inspector}`)).toBeNull();
    expect(root.querySelectorAll("[data-calendar-skeleton-row]")).toHaveLength(8);
    expect(root.querySelector('[aria-hidden="true"]')?.textContent).toBe("");
    expect(root.querySelectorAll("button, input, select, a")).toHaveLength(0);
    expect(root.textContent).not.toMatch(/今天需要处理|À traiter aujourd'hui|\d{3}/);
  },
);
