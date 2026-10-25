import React, { isValidElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ user: vi.fn(), projects: vi.fn(), snapshot: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: mocks.user }));
vi.mock("@/app/management/management-data", () => ({ getProjects: mocks.projects }));
vi.mock("@/features/management/operating-data", () => ({ getOperatingSnapshot: mocks.snapshot }));
vi.mock("@/features/management/operating-dashboard", () => ({
  OperatingDashboard: () => <section>OPERATING_SECTION_OK</section>,
}));
import { redirect } from "next/navigation";
import { DashboardSection, ManagementPageContent } from "@/features/management/management-page";

const projectId = "11111111-1111-4111-8111-111111111111";
const cimacId = "22222222-2222-4222-8222-222222222222";
const props = {
  projectId,
  allowsSale: false,
  allowsDaily: false,
  locale: "zh" as const,
  financeMode: false,
};
beforeEach(() => {
  vi.resetAllMocks();
  mocks.user.mockResolvedValue({ id: "actor", role: "admin" });
  mocks.projects.mockResolvedValue([
    { id: cimacId, code: "CIMAC", allows_sale: false, allows_daily_rental: false },
    { id: projectId, code: "SACSI", allows_sale: true, allows_daily_rental: true },
  ]);
  mocks.snapshot.mockResolvedValue({ projectId });
});

/** Resolve the async dashboard section without bypassing page scope/redirects. */
async function resolveServerSections(node: React.ReactNode): Promise<React.ReactNode> {
  if (Array.isArray(node)) return Promise.all(node.map(resolveServerSections));
  if (!isValidElement(node)) return node;
  const element = node as ReactElement<{ children?: React.ReactNode }>;
  if (element.type === DashboardSection)
    return resolveServerSections(
      await DashboardSection(element.props as Parameters<typeof DashboardSection>[0]),
    );
  return React.cloneElement(
    element,
    undefined,
    await resolveServerSections(element.props.children),
  );
}

describe("SACSI dashboard isolation and unavailable states", () => {
  it.each(["zh", "fr"] as const)(
    "keeps SACSI navigation and an explicit unknown state when aggregation fails in %s",
    async (locale) => {
      mocks.snapshot.mockRejectedValue(new Error("statement_timeout secret-db-host private-query"));
      const page = await ManagementPageContent({ locale, params: {} });
      const html = renderToStaticMarkup(await resolveServerSections(page));
      expect(html).toContain(locale === "zh" ? "SACSI 经营驾驶舱" : "SACSI · pilotage");
      expect(html).toContain(locale === "zh" ? "项目范围" : "Périmètre du projet");
      expect(html).toContain(
        locale === "zh" ? "经营汇总暂不可用" : "Synthèse temporairement indisponible",
      );
      expect(html).toContain(locale === "zh" ? "数据状态：未知" : "État des données : inconnu");
      expect(html).not.toContain("CIMAC");
      expect(html).not.toContain("OPERATING_SECTION_OK");
      expect(html).not.toContain("secret-db-host");
      expect(html).not.toContain("statement_timeout");
      expect(html).not.toContain("0 XOF");
      expect(html).toContain(`${locale === "fr" ? "/fr" : ""}/finance?projectId=${projectId}`);
      expect(mocks.snapshot).toHaveBeenCalledExactlyOnceWith(projectId);
    },
  );
  it.each(["zh", "fr"] as const)(
    "renders only the successful SACSI dashboard in %s, without mounting legacy CIMAC sections",
    async (locale) => {
      const page = await ManagementPageContent({ locale, params: { project: "SACSI" } });
      const html = renderToStaticMarkup(await resolveServerSections(page));
      expect(html).toContain("OPERATING_SECTION_OK");
      expect(html).not.toContain("CIMAC");
      expect(html).not.toContain("暂不可用");
      expect(mocks.snapshot).toHaveBeenCalledExactlyOnceWith(projectId);
    },
  );
  it.each(["zh", "fr"] as const)(
    "redirects legacy CIMAC code and immutable project UUID to its independent workspace in %s",
    async (locale) => {
      for (const project of ["CIMAC", "cimac", cimacId]) {
        const result = (await ManagementPageContent({ locale, params: { project } }).catch(
          (error: unknown) => error,
        )) as Error & { digest: string };
        expect(result.message).toBe("NEXT_REDIRECT");
        expect(result.digest).toContain(`${locale === "fr" ? "/fr" : ""}/cimac`);
        expect(mocks.snapshot).not.toHaveBeenCalled();
      }
    },
  );
  it("does not substitute a CIMAC dashboard when SACSI access is unavailable", async () => {
    mocks.projects.mockResolvedValue([{ id: cimacId, code: "CIMAC" }]);
    const page = await ManagementPageContent({ locale: "zh", params: {} });
    expect(renderToStaticMarkup(page)).toContain("当前账号未配置可访问项目");
    expect(mocks.snapshot).not.toHaveBeenCalled();
  });
  it("does not load business data before verified authentication", async () => {
    mocks.user.mockResolvedValue(null);
    await expect(ManagementPageContent({ locale: "zh", params: {} })).rejects.toThrow(
      "NEXT_REDIRECT",
    );
    expect(mocks.projects).not.toHaveBeenCalled();
    expect(mocks.snapshot).not.toHaveBeenCalled();
  });
  it("rethrows framework redirects from the data source", async () => {
    mocks.snapshot.mockImplementation(async () => redirect("/login"));
    await expect(DashboardSection(props)).rejects.toThrow("NEXT_REDIRECT");
  });
  it("does not turn framework authorization interruptions into ordinary unavailable data", async () => {
    const unauthorized = Object.assign(new Error("NEXT_HTTP_ERROR_FALLBACK;401"), {
      digest: "NEXT_HTTP_ERROR_FALLBACK;401",
    });
    mocks.snapshot.mockRejectedValue(unauthorized);
    await expect(DashboardSection(props)).rejects.toBe(unauthorized);
  });
});
