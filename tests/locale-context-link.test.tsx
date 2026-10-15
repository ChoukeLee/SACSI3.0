import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { LocaleContextLink } from "../src/components/locale-context-link";

const navigation = vi.hoisted(() => ({ pathname: "/management", query: "project=CIMAC" }));
vi.mock("next/navigation", () => ({
  usePathname: () => navigation.pathname,
  useSearchParams: () => new URLSearchParams(navigation.query),
}));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
it("preserves the selected project when switching the homepage language", () => {
  expect(renderToStaticMarkup(<LocaleContextLink locale="fr" label="FR" />)).toContain(
    'href="/fr/management?project=CIMAC"',
  );
});
it("preserves finance date, project and page filters without broadening the scope", () => {
  navigation.pathname = "/fr/finance";
  navigation.query = "projectId=33c1528b-6c2f-45fd-bbf1-92863765809a&dateFrom=2026-10-01&page=2";
  const html = renderToStaticMarkup(<LocaleContextLink locale="zh" label="中文" />);
  expect(html).toContain(
    "/finance?projectId=33c1528b-6c2f-45fd-bbf1-92863765809a&amp;dateFrom=2026-10-01&amp;page=2",
  );
});
it("does not append an empty query delimiter", () => {
  navigation.pathname = "/fr/leases";
  navigation.query = "";
  expect(renderToStaticMarkup(<LocaleContextLink locale="zh" label="中文" />)).toContain(
    'href="/leases"',
  );
});
