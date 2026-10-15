import React, { isValidElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  user: vi.fn(),
  projects: vi.fn(),
  snapshot: vi.fn(),
  cimac: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ getCurrentUser: mocks.user }));
vi.mock("@/app/management/management-data", () => ({
  getProjects: mocks.projects,
  getCimacOverview: mocks.cimac,
}));
vi.mock("@/features/management/operating-data", () => ({ getOperatingSnapshot: mocks.snapshot }));
vi.mock("@/features/management/operating-dashboard", () => ({
  OperatingDashboard: () => <section>OPERATING_SECTION_OK</section>,
}));
vi.mock("@/app/management/management-projects", () => ({
  CimacProjectOverview: () => <section>CIMAC_SECTION_OK</section>,
}));
import { redirect } from "next/navigation";
import {
  CimacSection,
  DashboardSection,
  ManagementPageContent,
} from "@/features/management/management-page";

const props = {
  projectId: "11111111-1111-4111-8111-111111111111",
  allowsSale: false,
  allowsDaily: false,
  locale: "zh" as const,
  financeMode: false,
};
beforeEach(() => {
  vi.resetAllMocks();
  mocks.user.mockResolvedValue({ id: "actor", role: "admin" });
  mocks.projects.mockResolvedValue([
    { id: props.projectId, code: "CIMAC", allows_sale: false, allows_daily_rental: false },
  ]);
  mocks.snapshot.mockResolvedValue({ projectId: props.projectId });
  mocks.cimac.mockResolvedValue({ project: { code: "CIMAC" } });
});

/** Resolve only the async server sections, preserving their surrounding page tree. */
async function resolveServerSections(node: React.ReactNode): Promise<React.ReactNode> {
  if (Array.isArray(node)) return Promise.all(node.map(resolveServerSections));
  if (!isValidElement(node)) return node;
  const element = node as ReactElement<{ children?: React.ReactNode }>;
  if (element.type === DashboardSection || element.type === CimacSection) {
    const section =
      element.type === DashboardSection
        ? await DashboardSection(element.props as Parameters<typeof DashboardSection>[0])
        : await CimacSection(element.props as Parameters<typeof CimacSection>[0]);
    return resolveServerSections(section);
  }
  return React.cloneElement(
    element,
    undefined,
    await resolveServerSections(element.props.children),
  );
}

describe("management independent section failures", () => {
  it("keeps the header, project navigation and CIMAC inventory when operating aggregation fails", async () => {
    mocks.snapshot.mockRejectedValue(new Error("statement_timeout secret-db-host private-query"));
    const page = await ManagementPageContent({ locale: "zh", params: { project: "CIMAC" } });
    const html = renderToStaticMarkup(await resolveServerSections(page));
    expect(html).toContain("科建建材城");
    expect(html).toContain("项目范围");
    expect(html).toContain("经营汇总暂不可用");
    expect(html).toContain("数据状态：未知");
    expect(html).toContain("CIMAC_SECTION_OK");
    expect(html).not.toContain("OPERATING_SECTION_OK");
    expect(html).not.toContain("secret-db-host");
    expect(html).not.toContain("statement_timeout");
    expect(html).not.toContain("0 XOF");
    expect(html).toContain(`/finance?projectId=${props.projectId}`);
  });
  it("keeps a successful operating dashboard when CIMAC inventory fails", async () => {
    mocks.cimac.mockRejectedValue(new Error("database policy details"));
    const page = await ManagementPageContent({ locale: "fr", params: { project: "CIMAC" } });
    const html = renderToStaticMarkup(await resolveServerSections(page));
    expect(html).toContain("OPERATING_SECTION_OK");
    expect(html).toContain("Inventaire CIMAC temporairement indisponible");
    expect(html).toContain("État des données : inconnu");
    expect(html).toContain("/fr/units?project=CIMAC");
    expect(html).not.toContain("CIMAC_SECTION_OK");
    expect(html).not.toContain("policy details");
  });
  it("keeps independent unknown states for both unavailable sources, not successful zeros", async () => {
    mocks.snapshot.mockRejectedValue(new Error("failed"));
    mocks.cimac.mockResolvedValue(null);
    const page = await ManagementPageContent({ locale: "zh", params: { project: "CIMAC" } });
    const html = renderToStaticMarkup(await resolveServerSections(page));
    expect(html.match(/数据状态：未知/g)).toHaveLength(2);
    expect(html).toContain("项目范围");
    expect(html).not.toContain("0 XOF");
  });
  it("renders both successful sections without an unavailable warning", async () => {
    expect(renderToStaticMarkup(await DashboardSection(props))).toContain("OPERATING_SECTION_OK");
    expect(renderToStaticMarkup(await CimacSection({ locale: "fr" }))).toContain(
      "CIMAC_SECTION_OK",
    );
  });
  it("does not swallow parent authentication redirects or load any data for a logged-out visitor", async () => {
    mocks.user.mockResolvedValue(null);
    await expect(ManagementPageContent({ locale: "zh", params: {} })).rejects.toThrow(
      "NEXT_REDIRECT",
    );
    expect(mocks.projects).not.toHaveBeenCalled();
    expect(mocks.snapshot).not.toHaveBeenCalled();
  });
  it("rethrows framework redirects if a source ever begins using them", async () => {
    mocks.snapshot.mockImplementation(async () => redirect("/login"));
    await expect(DashboardSection(props)).rejects.toThrow("NEXT_REDIRECT");
    mocks.cimac.mockImplementation(async () => redirect("/login"));
    await expect(CimacSection({ locale: "zh" })).rejects.toThrow("NEXT_REDIRECT");
  });
  it("does not turn a framework unauthorized interruption into ordinary unavailable data", async () => {
    const unauthorized = Object.assign(new Error("NEXT_HTTP_ERROR_FALLBACK;401"), {
      digest: "NEXT_HTTP_ERROR_FALLBACK;401",
    });
    mocks.snapshot.mockRejectedValue(unauthorized);
    await expect(DashboardSection(props)).rejects.toBe(unauthorized);
    mocks.cimac.mockRejectedValue(unauthorized);
    await expect(CimacSection({ locale: "fr" })).rejects.toBe(unauthorized);
  });
});
