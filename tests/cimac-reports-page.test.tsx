import { beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ context: vi.fn(), load: vi.fn() }));
vi.mock("@/features/cimac/cimac-workspace-pages", () => ({
  getCimacWorkspaceContext: mocks.context,
}));
vi.mock("@/features/reports/report-data", () => ({ loadReportData: mocks.load }));
vi.mock("next/navigation", () => ({
  notFound() {
    throw new Error("not-found");
  },
}));
import { CimacReportsPage } from "@/features/reports/cimac-reports-page";
const project = "11111111-1111-4111-8111-111111111111";
beforeEach(() => {
  vi.resetAllMocks();
  mocks.context.mockResolvedValue({ user: { role: "admin" }, scope: { project: { id: project } } });
  mocks.load.mockResolvedValue({ query: { kind: "ledger" } });
});
it.each(["zh", "fr"] as const)(
  "locks valid %s reports before the financial read",
  async (locale) => {
    const page = await CimacReportsPage({
      locale,
      searchParams: Promise.resolve({ month: "2026-10" }),
    });
    expect(page.props.locale).toBe(locale);
    expect(mocks.load).toHaveBeenCalledExactlyOnceWith({ month: "2026-10" }, { workArea: "cimac" });
  },
);
it.each([
  { projectId: "22222222-2222-4222-8222-222222222222" },
  { projectId: [project, project] },
  { kind: "invalid" },
  { month: "2026-99" },
])("rejects malformed or foreign scope explicitly before loading %j", async (params) => {
  await expect(
    CimacReportsPage({ locale: "zh", searchParams: Promise.resolve(params) }),
  ).rejects.toThrow("not-found");
  expect(mocks.load).not.toHaveBeenCalled();
});
it("keeps the existing finance-role boundary", async () => {
  mocks.context.mockResolvedValue({
    user: { role: "rental_sales" },
    scope: { project: { id: project } },
  });
  await expect(
    CimacReportsPage({ locale: "zh", searchParams: Promise.resolve({}) }),
  ).rejects.toThrow("not-found");
  expect(mocks.load).not.toHaveBeenCalled();
});
