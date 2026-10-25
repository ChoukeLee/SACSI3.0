import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ context: vi.fn(), overview: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/features/cimac/cimac-workspace-pages", () => ({
  getCimacWorkspaceContext: mock.context,
}));
vi.mock("@/features/cimac/cimac-overview-data", () => ({ getCimacOverview: mock.overview }));
vi.mock("@/features/cimac/cimac-project-overview", () => ({
  CimacProjectOverview: () => <section>EXISTING_MAP_SEARCH_AND_DETAILS</section>,
}));
import { CimacMapPage } from "@/features/cimac/cimac-map-page";
beforeEach(() => {
  vi.clearAllMocks();
  mock.context.mockResolvedValue({ scope: { project: { id: "cimac" } } });
  mock.overview.mockResolvedValue({ project: { id: "cimac" } });
});
describe("independent CIMAC map page", () => {
  it.each(["zh", "fr"] as const)(
    "keeps the original map content and links to the independent asset directory in %s",
    async (locale) => {
      const html = renderToStaticMarkup(await CimacMapPage({ locale }));
      expect(html).toContain("EXISTING_MAP_SEARCH_AND_DETAILS");
      expect(html).toContain(`${locale === "fr" ? "/fr" : ""}/cimac/assets`);
      expect(html).not.toContain("/units?");
      expect(html).not.toContain("/management?");
    },
  );
  it.each([null, { project: { id: "sacsi" } }])(
    "rejects unavailable/mismatched overview instead of substituting another project or a zero map",
    async (overview) => {
      mock.overview.mockResolvedValue(overview);
      await expect(CimacMapPage({ locale: "zh" })).rejects.toThrow("CimacMapUnavailable");
    },
  );
  it("does not read any inventory when workspace authentication fails", async () => {
    mock.context.mockRejectedValue(new Error("NOT_FOUND"));
    await expect(CimacMapPage({ locale: "zh" })).rejects.toThrow("NOT_FOUND");
    expect(mock.overview).not.toHaveBeenCalled();
  });
});
